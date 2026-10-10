// Home feed content API. Later: the catalogue service's merchandising endpoints, which the customer
// app's home feed (apps/customer/src/features/feed) reads.
import { ApiError, audit, find, respond } from "./client";
import { collections, homeCategories, imageLibrary } from "./mock/backOffice";
import { restaurants } from "./mock/partners";
import type { Collection, CollectionRule, HomeCategory, Restaurant } from "./types";

export interface HomeContent {
  categories: HomeCategory[];
  collections: Collection[];
  restaurants: Pick<
    Restaurant,
    "id" | "name" | "category" | "rating" | "etaMin" | "hasOffer" | "imageId" | "area" | "status"
  >[];
  images: { name: string; id: string }[];
}

export const getHomeContent = () =>
  respond<HomeContent>({
    categories: homeCategories,
    collections,
    restaurants: restaurants.map(
      ({ id, name, category, rating, etaMin, hasOffer, imageId, area, status }) => ({
        id,
        name,
        category,
        rating,
        etaMin,
        hasOffer,
        imageId,
        area,
        status,
      }),
    ),
    images: imageLibrary,
  });

/** Restaurants a rule-based collection would show today. */
export function matchRule(rule: CollectionRule, list: HomeContent["restaurants"]) {
  return list.filter(
    (r) =>
      r.status !== "suspended" &&
      (!rule.category || r.category === rule.category) &&
      (!rule.minRating || r.rating >= rule.minRating) &&
      (!rule.maxEta || r.etaMin <= rule.maxEta) &&
      (!rule.offersOnly || r.hasOffer),
  );
}

export async function moveCategory({ id, direction }: { id: string; direction: -1 | 1 }) {
  const i = homeCategories.findIndex((c) => c.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= homeCategories.length) throw new ApiError("That category can't move further.");
  const [c] = homeCategories.splice(i, 1);
  homeCategories.splice(j, 0, c!);
  audit({
    action: `Moved category ${direction < 0 ? "up" : "down"}`,
    recordType: "content",
    recordId: id,
    detail: `${c!.label} is now number ${j + 1}`,
  });
  return respond(homeCategories);
}

export async function updateCategory({ id, ...patch }: Partial<HomeCategory> & { id: string }) {
  const c = find(homeCategories, (x) => x.id === id, "Category");
  Object.assign(c, patch);
  const action =
    patch.visible !== undefined
      ? patch.visible
        ? "Showed category"
        : "Hid category"
      : "Changed category image";
  audit({ action, recordType: "content", recordId: id, detail: c.label });
  return respond(c);
}

export async function saveCollection(input: Omit<Collection, "id"> & { id?: string }) {
  if (!input.title.trim()) throw new ApiError("Give the collection a title customers will see.");
  if (input.source === "handPicked" && input.restaurantIds.length < 2)
    throw new ApiError("Pick at least two restaurants for a hand-picked collection.");
  if (input.endsOn && input.endsOn < input.startsOn)
    throw new ApiError("The end date is before the start date.");
  let saved: Collection;
  if (input.id) {
    saved = find(collections, (x) => x.id === input.id, "Collection");
    Object.assign(saved, input);
  } else {
    saved = { ...input, id: `col-${collections.length + 1}-${input.title.length}` };
    collections.push(saved);
  }
  audit({
    action: input.id ? "Changed collection" : "Created collection",
    recordType: "content",
    recordId: saved.id,
    detail: saved.title,
  });
  return respond(saved);
}

export async function setCollectionVisible({ id, visible }: { id: string; visible: boolean }) {
  const c = find(collections, (x) => x.id === id, "Collection");
  c.visible = visible;
  audit({
    action: visible ? "Showed collection" : "Hid collection",
    recordType: "content",
    recordId: id,
    detail: c.title,
  });
  return respond(c);
}

export async function moveCollection({ id, direction }: { id: string; direction: -1 | 1 }) {
  const i = collections.findIndex((c) => c.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= collections.length) throw new ApiError("That collection can't move further.");
  const [c] = collections.splice(i, 1);
  collections.splice(j, 0, c!);
  return respond(collections);
}
