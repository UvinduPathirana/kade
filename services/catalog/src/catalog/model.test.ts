import { AvailabilityState, DishTag } from "@kade/proto/kade/catalog/v1/catalog_service";
import { describe, expect, it } from "vitest";
import type { HoursDay } from "../db/schema.js";
import {
  collectionLive,
  isSoldOut,
  matchesRule,
  slugify,
  toMenu,
  toRestaurant,
  type CollectionRow,
  type ItemRow,
  type RestaurantRow,
} from "./model.js";

const now = new Date("2026-10-12T13:00:00+05:30");
const hours: HoursDay[] = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
  day,
  isOpen: true,
  ranges: [{ open: "11:00", close: "02:00" }],
}));

export function restaurantRow(over: Partial<RestaurantRow> = {}): RestaurantRow {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    legacyId: 1,
    slug: "galle-road-kottu-house",
    name: "Galle Road Kottu House",
    kind: 1,
    categoryId: "kottu",
    cuisine: "Kottu",
    imageId: "img",
    etaMinMinutes: 15,
    etaMaxMinutes: 25,
    baseDeliveryFeeMinor: 15_000,
    rating: 4.8,
    ratingCount: 3000,
    priceLevel: 1,
    offerId: "",
    offerLabel: "20% off kottu",
    discountPercent: 20,
    freeDeliveryOffer: false,
    hasVegetarian: false,
    area: "Kollupitiya",
    address: "312 Galle Road",
    phone: "+94",
    lat: 6.9,
    lng: 79.85,
    zoneId: "c03",
    busyExtraMinutes: 0,
    pausedUntil: null,
    adminStatus: "open",
    adminStatusReason: "",
    hours,
    menuVersion: 3,
    menuUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

export function itemRow(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "i1",
    restaurantId: "r",
    sectionId: "s1",
    name: "Chicken kottu",
    description: "",
    priceMinor: 115_000,
    imageId: "",
    tags: [],
    optionGroupIds: [],
    popularRank: 0,
    soldOut: false,
    soldOutUntil: null,
    unit: "",
    position: 0,
    legacyId: null,
    ...over,
  };
}

describe("toRestaurant", () => {
  it("adds busy minutes to the ETA and reports availability and today's hours", () => {
    const r = toRestaurant(restaurantRow({ busyExtraMinutes: 10 }), [], now);
    expect(r).toMatchObject({ etaMinMinutes: 25, etaMaxMinutes: 35, hoursLabel: "11 am – 2 am" });
    expect(r.availability?.state).toBe(AvailabilityState.AVAILABILITY_STATE_OPEN);
  });

  it("uses pricing's fee, falls back to the stored fee, and charges nothing for free delivery or pickup", () => {
    expect(toRestaurant(restaurantRow(), [], now).deliveryFee?.amountMinor).toBe(15_000);
    expect(
      toRestaurant(restaurantRow(), [], now, { deliveryFeeMinor: 22_000 }).deliveryFee?.amountMinor,
    ).toBe(22_000);
    expect(toRestaurant(restaurantRow({ freeDeliveryOffer: true }), [], now).deliveryFee?.amountMinor).toBe(
      0,
    );
    expect(toRestaurant(restaurantRow(), [], now, { pickup: true }).deliveryFee?.amountMinor).toBe(0);
  });

  it("computes distance only for a real location and leaves customer fields out of events", () => {
    expect(toRestaurant(restaurantRow(), [], now).distanceKm).toBe(0);
    expect(toRestaurant(restaurantRow(), [], now, { deliverTo: { lat: 6.91, lng: 79.85 } }).distanceKm).toBe(
      1.1,
    );
    const event = toRestaurant(restaurantRow(), [], now, {
      forEvent: true,
      deliverTo: { lat: 6.91, lng: 79.85 },
    });
    expect(event.deliveryFee).toBeUndefined();
    expect(event.distanceKm).toBe(0);
  });
});

describe("menus", () => {
  it("orders sections and items by position and ranks popular dishes", () => {
    const menu = toMenu(
      {
        restaurant: restaurantRow(),
        sections: [
          { id: "s2", restaurantId: "r", name: "Drinks", position: 1 },
          { id: "s1", restaurantId: "r", name: "Kottu", position: 0 },
        ],
        items: [
          itemRow({ id: "b", sectionId: "s1", position: 1, popularRank: 2 }),
          itemRow({ id: "a", sectionId: "s1", position: 0, popularRank: 1, tags: [DishTag.DISH_TAG_SPICY] }),
          itemRow({ id: "c", sectionId: "s2", position: 0 }),
        ],
        groups: [],
      },
      now,
    );
    expect(menu.sections.map((s) => [s.name, s.items.map((i) => i.id)])).toEqual([
      ["Kottu", ["a", "b"]],
      ["Drinks", ["c"]],
    ]);
    expect(menu.popular.map((i) => i.id)).toEqual(["a", "b"]);
    expect(menu.version).toBe(3);
  });

  it("treats sold out as over once sold_out_until has passed", () => {
    expect(isSoldOut(itemRow({ soldOut: true }), now)).toBe(true);
    expect(isSoldOut(itemRow({ soldOut: true, soldOutUntil: new Date(now.getTime() + 1000) }), now)).toBe(
      true,
    );
    expect(isSoldOut(itemRow({ soldOut: true, soldOutUntil: new Date(now.getTime() - 1000) }), now)).toBe(
      false,
    );
  });
});

describe("collections", () => {
  const row = (over: Partial<CollectionRow>): CollectionRow => ({
    id: "c",
    title: "t",
    subtitle: "",
    placement: 1,
    source: 1,
    rule: {},
    restaurantIds: [],
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
    visible: true,
    position: 0,
    ...over,
  });

  it("runs between its dates while visible", () => {
    expect(collectionLive(row({}), "2026-10-12")).toBe(true);
    expect(collectionLive(row({ startsOn: "2026-10-17" }), "2026-10-12")).toBe(false);
    expect(collectionLive(row({ endsOn: "2026-10-11" }), "2026-10-12")).toBe(false);
    expect(collectionLive(row({ endsOn: "" }), "2027-01-01")).toBe(true);
    expect(collectionLive(row({ visible: false }), "2026-10-12")).toBe(false);
  });

  it("matches rules like the admin app does", () => {
    const r = toRestaurant(restaurantRow(), [], now);
    expect(matchesRule(r, { maxEtaMinutes: 20 })).toBe(true);
    expect(matchesRule(r, { maxEtaMinutes: 10 })).toBe(false);
    expect(matchesRule(r, { offersOnly: true, categoryId: "kottu", minRating: 4.7 })).toBe(true);
    expect(matchesRule(r, { categoryId: "rice" })).toBe(false);
  });
});

it("slugifies names", () => {
  expect(slugify("Amma's Rice & Curry")).toBe("ammas-rice-curry");
  expect(slugify("Kadé Market")).toBe("kade-market");
});
