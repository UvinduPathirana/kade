// Live implementation of the console's API: every function calls gateway-admin
// (gateways/admin, OpenAPI in gateways/admin/openapi.json), which joins the services and returns
// exactly the shapes the mock returns. Signatures are checked against the mock (see ../backend).
import type { Api } from "../backend";
import type { CustomerDetail, CustomerView } from "../customers";
import type { CashView, PayoutBatchView, RefundView, SettlementView } from "../finance";
import type { NearbyRider, OrderView } from "../orders";
import type { Pricing } from "../pricing";
import type { HomeContent } from "../content";
import type {
  AuditEntry,
  Collection,
  HomeCategory,
  LiveSnapshot,
  Macro,
  Permission,
  PermissionMatrix,
  Restaurant,
  RestaurantApplication,
  Rider,
  RiderApplication,
  Role,
  Staff,
  SurchargeRule,
  Ticket,
  Voucher,
  WeatherSurcharge,
  Zone,
} from "../types";
import { get, patch, post, put, seg } from "./http";

type Fn<K extends keyof Api, F extends keyof Api[K]> = Api[K][F];

const order = (id: string) => `/v1/orders/${seg(id)}`;
const ticket = (id: string) => `/v1/tickets/${seg(id)}`;

export const gatewayApi: Api = {
  live: {
    getLiveSnapshot: () => get<LiveSnapshot>("/v1/live"),
  },

  orders: {
    listOrders: () => get<OrderView[]>("/v1/orders"),
    getOrder: (id) => get<OrderView>(order(id)),
    listNearbyRiders: (orderId) => get<NearbyRider[]>(`${order(orderId)}/nearby-riders`),
    reassignRider: ({ orderId, ...body }) => post<OrderView>(`${order(orderId)}/reassign`, body),
    refundOrder: ({ orderId, ...body }) => post<OrderView>(`${order(orderId)}/refunds`, body),
    cancelOrder: ({ orderId, ...body }) => post<OrderView>(`${order(orderId)}/cancel`, body),
    addOrderNote: ({ orderId, body }) => post<OrderView>(`${order(orderId)}/notes`, { body }),
  },

  finance: {
    listPayoutBatches: () => get<PayoutBatchView[]>("/v1/finance/payouts"),
    approvePayoutBatch: (id) => post<PayoutBatchView>(`/v1/finance/payouts/${seg(id)}/approve`),
    listRiderSettlements: () => get<SettlementView[]>("/v1/finance/settlements"),
    settleRider: (riderId) => post<SettlementView>(`/v1/finance/settlements/${seg(riderId)}/settle`),
    listCashRecords: () => get<CashView[]>("/v1/finance/cash"),
    recordDeposit: ({ id, ...body }) => post<CashView>(`/v1/finance/cash/${seg(id)}/deposit`, body),
    listRefunds: () => get<RefundView[]>("/v1/finance/refunds"),
  },

  partners: {
    listRestaurants: () => get<Restaurant[]>("/v1/restaurants"),
    listRestaurantApplications: () => get<RestaurantApplication[]>("/v1/restaurant-applications"),
    decideRestaurantApplication: ({ id, ...body }) =>
      post<RestaurantApplication>(`/v1/restaurant-applications/${seg(id)}/decision`, body),
    setRestaurantDocStatus: ({ applicationId, docId, status }) =>
      post<RestaurantApplication>(
        `/v1/restaurant-applications/${seg(applicationId)}/documents/${seg(docId)}`,
        {
          status,
        },
      ),
    updateCommission: ({ id, commission }) =>
      put<Restaurant>(`/v1/restaurants/${seg(id)}/commission`, { commission }),
    setRestaurantStatus: ({ id, ...body }) => put<Restaurant>(`/v1/restaurants/${seg(id)}/status`, body),
    listRiders: () => get<Rider[]>("/v1/riders"),
    listRiderApplications: () => get<RiderApplication[]>("/v1/rider-applications"),
    listZones: () => get<Zone[]>("/v1/zones"),
    reviewRiderDoc: ({ applicationId, docId, ...body }) =>
      post<RiderApplication>(`/v1/rider-applications/${seg(applicationId)}/documents/${seg(docId)}`, body),
    decideRiderApplication: ({ id, ...body }) =>
      post<RiderApplication>(`/v1/rider-applications/${seg(id)}/decision`, body),
    setRiderZones: ({ id, zoneIds }) => put<Rider>(`/v1/riders/${seg(id)}/zones`, { zoneIds }),
    setRiderSuspended: ({ id, ...body }) => put<Rider>(`/v1/riders/${seg(id)}/suspension`, body),
  },

  customers: {
    listCustomers: () => get<CustomerView[]>("/v1/customers"),
    getCustomer: (id) => get<CustomerDetail>(`/v1/customers/${seg(id)}`),
    issueCredit: ({ id, ...body }) => post<CustomerView>(`/v1/customers/${seg(id)}/credit`, body),
    resolveFlag: ({ customerId, flagId, ...body }) =>
      post<CustomerView>(`/v1/customers/${seg(customerId)}/flags/${seg(flagId)}`, body),
    setBlocked: ({ id, ...body }) => put<CustomerView>(`/v1/customers/${seg(id)}/block`, body),
  },

  pricing: {
    getPricing: () => get<Pricing>("/v1/pricing"),
    setZoneOpen: ({ id, open }) => put<Zone>(`/v1/zones/${seg(id)}/open`, { open }),
    updateZoneFees: ({ id, ...fees }) => put<Zone>(`/v1/zones/${seg(id)}/fees`, fees),
    saveSurcharge: (rule) => post<SurchargeRule>("/v1/surcharges", rule),
    setSurchargeEnabled: ({ id, enabled }) =>
      put<SurchargeRule>(`/v1/surcharges/${seg(id)}/enabled`, { enabled }),
    setWeather: (next) => put<WeatherSurcharge>("/v1/weather", next),
  },

  promotions: {
    listVouchers: () => get<Voucher[]>("/v1/vouchers"),
    createVoucher: (v) => post<Voucher>("/v1/vouchers", v),
    setVoucherStatus: ({ code, status }) => put<Voucher>(`/v1/vouchers/${seg(code)}/status`, { status }),
  },

  support: {
    listTickets: () => get<Ticket[]>("/v1/tickets"),
    listMacros: () => get<Macro[]>("/v1/macros"),
    listStaffNames: () => get<{ id: string; name: string; role: Role }[]>("/v1/staff/names"),
    replyToTicket: ({ id, body }) => post<Ticket>(`${ticket(id)}/replies`, { body }),
    assignTicket: ({ id, assigneeId }) => put<Ticket>(`${ticket(id)}/assignee`, { assigneeId }),
    setTicketPriority: ({ id, priority }) => put<Ticket>(`${ticket(id)}/priority`, { priority }),
    resolveTicket: ({ id, ...body }) => post<Ticket>(`${ticket(id)}/resolve`, body),
    reopenTicket: (id) => post<Ticket>(`${ticket(id)}/reopen`),
  },

  content: {
    getHomeContent: () => get<HomeContent>("/v1/content"),
    moveCategory: ({ id, direction }) =>
      post<HomeCategory[]>(`/v1/content/categories/${seg(id)}/move`, { direction }),
    updateCategory: ({ id, ...p }) => patch<HomeCategory>(`/v1/content/categories/${seg(id)}`, p),
    saveCollection: (input) => post<Collection>("/v1/content/collections", input),
    setCollectionVisible: ({ id, visible }) =>
      put<Collection>(`/v1/content/collections/${seg(id)}/visible`, { visible }),
    moveCollection: ({ id, direction }) =>
      post<Collection[]>(`/v1/content/collections/${seg(id)}/move`, { direction }),
  },

  team: {
    listStaff: () => get<Staff[]>("/v1/team/staff"),
    listAudit: () => get<AuditEntry[]>("/v1/audit"),
    getPermissions: () =>
      get<{ permissions: Permission[]; matrix: PermissionMatrix }>("/v1/team/permissions"),
    inviteStaff: ((body) => post<Staff>("/v1/team/staff", body)) as Fn<"team", "inviteStaff">,
    changeRole: ({ id, role }) => put<Staff>(`/v1/team/staff/${seg(id)}/role`, { role }),
    savePermissions: (matrix) => put<PermissionMatrix>("/v1/team/permissions", matrix),
  },
};
