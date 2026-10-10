/** A point on the illustrated Colombo map (SVG units, see features/map/geo.ts). */
export interface MapPoint {
  x: number;
  y: number;
}

export type VehicleType = "motorbike" | "tukTuk" | "bicycle";

export type PaymentMethod = "cash" | "card";

export interface OrderItem {
  id: string;
  qty: number;
  name: string;
  /** Size, add-ons and notes the kitchen was asked for, e.g. "Large, extra cheese". */
  options?: string;
}

export interface Pay {
  base: number;
  distance: number;
  tip: number;
  /** Busy-time or quest boost paid on this trip. */
  boost: number;
}

export const payTotal = (p: Pay) => p.base + p.distance + p.tip + p.boost;

/** A job the dispatch service offers to one rider at a time. */
export interface Offer {
  id: string;
  orderNumber: string;
  restaurant: { name: string; area: string; address: string; phone: string; point: MapPoint };
  customer: {
    firstName: string;
    area: string;
    address: string;
    note?: string;
    /** Masked number: the call goes through Kadé so neither side sees the other's number. */
    maskedPhone: string;
    point: MapPoint;
  };
  /** Rider's position when the offer was made, start of the pickup leg. */
  from: MapPoint;
  toPickupKm: number;
  tripKm: number;
  /** Minutes for the whole job, pickup and drop-off. */
  minutes: number;
  pay: Pay;
  payment: PaymentMethod;
  /** Amount the customer pays the rider in cash. Zero for card orders. */
  cashToCollect: number;
  /** What the customer said they'll pay with, e.g. a Rs 5,000 note. */
  customerPaysWith?: number;
  items: OrderItem[];
  /** The kitchen sealed the bag, so the rider can't check items one by one. */
  sealed: boolean;
  /** Minutes the kitchen still needs if the rider arrives before the food is ready. */
  notReadyMinutes: number;
  /** Code shown in the customer's app, read out at the door. */
  deliveryCode: string;
  offeredAt: number;
  expiresAt: number;
}

export type ProofOfDelivery = { kind: "code" } | { kind: "photo"; fileName: string };

export type Thumb = "up" | "down";

export interface Trip {
  id: string;
  orderNumber: string;
  restaurantName: string;
  pickupArea: string;
  dropoffArea: string;
  customerFirstName: string;
  km: number;
  pay: Pay;
  payment: PaymentMethod;
  cashCollected: number;
  acceptedAt: number;
  arrivedAtRestaurantAt: number;
  pickedUpAt: number;
  deliveredAt: number;
  proof: ProofOfDelivery["kind"];
  /** Rating the customer gave the rider, if any. */
  customerRating?: number;
  from: MapPoint;
  pickupPoint: MapPoint;
  dropoffPoint: MapPoint;
}

export interface RiderProfile {
  name: string;
  firstName: string;
  phone: string;
  vehicle: { type: VehicleType; model: string; plate: string };
  rating: number;
  ratingCount: number;
  memberSince: string;
  bank: { name: string; branch: string; last4: string };
  depositReference: string;
}

export type DocumentStatus = "valid" | "expiring" | "expired" | "inReview";

export interface RiderDocument {
  id: string;
  name: string;
  expiresOn?: string;
  status: DocumentStatus;
}

export interface CashBalance {
  /** Cash taken from customers since the last deposit. */
  collected: number;
  /** Earnings Kadé owes the rider, set against the cash. */
  owedToRider: number;
  limit: number;
  lastDepositAt: number;
}

export const cashHolding = (c: CashBalance) => Math.max(0, c.collected - c.owedToRider);

export type Period = "today" | "week" | "month";

export interface EarningsBar {
  label: string;
  /** Longer label for screen readers and the selected-bar caption: "Thursday 8 October". */
  fullLabel: string;
  amount: number;
  trips: number;
}

export interface EarningsSummary {
  period: Period;
  total: number;
  trips: number;
  onlineMinutes: number;
  tips: number;
  bars: EarningsBar[];
  /** Comparison line, e.g. "Rs 640 more than last Saturday". */
  comparison?: { text: string; tone: "good" | "bad" | "neutral" };
}

export interface Quest {
  id: string;
  title: string;
  detail: string;
  done: number;
  target: number;
  bonus: number;
  endsAt: number;
}

export interface Payout {
  id: string;
  weekOf: string;
  paidAt: number;
  amount: number;
  /** Cash held back from the payout to settle what the rider was holding. */
  cashOffset: number;
  status: "paid" | "scheduled";
}

export interface RatingsSummary {
  overall: number;
  count: number;
  /** Last 100 ratings by stars, 5 down to 1. */
  breakdown: [number, number, number, number, number];
  compliments: { label: string; count: number }[];
  improve: { label: string; detail: string }[];
  recent: { id: string; stars: number; comment?: string; at: number; area: string }[];
}

export interface HelpTopic {
  id: string;
  title: string;
  summary: string;
  steps: string[];
}

export interface ChatMessage {
  id: string;
  from: "rider" | "support";
  text: string;
  at: number;
}
