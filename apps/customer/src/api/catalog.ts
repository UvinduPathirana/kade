// Catalogue API. Live mode calls the customer gateway (catalog, search and review services);
// mock mode serves the demo data in ./mock. Same functions either way (VITE_API_MODE).
import { IS_LIVE } from "./config";
import { NotFoundError } from "./errors";
import * as live from "./live/catalog";
import * as mock from "./mock/catalogue";
import type { Category, DishResult, Menu, Restaurant, Review, SearchResults } from "./types";

export { NotFoundError };

const respond = <T>(data: T): Promise<T> => Promise.resolve(structuredClone(data));

function mockListCategories(): Promise<Category[]> {
  return respond(mock.categories);
}

function mockListRestaurants(): Promise<Restaurant[]> {
  return respond(mock.restaurants);
}

async function mockGetRestaurant(id: number): Promise<Restaurant> {
  const r = mock.restaurants.find((x) => x.id === id);
  if (!r) throw new NotFoundError("Restaurant");
  return respond(r);
}

async function mockGetMenu(restaurantId: number): Promise<Menu> {
  const r = await mockGetRestaurant(restaurantId);
  return respond(mock.buildMenu(r));
}

function mockListReviews(restaurantId: number): Promise<Review[]> {
  void restaurantId; // mock: same reviews for every restaurant
  return respond(mock.reviews);
}

async function mockGetCategory(id: string): Promise<Category> {
  const c = mock.categories.find((x) => x.id === id && x.id !== "all");
  if (!c) throw new NotFoundError("Category");
  return respond(c);
}

function mockListPopularSearches(): Promise<string[]> {
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
async function mockSearch(query: string): Promise<SearchResults> {
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

export const listCategories = IS_LIVE ? live.listCategories : mockListCategories;
export const listRestaurants = IS_LIVE ? live.listRestaurants : mockListRestaurants;
export const getRestaurant = IS_LIVE ? live.getRestaurant : mockGetRestaurant;
export const getMenu = IS_LIVE ? live.getMenu : mockGetMenu;
export const listReviews = IS_LIVE ? live.listReviews : mockListReviews;
export const getCategory = IS_LIVE ? live.getCategory : mockGetCategory;
export const listPopularSearches = IS_LIVE ? live.listPopularSearches : mockListPopularSearches;
export const search = IS_LIVE ? live.search : mockSearch;
