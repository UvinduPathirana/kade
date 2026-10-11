import { credentials, type Client, type ClientOptions } from "@grpc/grpc-js";
import { MerchandisingServiceClient } from "@kade/proto/kade/catalog/v1/catalog_service";
import { DispatchOpsServiceClient, RiderServiceClient } from "@kade/proto/kade/dispatch/v1/dispatch_service";
import { AuditServiceClient, StaffServiceClient } from "@kade/proto/kade/identity/v1/identity_service";
import {
  LedgerServiceClient,
  PayoutServiceClient,
  RiderFinanceServiceClient,
} from "@kade/proto/kade/ledger/v1/ledger_service";
import {
  OutletAdminServiceClient,
  PartnerApplicationServiceClient,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import { OrderServiceClient } from "@kade/proto/kade/order/v1/order_service";
import { PricingServiceClient } from "@kade/proto/kade/pricing/v1/pricing_service";
import { CreditServiceClient, CustomerServiceClient } from "@kade/proto/kade/profile/v1/profile_service";
import { VoucherServiceClient } from "@kade/proto/kade/promotion/v1/promotion_service";
import { TicketAdminServiceClient } from "@kade/proto/kade/support/v1/support_service";
import type { Config } from "../config.js";

// Retries only for idempotent reads (CONVENTIONS, "Synchronous calls"). grpc-js applies this
// service config per method; mutating RPCs are never retried here, the app retries them with
// the same Idempotency-Key instead.
const serviceConfig = (service: string, idempotentMethods: string[]) =>
  JSON.stringify({
    methodConfig: [
      {
        name: idempotentMethods.map((method) => ({ service, method })),
        retryPolicy: {
          maxAttempts: 3,
          initialBackoff: "0.1s",
          maxBackoff: "1s",
          backoffMultiplier: 2,
          retryableStatusCodes: ["UNAVAILABLE"],
        },
      },
    ],
  });

/** Every upstream the admin console needs. Tests pass fakes with only the methods they use. */
export interface Upstreams {
  order: OrderServiceClient;
  dispatchOps: DispatchOpsServiceClient;
  riders: RiderServiceClient;
  outlets: OutletAdminServiceClient;
  applications: PartnerApplicationServiceClient;
  merchandising: MerchandisingServiceClient;
  customers: CustomerServiceClient;
  credit: CreditServiceClient;
  staff: StaffServiceClient;
  audit: AuditServiceClient;
  pricing: PricingServiceClient;
  vouchers: VoucherServiceClient;
  ledger: LedgerServiceClient;
  payouts: PayoutServiceClient;
  riderFinance: RiderFinanceServiceClient;
  tickets: TicketAdminServiceClient;
}

type Ctor<T> = new (
  address: string,
  creds: ReturnType<typeof credentials.createInsecure>,
  o?: Partial<ClientOptions>,
) => T;

// Reads that are safe to retry on UNAVAILABLE, per fully-qualified service.
const READS: Record<string, string[]> = {
  "kade.order.v1.OrderService": ["GetOrder", "BatchGetOrders", "ListOrders", "ListOrderRefunds"],
  "kade.dispatch.v1.DispatchOpsService": ["GetLiveSnapshot", "ListNearbyRiders", "GetDelivery"],
  "kade.dispatch.v1.RiderService": ["ListRiders", "GetRider", "ListRiderApplications"],
  "kade.merchant.v1.OutletAdminService": ["ListOutlets", "GetOutletAdmin"],
  "kade.merchant.v1.PartnerApplicationService": ["ListApplications", "GetApplication"],
  "kade.catalog.v1.MerchandisingService": ["ListHomeCategories", "ListCollections"],
  "kade.profile.v1.CustomerService": ["GetCustomer", "ListCustomers", "GetCustomerDetail"],
  "kade.profile.v1.CreditService": ["GetCreditAccount"],
  "kade.identity.v1.StaffService": ["ListStaff", "GetPermissionMatrix"],
  "kade.identity.v1.AuditService": ["ListAuditEntries"],
  "kade.pricing.v1.PricingService": ["GetPricingConfig", "ListZones"],
  "kade.promotion.v1.VoucherService": ["ListVouchers", "GetVoucher"],
  "kade.ledger.v1.LedgerService": ["ListRefunds"],
  "kade.ledger.v1.PayoutService": ["ListPayoutBatches", "GetPayoutBatch"],
  "kade.ledger.v1.RiderFinanceService": ["ListRiderSettlements", "ListCashRecords"],
  "kade.support.v1.TicketAdminService": ["ListTickets", "GetTicket", "ListMacros"],
};

function make<T>(ctor: Ctor<T> & { serviceName?: string }, address: string): T {
  const name = (ctor as unknown as { serviceName: string }).serviceName;
  return new ctor(address, credentials.createInsecure(), {
    "grpc.service_config": serviceConfig(name, READS[name] ?? []),
    "grpc.keepalive_time_ms": 30_000,
  });
}

/** One long-lived channel per upstream client; grpc-js reconnects and load-balances underneath. */
export function createUpstreams(config: Config): Upstreams {
  return {
    order: make(OrderServiceClient, config.ORDER_GRPC),
    dispatchOps: make(DispatchOpsServiceClient, config.DISPATCH_GRPC),
    riders: make(RiderServiceClient, config.DISPATCH_GRPC),
    outlets: make(OutletAdminServiceClient, config.MERCHANT_GRPC),
    applications: make(PartnerApplicationServiceClient, config.MERCHANT_GRPC),
    merchandising: make(MerchandisingServiceClient, config.CATALOG_GRPC),
    customers: make(CustomerServiceClient, config.PROFILE_GRPC),
    credit: make(CreditServiceClient, config.PROFILE_GRPC),
    staff: make(StaffServiceClient, config.PROFILE_GRPC),
    audit: make(AuditServiceClient, config.PROFILE_GRPC),
    pricing: make(PricingServiceClient, config.PRICING_GRPC),
    vouchers: make(VoucherServiceClient, config.PROMOTION_GRPC),
    ledger: make(LedgerServiceClient, config.LEDGER_GRPC),
    payouts: make(PayoutServiceClient, config.LEDGER_GRPC),
    riderFinance: make(RiderFinanceServiceClient, config.LEDGER_GRPC),
    tickets: make(TicketAdminServiceClient, config.SUPPORT_GRPC),
  };
}

export function closeUpstreams(up: Upstreams): void {
  for (const client of Object.values(up) as Client[]) client.close?.();
}
