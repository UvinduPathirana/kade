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
