import { status } from "@grpc/grpc-js";
import type { CartLine } from "@kade/proto/kade/cart/v1/cart_service";
import { describe, expect, it } from "vitest";
import { DomainError } from "../platform/grpc/errors.js";
import { addLine, clearLines, emptyCart, lineKey, normaliseNote, removeLine, updateLine } from "./cart.js";

const R1 = "00000000-0000-7000-8000-000000000003";
const R2 = "00000000-0000-7000-8000-000000000001";

const line = (itemId: string, quantity = 1, note = "", choiceIds: string[] = []): CartLine => {
  const options = choiceIds.map((c) => ({ optionGroupId: "g", choiceId: c }));
  return {
    key: lineKey(itemId, options, note),
    itemId,
    name: itemId,
    unitPrice: { amountMinor: 140_00, currency: "LKR" },
    quantity,
    options,
    choiceNames: [],
    note,
    imageId: "",
  };
};

function reason(fn: () => unknown): [status, string] {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return [(e as DomainError).code, (e as DomainError).reason];
  }
  throw new Error("expected a DomainError");
}

const add = (cart = emptyCart("c1"), l = line("fish-bun"), restaurantId = R1, replace = false) =>
  addLine(cart, {
    restaurantId,
    restaurantName: restaurantId === R1 ? "Kompanna Short Eats" : "Galle Road Kottu House",
    line: l,
    replace,
  });

describe("line keys", () => {
  it("item + choices + note, choice order irrelevant", () => {
    const a = lineKey(
      "i",
      [
        { optionGroupId: "spice", choiceId: "hot" },
        { optionGroupId: "add", choiceId: "egg" },
      ],
      "No chilli",
    );
    const b = lineKey(
      "i",
      [
        { optionGroupId: "add", choiceId: "egg" },
        { optionGroupId: "spice", choiceId: "hot" },
      ],
      "No chilli",
    );
    expect(a).toBe(b);
    expect(a).toBe("i|egg|hot|No chilli");
    expect(lineKey("3-0-1", [], "")).toBe("3-0-1|");
  });
  it("notes are trimmed and capped", () => {
    expect(normaliseNote("  no   chilli ")).toBe("no chilli");
    expect(reason(() => normaliseNote("x".repeat(201)))).toEqual([status.INVALID_ARGUMENT, "NOTE_TOO_LONG"]);
  });
});

describe("addLine (store.ts add)", () => {
  it("first dish sets the restaurant", () => {
    const cart = add();
    expect(cart).toMatchObject({ restaurantId: R1, restaurantName: "Kompanna Short Eats" });
    expect(cart.lines).toHaveLength(1);
  });

  it("identical configurations merge; different notes or choices don't", () => {
    let cart = add(undefined, line("fish-bun", 2, "No chilli"));
    cart = add(cart, line("fish-bun", 2, "No chilli"));
    cart = add(cart, line("fish-bun", 1));
    cart = add(cart, line("fish-bun", 1, "", ["egg"]));
    expect(cart.lines.map((l) => [l.key, l.quantity])).toEqual([
      ["fish-bun|No chilli", 4],
      ["fish-bun|", 1],
      ["fish-bun|egg|", 1],
    ]);
  });

  it("another restaurant's dish is refused with CART_OTHER_RESTAURANT", () => {
    const cart = add();
    expect(reason(() => add(cart, line("kottu"), R2))).toEqual([
      status.FAILED_PRECONDITION,
      "CART_OTHER_RESTAURANT",
    ]);
  });

  it("replace starts a new cart and drops the group and promo", () => {
    const cart = { ...add(), groupId: "g1", options: { ...add().options!, promoCode: "KADE100" } };
    const next = add(cart, line("kottu"), R2, true);
    expect(next).toMatchObject({ restaurantId: R2, groupId: "", lines: [{ itemId: "kottu" }] });
    expect(next.options?.promoCode).toBe("");
  });

  it("an empty cart takes any restaurant without replace", () => {
    const cleared = clearLines(add());
    expect(add(cleared, line("kottu"), R2).restaurantId).toBe(R2);
  });

  it("caps quantities at 99", () => {
    const cart = add(undefined, line("fish-bun", 60));
    expect(reason(() => add(cart, line("fish-bun", 40)))).toEqual([
      status.INVALID_ARGUMENT,
      "QUANTITY_INVALID",
    ]);
  });
});

describe("updateLine / removeLine / clearLines (store.ts setQty, clear)", () => {
  it("sets the quantity; 0 removes the line", () => {
    let cart = add(add(), line("roti", 3));
    cart = updateLine(cart, "roti|", 5);
    expect(cart.lines.find((l) => l.itemId === "roti")?.quantity).toBe(5);
    cart = updateLine(cart, "roti|", 0);
    expect(cart.lines.map((l) => l.itemId)).toEqual(["fish-bun"]);
  });

  it("changing the note re-keys, and merges into an identical line", () => {
    let cart = add(add(undefined, line("fish-bun", 2, "No chilli")), line("fish-bun", 1));
    cart = updateLine(cart, "fish-bun|", 1, "No chilli");
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ key: "fish-bun|No chilli", quantity: 3 });
    cart = updateLine(cart, "fish-bun|No chilli", 3, "Extra sauce");
    expect(cart.lines[0]).toMatchObject({ key: "fish-bun|Extra sauce", note: "Extra sauce" });
  });

  it("unknown line → CART_LINE_NOT_FOUND", () => {
    expect(reason(() => updateLine(add(), "nope", 1))).toEqual([status.NOT_FOUND, "CART_LINE_NOT_FOUND"]);
  });

  it("removing the last line empties the restaurant; removing a missing line is a no-op", () => {
    const cart = removeLine(add(), "fish-bun|");
    expect(cart).toMatchObject({ restaurantId: "", restaurantName: "", lines: [] });
    expect(removeLine(add(), "nope").lines).toHaveLength(1);
  });

  it("clear keeps mode/address/tip but drops promo and schedule", () => {
    const base = add();
    const cart = clearLines({
      ...base,
      options: {
        ...base.options!,
        promoCode: "X",
        tip: { amountMinor: 100_00, currency: "LKR" },
        scheduledFor: new Date(),
      },
    });
    expect(cart.options).toMatchObject({
      promoCode: "",
      scheduledFor: undefined,
      tip: { amountMinor: 100_00 },
    });
  });
});
