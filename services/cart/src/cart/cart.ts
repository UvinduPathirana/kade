import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import type { SelectedOption } from "@kade/proto/kade/catalog/v1/catalog_service";
import type { Cart, CartLine, CheckoutOptions } from "@kade/proto/kade/cart/v1/cart_service";
import { failedPrecondition, invalidArgument, notFound } from "../platform/grpc/errors.js";

// Pure cart rules, mirroring apps/customer/src/features/cart/store.ts: one restaurant per cart,
// identical configurations merge into one line, quantity 0 removes a line.

export const MAX_LINE_QUANTITY = 99;
export const MAX_LINES = 50;
export const MAX_NOTE_LENGTH = 200;

export function defaultOptions(): CheckoutOptions {
  return {
    mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
    address: undefined,
    riderNote: "",
    kitchenNote: "",
    cutlery: false,
    scheduledFor: undefined,
    payment: undefined,
    promoCode: "",
    tip: undefined,
    useCredit: false,
    substitution: 0,
  };
}

export function emptyCart(customerId: string): Cart {
  return {
    customerId,
    restaurantId: "",
    restaurantName: "",
    lines: [],
    options: defaultOptions(),
    groupId: "",
    updatedAt: undefined,
    expiresAt: undefined,
  };
}

/** Choices sorted so the same configuration always has the same key, whatever order they came in. */
export function normaliseOptions(options: readonly SelectedOption[]): SelectedOption[] {
  const seen = new Set<string>();
  return [...options]
    .filter((o) => {
      const k = `${o.optionGroupId}:${o.choiceId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.optionGroupId.localeCompare(b.optionGroupId) || a.choiceId.localeCompare(b.choiceId));
}

/** Stable key: item id + option choice ids + note (the app's store uses item + choices + note too). */
export function lineKey(itemId: string, options: readonly SelectedOption[], note: string): string {
  return [itemId, ...normaliseOptions(options).map((o) => o.choiceId), note].join("|");
}

export function normaliseNote(note: string | undefined): string {
  const trimmed = (note ?? "").trim().replace(/\s+/g, " ");
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw invalidArgument("NOTE_TOO_LONG", `Keep the note under ${MAX_NOTE_LENGTH} characters.`);
  }
  return trimmed;
}

export function checkQuantity(quantity: number, { allowZero }: { allowZero: boolean }): void {
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(quantity) || quantity < min || quantity > MAX_LINE_QUANTITY) {
    throw invalidArgument(
      "QUANTITY_INVALID",
      `Choose a quantity from ${min === 0 ? 1 : min} to ${MAX_LINE_QUANTITY}.`,
    );
  }
}

export const otherRestaurant = (cart: Cart, restaurantId: string): boolean =>
  cart.lines.length > 0 && cart.restaurantId !== restaurantId;

export function otherRestaurantError(cart: Cart) {
  return failedPrecondition(
    "CART_OTHER_RESTAURANT",
    `Your cart has dishes from ${cart.restaurantName || "another restaurant"}. Start a new order to add this one.`,
    { restaurant_id: cart.restaurantId, restaurant_name: cart.restaurantName },
  );
}

export interface NewLine {
  restaurantId: string;
  restaurantName: string;
  line: CartLine;
  replace: boolean;
}

/** Adds (or merges) a line. Throws CART_OTHER_RESTAURANT unless `replace`. */
export function addLine(cart: Cart, { restaurantId, restaurantName, line, replace }: NewLine): Cart {
  const switching = otherRestaurant(cart, restaurantId);
  if (switching && !replace) throw otherRestaurantError(cart);
  const sameRestaurant = cart.restaurantId === restaurantId;
  const lines = sameRestaurant && !switching ? [...cart.lines] : [];

  const index = lines.findIndex((l) => l.key === line.key);
  if (index >= 0) {
    const existing = lines[index]!;
    const quantity = existing.quantity + line.quantity;
    if (quantity > MAX_LINE_QUANTITY) {
      throw invalidArgument("QUANTITY_INVALID", `You can order up to ${MAX_LINE_QUANTITY} of one dish.`);
    }
    // Refresh the display snapshot from the menu we just validated against.
    lines[index] = { ...line, quantity };
  } else {
    if (lines.length >= MAX_LINES) {
      throw failedPrecondition("CART_FULL", `A cart can hold up to ${MAX_LINES} different dishes.`);
    }
    lines.push(line);
  }

  const options = cart.options ?? defaultOptions();
  return {
    ...cart,
    restaurantId,
    restaurantName,
    lines,
    // A new restaurant: drop the group order and the promo code (codes are often restaurant-specific).
    groupId: sameRestaurant ? cart.groupId : "",
    options: sameRestaurant ? options : { ...options, promoCode: "" },
  };
}

function findLine(cart: Cart, key: string): number {
  const index = cart.lines.findIndex((l) => l.key === key);
  if (index < 0)
    throw notFound("CART_LINE_NOT_FOUND", "That dish isn't in your cart any more.", { line_key: key });
  return index;
}

/** Sets a quantity (0 removes) and optionally the note; a changed note can merge with an identical line. */
export function updateLine(cart: Cart, key: string, quantity: number, note?: string): Cart {
  const index = findLine(cart, key);
  if (quantity === 0) return removeLine(cart, key);
  const current = cart.lines[index]!;
  const nextNote = note === undefined ? current.note : note;
  const nextKey = lineKey(current.itemId, current.options, nextNote);
  const lines = [...cart.lines];
  const twin = nextKey === key ? -1 : lines.findIndex((l) => l.key === nextKey);
  if (twin >= 0) {
    const merged = lines[twin]!.quantity + quantity;
    if (merged > MAX_LINE_QUANTITY) {
      throw invalidArgument("QUANTITY_INVALID", `You can order up to ${MAX_LINE_QUANTITY} of one dish.`);
    }
    lines[twin] = { ...lines[twin]!, quantity: merged };
    lines.splice(index, 1);
  } else {
    lines[index] = { ...current, key: nextKey, note: nextNote, quantity };
  }
  return { ...cart, lines };
}

/** Removes a line; removing one that isn't there is a no-op (safe to retry). */
export function removeLine(cart: Cart, key: string): Cart {
  const lines = cart.lines.filter((l) => l.key !== key);
  if (lines.length > 0) return { ...cart, lines };
  return clearLines(cart);
}

/** Empties the cart but keeps the customer's checkout choices (mode, address, payment, tip). */
export function clearLines(cart: Cart): Cart {
  const options = cart.options ?? defaultOptions();
  return {
    ...cart,
    restaurantId: "",
    restaurantName: "",
    lines: [],
    groupId: "",
    options: { ...options, promoCode: "", scheduledFor: undefined },
  };
}
