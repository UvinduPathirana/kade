// Plain-JSON types shared by the workflow (deterministic sandbox: no Node or proto runtime imports)
// and the activities. Enum values are the kade.order.v1 / kade.common.v1 numbers.

export const ORDER_WORKFLOW = "orderWorkflow";

export interface OrderWorkflowInput {
  orderId: string;
  /** Kitchen accept window (3 minutes by contract; shorter in tests). */
  acceptTimeoutMs: number;
}

export type WorkflowOutcome = "FAILED" | "REJECTED" | "CANCELLED" | "DELIVERED" | "COLLECTED";

export interface OrderWorkflowResult {
  outcome: WorkflowOutcome;
  reason?: string;
}

export interface StepFailure {
  ok: false;
  reason: string;
  message: string;
  metadata?: Record<string, string>;
}

export interface CheckoutPlan {
  ok: true;
  /** Empty = no voucher to reserve. */
  promoCode: string;
  promoDiscountMinor: number;
  /** Kadé credit to spend (minor units). */
  creditMinor: number;
  /** What card/cash pays after credit; 0 = nothing to authorise. */
  totalMinor: number;
  /** kade.common.v1.PaymentMethodKind. */
  paymentKind: number;
  /** ISO time the kitchen should get a scheduled order; unset = now. */
  releaseAt?: string;
}

export interface PromoReserved {
  ok: true;
  reservationId: string;
}

export interface PaymentAuthorised {
  ok: true;
  paymentId: string;
  /** "AUTHORISED" (card) or "CASH_DUE" (cash). */
  status: "AUTHORISED" | "CASH_DUE";
}

// ---- signals ----

export interface KitchenAcceptedSignal {
  prepMinutes: number;
  /** ISO. */
  readyBy?: string;
  by?: string;
}

export interface KitchenRejectedSignal {
  /** kade.order.v1.RejectionReason. */
  reason: number;
  note?: string;
  by?: string;
}

export interface CancelSignal {
  /** kade.order.v1.CancelledBy. */
  cancelledBy: number;
  reason: string;
  /** kade.order.v1.Fault. */
  fault: number;
  /** Ops: refund whatever hasn't been refunded yet. */
  refund: boolean;
  by: string;
}

export interface PickedUpSignal {
  riderId?: string;
  deliveryId?: string;
}

export interface DeliveredSignal {
  riderId?: string;
  deliveryId?: string;
  cashCollectedMinor?: number;
}

export interface CollectedSignal {
  by?: string;
}

/** What the `state` query returns: where the saga is, for the Temporal UI and debugging. */
export interface WorkflowState {
  stage: "checkout" | "scheduled" | "awaiting-kitchen" | "in-kitchen" | "picked-up" | "compensating" | "done";
  paymentId?: string;
  promoReservationId?: string;
  creditSpentMinor: number;
  captured: boolean;
  outcome?: WorkflowOutcome;
}
