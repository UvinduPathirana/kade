// The rule set every calculation reads: zones, surcharges, the rain toggle and the Plus threshold.
// Plain data (amounts in minor units) so the calculation stays pure and testable without a database.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ZoneRule {
  id: string;
  code: string;
  name: string;
  open: boolean;
  /** Covers the first 2 km. */
  baseFee: number;
  perKm: number;
  smallOrderFee: number;
  /** Orders under this subtotal pay the small-order fee. */
  smallOrderUnder: number;
  ridersNeeded: number;
  center: LatLng;
  radiusKm: number;
  position: number;
}

export type Days = "every_day" | "mon_to_fri" | "fri_to_sun" | "sat_and_sun";

export interface SurchargeRuleModel {
  id: string;
  label: string;
  days: Days;
  /** 24h "19:00", Asia/Colombo. */
  start: string;
  end: string;
  amount: number;
  enabled: boolean;
}

export interface WeatherRule {
  enabled: boolean;
  amount: number;
}

export interface RuleSet {
  zones: ZoneRule[];
  surcharges: SurchargeRuleModel[];
  weather: WeatherRule;
  plusFreeDeliveryFrom: number;
  rulesVersion: number;
}

/** The fee covers this many km; per_km applies beyond it. */
export const INCLUDED_KM = 2;
/** Used when no zone applies (pickup with no restaurant location): the customer app's constants. */
export const DEFAULT_SMALL_ORDER_UNDER = 500_00;
export const DEFAULT_SMALL_ORDER_FEE = 60_00;
export const HEAVY_RAIN_LABEL = "Heavy rain";
