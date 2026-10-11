import { OrderStatus } from "@kade/proto/kade/order/v1/order_service";
import { beforeEach, describe, expect, it } from "vitest";
import { stubCatalog, stubPricing, stubProfile, stubPromotion } from "../clients/stubs.js";
import type { ProfilePort } from "../clients/ports.js";
import type { Database } from "../platform/db/database.js";
import { CheckoutService, promoReason } from "./checkout.js";
import { order as makeOrder, placeRequest } from "./fixtures.test-util.js";
import { lkr } from "./money.js";
import type { OrderRecord, OrderRepository } from "./order.repository.js";
import type { OrderStore } from "./order.store.js";

let record: OrderRecord;
let profile: ProfilePort;

function service(): CheckoutService {
  const orders = {
    findById: async () => record,
    countPrevious: async () => 2,
  } as unknown as OrderRepository;
  const store = {
    mutate: async (_ctx: unknown, _id: string, fn: (o: OrderRecord["order"]) => unknown) => {
      fn(record.order);
      return { order: record.order, events: [] };
    },
  } as unknown as OrderStore;
  return new CheckoutService(
    { db: {} } as Database,
    orders,
    store,
    stubCatalog(),
    profile,
    stubPricing(),
    stubPromotion(),
  );
}

function withRequest(overrides: Parameters<typeof placeRequest>[0]) {
  const request = placeRequest(overrides);
  record = {
    order: makeOrder(OrderStatus.ORDER_STATUS_PENDING),
    request,
    requestHash: "h",
    idempotencyKey: "k",
  };
}

beforeEach(() => {
  profile = stubProfile();
  withRequest({});
});

describe("CheckoutService.prepare (saga step 1)", () => {
  it("prices the order with server prices and saves the snapshot", async () => {
    const plan = await service().prepare("o1");
    // 3 dishes × Rs 1,000 + Rs 150 delivery + Rs 100 tip
    expect(plan).toEqual({
      ok: true,
      promoCode: "",
      promoDiscountMinor: 0,
      creditMinor: 0,
      totalMinor: 325_000,
      paymentKind: 1,
      releaseAt: undefined,
    });
    expect(record.order.lines.map((l) => l.unitPrice?.amountMinor)).toEqual([100_000, 100_000]);
    expect(record.order.zoneId).toBe("c03");
    expect(record.order.customerRepeatCount).toBe(2);
    expect(record.order.customer?.name).toBe("Kadé customer");
  });

  it("applies a valid promo code and fails an invalid one with PROMO_<rejection>", async () => {
    withRequest({ promoCode: "kade100" });
    const plan = await service().prepare("o1");
    expect(plan).toMatchObject({
      ok: true,
      promoCode: "KADE100",
      promoDiscountMinor: 10_000,
      totalMinor: 315_000,
    });

    withRequest({ promoCode: "NOPE" });
    expect(await service().prepare("o1")).toMatchObject({ ok: false, reason: "PROMO_NOT_FOUND" });
  });

  it("PRICE_CHANGED when the total differs from what the customer saw", async () => {
    withRequest({ expectedTotal: lkr(300_000) });
    expect(await service().prepare("o1")).toMatchObject({ ok: false, reason: "PRICE_CHANGED" });
    withRequest({ expectedTotal: lkr(325_000) });
    expect(await service().prepare("o1")).toMatchObject({ ok: true });
  });

  it("ITEM_SOLD_OUT, OUT_OF_ZONE and CUSTOMER_BLOCKED", async () => {
    withRequest({ lines: [{ key: "x", itemId: "soldout-1", quantity: 1, options: [], note: "" }] });
    expect(await service().prepare("o1")).toMatchObject({
      ok: false,
      reason: "ITEM_SOLD_OUT",
      metadata: { lineKey: "x" },
    });

    withRequest({});
    record.request.address!.location = { lat: 0, lng: 0 };
    expect(await service().prepare("o1")).toMatchObject({ ok: false, reason: "OUT_OF_ZONE" });

    withRequest({});
    profile = {
      ...stubProfile(),
      getCustomer: async () => ({
        id: "c",
        name: "",
        phone: "",
        email: "",
        area: "",
        blocked: true,
        blockReason: "",
        plusActive: false,
      }),
    };
    expect(await service().prepare("o1")).toMatchObject({ ok: false, reason: "CUSTOMER_BLOCKED" });
  });

  it("spends credit when asked, never more than the bill", async () => {
    await profile.changeCredit({
      customerId: record.request.customerId,
      amount: lkr(50_000),
      reason: 4,
      label: "",
      orderId: "",
      ticketId: "",
      by: "",
      idempotencyKey: "seed",
    });
    withRequest({ useCredit: true });
    expect(await service().prepare("o1")).toMatchObject({
      ok: true,
      creditMinor: 50_000,
      totalMinor: 275_000,
    });
  });

  it("scheduled far enough ahead → releaseAt = scheduled_for − delivery eta", async () => {
    const scheduledFor = new Date(Date.now() + 5 * 3_600_000);
    withRequest({ scheduledFor });
    record.order.scheduledFor = scheduledFor;
    const plan = await service().prepare("o1");
    expect(plan).toMatchObject({
      ok: true,
      releaseAt: new Date(scheduledFor.getTime() - 30 * 60_000).toISOString(),
    });
  });

  it("maps promotion rejections to stable reasons", () => {
    expect(promoReason(4)).toBe("PROMO_MIN_SUBTOTAL");
    expect(promoReason(0)).toBe("PROMO_INVALID");
  });
});
