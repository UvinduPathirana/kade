// TanStack Query hooks: caching, loading and error state for every API call.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMenu,
  getRestaurant,
  listCategories,
  listRestaurants,
  listReviews,
  NotFoundError,
} from "./catalog";
import { FINAL_STATUSES, orderStatus } from "./orderStatus";
import {
  cancelOrder,
  getActiveOrder,
  getOrder,
  markCollected,
  placeOrder,
  rateOrder,
  updateTip,
} from "./orders";
import type { Order, OrderRating } from "./types";

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

// ---------- Orders ----------
// Live status polls every second here; the real order service will push updates over a socket.

export const orderKeys = {
  order: (id: string) => ["order", id] as const,
  active: ["order", "active"] as const,
};

const isLive = (order: Order | null | undefined) => !!order && !FINAL_STATUSES.includes(orderStatus(order));

export const useOrder = (id: string) =>
  useQuery({
    queryKey: orderKeys.order(id),
    queryFn: () => getOrder(id),
    retry: false,
    refetchInterval: (q) => (isLive(q.state.data) ? 1000 : false),
  });

export const useActiveOrder = () =>
  useQuery({ queryKey: orderKeys.active, queryFn: getActiveOrder, refetchInterval: 2000 });

/** Mutations write the returned order straight into the cache so every screen updates at once. */
function useOrderMutation<A>(fn: (arg: A) => Promise<Order>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (order) => {
      qc.setQueryData(orderKeys.order(order.id), order);
      void qc.invalidateQueries({ queryKey: orderKeys.active });
    },
  });
}

export const usePlaceOrder = () => useOrderMutation(placeOrder);
export const useCancelOrder = () => useOrderMutation(cancelOrder);
export const useMarkCollected = () => useOrderMutation(markCollected);
export const useUpdateTip = () =>
  useOrderMutation(({ id, tip }: { id: string; tip: number }) => updateTip(id, tip));
export const useRateOrder = () =>
  useOrderMutation(({ id, rating }: { id: string; rating: Omit<OrderRating, "ratedAt"> }) =>
    rateOrder(id, rating),
  );
