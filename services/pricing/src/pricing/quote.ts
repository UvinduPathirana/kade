import { createHash } from "node:crypto";
import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import { haversineKm, isSet, resolveZone, roundKm } from "./geo.js";
import { roundToRupee } from "./money.js";
import {
  DEFAULT_SMALL_ORDER_FEE,
  DEFAULT_SMALL_ORDER_UNDER,
  HEAVY_RAIN_LABEL,
  INCLUDED_KM,
  type LatLng,
  type RuleSet,
  type ZoneRule,
} from "./rules.js";
import { surchargeActive } from "./surcharges.js";
import { computeTotals, type TotalsResult } from "./totals.js";

export interface FeeBreakdown {
  zoneId: string;
  distanceKm: number;
  base: number;
  distance: number;
  surcharges: { label: string; amount: number }[];
  total: number;
}

/** Active time-window surcharges plus heavy rain, in rule order. */
export function activeSurcharges(rules: RuleSet, at: Date): { label: string; amount: number }[] {
  const extra = rules.surcharges
    .filter((r) => surchargeActive(r, at))
    .map((r) => ({ label: r.label, amount: r.amount }));
  if (rules.weather.enabled) extra.push({ label: HEAVY_RAIN_LABEL, amount: rules.weather.amount });
  return extra;
}

/**
 * The zone delivery fee, line by line (port of quoteDelivery in apps/admin/src/api/pricing.ts):
 * base + round(max(0, km − 2) × per_km) + active surcharges. The small-order fee is separate.
 */
export function deliveryBreakdown(rules: RuleSet, zone: ZoneRule, km: number, at: Date): FeeBreakdown {
  const distanceKm = roundKm(Math.max(0, km));
  const distance = roundToRupee(Math.max(0, distanceKm - INCLUDED_KM) * zone.perKm);
  const surcharges = activeSurcharges(rules, at);
  return {
    zoneId: zone.id,
    distanceKm,
    base: zone.baseFee,
    distance,
    surcharges,
    total: zone.baseFee + distance + surcharges.reduce((s, x) => s + x.amount, 0),
  };
}

export type Waiver = "none" | "plus" | "offer" | "pickup";

export interface QuoteInput {
  restaurantId: string;
  restaurantLocation?: LatLng;
  mode: FulfilmentMode;
  lines: { lineKey: string; unitPrice: number; quantity: number }[];
  deliverTo?: LatLng;
  discountPercent: number;
  freeDeliveryOffer: boolean;
  promoDiscount: number;
  tip: number;
  creditAvailable: number;
  plusActive: boolean;
  at: Date;
  offerSaving?: number;
}

export interface QuoteResult {
  totals: TotalsResult;
  breakdown?: FeeBreakdown;
  waiver: Waiver;
  outOfZone: boolean;
  rulesVersion: number;
  quoteId: string;
}

/**
 * QuoteCart. Delivery uses the zone of the delivery address (falling back to the restaurant's zone
 * when no address is known yet, at distance 0). The small-order fee uses that same zone; pickup uses
 * the restaurant's zone, and the customer app's Rs 60 under Rs 500 when no zone applies.
 */
export function quoteCart(rules: RuleSet, input: QuoteInput): QuoteResult {
  const delivery = input.mode === FulfilmentMode.FULFILMENT_MODE_DELIVERY;
  const restaurantZone = resolveZone(rules.zones, input.restaurantLocation);
  const hasAddress = isSet(input.deliverTo);

  let breakdown: FeeBreakdown | undefined;
  let outOfZone = false;
  let feeZone: ZoneRule | undefined = restaurantZone;
  if (delivery) {
    if (hasAddress) {
      const zone = resolveZone(rules.zones, input.deliverTo);
      if (!zone || !zone.open) {
        outOfZone = true;
        feeZone = zone ?? restaurantZone;
      } else {
        feeZone = zone;
        const km = isSet(input.restaurantLocation)
          ? haversineKm(input.restaurantLocation, input.deliverTo!)
          : 0;
        breakdown = deliveryBreakdown(rules, zone, km, input.at);
      }
    } else if (restaurantZone) {
      breakdown = deliveryBreakdown(rules, restaurantZone, 0, input.at);
    }
  }

  const totals = computeTotals({
    lines: input.lines,
    mode: input.mode,
    deliveryFee: breakdown?.total ?? 0,
    discountPercent: input.discountPercent,
    offerSaving: input.offerSaving,
    freeDeliveryOffer: input.freeDeliveryOffer,
    smallOrderUnder: feeZone?.smallOrderUnder ?? DEFAULT_SMALL_ORDER_UNDER,
    smallOrderFee: feeZone?.smallOrderFee ?? DEFAULT_SMALL_ORDER_FEE,
    plusActive: input.plusActive,
    plusFreeDeliveryFrom: rules.plusFreeDeliveryFrom,
    promoDiscount: input.promoDiscount,
    tip: input.tip,
    creditAvailable: input.creditAvailable,
  });

  const waiver: Waiver = !delivery
    ? "pickup"
    : totals.count > 0 && totals.plusWaives
      ? "plus"
      : input.freeDeliveryOffer
        ? "offer"
        : "none";

  return {
    totals,
    breakdown,
    waiver,
    outOfZone,
    rulesVersion: rules.rulesVersion,
    quoteId: quoteId(input, rules.rulesVersion),
  };
}

/** Stable hash of the inputs and the rules version; the order stores it for audit. */
export function quoteId(input: QuoteInput, rulesVersion: number): string {
  const canonical = JSON.stringify({ ...input, at: input.at.toISOString(), rulesVersion });
  return `q_${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}
