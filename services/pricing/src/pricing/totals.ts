import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import { percentOf } from "./money.js";

// THE price formula: a line-for-line port of apps/customer/src/features/cart/totals.ts, in minor
// units. Keep the two in step; totals.test.ts runs the app's function as an oracle.

export interface TotalsLine {
  unitPrice: number;
  quantity: number;
}

export interface TotalsInput {
  lines: readonly TotalsLine[];
  mode: FulfilmentMode;
  /** The zone fee for this delivery (base + distance + surcharges), before any waiver. */
  deliveryFee: number;
  /** Restaurant percent offer (0 = none). */
  discountPercent: number;
  /** Non-percent restaurant offer saving; when set it replaces the percent formula. */
  offerSaving?: number;
  freeDeliveryOffer: boolean;
  smallOrderUnder: number;
  smallOrderFee: number;
  plusActive: boolean;
  plusFreeDeliveryFrom: number;
  promoDiscount: number;
  tip: number;
  creditAvailable: number;
}

export interface TotalsResult {
  count: number;
  subtotal: number;
  saving: number;
  deliveryFee: number;
  smallOrderFee: number;
  promoDiscount: number;
  tip: number;
  credit: number;
  total: number;
  plusWaives: boolean;
}

export function computeTotals(input: TotalsInput): TotalsResult {
  const delivery = input.mode === FulfilmentMode.FULFILMENT_MODE_DELIVERY;
  const count = input.lines.reduce((s, l) => s + l.quantity, 0);
  const subtotal = input.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const saving =
    input.offerSaving !== undefined
      ? Math.min(Math.max(0, input.offerSaving), subtotal)
      : input.discountPercent
        ? percentOf(subtotal, input.discountPercent)
        : 0;
  const plusWaives = input.plusActive && subtotal >= input.plusFreeDeliveryFrom;
  const deliveryFee =
    delivery && count > 0 && !plusWaives && !input.freeDeliveryOffer ? input.deliveryFee : 0;
  const smallOrderFee = count > 0 && subtotal < input.smallOrderUnder ? input.smallOrderFee : 0;
  // A promo can't take the food below zero
  const promoDiscount = Math.min(Math.max(0, input.promoDiscount), subtotal - saving);
  const tip = delivery ? Math.max(0, input.tip) : 0;
  const beforeCredit = subtotal - saving - promoDiscount + deliveryFee + smallOrderFee + tip;
  // Credit covers up to the whole bill, never more
  const credit = Math.min(Math.max(0, input.creditAvailable), beforeCredit);
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
    plusWaives,
  };
}
