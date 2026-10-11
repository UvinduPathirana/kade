import { describe, expect, it } from "vitest";
import { fromRupees, toRupees } from "./money.js";

describe("money", () => {
  it("converts minor units to whole rupees and back", () => {
    expect(toRupees({ amountMinor: 115_000, currency: "LKR" })).toBe(1150);
    expect(fromRupees(1150)).toEqual({ amountMinor: 115_000, currency: "LKR" });
    expect(toRupees(undefined)).toBe(0);
  });

  it("rounds stray cents half up and refuses fractional rupees", () => {
    expect(toRupees({ amountMinor: 115_050, currency: "LKR" })).toBe(1151);
    expect(toRupees({ amountMinor: 115_049, currency: "LKR" })).toBe(1150);
    expect(() => fromRupees(10.5)).toThrow(RangeError);
  });
});
