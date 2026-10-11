import { describe, expect, it } from "vitest";
import { distanceKm, roundKm } from "./geo.js";
import { menuItemId, optionGroupId, parseRestaurantRef, restaurantId } from "./ids.js";
import {
  menuTemplates,
  OPTION_GROUP_ORDER,
  seedCategories,
  seedOptionGroups,
  seedRestaurants,
} from "./seed-data.js";
import { placeRestaurant, REFERENCE_LOCATION } from "./seeder.js";

describe("seeded ids (CONVENTIONS.md)", () => {
  it("encodes the apps' numbers in decimal", () => {
    expect(restaurantId(1)).toBe("00000000-0000-7000-8000-000000000001");
    expect(restaurantId(16)).toBe("00000000-0000-7000-8000-000000000016");
    expect(parseInt(restaurantId(16).slice(-12), 10)).toBe(16);
    expect(menuItemId(1, 0, 0)).toBe("00000000-0000-7000-8010-000100000000");
    expect(menuItemId(15, 6, 3)).toBe("00000000-0000-7000-8010-001500060003");
    expect(optionGroupId(1, 2)).toBe("00000000-0000-7000-8012-000001000002");
  });

  it("accepts a UUID or a bare number as a restaurant reference", () => {
    expect(parseRestaurantRef("16")).toEqual({ legacyId: 16 });
    expect(parseRestaurantRef(restaurantId(2).toUpperCase())).toEqual({ id: restaurantId(2) });
    expect(parseRestaurantRef("kottu")).toBeUndefined();
  });
});

describe("seed data", () => {
  it("has the mock's 16 restaurants and 13 categories", () => {
    expect(seedRestaurants.map((r) => r.id)).toEqual([...Array(16).keys()].map((i) => i + 1));
    expect(seedCategories).toHaveLength(13);
    for (const r of seedRestaurants) expect(seedCategories.some((c) => c.id === r.categoryId)).toBe(true);
  });

  it("places every restaurant at the mock's distance from Home", () => {
    for (const r of seedRestaurants) {
      expect(roundKm(distanceKm(REFERENCE_LOCATION, placeRestaurant(r)))).toBe(r.distanceKm);
    }
  });

  it("only references option groups that exist, and has 111 dishes across the templates", () => {
    const items = Object.values(menuTemplates).flatMap((t) => t.flatMap(([, i]) => i));
    expect(items).toHaveLength(111);
    for (const item of items) for (const o of item.options ?? []) expect(OPTION_GROUP_ORDER).toContain(o);
    expect(Object.keys(seedOptionGroups).sort()).toEqual([...OPTION_GROUP_ORDER].sort());
  });
});
