import { Inject, Injectable } from "@nestjs/common";
import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import {
  DeliveryFeeWaiver,
  PricingServiceService,
  SurchargeDays,
  type BatchQuoteDeliveryFeesRequest,
  type BatchQuoteDeliveryFeesResponse,
  type DeliveryFeeBreakdown,
  type GetPricingConfigResponse,
  type ListZonesResponse,
  type QuoteCartRequest,
  type QuoteCartResponse,
  type QuoteDeliveryFeeRequest,
  type QuoteDeliveryFeeResponse,
  type ResolveZoneRequest,
  type ResolveZoneResponse,
  type SaveSurchargeRuleRequest,
  type SaveSurchargeRuleResponse,
  type SetSurchargeRuleEnabledRequest,
  type SetSurchargeRuleEnabledResponse,
  type SetWeatherSurchargeRequest,
  type SetWeatherSurchargeResponse,
  type SetZoneOpenRequest,
  type SetZoneOpenResponse,
  type SurchargeRule,
  type UpdateZoneFeesRequest,
  type UpdateZoneFeesResponse,
  type WeatherSurcharge,
  type Zone,
} from "@kade/proto/kade/pricing/v1/pricing_service";
import type { RequestContext } from "../platform/grpc/context.js";
import { failedPrecondition, invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { boundary, haversineKm, isSet, resolveZone } from "./geo.js";
import { lkr, minor } from "./money.js";
import { deliveryBreakdown, quoteCart, type FeeBreakdown, type Waiver } from "./quote.js";
import type { Days, RuleSet, SurchargeRuleModel, ZoneRule } from "./rules.js";
import { RulesRepository } from "./rules.repository.js";
import { isTime } from "./surcharges.js";

/** Roles allowed to change pricing rules (ops console). */
const ADMIN_ROLES = ["ops", "admin"] as const;
const MAX_FEE = 5_000_00;
const MAX_SURCHARGE = 500_00;
const MAX_BATCH = 500;

/** kade.pricing.v1.PricingService: a pure calculation over the rule tables. */
@GrpcService(PricingServiceService)
@Injectable()
export class PricingGrpcService implements GrpcHandlers<PricingServiceService> {
  constructor(@Inject(RulesRepository) private readonly repo: RulesRepository) {}

  async quoteCart(request: QuoteCartRequest): Promise<QuoteCartResponse> {
    const mode = request.mode;
    if (mode !== FulfilmentMode.FULFILMENT_MODE_DELIVERY && mode !== FulfilmentMode.FULFILMENT_MODE_PICKUP) {
      throw invalidArgument("MODE_REQUIRED", "Choose delivery or pickup.");
    }
    const percent = request.restaurantDiscountPercent;
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw invalidArgument("DISCOUNT_PERCENT_INVALID", "The restaurant discount must be 0 to 100%.");
    }
    const lines = request.lines.map((l, i) => {
      const unitPrice = minor(l.unitPrice, `lines[${i}].unit_price`);
      if (!Number.isInteger(l.quantity) || l.quantity < 0 || unitPrice < 0) {
        throw invalidArgument("LINE_INVALID", "A cart line has an invalid price or quantity.", {
          line_key: l.lineKey,
        });
      }
      return { lineKey: l.lineKey, unitPrice, quantity: l.quantity };
    });
    const delivery = mode === FulfilmentMode.FULFILMENT_MODE_DELIVERY;
    if (delivery && lines.length > 0 && !isSet(request.restaurantLocation) && !isSet(request.deliverTo)) {
      throw invalidArgument(
        "LOCATION_REQUIRED",
        "We need the restaurant or delivery location to price delivery.",
      );
    }

    const rules = await this.repo.rules();
    const result = quoteCart(rules, {
      restaurantId: request.restaurantId,
      restaurantLocation: request.restaurantLocation,
      mode,
      lines,
      deliverTo: request.deliverTo,
      discountPercent: percent,
      freeDeliveryOffer: request.freeDeliveryOffer,
      promoDiscount: minor(request.promoDiscount, "promo_discount"),
      tip: minor(request.tip, "tip"),
      creditAvailable: minor(request.creditAvailable, "credit_available"),
      plusActive: request.plusActive,
      at: request.at ?? new Date(),
      offerSaving: request.offerSaving ? minor(request.offerSaving, "offer_saving") : undefined,
    });
    const t = result.totals;
    return {
      totals: {
        itemCount: t.count,
        subtotal: lkr(t.subtotal),
        saving: lkr(t.saving),
        deliveryFee: lkr(t.deliveryFee),
        smallOrderFee: lkr(t.smallOrderFee),
        promoDiscount: lkr(t.promoDiscount),
        tip: lkr(t.tip),
        credit: lkr(t.credit),
        total: lkr(t.total),
      },
      deliveryFeeBreakdown: result.breakdown ? toBreakdown(result.breakdown) : undefined,
      waiver: WAIVERS[result.waiver],
      outOfZone: result.outOfZone,
      rulesVersion: result.rulesVersion,
      quoteId: result.quoteId,
    };
  }

  async quoteDeliveryFee(request: QuoteDeliveryFeeRequest): Promise<QuoteDeliveryFeeResponse> {
    const rules = await this.repo.rules();
    const at = request.at ?? new Date();
    let zone: ZoneRule | undefined;
    let km: number;
    if (request.zoneId) {
      // Admin preview: zone and km given directly.
      zone = rules.zones.find((z) => z.id === request.zoneId);
      if (!zone) throw notFound("ZONE_NOT_FOUND", "That zone doesn't exist.", { zone_id: request.zoneId });
      if (!Number.isFinite(request.distanceKm) || request.distanceKm < 0) {
        throw invalidArgument("DISTANCE_INVALID", "Distance must be zero or more.");
      }
      km = request.distanceKm;
    } else {
      if (!isSet(request.deliverTo)) {
        throw invalidArgument("LOCATION_REQUIRED", "Give a zone and distance, or a delivery location.");
      }
      zone = resolveZone(rules.zones, request.deliverTo);
      if (!zone || !zone.open) throw outOfZone();
      km = isSet(request.restaurantLocation)
        ? haversineKm(request.restaurantLocation, request.deliverTo!)
        : 0;
    }
    const breakdown = deliveryBreakdown(rules, zone, km, at);
    const subtotal = minor(request.subtotal, "subtotal");
    const smallOrder = request.subtotal && subtotal < zone.smallOrderUnder ? zone.smallOrderFee : 0;
    const deliveryTotal = breakdown.total + smallOrder;
    return {
      breakdown: toBreakdown(breakdown),
      smallOrderFee: lkr(smallOrder),
      deliveryTotal: lkr(deliveryTotal),
      total: lkr(subtotal + deliveryTotal),
    };
  }

  async batchQuoteDeliveryFees(
    request: BatchQuoteDeliveryFeesRequest,
  ): Promise<BatchQuoteDeliveryFeesResponse> {
    if (request.restaurants.length > MAX_BATCH) {
      throw invalidArgument("BATCH_TOO_LARGE", `Quote at most ${MAX_BATCH} restaurants at a time.`);
    }
    const rules = await this.repo.rules();
    const at = request.at ?? new Date();
    const target = isSet(request.deliverTo) ? request.deliverTo : undefined;
    const customerZone = target ? resolveZone(rules.zones, target) : undefined;
    return {
      fees: request.restaurants.map((r) => {
        const location = isSet(r.location) ? r.location : undefined;
        // No customer location: the restaurant's own zone at distance 0 (a "from" price).
        const zone = target ? customerZone : resolveZone(rules.zones, location);
        const km = target && location ? haversineKm(location, target) : 0;
        if (!zone || !zone.open) {
          return { restaurantId: r.restaurantId, distanceKm: round1(km), fee: lkr(0), outOfZone: true };
        }
        const b = deliveryBreakdown(rules, zone, km, at);
        return {
          restaurantId: r.restaurantId,
          distanceKm: b.distanceKm,
          fee: lkr(b.total),
          outOfZone: false,
        };
      }),
    };
  }

  async resolveZone(request: ResolveZoneRequest): Promise<ResolveZoneResponse> {
    if (!isSet(request.location)) throw invalidArgument("LOCATION_REQUIRED", "A location is required.");
    const rules = await this.repo.rules();
    const zone = resolveZone(rules.zones, request.location);
    return { zone: zone ? toZoneProto(zone) : undefined, inZone: !!zone && zone.open };
  }

  async getPricingConfig(): Promise<GetPricingConfigResponse> {
    const rules = await this.repo.rules();
    return { config: toConfig(rules) };
  }

  async listZones(): Promise<ListZonesResponse> {
    const rules = await this.repo.rules();
    return { zones: rules.zones.map(toZoneProto) };
  }

  async setZoneOpen(request: SetZoneOpenRequest, ctx: RequestContext): Promise<SetZoneOpenResponse> {
    ctx.requireRole(...ADMIN_ROLES);
    const zone = await this.repo.setZoneOpen(ctx, request.zoneId, request.open);
    return { zone: toZoneProto(zone) };
  }

  async updateZoneFees(request: UpdateZoneFeesRequest, ctx: RequestContext): Promise<UpdateZoneFeesResponse> {
    ctx.requireRole(...ADMIN_ROLES);
    const fees = {
      baseFee: minor(request.baseFee, "base_fee"),
      perKm: minor(request.perKm, "per_km"),
      smallOrderFee: minor(request.smallOrderFee, "small_order_fee"),
      smallOrderUnder: minor(request.smallOrderUnder, "small_order_under"),
    };
    const missing = !request.baseFee || !request.perKm || !request.smallOrderFee || !request.smallOrderUnder;
    if (missing || Object.values(fees).some((v) => v < 0 || v > MAX_FEE)) {
      throw invalidArgument("ZONE_FEES_INVALID", "Fees must be between Rs 0 and Rs 5,000.");
    }
    const zone = await this.repo.updateZoneFees(ctx, request.zoneId, fees);
    return { zone: toZoneProto(zone) };
  }

  async saveSurchargeRule(
    request: SaveSurchargeRuleRequest,
    ctx: RequestContext,
  ): Promise<SaveSurchargeRuleResponse> {
    ctx.requireRole(...ADMIN_ROLES);
    const rule = request.rule;
    if (!rule) throw invalidArgument("SURCHARGE_RULE_REQUIRED", "Send the rule to save.");
    const label = rule.label.trim();
    if (!label) {
      throw invalidArgument(
        "SURCHARGE_LABEL_REQUIRED",
        "Give the rule a name staff will recognise, like “Dinner peak”.",
      );
    }
    const amount = minor(rule.amount, "amount");
    if (amount < 1_00 || amount > MAX_SURCHARGE) {
      throw invalidArgument("SURCHARGE_AMOUNT_INVALID", "Surcharge must be between Rs 1 and Rs 500.");
    }
    const days = DAYS_FROM_PROTO[rule.days];
    if (!days) throw invalidArgument("SURCHARGE_DAYS_INVALID", "Choose which days the surcharge runs.");
    if (!isTime(rule.start) || !isTime(rule.end) || rule.start === rule.end) {
      throw invalidArgument(
        "SURCHARGE_TIME_INVALID",
        "Use 24-hour times like 19:00, and an end that differs from the start.",
      );
    }
    const saved = await this.repo.saveSurchargeRule(ctx, {
      id: rule.id || undefined,
      label,
      days,
      start: rule.start,
      end: rule.end,
      amount,
      enabled: rule.enabled,
    });
    return { rule: toRuleProto(saved) };
  }

  async setSurchargeRuleEnabled(
    request: SetSurchargeRuleEnabledRequest,
    ctx: RequestContext,
  ): Promise<SetSurchargeRuleEnabledResponse> {
    ctx.requireRole(...ADMIN_ROLES);
    const rule = await this.repo.setSurchargeRuleEnabled(ctx, request.id, request.enabled);
    return { rule: toRuleProto(rule) };
  }

  async setWeatherSurcharge(
    request: SetWeatherSurchargeRequest,
    ctx: RequestContext,
  ): Promise<SetWeatherSurchargeResponse> {
    ctx.requireRole(...ADMIN_ROLES);
    const amount = minor(request.weather?.amount, "weather.amount");
    if (amount < 1_00 || amount > MAX_SURCHARGE) {
      throw invalidArgument("WEATHER_AMOUNT_INVALID", "Rain surcharge must be between Rs 1 and Rs 500.");
    }
    const weather = await this.repo.setWeather(ctx, { enabled: !!request.weather?.enabled, amount });
    return { weather: toWeather(weather) };
  }
}

const outOfZone = () => failedPrecondition("OUT_OF_ZONE", "We don't deliver to this address yet.");

const round1 = (km: number): number => Math.round(km * 10) / 10;

const WAIVERS: Record<Waiver, DeliveryFeeWaiver> = {
  none: DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_NONE,
  plus: DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_PLUS,
  offer: DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_OFFER,
  pickup: DeliveryFeeWaiver.DELIVERY_FEE_WAIVER_PICKUP,
};

const DAYS_TO_PROTO: Record<Days, SurchargeDays> = {
  every_day: SurchargeDays.SURCHARGE_DAYS_EVERY_DAY,
  mon_to_fri: SurchargeDays.SURCHARGE_DAYS_MON_TO_FRI,
  fri_to_sun: SurchargeDays.SURCHARGE_DAYS_FRI_TO_SUN,
  sat_and_sun: SurchargeDays.SURCHARGE_DAYS_SAT_AND_SUN,
};

const DAYS_FROM_PROTO: Partial<Record<SurchargeDays, Days>> = Object.fromEntries(
  Object.entries(DAYS_TO_PROTO).map(([k, v]) => [v, k as Days]),
);

export function toBreakdown(b: FeeBreakdown): DeliveryFeeBreakdown {
  return {
    zoneId: b.zoneId,
    distanceKm: b.distanceKm,
    base: lkr(b.base),
    distance: lkr(b.distance),
    surcharges: b.surcharges.map((s) => ({ label: s.label, amount: lkr(s.amount) })),
    total: lkr(b.total),
  };
}

export function toZoneProto(z: ZoneRule): Zone {
  return {
    id: z.id,
    code: z.code,
    name: z.name,
    open: z.open,
    baseFee: lkr(z.baseFee),
    perKm: lkr(z.perKm),
    smallOrderFee: lkr(z.smallOrderFee),
    smallOrderUnder: lkr(z.smallOrderUnder),
    ridersNeeded: z.ridersNeeded,
    boundary: boundary(z),
  };
}

export function toRuleProto(r: SurchargeRuleModel): SurchargeRule {
  return {
    id: r.id,
    label: r.label,
    days: DAYS_TO_PROTO[r.days],
    start: r.start,
    end: r.end,
    amount: lkr(r.amount),
    enabled: r.enabled,
  };
}

const toWeather = (w: { enabled: boolean; amount: number }): WeatherSurcharge => ({
  enabled: w.enabled,
  amount: lkr(w.amount),
});

function toConfig(rules: RuleSet) {
  return {
    zones: rules.zones.map(toZoneProto),
    surcharges: rules.surcharges.map(toRuleProto),
    weather: toWeather(rules.weather),
    plusFreeDeliveryFrom: lkr(rules.plusFreeDeliveryFrom),
    rulesVersion: rules.rulesVersion,
  };
}
