import type { Money } from "@kade/proto/kade/common/v1/money";

// Services speak Money in minor units (cents); the apps show whole rupees ("Rs 1,150").
// The conversion lives here, at the edge, and nowhere else.

/** Minor units -> whole rupees. LKR prices are whole rupees; stray cents round half up. */
export function toRupees(money: Money | undefined): number {
  return Math.round((money?.amountMinor ?? 0) / 100);
}

/** Whole rupees from an app -> Money. */
export function fromRupees(rupees: number): Money {
  if (!Number.isSafeInteger(rupees)) throw new RangeError("rupees must be a whole number");
  return { amountMinor: rupees * 100, currency: "LKR" };
}
