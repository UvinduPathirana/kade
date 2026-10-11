import { Inject, Injectable } from "@nestjs/common";
import {
  MenuItemAvailabilityChanged,
  MenuUpdated,
  RestaurantAvailabilityChanged,
  RestaurantCreated,
  RestaurantHoursChanged,
  RestaurantUpdated,
} from "@kade/proto/kade/catalog/v1/catalog_events";
import { EventConsumer, OnEvent, type EventContext } from "../platform/kafka/event-handler.js";
import { Projection } from "./projection.js";

export const CATALOG_EVENT = {
  restaurantCreated: "kade.catalog.v1.RestaurantCreated",
  restaurantUpdated: "kade.catalog.v1.RestaurantUpdated",
  availabilityChanged: "kade.catalog.v1.RestaurantAvailabilityChanged",
  hoursChanged: "kade.catalog.v1.RestaurantHoursChanged",
  menuUpdated: "kade.catalog.v1.MenuUpdated",
  itemAvailabilityChanged: "kade.catalog.v1.MenuItemAvailabilityChanged",
} as const;

/** Events without occurred_at (should not happen) sort before everything real. */
const at = (d: Date | undefined): Date => d ?? new Date(0);

/**
 * The CQRS projection: catalog's snapshot events → search_restaurants / search_dishes. Dedup by
 * event id is done by the runner (processed_events, same transaction); the projection's own
 * time/version guards make out-of-order and backfill-vs-stream races harmless.
 */
@EventConsumer({ topics: ["kade.restaurant.events", "kade.menu.events"] })
@Injectable()
export class CatalogEventsConsumer {
  constructor(@Inject(Projection) private readonly projection: Projection) {}

  @OnEvent(CATALOG_EVENT.restaurantCreated, RestaurantCreated)
  async restaurantCreated(event: RestaurantCreated, ctx: EventContext): Promise<void> {
    if (event.restaurant)
      await this.projection.upsertRestaurant(ctx.tx, event.restaurant, at(event.occurredAt));
  }

  @OnEvent(CATALOG_EVENT.restaurantUpdated, RestaurantUpdated)
  async restaurantUpdated(event: RestaurantUpdated, ctx: EventContext): Promise<void> {
    if (event.restaurant)
      await this.projection.upsertRestaurant(ctx.tx, event.restaurant, at(event.occurredAt));
  }

  @OnEvent(CATALOG_EVENT.availabilityChanged, RestaurantAvailabilityChanged)
  async availabilityChanged(event: RestaurantAvailabilityChanged, ctx: EventContext): Promise<void> {
    await this.projection.setAvailability(
      ctx.tx,
      event.restaurantId,
      event.availability,
      at(event.occurredAt),
    );
  }

  @OnEvent(CATALOG_EVENT.hoursChanged, RestaurantHoursChanged)
  async hoursChanged(event: RestaurantHoursChanged, ctx: EventContext): Promise<void> {
    await this.projection.setHours(
      ctx.tx,
      event.restaurantId,
      event.hours,
      event.closures.map((c) => c.date),
      at(event.occurredAt),
    );
  }

  @OnEvent(CATALOG_EVENT.menuUpdated, MenuUpdated)
  async menuUpdated(event: MenuUpdated, ctx: EventContext): Promise<void> {
    if (event.menu)
      await this.projection.replaceMenu(ctx.tx, { ...event.menu, restaurantId: event.restaurantId });
  }

  @OnEvent(CATALOG_EVENT.itemAvailabilityChanged, MenuItemAvailabilityChanged)
  async itemAvailabilityChanged(event: MenuItemAvailabilityChanged, ctx: EventContext): Promise<void> {
    await this.projection.setSoldOut(ctx.tx, event);
  }
}
