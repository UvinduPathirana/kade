import { describe, expect, it } from "vitest";
import {
  breakdownOf,
  compliments,
  improvementTips,
  publicName,
  restaurantSummary,
  riderSummary,
  scaleTo,
  syntheticBreakdown,
  type Baseline,
} from "./ratings.js";

const nimal: Baseline = {
  count: 1280,
  starSum: 6275,
  breakdown: [91, 6, 2, 1, 0],
  compliments: [{ label: "Friendly", count: 214 }],
  improve: [{ label: "Keep drinks upright", detail: "..." }],
};

describe("summaries", () => {
  it("counts stars with 5 first", () => {
    expect(breakdownOf([5, 5, 4, 1, 0, 6])).toEqual([2, 1, 0, 0, 1]);
  });

  it("adds live ratings to a restaurant's history", () => {
    const base = { count: 10, starSum: 45, breakdown: [5, 5, 0, 0, 0], compliments: [], improve: [] };
    expect(restaurantSummary(base, [1])).toEqual({ average: 4.18, count: 11, breakdown: [5, 5, 0, 0, 1] });
    expect(restaurantSummary(undefined, [])).toEqual({ average: 0, count: 0, breakdown: [0, 0, 0, 0, 0] });
  });

  it("keeps the rider breakdown to the last 100 ratings", () => {
    const s = riderSummary(nimal, 4, 17, [5, 4, 5, 3]);
    expect(s.count).toBe(1284);
    expect(s.average).toBe(4.9);
    expect(s.breakdown.reduce((a, b) => a + b, 0)).toBe(100);
    const full = riderSummary(nimal, 150, 150, Array(150).fill(1));
    expect(full.breakdown).toEqual([0, 0, 0, 0, 100]);
  });

  it("scales counts exactly", () => {
    expect(scaleTo([91, 6, 2, 1, 0], 96).reduce((a, b) => a + b, 0)).toBe(96);
    expect(scaleTo([0, 0], 5)).toEqual([0, 0]);
  });

  it("builds seeded history close to the advertised average", () => {
    for (const [avg, count] of [
      [4.8, 3140],
      [4.3, 2170],
      [4.9, 1240],
    ] as const) {
      const { breakdown, starSum } = syntheticBreakdown(avg, count);
      expect(breakdown.reduce((a, b) => a + b, 0)).toBe(count);
      expect(Math.abs(starSum / count - avg)).toBeLessThan(0.01);
    }
  });
});

describe("rider feedback", () => {
  it("merges compliments and turns problems into tips", () => {
    expect(compliments(nimal, [["Friendly", "Late"], ["On time"]])).toEqual([
      { label: "Friendly", count: 215 },
      { label: "On time", count: 1 },
    ]);
    const tips = improvementTips(nimal, [["Late"], ["Late", "Didn't call"]]);
    expect(tips[0]).toEqual({
      label: "Head out as soon as the food is ready",
      detail: "2 customers said the order was late.",
    });
    expect(tips.at(-1)?.label).toBe("Keep drinks upright");
  });

  it("shows customers as first name and initial", () => {
    expect(publicName("Nadeesha Perera")).toBe("Nadeesha P.");
    expect(publicName("Shehani")).toBe("Shehani");
    expect(publicName(" ")).toBe("Kadé customer");
  });
});
