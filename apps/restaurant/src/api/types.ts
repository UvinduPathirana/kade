// Shapes the restaurant app receives. Each block mirrors what one microservice will send.

// ---------- Order service: kitchen tickets ----------

export type OrderMode = "delivery" | "pickup";

/** new → preparing → ready → pickedUp, or new → missed / rejected. */
export type TicketStatus = "new" | "preparing" | "ready" | "pickedUp" | "missed" | "rejected";

export type RejectReason = "tooBusy" | "soldOut" | "closingSoon" | "other";

export interface TicketLine {
  itemId: string;
  name: string;
  qty: number;
  /** Chosen options in menu order, e.g. ["Sri Lankan hot", "Extra cheese"]. */
  choices: string[];
  /** The customer's note for this dish, e.g. "No leeks please". */
  note: string;
  /** Price of one, including paid options. */
  unitPrice: number;
}

export interface TicketRider {
  name: string;
  vehicle: string;
  plate: string;
  /** Masked number that forwards to the rider. */
  maskedPhone: string;
}

export interface Ticket {
  /** Short number the kitchen calls out and the rider quotes at the counter: "2417". */
  id: string;
  placedAt: number;
  /** The kitchen must accept before this, or the order is missed and the customer refunded. */
  acceptBy: number;
  status: TicketStatus;
  mode: OrderMode;
  /** First name only: enough to call out at the counter. */
  customerName: string;
  /** How many times this customer has ordered here before. */
  repeatCount: number;
  lines: TicketLine[];
  /** Note for the whole order, e.g. "Please pack the gravy separately". */
  kitchenNote: string;
  cutlery: boolean;
  payment: "card" | "cash";
  subtotal: number;

  acceptedAt?: number;
  prepMinutes?: number;
  readyBy?: number;
  readyAt?: number;
  pickedUpAt?: number;
  closedAt?: number;
  rejectReason?: RejectReason;
  rejectNote?: string;

  /** Delivery orders: assigned by the dispatch service once the kitchen accepts. */
  rider?: TicketRider;
  /** When the rider reaches the counter. Before this they're on the way. */
  riderArrivesAt?: number;
}

// ---------- Menu service ----------

export type DishTag = "Vegetarian" | "Spicy";

export interface OptionChoice {
  name: string;
  price: number;
}

export interface OptionGroup {
  id: string;
  name: string;
  required: boolean;
  /** 1 = pick one; more = pick up to N. */
  max: number;
  choices: OptionChoice[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  /** Unsplash id for placeholders, or a data URL for an uploaded photo. */
  imageId?: string;
  tags: DishTag[];
  optionGroupIds: string[];
  /** Sold out today: customers see it greyed out and can't order it. Resets at opening tomorrow. */
  soldOut: boolean;
}

export interface MenuSection {
  id: string;
  name: string;
  items: MenuItem[];
}

export interface Menu {
  sections: MenuSection[];
  optionGroups: OptionGroup[];
}

export type MenuItemInput = Omit<MenuItem, "id" | "soldOut"> & { id?: string; sectionId: string };

// ---------- Outlet service: hours, pause, busy mode ----------

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** "11:00" to "02:00" (past midnight is fine: the kitchen closes the next morning). */
export interface TimeRange {
  open: string;
  close: string;
}

export interface DayHours {
  day: Weekday;
  isOpen: boolean;
  /** One or two ranges, e.g. lunch and dinner. */
  ranges: TimeRange[];
}

export interface Closure {
  id: string;
  /** ISO date, "2026-10-26". */
  date: string;
  reason: string;
}

export interface OutletStatus {
  /** Extra minutes added to every order's prep time. 0 = off. */
  busyExtra: 0 | 10 | 20;
  /** While set and in the future, customers can't order. */
  pausedUntil: number | null;
}

export interface Outlet {
  name: string;
  area: string;
  address: string;
  phone: string;
  status: OutletStatus;
  hours: DayHours[];
  closures: Closure[];
}

// ---------- Promotions service ----------

export type OfferType = "percent" | "amount" | "bogo" | "freeDelivery";

export interface Offer {
  id: string;
  type: OfferType;
  /** percent: 20 means 20% off. amount: Rs off. Unused for bogo and freeDelivery. */
  value: number;
  /** percent: largest discount on one order (0 = no cap). */
  maxDiscount: number;
  /** Smallest basket that qualifies (0 = any). */
  minOrder: number;
  /** bogo: buy `buy`, get `get` free, of `bogoItemId`. */
  buy: number;
  get: number;
  bogoItemId?: string;
  /** Section ids the offer applies to; empty = the whole menu. */
  sectionIds: string[];
  /** ISO dates, inclusive. */
  startDate: string;
  endDate: string;
  /** Total discount the restaurant will fund before the offer stops. */
  budget: number;
  spent: number;
  orders: number;
  /** Set when ended early. */
  endedAt?: number;
}

export type OfferInput = Omit<Offer, "id" | "spent" | "orders" | "endedAt">;

// ---------- Payouts service ----------

export interface DailySales {
  /** ISO date. */
  date: string;
  orders: number;
  card: number;
  cash: number;
  /** Discounts from offers the restaurant funded. */
  offerCost: number;
}

export interface Statement {
  id: string;
  /** ISO dates of the Monday–Sunday week. */
  from: string;
  to: string;
  orders: number;
  gross: number;
  commission: number;
  offerCost: number;
  net: number;
  status: "paid" | "pending";
  /** ISO date the money reached (or will reach) the bank. */
  payDate: string;
}

// ---------- Review service ----------

export interface Review {
  id: string;
  name: string;
  /** ISO date. */
  date: string;
  dish: string;
  stars: number;
  text: string;
  reply?: { text: string; at: number };
}

// ---------- Partner service: staff, devices, onboarding ----------

export type StaffRole = "owner" | "manager" | "kitchen";

export interface StaffMember {
  id: string;
  name: string;
  phone: string;
  role: StaffRole;
  /** Last time they used the app, or null while the invite is pending. */
  lastActive: number | null;
}

export interface DeviceSettings {
  autoPrint: boolean;
  printerName: string;
  paperWidth: "58" | "80";
  copies: 1 | 2;
}

export interface NotificationSettings {
  smsPaused: boolean;
  emailStatements: boolean;
  newReviews: boolean;
  lowRatings: boolean;
}

export interface PartnerSettings {
  devices: DeviceSettings;
  notifications: NotificationSettings;
}

export type BusinessType = "restaurant" | "cafe" | "bakery" | "homeKitchen" | "cloudKitchen";

export interface PartnerApplication {
  business: { name: string; type: BusinessType; address: string; city: string; brNumber: string };
  owner: { name: string; phone: string; email: string; nic: string };
  documents: { registration: string; foodSafety: string; ownerId: string };
  bank: { bank: string; branch: string; accountName: string; accountNumber: string };
  menu: { method: "file" | "photo" | "later"; fileName: string };
}

export interface SubmittedApplication {
  reference: string;
  submittedAt: number;
  businessName: string;
  phone: string;
}
