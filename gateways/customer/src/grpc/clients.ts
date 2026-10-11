import { credentials, type ChannelOptions, type Client } from "@grpc/grpc-js";
import { CartServiceClient } from "@kade/proto/kade/cart/v1/cart_service";
import { CatalogServiceClient } from "@kade/proto/kade/catalog/v1/catalog_service";
import { GroupOrderServiceClient, OrderServiceClient } from "@kade/proto/kade/order/v1/order_service";
import { SavedCardServiceClient } from "@kade/proto/kade/payment/v1/payment_service";
import {
  AddressServiceClient,
  CreditServiceClient,
  CustomerServiceClient,
  FavouriteServiceClient,
  PlusServiceClient,
} from "@kade/proto/kade/profile/v1/profile_service";
import {
  GiftCardServiceClient,
  PromotionServiceClient,
  ReferralServiceClient,
} from "@kade/proto/kade/promotion/v1/promotion_service";
import { ReviewServiceClient } from "@kade/proto/kade/review/v1/review_service";
import { SearchServiceClient } from "@kade/proto/kade/search/v1/search_service";
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

const options = (service: string, reads: string[]): ChannelOptions => ({
  "grpc.service_config": serviceConfig(service, reads),
  "grpc.keepalive_time_ms": 30_000,
});

/** Every upstream the customer gateway talks to. Tests pass fakes with the same shape. */
export interface Upstreams {
  catalog: CatalogServiceClient;
  search: SearchServiceClient;
  customer: CustomerServiceClient;
  address: AddressServiceClient;
  favourite: FavouriteServiceClient;
  credit: CreditServiceClient;
  plus: PlusServiceClient;
  cart: CartServiceClient;
  promotion: PromotionServiceClient;
  giftCard: GiftCardServiceClient;
  referral: ReferralServiceClient;
  order: OrderServiceClient;
  group: GroupOrderServiceClient;
  savedCard: SavedCardServiceClient;
  review: ReviewServiceClient;
  support: SupportServiceClient;
}

type Addresses = Pick<
  Config,
  | "CATALOG_GRPC"
  | "SEARCH_GRPC"
  | "PROFILE_GRPC"
  | "CART_GRPC"
  | "PROMOTION_GRPC"
  | "ORDER_GRPC"
  | "PAYMENT_GRPC"
  | "REVIEW_GRPC"
  | "SUPPORT_GRPC"
>;

/** One long-lived channel per upstream client; grpc-js reconnects and load-balances underneath. */
export function createUpstreams(c: Addresses): Upstreams {
  const insecure = credentials.createInsecure();
  return {
    catalog: new CatalogServiceClient(
      c.CATALOG_GRPC,
      insecure,
      options("kade.catalog.v1.CatalogService", [
        "ListCategories",
        "GetCategory",
        "ListRestaurants",
        "GetRestaurant",
        "BatchGetRestaurants",
        "GetMenu",
        "GetHomeFeed",
        "ValidateCart",
      ]),
    ),
    search: new SearchServiceClient(
      c.SEARCH_GRPC,
      insecure,
      options("kade.search.v1.SearchService", [
        "Search",
        "ListPopularSearches",
        "SearchPlaces",
        "ReverseGeocode",
      ]),
    ),
    customer: new CustomerServiceClient(
      c.PROFILE_GRPC,
      insecure,
      // EnsureCustomer is idempotent on customer_id.
      options("kade.profile.v1.CustomerService", ["GetCustomer", "EnsureCustomer", "GetPreferences"]),
    ),
    address: new AddressServiceClient(
      c.PROFILE_GRPC,
      insecure,
      options("kade.profile.v1.AddressService", ["ListAddresses"]),
    ),
    favourite: new FavouriteServiceClient(
      c.PROFILE_GRPC,
      insecure,
      options("kade.profile.v1.FavouriteService", ["ListFavourites"]),
    ),
    credit: new CreditServiceClient(
      c.PROFILE_GRPC,
      insecure,
      options("kade.profile.v1.CreditService", ["GetCreditAccount"]),
    ),
    plus: new PlusServiceClient(
      c.PROFILE_GRPC,
      insecure,
      options("kade.profile.v1.PlusService", ["GetPlusMembership"]),
    ),
    cart: new CartServiceClient(c.CART_GRPC, insecure, options("kade.cart.v1.CartService", ["GetCart"])),
    promotion: new PromotionServiceClient(
      c.PROMOTION_GRPC,
      insecure,
      options("kade.promotion.v1.PromotionService", ["ListPublicPromos", "ValidatePromo"]),
    ),
    giftCard: new GiftCardServiceClient(
      c.PROMOTION_GRPC,
      insecure,
      options("kade.promotion.v1.GiftCardService", ["ListGiftCards"]),
    ),
    referral: new ReferralServiceClient(
      c.PROMOTION_GRPC,
      insecure,
      options("kade.promotion.v1.ReferralService", ["GetReferral"]),
    ),
    order: new OrderServiceClient(
      c.ORDER_GRPC,
      insecure,
      options("kade.order.v1.OrderService", ["GetOrder", "BatchGetOrders", "ListOrders", "GetActiveOrder"]),
    ),
    group: new GroupOrderServiceClient(
      c.ORDER_GRPC,
      insecure,
      options("kade.order.v1.GroupOrderService", ["GetGroupOrder"]),
    ),
    savedCard: new SavedCardServiceClient(
      c.PAYMENT_GRPC,
      insecure,
      options("kade.payment.v1.SavedCardService", ["ListSavedCards"]),
    ),
    review: new ReviewServiceClient(
      c.REVIEW_GRPC,
      insecure,
      options("kade.review.v1.ReviewService", ["BatchGetOrderRatings", "ListRestaurantReviews"]),
    ),
    support: new SupportServiceClient(
      c.SUPPORT_GRPC,
      insecure,
      options("kade.support.v1.SupportService", ["PreviewOrderIssue", "BatchGetOrderIssues", "ListMessages"]),
    ),
  };
}

export function closeUpstreams(u: Upstreams): void {
  for (const client of Object.values(u) as Client[]) client.close();
}
