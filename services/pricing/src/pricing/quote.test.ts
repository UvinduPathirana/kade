import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import { describe, expect, it } from "vitest";
import { colombo, fixtureRules, KANDY, KOLLUPITIYA, MOUNT_LAVINIA } from "./fixtures.test-helpers.js";
import { deliveryBreakdown, quoteCart, type QuoteInput } from "./quote.js";

const DELIVERY = FulfilmentMode.FULFILMENT_MODE_DELIVERY;
const PICKUP = FulfilmentMode.FULFILMENT_MODE_PICKUP;
const QUIET = colombo("2026-10-12T16:00"); // Monday afternoon: no surcharge
const DINNER = colombo("2026-10-12T20:00");
const rules = fixtureRules();
const c03 = rules.zones[0]!;

const base = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  restaurantId: "00000000-0000-7000-8000-000000000001",
  restaurantLocation: KOLLUPITIYA,
  mode: DELIVERY,
  lines: [{ lineKey: "a", unitPrice: 1_150_00, quantity: 1 }],
  deliverTo: { lat: 6.9105, lng: 79.8515 },
  discountPercent: 0,
  freeDeliveryOffer: false,
  promoDiscount: 0,
  tip: 0,
  creditAvailable: 0,
  plusActive: false,
  at: QUIET,
  ...over,
});

describe("deliveryBreakdown (port of the admin console's quoteDelivery)", () => {
  it("base covers the first 2 km", () => {
    expect(deliveryBreakdown(rules, c03, 1.2, QUIET)).toMatchObject({
      base: 100_00,
      distance: 0,
      total: 100_00,
    });
  });
  it("per km beyond 2 km, rounded to whole rupees", () => {
    // 3.5 km in Colombo 03: 1.5 × Rs 30 = Rs 45
    expect(deliveryBreakdown(rules, c03, 3.5, QUIET)).toMatchObject({
      distanceKm: 3.5,
      distance: 45_00,
      total: 145_00,
    });
    // 2.25 km shows as 2.3 km: 0.3 × Rs 30 = Rs 9
    expect(deliveryBreakdown(rules, c03, 2.25, QUIET)).toMatchObject({ distanceKm: 2.3, distance: 9_00 });
    // 4.45 km → 4.5 km: 2.5 × Rs 45 = Rs 112.5 → Rs 113
    const raj = { ...c03, perKm: 45_00 };
    expect(deliveryBreakdown(rules, raj, 4.45, QUIET).distance).toBe(113_00);
  });
  it("adds active surcharges and heavy rain, in rule order", () => {
    const rainy = fixtureRules({ weather: { enabled: true, amount: 50_00 } });
    expect(deliveryBreakdown(rainy, c03, 1, DINNER)).toMatchObject({
      surcharges: [
        { label: "Dinner peak", amount: 40_00 },
        { label: "Heavy rain", amount: 50_00 },
      ],
      total: 190_00,
    });
  });
});

describe("quoteCart", () => {
  it("delivery inside a zone: zone fee, no waiver", () => {
    const q = quoteCart(rules, base());
    expect(q.totals).toMatchObject({ subtotal: 1_150_00, deliveryFee: 100_00, total: 1_250_00 });
    expect(q.breakdown).toMatchObject({ zoneId: "c03", base: 100_00, total: 100_00 });
    expect(q).toMatchObject({ waiver: "none", outOfZone: false, rulesVersion: 7 });
  });

  it("surcharges flow into the delivery fee", () => {
    expect(quoteCart(rules, base({ at: DINNER })).totals.deliveryFee).toBe(140_00);
  });

  it("uses the delivery address's zone for the fee", () => {
    const q = quoteCart(rules, base({ deliverTo: { lat: 6.851, lng: 79.865 } }));
    expect(q.breakdown?.zoneId).toBe("deh");
    // 6.7 km from Kollupitiya: Rs 150 + round(4.7 × 40) = Rs 338
    expect(q.breakdown).toMatchObject({ distanceKm: 6.7, base: 150_00, distance: 188_00, total: 338_00 });
  });

  it("outside every zone: flagged, no fee", () => {
    const q = quoteCart(rules, base({ deliverTo: KANDY }));
    expect(q).toMatchObject({ outOfZone: true, breakdown: undefined });
    expect(q.totals.deliveryFee).toBe(0);
  });

  it("a closed zone counts as out of zone", () => {
    expect(quoteCart(rules, base({ deliverTo: MOUNT_LAVINIA })).outOfZone).toBe(true);
  });

  it("no address yet: the restaurant's zone at distance 0", () => {
    const q = quoteCart(rules, base({ deliverTo: undefined }));
    expect(q.breakdown).toMatchObject({ zoneId: "c03", distanceKm: 0, total: 100_00 });
  });

  it("pickup: no fee, no breakdown, waiver PICKUP, small order still applies", () => {
    const q = quoteCart(
      rules,
      base({ mode: PICKUP, lines: [{ lineKey: "a", unitPrice: 300_00, quantity: 1 }], tip: 100_00 }),
    );
    expect(q).toMatchObject({ waiver: "pickup", breakdown: undefined, outOfZone: false });
    expect(q.totals).toMatchObject({ deliveryFee: 0, smallOrderFee: 60_00, tip: 0, total: 360_00 });
  });

  it("pickup with no zone falls back to Rs 60 under Rs 500", () => {
    const q = quoteCart(
      rules,
      base({
        mode: PICKUP,
        restaurantLocation: KANDY,
        lines: [{ lineKey: "a", unitPrice: 100_00, quantity: 1 }],
      }),
    );
    expect(q.totals.smallOrderFee).toBe(60_00);
  });

  it("uses the zone's small-order rules", () => {
    const custom = fixtureRules();
    custom.zones[0] = { ...c03, smallOrderFee: 80_00, smallOrderUnder: 700_00 };
    const q = quoteCart(custom, base({ lines: [{ lineKey: "a", unitPrice: 600_00, quantity: 1 }] }));
    expect(q.totals.smallOrderFee).toBe(80_00);
  });

  it("Plus waiver: breakdown kept, fee zero, waiver PLUS", () => {
    const q = quoteCart(
      rules,
      base({ plusActive: true, lines: [{ lineKey: "a", unitPrice: 1_500_00, quantity: 1 }] }),
    );
    expect(q.waiver).toBe("plus");
    expect(q.totals.deliveryFee).toBe(0);
    expect(q.breakdown?.total).toBe(100_00);
  });

  it("free-delivery offer: waiver OFFER", () => {
    const q = quoteCart(rules, base({ freeDeliveryOffer: true }));
    expect(q).toMatchObject({ waiver: "offer", totals: { deliveryFee: 0, total: 1_150_00 } });
  });

  it("quote id is stable for the same inputs and changes with the rules version", () => {
    const a = quoteCart(rules, base()).quoteId;
    expect(quoteCart(rules, base()).quoteId).toBe(a);
    expect(quoteCart({ ...rules, rulesVersion: 8 }, base()).quoteId).not.toBe(a);
    expect(a).toMatch(/^q_[0-9a-f]{32}$/);
  });
});
