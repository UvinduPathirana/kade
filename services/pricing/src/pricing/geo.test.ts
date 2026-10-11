import { describe, expect, it } from "vitest";
import { BAMBALAPITIYA, fixtureRules, KANDY, KOLLUPITIYA, MOUNT_LAVINIA } from "./fixtures.test-helpers.js";
import { boundary, haversineKm, isSet, resolveZone, roundKm } from "./geo.js";

const { zones } = fixtureRules();

describe("geo", () => {
  it("measures straight-line km", () => {
    expect(roundKm(haversineKm(KOLLUPITIYA, BAMBALAPITIYA))).toBe(2);
    expect(haversineKm(KOLLUPITIYA, KOLLUPITIYA)).toBe(0);
  });

  it("resolves the nearest zone centre within its radius", () => {
    expect(resolveZone(zones, KOLLUPITIYA)?.id).toBe("c03");
    expect(resolveZone(zones, { lat: 6.895, lng: 79.855 })?.id).toBe("c04");
    expect(resolveZone(zones, MOUNT_LAVINIA)?.id).toBe("mtl"); // closed zones still resolve
    expect(resolveZone(zones, KANDY)).toBeUndefined();
    expect(resolveZone(zones, { lat: 0, lng: 0 })).toBeUndefined();
    expect(resolveZone(zones, undefined)).toBeUndefined();
  });

  it("treats (0, 0) as unset", () => {
    expect(isSet({ lat: 0, lng: 0 })).toBe(false);
    expect(isSet(KOLLUPITIYA)).toBe(true);
  });

  it("draws a ring whose points resolve back to the zone", () => {
    const ring = boundary(zones[0]!);
    expect(ring).toHaveLength(16);
    for (const p of ring) expect(haversineKm(zones[0]!.center, p)).toBeCloseTo(3, 1);
  });
});
