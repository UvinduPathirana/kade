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
}
