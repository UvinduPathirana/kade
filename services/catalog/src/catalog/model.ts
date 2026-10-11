// Pure mapping from rows to proto messages. No I/O, so it is unit-tested directly.
import type { CollectionPlacement, CollectionSource } from "@kade/proto/kade/catalog/v1/catalog_service";
import {
  type Category,
  type Closure,
  type Collection,
  type DayHours,
  type Menu,
  type MenuItem,
  type MenuSection,
  type OptionGroup,
  type Restaurant,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import type { GeoPoint } from "@kade/proto/kade/common/v1/types";
import type {
  categories,
  closures,
  collections,
  menuItems,
  menuSections,
  optionGroups,
  restaurants,
} from "../db/schema.js";
import { distanceKm, roundKm } from "./geo.js";
import { computeAvailability, hoursLabel } from "./hours.js";

export type RestaurantRow = typeof restaurants.$inferSelect;
export type ClosureRow = typeof closures.$inferSelect;
export type SectionRow = typeof menuSections.$inferSelect;
export type ItemRow = typeof menuItems.$inferSelect;
export type OptionGroupRow = typeof optionGroups.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type CollectionRow = typeof collections.$inferSelect;

export const LKR = (amountMinor: number) => ({ amountMinor, currency: "LKR" });

export function closedDates(rows: readonly ClosureRow[]): Set<string> {
  return new Set(rows.map((c) => c.date));
}

export function availabilityOf(row: RestaurantRow, closureRows: readonly ClosureRow[], now: Date) {
  return computeAvailability(
    {
      hours: row.hours,
      closedDates: closedDates(closureRows),
      adminStatus: row.adminStatus,
      pausedUntil: row.pausedUntil,
      busyExtraMinutes: row.busyExtraMinutes,
    },
    now,
  );
}

export interface RestaurantExtras {
  deliverTo?: GeoPoint;
  /** From pricing; undefined = use the stored base fee. */
  deliveryFeeMinor?: number;
  /** Pickup orders have no delivery fee. */
  pickup?: boolean;
  /** Events carry no customer-specific fields (fee, distance). */
  forEvent?: boolean;
}

export function toRestaurant(
  row: RestaurantRow,
  closureRows: readonly ClosureRow[],
  now: Date,
  extras: RestaurantExtras = {},
): Restaurant {
  const availability = availabilityOf(row, closureRows, now);
  let deliveryFee: Restaurant["deliveryFee"];
  let distance = 0;
  if (!extras.forEvent) {
    const fee =
      extras.pickup || row.freeDeliveryOffer ? 0 : (extras.deliveryFeeMinor ?? row.baseDeliveryFeeMinor);
    deliveryFee = LKR(fee);
    if (extras.deliverTo && (extras.deliverTo.lat !== 0 || extras.deliverTo.lng !== 0)) {
      distance = roundKm(distanceKm(extras.deliverTo, { lat: row.lat, lng: row.lng }));
    }
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    categoryId: row.categoryId,
    cuisine: row.cuisine,
    imageId: row.imageId,
    etaMinMinutes: row.etaMinMinutes + row.busyExtraMinutes,
    etaMaxMinutes: row.etaMaxMinutes + row.busyExtraMinutes,
    deliveryFee,
    rating: row.rating,
    ratingCount: row.ratingCount,
    priceLevel: row.priceLevel,
    offerLabel: row.offerLabel,
    discountPercent: row.discountPercent,
    freeDeliveryOffer: row.freeDeliveryOffer,
    hasVegetarian: row.hasVegetarian,
    area: row.area,
    address: row.address,
    phone: row.phone,
    location: { lat: row.lat, lng: row.lng },
    zoneId: row.zoneId,
    distanceKm: distance,
    hoursLabel: hoursLabel(row.hours, closedDates(closureRows), now),
    availability,
    offerId: row.offerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Sold out only while sold_out_until (the next opening) is still ahead. */
export function isSoldOut(item: ItemRow, now: Date): boolean {
  return item.soldOut && (!item.soldOutUntil || item.soldOutUntil.getTime() > now.getTime());
}

export function toMenuItem(item: ItemRow, now: Date): MenuItem {
  const soldOut = isSoldOut(item, now);
  return {
    id: item.id,
    restaurantId: item.restaurantId,
    sectionId: item.sectionId,
    name: item.name,
    description: item.description,
    price: LKR(item.priceMinor),
    imageId: item.imageId,
    tags: [...item.tags],
    optionGroupIds: [...item.optionGroupIds],
    popularRank: item.popularRank,
    soldOut,
    soldOutUntil: soldOut ? (item.soldOutUntil ?? undefined) : undefined,
    unit: item.unit,
    position: item.position,
  };
}

export function toOptionGroup(group: OptionGroupRow): OptionGroup {
  return {
    id: group.id,
    name: group.name,
    required: group.required,
    maxChoices: group.maxChoices,
    choices: group.choices.map((c) => ({ id: c.id, name: c.name, price: LKR(c.priceMinor) })),
  };
}

export interface MenuRows {
  restaurant: RestaurantRow;
  sections: SectionRow[];
  items: ItemRow[];
  groups: OptionGroupRow[];
}

export function toMenu({ restaurant, sections, items, groups }: MenuRows, now: Date): Menu {
  const sorted = [...sections].sort((a, b) => a.position - b.position);
  const bySection = new Map<string, ItemRow[]>();
  for (const item of items) {
    const list = bySection.get(item.sectionId) ?? [];
    list.push(item);
    bySection.set(item.sectionId, list);
  }
  const menuSections: MenuSection[] = sorted.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    items: (bySection.get(s.id) ?? []).sort((a, b) => a.position - b.position).map((i) => toMenuItem(i, now)),
  }));
  const popular = menuSections
    .flatMap((s) => s.items)
    .filter((i) => i.popularRank > 0)
    .sort((a, b) => a.popularRank - b.popularRank);
  return {
    restaurantId: restaurant.id,
    sections: menuSections,
    popular,
    optionGroups: [...groups].sort((a, b) => a.position - b.position).map(toOptionGroup),
    version: restaurant.menuVersion,
    updatedAt: restaurant.menuUpdatedAt,
  };
}

export function toCategory(row: CategoryRow): Category {
  return { id: row.id, label: row.label, imageId: row.imageId, visible: row.visible, position: row.position };
}

export function toClosure(row: ClosureRow): Closure {
  return { id: row.id, date: row.date, reason: row.reason };
}

export function toDayHours(row: RestaurantRow): DayHours[] {
  return row.hours.map((d) => ({ day: d.day, isOpen: d.isOpen, ranges: d.ranges.map((r) => ({ ...r })) }));
}

export function toCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    placement: row.placement as CollectionPlacement,
    source: row.source as CollectionSource,
    rule: {
      categoryId: row.rule.categoryId ?? "",
      minRating: row.rule.minRating ?? 0,
      maxEtaMinutes: row.rule.maxEtaMinutes ?? 0,
      offersOnly: row.rule.offersOnly ?? false,
    },
    restaurantIds: [...row.restaurantIds],
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    visible: row.visible,
    position: row.position,
  };
}

/** Is a collection running on this Colombo date? */
export function collectionLive(row: CollectionRow, today: string): boolean {
  if (!row.visible) return false;
  if (row.startsOn && row.startsOn > today) return false;
  if (row.endsOn && row.endsOn < today) return false;
  return true;
}

/** Restaurants a rule-based collection shows (same predicate as the admin app's matchRule). */
export function matchesRule(r: Restaurant, rule: CollectionRow["rule"]): boolean {
  return (
    (!rule.categoryId || r.categoryId === rule.categoryId) &&
    (!rule.minRating || r.rating >= rule.minRating) &&
    (!rule.maxEtaMinutes || r.etaMinMinutes <= rule.maxEtaMinutes) &&
    (!rule.offersOnly || r.offerLabel !== "")
  );
}

/** Stable display slug from a name ("Amma's Rice & Curry" → "ammas-rice-curry"). */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "restaurant"
  );
}
