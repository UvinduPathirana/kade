import { Inject, Injectable } from "@nestjs/common";
import { OrderCollected, OrderDelivered } from "@kade/proto/kade/order/v1/order_events";
import type { Order } from "@kade/proto/kade/order/v1/order_service";
import type { rateableOrders } from "../db/schema.js";
import { EventConsumer, OnEvent, type EventContext } from "../platform/kafka/event-handler.js";
import { ReviewsRepository } from "./reviews.repository.js";

/** Opens an order for rating when it is delivered or collected, snapshotting what a review shows. */
@EventConsumer({ topics: ["kade.order.events"] })
@Injectable()
export class OrderEventsConsumer {
  constructor(@Inject(ReviewsRepository) private readonly repo: ReviewsRepository) {}

  @OnEvent("kade.order.v1.OrderDelivered", OrderDelivered)
  async delivered(event: OrderDelivered, ctx: EventContext): Promise<void> {
    if (event.order) await this.repo.upsertRateable(ctx.tx, rateableFromOrder(event.order, event.occurredAt));
  }

  @OnEvent("kade.order.v1.OrderCollected", OrderCollected)
  async collected(event: OrderCollected, ctx: EventContext): Promise<void> {
    if (event.order) await this.repo.upsertRateable(ctx.tx, rateableFromOrder(event.order, event.occurredAt));
  }
}

export function rateableFromOrder(order: Order, occurredAt?: Date): typeof rateableOrders.$inferInsert {
  const seen = new Set<string>();
  const dishes: { itemId: string; name: string }[] = [];
  for (const line of order.lines) {
    if (!line.itemId || seen.has(line.itemId)) continue;
    seen.add(line.itemId);
    dishes.push({ itemId: line.itemId, name: line.name });
  }
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customer?.id ?? "",
    customerName: order.customer?.name ?? "",
    restaurantId: order.restaurant?.id ?? "",
    restaurantName: order.restaurant?.name ?? "",
    riderId: order.rider?.riderId ?? "",
    area: order.address?.area ?? "",
    dishes,
    completedAt: order.deliveredAt ?? order.collectedAt ?? occurredAt ?? new Date(),
  };
}
