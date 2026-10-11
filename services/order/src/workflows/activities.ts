// Activities of the order workflow. Each is idempotent: dependency calls carry stable idempotency
// keys ("order:<id>:authorise", …) and state changes go through the transition functions, which are
// no-ops when already applied. Business failures are returned as values; outages throw so Temporal
// retries them (with the workflow's retry policy).
import { status } from "@grpc/grpc-js";
import { PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import type { CancelledBy, Fault } from "@kade/proto/kade/order/v1/order_service";
import { PaymentPurpose, PaymentStatus } from "@kade/proto/kade/payment/v1/payment_service";
import { CreditReason } from "@kade/proto/kade/profile/v1/profile_service";
import { ApplicationFailure } from "@temporalio/activity";
import { DependencyError } from "../clients/grpc-call.js";
import type { Dependencies } from "../clients/ports.js";
import type { CheckoutService } from "../orders/checkout.js";
import { promoReason } from "../orders/checkout.js";
import type { GroupService } from "../groups/group.service.js";
import { formatRs, lkr, minor } from "../orders/money.js";
import type { OrderRepository } from "../orders/order.repository.js";
import type { OrderStore } from "../orders/order.store.js";
import type { RefundService } from "../orders/refund.service.js";
import {
  addTimeline,
  applyAccepted,
  applyCancelled,
  applyCollected,
  applyDelivered,
  applyFailed,
  applyPickedUp,
  applyPlaced,
  applyReady,
  applyRejected,
  applyReleased,
} from "../orders/transitions.js";
import type { Database } from "../platform/db/database.js";
import { DomainError } from "../platform/grpc/errors.js";
import type { Logger } from "../platform/logger.js";
import type {
  CancelSignal,
  CheckoutPlan,
  CollectedSignal,
  DeliveredSignal,
  KitchenAcceptedSignal,
  KitchenRejectedSignal,
  PaymentAuthorised,
  PickedUpSignal,
  PromoReserved,
  StepFailure,
} from "./types.js";

export interface ActivityDeps extends Dependencies {
  database: Database;
  orders: OrderRepository;
  store: OrderStore;
  checkout: CheckoutService;
  refunds: RefundService;
  groups: GroupService;
  logger: Logger;
}

export interface PlacedArgs {
  releaseAt?: string;
  acceptTimeoutMs: number;
  paymentId?: string;
  promoReservationId?: string;
}

export type OrderActivities = ReturnType<typeof buildActivities>;

export function createActivities(deps: ActivityDeps) {
  return nonRetryableOnConsideredErrors(buildActivities(deps));
}

/**
 * A dependency's considered answer (PERMISSION_DENIED, INVALID_ARGUMENT, …) won't change on retry:
 * fail the activity for good so the workflow moves on (checkout fails; compensations log it) instead
 * of retrying for minutes. Outages (UNAVAILABLE, DEADLINE_EXCEEDED) keep Temporal's retries.
 */
function nonRetryableOnConsideredErrors<T extends Record<string, (...args: never[]) => Promise<unknown>>>(
  acts: T,
): T {
  const wrapped: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(acts)) {
    wrapped[name] = async (...args: never[]) => {
      try {
        return await fn(...args);
      } catch (err) {
        if (err instanceof DependencyError && !err.retryable) {
          throw ApplicationFailure.nonRetryable(err.message, err.reason ?? `GRPC_${err.code}`, {
            dependency: err.dependency,
            code: err.code,
          });
        }
        throw err;
      }
    };
  }
  return wrapped as T;
}

function buildActivities(deps: ActivityDeps) {
  const { database, orders, store, logger } = deps;

  const load = async (orderId: string) => {
    const record = await orders.findById(database.db, orderId);
    if (!record) throw ApplicationFailure.nonRetryable(`order ${orderId} not found`, "ORDER_NOT_FOUND");
    return record.order;
  };
  const failure = (reason: string, message: string): StepFailure => ({ ok: false, reason, message });
  /** Dependency said no for good (not an outage): stop retrying. */
  const considered = (err: unknown): err is DependencyError =>
    err instanceof DependencyError && !err.retryable;

  return {
    async prepareCheckout(orderId: string): Promise<CheckoutPlan | StepFailure> {
      return deps.checkout.prepare(orderId);
    },

    async reservePromo(orderId: string): Promise<PromoReserved | StepFailure> {
      const order = await load(orderId);
      const code = order.promo?.code ?? "";
      if (!code) return { ok: true, reservationId: "" };
      try {
        const res = await deps.promotion.reservePromo({
          code,
          customerId: order.customer?.id ?? "",
          orderId,
          basket: {
            restaurantId: order.restaurant?.id ?? "",
            lines: order.lines.map((l) => ({
              itemId: l.itemId,
              sectionId: l.sectionId,
              unitPrice: l.unitPrice,
              quantity: l.quantity,
            })),
            subtotal: order.totals?.subtotal,
            saving: order.totals?.saving,
            deliveryFee: order.totals?.deliveryFee,
            mode: order.mode,
          },
          holdUntil: order.scheduledFor,
          idempotencyKey: `order:${orderId}:promo`,
        });
        if (!res.reservation || !res.result?.ok) {
          return failure(
            promoReason(res.result?.rejection ?? 0),
            res.result?.message || `${code} can't be used right now.`,
          );
        }
        return { ok: true, reservationId: res.reservation.id };
      } catch (err) {
        if (considered(err))
          return failure(err.reason ?? "PROMO_INVALID", `${code} can't be used right now.`);
        throw err;
      }
    },

    async spendCredit(orderId: string, amountMinor: number): Promise<{ ok: true } | StepFailure> {
      const order = await load(orderId);
      try {
        await deps.profile.changeCredit({
          customerId: order.customer?.id ?? "",
          amount: lkr(-amountMinor),
          reason: CreditReason.CREDIT_REASON_ORDER_SPEND,
          label: `Used on order ${order.orderNumber}`,
          orderId,
          ticketId: "",
          by: "",
          idempotencyKey: `order:${orderId}:credit`,
        });
        return { ok: true };
      } catch (err) {
        if (considered(err)) {
          return failure(
            err.reason ?? "CREDIT_INSUFFICIENT",
            "Your Kadé credit changed. Check the total and try again.",
          );
        }
        throw err;
      }
    },

    async authorisePayment(orderId: string): Promise<PaymentAuthorised | StepFailure> {
      const order = await load(orderId);
      try {
        const payment = await deps.payment.authorise({
          purpose: PaymentPurpose.PAYMENT_PURPOSE_ORDER,
          referenceId: orderId,
          referenceLabel: order.orderNumber,
          customerId: order.customer?.id ?? "",
          method: order.payment,
          amount: order.totals?.total ?? lkr(0),
          idempotencyKey: `order:${orderId}:authorise`,
        });
        switch (payment.status) {
          case PaymentStatus.PAYMENT_STATUS_AUTHORISED:
            return { ok: true, paymentId: payment.id, status: "AUTHORISED" };
          case PaymentStatus.PAYMENT_STATUS_CASH_DUE:
            return { ok: true, paymentId: payment.id, status: "CASH_DUE" };
          case PaymentStatus.PAYMENT_STATUS_DECLINED:
            return failure(
              "PAYMENT_DECLINED",
              payment.declineMessage ||
                "Your bank declined the card, so nothing was charged. Try another card or cash.",
            );
          case PaymentStatus.PAYMENT_STATUS_PENDING:
            // 3-D Secure etc.: the same idempotency key returns the outcome once the webhook lands.
            throw ApplicationFailure.retryable("payment still pending", "PAYMENT_PENDING");
          default:
            return failure(
              "PAYMENT_FAILED",
              "We couldn't take the payment. Nothing was charged. Please try again.",
            );
        }
      } catch (err) {
        if (considered(err)) {
          return failure(
            err.reason ?? "PAYMENT_DECLINED",
            "We couldn't take the payment. Nothing was charged. Try another card or cash.",
          );
        }
        throw err;
      }
    },

    async markPlaced(orderId: string, args: PlacedArgs): Promise<void> {
      await database.transaction(undefined, async (tx) => {
        const { order } = await store.mutateIn(tx, orderId, (o) =>
          applyPlaced(o, {
            at: new Date(),
            releaseAt: args.releaseAt ? new Date(args.releaseAt) : undefined,
            acceptTimeoutMs: args.acceptTimeoutMs,
            paymentId: args.paymentId,
            promoReservationId: args.promoReservationId,
          }),
        );
        if (order.groupId) await deps.groups.markPlaced(tx, order.groupId, order.id);
      });
    },

    async markFailed(orderId: string, reason: string, message: string): Promise<void> {
      await store.mutate(undefined, orderId, (o) => applyFailed(o, new Date(), reason, message));
    },

    async releaseToKitchen(orderId: string, acceptTimeoutMs: number): Promise<void> {
      await store.mutate(undefined, orderId, (o) => applyReleased(o, new Date(), acceptTimeoutMs));
    },

    async markAccepted(orderId: string, s: KitchenAcceptedSignal): Promise<void> {
      await store.mutate(undefined, orderId, (o) =>
        applyAccepted(o, {
          at: new Date(),
          prepMinutes: s.prepMinutes,
          readyBy: s.readyBy ? new Date(s.readyBy) : undefined,
          by: s.by,
        }),
      );
    },

    async markRejected(orderId: string, s: KitchenRejectedSignal): Promise<void> {
      await store.mutate(undefined, orderId, (o) =>
        applyRejected(o, { at: new Date(), reason: s.reason, note: s.note, by: s.by }),
      );
    },

    async markCancelled(orderId: string, s: CancelSignal): Promise<boolean> {
      const { events } = await store.mutate(undefined, orderId, (o) =>
        applyCancelled(o, {
          at: new Date(),
          cancelledBy: s.cancelledBy as CancelledBy,
          reason: s.reason,
          fault: s.fault as Fault,
          by: s.by,
        }),
      );
      return events.length > 0;
    },

    async markReady(orderId: string): Promise<boolean> {
      const { events } = await store.mutate(undefined, orderId, (o) => applyReady(o, new Date()));
      return events.length > 0;
    },

    async markPickedUp(orderId: string, s: PickedUpSignal): Promise<boolean> {
      const { events } = await store.mutate(undefined, orderId, (o) => {
        if (s.deliveryId) o.deliveryId = s.deliveryId;
        return applyPickedUp(o, new Date(), s.riderId);
      });
      return events.length > 0;
    },

    async markDelivered(orderId: string, s: DeliveredSignal): Promise<boolean> {
      const { events } = await store.mutate(undefined, orderId, (o) => {
        if (s.deliveryId) o.deliveryId = s.deliveryId;
        return applyDelivered(o, new Date(), s.riderId);
      });
      return events.length > 0;
    },

    async markCollected(orderId: string, s: CollectedSignal): Promise<boolean> {
      const { events } = await store.mutate(undefined, orderId, (o) => applyCollected(o, new Date(), s.by));
      return events.length > 0;
    },

    // ---- compensations ----

    async voidPayment(orderId: string, paymentId: string, reason: string): Promise<void> {
      try {
        await deps.payment.void({ paymentId, reason, idempotencyKey: `order:${orderId}:void` });
      } catch (err) {
        // Already voided/never authorised: nothing to give back.
        if (considered(err) && (err.code === status.FAILED_PRECONDITION || err.code === status.NOT_FOUND)) {
          logger.warn({ orderId, paymentId, reason: err.reason }, "void not needed");
          return;
        }
        throw err;
      }
    },

    async releasePromo(orderId: string, reservationId: string, reason: string): Promise<void> {
      try {
        await deps.promotion.releasePromo({ reservationId, reason });
      } catch (err) {
        if (considered(err)) {
          logger.warn({ orderId, reservationId, reason: err.reason }, "promo release not needed");
          return;
        }
        throw err;
      }
    },

    async reverseCredit(orderId: string, amountMinor: number): Promise<void> {
      const order = await load(orderId);
      await deps.profile.changeCredit({
        customerId: order.customer?.id ?? "",
        amount: lkr(amountMinor),
        reason: CreditReason.CREDIT_REASON_ORDER_SPEND_REVERSED,
        label: `Returned from order ${order.orderNumber}`,
        orderId,
        ticketId: "",
        by: "",
        idempotencyKey: `order:${orderId}:credit:reverse`,
      });
    },

    // ---- money movement after acceptance ----

    async capturePayment(orderId: string, paymentId: string): Promise<void> {
      try {
        const payment = await deps.payment.capture({ paymentId, idempotencyKey: `order:${orderId}:capture` });
        await note(orderId, `Card charged ${formatRs(minor(payment.amountCaptured))}`);
      } catch (err) {
        if (considered(err)) {
          logger.error({ orderId, paymentId, reason: err.reason, err }, "payment capture refused");
          await note(orderId, `Card capture failed (${err.reason ?? err.code}); ops attention needed`);
          return;
        }
        throw err;
      }
    },

    async recordCashCollection(
      orderId: string,
      paymentId: string,
      riderId: string,
      deliveryId: string,
      amountMinor: number,
    ): Promise<void> {
      const order = await load(orderId);
      if (order.payment?.kind !== PaymentMethodKind.PAYMENT_METHOD_KIND_CASH) return;
      try {
        await deps.payment.recordCash({
          paymentId,
          amount: lkr(amountMinor || minor(order.totals?.total)),
          riderId,
          deliveryId,
          idempotencyKey: `order:${orderId}:cash`,
        });
      } catch (err) {
        // payment also records cash from DeliveryCompleted itself; "already captured" is success.
        if (considered(err)) {
          logger.info({ orderId, paymentId, reason: err.reason }, "cash already recorded by payment");
          return;
        }
        throw err;
      }
    },

    async refundRemaining(orderId: string, reason: string, by: string): Promise<void> {
      try {
        await deps.refunds.refundRemaining(orderId, reason, by);
      } catch (err) {
        if (err instanceof DomainError && err.code !== status.UNAVAILABLE) {
          throw ApplicationFailure.nonRetryable(err.message, err.reason);
        }
        throw err;
      }
    },
  };

  async function note(orderId: string, label: string): Promise<void> {
    await store.mutate(
      undefined,
      orderId,
      (o) => {
        addTimeline(o, new Date(), o.status, label);
        return [];
      },
      { save: true },
    );
  }
}
