import { credentials, status } from "@grpc/grpc-js";
import { CatalogServiceClient } from "@kade/proto/kade/catalog/v1/catalog_service";
import { PaymentServiceClient } from "@kade/proto/kade/payment/v1/payment_service";
import { PricingServiceClient } from "@kade/proto/kade/pricing/v1/pricing_service";
import { CreditServiceClient, CustomerServiceClient } from "@kade/proto/kade/profile/v1/profile_service";
import { PromotionServiceClient } from "@kade/proto/kade/promotion/v1/promotion_service";
import type { Config } from "../platform/config.js";
import { DependencyError, unary } from "./grpc-call.js";
import type { CatalogPort, PaymentPort, PricingPort, ProfilePort, PromotionPort } from "./ports.js";

/** Reads are retried twice inside the call; writes rely on Temporal activity retries + idempotency keys. */
const READ_RETRIES = 2;

const insecure = () => credentials.createInsecure();

function isNotFound(err: unknown): boolean {
  return err instanceof DependencyError && err.code === status.NOT_FOUND;
}

export function grpcCatalog(config: Config): CatalogPort & { close(): void } {
  const client = new CatalogServiceClient(config.CATALOG_GRPC, insecure());
  const read = { deadlineMs: config.GRPC_CLIENT_DEADLINE_MS, retries: READ_RETRIES };
  return {
    validateCart: (request) => unary("catalog", client.validateCart.bind(client), request, read),
    async getRestaurant(id) {
      try {
        const res = await unary("catalog", client.getRestaurant.bind(client), { id }, read);
        return res.restaurant;
      } catch (err) {
        if (isNotFound(err)) return undefined;
        throw err;
      }
    },
    close: () => client.close(),
  };
}

export function grpcProfile(config: Config): ProfilePort & { close(): void } {
  const customers = new CustomerServiceClient(config.PROFILE_GRPC, insecure());
  const credit = new CreditServiceClient(config.PROFILE_GRPC, insecure());
  const read = { deadlineMs: config.GRPC_CLIENT_DEADLINE_MS, retries: READ_RETRIES };
  const write = { deadlineMs: config.GRPC_CLIENT_DEADLINE_MS };
  return {
    async getCustomer(customerId) {
      try {
        const res = await unary("profile", customers.getCustomer.bind(customers), { customerId }, read);
        return res.customer;
      } catch (err) {
        if (isNotFound(err)) return undefined;
        throw err;
      }
    },
    async getCreditBalance(customerId) {
      try {
        const res = await unary(
          "profile",
          credit.getCreditAccount.bind(credit),
          { customerId, page: { pageSize: 1, pageToken: "" } },
          read,
        );
        return res.account?.balance?.amountMinor ?? 0;
      } catch (err) {
        if (isNotFound(err)) return 0;
        throw err;
      }
    },
    changeCredit: (request) => unary("profile", credit.changeCredit.bind(credit), request, write),
    close: () => {
      customers.close();
      credit.close();
    },
  };
}

export function grpcPricing(config: Config): PricingPort & { close(): void } {
  const client = new PricingServiceClient(config.PRICING_GRPC, insecure());
  const read = { deadlineMs: config.GRPC_CLIENT_DEADLINE_MS, retries: READ_RETRIES };
  return {
    resolveZone: (location) => unary("pricing", client.resolveZone.bind(client), { location }, read),
    quoteCart: (request) => unary("pricing", client.quoteCart.bind(client), request, read),
    close: () => client.close(),
  };
}

export function grpcPromotion(config: Config): PromotionPort & { close(): void } {
  const client = new PromotionServiceClient(config.PROMOTION_GRPC, insecure());
  const read = { deadlineMs: config.GRPC_CLIENT_DEADLINE_MS, retries: READ_RETRIES };
  const write = { deadlineMs: config.GRPC_CLIENT_DEADLINE_MS };
  return {
    evaluateRestaurantOffer: (request) =>
      unary("promotion", client.evaluateRestaurantOffer.bind(client), request, read),
    validatePromo: (request) => unary("promotion", client.validatePromo.bind(client), request, read),
    reservePromo: (request) => unary("promotion", client.reservePromo.bind(client), request, write),
    async releasePromo(request) {
      await unary("promotion", client.releasePromo.bind(client), request, write);
    },
    close: () => client.close(),
  };
}

export function grpcPayment(config: Config): PaymentPort & { close(): void } {
  const client = new PaymentServiceClient(config.PAYMENT_GRPC, insecure());
  // Payment talks to a PSP behind it: give it a little longer than the default.
  const write = { deadlineMs: Math.max(config.GRPC_CLIENT_DEADLINE_MS, 5_000) };
  const payment = async <T extends { payment?: unknown }>(p: Promise<T>) => {
    const res = await p;
    if (!res.payment)
      throw new DependencyError("payment", status.INTERNAL, undefined, "response without payment");
    return res.payment as NonNullable<T["payment"]>;
  };
  return {
    authorise: (r) => payment(unary("payment", client.authorisePayment.bind(client), r, write)),
    adjust: (r) => payment(unary("payment", client.adjustAuthorisation.bind(client), r, write)),
    capture: (r) => payment(unary("payment", client.capturePayment.bind(client), r, write)),
    recordCash: (r) => payment(unary("payment", client.recordCashCollection.bind(client), r, write)),
    void: (r) => payment(unary("payment", client.voidPayment.bind(client), r, write)),
    refund: (r) => unary("payment", client.refundPayment.bind(client), r, write),
    close: () => client.close(),
  };
}
