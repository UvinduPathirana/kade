// TanStack Query hooks: caching, loading and error state for every API call.
// Mutations write what the service returns straight into the cache so every screen updates at once.
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import * as menuApi from "./menu";
import * as orders from "./orders";
import * as outlet from "./outlet";
import * as partner from "./partner";
import * as payouts from "./payouts";
import * as promotions from "./promotions";
import * as reviews from "./reviews";
import type { Menu, Outlet, Review, StaffMember, Ticket } from "./types";

export const keys = {
  tickets: ["tickets"] as const,
  ticket: (id: string) => ["tickets", id] as const,
  menu: ["menu"] as const,
  outlet: ["outlet"] as const,
  offers: ["offers"] as const,
  sales: (from: string, to: string) => ["sales", from, to] as const,
  statements: ["statements"] as const,
  reviews: ["reviews"] as const,
  staff: ["staff"] as const,
  settings: ["settings"] as const,
  application: ["application"] as const,
};

/** Mutation whose result replaces one cached query. */
function useReplace<A, R>(key: QueryKey, fn: (arg: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (data) => qc.setQueryData(key, data) });
}

// ---------- Orders ----------
// Polled every second, standing in for the order service's socket. The app shell keeps this query
// alive on every page so new orders ring wherever the kitchen is.

export const useTickets = () =>
  useQuery({ queryKey: keys.tickets, queryFn: orders.listTickets, refetchInterval: 1000, staleTime: 0 });

export const useTicket = (id: string) =>
  useQuery({ queryKey: keys.ticket(id), queryFn: () => orders.getTicket(id), refetchInterval: 2000 });

function useTicketMutation<A>(fn: (arg: A) => Promise<Ticket>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (ticket) => {
      qc.setQueryData<Ticket[]>(keys.tickets, (xs) => xs?.map((t) => (t.id === ticket.id ? ticket : t)));
      qc.setQueryData(keys.ticket(ticket.id), ticket);
    },
  });
}

export const useAcceptTicket = () => useTicketMutation(orders.acceptTicket);
export const useRejectTicket = () => useTicketMutation(orders.rejectTicket);
export const useMarkReady = () => useTicketMutation(orders.markReady);
export const useHandOver = () => useTicketMutation(orders.handOver);

// ---------- Menu ----------

export const useMenu = () => useQuery({ queryKey: keys.menu, queryFn: menuApi.getMenu });

/** Sold-out flips the switch in the cache first, so it responds instantly to a tap. */
export function useSetSoldOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, soldOut }: { itemId: string; soldOut: boolean }) =>
      menuApi.setSoldOut(itemId, soldOut),
    onMutate: ({ itemId, soldOut }) => {
      const before = qc.getQueryData<Menu>(keys.menu);
      if (before)
        qc.setQueryData<Menu>(keys.menu, {
          ...before,
          sections: before.sections.map((s) => ({
            ...s,
            items: s.items.map((i) => (i.id === itemId ? { ...i, soldOut } : i)),
          })),
        });
      return { before };
    },
    onError: (_e, _v, ctx) => ctx?.before && qc.setQueryData(keys.menu, ctx.before),
    onSuccess: (menu) => qc.setQueryData(keys.menu, menu),
  });
}

export const useSaveItem = () => useReplace(keys.menu, menuApi.saveItem);
export const useDeleteItem = () => useReplace(keys.menu, menuApi.deleteItem);
export const useAddSection = () => useReplace(keys.menu, menuApi.addSection);
export const useMoveSection = () =>
  useReplace(keys.menu, ({ id, direction }: { id: string; direction: -1 | 1 }) =>
    menuApi.moveSection(id, direction),
  );

// ---------- Outlet ----------

export const useOutlet = () => useQuery({ queryKey: keys.outlet, queryFn: outlet.getOutlet });
export const useSetBusy = () =>
  useReplace<Outlet["status"]["busyExtra"], Outlet>(keys.outlet, outlet.setBusy);
export const useSetPause = () => useReplace(keys.outlet, outlet.setPause);
export const useSaveHours = () => useReplace(keys.outlet, outlet.saveHours);
export const useAddClosure = () => useReplace(keys.outlet, outlet.addClosure);
export const useRemoveClosure = () => useReplace(keys.outlet, outlet.removeClosure);
export const useSaveDetails = () => useReplace(keys.outlet, outlet.saveDetails);

// ---------- Promotions ----------

export const useOffers = () => useQuery({ queryKey: keys.offers, queryFn: promotions.listOffers });

function useOffersMutation<A>(fn: (arg: A) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: keys.offers }) });
}
export const useCreateOffer = () => useOffersMutation(promotions.createOffer);
export const useEndOffer = () => useOffersMutation(promotions.endOffer);

// ---------- Payouts ----------

export const useSales = (from: string, to: string) =>
  useQuery({ queryKey: keys.sales(from, to), queryFn: () => payouts.getSales(from, to) });
export const useStatements = () => useQuery({ queryKey: keys.statements, queryFn: payouts.listStatements });

// ---------- Reviews ----------

export const useReviews = () => useQuery({ queryKey: keys.reviews, queryFn: reviews.listReviews });

export function useReplyToReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: reviews.replyToReview,
    onSuccess: (review) =>
      qc.setQueryData<Review[]>(keys.reviews, (xs) => xs?.map((r) => (r.id === review.id ? review : r))),
  });
}

// ---------- Staff and settings ----------

export const useStaff = () => useQuery({ queryKey: keys.staff, queryFn: partner.listStaff });

export function useInviteStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: partner.inviteStaff,
    onSuccess: (m) => qc.setQueryData<StaffMember[]>(keys.staff, (xs) => [...(xs ?? []), m]),
  });
}
export const useChangeRole = () => useReplace(keys.staff, partner.changeRole);
export const useRemoveStaff = () => useReplace(keys.staff, partner.removeStaff);

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: partner.getSettings });
export const useSaveSettings = () => useReplace(keys.settings, partner.saveSettings);
export const usePrintTest = () => useMutation({ mutationFn: partner.printTestTicket });

export const useApplication = () => useQuery({ queryKey: keys.application, queryFn: partner.getApplication });
export const useSubmitApplication = () => useReplace(keys.application, partner.submitApplication);
