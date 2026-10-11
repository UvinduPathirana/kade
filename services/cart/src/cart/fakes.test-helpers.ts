import { Metadata, status } from "@grpc/grpc-js";
import type { Cart } from "@kade/proto/kade/cart/v1/cart_service";
import {
  LineProblem,
  Restaurant,
  RestaurantProblem,
  type ValidateCartRequest,
  type ValidateCartResponse,
  type ValidatedLine,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import {
  DeliveryFeeWaiver,
  type QuoteCartRequest,
  type QuoteCartResponse,
} from "@kade/proto/kade/pricing/v1/pricing_service";
import {
  PromoRejection,
  type EvaluateRestaurantOfferResponse,
  type ValidatePromoRequest,
  type ValidatePromoResponse,
} from "@kade/proto/kade/promotion/v1/promotion_service";
import { emptyCart } from "./cart.js";
import type { CatalogPort, PricingPort, ProfilePort, PromotionPort } from "./dependencies.js";

export const KOMPANNA = "00000000-0000-7000-8000-000000000003";
export const KOTTU_HOUSE = "00000000-0000-7000-8000-000000000001";
const lkr = (amountMinor: number) => ({ amountMinor, currency: "LKR" });

export const unavailable = () =>
  Object.assign(new Error("14 UNAVAILABLE: connect ECONNREFUSED"), {
    code: status.UNAVAILABLE,
    details: "",
    metadata: new Metadata(),
  });

/** In-memory CartStore with the same contract (mutate may throw; timestamps set on write). */
export class MemoryCartStore {
  carts = new Map<string, Cart>();
  async get(customerId: string) {
    return { cart: this.carts.get(customerId) ?? emptyCart(customerId), version: 0 };
  }
  async update(customerId: string, mutate: (cart: Cart) => Cart): Promise<Cart> {
    const next = { ...mutate((await this.get(customerId)).cart), customerId, updatedAt: new Date() };
    this.carts.set(customerId, next);
    return next;
  }
}

interface Dish {
  name: string;
  price: number;
  sectionId: string;
  soldOut?: boolean;
  /** choice id → [name, extra price] */
  choices?: Record<string, [string, number]>;
}

/** A tiny catalog: two seeded restaurants with a few dishes. */
export class FakeCatalog implements CatalogPort {
  down = false;
  restaurantProblem = RestaurantProblem.RESTAURANT_PROBLEM_UNSPECIFIED;
  discountPercent = 0;
  calls: ValidateCartRequest[] = [];
  menus: Record<string, { name: string; dishes: Record<string, Dish> }> = {
    [KOMPANNA]: {
      name: "Kompanna Short Eats",
      dishes: {
        "fish-bun": { name: "Fish bun", price: 140_00, sectionId: "short-eats" },
        roti: { name: "Vegetable roti", price: 120_00, sectionId: "short-eats" },
        patty: { name: "Chicken patty", price: 160_00, sectionId: "short-eats", soldOut: false },
      },
    },
    [KOTTU_HOUSE]: {
      name: "Galle Road Kottu House",
      dishes: {
        kottu: {
          name: "Chicken kottu",
          price: 1_150_00,
          sectionId: "kottu",
          choices: { hot: ["Sri Lankan hot", 0], cheese: ["Extra cheese", 150_00] },
        },
      },
    },
  };

  async validateCart(request: ValidateCartRequest): Promise<ValidateCartResponse> {
    this.calls.push(request);
    if (this.down) throw unavailable();
    const menu = this.menus[request.restaurantId];
    if (!menu) {
      return {
        ok: false,
        restaurant: undefined,
        lines: [],
        restaurantProblem: RestaurantProblem.RESTAURANT_PROBLEM_NOT_FOUND,
        restaurantProblemMessage: "",
        menuVersion: 0,
      };
    }
    const lines = request.lines.map((ref): ValidatedLine => {
      const dish = menu.dishes[ref.itemId];
      const base = { lineKey: ref.lineKey, itemId: ref.itemId, quantity: ref.quantity, problemMessage: "" };
      if (!dish)
        return {
          ...base,
          name: "",
          unitPrice: undefined,
          choiceNames: [],
          sectionId: "",
          problem: LineProblem.LINE_PROBLEM_ITEM_NOT_FOUND,
        };
      const chosen = ref.options.map((o) => dish.choices?.[o.choiceId]);
      const problem = dish.soldOut
        ? LineProblem.LINE_PROBLEM_SOLD_OUT
        : chosen.some((c) => !c)
          ? LineProblem.LINE_PROBLEM_OPTION_INVALID
          : LineProblem.LINE_PROBLEM_UNSPECIFIED;
      return {
        ...base,
        name: dish.name,
        unitPrice: lkr(dish.price + chosen.reduce((s, c) => s + (c?.[1] ?? 0), 0)),
        choiceNames: chosen.filter(Boolean).map((c) => c![0]),
        sectionId: dish.sectionId,
        problem,
        problemMessage:
          problem === LineProblem.LINE_PROBLEM_SOLD_OUT ? `${dish.name} is sold out today.` : "",
      };
    });
    return {
      ok: lines.every((l) => !l.problem) && !this.restaurantProblem,
      restaurant: Restaurant.fromPartial({
        id: request.restaurantId,
        name: menu.name,
        location: { lat: 6.91, lng: 79.851 },
        discountPercent: this.discountPercent,
        freeDeliveryOffer: false,
      }),
      lines,
      restaurantProblem: this.restaurantProblem,
      restaurantProblemMessage: this.restaurantProblem ? "Opens at 8 am" : "",
      menuVersion: 1,
    };
  }
}

/** totals.ts with a flat Rs 120 delivery fee; good enough to check what cart sends and returns. */
export class FakePricing implements PricingPort {
  down = false;
  calls: QuoteCartRequest[] = [];
  async quoteCart(r: QuoteCartRequest): Promise<QuoteCartResponse> {
    this.calls.push(r);
    if (this.down) throw unavailable();
    const delivery = r.mode === FulfilmentMode.FULFILMENT_MODE_DELIVERY;
    const count = r.lines.reduce((s, l) => s + l.quantity, 0);
    const subtotal = r.lines.reduce((s, l) => s + (l.unitPrice?.amountMinor ?? 0) * l.quantity, 0);
    const saving = r.offerSaving
      ? r.offerSaving.amountMinor
      : Math.round((subtotal * r.restaurantDiscountPercent) / 10_000) * 100;
    const plusWaives = r.plusActive && subtotal >= 1_500_00;
    const deliveryFee = delivery && count > 0 && !plusWaives && !r.freeDeliveryOffer ? 120_00 : 0;
    const small = count > 0 && subtotal < 500_00 ? 60_00 : 0;
    const promo = Math.min(r.promoDiscount?.amountMinor ?? 0, subtotal - saving);
    const tip = delivery ? Math.max(0, r.tip?.amountMinor ?? 0) : 0;
    const before = subtotal - saving - promo + deliveryFee + small + tip;
    const credit = Math.min(r.creditAvailable?.amountMinor ?? 0, before);
    return {
      totals: {
        itemCount: count,
        subtotal: lkr(subtotal),
        saving: lkr(saving),
        deliveryFee: lkr(deliveryFee),
        smallOrderFee: lkr(small),
        promoDiscount: lkr(promo),
        tip: lkr(tip),
        credit: lkr(credit),
        total: lkr(before - credit),
      },
      deliveryFeeBreakdown: undefined,
      waiver: !delivery
        ? DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_PICKUP
        : plusWaives
          ? DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_PLUS
          : DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_NONE,
      outOfZone: false,
      rulesVersion: 1,
      quoteId: "q_test",
    };
  }
}

export class FakePromotion implements PromotionPort {
  down = false;
  offer: EvaluateRestaurantOfferResponse = {
    offer: undefined,
    discountPercent: 0,
    saving: undefined,
    freeDelivery: false,
  };
  promoCalls: ValidatePromoRequest[] = [];
  async validatePromo(r: ValidatePromoRequest): Promise<ValidatePromoResponse> {
    this.promoCalls.push(r);
    if (this.down) throw unavailable();
    const subtotal = r.basket?.subtotal?.amountMinor ?? 0;
    if (r.code === "KADE100") {
      return subtotal >= 1_000_00
        ? {
            result: {
              ok: true,
              code: "KADE100",
              label: "Rs 100 off",
              discount: lkr(100_00),
              freeDelivery: false,
              fundedBy: 0,
              rejection: 0,
              message: "",
              shortfall: undefined,
            },
          }
        : {
            result: {
              ok: false,
              code: "KADE100",
              label: "",
              discount: undefined,
              freeDelivery: false,
              fundedBy: 0,
              rejection: PromoRejection.PROMO_REJECTION_MIN_SUBTOTAL,
              message: `KADE100 needs an order of Rs 1,000 or more. Add Rs ${(1_000_00 - subtotal) / 100} to use it.`,
              shortfall: lkr(1_000_00 - subtotal),
            },
          };
    }
    return {
      result: {
        ok: false,
        code: r.code,
        label: "",
        discount: undefined,
        freeDelivery: false,
        fundedBy: 0,
        rejection: PromoRejection.PROMO_REJECTION_NOT_FOUND,
        message: `${r.code} isn't a Kadé code.`,
        shortfall: undefined,
      },
    };
  }
  async evaluateRestaurantOffer(): Promise<EvaluateRestaurantOfferResponse> {
    if (this.down) throw unavailable();
    return this.offer;
  }
}

export class FakeProfile implements ProfilePort {
  down = false;
  plus = false;
  credit = 0;
  async getPlusMembership() {
    if (this.down) throw unavailable();
    return { membership: { active: this.plus } as never };
  }
  async getCreditAccount(r: { customerId: string }) {
    if (this.down) throw unavailable();
    return { account: { customerId: r.customerId, balance: lkr(this.credit), history: [] }, page: undefined };
  }
}
