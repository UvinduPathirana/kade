import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  categories,
  closures,
  collections,
  menuItems,
  menuSections,
  optionGroups,
  restaurants,
} from "../db/schema.js";
import type { Queryable, Tx } from "../platform/db/database.js";
import { notFound } from "../platform/grpc/errors.js";
import { parseRestaurantRef } from "./ids.js";
import type { ClosureRow, MenuRows, RestaurantRow } from "./model.js";
import { invalidArgument } from "../platform/grpc/errors.js";

/**
 * Data access for the catalog. Methods take the Queryable/Tx explicitly so callers decide the
 * transaction boundary (state + outbox commit together).
 */
@Injectable()
export class CatalogStore {
  // ---------- restaurants ----------

  /** Resolves a UUID or the apps' bare number. Undefined when it doesn't exist. */
  async findRestaurant(
    q: Queryable,
    ref: string,
    opts: { lock?: boolean } = {},
  ): Promise<RestaurantRow | undefined> {
    const parsed = parseRestaurantRef(ref);
    if (!parsed) return undefined;
    const where = "id" in parsed ? eq(restaurants.id, parsed.id) : eq(restaurants.legacyId, parsed.legacyId);
    const query = q.select().from(restaurants).where(where);
    const [row] = opts.lock ? await query.for("update") : await query;
    return row;
  }

  /** Like findRestaurant, but throws INVALID_ARGUMENT / NOT_FOUND. */
  async requireRestaurant(q: Queryable, ref: string, opts: { lock?: boolean } = {}): Promise<RestaurantRow> {
    if (!parseRestaurantRef(ref)) {
      throw invalidArgument("RESTAURANT_ID_INVALID", "Restaurant id must be a UUID.", {
        field: "restaurant_id",
      });
    }
    const row = await this.findRestaurant(q, ref, opts);
    if (!row)
      throw notFound("RESTAURANT_NOT_FOUND", "We couldn't find that restaurant.", { restaurant_id: ref });
    return row;
  }

  async listRestaurants(
    q: Queryable,
    filter: { categoryId?: string; vegetarianOnly?: boolean; offersOnly?: boolean; ids?: string[] } = {},
  ): Promise<RestaurantRow[]> {
    const conds = [];
    if (filter.categoryId) conds.push(eq(restaurants.categoryId, filter.categoryId));
    if (filter.vegetarianOnly) conds.push(eq(restaurants.hasVegetarian, true));
    if (filter.offersOnly) conds.push(sql`${restaurants.offerLabel} <> ''`);
    if (filter.ids) {
      if (filter.ids.length === 0) return [];
      conds.push(inArray(restaurants.id, filter.ids));
    }
    return q
      .select()
      .from(restaurants)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(restaurants.legacyId));
  }

  async nextLegacyId(tx: Tx): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number>`coalesce(max(${restaurants.legacyId}), 0)` })
      .from(restaurants);
    return Number(row?.max ?? 0) + 1;
  }

  async slugTaken(q: Queryable, slug: string): Promise<boolean> {
    const rows = await q.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.slug, slug));
    return rows.length > 0;
  }

  async updateRestaurant(
    tx: Tx,
    id: string,
    patch: Partial<typeof restaurants.$inferInsert>,
  ): Promise<RestaurantRow> {
    const [row] = await tx
      .update(restaurants)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(restaurants.id, id))
      .returning();
    if (!row) throw new Error(`restaurant ${id} vanished`);
    return row;
  }

  // ---------- closures ----------

  async closuresFor(q: Queryable, restaurantIds: string[]): Promise<Map<string, ClosureRow[]>> {
    const map = new Map<string, ClosureRow[]>();
    if (restaurantIds.length === 0) return map;
    const rows = await q
      .select()
      .from(closures)
      .where(inArray(closures.restaurantId, restaurantIds))
      .orderBy(asc(closures.date));
    for (const row of rows) {
      const list = map.get(row.restaurantId) ?? [];
      list.push(row);
      map.set(row.restaurantId, list);
    }
    return map;
  }

  async closuresOf(q: Queryable, restaurantId: string): Promise<ClosureRow[]> {
    return (await this.closuresFor(q, [restaurantId])).get(restaurantId) ?? [];
  }

  // ---------- menus ----------

  async menuRows(q: Queryable, restaurant: RestaurantRow): Promise<MenuRows> {
    // Sequential: inside a transaction all three share one connection.
    const sections = await q.select().from(menuSections).where(eq(menuSections.restaurantId, restaurant.id));
    const items = await q.select().from(menuItems).where(eq(menuItems.restaurantId, restaurant.id));
    const groups = await q.select().from(optionGroups).where(eq(optionGroups.restaurantId, restaurant.id));
    return { restaurant, sections, items, groups };
  }

  /** Every menu item of the restaurant (ValidateCart). */
  async itemsByIds(q: Queryable, restaurantId: string, ids: string[]) {
    if (ids.length === 0) return [];
    return q
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.restaurantId, restaurantId), inArray(menuItems.id, ids)));
  }

  /** Bumps the menu version (the restaurant row must already be locked by the caller). */
  async bumpMenuVersion(tx: Tx, restaurantId: string): Promise<RestaurantRow> {
    const [row] = await tx
      .update(restaurants)
      .set({ menuVersion: sql`${restaurants.menuVersion} + 1`, menuUpdatedAt: new Date() })
      .where(eq(restaurants.id, restaurantId))
      .returning();
    if (!row) throw new Error(`restaurant ${restaurantId} vanished`);
    return row;
  }

  // ---------- categories & collections ----------

  async categories(q: Queryable) {
    return q.select().from(categories).orderBy(asc(categories.position));
  }

  async collections(q: Queryable) {
    return q.select().from(collections).orderBy(asc(collections.position));
  }
}
