import type { OrderMode } from "@/api/types";
import type { CartLine, CartRestaurant } from "./store";

export interface CartTotals {
  count: number;
  subtotal: number;
  /** Amount taken off by the restaurant's percentage offer. */
  saving: number;
  /** 0 for pickup and for restaurants with free delivery. */
  deliveryFee: number;
  total: number;
}

export function computeTotals(
  lines: CartLine[],
  restaurant: CartRestaurant | null,
  mode: OrderMode,
): CartTotals {
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const saving = restaurant?.discountPercent ? Math.round((subtotal * restaurant.discountPercent) / 100) : 0;
  const deliveryFee = mode === "delivery" && count > 0 ? (restaurant?.deliveryFee ?? 0) : 0;
  return { count, subtotal, saving, deliveryFee, total: subtotal - saving + deliveryFee };
}
