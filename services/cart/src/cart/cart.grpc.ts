import { status } from "@grpc/grpc-js";
import { Inject, Injectable } from "@nestjs/common";
import {
  CartServiceService,
  type AddCartLineRequest,
  type AddCartLineResponse,
  type Cart,
  type CartLine,
  type CheckoutOptions,
  type ClearCartRequest,
  type ClearCartResponse,
  type GetCartQuoteRequest,
  type GetCartQuoteResponse,
  type GetCartRequest,
  type GetCartResponse,
  type PromoCheck,
  type RemoveCartLineRequest,
  type RemoveCartLineResponse,
  type UpdateCartLineRequest,
  type UpdateCartLineResponse,
  type UpdateCheckoutOptionsRequest,
  type UpdateCheckoutOptionsResponse,
} from "@kade/proto/kade/cart/v1/cart_service";
import {
  LineProblem,
  RestaurantProblem,
  type CartItemRef,
  type ValidateCartResponse,
  type ValidatedLine,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import { FulfilmentMode, PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import type { Money } from "@kade/proto/kade/common/v1/money";
import {
  DeliveryFeeWaiver,
  type QuoteCartRequest,
  type QuoteCartResponse,
} from "@kade/proto/kade/pricing/v1/pricing_service";
import {
  promoRejectionToJSON,
  type Basket,
  type EvaluateRestaurantOfferResponse,
} from "@kade/proto/kade/promotion/v1/promotion_service";
import { LOGGER, type Logger } from "../platform/logger.js";
import type { RequestContext } from "../platform/grpc/context.js";
import {
  failedPrecondition,
  invalidArgument,
  notFound,
  permissionDenied,
  unauthenticated,
} from "../platform/grpc/errors.js";
import type { DomainError } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import {
  addLine,
  checkQuantity,
  clearLines,
  defaultOptions,
  lineKey,
  normaliseNote,
  normaliseOptions,
  otherRestaurant,
  otherRestaurantError,
  removeLine,
  updateLine,
} from "./cart.js";
import { CartStore } from "./cart.store.js";
import {
  CATALOG,
  dependencyFailure,
  PRICING,
  PROFILE,
  PROMOTION,
  type CatalogPort,
  type PricingPort,
  type ProfilePort,
  type PromotionPort,
} from "./dependencies.js";

/** Staff who may read or change another customer's cart (support fixing an order). */
const STAFF_ROLES = ["ops", "support", "admin"];
const MAX_TIP = 5_000_00;
const MAX_ORDER_NOTE = 500;
const MAX_PROMO_CODE = 32;
const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60_000;
const DELIVERY = FulfilmentMode.FULFILMENT_MODE_DELIVERY;
const PICKUP = FulfilmentMode.FULFILMENT_MODE_PICKUP;

const lkr = (amountMinor: number): Money => ({ amountMinor, currency: "LKR" });

/** The apps' numeric restaurant ids map to seeded UUIDs (CONVENTIONS "Seeded restaurant ids"). */
export function canonicalRestaurantId(id: string): string {
  const trimmed = id.trim();
  return /^\d{1,12}$/.test(trimmed) ? `00000000-0000-7000-8000-${trimmed.padStart(12, "0")}` : trimmed;
}

const LINE_ERRORS: Partial<Record<LineProblem, (message: string) => DomainError>> = {
  [LineProblem.LINE_PROBLEM_ITEM_NOT_FOUND]: (m) =>
    notFound("ITEM_NOT_FOUND", m || "That dish isn't on the menu any more."),
  [LineProblem.LINE_PROBLEM_SOLD_OUT]: (m) =>
    failedPrecondition("ITEM_SOLD_OUT", m || "That dish is sold out today."),
  [LineProblem.LINE_PROBLEM_OPTION_INVALID]: (m) =>
    invalidArgument("OPTION_INVALID", m || "One of the choices isn't available."),
  [LineProblem.LINE_PROBLEM_REQUIRED_OPTION_MISSING]: (m) =>
    invalidArgument("REQUIRED_OPTION_MISSING", m || "Pick the required options first."),
  [LineProblem.LINE_PROBLEM_TOO_MANY_CHOICES]: (m) =>
    invalidArgument("TOO_MANY_CHOICES", m || "Too many choices for one option."),
  [LineProblem.LINE_PROBLEM_QUANTITY_INVALID]: (m) =>
    invalidArgument("QUANTITY_INVALID", m || "That quantity isn't allowed."),
};

/** kade.cart.v1.CartService: carts in Redis, validated against catalog, priced by pricing. */
@GrpcService(CartServiceService)
@Injectable()
export class CartGrpcService implements GrpcHandlers<CartServiceService> {
  constructor(
    @Inject(CartStore) private readonly store: CartStore,
    @Inject(CATALOG) private readonly catalog: CatalogPort,
    @Inject(PRICING) private readonly pricing: PricingPort,
    @Inject(PROMOTION) private readonly promotion: PromotionPort,
    @Inject(PROFILE) private readonly profile: ProfilePort,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async getCart(request: GetCartRequest, ctx: RequestContext): Promise<GetCartResponse> {
    const customerId = resolveCustomer(request.customerId, ctx);
    return { cart: (await this.store.get(customerId)).cart };
  }

  async addCartLine(request: AddCartLineRequest, ctx: RequestContext): Promise<AddCartLineResponse> {
    const customerId = resolveCustomer(request.customerId, ctx);
    const restaurantId = canonicalRestaurantId(request.restaurantId);
    if (!restaurantId) throw invalidArgument("RESTAURANT_REQUIRED", "Which restaurant is this dish from?");
    if (!request.itemId) throw invalidArgument("ITEM_REQUIRED", "Which dish should we add?");
    const quantity = request.quantity === 0 ? 1 : request.quantity;
    checkQuantity(quantity, { allowZero: false });
    const note = normaliseNote(request.note);
    const options = normaliseOptions(request.options);
    const key = lineKey(request.itemId, options, note);

    // Fail fast before asking catalog; addLine re-checks against the cart it actually writes.
    const { cart } = await this.store.get(customerId);
    if (otherRestaurant(cart, restaurantId) && !request.replaceCart) throw otherRestaurantError(cart);

    const validation = await this.validate(ctx, {
      restaurantId,
      mode: cart.options?.mode || DELIVERY,
      lines: [{ lineKey: key, itemId: request.itemId, quantity, options }],
      deliverTo: cart.options?.address?.location,
    });
    rejectRestaurant(validation);
    const validated = validation.lines.find((l) => l.lineKey === key);
    if (!validated) throw notFound("ITEM_NOT_FOUND", "That dish isn't on the menu any more.");
    if (validated.problem)
      throw (LINE_ERRORS[validated.problem] ?? LINE_ERRORS[LineProblem.LINE_PROBLEM_OPTION_INVALID]!)(
        validated.problemMessage,
      );

    const line: CartLine = {
      key,
      itemId: request.itemId,
      name: validated.name,
      unitPrice: validated.unitPrice,
      quantity,
      options,
      choiceNames: validated.choiceNames,
      note,
      imageId: "",
    };
    const updated = await this.store.update(customerId, (c) =>
      addLine(c, {
        restaurantId: validation.restaurant?.id || restaurantId,
        restaurantName: validation.restaurant?.name ?? "",
        line,
        replace: request.replaceCart,
      }),
    );
    return { cart: updated };
  }

  async updateCartLine(request: UpdateCartLineRequest, ctx: RequestContext): Promise<UpdateCartLineResponse> {
    const customerId = resolveCustomer(request.customerId, ctx);
    checkQuantity(request.quantity, { allowZero: true });
    const note = request.note === undefined ? undefined : normaliseNote(request.note);
    const cart = await this.store.update(customerId, (c) =>
      updateLine(c, request.lineKey, request.quantity, note),
    );
    return { cart };
  }

  async removeCartLine(request: RemoveCartLineRequest, ctx: RequestContext): Promise<RemoveCartLineResponse> {
    const customerId = resolveCustomer(request.customerId, ctx);
    return { cart: await this.store.update(customerId, (c) => removeLine(c, request.lineKey)) };
  }

  async clearCart(request: ClearCartRequest, ctx: RequestContext): Promise<ClearCartResponse> {
    const customerId = resolveCustomer(request.customerId, ctx);
    return { cart: await this.store.update(customerId, clearLines) };
  }

  async updateCheckoutOptions(
    request: UpdateCheckoutOptionsRequest,
    ctx: RequestContext,
  ): Promise<UpdateCheckoutOptionsResponse> {
    const customerId = resolveCustomer(request.customerId, ctx);
    const options = validateOptions(request.options ?? defaultOptions());
    return { cart: await this.store.update(customerId, (c) => ({ ...c, options })) };
  }

  async getCartQuote(request: GetCartQuoteRequest, ctx: RequestContext): Promise<GetCartQuoteResponse> {
    const customerId = resolveCustomer(request.customerId, ctx);
    const { cart } = await this.store.get(customerId);
    const options = cart.options ?? defaultOptions();
    const mode = options.mode || DELIVERY;

    // Profile is a nice-to-have for the preview (the order saga re-checks): degrade to "no Plus,
    // no credit" rather than failing the checkout page.
    const accountPromise = this.account(customerId, ctx);
    if (cart.lines.length === 0) {
      const account = await accountPromise;
      return emptyQuote(cart, mode, account.credit);
    }

    const validation = await this.validate(ctx, {
      restaurantId: cart.restaurantId,
      mode,
      lines: cart.lines.map((l): CartItemRef => ({
        lineKey: l.key,
        itemId: l.itemId,
        quantity: l.quantity,
        options: l.options,
      })),
      fulfilAt: options.scheduledFor,
      deliverTo: options.address?.location,
    });
    const okLines = validation.lines.filter((l) => !l.problem);
    const basket = toBasket(cart.restaurantId, okLines, mode);
    const [account, offer] = await Promise.all([
      accountPromise,
      this.restaurantOffer(customerId, basket, ctx),
    ]);
    const restaurant = validation.restaurant;

    const quoteRequest: QuoteCartRequest = {
      restaurantId: cart.restaurantId,
      restaurantLocation: restaurant?.location,
      mode,
      lines: okLines.map((l) => ({ lineKey: l.lineKey, unitPrice: l.unitPrice, quantity: l.quantity })),
      deliverTo: mode === DELIVERY ? options.address?.location : undefined,
      // Promotion's evaluation when it answered; otherwise the catalog snapshot of the running offer.
      restaurantDiscountPercent: offer ? offer.discountPercent : (restaurant?.discountPercent ?? 0),
      freeDeliveryOffer: offer ? offer.freeDelivery : (restaurant?.freeDeliveryOffer ?? false),
      offerSaving: offer && offer.saving && offer.saving.amountMinor > 0 ? offer.saving : undefined,
      promoDiscount: lkr(0),
      tip: options.tip ?? lkr(0),
      creditAvailable: lkr(options.useCredit ? account.credit : 0),
      plusActive: account.plus,
      at: options.scheduledFor ?? new Date(),
    };
    // Like the checkout page: price without the promo, check the code against that, then re-price.
    const base = await this.quote(quoteRequest, ctx);
    const promo = options.promoCode
      ? await this.checkPromo(options.promoCode, customerId, basket, base, mode, ctx)
      : undefined;
    const priced =
      promo?.ok && (promo.discount?.amountMinor ?? 0) > 0
        ? await this.quote({ ...quoteRequest, promoDiscount: promo.discount }, ctx)
        : base;

    return {
      cart: refreshSnapshot(cart, validation),
      totals: priced.totals,
      deliveryFeeBreakdown: priced.deliveryFeeBreakdown,
      waiver: priced.waiver,
      lines: validation.lines,
      restaurantProblem: validation.restaurantProblem,
      restaurantProblemMessage: validation.restaurantProblemMessage,
      promo,
      creditBalance: lkr(account.credit),
      outOfZone: priced.outOfZone,
    };
  }

  // ---------------------------------------------------------------------------------------------

  private async validate(
    ctx: RequestContext,
    req: {
      restaurantId: string;
      mode: FulfilmentMode;
      lines: CartItemRef[];
      fulfilAt?: Date;
      deliverTo?: { lat: number; lng: number };
    },
  ): Promise<ValidateCartResponse> {
    try {
      return await this.catalog.validateCart(
        {
          restaurantId: req.restaurantId,
          mode: req.mode,
          lines: req.lines,
          fulfilAt: req.fulfilAt,
          deliverTo: req.deliverTo,
        },
        ctx,
      );
    } catch (err) {
      if ((err as { code?: number }).code === status.NOT_FOUND) {
        throw notFound("RESTAURANT_NOT_FOUND", "That restaurant isn't on Kadé any more.");
      }
      this.logger.warn({ err, dependency: "catalog" }, "catalog ValidateCart failed");
      throw dependencyFailure("CATALOG", err);
    }
  }

  private async quote(request: QuoteCartRequest, ctx: RequestContext): Promise<QuoteCartResponse> {
    try {
      return await this.pricing.quoteCart(request, ctx);
    } catch (err) {
      this.logger.warn({ err, dependency: "pricing" }, "pricing QuoteCart failed");
      throw dependencyFailure("PRICING", err);
    }
  }

  private async account(customerId: string, ctx: RequestContext): Promise<{ plus: boolean; credit: number }> {
    const [plus, credit] = await Promise.allSettled([
      this.profile.getPlusMembership({ customerId }, ctx),
      this.profile.getCreditAccount({ customerId, page: undefined }, ctx),
    ]);
    if (plus.status === "rejected" || credit.status === "rejected") {
      this.logger.warn(
        { dependency: "profile", plus: errorText(plus), credit: errorText(credit) },
        "profile unavailable; quoting without Plus/credit",
      );
    }
    return {
      plus: plus.status === "fulfilled" && !!plus.value.membership?.active,
      credit:
        credit.status === "fulfilled" ? Math.max(0, credit.value.account?.balance?.amountMinor ?? 0) : 0,
    };
  }

  private async restaurantOffer(
    customerId: string,
    basket: Basket,
    ctx: RequestContext,
  ): Promise<EvaluateRestaurantOfferResponse | undefined> {
    try {
      const res = await this.promotion.evaluateRestaurantOffer({ customerId, basket }, ctx);
      return res.offer ? res : undefined;
    } catch (err) {
      this.logger.warn(
        { err, dependency: "promotion" },
        "EvaluateRestaurantOffer failed; using catalog offer",
      );
      return undefined;
    }
  }

  private async checkPromo(
    code: string,
    customerId: string,
    basket: Basket,
    base: QuoteCartResponse,
    mode: FulfilmentMode,
    ctx: RequestContext,
  ): Promise<PromoCheck> {
    try {
      const { result } = await this.promotion.validatePromo(
        {
          code,
          customerId,
          basket: { ...basket, saving: base.totals?.saving, deliveryFee: base.totals?.deliveryFee, mode },
        },
        ctx,
      );
      if (!result) throw new Error("ValidatePromo returned no result");
      return {
        code: result.code || code,
        ok: result.ok,
        label: result.label,
        discount: result.ok ? (result.discount ?? lkr(0)) : lkr(0),
        errorReason: result.ok ? "" : promoReason(result.rejection),
        errorMessage: result.ok ? "" : result.message,
      };
    } catch (err) {
      this.logger.warn({ err, dependency: "promotion" }, "ValidatePromo failed");
      return {
        code,
        ok: false,
        label: "",
        discount: lkr(0),
        errorReason: "PROMOTION_UNAVAILABLE",
        errorMessage: "We couldn't check this code right now. Try again in a moment.",
      };
    }
  }
}

// ---------------------------------------------------------------------------------------------

/** The cart's owner: the request's customer_id, else the caller. Customers only see their own. */
export function resolveCustomer(requested: string, ctx: RequestContext): string {
  const customerId = requested || ctx.userId;
  if (!customerId) throw unauthenticated("UNAUTHENTICATED", "Sign in to continue.");
  if (ctx.userId && requested && requested !== ctx.userId && !STAFF_ROLES.some((r) => ctx.hasRole(r))) {
    throw permissionDenied("CART_NOT_YOURS", "That isn't your cart.");
  }
  if (customerId.length > 128 || /[\s{}]/.test(customerId)) {
    throw invalidArgument("CUSTOMER_ID_INVALID", "That customer id isn't valid.");
  }
  return customerId;
}

function rejectRestaurant(validation: ValidateCartResponse): void {
  switch (validation.restaurantProblem) {
    case RestaurantProblem.RESTAURANT_PROBLEM_NOT_FOUND:
      throw notFound(
        "RESTAURANT_NOT_FOUND",
        validation.restaurantProblemMessage || "That restaurant isn't on Kadé any more.",
      );
    case RestaurantProblem.RESTAURANT_PROBLEM_SUSPENDED:
      throw failedPrecondition(
        "RESTAURANT_UNAVAILABLE",
        validation.restaurantProblemMessage || "This restaurant isn't taking orders right now.",
      );
    default:
      // Closed/paused restaurants still accept cart adds (customers can schedule); the quote reports them.
      return;
  }
}

export function validateOptions(input: CheckoutOptions): CheckoutOptions {
  const mode = input.mode || DELIVERY;
  if (mode !== DELIVERY && mode !== PICKUP)
    throw invalidArgument("MODE_INVALID", "Choose delivery or pickup.");
  const tip = input.tip ?? lkr(0);
  if (
    (tip.currency && tip.currency !== "LKR") ||
    !Number.isInteger(tip.amountMinor) ||
    tip.amountMinor < 0 ||
    tip.amountMinor > MAX_TIP
  ) {
    throw invalidArgument("TIP_INVALID", "Tips can be from Rs 0 to Rs 5,000.");
  }
  for (const note of [input.riderNote, input.kitchenNote]) {
    if (note.length > MAX_ORDER_NOTE)
      throw invalidArgument("NOTE_TOO_LONG", `Keep notes under ${MAX_ORDER_NOTE} characters.`);
  }
  const promoCode = input.promoCode.trim().toUpperCase();
  if (promoCode.length > MAX_PROMO_CODE)
    throw invalidArgument("PROMO_CODE_INVALID", "That code is too long.");
  if (input.scheduledFor) {
    const at = input.scheduledFor.getTime();
    const now = Date.now();
    if (at < now - CLOCK_SKEW_MS) throw invalidArgument("SCHEDULE_IN_PAST", "Pick a time in the future.");
    if (at > now + MAX_SCHEDULE_AHEAD_MS)
      throw invalidArgument("SCHEDULE_TOO_FAR", "You can schedule up to 7 days ahead.");
  }
  if (input.payment?.kind === PaymentMethodKind.PAYMENT_METHOD_KIND_CARD && !input.payment.cardId) {
    throw invalidArgument("PAYMENT_INVALID", "Choose a saved card.");
  }
  return {
    ...input,
    mode,
    riderNote: input.riderNote.trim(),
    kitchenNote: input.kitchenNote.trim(),
    promoCode,
    tip: { amountMinor: tip.amountMinor, currency: "LKR" },
  };
}

function toBasket(restaurantId: string, lines: ValidatedLine[], mode: FulfilmentMode): Basket {
  return {
    restaurantId,
    lines: lines.map((l) => ({
      itemId: l.itemId,
      sectionId: l.sectionId,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
    })),
    subtotal: lkr(lines.reduce((s, l) => s + (l.unitPrice?.amountMinor ?? 0) * l.quantity, 0)),
    saving: undefined,
    deliveryFee: undefined,
    mode,
  };
}

/** PROMO_REJECTION_MIN_SUBTOTAL → PROMO_MIN_SUBTOTAL (the reason gateways map). */
function promoReason(rejection: number): string {
  const name = promoRejectionToJSON(rejection);
  return name.startsWith("PROMO_REJECTION_")
    ? `PROMO_${name.slice("PROMO_REJECTION_".length)}`
    : "PROMO_INVALID";
}

/** The returned cart shows catalog's current names and prices (Redis keeps the add-time snapshot). */
function refreshSnapshot(cart: Cart, validation: ValidateCartResponse): Cart {
  const byKey = new Map(validation.lines.map((l) => [l.lineKey, l]));
  return {
    ...cart,
    restaurantName: validation.restaurant?.name || cart.restaurantName,
    lines: cart.lines.map((l) => {
      const v = byKey.get(l.key);
      return v && !v.problem && v.unitPrice
        ? {
            ...l,
            name: v.name || l.name,
            unitPrice: v.unitPrice,
            choiceNames: v.choiceNames.length ? v.choiceNames : l.choiceNames,
          }
        : l;
    }),
  };
}

function emptyQuote(cart: Cart, mode: FulfilmentMode, credit: number): GetCartQuoteResponse {
  const zero = lkr(0);
  return {
    cart,
    totals: {
      itemCount: 0,
      subtotal: zero,
      saving: zero,
      deliveryFee: zero,
      smallOrderFee: zero,
      promoDiscount: zero,
      tip: zero,
      credit: zero,
      total: zero,
    },
    deliveryFeeBreakdown: undefined,
    waiver:
      mode === PICKUP
        ? DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_PICKUP
        : DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_NONE,
    lines: [],
    restaurantProblem: RestaurantProblem.RESTAURANT_PROBLEM_UNSPECIFIED,
    restaurantProblemMessage: "",
    promo: undefined,
    creditBalance: lkr(credit),
    outOfZone: false,
  };
}

function errorText(result: PromiseSettledResult<unknown>): string | undefined {
  return result.status === "rejected"
    ? String((result.reason as Error)?.message ?? result.reason)
    : undefined;
}
