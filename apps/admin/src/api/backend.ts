// The one switch between the in-browser demo and the real backend. Every query hook in queries.ts
// calls through `api`; both implementations have exactly the same signatures (the type below is
// taken from the mock modules, and ./gateway must satisfy it).
import { isLive } from "./config";
import * as content from "./content";
import * as customers from "./customers";
import * as finance from "./finance";
import { gatewayApi } from "./gateway";
import { getLiveSnapshot } from "./live";
import * as orders from "./orders";
import * as partners from "./partners";
import * as pricing from "./pricing";
import * as promotions from "./promotions";
import * as support from "./support";
import * as team from "./team";

const mockApi = {
  live: { getLiveSnapshot },
  orders: {
    listOrders: orders.listOrders,
    getOrder: orders.getOrder,
    listNearbyRiders: orders.listNearbyRiders,
    reassignRider: orders.reassignRider,
    refundOrder: orders.refundOrder,
    cancelOrder: orders.cancelOrder,
    addOrderNote: orders.addOrderNote,
  },
  finance: {
    listPayoutBatches: finance.listPayoutBatches,
    approvePayoutBatch: finance.approvePayoutBatch,
    listRiderSettlements: finance.listRiderSettlements,
    settleRider: finance.settleRider,
    listCashRecords: finance.listCashRecords,
    recordDeposit: finance.recordDeposit,
    listRefunds: finance.listRefunds,
  },
  partners: {
    listRestaurants: partners.listRestaurants,
    listRestaurantApplications: partners.listRestaurantApplications,
    decideRestaurantApplication: partners.decideRestaurantApplication,
    setRestaurantDocStatus: partners.setRestaurantDocStatus,
    updateCommission: partners.updateCommission,
    setRestaurantStatus: partners.setRestaurantStatus,
    listRiders: partners.listRiders,
    listRiderApplications: partners.listRiderApplications,
    listZones: partners.listZones,
    reviewRiderDoc: partners.reviewRiderDoc,
    decideRiderApplication: partners.decideRiderApplication,
    setRiderZones: partners.setRiderZones,
    setRiderSuspended: partners.setRiderSuspended,
  },
  customers: {
    listCustomers: customers.listCustomers,
    getCustomer: customers.getCustomer,
    issueCredit: customers.issueCredit,
    resolveFlag: customers.resolveFlag,
    setBlocked: customers.setBlocked,
  },
  pricing: {
    getPricing: pricing.getPricing,
    setZoneOpen: pricing.setZoneOpen,
    updateZoneFees: pricing.updateZoneFees,
    saveSurcharge: pricing.saveSurcharge,
    setSurchargeEnabled: pricing.setSurchargeEnabled,
    setWeather: pricing.setWeather,
  },
  promotions: {
    listVouchers: promotions.listVouchers,
    createVoucher: promotions.createVoucher,
    setVoucherStatus: promotions.setVoucherStatus,
  },
  support: {
    listTickets: support.listTickets,
    listMacros: support.listMacros,
    listStaffNames: support.listStaffNames,
    replyToTicket: support.replyToTicket,
    assignTicket: support.assignTicket,
    setTicketPriority: support.setTicketPriority,
    resolveTicket: support.resolveTicket,
    reopenTicket: support.reopenTicket,
  },
  content: {
    getHomeContent: content.getHomeContent,
    moveCategory: content.moveCategory,
    updateCategory: content.updateCategory,
    saveCollection: content.saveCollection,
    setCollectionVisible: content.setCollectionVisible,
    moveCollection: content.moveCollection,
  },
  team: {
    listStaff: team.listStaff,
    listAudit: team.listAudit,
    getPermissions: team.getPermissions,
    inviteStaff: team.inviteStaff,
    changeRole: team.changeRole,
    savePermissions: team.savePermissions,
  },
};

export type Api = typeof mockApi;

export const api: Api = isLive ? gatewayApi : mockApi;
