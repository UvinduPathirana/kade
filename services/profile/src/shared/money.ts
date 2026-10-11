import type { Money } from "@kade/proto/kade/common/v1/money";
import { invalidArgument } from "../platform/grpc/errors.js";

export const lkr = (amountMinor: number): Money => ({ amountMinor, currency: "LKR" });

/** Validates a Money from a request: LKR, integer minor units. Missing = undefined. */
export function readMoney(m: Money | undefined, field: string): number | undefined {
  if (!m) return undefined;
  if (m.currency && m.currency !== "LKR") {
    throw invalidArgument("CURRENCY_UNSUPPORTED", "Only LKR is supported.", { field: `${field}.currency` });
  }
  if (!Number.isSafeInteger(m.amountMinor)) {
    throw invalidArgument("AMOUNT_INVALID", "Amount must be a whole number of cents.", { field });
  }
  return m.amountMinor;
}

/** "Rs 1,150" for labels (whole rupees, as the apps show). */
export function formatRs(amountMinor: number): string {
  const rupees = Math.round(Math.abs(amountMinor) / 100);
  return `Rs ${rupees.toLocaleString("en-US")}`;
}
