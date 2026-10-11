// Integration test against the SHARED stack (pnpm infra:up): Redis on localhost:6379.
// Catalog and pricing are in-process fake gRPC servers (real protos, real network hop); promotion
// and profile point at a closed port to exercise the degrade paths. Override REDIS_URL if needed.
import {
  credentials,
  Metadata,
  Server,
  ServerCredentials,
  status,
  type sendUnaryData,
  type ServerUnaryCall,
  type ServiceError,
} from "@grpc/grpc-js";
import type { INestApplication } from "@nestjs/common";
import * as cartApi from "@kade/proto/kade/cart/v1/cart_service";
import { CatalogServiceService, type ValidateCartRequest } from "@kade/proto/kade/catalog/v1/catalog_service";
import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import { PricingServiceService, type QuoteCartRequest } from "@kade/proto/kade/pricing/v1/pricing_service";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "../../src/app.js";
import { FakeCatalog, FakePricing, KOMPANNA, KOTTU_HOUSE } from "../../src/cart/fakes.test-helpers.js";
import { loadConfig } from "../../src/platform/config.js";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "../../src/platform/grpc/error-details.js";
import { GrpcServer } from "../../src/platform/grpc/grpc-server.js";
import { createLogger } from "../../src/platform/logger.js";

const catalog = new FakeCatalog();
const pricing = new FakePricing();
const fakes = new Server();

function unary<Req, Res>(fn: (req: Req) => Promise<Res>) {
  return (call: ServerUnaryCall<Req, Res>, cb: sendUnaryData<Res>) =>
    void fn(call.request).then(
      (res) => cb(null, res),
      (err: ServiceError) => cb(err),
    );
}

let app: INestApplication;
let client: cartApi.CartServiceClient;
let redis: Redis;
let httpBase: string;
const customers: string[] = [];

beforeAll(async () => {
  fakes.addService(CatalogServiceService, {
    validateCart: unary((r: ValidateCartRequest) => catalog.validateCart(r)),
  });
  fakes.addService(PricingServiceService, {
    quoteCart: unary((r: QuoteCartRequest) => pricing.quoteCart(r)),
  });
  const fakePort = await new Promise<number>((resolve, reject) =>
    fakes.bindAsync("127.0.0.1:0", ServerCredentials.createInsecure(), (err, port) =>
      err ? reject(err) : resolve(port),
    ),
  );
  const config = loadConfig({
    SERVICE_NAME: "cart",
    REDIS_URL: "redis://localhost:6379",
    LOG_LEVEL: "error",
    ...process.env,
    CATALOG_GRPC: `127.0.0.1:${fakePort}`,
    PRICING_GRPC: `127.0.0.1:${fakePort}`,
    PROMOTION_GRPC: "127.0.0.1:1",
    PROFILE_GRPC: "127.0.0.1:1",
    DOWNSTREAM_DEADLINE_MS: "500",
    GRPC_PORT: "0",
    HTTP_PORT: "0",
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
  });
  app = await startApp(config, createLogger(config));
  client = new cartApi.CartServiceClient(
    `localhost:${app.get(GrpcServer).port}`,
    credentials.createInsecure(),
  );
  const address = (app.getHttpServer() as HttpServer).address();
  httpBase = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  redis = new Redis(config.REDIS_URL);
});

afterAll(async () => {
  if (customers.length) await redis.del(...customers.map((c) => `cart:${c}`));
  redis?.disconnect();
  client?.close();
  await app?.close();
  fakes.forceShutdown();
});

function customer(): { id: string; md: Metadata } {
  const id = `it-${randomUUID()}`;
  customers.push(id);
  const md = new Metadata();
  md.set("x-user-id", id);
  md.set("x-roles", "customer");
  return { id, md };
}

// Promisified call; the request type is the method name capitalised + "Request" (fromPartial fills defaults).
function call<Res>(method: string, partial: object, md: Metadata): Promise<Res> {
  const type = `${method[0]!.toUpperCase()}${method.slice(1)}Request`;
  const req = (cartApi as unknown as Record<string, { fromPartial(o: object): unknown }>)[type]!.fromPartial(
    partial,
  );
  const fn = (client as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!.bind(client);
  return new Promise((resolve, reject) =>
    fn(req, md, { deadline: Date.now() + 5_000 }, (err: Error | null, res: Res) =>
      err ? reject(err) : resolve(res),
    ),
  );
}

async function grpcError(
  promise: Promise<unknown>,
): Promise<{ code: status; reason: string | undefined; metadata?: Record<string, string> }> {
  const err = (await promise.then(
    () => expect.unreachable("expected the call to fail"),
    (e: unknown) => e,
  )) as ServiceError;
  const details = err.metadata.get(STATUS_DETAILS_KEY)[0];
  const info = details ? decodeErrorInfo(details as Buffer) : undefined;
  return { code: err.code, reason: info?.reason, metadata: info?.metadata };
}

type CartRes = { cart: cartApi.Cart };

describe("CartService over gRPC (shared Redis)", () => {
  it("is ready when Redis is", async () => {
    const res = await fetch(`${httpBase}/health/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ checks: { redis: "ok" } });
  });

  it("builds the seed cart in Redis with a 7-day TTL", async () => {
    const { id, md } = customer();
    await call(
      "addCartLine",
      { restaurantId: KOMPANNA, itemId: "fish-bun", quantity: 4, note: "No chilli" },
      md,
    );
    await call("addCartLine", { restaurantId: KOMPANNA, itemId: "roti", quantity: 3 }, md);
    const { cart } = await call<CartRes>(
      "addCartLine",
      { restaurantId: KOMPANNA, itemId: "patty", quantity: 2 },
      md,
    );
    expect(cart.lines.map((l) => [l.key, l.name, l.quantity])).toEqual([
      ["fish-bun|No chilli", "Fish bun", 4],
      ["roti|", "Vegetable roti", 3],
      ["patty|", "Chicken patty", 2],
    ]);
    expect(cart.expiresAt!.getTime() - cart.updatedAt!.getTime()).toBe(7 * 24 * 3600 * 1000);

    const ttl = await redis.ttl(`cart:${id}`);
    expect(ttl).toBeGreaterThan(7 * 24 * 3600 - 60);
    const stored = await call<CartRes>("getCart", {}, md);
    expect(stored.cart.lines).toHaveLength(3);
    expect(stored.cart.customerId).toBe(id);
  });

  it("one restaurant per cart: CART_OTHER_RESTAURANT with the current restaurant, then replace", async () => {
    const { md } = customer();
    await call("addCartLine", { restaurantId: KOMPANNA, itemId: "fish-bun" }, md);
    expect(await grpcError(call("addCartLine", { restaurantId: KOTTU_HOUSE, itemId: "kottu" }, md))).toEqual({
      code: status.FAILED_PRECONDITION,
      reason: "CART_OTHER_RESTAURANT",
      metadata: { restaurant_id: KOMPANNA, restaurant_name: "Kompanna Short Eats" },
    });
    const { cart } = await call<CartRes>(
      "addCartLine",
      { restaurantId: KOTTU_HOUSE, itemId: "kottu", replaceCart: true },
      md,
    );
    expect(cart).toMatchObject({ restaurantId: KOTTU_HOUSE, restaurantName: "Galle Road Kottu House" });
    expect(cart.lines).toHaveLength(1);
  });

  it("concurrent adds all land (compare-and-set on Redis)", async () => {
    const { md } = customer();
    await Promise.all(
      Array.from({ length: 15 }, () =>
        call("addCartLine", { restaurantId: KOMPANNA, itemId: "fish-bun" }, md),
      ),
    );
    const { cart } = await call<CartRes>("getCart", {}, md);
    expect(cart.lines).toEqual([expect.objectContaining({ key: "fish-bun|", quantity: 15 })]);
  });

  it("GetCartQuote prices through pricing; profile and promotion being down only degrade", async () => {
    const { md } = customer();
    await call("addCartLine", { restaurantId: KOMPANNA, itemId: "fish-bun", quantity: 4 }, md);
    await call("addCartLine", { restaurantId: KOMPANNA, itemId: "roti", quantity: 3 }, md);
    await call(
      "updateCheckoutOptions",
      {
        options: {
          mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
          tip: { amountMinor: 100_00, currency: "LKR" },
          promoCode: "kade100",
        },
      },
      md,
    );
    const q = await call<cartApi.GetCartQuoteResponse>("getCartQuote", {}, md);
    expect(q.totals).toMatchObject({
      itemCount: 7,
      subtotal: { amountMinor: 920_00 },
      deliveryFee: { amountMinor: 120_00 },
      tip: { amountMinor: 100_00 },
      total: { amountMinor: 1_140_00 },
    });
    expect(q.promo).toMatchObject({ code: "KADE100", ok: false, errorReason: "PROMOTION_UNAVAILABLE" });
    expect(q.creditBalance).toEqual({ amountMinor: 0, currency: "LKR" });
  });

  it("update, remove and clear lines", async () => {
    const { md } = customer();
    await call("addCartLine", { restaurantId: KOMPANNA, itemId: "fish-bun", quantity: 2 }, md);
    await call("addCartLine", { restaurantId: KOMPANNA, itemId: "roti" }, md);
    let { cart } = await call<CartRes>("updateCartLine", { lineKey: "fish-bun|", quantity: 5 }, md);
    expect(cart.lines[0]?.quantity).toBe(5);
    ({ cart } = await call<CartRes>("updateCartLine", { lineKey: "roti|", quantity: 0 }, md));
    expect(cart.lines).toHaveLength(1);
    ({ cart } = await call<CartRes>("clearCart", {}, md));
    expect(cart).toMatchObject({ restaurantId: "", lines: [] });
    expect(await grpcError(call("updateCartLine", { lineKey: "roti|", quantity: 1 }, md))).toMatchObject({
      code: status.NOT_FOUND,
      reason: "CART_LINE_NOT_FOUND",
    });
  });

  it("catalog down → UNAVAILABLE CATALOG_UNAVAILABLE within the deadline", async () => {
    const { md } = customer();
    catalog.down = true;
    try {
      const started = Date.now();
      expect(
        await grpcError(call("addCartLine", { restaurantId: KOMPANNA, itemId: "fish-bun" }, md)),
      ).toMatchObject({
        code: status.UNAVAILABLE,
        reason: "CATALOG_UNAVAILABLE",
      });
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      catalog.down = false;
    }
  });

  it("customers cannot touch other carts", async () => {
    const a = customer();
    const b = customer();
    expect(await grpcError(call("getCart", { customerId: a.id }, b.md))).toMatchObject({
      code: status.PERMISSION_DENIED,
      reason: "CART_NOT_YOURS",
    });
  });
});
