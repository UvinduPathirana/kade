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
 * Every message we sent (or tried to). Enum columns hold the proto enum numbers so the row maps
 * 1:1 onto kade.notification.v1.Notification. ids are UUIDv7, so ordering by id = by creation time.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    channel: smallint("channel").notNull(),
    recipientKind: smallint("recipient_kind").notNull(),
    userId: text("user_id"),
    phone: text("phone"),
    email: text("email"),
    name: text("name"),
    template: text("template").notNull(),
    params: jsonb("params").$type<Record<string, string>>().notNull(),
    body: text("body").notNull(),
    status: smallint("status").notNull(),
    providerReference: text("provider_reference"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    referenceId: text("reference_id"),
    // Caller's idempotency key, or "evt:<event id>:<template>" for consumer-sent messages.
    idempotencyKey: text("idempotency_key"),
    sendAt: timestamp("send_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notifications_idempotency_key_uq").on(t.idempotencyKey),
    index("notifications_user_idx").on(t.userId, t.id),
    index("notifications_reference_idx").on(t.referenceId, t.id),
    index("notifications_due_idx").on(t.status, t.sendAt),
  ],
);

export const pushDevices = pgTable(
  "push_devices",
  {
    userId: text("user_id").notNull(),
    deviceId: text("device_id").notNull(),
    kind: smallint("kind").notNull(),
    platform: smallint("platform").notNull(),
    token: text("token").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceId] })],
);

/**
 * Who to tell about an order, from the full Order snapshots on kade.order.events (and the rider
 * from RiderAssigned). Progress events (PickedUp, Ready, Refunded) carry ids only, so the
 * templates read names and phone numbers from here.
 */
export const orderContacts = pgTable("order_contacts", {
  orderId: text("order_id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  customerId: text("customer_id").notNull(),
  customerName: text("customer_name").notNull().default(""),
  customerPhone: text("customer_phone").notNull().default(""),
  restaurantId: text("restaurant_id").notNull().default(""),
  restaurantName: text("restaurant_name").notNull().default(""),
  mode: smallint("mode").notNull().default(0),
  paymentKind: smallint("payment_kind").notNull().default(0),
  riderId: text("rider_id").notNull().default(""),
  riderName: text("rider_name").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { outbox, processedEvents, idempotencyKeys, notifications, pushDevices, orderContacts };
