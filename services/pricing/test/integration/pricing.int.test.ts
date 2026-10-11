// Integration test against the SHARED stack (pnpm infra:up): Postgres database `pricing`.
// Defaults to this laptop's host port 15432; override with DATABASE_URL.
// Every rule it changes is put back in a finally block, so the seeded rules survive a run.
import { credentials, Metadata, status, type ServiceError } from "@grpc/grpc-js";
import type { INestApplication } from "@nestjs/common";
import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import * as pricing from "@kade/proto/kade/pricing/v1/pricing_service";
import type { Server } from "node:http";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "../../src/app.js";
import { loadConfig } from "../../src/platform/config.js";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "../../src/platform/grpc/error-details.js";
import { GrpcServer } from "../../src/platform/grpc/grpc-server.js";
import { createLogger } from "../../src/platform/logger.js";

const config = loadConfig({
  SERVICE_NAME: "pricing",
  DATABASE_URL: "postgres://pricing:pricing@localhost:15432/pricing",
  LOG_LEVEL: "warn",
  ...process.env,
  GRPC_PORT: "0",
  HTTP_PORT: "0",
  RULES_CACHE_MS: "0",
  OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
});

let app: INestApplication;
let client: pricing.PricingServiceClient;
let pool: pg.Pool;
let httpBase: string;

beforeAll(async () => {
  app = await startApp(config, createLogger(config));
  client = new pricing.PricingServiceClient(
    `localhost:${app.get(GrpcServer).port}`,
    credentials.createInsecure(),
  );
  const address = (app.getHttpServer() as Server).address();
  httpBase = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
});

afterAll(async () => {
  client?.close();
  await pool?.end();
  await app?.close();
});

const Rs = (rupees: number) => ({ amountMinor: rupees * 100, currency: "LKR" });
const KOLLUPITIYA = { lat: 6.91, lng: 79.851 };
// Monday 2026-10-12, 16:00 in Colombo: no time-window surcharge runs.
const QUIET = new Date("2026-10-12T16:00:00+05:30");

function md(roles = ""): Metadata {
  const m = new Metadata();
  m.set("x-user-id", "ops-it");
  if (roles) m.set("x-roles", roles);
  return m;
}

// Promisifies one unary call on the generated client; fills proto3 defaults via fromPartial
// (the request type is the method name with an upper-case first letter + "Request").
function call<Req, Res>(method: string, partial: Req, metadata = md()): Promise<Res> {
  const type = `${method[0]!.toUpperCase()}${method.slice(1)}Request`;
  const codec = (pricing as unknown as Record<string, { fromPartial(o: unknown): unknown }>)[type]!;
  const req = codec.fromPartial(partial);
  const fn = (client as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!.bind(client);
  return new Promise((resolve, reject) =>
    fn(req, metadata, { deadline: Date.now() + 5_000 }, (err: Error | null, res: Res) =>
      err ? reject(err) : resolve(res),
    ),
  );
}

async function grpcError(promise: Promise<unknown>): Promise<{ code: status; reason: string | undefined }> {
  const err = (await promise.then(
    () => expect.unreachable("expected the call to fail"),
    (e: unknown) => e,
  )) as ServiceError;
  const details = err.metadata.get(STATUS_DETAILS_KEY)[0];
  return { code: err.code, reason: details ? decodeErrorInfo(details as Buffer)?.reason : undefined };
}

const version = async (): Promise<number> =>
  Number((await pool.query("select rules_version from pricing_settings where id = 1")).rows[0].rules_version);

describe("PricingService over gRPC (shared Postgres)", () => {
  it("is ready and serves the seeded rules", async () => {
    const ready = await fetch(`${httpBase}/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: "ok", checks: { postgres: "ok" } });

    const { config: cfg } = await call<object, pricing.GetPricingConfigResponse>("getPricingConfig", {});
    expect(cfg!.zones.map((z: { id: string }) => z.id)).toEqual(
      expect.arrayContaining(["c01", "c03", "c15", "deh", "raj", "nug", "mtl"]),
    );
    expect(cfg!.zones).toHaveLength(19);
    expect(cfg!.zones.find((z: { id: string }) => z.id === "c03")).toMatchObject({
      code: "Colombo 03",
      name: "Kollupitiya",
      baseFee: Rs(100),
      perKm: Rs(30),
      smallOrderFee: Rs(60),
      smallOrderUnder: Rs(500),
    });
    expect(cfg!.surcharges.map((s: { label: string }) => s.label)).toEqual(
      expect.arrayContaining(["Lunch peak", "Dinner peak", "Weekend late nights", "Poya day"]),
    );
    expect(cfg!.plusFreeDeliveryFrom).toEqual(Rs(1500));
  });

  it("QuoteCart prices the app's seed cart like totals.ts", async () => {
    const res = await call<object, pricing.QuoteCartResponse>("quoteCart", {
      restaurantId: "00000000-0000-7000-8000-000000000003",
      restaurantLocation: KOLLUPITIYA,
      mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
      lines: [
        { lineKey: "a", unitPrice: Rs(140), quantity: 4 },
        { lineKey: "b", unitPrice: Rs(120), quantity: 3 },
        { lineKey: "c", unitPrice: Rs(160), quantity: 2 },
      ],
      deliverTo: { lat: 6.9105, lng: 79.8515 },
      tip: Rs(100),
      at: QUIET,
    });
    expect(res.totals).toMatchObject({
      itemCount: 9,
      subtotal: Rs(1240),
      deliveryFee: Rs(100),
      smallOrderFee: Rs(0),
      tip: Rs(100),
      total: Rs(1440),
    });
    expect(res.waiver).toBe(pricing.DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_NONE);
    expect(res.rulesVersion).toBe(await version());
  });

  it("rule changes apply to the next quote and bump the rules version", async () => {
    const before = await version();
    try {
      const rain = await call<object, pricing.SetWeatherSurchargeResponse>(
        "setWeatherSurcharge",
        { weather: { enabled: true, amount: Rs(50) } },
        md("ops"),
      );
      expect(rain.weather).toEqual({ enabled: true, amount: Rs(50) });
      const res = await call<object, pricing.QuoteDeliveryFeeResponse>("quoteDeliveryFee", {
        zoneId: "c03",
        distanceKm: 3.5,
        subtotal: Rs(450),
        at: QUIET,
      });
      expect(res.breakdown?.surcharges).toEqual([{ label: "Heavy rain", amount: Rs(50) }]);
      expect(res.deliveryTotal).toEqual(Rs(100 + 45 + 50 + 60));
      expect(await version()).toBe(before + 1);
    } finally {
      await call("setWeatherSurcharge", { weather: { enabled: false, amount: Rs(50) } }, md("ops"));
    }
  });

  it("updates zones and surcharge rules, then restores them", async () => {
    try {
      const closed = await call<object, pricing.SetZoneOpenResponse>(
        "setZoneOpen",
        { zoneId: "c03", open: false },
        md("ops"),
      );
      expect(closed.zone).toMatchObject({ id: "c03", open: false });
      const resolved = await call<object, pricing.ResolveZoneResponse>("resolveZone", {
        location: KOLLUPITIYA,
      });
      expect(resolved).toMatchObject({ inZone: false, zone: { id: "c03" } });

      const fees = await call<object, pricing.UpdateZoneFeesResponse>(
        "updateZoneFees",
        { zoneId: "c03", baseFee: Rs(110), perKm: Rs(30), smallOrderFee: Rs(60), smallOrderUnder: Rs(500) },
        md("admin"),
      );
      expect(fees.zone?.baseFee).toEqual(Rs(110));

      const rule = await call<object, pricing.SaveSurchargeRuleResponse>(
        "saveSurchargeRule",
        {
          rule: {
            id: "s4",
            label: "Poya day",
            days: pricing.SurchargeDays.SURCHARGE_DAYS_EVERY_DAY,
            start: "09:00",
            end: "22:00",
            amount: Rs(50),
            enabled: false,
          },
        },
        md("ops"),
      );
      expect(rule.rule).toMatchObject({ id: "s4", start: "09:00" });
    } finally {
      await call("setZoneOpen", { zoneId: "c03", open: true }, md("ops"));
      await call(
        "updateZoneFees",
        { zoneId: "c03", baseFee: Rs(100), perKm: Rs(30), smallOrderFee: Rs(60), smallOrderUnder: Rs(500) },
        md("ops"),
      );
      await call(
        "saveSurchargeRule",
        {
          rule: {
            id: "s4",
            label: "Poya day",
            days: pricing.SurchargeDays.SURCHARGE_DAYS_EVERY_DAY,
            start: "10:00",
            end: "22:00",
            amount: Rs(50),
            enabled: false,
          },
        },
        md("ops"),
      );
    }
    const { rows } = await pool.query("select open, base_fee_minor from zones where id = 'c03'");
    expect(rows[0]).toEqual({ open: true, base_fee_minor: "10000" });
  });

  it("maps errors to status codes with ErrorInfo reasons", async () => {
    expect(await grpcError(call("setZoneOpen", { zoneId: "c03", open: false }, md("customer")))).toEqual({
      code: status.PERMISSION_DENIED,
      reason: "PERMISSION_DENIED",
    });
    expect(await grpcError(call("setZoneOpen", { zoneId: "nope", open: true }, md("ops")))).toEqual({
      code: status.NOT_FOUND,
      reason: "ZONE_NOT_FOUND",
    });
    expect(await grpcError(call("quoteDeliveryFee", { deliverTo: { lat: 7.29, lng: 80.63 } }))).toEqual({
      code: status.FAILED_PRECONDITION,
      reason: "OUT_OF_ZONE",
    });
  });
});
