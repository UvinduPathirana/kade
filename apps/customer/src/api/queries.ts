// TanStack Query hooks: caching, loading and error state for every API call.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addCard,
  cancelPlus,
  getCredit,
  getPlus,
  joinPlus,
  listCards,
  removeCard,
  saveProfile,
} from "./account";
import { listAddresses, removeAddress, saveAddress, searchPlaces } from "./addresses";
import {
  getCategory,
  getMenu,
  getRestaurant,
  listCategories,
  listPopularSearches,
  listRestaurants,
  listReviews,
  NotFoundError,
  search,
} from "./catalog";
import { buyGiftCard, getReferral, listGiftCards } from "./gifts";
import { createGroup, getGroup } from "./group";
import { IS_LIVE } from "./config";
import { FINAL_STATUSES, orderStatus } from "./orderStatus";
import { checkPromo, listPromos } from "./promos";
import { useSession } from "@/features/account/session";
import {
  cancelOrder,
  getActiveOrder,
  getOrder,
  listOrders,
  markCollected,
  placeOrder,
  rateOrder,
  reportIssue,
  updateTip,
} from "./orders";
import type { IssueInput, Order, OrderMode, OrderRating, PlusPlan } from "./types";

/**
 * Account data needs a signed-in customer in live mode (the gateway answers 401 otherwise). Mock mode
 * keeps its old behaviour: everything works signed out.
 */
const useAccountEnabled = () => {
  const signedIn = useSession((s) => !!s.user);
  return !IS_LIVE || signedIn;
};

export const queryKeys = {
  categories: ["categories"] as const,
  category: (id: string) => ["category", id] as const,
  restaurants: ["restaurants"] as const,
  restaurant: (id: number) => ["restaurant", id] as const,
  menu: (id: number) => ["menu", id] as const,
  reviews: (id: number) => ["reviews", id] as const,
  search: (q: string) => ["search", q] as const,
  popularSearches: ["search", "popular"] as const,
};

/** Don't retry "not found"; retry other failures once. */
export const retryUnlessNotFound = (count: number, error: unknown) =>
  !(error instanceof NotFoundError) && count < 1;

export const useCategories = () => useQuery({ queryKey: queryKeys.categories, queryFn: listCategories });

export const useCategory = (id: string) =>
  useQuery({ queryKey: queryKeys.category(id), queryFn: () => getCategory(id), retry: retryUnlessNotFound });

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

/** Keeps the previous results on screen while the next query loads, so the list doesn't flash empty. */
export const useSearch = (q: string) =>
  useQuery({
    queryKey: queryKeys.search(q),
    queryFn: () => search(q),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
  });

export const usePromos = () => useQuery({ queryKey: ["promos"], queryFn: listPromos });

/** Checks an applied promo code against the current basket (re-checked when the subtotal changes). */
export const usePromoCheck = (
  code: string | undefined,
  subtotal: number,
  restaurantId: number | undefined,
  mode: OrderMode,
) =>
  useQuery({
    queryKey: ["promo-check", code, subtotal, restaurantId, mode],
    queryFn: () => checkPromo(code!, subtotal, restaurantId!, mode),
    enabled: !!code && restaurantId !== undefined,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

export const usePopularSearches = () =>
  useQuery({ queryKey: queryKeys.popularSearches, queryFn: listPopularSearches });

// ---------- Orders ----------
// Mock status is derived from the clock, so it re-reads every second. Live status comes from the
// order service: polled every few seconds, and refetched at once when the realtime socket says the
// order changed (api/live/realtime.ts).

export const orderKeys = {
  all: ["order"] as const,
  list: ["order", "list"] as const,
  order: (id: string) => ["order", id] as const,
  active: ["order", "active"] as const,
};

const isLive = (order: Order | null | undefined) => !!order && !FINAL_STATUSES.includes(orderStatus(order));

const POLL_ORDER_MS = IS_LIVE ? 4000 : 1000;
const POLL_LIST_MS = IS_LIVE ? 8000 : 2000;

export const useOrder = (id: string) =>
  useQuery({
    queryKey: orderKeys.order(id),
    queryFn: () => getOrder(id),
    retry: false,
    enabled: useAccountEnabled(),
    refetchInterval: (q) => (isLive(q.state.data) ? POLL_ORDER_MS : false),
  });

export const useOrders = () =>
  useQuery({
    queryKey: orderKeys.list,
    queryFn: listOrders,
    enabled: useAccountEnabled(),
    refetchInterval: (q) => (q.state.data?.some(isLive) ? POLL_LIST_MS : false),
  });

export const useActiveOrder = () =>
  useQuery({
    queryKey: orderKeys.active,
    queryFn: getActiveOrder,
    enabled: useAccountEnabled(),
    refetchInterval: POLL_LIST_MS,
  });

/** Mutations write the returned order straight into the cache so every screen updates at once. */
function useOrderMutation<A>(fn: (arg: A) => Promise<Order>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (order) => {
      qc.setQueryData(orderKeys.order(order.id), order);
      void qc.invalidateQueries({ queryKey: orderKeys.active });
      void qc.invalidateQueries({ queryKey: orderKeys.list });
      // Placing an order can spend credit; reporting a problem can add it
      void qc.invalidateQueries({ queryKey: accountKeys.credit });
      if (order.groupId) void qc.invalidateQueries({ queryKey: groupKeys.group(order.groupId) });
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
export const useReportIssue = () =>
  useOrderMutation(({ id, issue }: { id: string; issue: IssueInput }) => reportIssue(id, issue));

// ---------- Addresses ----------

export const addressKeys = {
  saved: ["addresses"] as const,
  places: (q: string) => ["places", q] as const,
};

export const useAddresses = () =>
  useQuery({ queryKey: addressKeys.saved, queryFn: listAddresses, enabled: useAccountEnabled() });

export const usePlaces = (q: string) =>
  useQuery({
    queryKey: addressKeys.places(q.trim().toLowerCase()),
    queryFn: () => searchPlaces(q),
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });

export function useSaveAddress() {
  const qc = useQueryClient();
  return useMutation({
    // Live and signed out: the address is used on this device only (nowhere to save it yet).
    mutationFn: (address: Parameters<typeof saveAddress>[0]) =>
      IS_LIVE && !useSession.getState().user ? Promise.resolve(address) : saveAddress(address),
    onSuccess: () => qc.invalidateQueries({ queryKey: addressKeys.saved }),
  });
}

export function useRemoveAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeAddress,
    onSuccess: () => qc.invalidateQueries({ queryKey: addressKeys.saved }),
  });
}

// ---------- Account ----------

export const accountKeys = {
  cards: ["cards"] as const,
  credit: ["credit"] as const,
  plus: ["plus"] as const,
  gifts: ["gift-cards"] as const,
  referral: (name: string) => ["referral", name] as const,
};

export const useSaveProfile = () => useMutation({ mutationFn: saveProfile });

export const useCards = () =>
  useQuery({ queryKey: accountKeys.cards, queryFn: listCards, enabled: useAccountEnabled() });

export function useAddCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addCard,
    onSuccess: () => qc.invalidateQueries({ queryKey: accountKeys.cards }),
  });
}

export function useRemoveCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeCard,
    onSuccess: () => qc.invalidateQueries({ queryKey: accountKeys.cards }),
  });
}

export const useCredit = () =>
  useQuery({ queryKey: accountKeys.credit, queryFn: getCredit, enabled: useAccountEnabled() });

export const usePlus = () =>
  useQuery({ queryKey: accountKeys.plus, queryFn: getPlus, enabled: useAccountEnabled() });

export function useJoinPlus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ plan, cardId }: { plan: PlusPlan; cardId: string }) => joinPlus(plan, cardId),
    onSuccess: (m) => qc.setQueryData(accountKeys.plus, m),
  });
}

export function useCancelPlus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: cancelPlus,
    onSuccess: (m) => qc.setQueryData(accountKeys.plus, m),
  });
}

export const useGiftCards = () =>
  useQuery({ queryKey: accountKeys.gifts, queryFn: listGiftCards, enabled: useAccountEnabled() });

export function useBuyGiftCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: buyGiftCard,
    onSuccess: () => qc.invalidateQueries({ queryKey: accountKeys.gifts }),
  });
}

export const useReferral = (firstName: string) =>
  useQuery({
    queryKey: accountKeys.referral(firstName),
    queryFn: () => getReferral(firstName),
    enabled: useAccountEnabled(),
  });

// ---------- Group orders ----------
// The mock's friends join on a schedule stored with the group, so the page derives who's in from the
// clock. The real service will push joins over the same socket as order status.

export const groupKeys = { group: (id: string) => ["group", id] as const };

export const useGroup = (id: string) =>
  useQuery({
    queryKey: groupKeys.group(id),
    queryFn: () => getGroup(id),
    retry: false,
    // Live: friends join on the server; refresh while the group is open.
    refetchInterval: (q) => (IS_LIVE && q.state.data && !q.state.data.orderId ? 5000 : false),
  });

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createGroup,
    onSuccess: (g) => qc.setQueryData(groupKeys.group(g.id), g),
  });
}
