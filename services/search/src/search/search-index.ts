import { Inject, Injectable } from "@nestjs/common";
import {
  AvailabilityState,
  MenuItem,
  Restaurant,
  type RestaurantAvailability,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import type { GeoPoint } from "@kade/proto/kade/common/v1/types";
import { asc, inArray, sql } from "drizzle-orm";
import { places, popularSearches, searchRestaurants } from "../db/schema.js";
import { Database } from "../platform/db/database.js";
import { distanceKm, roundKm } from "./geo.js";
import { computeAvailability, hoursLabel } from "./hours.js";
import { normalise, prefixQuery, queryWords } from "./text.js";

export const CLOCK = Symbol("CLOCK");
export type Clock = () => Date;

/** Below this, a fuzzy (trigram) match is noise. Only used when full-text finds nothing. */
const FUZZY_THRESHOLD = 0.45;
const DISH_CANDIDATES = 1000;

type RestaurantRow = typeof searchRestaurants.$inferSelect;

export interface RestaurantHit {
  restaurant: Restaurant;
  nameMatch: boolean;
  /** Feed order tie-breaker (seed order, then creation order). */
  order: [number, string];
}

export interface DishCandidate {
  item: MenuItem;
  restaurantId: string;
  nameMatch: boolean;
  sectionPosition: number;
  position: number;
}

export const isOpen = (r: Restaurant): boolean =>
  r.availability?.state === AvailabilityState.AVAILABILITY_STATE_OPEN;

/** The projection's availability inputs → the same rules catalog applies. */
export function availabilityFor(row: RestaurantRow, now: Date): RestaurantAvailability {
  const opensAt = row.availabilityOpensAt;
  let adminStatus = "open";
  let pausedUntil: Date | null = null;
  switch (row.availabilityState) {
    case AvailabilityState.AVAILABILITY_STATE_SUSPENDED:
      adminStatus = "suspended";
      break;
    case AvailabilityState.AVAILABILITY_STATE_PAUSED:
      if (opensAt) pausedUntil = opensAt;
      else adminStatus = "paused";
      break;
    case AvailabilityState.AVAILABILITY_STATE_CLOSED:
      // Closed with no next opening = closed by ops; otherwise it is just outside its hours,
      // which we recompute below because "open now" changes without events.
      if (!opensAt) adminStatus = "closed";
      break;
  }
  return computeAvailability(
    {
      hours: row.hours,
      closedDates: new Set(row.closedDates),
      adminStatus,
      pausedUntil,
      busyExtraMinutes: row.busyExtraMinutes,
    },
    now,
  );
}

/** A Restaurant for the customer: snapshot + live availability, today's hours and distance. */
export function restaurantView(row: RestaurantRow, now: Date, deliverTo: GeoPoint | undefined): Restaurant {
  const restaurant = Restaurant.decode(row.snapshot!);
  restaurant.availability = availabilityFor(row, now);
  restaurant.hoursLabel = row.hours.length
    ? hoursLabel(row.hours, new Set(row.closedDates), now)
    : restaurant.hoursLabel;
  restaurant.distanceKm =
    deliverTo && (deliverTo.lat !== 0 || deliverTo.lng !== 0) && (row.lat !== 0 || row.lng !== 0)
      ? roundKm(distanceKm(deliverTo, { lat: row.lat, lng: row.lng }))
      : 0;
  restaurant.deliveryFee = undefined;
  return restaurant;
}

/** Sold out only while sold_out_until (the next opening) is ahead, as in catalog. */
export function effectiveSoldOut(item: MenuItem, now: Date): boolean {
  return item.soldOut && (!item.soldOutUntil || item.soldOutUntil.getTime() > now.getTime());
}

/** Read side of the projection: full-text first, trigram similarity as the typo fallback. */
@Injectable()
export class SearchIndex {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  now(): Date {
    return this.clock();
  }

  async find(query: string): Promise<{
    restaurants: { row: RestaurantRow; nameMatch: boolean }[];
    dishes: DishCandidate[];
    rows: Map<string, RestaurantRow>;
  }> {
    const words = queryWords(query);
    if (words.length === 0) return { restaurants: [], dishes: [], rows: new Map() };
    const tsq = prefixQuery(words);
    const db = this.database.db;

    const restaurantMatches = await db.execute<{ id: string; name_match: boolean }>(sql`
      select id, (name_simple @@ to_tsquery('simple', ${tsq}) or name_english @@ to_tsquery('english', ${tsq})) as name_match
      from search_restaurants
      where snapshot is not null
        and (doc_simple @@ to_tsquery('simple', ${tsq}) or doc_english @@ to_tsquery('english', ${tsq}))`);
    const dishMatches = await db.execute<DishSqlRow>(sql`
      select d.id, d.restaurant_id, d.snapshot, d.section_position, d.position,
        (d.name_simple @@ to_tsquery('simple', ${tsq}) or d.name_english @@ to_tsquery('english', ${tsq})) as name_match
      from search_dishes d
      join search_restaurants r on r.id = d.restaurant_id and r.snapshot is not null
      where d.doc_simple @@ to_tsquery('simple', ${tsq}) or d.doc_english @@ to_tsquery('english', ${tsq})
      limit ${DISH_CANDIDATES}`);

    let restaurantIds = restaurantMatches.rows.map((r) => ({ id: r.id, nameMatch: r.name_match }));
    let dishRows = dishMatches.rows;
    if (restaurantIds.length === 0 && dishRows.length === 0) {
      // Typos ("biriyani", "kotu"): nearest names by trigram word similarity.
      const q = normalise(words.join(" "));
      const fuzzyRestaurants = await db.execute<{ id: string }>(sql`
        select id from search_restaurants
        where snapshot is not null and word_similarity(${q}, name) >= ${FUZZY_THRESHOLD}
        order by word_similarity(${q}, name) desc limit 20`);
      const fuzzyDishes = await db.execute<DishSqlRow>(sql`
        select d.id, d.restaurant_id, d.snapshot, d.section_position, d.position, true as name_match
        from search_dishes d
        join search_restaurants r on r.id = d.restaurant_id and r.snapshot is not null
        where word_similarity(${q}, d.name) >= ${FUZZY_THRESHOLD}
        order by word_similarity(${q}, d.name) desc
        limit ${DISH_CANDIDATES}`);
      restaurantIds = fuzzyRestaurants.rows.map((r) => ({ id: r.id, nameMatch: true }));
      dishRows = fuzzyDishes.rows;
    }

    const ids = [...new Set([...restaurantIds.map((r) => r.id), ...dishRows.map((d) => d.restaurant_id)])];
    const rows = new Map<string, RestaurantRow>();
    if (ids.length) {
      for (const row of await db.select().from(searchRestaurants).where(inArray(searchRestaurants.id, ids)))
        rows.set(row.id, row);
    }
    return {
      restaurants: restaurantIds.flatMap((r) => {
        const row = rows.get(r.id);
        return row ? [{ row, nameMatch: r.nameMatch }] : [];
      }),
      dishes: dishRows.map((d) => ({
        item: MenuItem.decode(toBytes(d.snapshot)),
        restaurantId: d.restaurant_id,
        nameMatch: d.name_match,
        sectionPosition: d.section_position,
        position: d.position,
      })),
      rows,
    };
  }

  async popularSearches(): Promise<string[]> {
    const rows = await this.database.db.select().from(popularSearches).orderBy(asc(popularSearches.position));
    return rows.map((r) => r.query);
  }

  async places() {
    return this.database.db.select().from(places).orderBy(asc(places.position));
  }
}

interface DishSqlRow extends Record<string, unknown> {
  id: string;
  restaurant_id: string;
  snapshot: Buffer | string;
  section_position: number;
  position: number;
  name_match: boolean;
}

function toBytes(v: Buffer | string): Uint8Array {
  // node-postgres returns bytea as Buffer; a string means hex output ("\x...").
  return typeof v === "string" ? Buffer.from(v.replace(/^\\x/, ""), "hex") : v;
}
