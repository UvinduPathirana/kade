import {
  AvailabilityState,
  DishTag,
  type Category as PbCategory,
  type Menu as PbMenu,
  type MenuItem as PbMenuItem,
  type Restaurant as PbRestaurant,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import type { Review as PbReview } from "@kade/proto/kade/review/v1/review_service";
import type { Place as PbPlace } from "@kade/proto/kade/search/v1/search_service";
import { toRupees } from "../money.js";
import type { Category, Menu, MenuItem, Place, Restaurant, Review } from "../schemas.js";
import { mapFromGeo } from "./geo.js";
import { restaurantNumber } from "./ids.js";

export function toCategory(c: PbCategory): Category {
  return { id: c.id, label: c.label, imageId: c.imageId };
}

/** 3240 -> "3k+", 640 -> "600+", 42 -> "42": the app shows counts the way the mock did. */
export function ratingCountLabel(n: number): string {
  if (n >= 1000) return `${Math.floor(n / 1000)}k+`;
  if (n >= 100) return `${Math.floor(n / 100) * 100}+`;
  return String(n);
}

const clampPriceLevel = (n: number): 1 | 2 | 3 => (n >= 3 ? 3 : n === 2 ? 2 : 1);

export function toRestaurant(r: PbRestaurant, orderedBefore?: ReadonlySet<string>): Restaurant {
  const state = r.availability?.state ?? AvailabilityState.AVAILABILITY_STATE_OPEN;
  const open =
    state === AvailabilityState.AVAILABILITY_STATE_OPEN ||
    state === AvailabilityState.AVAILABILITY_STATE_UNSPECIFIED;
  const out: Restaurant = {
    id: restaurantNumber(r.id),
    name: r.name,
    categoryId: r.categoryId,
    imageId: r.imageId,
    eta: [r.etaMinMinutes, Math.max(r.etaMinMinutes, r.etaMaxMinutes)],
    deliveryFee: r.freeDeliveryOffer ? 0 : toRupees(r.deliveryFee),
    rating: Math.round(r.rating * 10) / 10,
    ratingCount: ratingCountLabel(r.ratingCount),
    priceLevel: clampPriceLevel(r.priceLevel),
    hasVegetarian: r.hasVegetarian,
    area: r.area,
    distanceKm: Math.round(r.distanceKm * 10) / 10,
    hours: r.hoursLabel,
  };
  if (r.offerLabel) out.offer = r.offerLabel;
  if (r.discountPercent > 0) out.discountPercent = r.discountPercent;
  if (orderedBefore?.has(r.id)) out.orderedBefore = true;
  if (!open) {
    out.closedLabel =
      r.availability?.closedLabel ||
      (state === AvailabilityState.AVAILABILITY_STATE_PAUSED ? "Not taking orders right now" : "Closed");
  }
  return out;
}

const TAGS: Partial<Record<DishTag, "Vegetarian" | "Spicy">> = {
  [DishTag.DISH_TAG_VEGETARIAN]: "Vegetarian",
  [DishTag.DISH_TAG_SPICY]: "Spicy",
};

export function toMenuItem(i: PbMenuItem): MenuItem {
  const out: MenuItem = {
    id: i.id,
    name: i.name,
    price: toRupees(i.price),
    description: i.description,
    tags: i.tags.flatMap((t) => TAGS[t] ?? []),
    optionGroupIds: i.optionGroupIds,
  };
  if (i.imageId) out.imageId = i.imageId;
  if (i.popularRank > 0) out.popularRank = i.popularRank;
  if (i.soldOut) out.soldOut = true;
  if (i.unit) out.unit = i.unit;
  return out;
}

export function toMenu(m: PbMenu): Menu {
  return {
    restaurantId: restaurantNumber(m.restaurantId),
    sections: [...m.sections]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, name: s.name, items: s.items.map(toMenuItem) })),
    popular: [...m.popular].sort((a, b) => a.popularRank - b.popularRank).map(toMenuItem),
    optionGroups: Object.fromEntries(
      m.optionGroups.map((g) => [
        g.id,
        {
          id: g.id,
          name: g.name,
          required: g.required,
          max: Math.max(1, g.maxChoices),
          choices: g.choices.map((c) => ({ name: c.name, price: toRupees(c.price) })),
        },
      ]),
    ),
  };
}

const DAY = 86_400_000;

/** "Today", "Yesterday", "3 days ago", "Last week", "2 weeks ago", "Last month", "4 months ago". */
export function relativeDay(at: Date | undefined, now = Date.now()): string {
  if (!at) return "";
  const days = Math.floor((now - at.getTime()) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "Last week";
  if (days < 30) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "Last month";
  if (months < 12) return `${months} months ago`;
  return "Over a year ago";
}

export function toReview(r: PbReview, now = Date.now()): Review {
  return {
    id: r.id,
    name: r.customerName,
    when: relativeDay(r.createdAt, now),
    dish: r.dish,
    stars: r.stars,
    text: r.text,
  };
}

export function toPlace(p: PbPlace): Place {
  const out: Place = { id: p.id, name: p.name, detail: p.detail, area: p.area, inZone: p.inZone };
  // The app only pins places inside the delivery zone.
  const pin = p.inZone ? mapFromGeo(p.location) : undefined;
  if (pin) out.pin = pin;
  return out;
}
