import { Inject, Injectable } from "@nestjs/common";
import {
  OrderCancelled,
  OrderCollected,
  OrderDelivered,
  OrderRefunded,
} from "@kade/proto/kade/order/v1/order_events";
import { CancelledBy, Fault, type Order } from "@kade/proto/kade/order/v1/order_service";
import { PaymentDeclined } from "@kade/proto/kade/payment/v1/payment_events";
import { FraudFlagKind } from "@kade/proto/kade/profile/v1/profile_service";
import { and, eq, gt, sql } from "drizzle-orm";
import { customers, riskSignals } from "../db/schema.js";
import { ProfileStore } from "../customers/profile-store.js";
import type { Tx } from "../platform/db/database.js";
import { EventConsumer, OnEvent, type EventContext } from "../platform/kafka/event-handler.js";
import { evaluate, RISK_RULES } from "./rules.js";

/**
 * Consumes order and payment events for two read-side jobs:
 * - customer stats (orders, spend, last order) for the admin console, from delivered/collected orders;
 * - fraud flags: refunds, customer cancellations and card declines counted in sliding windows.
 * Events for customers profile has never seen are ignored. Dedup is the runner's (processed_events).
 */
@EventConsumer({ topics: ["kade.order.events", "kade.payment.events"] })
@Injectable()
export class RiskEventsConsumer {
  constructor(@Inject(ProfileStore) private readonly store: ProfileStore) {}

  @OnEvent("kade.order.v1.OrderDelivered", OrderDelivered)
  async orderDelivered(event: OrderDelivered, ctx: EventContext): Promise<void> {
    await this.countOrder(ctx.tx, event.order, event.occurredAt);
  }

  @OnEvent("kade.order.v1.OrderCollected", OrderCollected)
  async orderCollected(event: OrderCollected, ctx: EventContext): Promise<void> {
    await this.countOrder(ctx.tx, event.order, event.occurredAt);
  }

  @OnEvent("kade.order.v1.OrderCancelled", OrderCancelled)
  async orderCancelled(event: OrderCancelled, ctx: EventContext): Promise<void> {
    const c = event.cancellation;
    const customerFault =
      c?.cancelledBy === CancelledBy.CANCELLED_BY_CUSTOMER || c?.fault === Fault.FAULT_CUSTOMER;
    if (!customerFault) return;
    await this.signal(
      ctx,
      event.order?.customer?.id,
      FraudFlagKind.FRAUD_FLAG_KIND_CANCELLATIONS,
      0,
      event.occurredAt,
    );
  }

  @OnEvent("kade.order.v1.OrderRefunded", OrderRefunded)
  async orderRefunded(event: OrderRefunded, ctx: EventContext): Promise<void> {
    await this.signal(
      ctx,
      event.refund?.customerId,
      FraudFlagKind.FRAUD_FLAG_KIND_REFUNDS,
      event.refund?.amount?.amountMinor ?? 0,
      event.occurredAt,
    );
  }

  @OnEvent("kade.payment.v1.PaymentDeclined", PaymentDeclined)
  async paymentDeclined(event: PaymentDeclined, ctx: EventContext): Promise<void> {
    await this.signal(
      ctx,
      event.customerId,
      FraudFlagKind.FRAUD_FLAG_KIND_PAYMENT_FAILURES,
      0,
      event.occurredAt,
    );
  }

  private async countOrder(tx: Tx, order: Order | undefined, at: Date | undefined): Promise<void> {
    const customerId = order?.customer?.id;
    if (!customerId) return;
    const when = at ?? new Date();
    await tx
      .update(customers)
      .set({
        ordersCount: sql`${customers.ordersCount} + 1`,
        spendMinor: sql`${customers.spendMinor} + ${order?.totals?.total?.amountMinor ?? 0}`,
        lastOrderAt: sql`greatest(${customers.lastOrderAt}, ${when.toISOString()}::timestamptz)`,
      })
      .where(eq(customers.id, customerId));
  }

  private async signal(
    ctx: EventContext,
    customerId: string | undefined,
    kind: FraudFlagKind,
    amountMinor: number,
    at: Date | undefined,
  ): Promise<void> {
    if (!customerId || !(await this.store.find(ctx.tx, customerId))) return;
    const rule = RISK_RULES[kind]!;
    const when = at ?? new Date();
    await ctx.tx
      .insert(riskSignals)
      .values({ eventId: ctx.eventId, customerId, kind, amountMinor: Math.abs(amountMinor), at: when })
      .onConflictDoNothing();
    const [{ n, total } = { n: 0, total: 0 }] = await ctx.tx
      .select({
        n: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${riskSignals.amountMinor}), 0)::bigint`,
      })
      .from(riskSignals)
      .where(
        and(
          eq(riskSignals.customerId, customerId),
          eq(riskSignals.kind, kind),
          gt(riskSignals.at, new Date(when.getTime() - rule.windowMs)),
        ),
      );
    const detail = evaluate(rule, n, Number(total));
    if (detail) await this.store.raiseFlag(ctx.tx, customerId, kind, detail, { at: when });
  }
}
