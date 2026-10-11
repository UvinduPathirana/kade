import { Inject, Injectable } from "@nestjs/common";
import {
  MenuItemAvailabilityChanged,
  MenuUpdated,
  RestaurantAvailabilityChanged,
  RestaurantCreated,
  RestaurantHoursChanged,
  RestaurantUpdated,
} from "@kade/proto/kade/catalog/v1/catalog_events";
import type { Menu, RestaurantAvailability } from "@kade/proto/kade/catalog/v1/catalog_service";
import type { Tx } from "../platform/db/database.js";
import { OutboxWriter } from "../platform/outbox/outbox.js";
import { toClosure, toDayHours, toRestaurant, type ClosureRow, type RestaurantRow } from "./model.js";

export const EVENT = {
  restaurantCreated: "kade.catalog.v1.RestaurantCreated",
  restaurantUpdated: "kade.catalog.v1.RestaurantUpdated",
  availabilityChanged: "kade.catalog.v1.RestaurantAvailabilityChanged",
  hoursChanged: "kade.catalog.v1.RestaurantHoursChanged",
  menuUpdated: "kade.catalog.v1.MenuUpdated",
  itemAvailabilityChanged: "kade.catalog.v1.MenuItemAvailabilityChanged",
} as const;

/**
 * `now` is the service clock (may be pinned by DEMO_TIME) and drives the snapshot's availability;
 * occurred_at is always real time so consumers can order events.
 *
 * Writes catalog events to the outbox (topics kade.restaurant.events / kade.menu.events, key =
 * restaurant id). Events are snapshots so consumers can rebuild from the latest one alone.
 */
@Injectable()
export class CatalogEvents {
  constructor(@Inject(OutboxWriter) private readonly outbox: OutboxWriter) {}

  async restaurantCreated(tx: Tx, row: RestaurantRow, closureRows: ClosureRow[], now: Date): Promise<void> {
    await this.outbox.append(tx, {
      aggregateType: "restaurant",
      aggregateId: row.id,
      type: EVENT.restaurantCreated,
      payload: RestaurantCreated.encode({
        restaurantId: row.id,
        restaurant: toRestaurant(row, closureRows, now, { forEvent: true }),
        occurredAt: new Date(),
      }).finish(),
    });
  }

  async restaurantUpdated(
    tx: Tx,
    row: RestaurantRow,
    closureRows: ClosureRow[],
    changedFields: string[],
    now: Date,
  ): Promise<void> {
    await this.outbox.append(tx, {
      aggregateType: "restaurant",
      aggregateId: row.id,
      type: EVENT.restaurantUpdated,
      payload: RestaurantUpdated.encode({
        restaurantId: row.id,
        restaurant: toRestaurant(row, closureRows, now, { forEvent: true }),
        changedFields,
        occurredAt: new Date(),
      }).finish(),
    });
  }

  async availabilityChanged(
    tx: Tx,
    restaurantId: string,
    availability: RestaurantAvailability,
    previous: RestaurantAvailability,
  ): Promise<void> {
    await this.outbox.append(tx, {
      aggregateType: "restaurant",
      aggregateId: restaurantId,
      type: EVENT.availabilityChanged,
      payload: RestaurantAvailabilityChanged.encode({
        restaurantId,
        availability,
        previous,
        occurredAt: new Date(),
      }).finish(),
    });
  }

  async hoursChanged(tx: Tx, row: RestaurantRow, closureRows: ClosureRow[]): Promise<void> {
    await this.outbox.append(tx, {
      aggregateType: "restaurant",
      aggregateId: row.id,
      type: EVENT.hoursChanged,
      payload: RestaurantHoursChanged.encode({
        restaurantId: row.id,
        hours: toDayHours(row),
        closures: closureRows.map(toClosure),
        occurredAt: new Date(),
      }).finish(),
    });
  }

  async menuUpdated(tx: Tx, menu: Menu): Promise<void> {
    await this.outbox.append(tx, {
      aggregateType: "menu",
      aggregateId: menu.restaurantId,
      type: EVENT.menuUpdated,
      payload: MenuUpdated.encode({ restaurantId: menu.restaurantId, menu, occurredAt: new Date() }).finish(),
    });
  }

  async itemAvailabilityChanged(
    tx: Tx,
    event: Omit<MenuItemAvailabilityChanged, "occurredAt">,
  ): Promise<void> {
    await this.outbox.append(tx, {
      aggregateType: "menu",
      aggregateId: event.restaurantId,
      type: EVENT.itemAvailabilityChanged,
      payload: MenuItemAvailabilityChanged.encode({ ...event, occurredAt: new Date() }).finish(),
    });
  }
}
