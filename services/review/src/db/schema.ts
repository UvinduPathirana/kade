import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
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
  aggregatetype: text("aggregatetype").notNull(), // 'note' -> topic kade.note.events
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
    // e.g. "CreateNote:<user id>" so two callers can never collide on the same key.
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: bytea("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

// ---------------------------------------------------------------------------------------------
// Service tables
// ---------------------------------------------------------------------------------------------

/**
 * Orders that may be rated, from OrderDelivered / OrderCollected (or fetched from order when the
 * event hasn't arrived yet). Snapshots the names a review needs so we never call order back.
 */
export const rateableOrders = pgTable("rateable_orders", {
  orderId: text("order_id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  customerId: text("customer_id").notNull(),
  customerName: text("customer_name").notNull().default(""),
  restaurantId: text("restaurant_id").notNull(),
  restaurantName: text("restaurant_name").notNull().default(""),
  riderId: text("rider_id").notNull().default(""),
  // Drop-off neighbourhood for the rider's ratings screen.
  area: text("area").notNull().default(""),
  // [{ itemId, name }] in order-line order.
  dishes: jsonb("dishes").$type<{ itemId: string; name: string }[]>().notNull().default([]),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
});

/** The customer's rating of one order (one per order; replaceable for 7 days). */
export const orderRatings = pgTable(
  "order_ratings",
  {
    orderId: text("order_id").primaryKey(),
    orderNumber: text("order_number").notNull(),
    customerId: text("customer_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    riderId: text("rider_id").notNull().default(""),
    riderStars: smallint("rider_stars").notNull().default(0),
    riderTags: text("rider_tags").array().notNull().default([]),
    restaurantStars: smallint("restaurant_stars").notNull().default(0),
    comment: text("comment").notNull().default(""),
    area: text("area").notNull().default(""),
    // First submission; replacements keep it (the 7-day window runs from here).
    firstRatedAt: timestamp("first_rated_at", { withTimezone: true }).notNull(),
    ratedAt: timestamp("rated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("order_ratings_restaurant_idx").on(t.restaurantId, t.ratedAt),
    index("order_ratings_rider_idx").on(t.riderId, t.ratedAt),
  ],
);

export const dishRatings = pgTable(
  "dish_ratings",
  {
    orderId: text("order_id").notNull(),
    itemId: text("item_id").notNull(),
    itemName: text("item_name").notNull().default(""),
    restaurantId: text("restaurant_id").notNull(),
    // kade.review.v1.Thumb: 1 up, 2 down.
    thumb: smallint("thumb").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.itemId] }),
    index("dish_ratings_restaurant_idx").on(t.restaurantId),
  ],
);

/**
 * Public restaurant reviews. Derived from an order rating with restaurant stars, or imported
 * (seeded) history without an order rating behind it. One editable reply from the outlet.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey(),
    orderId: text("order_id").unique(),
    restaurantId: text("restaurant_id").notNull(),
    customerName: text("customer_name").notNull(),
    dish: text("dish").notNull().default(""),
    stars: smallint("stars").notNull(),
    text: text("text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    replyText: text("reply_text"),
    replyAt: timestamp("reply_at", { withTimezone: true }),
    replyBy: text("reply_by"),
  },
  (t) => [index("reviews_restaurant_idx").on(t.restaurantId, t.createdAt)],
);

/**
 * Ratings from before this service existed (the apps' historical numbers). Summaries are
 * baseline + live ratings, so a restaurant with "3k+" ratings doesn't restart at zero.
 * breakdown: counts by stars, index 0 = 5 stars … 4 = 1 star (proto RatingSummary order).
 */
export const ratingBaselines = pgTable(
  "rating_baselines",
  {
    subjectKind: text("subject_kind").notNull(), // 'restaurant' | 'rider'
    subjectId: text("subject_id").notNull(),
    count: integer("count").notNull(),
    starSum: integer("star_sum").notNull(),
    breakdown: integer("breakdown").array().notNull(),
    compliments: jsonb("compliments").$type<{ label: string; count: number }[]>().notNull().default([]),
    improve: jsonb("improve").$type<{ label: string; detail: string }[]>().notNull().default([]),
  },
  (t) => [primaryKey({ columns: [t.subjectKind, t.subjectId] })],
);

/** The rider's thumbs on the customer and the restaurant after a trip. */
export const tripFeedback = pgTable("trip_feedback", {
  deliveryId: text("delivery_id").primaryKey(),
  orderId: text("order_id").notNull(),
  riderId: text("rider_id").notNull(),
  customer: smallint("customer").notNull().default(0),
  restaurant: smallint("restaurant").notNull().default(0),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
});

export const schema = {
  outbox,
  processedEvents,
  idempotencyKeys,
  rateableOrders,
  orderRatings,
  dishRatings,
  reviews,
  ratingBaselines,
  tripFeedback,
};
