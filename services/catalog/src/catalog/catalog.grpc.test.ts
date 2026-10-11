import { LineProblem } from "@kade/proto/kade/catalog/v1/catalog_service";
import { describe, expect, it } from "vitest";
import { paginate, validateLine } from "./catalog.grpc.js";
import type { OptionGroupRow } from "./model.js";
import { itemRow } from "./model.test.js";

const now = new Date("2026-10-12T13:00:00+05:30");
const spice: OptionGroupRow = {
  id: "g1",
  restaurantId: "r",
  slug: "spice",
  name: "Spice level",
  required: true,
  maxChoices: 1,
  position: 0,
  choices: [
    { id: "c1", name: "Mild", priceMinor: 0 },
    { id: "c2", name: "Medium", priceMinor: 0 },
  ],
};
const extras: OptionGroupRow = {
  id: "g2",
  restaurantId: "r",
  slug: "kottuExtras",
  name: "Extras",
  required: false,
  maxChoices: 2,
  position: 1,
  choices: [
    { id: "e1", name: "Extra egg", priceMinor: 15_000 },
    { id: "e2", name: "Extra cheese", priceMinor: 25_000 },
    { id: "e3", name: "Extra chicken", priceMinor: 35_000 },
  ],
};
const kottu = itemRow({ id: "i1", optionGroupIds: ["g1", "g2"] });
const items = new Map([
  ["i1", kottu],
  ["i2", itemRow({ id: "i2", name: "String hopper kottu", soldOut: true })],
]);
const groups = new Map([
  ["g1", spice],
  ["g2", extras],
]);
const check = (line: {
  itemId: string;
  quantity?: number;
  options?: { optionGroupId: string; choiceId: string }[];
}) => validateLine({ lineKey: "k", quantity: 1, options: [], ...line }, items, groups, [spice, extras], now);

describe("validateLine", () => {
  it("prices the item plus paid options, names choices in menu order, accepts names or slugs", () => {
    const line = check({
      itemId: "i1",
      quantity: 2,
      options: [
        { optionGroupId: "g2", choiceId: "e2" },
        { optionGroupId: "spice", choiceId: "medium" },
        { optionGroupId: "g2", choiceId: "Extra egg" },
      ],
    });
    expect(line).toMatchObject({
      problem: LineProblem.LINE_PROBLEM_UNSPECIFIED,
      unitPrice: { amountMinor: 115_000 + 15_000 + 25_000 },
      choiceNames: ["Medium", "Extra egg", "Extra cheese"],
      quantity: 2,
      name: "Chicken kottu",
    });
  });

  it.each([
    [{ itemId: "nope" }, LineProblem.LINE_PROBLEM_ITEM_NOT_FOUND],
    [{ itemId: "i2" }, LineProblem.LINE_PROBLEM_SOLD_OUT],
    [{ itemId: "i1", quantity: 0 }, LineProblem.LINE_PROBLEM_QUANTITY_INVALID],
    [{ itemId: "i1" }, LineProblem.LINE_PROBLEM_REQUIRED_OPTION_MISSING],
    [
      { itemId: "i1", options: [{ optionGroupId: "g1", choiceId: "hot" }] },
      LineProblem.LINE_PROBLEM_OPTION_INVALID,
    ],
    [
      {
        itemId: "i1",
        options: [
          { optionGroupId: "g1", choiceId: "c1" },
          { optionGroupId: "g1", choiceId: "c2" },
        ],
      },
      LineProblem.LINE_PROBLEM_TOO_MANY_CHOICES,
    ],
  ])("flags %o as problem %i", (line, problem) => {
    const result = check(line);
    expect(result.problem).toBe(problem);
    expect(result.problemMessage).not.toBe("");
  });
});

describe("paginate", () => {
  it("pages with an opaque token", () => {
    const list = [...Array(5).keys()];
    const first = paginate(list, { pageSize: 2, pageToken: "" });
    expect(first.slice).toEqual([0, 1]);
    expect(first.page.totalSize).toBe(5);
    const second = paginate(list, { pageSize: 2, pageToken: first.page.nextPageToken });
    expect(second.slice).toEqual([2, 3]);
    const last = paginate(list, { pageSize: 2, pageToken: second.page.nextPageToken });
    expect(last).toMatchObject({ slice: [4], page: { nextPageToken: "" } });
    expect(() => paginate(list, { pageSize: 2, pageToken: "!!" })).toThrow();
  });
});
