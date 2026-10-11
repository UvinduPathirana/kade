import {
  bigint,
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
// Service tables. Enum columns hold kade.support.v1 enum numbers; money is LKR minor units.
// ---------------------------------------------------------------------------------------------

export interface StoredResolution {
  kind: number;
  amountMinor: number;
  method: number;
  summary: string;
  note: string;
  externalRef: string;
  resolvedBy: string;
  resolvedAt: string;
}

export interface StoredAttachedOrder {
  orderId: string;
  orderNumber: string;
  restaurantName: string;
  totalMinor: number;
}

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey(),
    subject: text("subject").notNull(),
    category: smallint("category").notNull(),
    priority: smallint("priority").notNull(),
    requesterKind: smallint("requester_kind").notNull(),
    requesterId: text("requester_id").notNull(),
    requesterName: text("requester_name").notNull(),
    orderId: text("order_id"),
    orderNumber: text("order_number"),
    channel: smallint("channel").notNull(),
    status: smallint("status").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }).notNull(),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    // Set when TicketSlaBreached was published, so it is published once per SLA period.
    slaBreachedAt: timestamp("sla_breached_at", { withTimezone: true }),
    assigneeId: text("assignee_id"),
    assigneeName: text("assignee_name"),
    resolution: jsonb("resolution").$type<StoredResolution>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("tickets_status_idx").on(t.status, t.openedAt),
    index("tickets_requester_idx").on(t.requesterId, t.openedAt),
    index("tickets_order_idx").on(t.orderId),
    index("tickets_sla_idx").on(t.slaDueAt),
  ],
);

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: uuid("id").primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull(),
    fromKind: smallint("from_kind").notNull(),
    author: text("author").notNull(),
    body: text("body").notNull(),
    attachedOrder: jsonb("attached_order").$type<StoredAttachedOrder>(),
  },
  (t) => [index("ticket_messages_ticket_idx").on(t.ticketId, t.at)],
);

/** One problem report per order (customer app "Get help with this order"). */
export const orderIssues = pgTable("order_issues", {
  orderId: text("order_id").primaryKey(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => tickets.id),
  customerId: text("customer_id").notNull(),
  kind: smallint("kind").notNull(),
  lines: jsonb("lines").$type<{ lineKey: string; quantity: number }[]>().notNull(),
  note: text("note").notNull().default(""),
  photoRef: text("photo_ref").notNull().default(""),
  photoName: text("photo_name").notNull().default(""),
  resolution: smallint("resolution").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
  refundId: text("refund_id").notNull().default(""),
});

export const macros = pgTable("macros", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  position: integer("position").notNull().default(0),
});

export const schema = {
  outbox,
  processedEvents,
  idempotencyKeys,
  tickets,
  ticketMessages,
  orderIssues,
  macros,
};
