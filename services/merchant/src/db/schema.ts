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
  aggregatetype: text("aggregatetype").notNull(), // 'merchant' -> topic kade.merchant.events
  aggregateid: text("aggregateid").notNull(), // Kafka key (outlet id)
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
    // e.g. "AcceptOrder:<outlet id>" so two callers can never collide on the same key.
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: bytea("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

// ---------------------------------------------------------------------------------------------
// Merchant tables
// ---------------------------------------------------------------------------------------------

/** Snapshot of the bank account. The full number never leaves the service after onboarding. */
export interface BankJson {
  bank: string;
  branch: string;
  accountName: string;
  accountLast4: string;
}

/** OutletSettings in proto3 JSON (OutletSettings.toJSON). */
export type SettingsJson = Record<string, unknown>;

/** A restaurant partner's outlet. id = catalog restaurant_id. */
export const outlets = pgTable(
  "outlets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    area: text("area").notNull().default(""),
    address: text("address").notNull().default(""),
    phone: text("phone").notNull().default(""),
    zoneId: text("zone_id").notNull().default(""),
    cuisine: text("cuisine").notNull().default(""),
    categoryId: text("category_id").notNull().default(""),
    imageId: text("image_id").notNull().default(""),
    ownerName: text("owner_name").notNull().default(""),
    ownerPhone: text("owner_phone").notNull().default(""),
    ownerEmail: text("owner_email").notNull().default(""),
    // Kitchen controls
    busyExtraMinutes: integer("busy_extra_minutes").notNull().default(0),
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    // Ops controls: open | paused | suspended | closed
    adminStatus: text("admin_status").notNull().default("open"),
    adminStatusReason: text("admin_status_reason").notNull().default(""),
    // Tablet connectivity. `accepting` is the last published value (so changes emit one event).
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    tabletDeviceId: text("tablet_device_id"),
    accepting: boolean("accepting").notNull().default(true),
    commissionBps: integer("commission_bps").notNull().default(1800),
    bank: jsonb("bank").$type<BankJson>(),
    settings: jsonb("settings").$type<SettingsJson>().notNull(),
    // Display figures for the admin console before there is real order history.
    rating: doublePrecision("rating").notNull().default(0),
    baseOrdersWeek: integer("base_orders_week").notNull().default(0),
    baseAcceptanceRate: doublePrecision("base_acceptance_rate").notNull().default(1),
    etaMinMinutes: integer("eta_min_minutes").notNull().default(25),
    hasOffer: boolean("has_offer").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("outlets_zone_idx").on(t.zoneId), index("outlets_admin_status_idx").on(t.adminStatus)],
);

/** Outlet team. user_id = Keycloak sub once linked; null while an invite is pending. */
export const outletStaff = pgTable(
  "outlet_staff",
  {
    id: uuid("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    userId: text("user_id"),
    name: text("name").notNull(),
    // E.164 without spaces, e.g. +94771234567
    phone: text("phone").notNull(),
    role: text("role").notNull(), // owner | manager | kitchen
    pending: boolean("pending").notNull().default(true),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("outlet_staff_outlet_phone_uq").on(t.outletId, t.phone),
    uniqueIndex("outlet_staff_outlet_user_uq").on(t.outletId, t.userId),
    index("outlet_staff_user_idx").on(t.userId),
  ],
);

export interface TicketLineJson {
  itemId: string;
  name: string;
  quantity: number;
  choiceNames: string[];
  note: string;
  unitPriceMinor: number;
}

export interface TicketRiderJson {
  riderId: string;
  name: string;
  vehicle: string;
  plate: string;
  maskedPhone: string;
}

/**
 * Kitchen tickets: a projection of kade.order.events (+ rider info from kade.delivery.events) plus the
 * kitchen's own decisions. source = 'order' for real orders, 'demo' for the seeded evening board
 * (handled locally, never published).
 */
export const tickets = pgTable(
  "tickets",
  {
    orderId: text("order_id").primaryKey(),
    outletId: text("outlet_id").notNull(),
    source: text("source").notNull().default("order"),
    orderNumber: text("order_number").notNull(),
    ticketNumber: text("ticket_number").notNull(),
    // new | preparing | ready | picked_up | missed | rejected | cancelled
    status: text("status").notNull(),
    mode: text("mode").notNull(), // delivery | pickup
    customerId: text("customer_id").notNull().default(""),
    customerFirstName: text("customer_first_name").notNull().default(""),
    repeatCount: integer("repeat_count").notNull().default(0),
    lines: jsonb("lines").$type<TicketLineJson[]>().notNull(),
    kitchenNote: text("kitchen_note").notNull().default(""),
    cutlery: boolean("cutlery").notNull().default(false),
    payment: text("payment").notNull().default("card"), // card | cash
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
    acceptBy: timestamp("accept_by", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    prepMinutes: integer("prep_minutes").notNull().default(0),
    readyBy: timestamp("ready_by", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    rejectReason: text("reject_reason"), // too_busy | sold_out | closing_soon | other | timeout
    rejectNote: text("reject_note").notNull().default(""),
    deliveryId: text("delivery_id"),
    rider: jsonb("rider").$type<TicketRiderJson>(),
    riderArrivesAt: timestamp("rider_arrives_at", { withTimezone: true }),
    riderAtCounter: boolean("rider_at_counter").notNull().default(false),
    // Staff who took the last kitchen action (for the audit trail; Actor in events).
    actedBy: text("acted_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tickets_outlet_open_idx").on(t.outletId, t.closedAt),
    index("tickets_outlet_placed_idx").on(t.outletId, t.placedAt),
    index("tickets_status_accept_by_idx").on(t.status, t.acceptBy),
  ],
);

/** Partner onboarding applications. Sub-messages are stored as proto3 JSON. */
export const partnerApplications = pgTable(
  "partner_applications",
  {
    id: uuid("id").primaryKey(),
    reference: text("reference").notNull(),
    ownerPhone: text("owner_phone").notNull(),
    business: jsonb("business").$type<Record<string, unknown>>().notNull(),
    owner: jsonb("owner").$type<Record<string, unknown>>().notNull(),
    documents: jsonb("documents").$type<Record<string, unknown>[]>().notNull(),
    bank: jsonb("bank").$type<BankJson>(),
    // Full account number for the first payout set-up; never returned by reads.
    bankAccountNumber: text("bank_account_number"),
    menu: jsonb("menu").$type<Record<string, unknown>>(),
    status: text("status").notNull(), // pending | changes_requested | approved | rejected
    decisionNote: text("decision_note").notNull().default(""),
    zoneId: text("zone_id").notNull().default(""),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    outletId: text("outlet_id"),
  },
  (t) => [
    uniqueIndex("partner_applications_reference_uq").on(t.reference),
    index("partner_applications_phone_idx").on(t.ownerPhone),
    index("partner_applications_status_idx").on(t.status, t.submittedAt),
  ],
);

/** Bookkeeping for the demo board (when it was last laid out). */
export const demoSeeds = pgTable("demo_seeds", {
  key: text("key").primaryKey(),
  seededAt: timestamp("seeded_at", { withTimezone: true }).notNull(),
});

export const schema = {
  outbox,
  processedEvents,
  idempotencyKeys,
  outlets,
  outletStaff,
  tickets,
  partnerApplications,
  demoSeeds,
};
