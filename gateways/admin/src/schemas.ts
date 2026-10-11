import { Type, type Static, type TSchema } from "typebox";

export { Enum };

// API schemas: exactly the shapes apps/admin/src/api returns (apps/admin/src/api/types.ts and the
// *View types), so the console's components don't change. Registered with app.addSchema() so the
// OpenAPI document gets named components (#/components/schemas/OrderView).
//
// Conventions: money is whole rupees (integer), instants are epoch milliseconds (the console's
// `number` times), whole days are ISO dates ("2026-10-12"), restaurant ids are numbers.

const Rupees = (description = "Whole rupees (LKR).") => Type.Integer({ description });
const Millis = (description = "Epoch milliseconds.") => Type.Integer({ description });
const IsoDate = () => Type.String({ description: "ISO date, Asia/Colombo.", examples: ["2026-10-12"] });
const Enum = <const V extends string[]>(values: readonly [...V], description?: string) =>
  Type.Enum(values, description ? { description } : {});
const Opt = Type.Optional;

export const Problem = Type.Object(
  {
    type: Type.String({ format: "uri" }),
    title: Type.String(),
    status: Type.Integer(),
    detail: Opt(Type.String({ description: "User-facing message; show as-is." })),
    code: Type.String({ description: "Stable machine code, e.g. ORDER_NOT_FOUND." }),
    instance: Opt(Type.String()),
    traceId: Opt(Type.String()),
  },
  { $id: "Problem", description: "RFC 9457 problem details (application/problem+json)." },
);

/* ---------- Zones and pricing ---------- */

export const Zone = Type.Object(
  {
    id: Type.String({ examples: ["c03"] }),
    code: Type.String({ examples: ["Colombo 03"] }),
    name: Type.String({ examples: ["Kollupitiya"] }),
    open: Type.Boolean(),
    baseFee: Rupees("Covers the first 2 km."),
    perKm: Rupees(),
    smallOrderFee: Rupees(),
    smallOrderUnder: Rupees("Orders under this subtotal pay the small-order fee."),
    ridersNeeded: Type.Integer(),
  },
  { $id: "Zone" },
);
export type Zone = Static<typeof Zone>;

export const SURCHARGE_DAYS = ["Every day", "Mon to Fri", "Fri to Sun", "Sat and Sun"] as const;
export const SurchargeRule = Type.Object(
  {
    id: Type.String(),
    label: Type.String(),
    days: Enum(SURCHARGE_DAYS),
    start: Type.String({ pattern: "^\\d{2}:\\d{2}$" }),
    end: Type.String({ pattern: "^\\d{2}:\\d{2}$" }),
    amount: Rupees(),
    enabled: Type.Boolean(),
  },
  { $id: "SurchargeRule" },
);
export type SurchargeRule = Static<typeof SurchargeRule>;

export const WeatherSurcharge = Type.Object(
  { enabled: Type.Boolean(), amount: Rupees() },
  { $id: "WeatherSurcharge" },
);
export type WeatherSurcharge = Static<typeof WeatherSurcharge>;

export const Pricing = Type.Object(
  {
    zones: Type.Array(ref(Zone)),
    surcharges: Type.Array(ref(SurchargeRule)),
    weather: ref(WeatherSurcharge),
  },
  { $id: "Pricing" },
);
export type Pricing = Static<typeof Pricing>;

/* ---------- Partners ---------- */

export const DocField = Type.Object({ label: Type.String(), value: Type.String() });

export const ReviewDoc = Type.Object(
  {
    id: Type.String(),
    kind: Type.String({ description: 'Display name, e.g. "Revenue licence".' }),
    fileName: Type.String(),
    status: Enum(["pending", "approved", "rejected"]),
    rejectReason: Opt(Type.String()),
    expiresOn: Opt(IsoDate()),
    fields: Type.Array(DocField),
  },
  { $id: "ReviewDoc" },
);
export type ReviewDoc = Static<typeof ReviewDoc>;

export const RESTAURANT_STATUSES = ["open", "paused", "suspended", "closed"] as const;
export const Restaurant = Type.Object(
  {
    id: Type.Integer({ description: "Console restaurant number (seeded outlets 1–16)." }),
    name: Type.String(),
    area: Type.String(),
    zoneId: Type.String(),
    cuisine: Type.String(),
    imageId: Type.String(),
    rating: Type.Number(),
    ordersWeek: Type.Integer(),
    acceptanceRate: Type.Number({ description: "0–1" }),
    commission: Type.Number({ description: "Percent." }),
    status: Enum(RESTAURANT_STATUSES),
    statusReason: Opt(Type.String()),
    accepting: Type.Boolean(),
    waitingMinutes: Opt(Type.Integer()),
    owner: Type.String(),
    phone: Type.String(),
    email: Type.String(),
    joinedOn: IsoDate(),
    bank: Type.String(),
    etaMin: Type.Integer(),
    hasOffer: Type.Boolean(),
    category: Type.String(),
  },
  { $id: "Restaurant" },
);
export type Restaurant = Static<typeof Restaurant>;

export const APPLICATION_STATUSES = ["pending", "changesRequested", "approved", "rejected"] as const;
export const RestaurantApplication = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    area: Type.String(),
    zoneId: Type.String(),
    cuisine: Type.String(),
    owner: Type.String(),
    phone: Type.String(),
    email: Type.String(),
    submittedAt: Millis(),
    status: Enum(APPLICATION_STATUSES),
    decisionNote: Opt(Type.String()),
    documents: Type.Array(ref(ReviewDoc)),
  },
  { $id: "RestaurantApplication" },
);
export type RestaurantApplication = Static<typeof RestaurantApplication>;

export const VEHICLES = ["motorbike", "tukTuk", "bicycle"] as const;
export const RIDER_STATUSES = ["online", "onJob", "offline", "suspended"] as const;
export const Rider = Type.Object(
  {
    id: Type.String({ examples: ["R-101"] }),
    name: Type.String(),
    phone: Type.String(),
    vehicle: Enum(VEHICLES),
    status: Enum(RIDER_STATUSES),
    statusReason: Opt(Type.String()),
    zoneIds: Type.Array(Type.String()),
    rating: Type.Number(),
    acceptanceRate: Type.Number(),
    cashHeld: Rupees(),
    cashLimit: Rupees(),
    tripsWeek: Type.Integer(),
    joinedOn: IsoDate(),
    documents: Type.Array(ref(ReviewDoc)),
    pos: Type.Object({ zoneId: Type.String(), x: Type.Number(), y: Type.Number() }),
  },
  { $id: "Rider" },
);
export type Rider = Static<typeof Rider>;

export const RiderApplication = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    phone: Type.String(),
    vehicle: Enum(VEHICLES),
    zoneIds: Type.Array(Type.String()),
    submittedAt: Millis(),
    status: Enum(APPLICATION_STATUSES),
    decisionNote: Opt(Type.String()),
    documents: Type.Array(ref(ReviewDoc)),
  },
  { $id: "RiderApplication" },
);
export type RiderApplication = Static<typeof RiderApplication>;

/* ---------- Orders ---------- */

export const ORDER_STATUSES = [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "pickedUp",
  "delivered",
  "cancelled",
  "rejected",
] as const;
export const FAULTS = ["customer", "restaurant", "rider", "kade"] as const;
export const Party = Type.Object({ id: Type.String(), name: Type.String(), phone: Type.String() });

export const OrderView = Type.Object(
  {
    id: Type.String({ description: "Order number.", examples: ["KD-4821"] }),
    placedAt: Millis(),
    status: Enum(ORDER_STATUSES),
    customerId: Type.String(),
    restaurantId: Type.Integer(),
    riderId: Opt(Type.String()),
    zoneId: Type.String(),
    address: Type.String(),
    payment: Enum(["card", "cash"]),
    cardLast4: Opt(Type.String()),
    lines: Type.Array(Type.Object({ name: Type.String(), qty: Type.Integer(), price: Rupees("Each.") })),
    subtotal: Rupees(),
    deliveryFee: Rupees("Delivery plus small-order fee."),
    discount: Rupees("Restaurant offer plus promo."),
    promoCode: Opt(Type.String()),
    total: Rupees(),
    dueAt: Millis("Latest time the customer was promised."),
    deliveredAt: Opt(Millis()),
    distanceKm: Type.Number(),
    timeline: Type.Array(Type.Object({ at: Millis(), label: Type.String(), by: Opt(Type.String()) })),
    notes: Type.Array(
      Type.Object({ id: Type.String(), at: Millis(), author: Type.String(), body: Type.String() }),
    ),
    refunded: Rupees(),
    cancel: Opt(Type.Object({ reason: Type.String(), fault: Enum(FAULTS), by: Type.String() })),
    pos: Type.Object({ x: Type.Number(), y: Type.Number() }),
    restaurant: Type.Object({
      id: Type.String(),
      name: Type.String(),
      phone: Type.String(),
      area: Type.String(),
    }),
    customer: Type.Object({
      id: Type.String(),
      name: Type.String(),
      phone: Type.String(),
      email: Type.String(),
    }),
    rider: Opt(Party),
    zone: Type.Object({ code: Type.String(), name: Type.String() }),
    lateMin: Type.Integer({ description: "Minutes past dueAt while still active; 0 otherwise." }),
  },
  { $id: "OrderView" },
);
export type OrderView = Static<typeof OrderView>;

export const NearbyRider = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    vehicle: Enum(VEHICLES),
    status: Enum(RIDER_STATUSES),
    zoneCode: Type.String(),
    km: Type.Number(),
    cashHeld: Rupees(),
    rating: Type.Number(),
  },
  { $id: "NearbyRider" },
);
export type NearbyRider = Static<typeof NearbyRider>;

/* ---------- Customers ---------- */

export const Refund = Type.Object(
  {
    id: Type.String(),
    at: Millis(),
    orderId: Type.String({ description: "Order number." }),
    customerId: Type.String(),
    amount: Rupees(),
    method: Enum(["card", "credit"]),
    reason: Type.String(),
    by: Type.String(),
  },
  { $id: "Refund" },
);
export type Refund = Static<typeof Refund>;

export const FraudFlag = Type.Object(
  {
    id: Type.String(),
    kind: Enum(["refunds", "cancellations", "paymentFailures"]),
    detail: Type.String(),
    raisedAt: Millis(),
    status: Enum(["open", "cleared", "actioned"]),
    resolution: Opt(Type.String()),
  },
  { $id: "FraudFlag" },
);

const customerFields = {
  id: Type.String(),
  name: Type.String(),
  phone: Type.String(),
  email: Type.String(),
  area: Type.String(),
  joinedOn: IsoDate(),
  ordersCount: Type.Integer(),
  spend: Rupees(),
  credit: Rupees(),
  blocked: Type.Boolean(),
  blockReason: Opt(Type.String()),
  flags: Type.Array(ref(FraudFlag)),
  creditHistory: Type.Array(
    Type.Object({
      id: Type.String(),
      at: Millis(),
      amount: Rupees(),
      reason: Type.String(),
      by: Type.String(),
    }),
  ),
  refundCount: Type.Integer(),
  refundTotal: Rupees(),
  cancelCount: Type.Integer(),
  openFlags: Type.Integer(),
  lastOrderAt: Opt(Millis()),
};

export const CustomerView = Type.Object(customerFields, {
  $id: "CustomerView",
  description: "List rows carry no flags or credit history (see CustomerDetail); openFlags is exact.",
});
export type CustomerView = Static<typeof CustomerView>;

export const CustomerDetail = Type.Object(
  {
    ...customerFields,
    orders: Type.Array(
      Type.Object({
        id: Type.String(),
        placedAt: Millis(),
        restaurantName: Type.String(),
        total: Rupees(),
        status: Enum(ORDER_STATUSES),
        refunded: Rupees(),
      }),
    ),
    refunds: Type.Array(ref(Refund)),
  },
  { $id: "CustomerDetail" },
);
export type CustomerDetail = Static<typeof CustomerDetail>;

/* ---------- Finance ---------- */

const payoutLine = {
  restaurantId: Type.Integer(),
  orders: Type.Integer(),
  gross: Rupees(),
  commission: Rupees(),
  adjustments: Rupees(),
  net: Rupees(),
};
export const PayoutBatchView = Type.Object(
  {
    id: Type.String(),
    week: Type.String({ examples: ["28 Sep to 4 Oct"] }),
    payDate: IsoDate(),
    status: Enum(["draft", "approved", "paid"]),
    approvedBy: Opt(Type.String()),
    lines: Type.Array(
      Type.Object({
        ...payoutLine,
        restaurantName: Type.String(),
        commissionRate: Type.Number(),
        bank: Type.String(),
      }),
    ),
    totals: Type.Object({
      gross: Rupees(),
      commission: Rupees(),
      adjustments: Rupees(),
      net: Rupees(),
      orders: Type.Integer(),
    }),
  },
  { $id: "PayoutBatchView" },
);
export type PayoutBatchView = Static<typeof PayoutBatchView>;

export const SettlementView = Type.Object(
  {
    riderId: Type.String(),
    riderName: Type.String(),
    week: Type.String(),
    trips: Type.Integer(),
    earnings: Rupees(),
    cashHeld: Rupees(),
    net: Rupees("Positive: Kadé pays the rider. Negative: the rider owes Kadé."),
    status: Enum(["open", "settled"]),
  },
  { $id: "SettlementView" },
);
export type SettlementView = Static<typeof SettlementView>;

export const CashView = Type.Object(
  {
    id: Type.String(),
    riderId: Type.String(),
    riderName: Type.String(),
    date: IsoDate(),
    collected: Rupees(),
    deposited: Type.Union([Rupees(), Type.Null()]),
    bankRef: Opt(Type.String()),
    difference: Type.Union([Rupees(), Type.Null()]),
    state: Enum(["matched", "short", "over", "awaiting"]),
  },
  { $id: "CashView" },
);
export type CashView = Static<typeof CashView>;

export const RefundView = Type.Object(
  {
    id: Type.String(),
    at: Millis(),
    orderId: Type.String(),
    customerId: Type.String(),
    amount: Rupees(),
    method: Enum(["card", "credit"]),
    reason: Type.String(),
    by: Type.String(),
    customerName: Type.String(),
  },
  { $id: "RefundView" },
);
export type RefundView = Static<typeof RefundView>;

/* ---------- Promotions ---------- */

export const VOUCHER_TYPES = ["fixed", "percent", "freeDelivery"] as const;
export const VOUCHER_STATUSES = ["active", "scheduled", "paused", "ended"] as const;
const voucherInput = {
  code: Type.String(),
  description: Type.String(),
  type: Enum(VOUCHER_TYPES),
  value: Type.Number({ description: "Rupees for fixed, percent for percent, 0 for free delivery." }),
  maxDiscount: Opt(Type.Number()),
  minOrder: Rupees(),
  restaurantIds: Type.Array(Type.Integer(), { description: "Empty means every restaurant." }),
  newCustomersOnly: Type.Boolean(),
  startsOn: IsoDate(),
  endsOn: IsoDate(),
  limit: Type.Integer(),
  budget: Rupees(),
};
export const NewVoucher = Type.Object(voucherInput, { $id: "NewVoucher" });
export type NewVoucher = Static<typeof NewVoucher>;
export const Voucher = Type.Object(
  { ...voucherInput, uses: Type.Integer(), spent: Rupees(), status: Enum(VOUCHER_STATUSES) },
  { $id: "Voucher" },
);
export type Voucher = Static<typeof Voucher>;

/* ---------- Support ---------- */

export const TICKET_CATEGORIES = [
  "missingItem",
  "wrongItem",
  "late",
  "payment",
  "rider",
  "account",
  "restaurant",
] as const;
export const TICKET_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export const Ticket = Type.Object(
  {
    id: Type.String(),
    subject: Type.String(),
    category: Enum(TICKET_CATEGORIES),
    priority: Enum(TICKET_PRIORITIES),
    requester: Type.Object({
      kind: Enum(["customer", "rider", "restaurant"]),
      id: Type.String(),
      name: Type.String(),
    }),
    orderId: Opt(Type.String({ description: "Order number." })),
    openedAt: Millis(),
    slaDueAt: Millis(),
    assigneeId: Opt(Type.String()),
    status: Enum(["open", "pending", "resolved"]),
    resolution: Opt(Type.String()),
    messages: Type.Array(
      Type.Object({
        id: Type.String(),
        at: Millis(),
        from: Enum(["requester", "agent", "system"]),
        author: Type.String(),
        body: Type.String(),
      }),
    ),
  },
  { $id: "Ticket" },
);
export type Ticket = Static<typeof Ticket>;

export const Macro = Type.Object(
  { id: Type.String(), title: Type.String(), body: Type.String() },
  { $id: "Macro" },
);

export const ROLES = ["admin", "ops", "finance", "support"] as const;
export const StaffName = Type.Object(
  { id: Type.String(), name: Type.String(), role: Enum(ROLES) },
  { $id: "StaffName" },
);

/* ---------- Home feed ---------- */

export const HomeCategory = Type.Object(
  { id: Type.String(), label: Type.String(), imageId: Type.String(), visible: Type.Boolean() },
  { $id: "HomeCategory" },
);
export type HomeCategory = Static<typeof HomeCategory>;

export const CollectionRule = Type.Object({
  category: Opt(Type.String()),
  minRating: Opt(Type.Number()),
  maxEta: Opt(Type.Integer()),
  offersOnly: Opt(Type.Boolean()),
});
const collectionFields = {
  title: Type.String(),
  subtitle: Type.String(),
  placement: Enum(["banner", "shelf"]),
  source: Enum(["rules", "handPicked"]),
  rule: Opt(CollectionRule),
  restaurantIds: Type.Array(Type.Integer()),
  startsOn: IsoDate(),
  endsOn: Opt(IsoDate()),
  visible: Type.Boolean(),
};
export const Collection = Type.Object({ id: Type.String(), ...collectionFields }, { $id: "Collection" });
export type Collection = Static<typeof Collection>;
export const SaveCollection = Type.Object(
  { id: Opt(Type.String({ description: "Empty or absent: create." })), ...collectionFields },
  { $id: "SaveCollection" },
);

export const HomeContent = Type.Object(
  {
    categories: Type.Array(ref(HomeCategory)),
    collections: Type.Array(ref(Collection)),
    restaurants: Type.Array(
      Type.Object({
        id: Type.Integer(),
        name: Type.String(),
        category: Type.String(),
        rating: Type.Number(),
        etaMin: Type.Integer(),
        hasOffer: Type.Boolean(),
        imageId: Type.String(),
        area: Type.String(),
        status: Enum(RESTAURANT_STATUSES),
      }),
    ),
    images: Type.Array(Type.Object({ name: Type.String(), id: Type.String() })),
  },
  { $id: "HomeContent" },
);
export type HomeContent = Static<typeof HomeContent>;

/* ---------- Team and audit ---------- */

export const Staff = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    email: Type.String(),
    role: Enum(ROLES),
    title: Type.String(),
    lastActiveAt: Opt(Millis()),
    status: Enum(["active", "invited"]),
  },
  { $id: "Staff" },
);
export type Staff = Static<typeof Staff>;

export const PermissionMatrix = Type.Object(
  {
    admin: Type.Array(Type.String()),
    ops: Type.Array(Type.String()),
    finance: Type.Array(Type.String()),
    support: Type.Array(Type.String()),
  },
  { $id: "PermissionMatrix" },
);
export type PermissionMatrix = Static<typeof PermissionMatrix>;

export const Permissions = Type.Object(
  {
    permissions: Type.Array(Type.Object({ id: Type.String(), label: Type.String(), group: Type.String() })),
    matrix: ref(PermissionMatrix),
  },
  { $id: "Permissions" },
);

export const AUDIT_RECORD_TYPES = [
  "order",
  "restaurant",
  "rider",
  "customer",
  "payout",
  "zone",
  "voucher",
  "ticket",
  "content",
  "team",
] as const;
export type AuditRecordType = (typeof AUDIT_RECORD_TYPES)[number];
export const AuditEntry = Type.Object(
  {
    id: Type.String(),
    at: Millis(),
    actor: Type.String(),
    action: Type.String(),
    recordType: Enum(AUDIT_RECORD_TYPES),
    recordId: Type.String(),
    detail: Opt(Type.String()),
  },
  { $id: "AuditEntry" },
);
export type AuditEntry = Static<typeof AuditEntry>;

export const Me = Type.Object(
  {
    id: Type.String({ description: "Same id the staff list and ticket assignees use." }),
    name: Type.String(),
    short: Type.String({ description: "First name." }),
    email: Type.String(),
    role: Enum(ROLES),
    roles: Type.Array(Enum(ROLES)),
    title: Type.String(),
    permissions: Type.Array(Type.String(), { description: "Effective permission ids." }),
  },
  { $id: "Me" },
);
export type Me = Static<typeof Me>;

/* ---------- Live dashboard ---------- */

export const ATTENTION_KINDS = ["lateOrder", "restaurantNotAccepting", "riderCash", "ridersShort"] as const;
export const DOT_KINDS = ["waiting", "onTheWay", "late", "rider"] as const;
export const LiveSnapshot = Type.Object(
  {
    at: Millis(),
    inProgress: Type.Integer(),
    waitingForRider: Type.Integer(),
    late: Type.Integer(),
    ridersOnline: Type.Integer(),
    ridersNeeded: Type.Integer(),
    shortestZone: Opt(Type.Object({ code: Type.String(), short: Type.Integer() })),
    avgDeliveryMin: Type.Integer(),
    cancellationsToday: Type.Integer(),
    ordersToday: Type.Integer(),
    attention: Type.Array(
      Type.Object({
        id: Type.String(),
        kind: Enum(ATTENTION_KINDS),
        title: Type.String(),
        detail: Type.String(),
        severity: Type.Integer(),
        href: Type.String(),
        phone: Opt(Type.String()),
      }),
    ),
    ordersByHour: Type.Array(
      Type.Object({ hour: Type.Integer(), today: Type.Integer(), lastWeek: Type.Integer() }),
    ),
    dots: Type.Array(
      Type.Object({
        id: Type.String(),
        kind: Enum(DOT_KINDS),
        zoneId: Type.String(),
        x: Type.Number(),
        y: Type.Number(),
        label: Type.String(),
      }),
    ),
    zones: Type.Array(
      Type.Object({
        id: Type.String(),
        orders: Type.Integer(),
        riders: Type.Integer(),
        open: Type.Boolean(),
      }),
    ),
  },
  { $id: "LiveSnapshot" },
);
export type LiveSnapshot = Static<typeof LiveSnapshot>;

export const sharedSchemas = [
  Problem,
  Zone,
  SurchargeRule,
  WeatherSurcharge,
  Pricing,
  ReviewDoc,
  Restaurant,
  RestaurantApplication,
  Rider,
  RiderApplication,
  OrderView,
  NearbyRider,
  Refund,
  FraudFlag,
  CustomerView,
  CustomerDetail,
  PayoutBatchView,
  SettlementView,
  CashView,
  RefundView,
  NewVoucher,
  Voucher,
  Ticket,
  Macro,
  StaffName,
  HomeCategory,
  Collection,
  SaveCollection,
  HomeContent,
  Staff,
  PermissionMatrix,
  Permissions,
  AuditEntry,
  Me,
  LiveSnapshot,
];

/** A typed $ref to a registered schema: OpenAPI sees a reference, handlers keep the static type. */
export function ref<T extends TSchema>(schema: T) {
  const id = (schema as { $id?: string }).$id;
  if (!id) throw new Error("ref() needs a schema with an $id (and app.addSchema)");
  return Type.Unsafe<Static<T>>(Type.Ref(id));
}

/** Error responses for a route, documented as application/problem+json. */
export function problems(...statuses: number[]) {
  return Object.fromEntries(
    statuses.map((s) => [s, { content: { "application/problem+json": { schema: ref(Problem) } } }]),
  );
}

/** 200 with an array of a registered schema. */
export const listOf = <T extends TSchema>(schema: T) => Type.Array(ref(schema));
