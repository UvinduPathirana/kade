// TanStack Query hooks: caching, loading and error state for every API call.
import { useQuery } from "@tanstack/react-query";
import {
  getMenu,
  getRestaurant,
  listCategories,
  listRestaurants,
  listReviews,
  NotFoundError,
} from "./catalog";

export const queryKeys = {
  categories: ["categories"] as const,
  restaurants: ["restaurants"] as const,
  restaurant: (id: number) => ["restaurant", id] as const,
  menu: (id: number) => ["menu", id] as const,
  reviews: (id: number) => ["reviews", id] as const,
};

/** Don't retry "not found"; retry other failures once. */
export const retryUnlessNotFound = (count: number, error: unknown) =>
  !(error instanceof NotFoundError) && count < 1;

export const useCategories = () => useQuery({ queryKey: queryKeys.categories, queryFn: listCategories });

export const useRestaurants = () => useQuery({ queryKey: queryKeys.restaurants, queryFn: listRestaurants });

export const useRestaurant = (id: number) =>
  useQuery({
    queryKey: queryKeys.restaurant(id),
    queryFn: () => getRestaurant(id),
    retry: retryUnlessNotFound,
  });

export const useMenu = (id: number) =>
  useQuery({ queryKey: queryKeys.menu(id), queryFn: () => getMenu(id), retry: retryUnlessNotFound });

export const useReviews = (id: number) =>
  useQuery({ queryKey: queryKeys.reviews(id), queryFn: () => listReviews(id) });
