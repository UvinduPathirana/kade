// Shapes returned by the ops API. Each block names the service that will own it.

export type Payment = "card" | "cash";

/* ---------- Zones and pricing (pricing service) ---------- */

export interface Zone {
  id: string;
  /** "Colombo 03" or "Dehiwala". */
  code: string;
  /** Neighbourhood customers know it by: "Kollupitiya". */
  name: string;
  open: boolean;
  /** Covers the first 2 km. */
  baseFee: number;
  perKm: number;
  smallOrderFee: number;
  /** Orders under this subtotal pay the small-order fee. */
  smallOrderUnder: number;
  /** Riders the dispatch model wants online right now. */
  ridersNeeded: number;
}

export interface SurchargeRule {
  id: string;
  label: string;
  days: "Every day" | "Mon to Fri" | "Fri to Sun" | "Sat and Sun";
  /** 24h "19:00". */
  start: string;
  end: string;
  amount: number;
  enabled: boolean;
}

export interface WeatherSurcharge {
  enabled: boolean;
  amount: number;
}

/* ---------- Restaurants (partner service) ---------- */

export type RestaurantStatus = "open" | "paused" | "suspended" | "closed";

export interface Restaurant {
  id: number;
  name: string;
  area: string;
  zoneId: string;
  cuisine: string;
  imageId: string;
  rating: number;
  ordersWeek: number;
  /** 0–1 */
  acceptanceRate: number;
  /** Percent. Kadé's default is 18. */
  commission: number;
  status: RestaurantStatus;
  statusReason?: string;
  /** True while the tablet is online and taking orders. */
  accepting: boolean;
  /** Minutes the oldest unaccepted order has waited, when the kitchen isn't responding. */
  waitingMinutes?: number;
  owner: string;
  phone: string;
  email: string;
  joinedOn: string;
  bank: string;
  etaMin: number;
  hasOffer: boolean;
  category: string;
}

export type DocStatus = "pending" | "approved" | "rejected";

export interface ReviewDoc {
  id: string;
  kind: string;
  fileName: string;
  status: DocStatus;
  rejectReason?: string;
  /** ISO date, for documents that expire. */
  expiresOn?: string;
  /** What's printed on it, shown in the viewer. */
  fields: { label: string; value: string }[];
}

export type ApplicationStatus = "pending" | "changesRequested" | "approved" | "rejected";

export interface RestaurantApplication {
  id: string;
  name: string;
  area: string;
  zoneId: string;
  cuisine: string;
  owner: string;
  phone: string;
  email: string;
  submittedAt: number;
  status: ApplicationStatus;
  decisionNote?: string;
  documents: ReviewDoc[];
}

/* ---------- Riders (rider service) ---------- */

export type RiderStatus = "online" | "onJob" | "offline" | "suspended";
export type Vehicle = "motorbike" | "tukTuk" | "bicycle";

export interface Rider {
  id: string;
  name: string;
  phone: string;
  vehicle: Vehicle;
  status: RiderStatus;
  statusReason?: string;
  zoneIds: string[];
  rating: number;
  acceptanceRate: number;
  cashHeld: number;
  cashLimit: number;
  tripsWeek: number;
  joinedOn: string;
  documents: ReviewDoc[];
  /** Position on the illustrated map, 0–1 inside its current zone. */
  pos: { zoneId: string; x: number; y: number };
}

export interface RiderApplication {
  id: string;
  name: string;
  phone: string;
  vehicle: Vehicle;
  zoneIds: string[];
  submittedAt: number;
  status: ApplicationStatus;
  decisionNote?: string;
  documents: ReviewDoc[];
}

/* ---------- Orders (order service) ---------- */

export type OrderStatus =
  "placed" | "accepted" | "preparing" | "ready" | "pickedUp" | "delivered" | "cancelled" | "rejected";

export interface OrderLine {
  name: string;
  qty: number;
  price: number;
}

export interface TimelineEvent {
  at: number;
  label: string;
  by?: string;
}

export interface OrderNote {
  id: string;
  at: number;
  author: string;
  body: string;
}

export type Fault = "customer" | "restaurant" | "rider" | "kade";

export interface Order {
  id: string;
  placedAt: number;
  status: OrderStatus;
  customerId: string;
  restaurantId: number;
  riderId?: string;
  zoneId: string;
  address: string;
  payment: Payment;
  /** Last four digits for card payments. */
  cardLast4?: string;
  lines: OrderLine[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  promoCode?: string;
  total: number;
  /** The latest time the customer was promised. */
  dueAt: number;
  deliveredAt?: number;
  distanceKm: number;
  timeline: TimelineEvent[];
  notes: OrderNote[];
  refunded: number;
  cancel?: { reason: string; fault: Fault; by: string };
  pos: { x: number; y: number };
}

/* ---------- Customers (customer service) ---------- */

export type FlagKind = "refunds" | "cancellations" | "paymentFailures";

export interface FraudFlag {
  id: string;
  kind: FlagKind;
  detail: string;
  raisedAt: number;
  status: "open" | "cleared" | "actioned";
  resolution?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  area: string;
  joinedOn: string;
  ordersCount: number;
  spend: number;
  credit: number;
  blocked: boolean;
  blockReason?: string;
  flags: FraudFlag[];
  creditHistory: { id: string; at: number; amount: number; reason: string; by: string }[];
}

/* ---------- Finance (payouts service) ---------- */

export interface PayoutLine {
  restaurantId: number;
  orders: number;
  gross: number;
  commission: number;
  adjustments: number;
  net: number;
}

export interface PayoutBatch {
  id: string;
  /** "28 Sep to 4 Oct" */
  week: string;
  payDate: string;
  status: "draft" | "approved" | "paid";
  approvedBy?: string;
  lines: PayoutLine[];
}

export interface RiderSettlement {
  riderId: string;
  week: string;
  trips: number;
  earnings: number;
  cashHeld: number;
  status: "open" | "settled";
}

export interface CashRecord {
  id: string;
  riderId: string;
  date: string;
  collected: number;
  /** null while no deposit has been recorded. */
  deposited: number | null;
  bankRef?: string;
}

export type RefundMethod = "card" | "credit";

export interface Refund {
  id: string;
  at: number;
  orderId: string;
  customerId: string;
  amount: number;
  method: RefundMethod;
  reason: string;
  by: string;
}

/* ---------- Promotions (promotions service) ---------- */

export type VoucherType = "fixed" | "percent" | "freeDelivery";
export type VoucherStatus = "active" | "scheduled" | "paused" | "ended";

export interface Voucher {
  code: string;
  description: string;
  type: VoucherType;
  /** Rupees for fixed, percent for percent, 0 for free delivery. */
  value: number;
  maxDiscount?: number;
  minOrder: number;
  /** Empty means every restaurant. */
  restaurantIds: number[];
  newCustomersOnly: boolean;
  startsOn: string;
  endsOn: string;
  uses: number;
  limit: number;
  budget: number;
  spent: number;
  status: VoucherStatus;
}

/* ---------- Support (support service) ---------- */

export type TicketCategory =
  "missingItem" | "wrongItem" | "late" | "payment" | "rider" | "account" | "restaurant";
export type TicketPriority = "urgent" | "high" | "normal" | "low";

export interface TicketMessage {
  id: string;
  at: number;
  from: "requester" | "agent" | "system";
  author: string;
  body: string;
}

export interface Ticket {
  id: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  requester: { kind: "customer" | "rider" | "restaurant"; id: string; name: string };
  orderId?: string;
  openedAt: number;
  slaDueAt: number;
  assigneeId?: string;
  status: "open" | "pending" | "resolved";
  resolution?: string;
  messages: TicketMessage[];
}

export interface Macro {
  id: string;
  title: string;
  body: string;
}

/* ---------- Home feed content (catalogue service) ---------- */

export interface HomeCategory {
  id: string;
  label: string;
  imageId: string;
  visible: boolean;
}

export interface CollectionRule {
  category?: string;
  minRating?: number;
  maxEta?: number;
  offersOnly?: boolean;
}

export interface Collection {
  id: string;
  title: string;
  subtitle: string;
  placement: "banner" | "shelf";
  source: "rules" | "handPicked";
  rule?: CollectionRule;
  restaurantIds: number[];
  startsOn: string;
  endsOn?: string;
  visible: boolean;
}

/* ---------- Team and audit (identity service) ---------- */

export type Role = "admin" | "ops" | "finance" | "support";

export interface Staff {
  id: string;
  name: string;
  email: string;
  role: Role;
  title: string;
  lastActiveAt?: number;
  status: "active" | "invited";
}

export interface Permission {
  id: string;
  label: string;
  group: string;
}

export type PermissionMatrix = Record<Role, string[]>;

export interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  action: string;
  recordType:
    | "order"
    | "restaurant"
    | "rider"
    | "customer"
    | "payout"
    | "zone"
    | "voucher"
    | "ticket"
    | "content"
    | "team";
  recordId: string;
  detail?: string;
}

/* ---------- Live dashboard (dispatch service) ---------- */

export type AttentionKind = "lateOrder" | "restaurantNotAccepting" | "riderCash" | "ridersShort";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  /** Sort key: bigger is more urgent. */
  severity: number;
  href: string;
  phone?: string;
}

export interface LiveSnapshot {
  at: number;
  inProgress: number;
  waitingForRider: number;
  late: number;
  ridersOnline: number;
  ridersNeeded: number;
  shortestZone?: { code: string; short: number };
  avgDeliveryMin: number;
  cancellationsToday: number;
  ordersToday: number;
  attention: AttentionItem[];
  ordersByHour: { hour: number; today: number; lastWeek: number }[];
  dots: MapDot[];
  zones: { id: string; orders: number; riders: number; open: boolean }[];
}

export type DotKind = "waiting" | "onTheWay" | "late" | "rider";

export interface MapDot {
  id: string;
  kind: DotKind;
  zoneId: string;
  x: number;
  y: number;
  label: string;
}
