import { Metadata, status } from "@grpc/grpc-js";
import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import {
  DeliveryFeeWaiver,
  QuoteCartRequest,
  SurchargeDays,
  type SurchargeRule,
} from "@kade/proto/kade/pricing/v1/pricing_service";
import { beforeEach, describe, expect, it } from "vitest";
import { createRequestContext, type RequestContext } from "../platform/grpc/context.js";
import { DomainError } from "../platform/grpc/errors.js";
import { colombo, fixtureRules, KANDY, KOLLUPITIYA } from "./fixtures.test-helpers.js";
import { lkr } from "./money.js";
import { PricingGrpcService } from "./pricing.grpc.js";
import type { RuleSet } from "./rules.js";
import type { RulesRepository } from "./rules.repository.js";

let rules: RuleSet;
let writes: { op: string; args: unknown[] }[];
let service: PricingGrpcService;

beforeEach(() => {
  rules = fixtureRules();
  writes = [];
  const record =
    (op: string, result: (...args: unknown[]) => unknown) =>
    async (_ctx: unknown, ...args: unknown[]) => {
      writes.push({ op, args });
      return result(...args);
    };
  const repo = {
    rules: async () => rules,
    setZoneOpen: record("setZoneOpen", (id, open) => ({ ...rules.zones.find((z) => z.id === id)!, open })),
    updateZoneFees: record("updateZoneFees", (id, fees) => ({
      ...rules.zones.find((z) => z.id === id)!,
      ...(fees as object),
    })),
    saveSurchargeRule: record("saveSurchargeRule", (r) => ({ ...(r as object), id: "new-id" })),
    setSurchargeRuleEnabled: record("setSurchargeRuleEnabled", (id, enabled) => ({
      ...rules.surcharges.find((r) => r.id === id)!,
      enabled,
    })),
    setWeather: record("setWeather", (w) => w),
  } as unknown as RulesRepository;
  service = new PricingGrpcService(repo);
});

function ctx(roles = ""): RequestContext {
  const md = new Metadata();
  md.set("x-user-id", "u1");
  if (roles) md.set("x-roles", roles);
  return createRequestContext({ metadata: md });
}

async function reasonOf(promise: Promise<unknown>): Promise<[status, string]> {
  const err = await promise.then(
    () => expect.unreachable(),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  return [(err as DomainError).code, (err as DomainError).reason];
}

const quoteRequest = (over: Partial<QuoteCartRequest> = {}): QuoteCartRequest => ({
  ...QuoteCartRequest.fromPartial({}),
  restaurantId: "r1",
  restaurantLocation: KOLLUPITIYA,
  mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
  lines: [
    { lineKey: "fish-bun", unitPrice: lkr(140_00), quantity: 4 },
    { lineKey: "roti", unitPrice: lkr(120_00), quantity: 3 },
    { lineKey: "patty", unitPrice: lkr(160_00), quantity: 2 },
  ],
  deliverTo: { lat: 6.9105, lng: 79.8515 },
  at: colombo("2026-10-12T16:00"),
  ...over,
});

describe("QuoteCart", () => {
  it("returns totals in Money, the breakdown, waiver and rules version", async () => {
    const res = await service.quoteCart(quoteRequest({ tip: lkr(100_00) }));
    expect(res.totals).toEqual({
      itemCount: 9,
      subtotal: lkr(1_240_00),
      saving: lkr(0),
      deliveryFee: lkr(100_00),
      smallOrderFee: lkr(0),
      promoDiscount: lkr(0),
      tip: lkr(100_00),
      credit: lkr(0),
      total: lkr(1_440_00),
    });
    expect(res.deliveryFeeBreakdown).toMatchObject({ zoneId: "c03", base: lkr(100_00), total: lkr(100_00) });
    expect(res).toMatchObject({
      waiver: DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_NONE,
      outOfZone: false,
      rulesVersion: 7,
    });
    expect(res.quoteId).toMatch(/^q_/);
  });

  it("offer_saving, when set, replaces the percent", async () => {
    const res = await service.quoteCart(
      quoteRequest({ restaurantDiscountPercent: 20, offerSaving: lkr(50_00) }),
    );
    expect(res.totals?.saving).toEqual(lkr(50_00));
    const pct = await service.quoteCart(quoteRequest({ restaurantDiscountPercent: 20 }));
    expect(pct.totals?.saving).toEqual(lkr(248_00));
  });

  it("flags out-of-zone addresses", async () => {
    const res = await service.quoteCart(quoteRequest({ deliverTo: KANDY }));
    expect(res.outOfZone).toBe(true);
    expect(res.totals?.deliveryFee).toEqual(lkr(0));
  });

  it.each([
    ["mode missing", { mode: FulfilmentMode.FULFILMENT_MODE_UNSPECIFIED }, "MODE_REQUIRED"],
    ["percent over 100", { restaurantDiscountPercent: 120 }, "DISCOUNT_PERCENT_INVALID"],
    ["negative quantity", { lines: [{ lineKey: "x", unitPrice: lkr(100), quantity: -1 }] }, "LINE_INVALID"],
    ["other currency", { tip: { amountMinor: 100, currency: "USD" } }, "CURRENCY_UNSUPPORTED"],
    ["no locations at all", { restaurantLocation: undefined, deliverTo: undefined }, "LOCATION_REQUIRED"],
  ])("rejects %s", async (_name, over, reason) => {
    expect(await reasonOf(service.quoteCart(quoteRequest(over as Partial<QuoteCartRequest>)))).toEqual([
      status.INVALID_ARGUMENT,
      reason,
    ]);
  });
});

describe("QuoteDeliveryFee", () => {
  it("admin preview: zone + km + subtotal, the console's quoteDelivery figures", async () => {
    const res = await service.quoteDeliveryFee({
      restaurantId: "",
      zoneId: "c03",
      distanceKm: 3.5,
      subtotal: lkr(450_00),
      at: colombo("2026-10-12T20:00"),
    });
    expect(res).toEqual({
      breakdown: {
        zoneId: "c03",
        distanceKm: 3.5,
        base: lkr(100_00),
        distance: lkr(45_00),
        surcharges: [{ label: "Dinner peak", amount: lkr(40_00) }],
        total: lkr(185_00),
      },
      smallOrderFee: lkr(60_00),
      deliveryTotal: lkr(245_00),
      total: lkr(695_00),
    });
  });

  it("by location; unknown zone and out-of-zone fail", async () => {
    const res = await service.quoteDeliveryFee({
      restaurantId: "",
      restaurantLocation: KOLLUPITIYA,
      deliverTo: KOLLUPITIYA,
      zoneId: "",
      distanceKm: 0,
    });
    expect(res.breakdown?.zoneId).toBe("c03");
    expect(
      await reasonOf(service.quoteDeliveryFee({ restaurantId: "", zoneId: "nope", distanceKm: 1 })),
    ).toEqual([status.NOT_FOUND, "ZONE_NOT_FOUND"]);
    expect(
      await reasonOf(
        service.quoteDeliveryFee({ restaurantId: "", deliverTo: KANDY, zoneId: "", distanceKm: 0 }),
      ),
    ).toEqual([status.FAILED_PRECONDITION, "OUT_OF_ZONE"]);
  });
});

describe("BatchQuoteDeliveryFees / ResolveZone / config", () => {
  it("quotes many restaurants to one place", async () => {
    const res = await service.batchQuoteDeliveryFees({
      restaurants: [
        { restaurantId: "a", location: KOLLUPITIYA },
        { restaurantId: "b", location: { lat: 6.851, lng: 79.865 } },
      ],
      deliverTo: KOLLUPITIYA,
      at: colombo("2026-10-12T16:00"),
    });
    expect(res.fees[0]).toEqual({ restaurantId: "a", distanceKm: 0, fee: lkr(100_00), outOfZone: false });
    // 6.7 km at Colombo 03's Rs 30/km beyond 2 km: Rs 100 + round(4.7 × 30) = Rs 241
    expect(res.fees[1]).toMatchObject({ restaurantId: "b", distanceKm: 6.7, fee: lkr(241_00) });
    const far = await service.batchQuoteDeliveryFees({
      restaurants: [{ restaurantId: "a", location: KOLLUPITIYA }],
      deliverTo: KANDY,
    });
    expect(far.fees[0]).toMatchObject({ outOfZone: true, fee: lkr(0) });
  });

  it("resolves zones, closed ones are not in zone", async () => {
    expect(await service.resolveZone({ location: KOLLUPITIYA })).toMatchObject({
      inZone: true,
      zone: { id: "c03", code: "Colombo 03" },
    });
    expect(await service.resolveZone({ location: { lat: 6.833, lng: 79.865 } })).toMatchObject({
      inZone: false,
      zone: { id: "mtl", open: false },
    });
    expect(await service.resolveZone({ location: KANDY })).toEqual({ zone: undefined, inZone: false });
  });

  it("returns the whole config", async () => {
    const { config } = await service.getPricingConfig();
    expect(config?.zones).toHaveLength(4);
    expect(config?.surcharges[0]).toMatchObject({
      id: "s1",
      days: SurchargeDays.SURCHARGE_DAYS_MON_TO_FRI,
      start: "12:00",
      amount: lkr(30_00),
    });
    expect(config).toMatchObject({
      weather: { enabled: false, amount: lkr(50_00) },
      plusFreeDeliveryFrom: lkr(1_500_00),
      rulesVersion: 7,
    });
  });
});

describe("admin writes", () => {
  const rule = (over: Partial<SurchargeRule> = {}): SurchargeRule => ({
    id: "",
    label: "Exam week",
    days: SurchargeDays.SURCHARGE_DAYS_EVERY_DAY,
    start: "18:00",
    end: "20:00",
    amount: lkr(25_00),
    enabled: true,
    ...over,
  });

  it("need ops or admin", async () => {
    expect(await reasonOf(service.setZoneOpen({ zoneId: "c03", open: false }, ctx("customer")))).toEqual([
      status.PERMISSION_DENIED,
      "PERMISSION_DENIED",
    ]);
    expect(writes).toHaveLength(0);
    await service.setZoneOpen({ zoneId: "c03", open: false }, ctx("ops"));
    expect(writes[0]).toEqual({ op: "setZoneOpen", args: ["c03", false] });
  });

  it("validates zone fees like the console", async () => {
    const fees = {
      baseFee: lkr(120_00),
      perKm: lkr(35_00),
      smallOrderFee: lkr(60_00),
      smallOrderUnder: lkr(500_00),
    };
    const res = await service.updateZoneFees({ zoneId: "c03", ...fees }, ctx("admin"));
    expect(res.zone).toMatchObject({ id: "c03", baseFee: lkr(120_00) });
    expect(
      await reasonOf(service.updateZoneFees({ zoneId: "c03", ...fees, perKm: lkr(5_001_00) }, ctx("ops"))),
    ).toEqual([status.INVALID_ARGUMENT, "ZONE_FEES_INVALID"]);
    expect(
      await reasonOf(service.updateZoneFees({ zoneId: "c03", ...fees, baseFee: undefined }, ctx("ops"))),
    ).toEqual([status.INVALID_ARGUMENT, "ZONE_FEES_INVALID"]);
  });

  it("validates surcharge rules", async () => {
    const saved = await service.saveSurchargeRule({ rule: rule() }, ctx("ops"));
    expect(saved.rule).toMatchObject({
      id: "new-id",
      label: "Exam week",
      days: SurchargeDays.SURCHARGE_DAYS_EVERY_DAY,
    });
    expect(writes[0]?.args[0]).toMatchObject({ id: undefined, days: "every_day", amount: 25_00 });
    for (const [bad, reason] of [
      [{ label: "  " }, "SURCHARGE_LABEL_REQUIRED"],
      [{ amount: lkr(0) }, "SURCHARGE_AMOUNT_INVALID"],
      [{ amount: lkr(501_00) }, "SURCHARGE_AMOUNT_INVALID"],
      [{ days: SurchargeDays.SURCHARGE_DAYS_UNSPECIFIED }, "SURCHARGE_DAYS_INVALID"],
      [{ start: "7pm" }, "SURCHARGE_TIME_INVALID"],
      [{ end: "18:00" }, "SURCHARGE_TIME_INVALID"],
    ] as const) {
      expect(await reasonOf(service.saveSurchargeRule({ rule: rule(bad) }, ctx("ops")))).toEqual([
        status.INVALID_ARGUMENT,
        reason,
      ]);
    }
  });

  it("toggles rules and the rain surcharge", async () => {
    const res = await service.setSurchargeRuleEnabled({ id: "s4", enabled: true }, ctx("ops"));
    expect(res.rule).toMatchObject({ id: "s4", label: "Poya day", enabled: true });
    const rain = await service.setWeatherSurcharge(
      { weather: { enabled: true, amount: lkr(50_00) } },
      ctx("ops"),
    );
    expect(rain.weather).toEqual({ enabled: true, amount: lkr(50_00) });
    expect(
      await reasonOf(service.setWeatherSurcharge({ weather: { enabled: true, amount: lkr(0) } }, ctx("ops"))),
    ).toEqual([status.INVALID_ARGUMENT, "WEATHER_AMOUNT_INVALID"]);
  });
});
