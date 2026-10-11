import { describe, expect, it } from "vitest";
import { normalise, prefixQuery, queryWords, restaurantSearchText } from "./text.js";

describe("text", () => {
  it("normalises like the app, and drops apostrophes", () => {
    expect(normalise("  Kadé   Market ")).toBe("kade market");
    expect(normalise("Amma's Rice & Curry")).toBe("ammas rice & curry");
  });

  it("keeps only safe query words and makes every word a required prefix", () => {
    expect(queryWords("Fish  buns!")).toEqual(["fish", "buns"]);
    expect(queryWords("a:*|b & c")).toEqual(["a", "b", "c"]);
    expect(queryWords("   ")).toEqual([]);
    expect(prefixQuery(["fish", "buns"])).toBe("fish:* & buns:*");
  });

  it("indexes restaurants by name, cuisine, category label and area", () => {
    expect(
      restaurantSearchText({
        name: "Amma's",
        cuisine: "Rice and curry",
        categoryId: "rice",
        area: "Bambalapitiya",
      }),
    ).toBe("ammas rice and curry rice & curry bambalapitiya");
  });
});
