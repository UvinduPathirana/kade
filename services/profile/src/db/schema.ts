import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
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

// ---------------------------------------------------------------------------------------------
// Platform tables: every service has these. Shapes are fixed by docs/backend/CONVENTIONS.md and by
// the Debezium outbox connector (debezium-connector.json); do not rename columns.
// ---------------------------------------------------------------------------------------------

export const outbox = pgTable("outbox", {
  id: uuid("id").primaryKey(), // event id, also used for consumer deduplication
  aggregatetype: text("aggregatetype").notNull(), // "customer" -> topic kade.customer.events
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
// kade.profile.v1: customers and everything hanging off them.
// ---------------------------------------------------------------------------------------------

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(), // Keycloak subject (x-user-id); not a UUID we mint
    name: text("name").notNull().default(""),
    phone: text("phone").notNull().default(""), // E.164
    email: text("email").notNull().default(""),
    area: text("area").notNull().default(""), // from the Home (or first) saved address
    referralCode: text("referral_code").notNull().default(""),
    joinedAt: ts("joined_at").notNull().defaultNow(),
    blocked: boolean("blocked").notNull().default(false),
    blockReason: text("block_reason").notNull().default(""),
    // Kadé credit: profile is the system of record; ledger mirrors it from CustomerCreditChanged.
    creditBalanceMinor: bigint("credit_balance_minor", { mode: "number" }).notNull().default(0),
    // Stats projected from kade.order.events (OrderDelivered / OrderCollected).
    ordersCount: integer("orders_count").notNull().default(0),
    spendMinor: bigint("spend_minor", { mode: "number" }).notNull().default(0),
    lastOrderAt: ts("last_order_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("customers_joined_at_idx").on(t.joinedAt)],
);

export const addresses = pgTable(
  "addresses",
  {
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    // UUIDv7 we mint, or a client-chosen id ("home", "work") the gateway passes through.
    id: text("id").notNull(),
    label: text("label").notNull(),
    line: text("line").notNull(),
    area: text("area").notNull().default(""),
    note: text("note").notNull().default(""),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    zoneId: text("zone_id").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.id] })],
);

export const waitlist = pgTable(
  "waitlist",
  {
    customerId: text("customer_id").notNull(),
    placeId: text("place_id").notNull(),
    placeName: text("place_name").notNull().default(""),
    area: text("area").notNull().default(""),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.placeId] })],
);

export const favourites = pgTable(
  "favourites",
  {
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    restaurantId: text("restaurant_id").notNull(),
    addedAt: ts("added_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.restaurantId] })],
);

export const preferences = pgTable("preferences", {
  customerId: text("customer_id")
    .primaryKey()
    .references(() => customers.id, { onDelete: "cascade" }),
  marketingSms: boolean("marketing_sms").notNull().default(false),
  marketingEmail: boolean("marketing_email").notNull().default(false),
  orderUpdatesPush: boolean("order_updates_push").notNull().default(true),
  orderUpdatesSms: boolean("order_updates_sms").notNull().default(true),
  vegetarian: boolean("vegetarian").notNull().default(false),
  language: text("language").notNull().default("en"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const creditEntries = pgTable(
  "credit_entries",
  {
    id: uuid("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    at: ts("at").notNull().defaultNow(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(), // signed
    label: text("label").notNull().default(""),
    reason: integer("reason").notNull(), // kade.profile.v1.CreditReason
    orderId: text("order_id").notNull().default(""),
    ticketId: text("ticket_id").notNull().default(""),
    by: text("by").notNull().default(""),
    balanceAfterMinor: bigint("balance_after_minor", { mode: "number" }).notNull(),
  },
  (t) => [
    index("credit_entries_customer_at_idx").on(t.customerId, t.at),
    index("credit_entries_order_idx").on(t.customerId, t.orderId),
  ],
);

// A reversal for (customer, order) was processed, even if there was nothing to reverse. A late
// ORDER_SPEND for that order is then refused, so a spend that lands after its compensation can't
// leave the customer charged for a failed order.
export const creditReversals = pgTable(
  "credit_reversals",
  {
    customerId: text("customer_id").notNull(),
    orderId: text("order_id").notNull(),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.orderId] })],
);

export const plusMemberships = pgTable("plus_memberships", {
  customerId: text("customer_id")
    .primaryKey()
    .references(() => customers.id, { onDelete: "cascade" }),
  status: integer("status").notNull(), // kade.profile.v1.PlusStatus
  plan: integer("plan").notNull(), // kade.profile.v1.PlusPlan
  joinedAt: ts("joined_at").notNull(),
  trialEndsAt: ts("trial_ends_at").notNull(),
  endsAt: ts("ends_at"),
  cardId: text("card_id").notNull().default(""),
  cardLabel: text("card_label").notNull().default(""),
  priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const fraudFlags = pgTable(
  "fraud_flags",
  {
    id: uuid("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    kind: integer("kind").notNull(), // kade.profile.v1.FraudFlagKind
    detail: text("detail").notNull(),
    raisedAt: ts("raised_at").notNull().defaultNow(),
    status: integer("status").notNull(), // kade.profile.v1.FraudFlagStatus
    resolution: text("resolution").notNull().default(""),
    resolvedBy: text("resolved_by").notNull().default(""),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [index("fraud_flags_customer_idx").on(t.customerId, t.status)],
);

// Risk signals from other services' events (refunds, customer cancellations, card declines); the
// fraud rules count these in a sliding window.
export const riskSignals = pgTable(
  "risk_signals",
  {
    eventId: uuid("event_id").primaryKey(),
    customerId: text("customer_id").notNull(),
    kind: integer("kind").notNull(), // FraudFlagKind the signal counts towards
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull().default(0),
    at: ts("at").notNull(),
  },
  (t) => [index("risk_signals_customer_kind_at_idx").on(t.customerId, t.kind, t.at)],
);

// ---------------------------------------------------------------------------------------------
// kade.identity.v1: phone OTP, staff and the audit log.
// ---------------------------------------------------------------------------------------------

export const phoneChallenges = pgTable(
  "phone_challenges",
  {
    id: uuid("id").primaryKey(),
    phone: text("phone").notNull(),
    app: integer("app").notNull(), // kade.identity.v1.SignInApp
    codeHash: text("code_hash").notNull(), // sha256(id + code); the code itself is never stored
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("phone_challenges_phone_created_idx").on(t.phone, t.createdAt)],
);

export const staff = pgTable("staff", {
  // Keycloak subject when the account exists there (demo staff users), else a UUIDv7.
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: integer("role").notNull(), // kade.identity.v1.StaffRole
  title: text("title").notNull().default(""),
  status: integer("status").notNull(), // kade.identity.v1.StaffStatus
  lastActiveAt: ts("last_active_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    role: integer("role").notNull(),
    permissionId: text("permission_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.role, t.permissionId] })],
);

export const auditEntries = pgTable(
  "audit_entries",
  {
    id: uuid("id").primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actorUserId: text("actor_user_id").notNull().default(""),
    actorRoles: text("actor_roles").array().notNull().default([]),
    actorOutletId: text("actor_outlet_id").notNull().default(""),
    actorName: text("actor_name").notNull().default(""),
    action: text("action").notNull(),
    recordType: integer("record_type").notNull(), // kade.identity.v1.AuditRecordType
    recordId: text("record_id").notNull().default(""),
    detail: text("detail").notNull().default(""),
  },
  (t) => [
    index("audit_entries_at_idx").on(t.at),
    index("audit_entries_record_idx").on(t.recordType, t.recordId),
    index("audit_entries_actor_idx").on(t.actorUserId),
  ],
);

// One row per one-off seed step that already ran (so restarts never duplicate demo data).
export const seedRuns = pgTable("seed_runs", {
  name: text("name").primaryKey(),
  ranAt: ts("ran_at").notNull().defaultNow(),
});

export const schema = {
  outbox,
  processedEvents,
  idempotencyKeys,
  customers,
  addresses,
  waitlist,
  favourites,
  preferences,
  creditEntries,
  creditReversals,
  plusMemberships,
  fraudFlags,
  riskSignals,
  phoneChallenges,
  staff,
  rolePermissions,
  auditEntries,
  seedRuns,
};
