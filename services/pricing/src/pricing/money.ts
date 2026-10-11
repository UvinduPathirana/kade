import type { Money } from "@kade/proto/kade/common/v1/money";
import { invalidArgument } from "../platform/grpc/errors.js";

export const CURRENCY = "LKR";

export const lkr = (amountMinor: number): Money => ({ amountMinor, currency: CURRENCY });

/** Minor units of an optional Money; rejects other currencies (LKR is the only one today). */
export function minor(money: Money | undefined, field: string): number {
  if (!money) return 0;
  if (money.currency && money.currency !== CURRENCY) {
    throw invalidArgument("CURRENCY_UNSUPPORTED", "Only LKR amounts are supported.", { field });
  }
  if (!Number.isSafeInteger(money.amountMinor)) {
    throw invalidArgument("AMOUNT_INVALID", "That amount isn't valid.", { field });
  }
  return money.amountMinor;
}

/**
 * Rounds a minor-unit amount to whole rupees, half away from zero. totals.ts works in rupees and
 * uses Math.round, which for the non-negative amounts it sees is the same thing.
 */
export function roundToRupee(amountMinor: number): number {
  const rupees = Math.abs(amountMinor) / 100;
  // The epsilon absorbs float noise such as 12.499999999 from km × rate.
  const rounded = Math.floor(rupees + 0.5 + 1e-9);
  return (amountMinor < 0 ? -rounded : rounded) * 100 || 0;
}

/** round(subtotal × percent / 100) to whole rupees, in exact integer arithmetic. */
export function percentOf(subtotalMinor: number, percent: number): number {
  const scaled = subtotalMinor * percent; // = rupee amount × 10 000
  const sign = scaled < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(scaled) + 5_000) / 10_000) * 100 || 0;
}
