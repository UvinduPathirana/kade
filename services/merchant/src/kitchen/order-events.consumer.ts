import { Inject, Injectable } from "@nestjs/common";
import {
  OrderAccepted,
  OrderCancelled,
  OrderCollected,
  OrderDelivered,
  OrderPickedUp,
  OrderPlaced,
  OrderPreparing,
  OrderReady,
  OrderRejected,
  OrderReleasedToKitchen,
  OrderRiderChanged,
} from "@kade/proto/kade/order/v1/order_events";
import { OrderStatus, RejectionReason } from "@kade/proto/kade/order/v1/order_service";
import { rejectReason } from "../domain/enums.js";
import { ACCEPT_WINDOW_MS } from "../domain/values.js";
import { EventConsumer, OnEvent, type EventContext } from "../platform/kafka/event-handler.js";
import { riderJson } from "./ticket-mapper.js";
import { TicketProjector } from "./ticket-projector.js";

export const ORDER_EVENTS = {
  placed: "kade.order.v1.OrderPlaced",
  released: "kade.order.v1.OrderReleasedToKitchen",
  accepted: "kade.order.v1.OrderAccepted",
  rejected: "kade.order.v1.OrderRejected",
  preparing: "kade.order.v1.OrderPreparing",
  ready: "kade.order.v1.OrderReady",
  riderChanged: "kade.order.v1.OrderRiderChanged",
  pickedUp: "kade.order.v1.OrderPickedUp",
  delivered: "kade.order.v1.OrderDelivered",
  collected: "kade.order.v1.OrderCollected",
  cancelled: "kade.order.v1.OrderCancelled",
} as const;

const KITCHEN_STATUSES = new Set<OrderStatus>([
  OrderStatus.ORDER_STATUS_PLACED,
  OrderStatus.ORDER_STATUS_ACCEPTED,
  OrderStatus.ORDER_STATUS_PREPARING,
  OrderStatus.ORDER_STATUS_READY,
]);

const at = (d: Date | undefined): Date => d ?? new Date();

/**
 * kade.order.events → kitchen tickets. OrderPlaced (status PLACED) and OrderReleasedToKitchen create
 * the ticket (accept_by from the order, else +3 min); later events move it forward. Dedup by event id
 * is done by the runner; the projector is also order-insensitive, so replays are harmless.
 */
@EventConsumer({ topics: ["kade.order.events"] })
@Injectable()
export class OrderEventsConsumer {
  constructor(@Inject(TicketProjector) private readonly projector: TicketProjector) {}

  @OnEvent(ORDER_EVENTS.placed, OrderPlaced)
  async placed(e: OrderPlaced, ctx: EventContext): Promise<void> {
    // SCHEDULED orders get their ticket at OrderReleasedToKitchen.
    if (e.order?.status !== OrderStatus.ORDER_STATUS_PLACED) return;
    await this.projector.fromSnapshot(ctx.tx, e.order, at(e.occurredAt));
  }

  @OnEvent(ORDER_EVENTS.released, OrderReleasedToKitchen)
  async released(e: OrderReleasedToKitchen, ctx: EventContext): Promise<void> {
    if (!e.order) return;
    const occurredAt = at(e.occurredAt);
    const order = {
      ...e.order,
      placedAt: e.order.placedAt ?? occurredAt,
      // The accept window starts at release, not when the customer scheduled it.
      acceptBy: e.order.acceptBy ?? new Date(occurredAt.getTime() + ACCEPT_WINDOW_MS),
    };
    const status = order.status === OrderStatus.ORDER_STATUS_SCHEDULED ? "new" : undefined;
    await this.projector.fromSnapshot(ctx.tx, order, occurredAt, status);
  }

  @OnEvent(ORDER_EVENTS.accepted, OrderAccepted)
  async accepted(e: OrderAccepted, ctx: EventContext): Promise<void> {
    if (!e.order) return;
    const row = await this.projector.fromSnapshot(ctx.tx, e.order, at(e.occurredAt), "preparing");
    if (row && (e.prepMinutes || e.readyBy)) {
      await this.projector.progress(ctx.tx, e.orderId, {
        status: "preparing",
        prepMinutes: e.prepMinutes || undefined,
        readyBy: e.readyBy,
        acceptedAt: e.order.acceptedAt ?? at(e.occurredAt),
      });
    }
  }

  @OnEvent(ORDER_EVENTS.rejected, OrderRejected)
  async rejected(e: OrderRejected, ctx: EventContext): Promise<void> {
    const occurredAt = at(e.occurredAt);
    const reason =
      e.rejection?.reason ?? e.order?.rejection?.reason ?? RejectionReason.REJECTION_REASON_UNSPECIFIED;
    const status = reason === RejectionReason.REJECTION_REASON_TIMEOUT ? "missed" : "rejected";
    const patch = {
      status,
      closedAt: e.rejection?.at ?? occurredAt,
      rejectReason: rejectReason.toDb(reason) ?? (status === "missed" ? "timeout" : "other"),
      rejectNote: e.rejection?.note ?? "",
    } as const;
    if (e.order) {
      await this.projector.fromSnapshot(
        ctx.tx,
        { ...e.order, rejection: e.rejection ?? e.order.rejection },
        occurredAt,
        status,
      );
    }
    await this.projector.progress(ctx.tx, e.orderId, patch);
  }

  @OnEvent(ORDER_EVENTS.preparing, OrderPreparing)
  async preparing(e: OrderPreparing, ctx: EventContext): Promise<void> {
    await this.projector.progress(ctx.tx, e.orderId, { status: "preparing", readyBy: e.readyBy });
  }

  @OnEvent(ORDER_EVENTS.ready, OrderReady)
  async ready(e: OrderReady, ctx: EventContext): Promise<void> {
    await this.projector.progress(ctx.tx, e.orderId, {
      status: "ready",
      readyAt: at(e.occurredAt),
      deliveryId: e.deliveryId || undefined,
    });
  }

  @OnEvent(ORDER_EVENTS.riderChanged, OrderRiderChanged)
  async riderChanged(e: OrderRiderChanged, ctx: EventContext): Promise<void> {
    const rider = riderJson(e.rider);
    await this.projector.rider(ctx.tx, e.orderId, {
      rider,
      deliveryId: e.deliveryId || undefined,
      ...(rider ? {} : { riderArrivesAt: null, riderAtCounter: false }),
    });
  }

  @OnEvent(ORDER_EVENTS.pickedUp, OrderPickedUp)
  async pickedUp(e: OrderPickedUp, ctx: EventContext): Promise<void> {
    const t = at(e.occurredAt);
    await this.projector.progress(ctx.tx, e.orderId, { status: "picked_up", pickedUpAt: t, closedAt: t });
  }

  @OnEvent(ORDER_EVENTS.delivered, OrderDelivered)
  async delivered(e: OrderDelivered, ctx: EventContext): Promise<void> {
    await this.projector.fromSnapshot(ctx.tx, e.order, at(e.occurredAt), "picked_up");
  }

  @OnEvent(ORDER_EVENTS.collected, OrderCollected)
  async collected(e: OrderCollected, ctx: EventContext): Promise<void> {
    await this.projector.fromSnapshot(ctx.tx, e.order, at(e.occurredAt), "picked_up");
  }

  @OnEvent(ORDER_EVENTS.cancelled, OrderCancelled)
  async cancelled(e: OrderCancelled, ctx: EventContext): Promise<void> {
    const t = e.cancellation?.at ?? at(e.occurredAt);
    // Only orders that reached the kitchen get a (cancelled) ticket; SCHEDULED/PENDING ones never did.
    if (e.order && KITCHEN_STATUSES.has(e.previousStatus)) {
      await this.projector.fromSnapshot(ctx.tx, e.order, t, "cancelled");
    }
    await this.projector.progress(ctx.tx, e.orderId, { status: "cancelled", closedAt: t });
  }
}
