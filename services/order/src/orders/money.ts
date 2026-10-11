import type { Money } from "@kade/proto/kade/common/v1/money";

export const lkr = (amountMinor: number): Money => ({ amountMinor, currency: "LKR" });

export const minor = (money: Money | undefined): number => money?.amountMinor ?? 0;

/** "Rs 1,150" — the apps' format (whole rupees). */
export function formatRs(amountMinor: number): string {
  const rupees = Math.round(amountMinor / 100);
  return `Rs ${rupees.toLocaleString("en-US")}`;
}
