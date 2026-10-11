import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
});

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

// ---------------------------------------------------------------------------------------------
// Platform tables (docs/backend/CONVENTIONS.md). search publishes no events, but the template's
// OutboxWriter and IdempotencyStore expect these tables; they stay empty.
// ---------------------------------------------------------------------------------------------

export const outbox = pgTable("outbox", {
  id: uuid("id").primaryKey(),
  aggregatetype: text("aggregatetype").notNull(),
  aggregateid: text("aggregateid").notNull(),
  type: text("type").notNull(),
  payload: bytea("payload").notNull(),
  traceparent: text("traceparent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const processedEvents = pgTable("processed_events", {
  eventId: uuid("event_id").primaryKey(),
  handledAt: timestamp("handled_at", { withTimezone: true }).notNull().defaultNow(),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: bytea("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

// ---------------------------------------------------------------------------------------------
// The projection: built from kade.restaurant.events and kade.menu.events (CQRS read model).
// Text columns hold normalised text (lowercase, accents stripped); tsvectors are generated from
// them with both the 'simple' (exact/prefix) and 'english' (stemmed: "buns" → "bun") configs.
// ---------------------------------------------------------------------------------------------

export interface HoursDay {
  day: number;
  isOpen: boolean;
  ranges: { open: string; close: string }[];
}

export const searchRestaurants = pgTable(
  "search_restaurants",
  {
    id: uuid("id").primaryKey(),
    // Latest kade.catalog.v1.Restaurant snapshot; null until RestaurantCreated/Updated arrives.
    snapshot: bytea("snapshot"),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }),
    // Feed order of the seed (apps' numeric ids) / creation order: the tie-breaker in results.
    createdAt: timestamp("created_at", { withTimezone: true }),
    name: text("name").notNull().default(""),
    // name + cuisine + category label + area, normalised.
    searchText: text("search_text").notNull().default(""),
    nameSimple: tsvector("name_simple").generatedAlwaysAs(sql`to_tsvector('simple'::regconfig, name)`),
    nameEnglish: tsvector("name_english").generatedAlwaysAs(sql`to_tsvector('english'::regconfig, name)`),
    docSimple: tsvector("doc_simple").generatedAlwaysAs(sql`to_tsvector('simple'::regconfig, search_text)`),
    docEnglish: tsvector("doc_english").generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, search_text)`,
    ),
    lat: doublePrecision("lat").notNull().default(0),
    lng: doublePrecision("lng").notNull().default(0),
    // Base availability from the latest snapshot / RestaurantAvailabilityChanged (AvailabilityState).
    availabilityState: integer("availability_state").notNull().default(0),
    availabilityOpensAt: timestamp("availability_opens_at", { withTimezone: true }),
    availabilityAt: timestamp("availability_at", { withTimezone: true }),
    busyExtraMinutes: integer("busy_extra_minutes").notNull().default(0),
    hours: jsonb("hours").$type<HoursDay[]>().notNull().default([]),
    closedDates: text("closed_dates").array().notNull().default([]),
    hoursAt: timestamp("hours_at", { withTimezone: true }),
    menuVersion: bigint("menu_version", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    index("search_restaurants_doc_simple_idx").using("gin", t.docSimple),
    index("search_restaurants_doc_english_idx").using("gin", t.docEnglish),
    index("search_restaurants_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

export const searchDishes = pgTable(
  "search_dishes",
  {
    id: uuid("id").primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    // kade.catalog.v1.MenuItem snapshot.
    snapshot: bytea("snapshot").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    nameSimple: tsvector("name_simple").generatedAlwaysAs(sql`to_tsvector('simple'::regconfig, name)`),
    nameEnglish: tsvector("name_english").generatedAlwaysAs(sql`to_tsvector('english'::regconfig, name)`),
    docSimple: tsvector("doc_simple").generatedAlwaysAs(
      sql`to_tsvector('simple'::regconfig, name || ' ' || description)`,
    ),
    docEnglish: tsvector("doc_english").generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, name || ' ' || description)`,
    ),
    soldOut: boolean("sold_out").notNull().default(false),
    soldOutUntil: timestamp("sold_out_until", { withTimezone: true }),
    sectionPosition: integer("section_position").notNull().default(0),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("search_dishes_restaurant_idx").on(t.restaurantId),
    index("search_dishes_doc_simple_idx").using("gin", t.docSimple),
    index("search_dishes_doc_english_idx").using("gin", t.docEnglish),
    index("search_dishes_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

/** Address picker places (seeded from the customer app's mock). */
export const places = pgTable(
  "places",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    detail: text("detail").notNull(),
    area: text("area").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    inZone: boolean("in_zone").notNull(),
    zoneId: text("zone_id").notNull().default(""),
    position: integer("position").notNull(),
  },
  (t) => [index("places_name_trgm_idx").using("gin", sql`lower(${t.name}) gin_trgm_ops`)],
);

export const popularSearches = pgTable("popular_searches", {
  query: text("query").primaryKey(),
  position: integer("position").notNull(),
});

export const schema = {
  outbox,
  processedEvents,
  idempotencyKeys,
  searchRestaurants,
  searchDishes,
  places,
  popularSearches,
};
