import type { IconName } from "@kade/ui";
import type { Restaurant } from "@/api/types";

export type FilterId = "offers" | "fast" | "rated" | "free" | "veg" | "budget";

export const filters: { id: FilterId; label: string; icon?: IconName; test: (r: Restaurant) => boolean }[] = [
  { id: "offers", label: "Offers", icon: "tag", test: (r) => !!r.offer },
  { id: "fast", label: "Under 30 min", icon: "clock", test: (r) => r.eta[1] <= 30 },
  { id: "rated", label: "Rated 4.5+", icon: "star", test: (r) => r.rating >= 4.5 },
  { id: "free", label: "No delivery fee", test: (r) => r.deliveryFee === 0 },
  { id: "veg", label: "Vegetarian", icon: "leaf", test: (r) => r.hasVegetarian },
  { id: "budget", label: "Under Rs 1,000", test: (r) => r.priceLevel === 1 },
];

export function applyFilters(list: Restaurant[], categoryId: string, active: Set<FilterId>): Restaurant[] {
  return list.filter(
    (r) =>
      (categoryId === "all" || r.categoryId === categoryId) &&
      filters.every((f) => !active.has(f.id) || f.test(r)),
  );
}
