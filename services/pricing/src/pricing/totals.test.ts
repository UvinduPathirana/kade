import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import { describe, expect, it } from "vitest";
import { computeTotals, type TotalsInput } from "./totals.js";

const DELIVERY = FulfilmentMode.FULFILMENT_MODE_DELIVERY;
const PICKUP = FulfilmentMode.FULFILMENT_MODE_PICKUP;
const Rs = (rupees: number): number => rupees * 100;

// ------------------------------------------------------------------------------------------------
// Oracle: apps/customer/src/features/cart/totals.ts, copied verbatim (rupees, constants inlined).
// ------------------------------------------------------------------------------------------------
type OrderMode = "delivery" | "pickup";
function appComputeTotals(
  lines: { unitPrice: number; qty: number }[],
  restaurant: { deliveryFee: number; discountPercent?: number } | null,
  mode: OrderMode,
  extras: { promoDiscount?: number; tip?: number; credit?: number; plus?: boolean } = {},
) {
  const SMALL_ORDER_THRESHOLD = 500;
  const SMALL_ORDER_FEE = 60;
  const PLUS_FREE_DELIVERY_FROM = 1500;
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const saving = restaurant?.discountPercent ? Math.round((subtotal * restaurant.discountPercent) / 100) : 0;
  const plusWaives = !!extras.plus && subtotal >= PLUS_FREE_DELIVERY_FROM;
  const deliveryFee = mode === "delivery" && count > 0 && !plusWaives ? (restaurant?.deliveryFee ?? 0) : 0;
  const smallOrderFee = count > 0 && subtotal < SMALL_ORDER_THRESHOLD ? SMALL_ORDER_FEE : 0;
  const promoDiscount = Math.min(extras.promoDiscount ?? 0, subtotal - saving);
  const tip = mode === "delivery" ? Math.max(0, extras.tip ?? 0) : 0;
  const beforeCredit = subtotal - saving - promoDiscount + deliveryFee + smallOrderFee + tip;
  const credit = Math.min(Math.max(0, extras.credit ?? 0), beforeCredit);
  return {
    count,
    subtotal,
    saving,
    deliveryFee,
    smallOrderFee,
    promoDiscount,
    tip,
    credit,
    total: beforeCredit - credit,
  };
}

interface Case {
  name: string;
  lines: [unitPriceRs: number, qty: number][];
  mode?: FulfilmentMode;
  feeRs?: number;
  percent?: number;
  offerSavingRs?: number;
  freeDelivery?: boolean;
  plus?: boolean;
  promoRs?: number;
  tipRs?: number;
  creditRs?: number;
  expect: Partial<
    Record<
      | "count"
      | "subtotal"
      | "saving"
      | "deliveryFee"
      | "smallOrderFee"
      | "promoDiscount"
      | "tip"
      | "credit"
      | "total",
      number
    >
  >;
}

function input(c: Case): TotalsInput {
  return {
    lines: c.lines.map(([p, q]) => ({ unitPrice: Rs(p), quantity: q })),
    mode: c.mode ?? DELIVERY,
    deliveryFee: Rs(c.feeRs ?? 0),
    discountPercent: c.percent ?? 0,
    offerSaving: c.offerSavingRs === undefined ? undefined : Rs(c.offerSavingRs),
    freeDeliveryOffer: c.freeDelivery ?? false,
    smallOrderUnder: Rs(500),
    smallOrderFee: Rs(60),
    plusActive: c.plus ?? false,
    plusFreeDeliveryFrom: Rs(1500),
    promoDiscount: Rs(c.promoRs ?? 0),
    tip: Rs(c.tipRs ?? 0),
    creditAvailable: Rs(c.creditRs ?? 0),
  };
}

// Rupee expectations; every money field is checked in minor units (× 100).
const seedCart: Case["lines"] = [
  [140, 4], // Fish bun "No chilli"
  [120, 3], // Vegetable roti
  [160, 2], // Chicken patty
];

const cases: Case[] = [
  {
    name: "empty cart: nothing at all, not even the small-order fee",
    lines: [],
    feeRs: 120,
    expect: { count: 0, subtotal: 0, deliveryFee: 0, smallOrderFee: 0, total: 0 },
  },
  {
    name: "the app's seed cart (Kompanna Short Eats, Rs 120 delivery)",
    lines: seedCart,
    feeRs: 120,
    expect: { count: 9, subtotal: 1240, saving: 0, deliveryFee: 120, smallOrderFee: 0, tip: 0, total: 1360 },
  },
  {
    name: "checkout default tip Rs 100 is added for delivery",
    lines: seedCart,
    feeRs: 120,
    tipRs: 100,
    expect: { tip: 100, total: 1460 },
  },
  {
    name: "pickup: no delivery fee and no tip",
    lines: seedCart,
    feeRs: 120,
    tipRs: 100,
    mode: PICKUP,
    expect: { deliveryFee: 0, tip: 0, total: 1240 },
  },
  {
    name: "20% restaurant offer (Galle Road Kottu House, Rs 150 delivery)",
    lines: [[1150, 1]],
    feeRs: 150,
    percent: 20,
    expect: { subtotal: 1150, saving: 230, deliveryFee: 150, total: 1070 },
  },
  {
    name: "percent rounds to whole rupees: 15% of 1,235 = 185.25 → 185",
    lines: [[1235, 1]],
    percent: 15,
    expect: { saving: 185 },
  },
  {
    name: "percent rounds half up: 15% of 1,230 = 184.5 → 185",
    lines: [[615, 2]],
    percent: 15,
    expect: { saving: 185 },
  },
  {
    name: "percent rounds down below half: 10% of 1,234 = 123.4 → 123",
    lines: [[1234, 1]],
    percent: 10,
    expect: { saving: 123 },
  },
  {
    name: "small order under Rs 500 pays Rs 60",
    lines: [[450, 1]],
    feeRs: 100,
    expect: { smallOrderFee: 60, total: 610 },
  },
  {
    name: "exactly Rs 500 pays no small-order fee",
    lines: [[250, 2]],
    feeRs: 100,
    expect: { smallOrderFee: 0, total: 600 },
  },
  {
    name: "small-order fee also applies to pickup",
    lines: [[300, 1]],
    mode: PICKUP,
    expect: { smallOrderFee: 60, total: 360 },
  },
  {
    name: "small-order threshold uses the subtotal before the restaurant saving",
    lines: [[550, 1]],
    percent: 20,
    expect: { saving: 110, smallOrderFee: 0, total: 440 },
  },
  {
    name: "Plus waives delivery from Rs 1,500",
    lines: [[750, 2]],
    feeRs: 150,
    plus: true,
    expect: { deliveryFee: 0, total: 1500 },
  },
  {
    name: "Plus below Rs 1,500 still pays delivery",
    lines: [[1499, 1]],
    feeRs: 150,
    plus: true,
    expect: { deliveryFee: 150, total: 1649 },
  },
  {
    name: "Plus threshold uses the subtotal before saving",
    lines: [[1500, 1]],
    feeRs: 150,
    plus: true,
    percent: 50,
    expect: { saving: 750, deliveryFee: 0, total: 750 },
  },
  {
    name: "non-members pay delivery at any size",
    lines: [[2000, 1]],
    feeRs: 150,
    expect: { deliveryFee: 150, total: 2150 },
  },
  {
    name: "Plus does not waive the small-order fee",
    lines: [[400, 1]],
    feeRs: 150,
    plus: true,
    expect: { deliveryFee: 150, smallOrderFee: 60, total: 610 },
  },
  {
    name: "promo applied in full when the food covers it",
    lines: [[1200, 1]],
    feeRs: 100,
    promoRs: 100,
    expect: { promoDiscount: 100, total: 1200 },
  },
  {
    name: "promo capped at the food (subtotal)",
    lines: [[400, 1]],
    feeRs: 100,
    promoRs: 500,
    expect: { promoDiscount: 400, smallOrderFee: 60, total: 160 },
  },
  {
    name: "promo capped at subtotal − saving",
    lines: [[1000, 1]],
    percent: 20,
    promoRs: 900,
    expect: { saving: 200, promoDiscount: 800, total: 0 },
  },
  {
    name: "credit covers part of the bill",
    lines: [[1000, 1]],
    feeRs: 150,
    creditRs: 300,
    expect: { credit: 300, total: 850 },
  },
  {
    name: "credit never exceeds the bill",
    lines: [[200, 1]],
    feeRs: 100,
    tipRs: 40,
    creditRs: 5000,
    expect: { smallOrderFee: 60, credit: 400, total: 0 },
  },
  {
    name: "credit covers tip and fees too",
    lines: [[1000, 1]],
    feeRs: 150,
    tipRs: 200,
    promoRs: 100,
    creditRs: 2000,
    expect: { credit: 1250, total: 0 },
  },
  {
    name: "negative tip and credit count as zero",
    lines: [[1000, 1]],
    feeRs: 150,
    tipRs: -50,
    creditRs: -10,
    expect: { tip: 0, credit: 0, total: 1150 },
  },
  {
    name: "everything at once",
    lines: [
      [480, 2],
      [160, 3],
    ],
    feeRs: 180,
    percent: 10,
    promoRs: 150,
    tipRs: 100,
    creditRs: 200,
    expect: {
      count: 5,
      subtotal: 1440,
      saving: 144,
      deliveryFee: 180,
      smallOrderFee: 0,
      promoDiscount: 150,
      tip: 100,
      credit: 200,
      total: 1226,
    },
  },
  // Proto extensions beyond totals.ts (no oracle):
  {
    name: "offer_saving replaces the percent",
    lines: [[1000, 1]],
    percent: 20,
    offerSavingRs: 300,
    expect: { saving: 300, total: 700 },
  },
  {
    name: "offer_saving is capped at the subtotal",
    lines: [[1000, 1]],
    offerSavingRs: 2000,
    expect: { saving: 1000, total: 0 },
  },
  {
    name: "free-delivery offer waives the fee",
    lines: [[1000, 1]],
    feeRs: 150,
    freeDelivery: true,
    expect: { deliveryFee: 0, total: 1000 },
  },
];

describe("computeTotals (port of the customer app's totals.ts)", () => {
  it.each(cases)("$name", (c) => {
    const got = computeTotals(input(c));
    for (const [field, rupees] of Object.entries(c.expect)) {
      const expected = field === "count" ? rupees : Rs(rupees);
      expect(got[field as keyof typeof got], field).toBe(expected);
    }
    if (c.offerSavingRs === undefined && !c.freeDelivery) {
      const app = appComputeTotals(
        c.lines.map(([unitPrice, qty]) => ({ unitPrice, qty })),
        { deliveryFee: c.feeRs ?? 0, discountPercent: c.percent },
        c.mode === PICKUP ? "pickup" : "delivery",
        { promoDiscount: c.promoRs, tip: c.tipRs, credit: c.creditRs, plus: c.plus },
      );
      expect(toRupees(got)).toEqual(app);
    }
  });

  it("matches the app's function on 5,000 random carts", () => {
    let seed = 42;
    const rand = (n: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 5_000; i++) {
      const lines = Array.from({ length: rand(5) }, () => ({ unitPrice: 20 + rand(2500), qty: 1 + rand(6) }));
      const restaurant = { deliveryFee: rand(400), discountPercent: rand(3) === 0 ? rand(60) : 0 };
      const mode: OrderMode = rand(4) === 0 ? "pickup" : "delivery";
      const extras = {
        promoDiscount: rand(3) === 0 ? rand(1500) : 0,
        tip: rand(4) === 0 ? rand(500) - 100 : 0,
        credit: rand(3) === 0 ? rand(3000) : 0,
        plus: rand(2) === 0,
      };
      const ours = computeTotals({
        lines: lines.map((l) => ({ unitPrice: Rs(l.unitPrice), quantity: l.qty })),
        mode: mode === "pickup" ? PICKUP : DELIVERY,
        deliveryFee: Rs(restaurant.deliveryFee),
        discountPercent: restaurant.discountPercent,
        freeDeliveryOffer: false,
        smallOrderUnder: Rs(500),
        smallOrderFee: Rs(60),
        plusActive: extras.plus,
        plusFreeDeliveryFrom: Rs(1500),
        promoDiscount: Rs(extras.promoDiscount),
        tip: Rs(extras.tip),
        creditAvailable: Rs(extras.credit),
      });
      expect(toRupees(ours)).toEqual(appComputeTotals(lines, restaurant, mode, extras));
    }
  });
});

function toRupees(t: ReturnType<typeof computeTotals>) {
  return {
    count: t.count,
    subtotal: t.subtotal / 100,
    saving: t.saving / 100,
    deliveryFee: t.deliveryFee / 100,
    smallOrderFee: t.smallOrderFee / 100,
    promoDiscount: t.promoDiscount / 100,
    tip: t.tip / 100,
    credit: t.credit / 100,
    total: t.total / 100,
  };
}
