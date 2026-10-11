import { Inject, Injectable } from "@nestjs/common";
import {
  DeliveryCompleted,
  DeliveryMatchingFailed,
  DeliveryPickedUp,
  DeliveryRequested,
  RiderAssigned,
  RiderUnassigned,
} from "@kade/proto/kade/dispatch/v1/dispatch_events";
import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import {
  TicketAccepted,
  TicketHandedOver,
  TicketReady,
  TicketRejected,
} from "@kade/proto/kade/merchant/v1/merchant_events";
import { CancelledBy, Fault, type OrderRider } from "@kade/proto/kade/order/v1/order_service";
import type { SignalDefinition } from "@temporalio/workflow";
import type { Tx } from "../platform/db/database.js";
import { EventConsumer, OnEvent, type EventContext } from "../platform/kafka/event-handler.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { TemporalService } from "../temporal/temporal.service.js";
import {
  cancelSignal,
  collectedSignal,
  deliveredSignal,
  kitchenAcceptedSignal,
  kitchenRejectedSignal,
  pickedUpSignal,
  readySignal,
} from "../workflows/signals.js";
import { minor } from "./money.js";
import { OrderRepository } from "./order.repository.js";
import { OrderStore } from "./order.store.js";
import { applyRider } from "./transitions.js";

/**
 * kade.merchant.events (kitchen decisions) and kade.delivery.events (rider progress) → workflow
 * signals. Status changes are made by the workflow, so there is one writer for the state machine;
 * rider assignment is not a status and is recorded here directly (OrderRiderChanged).
 * Signals are idempotent in the workflow, so a redelivered event is harmless.
 */
@EventConsumer({ topics: ["kade.merchant.events", "kade.delivery.events"] })
@Injectable()
export class FulfilmentEventsConsumer {
  constructor(
    @Inject(TemporalService) private readonly temporal: TemporalService,
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(OrderStore) private readonly store: OrderStore,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  // ---------------- kitchen (merchant) ----------------

  @OnEvent("kade.merchant.v1.TicketAccepted", TicketAccepted)
  async ticketAccepted(e: TicketAccepted, ctx: EventContext): Promise<void> {
    if (!(await this.known(ctx.tx, e.orderId, ctx))) return;
    await this.signal(e.orderId, kitchenAcceptedSignal, {
      prepMinutes: e.prepMinutes,
      readyBy: e.readyBy?.toISOString(),
      by: "",
    });
  }

  @OnEvent("kade.merchant.v1.TicketRejected", TicketRejected)
  async ticketRejected(e: TicketRejected, ctx: EventContext): Promise<void> {
    if (!(await this.known(ctx.tx, e.orderId, ctx))) return;
    await this.signal(e.orderId, kitchenRejectedSignal, { reason: e.reason, note: e.note, by: "" });
  }

  @OnEvent("kade.merchant.v1.TicketReady", TicketReady)
  async ticketReady(e: TicketReady, ctx: EventContext): Promise<void> {
    if (!(await this.known(ctx.tx, e.orderId, ctx))) return;
    await this.signal(e.orderId, readySignal);
  }

  /** Pickup orders: the customer took the bag. Delivery orders: dispatch's DeliveryPickedUp decides. */
  @OnEvent("kade.merchant.v1.TicketHandedOver", TicketHandedOver)
  async ticketHandedOver(e: TicketHandedOver, ctx: EventContext): Promise<void> {
    const record = await this.orders.findById(ctx.tx, e.orderId);
    if (!record || record.order.mode !== FulfilmentMode.FULFILMENT_MODE_PICKUP) return;
    await this.signal(e.orderId, collectedSignal, { by: "Kitchen" });
  }

  // ---------------- delivery (dispatch) ----------------

  @OnEvent("kade.dispatch.v1.DeliveryRequested", DeliveryRequested)
  async deliveryRequested(e: DeliveryRequested, ctx: EventContext): Promise<void> {
    if (!(await this.known(ctx.tx, e.orderId, ctx))) return;
    await this.store.mutateIn(
      ctx.tx,
      e.orderId,
      (o) => {
        o.deliveryId = e.deliveryId;
        return [];
      },
      { save: true },
    );
  }

  @OnEvent("kade.dispatch.v1.RiderAssigned", RiderAssigned)
  async riderAssigned(e: RiderAssigned, ctx: EventContext): Promise<void> {
    if (!(await this.known(ctx.tx, e.orderId, ctx))) return;
    const r = e.rider;
    const rider: OrderRider | undefined = r && {
      riderId: r.riderId,
      name: r.name,
      firstName: r.firstName,
      rating: r.rating,
      vehicle: r.vehicle,
      plate: r.plate,
      maskedPhone: r.maskedPhone,
      phone: r.phone,
    };
    await this.store.mutateIn(
      ctx.tx,
      e.orderId,
      (o) => applyRider(o, e.occurredAt ?? new Date(), rider, e.deliveryId),
      {
        save: true,
      },
    );
  }

  @OnEvent("kade.dispatch.v1.RiderUnassigned", RiderUnassigned)
  async riderUnassigned(e: RiderUnassigned, ctx: EventContext): Promise<void> {
    if (!(await this.known(ctx.tx, e.orderId, ctx))) return;
    await this.store.mutateIn(ctx.tx, e.orderId, (o) =>
      o.rider?.riderId === e.riderId
        ? applyRider(o, e.occurredAt ?? new Date(), undefined, e.deliveryId)
        : [],
    );
  }

  @OnEvent("kade.dispatch.v1.DeliveryPickedUp", DeliveryPickedUp)
  async deliveryPickedUp(e: DeliveryPickedUp, ctx: EventContext): Promise<void> {
    if (!(await this.known(ctx.tx, e.orderId, ctx))) return;
    await this.signal(e.orderId, pickedUpSignal, { riderId: e.riderId, deliveryId: e.deliveryId });
  }

  @OnEvent("kade.dispatch.v1.DeliveryCompleted", DeliveryCompleted)
  async deliveryCompleted(e: DeliveryCompleted, ctx: EventContext): Promise<void> {
    if (!(await this.known(ctx.tx, e.orderId, ctx))) return;
    await this.signal(e.orderId, deliveredSignal, {
      riderId: e.riderId,
      deliveryId: e.deliveryId,
      cashCollectedMinor: minor(e.cashCollected),
    });
  }

  /** No rider after every round: the order can't arrive, so it is cancelled and given back. */
  @OnEvent("kade.dispatch.v1.DeliveryMatchingFailed", DeliveryMatchingFailed)
  async matchingFailed(e: DeliveryMatchingFailed, ctx: EventContext): Promise<void> {
    if (!(await this.known(ctx.tx, e.orderId, ctx))) return;
    await this.signal(e.orderId, cancelSignal, {
      cancelledBy: CancelledBy.CANCELLED_BY_SYSTEM,
      reason: "No rider was available",
      fault: Fault.FAULT_KADE,
      refund: true,
      by: "Kadé",
    });
  }

  private async known(tx: Tx, orderId: string, ctx: EventContext): Promise<boolean> {
    const found = !!(await this.orders.findById(tx, orderId));
    if (!found)
      this.logger.debug({ orderId, eventType: ctx.eventType }, "event for an unknown order; skipped");
    return found;
  }

  private async signal<Args extends unknown[]>(
    orderId: string,
    def: SignalDefinition<Args>,
    ...args: Args
  ): Promise<void> {
    const delivered = await this.temporal.signal(orderId, def, ...args);
    if (!delivered)
      this.logger.info({ orderId, signal: def.name }, "order workflow not running; signal dropped");
  }
}
