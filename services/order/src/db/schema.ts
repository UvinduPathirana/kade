import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgSequence,
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
// Order tables. The full kade.order.v1.Order (and GroupOrder, Refund) is stored as proto3 JSON in
// `data`: one shape for the API, the events and the database, so a new field never needs a
// migration. The scalar columns beside it mirror the fields we filter and sort on; the repository
// writes both from the same object on every save.
// ---------------------------------------------------------------------------------------------

// Human order numbers KD-5001, KD-5002, … (seeded demo history uses KD-2xxx..KD-4xxx).
export const orderNumberSeq = pgSequence("order_number_seq", { startWith: 5001 });

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey(), // UUIDv7 = Temporal workflow id
    orderNumber: text("order_number").notNull(),
    status: integer("status").notNull(), // kade.order.v1.OrderStatus
    mode: integer("mode").notNull(), // kade.common.v1.FulfilmentMode
    customerId: text("customer_id").notNull(),
    customerName: text("customer_name").notNull().default(""),
    customerPhone: text("customer_phone").notNull().default(""),
    restaurantId: text("restaurant_id").notNull(),
    riderId: text("rider_id"),
    zoneId: text("zone_id"),
    paymentKind: integer("payment_kind").notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    refundedMinor: bigint("refunded_minor", { mode: "number" }).notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    // PlaceOrderRequest as proto3 JSON: the saga's input.
    request: jsonb("request").notNull(),
    // kade.order.v1.Order as proto3 JSON.
    data: jsonb("data").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("orders_order_number_key").on(t.orderNumber),
    uniqueIndex("orders_idempotency_key").on(t.customerId, t.idempotencyKey),
    index("orders_customer_idx").on(t.customerId, t.createdAt),
    index("orders_restaurant_idx").on(t.restaurantId, t.createdAt),
    index("orders_rider_idx").on(t.riderId, t.createdAt),
    index("orders_status_idx").on(t.status, t.createdAt),
  ],
);

export const orderRefunds = pgTable(
  "order_refunds",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    method: integer("method").notNull(), // kade.common.v1.RefundMethod
    // kade.order.v1.Refund as proto3 JSON.
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("order_refunds_idempotency_key").on(t.orderId, t.idempotencyKey),
    index("order_refunds_order_idx").on(t.orderId, t.createdAt),
  ],
);

export const groupOrders = pgTable(
  "group_orders",
  {
    id: uuid("id").primaryKey(),
    shareToken: text("share_token").notNull(),
    status: integer("status").notNull(), // kade.order.v1.GroupOrderStatus
    hostCustomerId: text("host_customer_id").notNull(),
    restaurantId: text("restaurant_id").notNull(),
    idempotencyKey: text("idempotency_key"),
    // kade.order.v1.GroupOrder as proto3 JSON.
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("group_orders_share_token_key").on(t.shareToken),
    uniqueIndex("group_orders_idempotency_key").on(t.hostCustomerId, t.idempotencyKey),
  ],
);

export const schema = { outbox, processedEvents, idempotencyKeys, orders, orderRefunds, groupOrders };
