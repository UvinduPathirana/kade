// Catalogue API. Today it serves mock data; later each function calls the catalogue/menu
// microservices (e.g. GET /restaurants, GET /restaurants/:id/menu) and the search service
// (GET /search?q=), and nothing else changes.
import * as mock from "./mock/catalogue";
import type { Category, DishResult, Menu, Restaurant, Review, SearchResults } from "./types";

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

const respond = <T>(data: T): Promise<T> => Promise.resolve(structuredClone(data));

export function listCategories(): Promise<Category[]> {
  return respond(mock.categories);
}

export function listRestaurants(): Promise<Restaurant[]> {
  return respond(mock.restaurants);
}

export async function getRestaurant(id: number): Promise<Restaurant> {
  const r = mock.restaurants.find((x) => x.id === id);
  if (!r) throw new NotFoundError("Restaurant");
  return respond(r);
}

export async function getMenu(restaurantId: number): Promise<Menu> {
  const r = await getRestaurant(restaurantId);
  return respond(mock.buildMenu(r));
}

export function listReviews(restaurantId: number): Promise<Review[]> {
  void restaurantId; // mock: same reviews for every restaurant
  return respond(mock.reviews);
}

export async function getCategory(id: string): Promise<Category> {
  const c = mock.categories.find((x) => x.id === id && x.id !== "all");
  if (!c) throw new NotFoundError("Category");
  return respond(c);
}

export function listPopularSearches(): Promise<string[]> {
  return respond(mock.popularSearches);
}

const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Dishes and places matching every word of the query. Open places and name matches come first. */
export async function search(query: string): Promise<SearchResults> {
  const words = normalise(query).split(" ").filter(Boolean);
  if (!words.length) return { query, dishes: [], restaurants: [] };
  const matches = (text: string) => {
    const t = normalise(text);
    return words.every((w) => t.includes(w));
  };
  const categoryLabel = new Map(mock.categories.map((c) => [c.id, c.label]));
  const openFirst = (a: Restaurant, b: Restaurant) => Number(!!a.closedLabel) - Number(!!b.closedLabel);

  const restaurants = mock.restaurants
    .filter((r) => matches(`${r.name} ${categoryLabel.get(r.categoryId)} ${r.area}`))
    .sort(openFirst);

  const dishes: DishResult[] = [];
  for (const r of [...mock.restaurants].sort(openFirst)) {
    for (const item of mock.buildMenu(r).sections.flatMap((s) => s.items)) {
      if (matches(item.name) || matches(`${item.name} ${item.description}`))
        dishes.push({ item, restaurant: r });
    }
  }
  // Name matches before description matches; available before sold out
  const rank = (d: DishResult) => (matches(d.item.name) ? 0 : 2) + (d.item.soldOut ? 1 : 0);
  dishes.sort((a, b) => rank(a) - rank(b));

  return respond({ query, dishes: dishes.slice(0, 40), restaurants });
}
