import { Inject, Injectable } from "@nestjs/common";
import {
  DeliveryPickedUp,
  RiderArrivedAtRestaurant,
  RiderAssigned,
  RiderUnassigned,
} from "@kade/proto/kade/dispatch/v1/dispatch_events";
import { firstName } from "../domain/values.js";
import { EventConsumer, OnEvent, type EventContext } from "../platform/kafka/event-handler.js";
import { TicketsRepository } from "./tickets.repository.js";
import { TicketProjector } from "./ticket-projector.js";

export const DELIVERY_EVENTS = {
  riderAssigned: "kade.dispatch.v1.RiderAssigned",
  riderUnassigned: "kade.dispatch.v1.RiderUnassigned",
  arrivedAtRestaurant: "kade.dispatch.v1.RiderArrivedAtRestaurant",
  pickedUp: "kade.dispatch.v1.DeliveryPickedUp",
} as const;

/**
 * kade.delivery.events → the rider strip on a ticket: who is coming, when they reach the counter,
 * whether they are there, and pickup (closes the ticket even before order's OrderPickedUp arrives).
 */
@EventConsumer({ topics: ["kade.delivery.events"] })
@Injectable()
export class DeliveryEventsConsumer {
  constructor(
    @Inject(TicketProjector) private readonly projector: TicketProjector,
    @Inject(TicketsRepository) private readonly tickets: TicketsRepository,
  ) {}

  @OnEvent(DELIVERY_EVENTS.riderAssigned, RiderAssigned)
  async riderAssigned(e: RiderAssigned, ctx: EventContext): Promise<void> {
    if (!e.rider?.riderId) return;
    await this.projector.rider(ctx.tx, e.orderId, {
      deliveryId: e.deliveryId,
      rider: {
        riderId: e.rider.riderId,
        name: e.rider.firstName || firstName(e.rider.name) || e.rider.name,
        vehicle: e.rider.vehicle,
        plate: e.rider.plate,
        maskedPhone: e.rider.maskedPhone,
      },
      riderArrivesAt: e.arrivesAtRestaurantAt ?? null,
      riderAtCounter: false,
    });
  }

  @OnEvent(DELIVERY_EVENTS.riderUnassigned, RiderUnassigned)
  async riderUnassigned(e: RiderUnassigned, ctx: EventContext): Promise<void> {
    const ticket = await this.tickets.find(ctx.tx, e.orderId);
    // Only clear if it's still the rider who left (a replacement may already be assigned).
    if (!ticket?.rider || ticket.rider.riderId !== e.riderId) return;
    await this.projector.rider(ctx.tx, e.orderId, {
      rider: null,
      riderArrivesAt: null,
      riderAtCounter: false,
    });
  }

  @OnEvent(DELIVERY_EVENTS.arrivedAtRestaurant, RiderArrivedAtRestaurant)
  async arrivedAtRestaurant(e: RiderArrivedAtRestaurant, ctx: EventContext): Promise<void> {
    await this.projector.rider(ctx.tx, e.orderId, {
      riderAtCounter: true,
      riderArrivesAt: e.occurredAt ?? new Date(),
    });
  }

  @OnEvent(DELIVERY_EVENTS.pickedUp, DeliveryPickedUp)
  async pickedUp(e: DeliveryPickedUp, ctx: EventContext): Promise<void> {
    const t = e.occurredAt ?? new Date();
    await this.projector.progress(ctx.tx, e.orderId, { status: "picked_up", pickedUpAt: t, closedAt: t });
  }
}
