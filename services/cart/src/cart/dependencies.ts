import { credentials, status, type Client } from "@grpc/grpc-js";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import {
  CatalogServiceClient,
  type ValidateCartRequest,
  type ValidateCartResponse,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import {
  PricingServiceClient,
  type QuoteCartRequest,
  type QuoteCartResponse,
} from "@kade/proto/kade/pricing/v1/pricing_service";
import {
  CreditServiceClient,
  PlusServiceClient,
  type GetCreditAccountRequest,
  type GetCreditAccountResponse,
  type GetPlusMembershipRequest,
  type GetPlusMembershipResponse,
} from "@kade/proto/kade/profile/v1/profile_service";
import {
  PromotionServiceClient,
  type EvaluateRestaurantOfferRequest,
  type EvaluateRestaurantOfferResponse,
  type ValidatePromoRequest,
  type ValidatePromoResponse,
} from "@kade/proto/kade/promotion/v1/promotion_service";
import { CONFIG, type Config } from "../platform/config.js";
import { callUnary, isServiceError, type UnaryMethod } from "../platform/grpc/client.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { DomainError } from "../platform/grpc/errors.js";

// The services cart talks to, as narrow ports so handlers can be unit-tested with fakes.

export interface CatalogPort {
  validateCart(request: ValidateCartRequest, ctx: RequestContext): Promise<ValidateCartResponse>;
}
export interface PricingPort {
  quoteCart(request: QuoteCartRequest, ctx: RequestContext): Promise<QuoteCartResponse>;
}
export interface PromotionPort {
  validatePromo(request: ValidatePromoRequest, ctx: RequestContext): Promise<ValidatePromoResponse>;
  evaluateRestaurantOffer(
    request: EvaluateRestaurantOfferRequest,
    ctx: RequestContext,
  ): Promise<EvaluateRestaurantOfferResponse>;
}
export interface ProfilePort {
  getPlusMembership(
    request: GetPlusMembershipRequest,
    ctx: RequestContext,
  ): Promise<GetPlusMembershipResponse>;
  getCreditAccount(request: GetCreditAccountRequest, ctx: RequestContext): Promise<GetCreditAccountResponse>;
}

export const CATALOG = Symbol("CatalogPort");
export const PRICING = Symbol("PricingPort");
export const PROMOTION = Symbol("PromotionPort");
export const PROFILE = Symbol("ProfilePort");

/**
 * gRPC adapters for the four ports. Every call has a deadline; reads (all of these are reads)
 * retry once on UNAVAILABLE. Errors surface as the raw ServiceError; see `dependencyFailure`.
 */
@Injectable()
export class GrpcDependencies
  implements CatalogPort, PricingPort, PromotionPort, ProfilePort, OnApplicationShutdown
{
  private readonly catalog: CatalogServiceClient;
  private readonly pricing: PricingServiceClient;
  private readonly promotion: PromotionServiceClient;
  private readonly credit: CreditServiceClient;
  private readonly plus: PlusServiceClient;
  private readonly timeoutMs: number;

  constructor(@Inject(CONFIG) config: Config) {
    const insecure = credentials.createInsecure();
    this.catalog = new CatalogServiceClient(config.CATALOG_GRPC, insecure);
    this.pricing = new PricingServiceClient(config.PRICING_GRPC, insecure);
    this.promotion = new PromotionServiceClient(config.PROMOTION_GRPC, insecure);
    this.credit = new CreditServiceClient(config.PROFILE_GRPC, insecure);
    this.plus = new PlusServiceClient(config.PROFILE_GRPC, insecure);
    this.timeoutMs = config.DOWNSTREAM_DEADLINE_MS;
  }

  private call<Req, Res>(client: Client, method: UnaryMethod<Req, Res>, request: Req, ctx: RequestContext) {
    return callUnary(method.bind(client) as UnaryMethod<Req, Res>, request, {
      ctx,
      timeoutMs: this.timeoutMs,
      retry: true,
    });
  }

  validateCart(request: ValidateCartRequest, ctx: RequestContext) {
    return this.call<ValidateCartRequest, ValidateCartResponse>(
      this.catalog,
      this.catalog.validateCart,
      request,
      ctx,
    );
  }
  quoteCart(request: QuoteCartRequest, ctx: RequestContext) {
    return this.call<QuoteCartRequest, QuoteCartResponse>(this.pricing, this.pricing.quoteCart, request, ctx);
  }
  validatePromo(request: ValidatePromoRequest, ctx: RequestContext) {
    return this.call<ValidatePromoRequest, ValidatePromoResponse>(
      this.promotion,
      this.promotion.validatePromo,
      request,
      ctx,
    );
  }
  evaluateRestaurantOffer(request: EvaluateRestaurantOfferRequest, ctx: RequestContext) {
    return this.call<EvaluateRestaurantOfferRequest, EvaluateRestaurantOfferResponse>(
      this.promotion,
      this.promotion.evaluateRestaurantOffer,
      request,
      ctx,
    );
  }
  getPlusMembership(request: GetPlusMembershipRequest, ctx: RequestContext) {
    return this.call<GetPlusMembershipRequest, GetPlusMembershipResponse>(
      this.plus,
      this.plus.getPlusMembership,
      request,
      ctx,
    );
  }
  getCreditAccount(request: GetCreditAccountRequest, ctx: RequestContext) {
    return this.call<GetCreditAccountRequest, GetCreditAccountResponse>(
      this.credit,
      this.credit.getCreditAccount,
      request,
      ctx,
    );
  }

  onApplicationShutdown(): void {
    for (const c of [this.catalog, this.pricing, this.promotion, this.credit, this.plus]) c.close();
  }
}

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  CATALOG: "We couldn't check the menu right now. Try again in a moment.",
  PRICING: "We couldn't work out the price right now. Try again in a moment.",
  PROMOTION: "We couldn't check offers right now. Try again in a moment.",
  PROFILE: "We couldn't load your account right now. Try again in a moment.",
};

/**
 * A dependency call failed (down, too slow, or an unexpected error): UNAVAILABLE with reason
 * `<DEP>_UNAVAILABLE`, so the gateway shows "try again" rather than a generic error.
 * DomainErrors pass through untouched.
 */
export function dependencyFailure(dependency: keyof typeof UNAVAILABLE_MESSAGES, err: unknown): DomainError {
  if (err instanceof DomainError) return err;
  const metadata: Record<string, string> = { dependency: dependency.toLowerCase() };
  if (isServiceError(err)) metadata.upstream_code = status[err.code] ?? String(err.code);
  return new DomainError(
    status.UNAVAILABLE,
    `${dependency}_UNAVAILABLE`,
    UNAVAILABLE_MESSAGES[dependency]!,
    metadata,
  );
}
