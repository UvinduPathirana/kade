// Shapes returned by the catalogue API. Mirrors what the catalogue/menu services will send.

export type OrderMode = "delivery" | "pickup";

export interface Category {
  id: string;
  label: string;
  imageId: string;
}

export interface Restaurant {
  id: number;
  name: string;
  categoryId: string;
  imageId: string;
  /** Delivery time window in minutes. */
  eta: [number, number];
  /** 0 = no delivery fee. */
  deliveryFee: number;
  rating: number;
  ratingCount: string;
  /** 1 = budget … 3 = premium */
  priceLevel: 1 | 2 | 3;
  offer?: string;
  /** Percent taken off the subtotal at checkout. */
  discountPercent?: number;
  hasVegetarian: boolean;
  orderedBefore?: boolean;
  area: string;
  distanceKm: number;
  hours: string;
  /** Present while closed, e.g. "Opens at 8 am". */
  closedLabel?: string;
}

export type DishTag = "Vegetarian" | "Spicy";

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  description: string;
  imageId?: string;
  tags: DishTag[];
  optionGroupIds: string[];
  /** 1 = most ordered. */
  popularRank?: number;
  soldOut?: boolean;
  /** Shop products: pack size or weight, e.g. "1 kg", "400 ml". */
  unit?: string;
}

export interface MenuSection {
  id: string;
  name: string;
  items: MenuItem[];
}

export interface OptionChoice {
  name: string;
  price: number;
}

export interface OptionGroup {
  id: string;
  name: string;
  required: boolean;
  /** 1 = pick one (radio); more = pick up to N (checkbox). */
  max: number;
  choices: OptionChoice[];
}

export interface Menu {
  restaurantId: number;
  sections: MenuSection[];
  popular: MenuItem[];
  optionGroups: Record<string, OptionGroup>;
}

export interface Review {
  id: string;
  name: string;
  when: string;
  dish: string;
  stars: number;
  text: string;
}

// ---------- Orders ----------

export type PaymentMethod =
  { type: "card"; brand: string; last4: string } | { type: "cash"; payingWith?: number };

export interface SavedAddress {
  id: string;
  label: string;
  line: string;
  /** Neighbourhood, e.g. "Kollupitiya". */
  area?: string;
  /** Standing note for the rider, e.g. "Blue gate, ring twice". */
  note?: string;
  /** Pin on the illustrated map (map units). */
  pin?: { x: number; y: number };
}

export interface OrderLine {
  key: string;
  itemId: string;
  name: string;
  unitPrice: number;
  qty: number;
  choices: string[];
  note: string;
}

export interface OrderRestaurant {
  id: number;
  name: string;
  imageId: string;
  eta: [number, number];
  deliveryFee: number;
  discountPercent?: number;
  area: string;
}

export interface Rider {
  name: string;
  rating: number;
  vehicle: string;
  plate: string;
  /** Masked number that forwards to the rider, so neither side sees the other's phone. */
  maskedPhone: string;
}

export interface OrderTotals {
  subtotal: number;
  saving: number;
  deliveryFee: number;
  smallOrderFee: number;
  promoDiscount: number;
  tip: number;
  /** Kadé credit taken off the total. */
  credit?: number;
  total: number;
}

export interface OrderRating {
  riderStars?: number;
  riderTags: string[];
  /** itemId → liked or not */
  dishes: Record<string, "up" | "down">;
  comment: string;
  ratedAt: number;
}

/** Delivery: placed → accepted → preparing → pickedUp → delivered. Pickup: … preparing → ready → collected. */
export type OrderStatus =
  | "scheduled"
  | "placed"
  | "accepted"
  | "preparing"
  | "pickedUp"
  | "delivered"
  | "ready"
  | "collected"
  | "cancelled";

export interface Order {
  id: string;
  placedAt: number;
  mode: OrderMode;
  restaurant: OrderRestaurant;
  lines: OrderLine[];
  address?: SavedAddress;
  riderNote: string;
  /** Present for scheduled orders: when it should arrive / be ready. */
  scheduledFor?: number;
  payment: PaymentMethod;
  promoCode?: string;
  totals: OrderTotals;
  rider?: Rider;
  cancelledAt?: number;
  collectedAt?: number;
  rating?: OrderRating;
  /** Shop orders: what to do when a product is out of stock. */
  substitution?: Substitution;
  /** Set when the order came from a group order. */
  groupId?: string;
  issue?: OrderIssue;

  // ----- Live mode only: the order service owns status and timings; mock mode derives them. -----
  /** Order UUID (realtime channel `order:<ref>`); `id` is the human order number. */
  ref?: string;
  status?: OrderStatus;
  /** Why it was cancelled or couldn't go ahead, when the restaurant or Kadé did it. */
  cancelReason?: string;
  acceptedAt?: number;
  /** When the kitchen said the food would be ready. */
  readyBy?: number;
  pickedUpAt?: number;
  deliveredAt?: number;
  /** Latest time promised (arrival for delivery, ready for pickup). */
  dueAt?: number;
  /** Code the customer reads to the rider at the door. */
  deliveryCode?: string;
}

export interface PlaceOrderInput {
  mode: OrderMode;
  restaurant: OrderRestaurant;
  lines: OrderLine[];
  address?: SavedAddress;
  riderNote: string;
  scheduledFor?: number;
  payment: PaymentMethod;
  promoCode?: string;
  tip: number;
  /** Take the customer's Kadé credit off the total. */
  useCredit?: boolean;
  substitution?: Substitution;
  groupId?: string;
}

export type Substitution = "similar" | "refund";

// ---------- Help with an order ----------

export type IssueKind = "missing" | "wrong" | "spilled" | "late" | "neverArrived" | "charged";

export type IssueResolution = "credit" | "card" | "review";

export interface IssueInput {
  kind: IssueKind;
  /** Affected lines and how many of each. */
  lines: { key: string; qty: number }[];
  note: string;
  photoName?: string;
  resolution: IssueResolution;
}

export interface OrderIssue extends IssueInput {
  /** What the order service worked out is owed back. */
  amount: number;
  reportedAt: number;
}

// ---------- Places and addresses ----------

export interface Place {
  id: string;
  name: string;
  /** Second line, e.g. "Kollupitiya, Colombo 03". */
  detail: string;
  area: string;
  /** Inside the delivery zone (Colombo 01–15 and Dehiwala). */
  inZone: boolean;
  /** Position on the illustrated map; only for places in the zone. */
  pin?: { x: number; y: number };
}

// ---------- Account ----------

export interface User {
  name: string;
  /** National format without the leading 0, e.g. "771234567". */
  phone: string;
  email?: string;
}

export interface SignInResult {
  user: User;
  /** First time this number has signed in: ask for a name. */
  isNew: boolean;
}

export type CardBrand = "Visa" | "Mastercard" | "Amex";

export interface SavedCard {
  id: string;
  brand: CardBrand;
  last4: string;
  /** "MM/YY" */
  expiry: string;
}

export interface NewCardInput {
  number: string;
  expiry: string;
  cvc: string;
  name: string;
}

export interface CreditEntry {
  id: string;
  at: number;
  /** Positive when added, negative when spent. */
  amount: number;
  label: string;
}

export interface CreditAccount {
  balance: number;
  history: CreditEntry[];
}

export type PlusPlan = "monthly" | "yearly";

export interface PlusMembership {
  status: "none" | "member" | "cancelled";
  plan?: PlusPlan;
  joinedAt?: number;
  /** End of the free month. */
  trialEndsAt?: number;
  /** Benefits last until here after cancelling. */
  endsAt?: number;
  cardLabel?: string;
}

// ---------- Search ----------

export interface DishResult {
  item: MenuItem;
  restaurant: Restaurant;
}

export interface SearchResults {
  query: string;
  dishes: DishResult[];
  restaurants: Restaurant[];
}

// ---------- Group orders ----------

export interface GroupMember {
  name: string;
  /** Milliseconds after the group was created that this person joined. */
  joinsAfter: number;
  lines: OrderLine[];
}

export interface GroupOrder {
  id: string;
  restaurantId: number;
  restaurantName: string;
  hostName: string;
  createdAt: number;
  closesAt: number;
  /** Spending limit per person, if the host set one. */
  limit?: number;
  /** Everyone except the host; the host's dishes are their cart. */
  members: GroupMember[];
  /** Set once the host places the order. */
  orderId?: string;
}

// ---------- Gifts and referrals ----------

export interface GiftCardInput {
  amount: number;
  to: string;
  contact: string;
  message: string;
  /** ISO date, "2026-10-12". */
  sendOn: string;
  cardId: string;
}

export interface GiftCard extends GiftCardInput {
  id: string;
  boughtAt: number;
  cardLabel: string;
}

export interface ReferredFriend {
  name: string;
  status: "invited" | "joined" | "ordered";
  /** When they reached that status. */
  at: number;
}

export interface Referral {
  code: string;
  /** Rupees each side gets. */
  reward: number;
  friends: ReferredFriend[];
}

// ---------- Support chat ----------

export interface ChatMessage {
  id: string;
  from: "you" | "agent";
  text: string;
  at: number;
  /** An order attached to the message. */
  order?: { id: string; restaurant: string; total: number };
}
