import { Injectable } from "@nestjs/common";
import {
  Restaurant,
  type DayHours,
  type Menu,
  type RestaurantAvailability,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import { MenuItem } from "@kade/proto/kade/catalog/v1/catalog_service";
import { and, eq, lt, or, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { processedEvents, searchDishes, searchRestaurants } from "../db/schema.js";
import type { Queryable, Tx } from "../platform/db/database.js";
import { normalise, restaurantSearchText } from "./text.js";

/** A snapshot is applied only if it is newer than what the projection already has. */
const newer = (column: AnyPgColumn, at: Date) => or(isNull(column), lt(column, at));

/**
 * Writes to the search projection. Every write is an idempotent upsert keyed by restaurant/item
 * id and guarded by the event time (or menu version), so replays, redeliveries and a backfill
 * racing the live stream all converge on the latest catalog state.
 */
@Injectable()
export class Projection {
  async upsertRestaurant(tx: Queryable, restaurant: Restaurant, at: Date): Promise<void> {
    const values = {
      snapshot: Restaurant.encode(restaurant).finish(),
      snapshotAt: at,
      createdAt: restaurant.createdAt ?? null,
      name: normalise(restaurant.name),
      searchText: restaurantSearchText(restaurant),
      lat: restaurant.location?.lat ?? 0,
      lng: restaurant.location?.lng ?? 0,
      busyExtraMinutes: restaurant.availability?.busyExtraMinutes ?? 0,
    };
    await tx
      .insert(searchRestaurants)
      .values({ id: restaurant.id, ...values, ...availabilityValues(restaurant.availability, at) })
      .onConflictDoUpdate({
        target: searchRestaurants.id,
        set: values,
        setWhere: newer(searchRestaurants.snapshotAt, at),
      });
    // The snapshot's availability counts only if no newer availability event was applied.
    await this.setAvailability(tx, restaurant.id, restaurant.availability, at);
  }

  async setAvailability(
    tx: Queryable,
    id: string,
    availability: RestaurantAvailability | undefined,
    at: Date,
  ): Promise<void> {
    await tx
      .insert(searchRestaurants)
      .values({ id, ...availabilityValues(availability, at) })
      .onConflictDoUpdate({
        target: searchRestaurants.id,
        set: availabilityValues(availability, at),
        setWhere: newer(searchRestaurants.availabilityAt, at),
      });
  }

  async setHours(
    tx: Queryable,
    id: string,
    hours: DayHours[],
    closedDates: string[],
    at: Date,
  ): Promise<void> {
    const values = {
      hours: hours.map((d) => ({
        day: d.day,
        isOpen: d.isOpen,
        ranges: d.ranges.map((r) => ({ open: r.open, close: r.close })),
      })),
      closedDates,
      hoursAt: at,
    };
    await tx
      .insert(searchRestaurants)
      .values({ id, ...values })
      .onConflictDoUpdate({
        target: searchRestaurants.id,
        set: values,
        setWhere: newer(searchRestaurants.hoursAt, at),
      });
  }

  /** Replaces the restaurant's dishes when the menu version is newer. Returns false when stale. */
  async replaceMenu(tx: Tx, menu: Menu): Promise<boolean> {
    const claimed = await tx
      .insert(searchRestaurants)
      .values({ id: menu.restaurantId, menuVersion: menu.version })
      .onConflictDoUpdate({
        target: searchRestaurants.id,
        set: { menuVersion: menu.version },
        setWhere: lt(searchRestaurants.menuVersion, menu.version),
      })
      .returning({ id: searchRestaurants.id });
    if (claimed.length === 0) return false;
    await tx.delete(searchDishes).where(eq(searchDishes.restaurantId, menu.restaurantId));
    const rows = menu.sections.flatMap((section) =>
      section.items.map((item) => ({
        id: item.id,
        restaurantId: menu.restaurantId,
        snapshot: MenuItem.encode(item).finish(),
        name: normalise(item.name),
        description: normalise(item.description),
        soldOut: item.soldOut,
        soldOutUntil: item.soldOutUntil ?? null,
        sectionPosition: section.position,
        position: item.position,
      })),
    );
    // An item id is unique per catalog; if a dish moved restaurants, the newest menu wins.
    if (rows.length) {
      await tx
        .insert(searchDishes)
        .values(rows)
        .onConflictDoUpdate({
          target: searchDishes.id,
          set: {
            restaurantId: sql`excluded.restaurant_id`,
            snapshot: sql`excluded.snapshot`,
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            soldOut: sql`excluded.sold_out`,
            soldOutUntil: sql`excluded.sold_out_until`,
            sectionPosition: sql`excluded.section_position`,
            position: sql`excluded.position`,
          },
        });
    }
    return true;
  }

  /** Sold out / back in stock, unless a newer full menu already superseded it. */
  async setSoldOut(
    tx: Tx,
    event: {
      restaurantId: string;
      itemId: string;
      soldOut: boolean;
      soldOutUntil?: Date;
      menuVersion: number;
    },
  ): Promise<boolean> {
    const claimed = await tx
      .update(searchRestaurants)
      .set({ menuVersion: event.menuVersion })
      .where(
        and(
          eq(searchRestaurants.id, event.restaurantId),
          lt(searchRestaurants.menuVersion, event.menuVersion),
        ),
      )
      .returning({ id: searchRestaurants.id });
    if (claimed.length === 0) return false;
    const [dish] = await tx.select().from(searchDishes).where(eq(searchDishes.id, event.itemId));
    if (!dish) return true;
    const item = MenuItem.decode(dish.snapshot);
    item.soldOut = event.soldOut;
    item.soldOutUntil = event.soldOut ? event.soldOutUntil : undefined;
    await tx
      .update(searchDishes)
      .set({
        soldOut: event.soldOut,
        soldOutUntil: item.soldOutUntil ?? null,
        snapshot: MenuItem.encode(item).finish(),
      })
      .where(eq(searchDishes.id, event.itemId));
    return true;
  }

  /** Drops the whole projection (RebuildIndex). processed_events goes too, so a replay re-applies. */
  async truncate(tx: Tx): Promise<void> {
    await tx.execute(sql`truncate ${searchDishes}, ${searchRestaurants}, ${processedEvents}`);
  }

  async restaurantCount(q: Queryable): Promise<number> {
    const [row] = await q
      .select({ n: sql<number>`count(*)::int` })
      .from(searchRestaurants)
      .where(sql`${searchRestaurants.snapshot} is not null`);
    return row?.n ?? 0;
  }
}

function availabilityValues(a: RestaurantAvailability | undefined, at: Date) {
  return {
    availabilityState: a?.state ?? 0,
    availabilityOpensAt: a?.opensAt ?? null,
    availabilityAt: at,
    busyExtraMinutes: a?.busyExtraMinutes ?? 0,
  };
}
