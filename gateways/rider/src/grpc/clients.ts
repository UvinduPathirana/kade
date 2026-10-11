import { credentials, type ChannelCredentials, type Client, type ClientOptions } from "@grpc/grpc-js";
import { DispatchServiceClient, RiderServiceClient } from "@kade/proto/kade/dispatch/v1/dispatch_service";
import { RiderFinanceServiceClient } from "@kade/proto/kade/ledger/v1/ledger_service";
import { LocationServiceClient } from "@kade/proto/kade/location/v1/location_service";
import { ReviewServiceClient } from "@kade/proto/kade/review/v1/review_service";
import { SupportServiceClient } from "@kade/proto/kade/support/v1/support_service";
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
  dispatch: DispatchServiceClient;
  riders: RiderServiceClient;
  location: LocationServiceClient;
  finance: RiderFinanceServiceClient;
  reviews: ReviewServiceClient;
  support: SupportServiceClient;
}

export function createUpstreams(
  config: Pick<Config, "DISPATCH_GRPC" | "LOCATION_GRPC" | "LEDGER_GRPC" | "REVIEW_GRPC" | "SUPPORT_GRPC">,
): Upstreams {
  const d = config.DISPATCH_GRPC;
  return {
    dispatch: make(DispatchServiceClient, d, "kade.dispatch.v1.DispatchService", [
      "GetCurrentOffer",
      "GetActiveJob",
      "ListTrips",
      "GetTrip",
      "ListQuests",
    ]),
    riders: make(RiderServiceClient, d, "kade.dispatch.v1.RiderService", [
      "GetMyRider",
      "GetRiderProfile",
      "ListRiderDocuments",
      "GetRiderApplicationStatus",
    ]),
    location: make(LocationServiceClient, config.LOCATION_GRPC, "kade.location.v1.LocationService", []),
    finance: make(RiderFinanceServiceClient, config.LEDGER_GRPC, "kade.ledger.v1.RiderFinanceService", [
      "GetRiderEarnings",
      "GetRiderCashBalance",
      "ListRiderPayouts",
      "ListDepositPoints",
    ]),
    reviews: make(ReviewServiceClient, config.REVIEW_GRPC, "kade.review.v1.ReviewService", [
      "GetRiderRatingsSummary",
    ]),
    support: make(SupportServiceClient, config.SUPPORT_GRPC, "kade.support.v1.SupportService", [
      "ListHelpTopics",
      "ListMessages",
    ]),
  };
}

export function closeUpstreams(u: Upstreams): void {
  for (const client of Object.values(u)) (client as Client).close();
}
