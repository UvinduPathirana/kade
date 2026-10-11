// In-process stand-ins for dependencies that are not running yet (<NAME>_MODE=stub). They follow the
// contracts closely enough to drive the saga end to end, and are deterministic so tests can use them:
//   catalog   every dish Rs 1,000; an item id containing "soldout" is sold out
//   pricing   the totals.ts formula with a flat Rs 150 delivery fee (Rs 60 small-order fee under Rs 500)
//   promotion KADE100 (Rs 100 off from Rs 1,000) and FIRSTKOTTU (15% up to Rs 500, restaurant 1)
//   payment   cards ending 0002 are declined, other cards AUTHORISED, cash CASH_DUE
//   profile   every customer exists, not blocked, no Plus; credit kept in memory (starts at 0)
import { status } from "@grpc/grpc-js";
import {
  LineProblem,
  RestaurantKind,
  type Restaurant,
  type ValidatedLine,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import { FulfilmentMode, PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import {
  PaymentPurpose,
  PaymentStatus,
  RefundStatus,
  type Payment,
} from "@kade/proto/kade/payment/v1/payment_service";
import { DeliveryFeeWaiver, type QuoteCartRequest } from "@kade/proto/kade/pricing/v1/pricing_service";
import { CreditReason } from "@kade/proto/kade/profile/v1/profile_service";
import {
  FundedBy,
  PromoRejection,
  ReservationStatus,
  type Basket,
  type PromoResult,
} from "@kade/proto/kade/promotion/v1/promotion_service";
import { lkr, minor } from "../orders/money.js";
import { DependencyError } from "./grpc-call.js";
import type { CatalogPort, PaymentPort, PricingPort, ProfilePort, PromotionPort } from "./ports.js";

export const STUB_UNIT_PRICE = 100_000;
export const STUB_DELIVERY_FEE = 15_000;
export const STUB_DECLINING_LAST4 = "0002";
const COLOMBO = { lat: 6.9147, lng: 79.8528 };

export function stubRestaurant(id: string): Restaurant {
  return {
    id,
    name: `Restaurant ${id.slice(-4)}`,
    kind: RestaurantKind.RESTAURANT_KIND_UNSPECIFIED,
    categoryId: "",
    cuisine: "Sri Lankan",
    imageId: "",
    etaMinMinutes: 20,
    etaMaxMinutes: 30,
    deliveryFee: lkr(STUB_DELIVERY_FEE),
    rating: 4.6,
    ratingCount: 120,
    priceLevel: 2,
    offerLabel: "",
    discountPercent: 0,
    freeDeliveryOffer: false,
    hasVegetarian: true,
    area: "Kollupitiya",
    address: "1 Galle Road, Colombo 03",
    phone: "+94112000000",
    location: COLOMBO,
    zoneId: "c03",
    distanceKm: 2.4,
    hoursLabel: "10 am – 11 pm",
    offerId: "",
  };
}

export function stubCatalog(): CatalogPort {
  return {
    async validateCart(request) {
      const lines: ValidatedLine[] = request.lines.map((l) => {
        const soldOut = l.itemId.includes("soldout");
        return {
          lineKey: l.lineKey,
          itemId: l.itemId,
          name: `Dish ${l.itemId.slice(-4)}`,
          unitPrice: lkr(STUB_UNIT_PRICE),
          quantity: l.quantity,
          choiceNames: [],
          sectionId: "main",
          problem: soldOut ? LineProblem.LINE_PROBLEM_SOLD_OUT : LineProblem.LINE_PROBLEM_UNSPECIFIED,
          problemMessage: soldOut ? `Dish ${l.itemId.slice(-4)} is sold out.` : "",
        };
      });
      return {
        ok: lines.every((l) => l.problem === LineProblem.LINE_PROBLEM_UNSPECIFIED),
        restaurant: stubRestaurant(request.restaurantId),
        lines,
        restaurantProblem: 0,
        restaurantProblemMessage: "",
        menuVersion: 1,
      };
    },
    getRestaurant: async (id) => stubRestaurant(id),
  };
}

/** Mirrors pricing's QuoteCart (apps/customer/src/features/cart/totals.ts) with a flat fee. */
export function stubQuote(request: QuoteCartRequest) {
  const count = request.lines.reduce((s, l) => s + l.quantity, 0);
  const subtotal = request.lines.reduce((s, l) => s + minor(l.unitPrice) * l.quantity, 0);
  const offerSaving = minor(request.offerSaving);
  const saving = offerSaving
    ? Math.min(offerSaving, subtotal)
    : roundRupees((subtotal * request.restaurantDiscountPercent) / 100);
  const delivery = request.mode === FulfilmentMode.FULFILMENT_MODE_DELIVERY;
  const plusWaives = request.plusActive && subtotal >= 150_000;
  const deliveryFee =
    delivery && count > 0 && !plusWaives && !request.freeDeliveryOffer ? STUB_DELIVERY_FEE : 0;
  const smallOrder = count > 0 && subtotal < 50_000 ? 6_000 : 0;
  const promo = Math.min(minor(request.promoDiscount), subtotal - saving);
  const tip = delivery ? Math.max(0, minor(request.tip)) : 0;
  const beforeCredit = subtotal - saving - promo + deliveryFee + smallOrder + tip;
  const credit = Math.min(Math.max(0, minor(request.creditAvailable)), beforeCredit);
  return {
    totals: {
      itemCount: count,
      subtotal: lkr(subtotal),
      saving: lkr(saving),
      deliveryFee: lkr(deliveryFee),
      smallOrderFee: lkr(smallOrder),
      promoDiscount: lkr(promo),
      tip: lkr(tip),
      credit: lkr(credit),
      total: lkr(beforeCredit - credit),
    },
    waiver: !delivery
      ? DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_PICKUP
      : plusWaives
        ? DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_PLUS
        : request.freeDeliveryOffer
          ? DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_OFFER
          : DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_NONE,
    outOfZone: false,
    rulesVersion: 0,
    quoteId: "stub",
  };
}

const roundRupees = (minorUnits: number) =>
  Math.sign(minorUnits) * Math.round(Math.abs(minorUnits) / 100) * 100;

export function stubPricing(): PricingPort {
  return {
    async resolveZone(location) {
      // (0, 0) stands for "somewhere we don't deliver".
      const inZone = !(location.lat === 0 && location.lng === 0);
      return {
        inZone,
        zone: inZone
          ? {
              id: "c03",
              code: "Colombo 03",
              name: "Kollupitiya",
              open: true,
              baseFee: lkr(STUB_DELIVERY_FEE),
              perKm: lkr(3_000),
              smallOrderFee: lkr(6_000),
              smallOrderUnder: lkr(50_000),
              ridersNeeded: 0,
              boundary: [],
            }
          : undefined,
      };
    },
    quoteCart: async (request) => stubQuote(request),
  };
}

const STUB_PROMOS: Record<
  string,
  { label: string; min: number; restaurantSuffix?: string; discount: (food: number) => number }
> = {
  KADE100: { label: "Rs 100 off", min: 100_000, discount: () => 10_000 },
  FIRSTKOTTU: {
    label: "15% off, up to Rs 500",
    min: 0,
    restaurantSuffix: "000000000001",
    discount: (food) => Math.min(50_000, roundRupees(food * 0.15)),
  },
};

function stubValidate(rawCode: string, basket: Basket | undefined): PromoResult {
  const code = rawCode.trim().toUpperCase();
  const base = {
    code,
    label: "",
    discount: lkr(0),
    freeDelivery: false,
    fundedBy: FundedBy.FUNDED_BY_KADE,
    shortfall: lkr(0),
  };
  const reject = (rejection: PromoRejection, message: string): PromoResult => ({
    ...base,
    ok: false,
    rejection,
    message,
  });
  if (!code) return reject(PromoRejection.PROMO_REJECTION_EMPTY, "Enter a promo code.");
  const rule = STUB_PROMOS[code];
  if (!rule) return reject(PromoRejection.PROMO_REJECTION_NOT_FOUND, `${code} isn't a Kadé code.`);
  const restaurantId = basket?.restaurantId ?? "";
  if (rule.restaurantSuffix && !restaurantId.endsWith(rule.restaurantSuffix)) {
    return reject(PromoRejection.PROMO_REJECTION_WRONG_RESTAURANT, `${code} only works at one restaurant.`);
  }
  const subtotal = minor(basket?.subtotal);
  if (subtotal < rule.min) {
    return {
      ...reject(PromoRejection.PROMO_REJECTION_MIN_SUBTOTAL, `${code} needs a bigger order.`),
      shortfall: lkr(rule.min - subtotal),
    };
  }
  const food = subtotal - minor(basket?.saving);
  return {
    ...base,
    ok: true,
    label: rule.label,
    discount: lkr(rule.discount(food)),
    rejection: PromoRejection.PROMO_REJECTION_UNSPECIFIED,
    message: "",
  };
}

export function stubPromotion(): PromotionPort {
  return {
    evaluateRestaurantOffer: async () => ({ discountPercent: 0, freeDelivery: false }),
    validatePromo: async (request) => ({ result: stubValidate(request.code, request.basket) }),
    async reservePromo(request) {
      const result = stubValidate(request.code, request.basket);
      return {
        result,
        reservation: result.ok
          ? {
              id: `stub-res-${request.orderId}`,
              code: result.code,
              customerId: request.customerId,
              orderId: request.orderId,
              discount: result.discount,
              fundedBy: result.fundedBy,
              status: ReservationStatus.RESERVATION_STATUS_HELD,
            }
          : undefined,
      };
    },
    releasePromo: async () => undefined,
  };
}

export function stubPayment(): PaymentPort {
  const payments = new Map<string, Payment>();
  const get = (id: string): Payment => {
    const p = payments.get(id);
    if (!p) throw new DependencyError("payment", status.NOT_FOUND, "PAYMENT_NOT_FOUND", "no such payment");
    return p;
  };
  return {
    async authorise(request) {
      const id = `stub-pay-${request.referenceId}`;
      const existing = payments.get(id);
      if (existing) return existing;
      const cash = request.method?.kind === PaymentMethodKind.PAYMENT_METHOD_KIND_CASH;
      const declined = !cash && request.method?.cardLast4 === STUB_DECLINING_LAST4;
      const payment: Payment = {
        id,
        purpose: PaymentPurpose.PAYMENT_PURPOSE_ORDER,
        referenceId: request.referenceId,
        referenceLabel: request.referenceLabel,
        customerId: request.customerId,
        method: request.method,
        status: cash
          ? PaymentStatus.PAYMENT_STATUS_CASH_DUE
          : declined
            ? PaymentStatus.PAYMENT_STATUS_DECLINED
            : PaymentStatus.PAYMENT_STATUS_AUTHORISED,
        amountAuthorised: declined ? lkr(0) : request.amount,
        amountCaptured: lkr(0),
        amountRefunded: lkr(0),
        pspReference: "stub",
        declineCode: declined ? "do_not_honor" : "",
        declineMessage: declined
          ? `Your bank declined the card ending ${STUB_DECLINING_LAST4}, so nothing was charged. Pay with another card or with cash instead.`
          : "",
        collectedByRiderId: "",
        refunds: [],
      };
      payments.set(id, payment);
      return payment;
    },
    async adjust(request) {
      const p = get(request.paymentId);
      p.amountAuthorised = request.newAmount;
      return p;
    },
    async capture(request) {
      const p = get(request.paymentId);
      p.status = PaymentStatus.PAYMENT_STATUS_CAPTURED;
      p.amountCaptured = request.amount ?? p.amountAuthorised;
      return p;
    },
    async recordCash(request) {
      const p = get(request.paymentId);
      p.status = PaymentStatus.PAYMENT_STATUS_CAPTURED;
      p.amountCaptured = request.amount;
      p.collectedByRiderId = request.riderId;
      return p;
    },
    async void(request) {
      const p = payments.get(request.paymentId);
      if (!p) return { id: request.paymentId, status: PaymentStatus.PAYMENT_STATUS_VOIDED } as Payment;
      p.status = PaymentStatus.PAYMENT_STATUS_VOIDED;
      return p;
    },
    async refund(request) {
      const p = payments.get(request.paymentId);
      const refund = {
        id: `stub-refund-${request.orderRefundId || request.idempotencyKey}`,
        paymentId: request.paymentId,
        amount: request.amount,
        reason: request.reason,
        status: RefundStatus.REFUND_STATUS_SUCCEEDED,
        pspReference: "stub",
      };
      if (p) {
        p.amountRefunded = lkr(minor(p.amountRefunded) + minor(request.amount));
        p.status = PaymentStatus.PAYMENT_STATUS_PARTIALLY_REFUNDED;
      }
      return { payment: p, refund };
    },
  };
}

export function stubProfile(): ProfilePort {
  const balances = new Map<string, number>();
  const seen = new Set<string>();
  return {
    getCustomer: async (customerId) => ({
      id: customerId,
      name: "Kadé customer",
      phone: "+94770000000",
      email: "",
      area: "Kollupitiya",
      blocked: false,
      blockReason: "",
      plusActive: false,
    }),
    getCreditBalance: async (customerId) => balances.get(customerId) ?? 0,
    async changeCredit(request) {
      const current = balances.get(request.customerId) ?? 0;
      const amount = minor(request.amount);
      if (seen.has(request.idempotencyKey)) {
        return { entry: undefined, balance: lkr(current) };
      }
      if (current + amount < 0) {
        throw new DependencyError(
          "profile",
          status.FAILED_PRECONDITION,
          "CREDIT_INSUFFICIENT",
          "not enough credit",
        );
      }
      if (request.idempotencyKey) seen.add(request.idempotencyKey);
      balances.set(request.customerId, current + amount);
      return {
        entry: {
          id: `stub-credit-${request.idempotencyKey}`,
          amount: request.amount,
          label: request.label,
          reason: request.reason ?? CreditReason.CREDIT_REASON_UNSPECIFIED,
          orderId: request.orderId,
          ticketId: request.ticketId,
          by: request.by,
          balanceAfter: lkr(current + amount),
        },
        balance: lkr(current + amount),
      };
    },
  };
}
