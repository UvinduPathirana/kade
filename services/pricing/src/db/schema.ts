import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  doublePrecision,
  integer,
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
// Pricing rules. Money columns are int64 minor units (LKR cents), like kade.common.v1.Money.
// ---------------------------------------------------------------------------------------------

/**
 * Delivery zones. Ids are the ops console slugs ("c03", "deh"), shared with catalog, order, dispatch
 * and the gateways (docs/backend/CONVENTIONS.md). Geometry is a centre and a radius: a point belongs
 * to the nearest zone centre within that zone's radius (ResolveZone).
 */
export const zones = pgTable("zones", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  open: boolean("open").notNull().default(true),
  baseFeeMinor: bigint("base_fee_minor", { mode: "number" }).notNull(),
  perKmMinor: bigint("per_km_minor", { mode: "number" }).notNull(),
  smallOrderFeeMinor: bigint("small_order_fee_minor", { mode: "number" }).notNull(),
  smallOrderUnderMinor: bigint("small_order_under_minor", { mode: "number" }).notNull(),
  ridersNeeded: integer("riders_needed").notNull().default(0),
  centerLat: doublePrecision("center_lat").notNull(),
  centerLng: doublePrecision("center_lng").notNull(),
  radiusKm: doublePrecision("radius_km").notNull(),
  // Display order in the ops console (north to south, as the mock data lists them).
  position: integer("position").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Time-window delivery surcharges ("Dinner peak"), evaluated in Asia/Colombo. */
export const surchargeRules = pgTable("surcharge_rules", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  // every_day | mon_to_fri | fri_to_sun | sat_and_sun
  days: text("days").notNull(),
  // 24h "19:00"
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Single-row table (id = 1): the heavy-rain toggle, the Plus threshold and the rules version. */
export const pricingSettings = pgTable(
  "pricing_settings",
  {
    id: smallint("id").primaryKey(),
    // Increments on every rule change; quotes record it.
    rulesVersion: bigint("rules_version", { mode: "number" }).notNull().default(1),
    weatherEnabled: boolean("weather_enabled").notNull().default(false),
    weatherAmountMinor: bigint("weather_amount_minor", { mode: "number" }).notNull(),
    plusFreeDeliveryFromMinor: bigint("plus_free_delivery_from_minor", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("pricing_settings_single_row", sql`${t.id} = 1`)],
);

export const schema = { outbox, processedEvents, idempotencyKeys, zones, surchargeRules, pricingSettings };
