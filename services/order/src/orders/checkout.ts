// Saga step 1 (proto/README.md): validate and price. Reads only, so the activity can retry freely.
// Business failures are returned as values ({ ok: false, reason }), never thrown, so Temporal does
// not retry a sold-out dish; dependency outages throw and Temporal retries them.
import { Inject, Injectable } from "@nestjs/common";
import { LineProblem, RestaurantProblem } from "@kade/proto/kade/catalog/v1/catalog_service";
import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import type { Order, OrderLine } from "@kade/proto/kade/order/v1/order_service";
import type { QuoteCartRequest } from "@kade/proto/kade/pricing/v1/pricing_service";
import { promoRejectionToJSON, type BasketLine } from "@kade/proto/kade/promotion/v1/promotion_service";
import { CATALOG, PRICING, PROFILE, PROMOTION } from "../clients/ports.js";
import type { CatalogPort, PricingPort, ProfilePort, PromotionPort } from "../clients/ports.js";
import { Database } from "../platform/db/database.js";
import { lkr, minor } from "./money.js";
import { OrderRepository } from "./order.repository.js";
import { leadMinutes } from "./transitions.js";
import { OrderStore } from "./order.store.js";
import type { CheckoutPlan, StepFailure } from "../workflows/types.js";

/** A scheduled order is SCHEDULED only when the kitchen start is at least this far away. */
const SCHEDULE_MIN_AHEAD_MS = 60_000;

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(OrderStore) private readonly store: OrderStore,
    @Inject(CATALOG) private readonly catalog: CatalogPort,
    @Inject(PROFILE) private readonly profile: ProfilePort,
    @Inject(PRICING) private readonly pricing: PricingPort,
    @Inject(PROMOTION) private readonly promotion: PromotionPort,
  ) {}

  async prepare(orderId: string, now = new Date()): Promise<CheckoutPlan | StepFailure> {
    const record = await this.orders.findById(this.database.db, orderId);
    if (!record) return fail("ORDER_NOT_FOUND", "We couldn't find that order.");
    const req = record.request;
    const delivery = req.mode === FulfilmentMode.FULFILMENT_MODE_DELIVERY;
    const deliverTo = delivery ? req.address?.location : undefined;

    // Customer: blocked? Plus?
    const customer = await this.profile.getCustomer(req.customerId);
    if (customer?.blocked) {
      return fail("CUSTOMER_BLOCKED", "This account can't place orders right now. Chat with us for help.");
    }

    // Catalog: every line against the live menu, the restaurant against its hours at fulfil time.
    const lineKeys = req.lines.map((l, i) => l.key || `line-${i + 1}`);
    const validation = await this.catalog.validateCart({
      restaurantId: req.restaurantId,
      mode: req.mode,
      lines: req.lines.map((l, i) => ({
        lineKey: lineKeys[i]!,
        itemId: l.itemId,
        quantity: l.quantity,
        options: l.options,
      })),
      fulfilAt: req.scheduledFor,
      deliverTo,
    });
    const restaurant = validation.restaurant;
    if (!restaurant || validation.restaurantProblem !== RestaurantProblem.RESTAURANT_PROBLEM_UNSPECIFIED) {
      return fail(
        "RESTAURANT_CLOSED",
        validation.restaurantProblemMessage || "This restaurant isn't taking orders right now.",
      );
    }
    const problem = validation.lines.find((l) => l.problem !== LineProblem.LINE_PROBLEM_UNSPECIFIED);
    if (problem || !validation.ok) {
      const soldOut =
        !problem ||
        problem.problem === LineProblem.LINE_PROBLEM_SOLD_OUT ||
        problem.problem === LineProblem.LINE_PROBLEM_ITEM_NOT_FOUND;
      return fail(
        soldOut ? "ITEM_SOLD_OUT" : "ITEM_OPTIONS_INVALID",
        problem?.problemMessage || "Something in your cart is no longer available.",
        problem ? { lineKey: problem.lineKey } : {},
      );
    }

    // Zone (delivery).
    let zoneId = restaurant.zoneId;
    if (delivery) {
      const zone = await this.pricing.resolveZone(deliverTo ?? { lat: 0, lng: 0 });
      if (!zone.inZone || !zone.zone) return fail("OUT_OF_ZONE", "We don't deliver to this address yet.");
      zoneId = zone.zone.id;
    }

    // Restaurant's automatic offer.
    const basketLines: BasketLine[] = validation.lines.map((l) => ({
      itemId: l.itemId,
      sectionId: l.sectionId,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
    }));
    const subtotalGuess = validation.lines.reduce((s, l) => s + minor(l.unitPrice) * l.quantity, 0);
    const offer = await this.promotion.evaluateRestaurantOffer({
      customerId: req.customerId,
      basket: {
        restaurantId: req.restaurantId,
        lines: basketLines,
        subtotal: lkr(subtotalGuess),
        saving: lkr(0),
        deliveryFee: lkr(0),
        mode: req.mode,
      },
    });

    const quoteBase: QuoteCartRequest = {
      restaurantId: req.restaurantId,
      restaurantLocation: restaurant.location,
      mode: req.mode,
      lines: validation.lines.map((l) => ({
        lineKey: l.lineKey,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
      })),
      deliverTo,
      restaurantDiscountPercent: offer.offer ? offer.discountPercent : restaurant.discountPercent,
      freeDeliveryOffer: offer.freeDelivery || (!offer.offer && restaurant.freeDeliveryOffer),
      promoDiscount: lkr(0),
      tip: delivery ? lkr(Math.max(0, minor(req.tip))) : lkr(0),
      creditAvailable: lkr(0),
      plusActive: customer?.plusActive ?? false,
      at: req.scheduledFor,
      offerSaving: offer.offer && minor(offer.saving) > 0 ? offer.saving : undefined,
    };
    const first = await this.pricing.quoteCart(quoteBase);
    if (first.outOfZone) return fail("OUT_OF_ZONE", "We don't deliver to this address yet.");

    // Promo code (pre-check; ReservePromo re-validates and holds it).
    let promoDiscount = 0;
    let promo: Order["promo"];
    const code = req.promoCode.trim();
    if (code) {
      const { result } = await this.promotion.validatePromo({
        code,
        customerId: req.customerId,
        basket: {
          restaurantId: req.restaurantId,
          lines: basketLines,
          subtotal: first.totals?.subtotal,
          saving: first.totals?.saving,
          deliveryFee: first.totals?.deliveryFee,
          mode: req.mode,
        },
      });
      if (!result?.ok) {
        return fail(
          promoReason(result?.rejection ?? 0),
          result?.message || `${code} can't be used on this order.`,
        );
      }
      promoDiscount = minor(result.discount);
      promo = {
        code: result.code || code.toUpperCase(),
        label: result.label,
        reservationId: "",
        fundedBy: result.fundedBy,
        offerId: offer.offer?.id ?? "",
      };
    } else if (offer.offer) {
      promo = { code: "", label: offer.offer.label, reservationId: "", fundedBy: 0, offerId: offer.offer.id };
    }

    const credit = req.useCredit ? await this.profile.getCreditBalance(req.customerId) : 0;
    const quote = await this.pricing.quoteCart({
      ...quoteBase,
      promoDiscount: lkr(promoDiscount),
      creditAvailable: lkr(Math.max(0, credit)),
    });
    const totals = quote.totals;
    if (!totals) throw new Error("pricing returned no totals");
    if (req.expectedTotal && minor(req.expectedTotal) !== minor(totals.total)) {
      return fail(
        "PRICE_CHANGED",
        "Prices have changed since you opened checkout. Check the new total and try again.",
        {
          expected: String(minor(req.expectedTotal)),
          actual: String(minor(totals.total)),
        },
      );
    }

    const repeat = await this.orders.countPrevious(
      this.database.db,
      req.customerId,
      req.restaurantId,
      orderId,
    );
    const linesByKey = new Map(validation.lines.map((l) => [l.lineKey, l]));
    const lines: OrderLine[] = req.lines.map((input, i) => {
      const v = linesByKey.get(lineKeys[i]!);
      return {
        key: lineKeys[i]!,
        itemId: input.itemId,
        name: v?.name ?? "",
        unitPrice: v?.unitPrice ?? lkr(0),
        quantity: input.quantity,
        options: input.options,
        choiceNames: v?.choiceNames ?? [],
        note: input.note,
        sectionId: v?.sectionId ?? "",
      };
    });

    let releaseAt: Date | undefined;
    const { order } = await this.store.mutate(
      undefined,
      orderId,
      (o) => {
        o.customer = {
          id: req.customerId,
          name: customer?.name || o.customer?.name || "",
          phone: customer?.phone || o.customer?.phone || "",
        };
        o.restaurant = {
          id: restaurant.id || req.restaurantId,
          name: restaurant.name,
          imageId: restaurant.imageId,
          area: restaurant.area,
          address: restaurant.address,
          phone: restaurant.phone,
          location: restaurant.location,
          zoneId: restaurant.zoneId,
          etaMinMinutes: restaurant.etaMinMinutes,
          etaMaxMinutes: restaurant.etaMaxMinutes,
          discountPercent: quoteBase.restaurantDiscountPercent,
        };
        o.lines = lines;
        o.address = delivery && req.address ? { ...req.address, zoneId } : undefined;
        o.zoneId = zoneId;
        o.distanceKm = restaurant.distanceKm;
        o.totals = totals;
        o.promo = promo;
        o.customerRepeatCount = repeat;
        o.updatedAt = now;
        if (o.scheduledFor) {
          const start = new Date(o.scheduledFor.getTime() - leadMinutes(o) * 60_000);
          if (start.getTime() - now.getTime() >= SCHEDULE_MIN_AHEAD_MS) releaseAt = start;
        }
        // No event yet (OrderPlaced comes with PLACED); the priced snapshot is what later steps read.
        return [];
      },
      { save: true },
    );

    return {
      ok: true,
      promoCode: promo?.code ?? "",
      promoDiscountMinor: minor(totals.promoDiscount),
      creditMinor: minor(totals.credit),
      totalMinor: minor(totals.total),
      paymentKind: order.payment?.kind ?? 0,
      releaseAt: releaseAt?.toISOString(),
    };
  }
}

function fail(reason: string, message: string, metadata: Record<string, string> = {}): StepFailure {
  return { ok: false, reason, message, metadata };
}

/** PROMO_REJECTION_MIN_SUBTOTAL → PROMO_MIN_SUBTOTAL (proto/README.md "Errors"). */
export function promoReason(rejection: number): string {
  const name = promoRejectionToJSON(rejection);
  return name.startsWith("PROMO_REJECTION_") && name !== "PROMO_REJECTION_UNSPECIFIED"
    ? `PROMO_${name.slice("PROMO_REJECTION_".length)}`
    : "PROMO_INVALID";
}
