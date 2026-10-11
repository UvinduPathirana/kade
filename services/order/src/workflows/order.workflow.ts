// The order saga (proto/README.md "Order saga"). Workflow id = order id, task queue "order".
//
//   checkout ─ prepareCheckout → reservePromo → spendCredit → authorisePayment ─┬─ fail → FAILED
//                                                                               └─ markPlaced
//   scheduled? ─ sleep until kitchen start (cancel wakes it) → releaseToKitchen
//   kitchen ─ race: kitchenAccepted | kitchenRejected | cancel | 3-minute timer
//             reject/timeout → REJECTED, cancel → CANCELLED, then compensate
//   accepted ─ ACCEPTED+PREPARING, then ready / pickedUp (capture card) / delivered (record cash)
//              / collected (pickup) until DELIVERED or COLLECTED; ops cancel at any point.
//
// Compensations run after the decision is recorded (status first, so the customer sees it at once),
// with unlimited retries: void payment, release promo, reverse credit. Deterministic code only.
import { condition, log, proxyActivities, setHandler } from "@temporalio/workflow";
import type { OrderActivities } from "./activities.js";
import {
  cancelSignal,
  collectedSignal,
  deliveredSignal,
  kitchenAcceptedSignal,
  kitchenRejectedSignal,
  pickedUpSignal,
  readySignal,
  stateQuery,
} from "./signals.js";
import type {
  CancelSignal,
  CollectedSignal,
  DeliveredSignal,
  KitchenAcceptedSignal,
  KitchenRejectedSignal,
  OrderWorkflowInput,
  OrderWorkflowResult,
  PickedUpSignal,
  StepFailure,
  WorkflowState,
} from "./types.js";

// Enum numbers (the workflow sandbox does not load the proto runtime).
const CANCELLED_BY_CUSTOMER = 1;
const REJECTION_TIMEOUT = 5;
const PAYMENT_CASH = 2;

/** Saga steps PlaceOrder is waiting on: a few quick retries, then the checkout fails cleanly. */
const checkout = proxyActivities<OrderActivities>({
  startToCloseTimeout: "15s",
  retry: { initialInterval: "500ms", backoffCoefficient: 2, maximumInterval: "4s", maximumAttempts: 4 },
});
/** Our own state changes and compensations: must eventually happen, so retry until they do. */
const durable = proxyActivities<OrderActivities>({
  startToCloseTimeout: "15s",
  retry: { initialInterval: "1s", backoffCoefficient: 2, maximumInterval: "1m" },
});

const UNAVAILABLE: StepFailure = {
  ok: false,
  reason: "SERVICE_UNAVAILABLE",
  message: "We couldn't place your order right now and nothing was charged. Please try again.",
};

type FulfilmentStep =
  | { kind: "ready" }
  | { kind: "pickedUp"; signal: PickedUpSignal }
  | { kind: "delivered"; signal: DeliveredSignal }
  | { kind: "collected"; signal: CollectedSignal };

export async function orderWorkflow(input: OrderWorkflowInput): Promise<OrderWorkflowResult> {
  const { orderId, acceptTimeoutMs } = input;
  const state: WorkflowState = { stage: "checkout", creditSpentMinor: 0, captured: false };
  let paymentKind: number;
  let accepted: KitchenAcceptedSignal | undefined;
  let rejected: KitchenRejectedSignal | undefined;
  let cancel: CancelSignal | undefined;
  const steps: FulfilmentStep[] = [];
  const background: Promise<unknown>[] = [];

  setHandler(stateQuery, () => state);
  setHandler(kitchenAcceptedSignal, (s) => {
    if (!accepted && !rejected && !cancel) accepted = s;
  });
  setHandler(kitchenRejectedSignal, (s) => {
    if (!accepted && !rejected && !cancel) rejected = s;
  });
  setHandler(cancelSignal, (s) => {
    if (cancel || state.stage === "checkout" || state.stage === "compensating" || state.stage === "done")
      return;
    const beforeKitchen =
      state.stage === "scheduled" || (state.stage === "awaiting-kitchen" && !accepted && !rejected);
    // Customers may only cancel before the kitchen starts (CancelOrder rules); ops/system any time.
    if (s.cancelledBy === CANCELLED_BY_CUSTOMER && !beforeKitchen) return;
    cancel = s;
  });
  setHandler(readySignal, () => void steps.push({ kind: "ready" }));
  setHandler(pickedUpSignal, (signal) => void steps.push({ kind: "pickedUp", signal }));
  setHandler(deliveredSignal, (signal) => void steps.push({ kind: "delivered", signal }));
  setHandler(collectedSignal, (signal) => void steps.push({ kind: "collected", signal }));

  /** Gives back everything the checkout took that has not been captured. */
  async function compensate(reason: string): Promise<void> {
    state.stage = "compensating";
    const work: Promise<unknown>[] = [];
    if (state.paymentId && !state.captured) work.push(durable.voidPayment(orderId, state.paymentId, reason));
    if (state.promoReservationId) work.push(durable.releasePromo(orderId, state.promoReservationId, reason));
    if (state.creditSpentMinor > 0) work.push(durable.reverseCredit(orderId, state.creditSpentMinor));
    // Outages are retried inside each activity forever; a refusal (non-retryable) is logged for ops
    // rather than failing the whole order.
    for (const r of await Promise.allSettled(work)) {
      if (r.status === "rejected") log.error("compensation refused", { orderId, error: String(r.reason) });
    }
  }

  async function finish(result: OrderWorkflowResult): Promise<OrderWorkflowResult> {
    await Promise.all(background);
    state.stage = "done";
    state.outcome = result.outcome;
    return result;
  }

  async function failCheckout(failure: StepFailure): Promise<OrderWorkflowResult> {
    log.info("checkout failed", { orderId, reason: failure.reason });
    await durable.markFailed(orderId, failure.reason, failure.message);
    await compensate(`checkout failed: ${failure.reason}`);
    return finish({ outcome: "FAILED", reason: failure.reason });
  }

  async function cancelled(c: CancelSignal): Promise<OrderWorkflowResult> {
    await durable.markCancelled(orderId, c);
    if (state.captured) {
      if (c.refund) {
        await durable
          .refundRemaining(orderId, `Cancelled: ${c.reason}`, c.by)
          .catch((err: unknown) => log.error("refund on cancel refused", { orderId, error: String(err) }));
      }
    } else {
      await compensate(`cancelled: ${c.reason}`);
    }
    return finish({ outcome: "CANCELLED", reason: c.reason });
  }

  // ---- 1–3. Checkout: validate and price, reserve promo, spend credit, authorise payment ----
  let releaseAt: string | undefined;
  try {
    const plan = await checkout.prepareCheckout(orderId);
    if (!plan.ok) return await failCheckout(plan);
    paymentKind = plan.paymentKind;
    releaseAt = plan.releaseAt;

    if (plan.promoCode) {
      const promo = await checkout.reservePromo(orderId);
      if (!promo.ok) return await failCheckout(promo);
      state.promoReservationId = promo.reservationId;
    }
    if (plan.creditMinor > 0) {
      const credit = await checkout.spendCredit(orderId, plan.creditMinor);
      if (!credit.ok) return await failCheckout(credit);
      state.creditSpentMinor = plan.creditMinor;
    }
    if (plan.totalMinor > 0) {
      const payment = await checkout.authorisePayment(orderId);
      if (!payment.ok) return await failCheckout(payment);
      state.paymentId = payment.paymentId;
    }
  } catch (err) {
    log.warn("checkout step gave up", { orderId, error: String(err) });
    return await failCheckout(UNAVAILABLE);
  }

  // ---- 4. Create the order: PLACED (or SCHEDULED) + OrderPlaced ----
  await durable.markPlaced(orderId, {
    releaseAt,
    acceptTimeoutMs,
    paymentId: state.paymentId,
    promoReservationId: state.promoReservationId,
  });

  if (releaseAt) {
    state.stage = "scheduled";
    const wait = Date.parse(releaseAt) - Date.now();
    if (wait > 0) await condition(() => cancel !== undefined, wait);
    if (cancel) return cancelled(cancel);
    await durable.releaseToKitchen(orderId, acceptTimeoutMs);
  }

  // ---- 5. Wait for the kitchen: accept | reject | cancel | 3-minute timer ----
  state.stage = "awaiting-kitchen";
  const decided = await condition(() => !!accepted || !!rejected || !!cancel, acceptTimeoutMs);
  if (cancel) return cancelled(cancel);
  if (!accepted) {
    const rejection = rejected ?? { reason: REJECTION_TIMEOUT, note: "" };
    if (!decided) log.info("kitchen did not accept in time", { orderId });
    await durable.markRejected(orderId, rejection);
    await compensate(rejected ? "rejected by the kitchen" : "kitchen timeout");
    return finish({ outcome: "REJECTED", reason: rejected ? String(rejected.reason) : "TIMEOUT" });
  }

  // ---- 6–7. Accepted: kitchen and delivery progress until the end ----
  await durable.markAccepted(orderId, accepted);
  state.stage = "in-kitchen";
  const cash = paymentKind === PAYMENT_CASH;

  const capture = () => {
    if (!state.paymentId || state.captured) return;
    state.captured = true; // capture is in flight: from here cancellations refund instead of void
    const paymentId = state.paymentId;
    background.push(durable.capturePayment(orderId, paymentId));
  };
  const collectCash = (riderId: string, deliveryId: string, amountMinor: number) => {
    if (!state.paymentId || state.captured) return;
    state.captured = true;
    background.push(durable.recordCashCollection(orderId, state.paymentId, riderId, deliveryId, amountMinor));
  };

  for (;;) {
    await condition(() => steps.length > 0 || cancel !== undefined);
    if (cancel) return cancelled(cancel);
    const step = steps.shift()!;
    switch (step.kind) {
      case "ready":
        await durable.markReady(orderId);
        break;
      case "pickedUp":
        if (await durable.markPickedUp(orderId, step.signal)) {
          state.stage = "picked-up";
          if (!cash) capture();
        }
        break;
      case "delivered":
        if (await durable.markDelivered(orderId, step.signal)) {
          if (cash)
            collectCash(
              step.signal.riderId ?? "",
              step.signal.deliveryId ?? "",
              step.signal.cashCollectedMinor ?? 0,
            );
          else capture();
          return finish({ outcome: "DELIVERED" });
        }
        break;
      case "collected":
        if (await durable.markCollected(orderId, step.signal)) {
          if (cash) collectCash("", "", 0);
          else capture();
          return finish({ outcome: "COLLECTED" });
        }
        break;
    }
  }
}
