import { Inject, Injectable } from "@nestjs/common";
import { FulfilmentMode, PaymentMethodKind, RefundMethod } from "@kade/proto/kade/common/v1/commerce";
import {
  OrderAccepted,
  OrderCancelled,
  OrderCollected,
  OrderDelivered,
  OrderPickedUp,
  OrderPlaced,
  OrderReady,
  OrderRefunded,
  OrderRejected,
  OrderReleasedToKitchen,
  OrderRiderChanged,
} from "@kade/proto/kade/order/v1/order_events";
import {
  CancelledBy,
  OrderStatus,
  RejectionReason,
  type Order,
} from "@kade/proto/kade/order/v1/order_service";
import { EventConsumer, OnEvent, type EventContext } from "../../platform/kafka/event-handler.js";
import { NotificationsRepository, type OrderContactRow } from "../notifications.repository.js";
import { Notifier } from "../notifier.js";
import { firstName, formatRs, formatWhen } from "../templates.js";

const P = "kade.order.v1.";

const REJECTION_COPY: Record<number, string> = {
  [RejectionReason.REJECTION_REASON_TOO_BUSY]: "they're too busy right now",
  [RejectionReason.REJECTION_REASON_SOLD_OUT]: "something you ordered has sold out",
  [RejectionReason.REJECTION_REASON_CLOSING_SOON]: "they're closing soon",
  [RejectionReason.REJECTION_REASON_TIMEOUT]: "they didn't respond in time",
};

/** Customer messages for an order's life: accepted, on the way, delivered, refunds. */
@EventConsumer({ topics: ["kade.order.events"] })
@Injectable()
export class OrderEventsConsumer {
  constructor(
    @Inject(NotificationsRepository) private readonly repo: NotificationsRepository,
    @Inject(Notifier) private readonly notifier: Notifier,
  ) {}

  @OnEvent(`${P}OrderPlaced`, OrderPlaced)
  async orderPlaced(event: OrderPlaced, ctx: EventContext): Promise<void> {
    const contact = await this.remember(ctx, event.order);
    if (!contact) return;
    if (event.order?.status === OrderStatus.ORDER_STATUS_SCHEDULED && event.order.scheduledFor) {
      await this.tell(ctx, contact, "order_scheduled", { when: formatWhen(event.order.scheduledFor) });
      return;
    }
    await this.tell(ctx, contact, "order_placed");
  }

  @OnEvent(`${P}OrderReleasedToKitchen`, OrderReleasedToKitchen)
  async orderReleased(event: OrderReleasedToKitchen, ctx: EventContext): Promise<void> {
    await this.remember(ctx, event.order);
  }

  @OnEvent(`${P}OrderAccepted`, OrderAccepted)
  async orderAccepted(event: OrderAccepted, ctx: EventContext): Promise<void> {
    const contact = await this.remember(ctx, event.order);
    if (!contact) return;
    const pickup = event.order?.mode === FulfilmentMode.FULFILMENT_MODE_PICKUP;
    const minutes = event.prepMinutes || event.order?.prepMinutes || 15;
    // Delivery: prep + the restaurant's ride estimate; pickup: prep only.
    const total = pickup ? minutes : minutes + Math.max(10, event.order?.restaurant?.etaMinMinutes ?? 10);
    await this.tell(ctx, contact, pickup ? "order_accepted_pickup" : "order_accepted", {
      minutes: String(total),
    });
  }

  @OnEvent(`${P}OrderRejected`, OrderRejected)
  async orderRejected(event: OrderRejected, ctx: EventContext): Promise<void> {
    const contact = await this.remember(ctx, event.order);
    if (!contact) return;
    await this.tell(ctx, contact, "order_rejected", {
      reason: REJECTION_COPY[event.rejection?.reason ?? 0] ?? "they can't make it right now",
      money: moneyBackCopy(event.order),
    });
  }

  @OnEvent(`${P}OrderReady`, OrderReady)
  async orderReady(event: OrderReady, ctx: EventContext): Promise<void> {
    if (event.mode !== FulfilmentMode.FULFILMENT_MODE_PICKUP) return; // riders are nudged by dispatch
    const contact = await this.contactFor(ctx, event.orderId, event);
    await this.tell(ctx, contact, "order_ready_pickup");
  }

  @OnEvent(`${P}OrderRiderChanged`, OrderRiderChanged)
  async orderRiderChanged(event: OrderRiderChanged, ctx: EventContext): Promise<void> {
    // Remember the rider only; the customer hears about it from dispatch's RiderAssigned.
    await this.repo.upsertContact(ctx.tx, {
      orderId: event.orderId,
      orderNumber: event.orderNumber,
      customerId: event.customerId,
      restaurantId: event.restaurantId,
      riderId: event.rider?.riderId,
      riderName: event.rider?.firstName || event.rider?.name,
    });
  }

  @OnEvent(`${P}OrderPickedUp`, OrderPickedUp)
  async orderPickedUp(event: OrderPickedUp, ctx: EventContext): Promise<void> {
    const contact = await this.contactFor(ctx, event.orderId, event);
    await this.tell(ctx, contact, "order_picked_up", { rider: contact.riderName || "Your rider" });
  }

  @OnEvent(`${P}OrderDelivered`, OrderDelivered)
  async orderDelivered(event: OrderDelivered, ctx: EventContext): Promise<void> {
    const contact = await this.remember(ctx, event.order);
    if (!contact) return;
    await this.tell(ctx, contact, "order_delivered", { rider: contact.riderName || "your rider" });
  }

  @OnEvent(`${P}OrderCollected`, OrderCollected)
  async orderCollected(event: OrderCollected, ctx: EventContext): Promise<void> {
    const contact = await this.remember(ctx, event.order);
    if (!contact) return;
    await this.tell(ctx, contact, "order_collected");
  }

  @OnEvent(`${P}OrderCancelled`, OrderCancelled)
  async orderCancelled(event: OrderCancelled, ctx: EventContext): Promise<void> {
    const contact = await this.remember(ctx, event.order);
    if (!contact) return;
    const byCustomer = event.cancellation?.cancelledBy === CancelledBy.CANCELLED_BY_CUSTOMER;
    await this.tell(ctx, contact, byCustomer ? "order_cancelled" : "order_cancelled_by_kade", {
      reason: lowerFirst(event.cancellation?.reason || "something went wrong on our side"),
      money: moneyBackCopy(event.order),
    });
  }

  @OnEvent(`${P}OrderRefunded`, OrderRefunded)
  async orderRefunded(event: OrderRefunded, ctx: EventContext): Promise<void> {
    const refund = event.refund;
    if (!refund) return;
    const contact = await this.contactFor(ctx, event.orderId, {
      orderNumber: refund.orderNumber,
      customerId: refund.customerId,
      restaurantId: event.restaurantId,
    });
    const card = refund.method === RefundMethod.REFUND_METHOD_CARD;
    await this.tell(ctx, contact, card ? "order_refunded_card" : "order_refunded_credit", {
      amount: formatRs(refund.amount?.amountMinor ?? 0),
    });
  }

  /** Stores the order's contact details from a full snapshot; undefined if the event had none. */
  private async remember(ctx: EventContext, order: Order | undefined): Promise<OrderContactRow | undefined> {
    if (!order?.id) return undefined;
    return this.repo.upsertContact(ctx.tx, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customer?.id,
      customerName: order.customer?.name,
      customerPhone: order.customer?.phone,
      restaurantId: order.restaurant?.id,
      restaurantName: order.restaurant?.name,
      mode: order.mode,
      paymentKind: order.payment?.kind,
      riderId: order.rider?.riderId,
      riderName: order.rider?.firstName || (order.rider?.name ? firstName(order.rider.name) : undefined),
    });
  }

  /** Contact row for a progress event, seeded from the event's ids when we never saw a snapshot. */
  private async contactFor(
    ctx: EventContext,
    orderId: string,
    ids: { orderNumber: string; customerId: string; restaurantId: string },
  ): Promise<OrderContactRow> {
    return this.repo.upsertContact(ctx.tx, {
      orderId,
      orderNumber: ids.orderNumber,
      customerId: ids.customerId,
      restaurantId: ids.restaurantId,
    });
  }

  private async tell(
    ctx: EventContext,
    contact: OrderContactRow,
    template: string,
    extra: Record<string, string> = {},
  ): Promise<void> {
    await this.notifier.toOrderCustomer(ctx.tx, ctx.eventId, contact, template, extra);
  }
}

function moneyBackCopy(order: Order | undefined): string {
  if (order?.payment?.kind === PaymentMethodKind.PAYMENT_METHOD_KIND_CARD) {
    return "The hold on your card has been released.";
  }
  if ((order?.totals?.credit?.amountMinor ?? 0) > 0) return "Your Kadé credit is back in your account.";
  return "You haven't been charged.";
}

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1).replace(/\.$/, "") : s;
}
