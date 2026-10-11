import { Inject, Injectable } from "@nestjs/common";
import { PaymentMethodKind, RefundMethod } from "@kade/proto/kade/common/v1/commerce";
import type { Actor } from "@kade/proto/kade/common/v1/types";
import { OrderStatus, type Order, type Refund } from "@kade/proto/kade/order/v1/order_service";
import { CreditReason } from "@kade/proto/kade/profile/v1/profile_service";
import { v7 as uuidv7 } from "uuid";
import { PAYMENT, PROFILE, type PaymentPort, type ProfilePort } from "../clients/ports.js";
import { Database, type HasDeadline } from "../platform/db/database.js";
import { failedPrecondition, invalidArgument, notFound } from "../platform/grpc/errors.js";
import { asDomainError } from "./dependency-errors.js";
import { orderEvents } from "./events.js";
import { formatRs, lkr, minor } from "./money.js";
import { OrderRepository } from "./order.repository.js";
import { OrderStore } from "./order.store.js";
import { RefundRepository } from "./refund.repository.js";
import { addTimeline } from "./transitions.js";

export interface RefundInput {
  orderId: string;
  amountMinor: number;
  method: RefundMethod;
  reason: string;
  by: string;
  ticketId?: string;
  /** Empty = not retry-safe (a fresh key is generated). */
  idempotencyKey: string;
  actor?: Actor;
}

/** What can still go back to the customer, by method. */
export function refundable(order: Order, refunds: Refund[]): { anyMinor: number; cardMinor: number } {
  const total = minor(order.totals?.total);
  const credit = minor(order.totals?.credit);
  const refunded = refunds.reduce((s, r) => s + minor(r.amount), 0);
  const cardRefunded = refunds
    .filter((r) => r.method === RefundMethod.REFUND_METHOD_CARD)
    .reduce((s, r) => s + minor(r.amount), 0);
  // Credit refunds may cover what was paid by card/cash *and* the credit spent on the order.
  return {
    anyMinor: Math.max(0, total + credit - refunded),
    cardMinor: Math.max(0, Math.min(total - cardRefunded, total + credit - refunded)),
  };
}

/**
 * RefundOrder: money back to the card (payment.RefundPayment) or as Kadé credit
 * (profile.ChangeCredit), recorded with OrderRefunded. The external call carries a stable
 * idempotency key, so a retry after a crash between the call and the commit refunds once.
 */
@Injectable()
export class RefundService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(RefundRepository) private readonly refunds: RefundRepository,
    @Inject(OrderStore) private readonly store: OrderStore,
    @Inject(PAYMENT) private readonly payment: PaymentPort,
    @Inject(PROFILE) private readonly profile: ProfilePort,
  ) {}

  async refund(ctx: HasDeadline | undefined, input: RefundInput): Promise<{ order: Order; refund: Refund }> {
    const key = input.idempotencyKey || uuidv7();
    const record = await this.orders.findById(this.database.db, input.orderId);
    if (!record) throw notFound("ORDER_NOT_FOUND", "We couldn't find that order.");
    const existing = await this.refunds.findByKey(this.database.db, input.orderId, key);
    if (existing) return { order: record.order, refund: existing };

    const order = record.order;
    if (
      order.status === OrderStatus.ORDER_STATUS_PENDING ||
      order.status === OrderStatus.ORDER_STATUS_FAILED
    ) {
      throw failedPrecondition("ORDER_NOT_REFUNDABLE", "This order was never charged.");
    }
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw invalidArgument("REFUND_AMOUNT_INVALID", "Refund at least Rs 1.", { field: "amount" });
    }
    const method = input.method || RefundMethod.REFUND_METHOD_CREDIT;
    const cash = order.payment?.kind === PaymentMethodKind.PAYMENT_METHOD_KIND_CASH;
    if (method === RefundMethod.REFUND_METHOD_CARD && (cash || !order.paymentId)) {
      throw failedPrecondition(
        "CASH_ORDER_REFUND_TO_CREDIT",
        "This order wasn't paid by card. Refund it as Kadé credit.",
      );
    }
    const left = refundable(order, await this.refunds.listForOrder(this.database.db, order.id));
    const limit = method === RefundMethod.REFUND_METHOD_CARD ? left.cardMinor : left.anyMinor;
    if (input.amountMinor > limit) {
      throw failedPrecondition(
        "REFUND_EXCEEDS_REMAINING",
        `Refund between Rs 1 and ${formatRs(limit)}, the amount not yet refunded.`,
        { remaining: String(limit) },
      );
    }

    const refundId = uuidv7();
    const externalKey = `order:${order.id}:refund:${key}`;
    let externalRef: string;
    let label: string;
    try {
      if (method === RefundMethod.REFUND_METHOD_CARD) {
        const res = await this.payment.refund({
          paymentId: order.paymentId,
          amount: lkr(input.amountMinor),
          reason: input.reason,
          orderRefundId: refundId,
          idempotencyKey: externalKey,
        });
        externalRef = res.refund?.id ?? "";
        label = `Refunded ${formatRs(input.amountMinor)} to card${order.payment?.cardLast4 ? ` ending ${order.payment.cardLast4}` : ""}`;
      } else {
        const res = await this.profile.changeCredit({
          customerId: order.customer?.id ?? "",
          amount: lkr(input.amountMinor),
          reason: CreditReason.CREDIT_REASON_REFUND,
          label: `Refund for order ${order.orderNumber}`,
          orderId: order.id,
          ticketId: input.ticketId ?? "",
          by: input.by,
          idempotencyKey: externalKey,
        });
        externalRef = res.entry?.id ?? "";
        label = `Refunded ${formatRs(input.amountMinor)} to Kadé credit`;
      }
    } catch (err) {
      throw asDomainError(err, "We couldn't refund this right now. Try again in a minute.");
    }

    const at = new Date();
    const refund: Refund = {
      id: refundId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customer?.id ?? "",
      amount: lkr(input.amountMinor),
      method,
      reason: input.reason,
      by: input.by || "Kadé",
      at,
      ticketId: input.ticketId ?? "",
      externalRef,
    };
    return this.database.transaction(ctx, async (tx) => {
      if (!(await this.refunds.insert(tx, refund, key))) {
        const winner = await this.refunds.findByKey(tx, order.id, key);
        const current = await this.orders.findById(tx, order.id);
        return { order: current!.order, refund: winner! };
      }
      const { order: updated } = await this.store.mutateIn(tx, order.id, (o) => {
        o.refunded = lkr(minor(o.refunded) + input.amountMinor);
        o.updatedAt = at;
        addTimeline(o, at, o.status, input.reason ? `${label}: ${input.reason}` : label, input.by);
        return [orderEvents.refunded(o, refund, input.actor, at)];
      });
      return { order: updated, refund };
    });
  }

  /** Ops cancel with "refund": everything not yet refunded, to the card (card orders) or credit. */
  async refundRemaining(orderId: string, reason: string, by: string): Promise<void> {
    const record = await this.orders.findById(this.database.db, orderId);
    if (!record) return;
    const order = record.order;
    const left = refundable(order, await this.refunds.listForOrder(this.database.db, orderId));
    const cash = order.payment?.kind === PaymentMethodKind.PAYMENT_METHOD_KIND_CASH;
    const credit = minor(order.totals?.credit);
    // Card part back to the card, the credit spent (and cash orders) back as credit.
    if (!cash && order.paymentId && left.cardMinor > 0) {
      await this.refund(undefined, {
        orderId,
        amountMinor: left.cardMinor,
        method: RefundMethod.REFUND_METHOD_CARD,
        reason,
        by,
        idempotencyKey: "cancel:card",
      });
    }
    const after = refundable(order, await this.refunds.listForOrder(this.database.db, orderId));
    const creditPart = cash ? after.anyMinor : Math.min(after.anyMinor, credit);
    if (creditPart > 0) {
      await this.refund(undefined, {
        orderId,
        amountMinor: creditPart,
        method: RefundMethod.REFUND_METHOD_CREDIT,
        reason,
        by,
        idempotencyKey: "cancel:credit",
      });
    }
  }
}
