import { credentials, type ChannelCredentials, type Client, type ClientOptions } from "@grpc/grpc-js";
import {
  MenuManagementServiceClient,
  RestaurantManagementServiceClient,
  CatalogServiceClient,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import { RestaurantFinanceServiceClient } from "@kade/proto/kade/ledger/v1/ledger_service";
import {
  KitchenServiceClient,
  OutletServiceClient,
  OutletStaffServiceClient,
  PartnerApplicationServiceClient,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import { OfferServiceClient } from "@kade/proto/kade/promotion/v1/promotion_service";
import { ReviewServiceClient } from "@kade/proto/kade/review/v1/review_service";
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

type Ctor<T> = new (address: string, creds: ChannelCredentials, options?: Partial<ClientOptions>) => T;

/** One long-lived channel per upstream client; grpc-js reconnects and load-balances underneath. */
function make<T extends Client>(Client: Ctor<T>, address: string, service: string, reads: string[]): T {
  return new Client(address, credentials.createInsecure(), {
    "grpc.service_config": serviceConfig(service, reads),
    "grpc.keepalive_time_ms": 30_000,
  });
}

export interface Upstreams {
  kitchen: KitchenServiceClient;
  outlets: OutletServiceClient;
  staff: OutletStaffServiceClient;
  applications: PartnerApplicationServiceClient;
  catalog: CatalogServiceClient;
  menus: MenuManagementServiceClient;
  restaurants: RestaurantManagementServiceClient;
  reviews: ReviewServiceClient;
  finance: RestaurantFinanceServiceClient;
  offers: OfferServiceClient;
}

export function createUpstreams(
  config: Pick<Config, "MERCHANT_GRPC" | "CATALOG_GRPC" | "REVIEW_GRPC" | "LEDGER_GRPC" | "PROMOTION_GRPC">,
): Upstreams {
  const m = config.MERCHANT_GRPC;
  const c = config.CATALOG_GRPC;
  return {
    kitchen: make(KitchenServiceClient, m, "kade.merchant.v1.KitchenService", ["ListTickets", "GetTicket"]),
    outlets: make(OutletServiceClient, m, "kade.merchant.v1.OutletService", [
      "GetOutlet",
      "GetOutletSettings",
    ]),
    staff: make(OutletStaffServiceClient, m, "kade.merchant.v1.OutletStaffService", [
      "ListOutletStaff",
      "GetMyOutlets",
    ]),
    applications: make(PartnerApplicationServiceClient, m, "kade.merchant.v1.PartnerApplicationService", [
      "GetMyApplication",
    ]),
    catalog: make(CatalogServiceClient, c, "kade.catalog.v1.CatalogService", ["GetMenu", "GetRestaurant"]),
    menus: make(MenuManagementServiceClient, c, "kade.catalog.v1.MenuManagementService", []),
    restaurants: make(RestaurantManagementServiceClient, c, "kade.catalog.v1.RestaurantManagementService", [
      "GetOpeningHours",
    ]),
    reviews: make(ReviewServiceClient, config.REVIEW_GRPC, "kade.review.v1.ReviewService", [
      "ListRestaurantReviews",
    ]),
    finance: make(
      RestaurantFinanceServiceClient,
      config.LEDGER_GRPC,
      "kade.ledger.v1.RestaurantFinanceService",
      ["GetOutletSales", "ListOutletStatements", "GetOutletStatement", "ExportOutletStatementCsv"],
    ),
    offers: make(OfferServiceClient, config.PROMOTION_GRPC, "kade.promotion.v1.OfferService", ["ListOffers"]),
  };
}

export function closeUpstreams(u: Upstreams): void {
  for (const client of Object.values(u)) (client as Client).close();
}
