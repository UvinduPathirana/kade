// The slices of other services' APIs the order saga uses. Each has a gRPC adapter
// (grpc-adapters.ts) and an in-process stub (stubs.ts); <NAME>_MODE picks one at boot.
import type {
  Restaurant,
  ValidateCartRequest,
  ValidateCartResponse,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import type {
  AdjustAuthorisationRequest,
  AuthorisePaymentRequest,
  CapturePaymentRequest,
  Payment,
  RecordCashCollectionRequest,
  RefundPaymentRequest,
  RefundPaymentResponse,
  VoidPaymentRequest,
} from "@kade/proto/kade/payment/v1/payment_service";
import type {
  QuoteCartRequest,
  QuoteCartResponse,
  ResolveZoneResponse,
} from "@kade/proto/kade/pricing/v1/pricing_service";
import type {
  ChangeCreditRequest,
  ChangeCreditResponse,
  Customer,
} from "@kade/proto/kade/profile/v1/profile_service";
import type {
  EvaluateRestaurantOfferRequest,
  EvaluateRestaurantOfferResponse,
  ReleasePromoRequest,
  ReservePromoRequest,
  ReservePromoResponse,
  ValidatePromoRequest,
  ValidatePromoResponse,
} from "@kade/proto/kade/promotion/v1/promotion_service";
import type { GeoPoint } from "@kade/proto/kade/common/v1/types";

export interface CatalogPort {
  validateCart(request: ValidateCartRequest): Promise<ValidateCartResponse>;
  /** Undefined when catalog says NOT_FOUND. */
  getRestaurant(id: string): Promise<Restaurant | undefined>;
}

export interface ProfilePort {
  /** Undefined when profile has no such customer (not signed in through EnsureCustomer yet). */
  getCustomer(customerId: string): Promise<Customer | undefined>;
  /** Credit balance in minor units. */
  getCreditBalance(customerId: string): Promise<number>;
  changeCredit(request: ChangeCreditRequest): Promise<ChangeCreditResponse>;
}

export interface PricingPort {
  resolveZone(location: GeoPoint): Promise<ResolveZoneResponse>;
  quoteCart(request: QuoteCartRequest): Promise<QuoteCartResponse>;
}

export interface PromotionPort {
  evaluateRestaurantOffer(request: EvaluateRestaurantOfferRequest): Promise<EvaluateRestaurantOfferResponse>;
  validatePromo(request: ValidatePromoRequest): Promise<ValidatePromoResponse>;
  reservePromo(request: ReservePromoRequest): Promise<ReservePromoResponse>;
  releasePromo(request: ReleasePromoRequest): Promise<void>;
}

export interface PaymentPort {
  authorise(request: AuthorisePaymentRequest): Promise<Payment>;
  adjust(request: AdjustAuthorisationRequest): Promise<Payment>;
  capture(request: CapturePaymentRequest): Promise<Payment>;
  recordCash(request: RecordCashCollectionRequest): Promise<Payment>;
  void(request: VoidPaymentRequest): Promise<Payment>;
  refund(request: RefundPaymentRequest): Promise<RefundPaymentResponse>;
}

export const CATALOG = Symbol("CatalogPort");
export const PROFILE = Symbol("ProfilePort");
export const PRICING = Symbol("PricingPort");
export const PROMOTION = Symbol("PromotionPort");
export const PAYMENT = Symbol("PaymentPort");

export interface Dependencies {
  catalog: CatalogPort;
  profile: ProfilePort;
  pricing: PricingPort;
  promotion: PromotionPort;
  payment: PaymentPort;
}
