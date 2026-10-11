// TanStack Query hooks: every page reads and writes through these. Mutations go to the backend
// (the mock store, or gateway-admin in live mode, see ./backend), then invalidate what they touched
// (plus the audit log and live dashboard) so every screen agrees.
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "./backend";

const { content, customers, finance, orders, partners, pricing, promotions, support, team } = api;
const { getLiveSnapshot } = api.live;

export const keys = {
  live: ["live"] as const,
  orders: ["orders"] as const,
  order: (id: string) => ["orders", id] as const,
  nearbyRiders: (id: string) => ["orders", id, "nearbyRiders"] as const,
  finance: ["finance"] as const,
  restaurants: ["restaurants"] as const,
  riders: ["riders"] as const,
  zones: ["zones"] as const,
  customers: ["customers"] as const,
  customer: (id: string) => ["customers", id] as const,
  pricing: ["pricing"] as const,
  vouchers: ["vouchers"] as const,
  tickets: ["tickets"] as const,
  content: ["content"] as const,
  team: ["team"] as const,
  audit: ["audit"] as const,
};

function useApiMutation<A, R>(fn: (arg: A) => Promise<R>, touches: QueryKey[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      for (const key of [...touches, keys.audit, keys.live]) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/* ---------- Live ---------- */

export const useLive = (auto: boolean) =>
  useQuery({
    queryKey: keys.live,
    queryFn: getLiveSnapshot,
    refetchInterval: auto ? 5000 : false,
    staleTime: 0,
  });

/* ---------- Orders ---------- */

export const useOrders = () =>
  useQuery({ queryKey: keys.orders, queryFn: orders.listOrders, refetchInterval: 15_000 });
export const useOrder = (id: string | null) =>
  useQuery({
    queryKey: keys.order(id ?? ""),
    queryFn: () => orders.getOrder(id!),
    enabled: !!id,
    refetchInterval: 5000,
    retry: false,
  });
export const useNearbyRiders = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.nearbyRiders(id),
    queryFn: () => orders.listNearbyRiders(id),
    enabled,
    staleTime: 0,
  });

const orderTouches = [keys.orders, keys.finance, keys.customers, keys.riders];
export const useReassignRider = () => useApiMutation(orders.reassignRider, orderTouches);
export const useRefundOrder = () => useApiMutation(orders.refundOrder, orderTouches);
export const useCancelOrder = () => useApiMutation(orders.cancelOrder, orderTouches);
export const useAddOrderNote = () => useApiMutation(orders.addOrderNote, [keys.orders]);

/* ---------- Finance ---------- */

export const usePayoutBatches = () =>
  useQuery({ queryKey: [...keys.finance, "payouts"], queryFn: finance.listPayoutBatches });
export const useRiderSettlements = () =>
  useQuery({ queryKey: [...keys.finance, "settlements"], queryFn: finance.listRiderSettlements });
export const useCashRecords = () =>
  useQuery({ queryKey: [...keys.finance, "cash"], queryFn: finance.listCashRecords });
export const useRefunds = () =>
  useQuery({ queryKey: [...keys.finance, "refunds"], queryFn: finance.listRefunds });

export const useApprovePayoutBatch = () => useApiMutation(finance.approvePayoutBatch, [keys.finance]);
export const useSettleRider = () => useApiMutation(finance.settleRider, [keys.finance, keys.riders]);
export const useRecordDeposit = () => useApiMutation(finance.recordDeposit, [keys.finance, keys.riders]);

/* ---------- Restaurants and riders ---------- */

export const useRestaurants = () =>
  useQuery({ queryKey: [...keys.restaurants, "all"], queryFn: partners.listRestaurants });
export const useRestaurantApplications = () =>
  useQuery({ queryKey: [...keys.restaurants, "applications"], queryFn: partners.listRestaurantApplications });
export const useDecideRestaurantApplication = () =>
  useApiMutation(partners.decideRestaurantApplication, [keys.restaurants, keys.content]);
export const useSetRestaurantDocStatus = () =>
  useApiMutation(partners.setRestaurantDocStatus, [keys.restaurants]);
export const useUpdateCommission = () =>
  useApiMutation(partners.updateCommission, [keys.restaurants, keys.finance]);
export const useSetRestaurantStatus = () =>
  useApiMutation(partners.setRestaurantStatus, [keys.restaurants, keys.content]);

export const useRiders = () =>
  useQuery({ queryKey: [...keys.riders, "all"], queryFn: partners.listRiders, refetchInterval: 15_000 });
export const useRiderApplications = () =>
  useQuery({ queryKey: [...keys.riders, "applications"], queryFn: partners.listRiderApplications });
export const useZones = () => useQuery({ queryKey: keys.zones, queryFn: partners.listZones });
export const useReviewRiderDoc = () => useApiMutation(partners.reviewRiderDoc, [keys.riders]);
export const useDecideRiderApplication = () => useApiMutation(partners.decideRiderApplication, [keys.riders]);
export const useSetRiderZones = () => useApiMutation(partners.setRiderZones, [keys.riders]);
export const useSetRiderSuspended = () => useApiMutation(partners.setRiderSuspended, [keys.riders]);

/* ---------- Customers ---------- */

export const useCustomers = () =>
  useQuery({ queryKey: [...keys.customers, "all"], queryFn: customers.listCustomers });
export const useCustomer = (id: string | null) =>
  useQuery({ queryKey: keys.customer(id ?? ""), queryFn: () => customers.getCustomer(id!), enabled: !!id });
export const useIssueCredit = () => useApiMutation(customers.issueCredit, [keys.customers]);
export const useResolveFlag = () => useApiMutation(customers.resolveFlag, [keys.customers]);
export const useSetBlocked = () => useApiMutation(customers.setBlocked, [keys.customers]);

/* ---------- Pricing ---------- */

export const usePricing = () => useQuery({ queryKey: keys.pricing, queryFn: pricing.getPricing });
const pricingTouches = [keys.pricing, keys.zones];
export const useSetZoneOpen = () => useApiMutation(pricing.setZoneOpen, pricingTouches);
export const useUpdateZoneFees = () => useApiMutation(pricing.updateZoneFees, pricingTouches);
export const useSaveSurcharge = () => useApiMutation(pricing.saveSurcharge, pricingTouches);
export const useSetSurchargeEnabled = () => useApiMutation(pricing.setSurchargeEnabled, pricingTouches);
export const useSetWeather = () => useApiMutation(pricing.setWeather, pricingTouches);

/* ---------- Promotions ---------- */

export const useVouchers = () => useQuery({ queryKey: keys.vouchers, queryFn: promotions.listVouchers });
export const useCreateVoucher = () => useApiMutation(promotions.createVoucher, [keys.vouchers]);
export const useSetVoucherStatus = () => useApiMutation(promotions.setVoucherStatus, [keys.vouchers]);

/* ---------- Support ---------- */

export const useTickets = () => useQuery({ queryKey: keys.tickets, queryFn: support.listTickets });
export const useMacros = () =>
  useQuery({ queryKey: [...keys.tickets, "macros"], queryFn: support.listMacros });
export const useStaffNames = () =>
  useQuery({ queryKey: [...keys.team, "names"], queryFn: support.listStaffNames });
const ticketTouches = [keys.tickets];
export const useReplyToTicket = () => useApiMutation(support.replyToTicket, ticketTouches);
export const useAssignTicket = () => useApiMutation(support.assignTicket, ticketTouches);
export const useSetTicketPriority = () => useApiMutation(support.setTicketPriority, ticketTouches);
export const useResolveTicket = () =>
  useApiMutation(support.resolveTicket, [keys.tickets, keys.orders, keys.finance, keys.customers]);
export const useReopenTicket = () => useApiMutation(support.reopenTicket, ticketTouches);

/* ---------- Home feed ---------- */

export const useHomeContent = () => useQuery({ queryKey: keys.content, queryFn: content.getHomeContent });
export const useMoveCategory = () => useApiMutation(content.moveCategory, [keys.content]);
export const useUpdateCategory = () => useApiMutation(content.updateCategory, [keys.content]);
export const useSaveCollection = () => useApiMutation(content.saveCollection, [keys.content]);
export const useSetCollectionVisible = () => useApiMutation(content.setCollectionVisible, [keys.content]);
export const useMoveCollection = () => useApiMutation(content.moveCollection, [keys.content]);

/* ---------- Team ---------- */

export const useStaff = () => useQuery({ queryKey: [...keys.team, "staff"], queryFn: team.listStaff });
export const usePermissions = () =>
  useQuery({ queryKey: [...keys.team, "permissions"], queryFn: team.getPermissions });
export const useAudit = () => useQuery({ queryKey: keys.audit, queryFn: team.listAudit });
export const useInviteStaff = () => useApiMutation(team.inviteStaff, [keys.team]);
export const useChangeRole = () => useApiMutation(team.changeRole, [keys.team]);
export const useSavePermissions = () => useApiMutation(team.savePermissions, [keys.team]);
