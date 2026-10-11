import { Inject, Injectable } from "@nestjs/common";
import { RiderArrivedAtCustomer, RiderAssigned } from "@kade/proto/kade/dispatch/v1/dispatch_events";
import { EventConsumer, OnEvent, type EventContext } from "../../platform/kafka/event-handler.js";
import { NotificationsRepository, type OrderContactRow } from "../notifications.repository.js";
import { Notifier } from "../notifier.js";
import { firstName } from "../templates.js";

const P = "kade.dispatch.v1.";

/**
 * Rider assigned / at the gate. Pickup itself is announced from order's OrderPickedUp, so riders
 * confirming pickup don't produce two messages.
 */
@EventConsumer({ topics: ["kade.delivery.events"] })
@Injectable()
export class DeliveryEventsConsumer {
  constructor(
    @Inject(NotificationsRepository) private readonly repo: NotificationsRepository,
    @Inject(Notifier) private readonly notifier: Notifier,
  ) {}

  @OnEvent(`${P}RiderAssigned`, RiderAssigned)
  async riderAssigned(event: RiderAssigned, ctx: EventContext): Promise<void> {
    const rider = event.rider?.firstName || firstName(event.rider?.name ?? "");
    const contact = await this.repo.upsertContact(ctx.tx, {
      orderId: event.orderId,
      orderNumber: event.orderNumber,
      restaurantId: event.restaurantId,
      riderId: event.rider?.riderId,
      riderName: rider,
    });
    await this.tell(ctx, contact, "rider_assigned", { rider: rider || "A rider" });
  }

  @OnEvent(`${P}RiderArrivedAtCustomer`, RiderArrivedAtCustomer)
  async riderArrived(event: RiderArrivedAtCustomer, ctx: EventContext): Promise<void> {
    const contact = await this.repo.contact(ctx.tx, event.orderId);
    if (!contact) return; // never saw the order: nobody to tell
    await this.tell(ctx, contact, "rider_arrived", { rider: contact.riderName || "Your rider" });
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
