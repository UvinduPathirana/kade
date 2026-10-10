import type { OrderMode, OrderTotals } from "@/api/types";

/** Orders below this subtotal pay a small-order fee (stated on every restaurant page). */
export const SMALL_ORDER_THRESHOLD = 500;
export const SMALL_ORDER_FEE = 60;
/** Kadé Plus members pay no delivery fee from this subtotal up. */
export const PLUS_FREE_DELIVERY_FROM = 1500;

export interface CartTotals extends OrderTotals {
  count: number;
}

interface PricedLine {
  unitPrice: number;
  qty: number;
}

interface PricedRestaurant {
  deliveryFee: number;
  discountPercent?: number;
}

/**
 * One price calculation for the cart, the checkout preview and the order service, so the numbers a
 * person sees before paying are the numbers they're charged.
 */
export function computeTotals(
  lines: PricedLine[],
  restaurant: PricedRestaurant | null,
  mode: OrderMode,
  extras: { promoDiscount?: number; tip?: number; credit?: number; plus?: boolean } = {},
): CartTotals {
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const saving = restaurant?.discountPercent ? Math.round((subtotal * restaurant.discountPercent) / 100) : 0;
  const plusWaives = !!extras.plus && subtotal >= PLUS_FREE_DELIVERY_FROM;
  const deliveryFee = mode === "delivery" && count > 0 && !plusWaives ? (restaurant?.deliveryFee ?? 0) : 0;
  const smallOrderFee = count > 0 && subtotal < SMALL_ORDER_THRESHOLD ? SMALL_ORDER_FEE : 0;
  // A promo can't take the food below zero
  const promoDiscount = Math.min(extras.promoDiscount ?? 0, subtotal - saving);
  const tip = mode === "delivery" ? Math.max(0, extras.tip ?? 0) : 0;
  const beforeCredit = subtotal - saving - promoDiscount + deliveryFee + smallOrderFee + tip;
  // Credit covers up to the whole bill, never more
  const credit = Math.min(Math.max(0, extras.credit ?? 0), beforeCredit);
  return {
    count,
    subtotal,
    saving,
    deliveryFee,
    smallOrderFee,
    promoDiscount,
    tip,
    credit,
    total: beforeCredit - credit,
  };
}
