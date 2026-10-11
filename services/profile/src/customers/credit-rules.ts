import { CreditReason } from "@kade/proto/kade/profile/v1/profile_service";
import { invalidArgument } from "../platform/grpc/errors.js";

/** Largest single movement we accept (Rs 1,000,000): a typo guard, not a business limit. */
export const MAX_CREDIT_MOVE_MINOR = 100_000_000;

const ADDS = new Set([
  CreditReason.CREDIT_REASON_ORDER_SPEND_REVERSED,
  CreditReason.CREDIT_REASON_REFUND,
  CreditReason.CREDIT_REASON_GOODWILL,
  CreditReason.CREDIT_REASON_GIFT_CARD,
  CreditReason.CREDIT_REASON_REFERRAL,
]);

export const DEFAULT_LABELS: Partial<Record<CreditReason, string>> = {
  [CreditReason.CREDIT_REASON_ORDER_SPEND]: "Used on an order",
  [CreditReason.CREDIT_REASON_ORDER_SPEND_REVERSED]: "Order didn't go through, credit returned",
  [CreditReason.CREDIT_REASON_REFUND]: "Refund",
  [CreditReason.CREDIT_REASON_GOODWILL]: "From Kadé support",
  [CreditReason.CREDIT_REASON_GIFT_CARD]: "Gift card",
  [CreditReason.CREDIT_REASON_REFERRAL]: "Referral reward",
  [CreditReason.CREDIT_REASON_ADJUSTMENT]: "Adjustment",
};

/**
 * Sign rules per reason: ORDER_SPEND is negative, ADJUSTMENT either sign, everything else adds.
 * ORDER_SPEND and its reversal need the order id (the reversal is matched to the spend by it).
 */
export function validateCreditChange(input: {
  amountMinor: number;
  reason: CreditReason;
  orderId: string;
}): void {
  const { amountMinor, reason, orderId } = input;
  if (!(reason in DEFAULT_LABELS)) {
    throw invalidArgument("CREDIT_REASON_REQUIRED", "Say why the credit changes.", { field: "reason" });
  }
  if (amountMinor === 0) {
    throw invalidArgument("AMOUNT_INVALID", "Amount can't be zero.", { field: "amount" });
  }
  if (Math.abs(amountMinor) > MAX_CREDIT_MOVE_MINOR) {
    throw invalidArgument("AMOUNT_INVALID", "That amount is too large.", { field: "amount" });
  }
  if (reason === CreditReason.CREDIT_REASON_ORDER_SPEND && amountMinor > 0) {
    throw invalidArgument("AMOUNT_SIGN_INVALID", "Spending credit takes a negative amount.", {
      field: "amount",
    });
  }
  if (ADDS.has(reason) && amountMinor < 0) {
    throw invalidArgument("AMOUNT_SIGN_INVALID", "This kind of credit takes a positive amount.", {
      field: "amount",
    });
  }
  if (
    (reason === CreditReason.CREDIT_REASON_ORDER_SPEND ||
      reason === CreditReason.CREDIT_REASON_ORDER_SPEND_REVERSED) &&
    !orderId.trim()
  ) {
    throw invalidArgument("ORDER_ID_REQUIRED", "order_id is required for order spends.", {
      field: "order_id",
    });
  }
}

/** What a customer may do to their own wallet (spend at checkout, and the saga's reversal). */
export const CUSTOMER_SELF_REASONS = new Set([
  CreditReason.CREDIT_REASON_ORDER_SPEND,
  CreditReason.CREDIT_REASON_ORDER_SPEND_REVERSED,
]);
