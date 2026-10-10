// Catalogue API. Today it serves mock data; later each function calls the catalogue/menu
// microservices (e.g. GET /restaurants, GET /restaurants/:id/menu) and nothing else changes.
import * as mock from "./mock/catalogue";
import type { Category, Menu, Restaurant, Review } from "./types";

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
