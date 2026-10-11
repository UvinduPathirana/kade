import { Metadata, status } from "@grpc/grpc-js";
import { AddCartLineRequest, CheckoutOptions } from "@kade/proto/kade/cart/v1/cart_service";
import { RestaurantProblem } from "@kade/proto/kade/catalog/v1/catalog_service";
import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import { DeliveryFeeWaiver } from "@kade/proto/kade/pricing/v1/pricing_service";
import { pino } from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createRequestContext, type RequestContext } from "../platform/grpc/context.js";
import { DomainError } from "../platform/grpc/errors.js";
import { canonicalRestaurantId, CartGrpcService } from "./cart.grpc.js";
import type { CartStore } from "./cart.store.js";
import {
  FakeCatalog,
  FakePricing,
  FakeProfile,
  FakePromotion,
  KOMPANNA,
  KOTTU_HOUSE,
  MemoryCartStore,
} from "./fakes.test-helpers.js";

let store: MemoryCartStore;
let catalog: FakeCatalog;
let pricing: FakePricing;
let promotion: FakePromotion;
let profile: FakeProfile;
let service: CartGrpcService;

beforeEach(() => {
  store = new MemoryCartStore();
  catalog = new FakeCatalog();
  pricing = new FakePricing();
  promotion = new FakePromotion();
  profile = new FakeProfile();
  service = new CartGrpcService(
    store as unknown as CartStore,
    catalog,
    pricing,
    promotion,
    profile,
    pino({ level: "silent" }),
  );
});

function ctx(userId = "dilini", roles = "customer"): RequestContext {
  const md = new Metadata();
  md.set("x-user-id", userId);
  md.set("x-roles", roles);
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

const add = (over: Partial<AddCartLineRequest> = {}, c = ctx()) =>
  service.addCartLine(
    {
      ...AddCartLineRequest.fromPartial({ restaurantId: KOMPANNA, itemId: "fish-bun", quantity: 1 }),
      ...over,
    },
    c,
  );

/** The app's seed cart: 4 fish buns "No chilli", 3 vegetable roti, 2 chicken patties. */
async function seedCart() {
  await add({ quantity: 4, note: "No chilli" });
  await add({ itemId: "roti", quantity: 3 });
  return add({ itemId: "patty", quantity: 2 });
}

describe("GetCart", () => {
  it("returns an empty cart for a new customer, with delivery as the default mode", async () => {
    const { cart } = await service.getCart({ customerId: "" }, ctx());
    expect(cart).toMatchObject({
      customerId: "dilini",
      restaurantId: "",
      lines: [],
      options: { mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY },
    });
  });

  it("customers only see their own cart; staff may look", async () => {
    expect(await reasonOf(service.getCart({ customerId: "someone-else" }, ctx()))).toEqual([
      status.PERMISSION_DENIED,
      "CART_NOT_YOURS",
    ]);
    await expect(
      service.getCart({ customerId: "someone-else" }, ctx("sup", "support")),
    ).resolves.toBeDefined();
    expect(
      await reasonOf(service.getCart({ customerId: "" }, createRequestContext({ metadata: new Metadata() }))),
    ).toEqual([status.UNAUTHENTICATED, "UNAUTHENTICATED"]);
  });
});

describe("AddCartLine", () => {
  it("validates against catalog and stores catalog's name and price", async () => {
    const { cart } = await add({ quantity: 4, note: " No chilli " });
    expect(cart).toMatchObject({ restaurantId: KOMPANNA, restaurantName: "Kompanna Short Eats" });
    expect(cart?.lines[0]).toMatchObject({
      key: "fish-bun|No chilli",
      name: "Fish bun",
      unitPrice: { amountMinor: 140_00 },
      quantity: 4,
      note: "No chilli",
    });
    expect(catalog.calls[0]).toMatchObject({
      restaurantId: KOMPANNA,
      lines: [{ itemId: "fish-bun", quantity: 4 }],
    });
  });

  it("merges identical lines and keeps different ones apart", async () => {
    await seedCart();
    const { cart } = await add({ quantity: 2, note: "No chilli" });
    expect(cart?.lines.map((l) => [l.key, l.quantity])).toEqual([
      ["fish-bun|No chilli", 6],
      ["roti|", 3],
      ["patty|", 2],
    ]);
  });

  it("paid options are priced by catalog and part of the key", async () => {
    const { cart } = await add({
      restaurantId: KOTTU_HOUSE,
      itemId: "kottu",
      options: [
        { optionGroupId: "spice", choiceId: "hot" },
        { optionGroupId: "add", choiceId: "cheese" },
      ],
    });
    expect(cart?.lines[0]).toMatchObject({
      key: "kottu|cheese|hot|",
      unitPrice: { amountMinor: 1_300_00 },
      choiceNames: ["Extra cheese", "Sri Lankan hot"],
    });
  });

  it("another restaurant → CART_OTHER_RESTAURANT (before calling catalog); replace starts over", async () => {
    await seedCart();
    const calls = catalog.calls.length;
    expect(await reasonOf(add({ restaurantId: KOTTU_HOUSE, itemId: "kottu" }))).toEqual([
      status.FAILED_PRECONDITION,
      "CART_OTHER_RESTAURANT",
    ]);
    expect(catalog.calls).toHaveLength(calls);
    const { cart } = await add({ restaurantId: KOTTU_HOUSE, itemId: "kottu", replaceCart: true });
    expect(cart).toMatchObject({ restaurantId: KOTTU_HOUSE, lines: [{ itemId: "kottu" }] });
  });

  it("accepts the apps' numeric restaurant ids", async () => {
    expect(canonicalRestaurantId("3")).toBe(KOMPANNA);
    const { cart } = await add({ restaurantId: "3" });
    expect(cart?.restaurantId).toBe(KOMPANNA);
  });

  it.each([
    [{ itemId: "nope" }, status.NOT_FOUND, "ITEM_NOT_FOUND"],
    [{ restaurantId: "00000000-0000-7000-8000-000000000099" }, status.NOT_FOUND, "RESTAURANT_NOT_FOUND"],
    [{ itemId: "" }, status.INVALID_ARGUMENT, "ITEM_REQUIRED"],
    [{ quantity: 100 }, status.INVALID_ARGUMENT, "QUANTITY_INVALID"],
    [{ quantity: -1 }, status.INVALID_ARGUMENT, "QUANTITY_INVALID"],
    [
      { restaurantId: KOTTU_HOUSE, itemId: "kottu", options: [{ optionGroupId: "x", choiceId: "bogus" }] },
      status.INVALID_ARGUMENT,
      "OPTION_INVALID",
    ],
  ])("rejects %j with %s %s", async (over, code, reason) => {
    expect(await reasonOf(add(over as Partial<AddCartLineRequest>))).toEqual([code, reason]);
  });

  it("sold out → ITEM_SOLD_OUT with catalog's message", async () => {
    catalog.menus[KOMPANNA]!.dishes.patty!.soldOut = true;
    const err = await add({ itemId: "patty" }).catch((e: DomainError) => e);
    expect(err).toMatchObject({
      code: status.FAILED_PRECONDITION,
      reason: "ITEM_SOLD_OUT",
      message: "Chicken patty is sold out today.",
    });
  });

  it("catalog down → UNAVAILABLE CATALOG_UNAVAILABLE and nothing is written", async () => {
    catalog.down = true;
    expect(await reasonOf(add())).toEqual([status.UNAVAILABLE, "CATALOG_UNAVAILABLE"]);
    expect(store.carts.size).toBe(0);
  });

  it("closed restaurants still accept adds (customers can schedule)", async () => {
    catalog.restaurantProblem = RestaurantProblem.RESTAURANT_PROBLEM_CLOSED;
    await expect(add()).resolves.toBeDefined();
    catalog.restaurantProblem = RestaurantProblem.RESTAURANT_PROBLEM_SUSPENDED;
    expect(await reasonOf(add())).toEqual([status.FAILED_PRECONDITION, "RESTAURANT_UNAVAILABLE"]);
  });
});

describe("UpdateCartLine / RemoveCartLine / ClearCart", () => {
  it("quantity 0 removes; note changes re-key", async () => {
    await seedCart();
    let { cart } = await service.updateCartLine({ customerId: "", lineKey: "roti|", quantity: 0 }, ctx());
    expect(cart?.lines.map((l) => l.key)).toEqual(["fish-bun|No chilli", "patty|"]);
    ({ cart } = await service.updateCartLine(
      { customerId: "", lineKey: "patty|", quantity: 2, note: "Extra sauce" },
      ctx(),
    ));
    expect(cart?.lines[1]).toMatchObject({ key: "patty|Extra sauce", quantity: 2 });
    expect(
      await reasonOf(service.updateCartLine({ customerId: "", lineKey: "nope", quantity: 1 }, ctx())),
    ).toEqual([status.NOT_FOUND, "CART_LINE_NOT_FOUND"]);
  });

  it("remove and clear", async () => {
    await seedCart();
    let { cart } = await service.removeCartLine({ customerId: "", lineKey: "roti|" }, ctx());
    expect(cart?.lines).toHaveLength(2);
    ({ cart } = await service.clearCart({ customerId: "" }, ctx()));
    expect(cart).toMatchObject({ restaurantId: "", lines: [] });
  });
});

describe("UpdateCheckoutOptions", () => {
  const opts = (over: Partial<CheckoutOptions> = {}) => ({
    ...CheckoutOptions.fromPartial({ mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY }),
    ...over,
  });

  it("replaces all options, normalising the promo code", async () => {
    const { cart } = await service.updateCheckoutOptions(
      {
        customerId: "",
        options: opts({
          promoCode: " kade100 ",
          tip: { amountMinor: 100_00, currency: "LKR" },
          useCredit: true,
        }),
      },
      ctx(),
    );
    expect(cart?.options).toMatchObject({
      promoCode: "KADE100",
      tip: { amountMinor: 100_00 },
      useCredit: true,
    });
  });

  it.each([
    [{ tip: { amountMinor: -1, currency: "LKR" } }, "TIP_INVALID"],
    [{ tip: { amountMinor: 5_000_01, currency: "LKR" } }, "TIP_INVALID"],
    [{ scheduledFor: new Date(Date.now() - 3_600_000) }, "SCHEDULE_IN_PAST"],
    [{ scheduledFor: new Date(Date.now() + 8 * 86_400_000) }, "SCHEDULE_TOO_FAR"],
    [{ riderNote: "x".repeat(501) }, "NOTE_TOO_LONG"],
    [{ mode: 7 as FulfilmentMode }, "MODE_INVALID"],
  ])("rejects %j", async (over, reason) => {
    expect(
      await reasonOf(service.updateCheckoutOptions({ customerId: "", options: opts(over) }, ctx())),
    ).toEqual([status.INVALID_ARGUMENT, reason]);
  });
});

describe("GetCartQuote", () => {
  const setOptions = (over: Partial<CheckoutOptions>) =>
    service.updateCheckoutOptions(
      {
        customerId: "",
        options: {
          ...CheckoutOptions.fromPartial({ mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY }),
          ...over,
        },
      },
      ctx(),
    );

  it("empty cart: zero totals without calling catalog or pricing", async () => {
    profile.credit = 250_00;
    const q = await service.getCartQuote({ customerId: "" }, ctx());
    expect(q.totals).toMatchObject({ itemCount: 0, total: { amountMinor: 0 } });
    expect(q.creditBalance).toEqual({ amountMinor: 250_00, currency: "LKR" });
    expect(catalog.calls).toHaveLength(0);
    expect(pricing.calls).toHaveLength(0);
  });

  it("re-validates, prices with server-side prices, tip and the restaurant location", async () => {
    await seedCart();
    await setOptions({
      tip: { amountMinor: 100_00, currency: "LKR" },
      address: {
        id: "",
        label: "Home",
        line: "",
        area: "",
        note: "",
        location: { lat: 6.9105, lng: 79.8515 },
        zoneId: "c03",
      },
    });
    catalog.menus[KOMPANNA]!.dishes["fish-bun"]!.price = 150_00; // price changed since the add
    const q = await service.getCartQuote({ customerId: "" }, ctx());
    expect(q.totals).toMatchObject({
      itemCount: 9,
      subtotal: { amountMinor: 1_280_00 },
      deliveryFee: { amountMinor: 120_00 },
      tip: { amountMinor: 100_00 },
      total: { amountMinor: 1_500_00 },
    });
    expect(q.cart?.lines[0]?.unitPrice?.amountMinor).toBe(150_00);
    expect(pricing.calls[0]).toMatchObject({
      restaurantId: KOMPANNA,
      restaurantLocation: { lat: 6.91, lng: 79.851 },
      deliverTo: { lat: 6.9105, lng: 79.8515 },
      lines: [
        { lineKey: "fish-bun|No chilli", unitPrice: { amountMinor: 150_00 }, quantity: 4 },
        { lineKey: "roti|" },
        { lineKey: "patty|" },
      ],
      plusActive: false,
    });
    expect(q.waiver).toBe(DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_NONE);
  });

  it("sold-out lines are reported and left out of the totals", async () => {
    await seedCart();
    catalog.menus[KOMPANNA]!.dishes.patty!.soldOut = true;
    const q = await service.getCartQuote({ customerId: "" }, ctx());
    expect(q.lines.find((l) => l.lineKey === "patty|")?.problemMessage).toBe(
      "Chicken patty is sold out today.",
    );
    expect(q.totals?.subtotal?.amountMinor).toBe(920_00);
  });

  it("valid promo: discount checked against the promo-free price, then re-priced", async () => {
    await seedCart();
    await setOptions({ promoCode: "KADE100" });
    const q = await service.getCartQuote({ customerId: "" }, ctx());
    expect(q.promo).toMatchObject({
      code: "KADE100",
      ok: true,
      label: "Rs 100 off",
      discount: { amountMinor: 100_00 },
    });
    expect(q.totals?.promoDiscount?.amountMinor).toBe(100_00);
    expect(promotion.promoCalls[0]?.basket).toMatchObject({
      subtotal: { amountMinor: 1_240_00 },
      deliveryFee: { amountMinor: 120_00 },
    });
    expect(pricing.calls).toHaveLength(2);
  });

  it("rejected promo: stable reason and the app's message, no discount", async () => {
    await add({ quantity: 2 });
    await setOptions({ promoCode: "KADE100" });
    const q = await service.getCartQuote({ customerId: "" }, ctx());
    expect(q.promo).toMatchObject({
      ok: false,
      errorReason: "PROMO_MIN_SUBTOTAL",
      errorMessage: "KADE100 needs an order of Rs 1,000 or more. Add Rs 720 to use it.",
    });
    expect(q.totals?.promoDiscount?.amountMinor).toBe(0);
    expect(pricing.calls).toHaveLength(1);
  });

  it("promotion down: promo shows PROMOTION_UNAVAILABLE, offer falls back to the catalog snapshot", async () => {
    await seedCart();
    await setOptions({ promoCode: "KADE100" });
    promotion.down = true;
    catalog.discountPercent = 20;
    const q = await service.getCartQuote({ customerId: "" }, ctx());
    expect(q.promo).toMatchObject({ ok: false, errorReason: "PROMOTION_UNAVAILABLE" });
    expect(pricing.calls[0]?.restaurantDiscountPercent).toBe(20);
    expect(q.totals?.saving?.amountMinor).toBe(248_00);
  });

  it("promotion's offer evaluation wins over the catalog snapshot", async () => {
    await seedCart();
    catalog.discountPercent = 20;
    promotion.offer = {
      offer: { id: "o1" } as never,
      discountPercent: 0,
      saving: { amountMinor: 50_00, currency: "LKR" },
      freeDelivery: true,
    };
    await service.getCartQuote({ customerId: "" }, ctx());
    expect(pricing.calls[0]).toMatchObject({
      restaurantDiscountPercent: 0,
      offerSaving: { amountMinor: 50_00 },
      freeDeliveryOffer: true,
    });
  });

  it("Plus and credit come from profile; credit only when use_credit is on", async () => {
    await seedCart();
    await add({ quantity: 2, itemId: "roti" }); // subtotal 1,480
    await add({ quantity: 1, itemId: "fish-bun" }); // 1,620
    profile.plus = true;
    profile.credit = 300_00;
    let q = await service.getCartQuote({ customerId: "" }, ctx());
    expect(q.waiver).toBe(DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_PLUS);
    expect(q.totals?.credit?.amountMinor).toBe(0);
    expect(q.creditBalance?.amountMinor).toBe(300_00);
    await setOptions({ useCredit: true });
    q = await service.getCartQuote({ customerId: "" }, ctx());
    expect(q.totals?.credit?.amountMinor).toBe(300_00);
  });

  it("profile down: quotes without Plus or credit instead of failing", async () => {
    await seedCart();
    profile.down = true;
    const q = await service.getCartQuote({ customerId: "" }, ctx());
    expect(q.totals?.total?.amountMinor).toBe(1_360_00);
    expect(q.creditBalance?.amountMinor).toBe(0);
  });

  it("catalog or pricing down → UNAVAILABLE with a dependency reason", async () => {
    await seedCart();
    pricing.down = true;
    expect(await reasonOf(service.getCartQuote({ customerId: "" }, ctx()))).toEqual([
      status.UNAVAILABLE,
      "PRICING_UNAVAILABLE",
    ]);
    catalog.down = true;
    expect(await reasonOf(service.getCartQuote({ customerId: "" }, ctx()))).toEqual([
      status.UNAVAILABLE,
      "CATALOG_UNAVAILABLE",
    ]);
  });

  it("passes restaurant problems through", async () => {
    await seedCart();
    catalog.restaurantProblem = RestaurantProblem.RESTAURANT_PROBLEM_CLOSED;
    const q = await service.getCartQuote({ customerId: "" }, ctx());
    expect(q).toMatchObject({
      restaurantProblem: RestaurantProblem.RESTAURANT_PROBLEM_CLOSED,
      restaurantProblemMessage: "Opens at 8 am",
    });
  });
});
