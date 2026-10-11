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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
});

// ---------------------------------------------------------------------------------------------
// Platform tables: every service has these. Shapes are fixed by docs/backend/CONVENTIONS.md and by
// the Debezium outbox connector (debezium-connector.json); do not rename columns.
// ---------------------------------------------------------------------------------------------

export const outbox = pgTable("outbox", {
  id: uuid("id").primaryKey(), // event id, also used for consumer deduplication
  aggregatetype: text("aggregatetype").notNull(), // 'restaurant' -> topic kade.restaurant.events
  aggregateid: text("aggregateid").notNull(), // Kafka key
  type: text("type").notNull(), // fully-qualified proto message name
  payload: bytea("payload").notNull(), // protobuf-encoded event
  traceparent: text("traceparent"), // W3C trace context, copied into a Kafka header
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
// Catalog tables
// ---------------------------------------------------------------------------------------------

/** One opening range in 24h local (Asia/Colombo) time; close earlier than open = next morning. */
export interface HoursRange {
  open: string;
  close: string;
}
/** day: 1 = Monday … 7 = Sunday (kade.common.v1.DayOfWeek). */
export interface HoursDay {
  day: number;
  isOpen: boolean;
  ranges: HoursRange[];
}
export interface ChoiceJson {
  id: string;
  name: string;
  priceMinor: number;
}
export interface CollectionRuleJson {
  categoryId?: string;
  minRating?: number;
  maxEtaMinutes?: number;
  offersOnly?: boolean;
}

/** Food categories on the home rail. Admin can rename, hide and reorder them. */
export const categories = pgTable("categories", {
  id: text("id").primaryKey(), // slug, e.g. "kottu"
  label: text("label").notNull(),
  imageId: text("image_id").notNull().default(""),
  visible: boolean("visible").notNull().default(true),
  position: integer("position").notNull(),
});

export const restaurants = pgTable(
  "restaurants",
  {
    id: uuid("id").primaryKey(), // = merchant outlet_id
    // The apps' numeric id (1..16 for the seed); new restaurants get the next number.
    legacyId: integer("legacy_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: integer("kind").notNull().default(1), // RestaurantKind
    categoryId: text("category_id").notNull(),
    cuisine: text("cuisine").notNull().default(""),
    imageId: text("image_id").notNull().default(""),
    // Base delivery window (prep + typical ride), before busy mode.
    etaMinMinutes: integer("eta_min_minutes").notNull(),
    etaMaxMinutes: integer("eta_max_minutes").notNull(),
    // Fallback fee when pricing is unreachable (the customer app's mock fee), minor units.
    baseDeliveryFeeMinor: bigint("base_delivery_fee_minor", { mode: "number" }).notNull().default(0),
    rating: doublePrecision("rating").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    priceLevel: integer("price_level").notNull().default(1),
    offerId: text("offer_id").notNull().default(""),
    offerLabel: text("offer_label").notNull().default(""),
    discountPercent: integer("discount_percent").notNull().default(0),
    freeDeliveryOffer: boolean("free_delivery_offer").notNull().default(false),
    hasVegetarian: boolean("has_vegetarian").notNull().default(false),
    area: text("area").notNull().default(""),
    address: text("address").notNull().default(""),
    phone: text("phone").notNull().default(""),
    lat: doublePrecision("lat").notNull().default(0),
    lng: doublePrecision("lng").notNull().default(0),
    zoneId: text("zone_id").notNull().default(""),
    // Owned by merchant (kade.merchant.events): busy mode, pause, ops status.
    busyExtraMinutes: integer("busy_extra_minutes").notNull().default(0),
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    adminStatus: text("admin_status").notNull().default("open"), // open | suspended
    adminStatusReason: text("admin_status_reason").notNull().default(""),
    hours: jsonb("hours").$type<HoursDay[]>().notNull(),
    menuVersion: bigint("menu_version", { mode: "number" }).notNull().default(1),
    menuUpdatedAt: timestamp("menu_updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("restaurants_legacy_id_key").on(t.legacyId),
    uniqueIndex("restaurants_slug_key").on(t.slug),
    index("restaurants_category_idx").on(t.categoryId),
  ],
);

export const closures = pgTable(
  "closures",
  {
    id: uuid("id").primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // ISO date, Asia/Colombo
    reason: text("reason").notNull().default(""),
  },
  (t) => [uniqueIndex("closures_restaurant_date_key").on(t.restaurantId, t.date)],
);

export const menuSections = pgTable(
  "menu_sections",
  {
    id: uuid("id").primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("menu_sections_restaurant_idx").on(t.restaurantId)],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => menuSections.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
    imageId: text("image_id").notNull().default(""),
    tags: integer("tags").array().notNull().default([]), // DishTag values
    optionGroupIds: text("option_group_ids").array().notNull().default([]),
    popularRank: integer("popular_rank").notNull().default(0),
    soldOut: boolean("sold_out").notNull().default(false),
    // Null while sold out = until switched back on; otherwise resets at this instant.
    soldOutUntil: timestamp("sold_out_until", { withTimezone: true }),
    unit: text("unit").notNull().default(""),
    position: integer("position").notNull(),
    // The apps' mock id ("1-0-0"), for seeded dishes only.
    legacyId: text("legacy_id"),
  },
  (t) => [
    index("menu_items_restaurant_idx").on(t.restaurantId),
    index("menu_items_section_idx").on(t.sectionId),
  ],
);

export const optionGroups = pgTable(
  "option_groups",
  {
    id: uuid("id").primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    // The apps' option group key ("spice", "kottuExtras"), for seeded groups.
    slug: text("slug").notNull().default(""),
    name: text("name").notNull(),
    required: boolean("required").notNull().default(false),
    maxChoices: integer("max_choices").notNull().default(1),
    choices: jsonb("choices").$type<ChoiceJson[]>().notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("option_groups_restaurant_idx").on(t.restaurantId)],
);

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  placement: integer("placement").notNull(), // CollectionPlacement
  source: integer("source").notNull(), // CollectionSource
  rule: jsonb("rule").$type<CollectionRuleJson>().notNull().default({}),
  restaurantIds: text("restaurant_ids").array().notNull().default([]),
  startsOn: text("starts_on").notNull().default(""),
  endsOn: text("ends_on").notNull().default(""),
  visible: boolean("visible").notNull().default(true),
  position: integer("position").notNull(),
});

/** Which seed versions have been applied, so deleting seeded data in the app sticks across restarts. */
export const seedRuns = pgTable("seed_runs", {
  version: integer("version").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  outbox,
  processedEvents,
  idempotencyKeys,
  categories,
  restaurants,
  closures,
  menuSections,
  menuItems,
  optionGroups,
  collections,
  seedRuns,
};
