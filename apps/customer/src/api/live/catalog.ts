// Catalogue API against the customer gateway (catalog, search and review services behind it).
import { useAddress } from "@/features/address/store";
import { api } from "../http";
import { ApiError, NotFoundError } from "../errors";
import type { Category, Menu, Restaurant, Review, SearchResults } from "../types";

/** The delivery pin drives distance, ETA and delivery fee. */
const where = () => {
  const pin = useAddress.getState().current.pin;
  return pin ? { x: Math.round(pin.x), y: Math.round(pin.y) } : {};
};

/** 404 problems become NotFoundError so pages show their "not found" state. */
const orNotFound =
  (what: string) =>
  (err: unknown): never => {
    if (err instanceof ApiError && err.status === 404) throw new NotFoundError(what);
    throw err;
  };

export const listCategories = () => api<Category[]>("GET", "/v1/categories", { auth: "none" });

export const listRestaurants = () => api<Restaurant[]>("GET", "/v1/restaurants", { query: where() });

export const getRestaurant = (id: number) =>
  api<Restaurant>("GET", `/v1/restaurants/${id}`, { query: where() }).catch(orNotFound("Restaurant"));

export const getMenu = (restaurantId: number) =>
  api<Menu>("GET", `/v1/restaurants/${restaurantId}/menu`, { auth: "none" }).catch(orNotFound("Restaurant"));

export const listReviews = (restaurantId: number) =>
  api<Review[]>("GET", `/v1/restaurants/${restaurantId}/reviews`, { auth: "none" });

export const getCategory = (id: string) =>
  api<Category>("GET", `/v1/categories/${encodeURIComponent(id)}`, { auth: "none" }).catch(
    orNotFound("Category"),
  );

export const listPopularSearches = () => api<string[]>("GET", "/v1/search/popular", { auth: "none" });

export const search = (query: string) =>
  api<SearchResults>("GET", "/v1/search", { auth: "none", query: { q: query, ...where() } });
