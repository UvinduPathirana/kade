// Zones and pricing API. Later: the pricing service, which the order service asks for the delivery
// fee at checkout (so the preview here and the customer's total come from the same rules).
import { formatRs } from "@kade/ui";
import { ApiError, audit, find, respond } from "./client";
import { surcharges, weather, zones } from "./mock/zones";
import type { SurchargeRule, WeatherSurcharge, Zone } from "./types";

export interface Pricing {
  zones: Zone[];
  surcharges: SurchargeRule[];
  weather: WeatherSurcharge;
}

export const getPricing = () => respond<Pricing>({ zones, surcharges, weather });

export async function setZoneOpen({ id, open }: { id: string; open: boolean }) {
  const z = find(zones, (x) => x.id === id, "Zone");
  z.open = open;
  audit({
    action: open ? "Opened zone" : "Closed zone",
    recordType: "zone",
    recordId: id,
    detail: `${z.code}, ${z.name}`,
  });
  return respond(z);
}

export async function updateZoneFees({
  id,
  ...fees
}: Pick<Zone, "id" | "baseFee" | "perKm" | "smallOrderFee" | "smallOrderUnder">) {
  for (const v of Object.values(fees))
    if (!Number.isFinite(v) || v < 0 || v > 5000)
      throw new ApiError("Fees must be between Rs 0 and Rs 5,000.");
  const z = find(zones, (x) => x.id === id, "Zone");
  Object.assign(z, fees);
  audit({
    action: "Changed delivery fees",
    recordType: "zone",
    recordId: id,
    detail: `${z.code}: base ${formatRs(fees.baseFee)}, ${formatRs(fees.perKm)} per km`,
  });
  return respond(z);
}

export async function saveSurcharge(rule: Omit<SurchargeRule, "id"> & { id?: string }) {
  if (!rule.label.trim())
    throw new ApiError("Give the rule a name staff will recognise, like “Dinner peak”.");
  if (rule.amount <= 0 || rule.amount > 500) throw new ApiError("Surcharge must be between Rs 1 and Rs 500.");
  let saved: SurchargeRule;
  if (rule.id) {
    saved = find(surcharges, (x) => x.id === rule.id, "Rule");
    Object.assign(saved, rule);
  } else {
    saved = { ...rule, id: `s${surcharges.length + 1}` };
    surcharges.push(saved);
  }
  audit({
    action: rule.id ? "Changed surcharge rule" : "Added surcharge rule",
    recordType: "zone",
    recordId: saved.id,
    detail: `${saved.label}: +${formatRs(saved.amount)}, ${saved.start} to ${saved.end}`,
  });
  return respond(saved);
}

export async function setSurchargeEnabled({ id, enabled }: { id: string; enabled: boolean }) {
  const r = find(surcharges, (x) => x.id === id, "Rule");
  r.enabled = enabled;
  audit({
    action: `${enabled ? "Turned on" : "Turned off"} ${r.label.toLowerCase()} surcharge`,
    recordType: "zone",
    recordId: id,
  });
  return respond(r);
}

export async function setWeather(next: WeatherSurcharge) {
  if (next.amount <= 0 || next.amount > 500)
    throw new ApiError("Rain surcharge must be between Rs 1 and Rs 500.");
  Object.assign(weather, next);
  audit({
    action: next.enabled
      ? `Turned on heavy rain surcharge, +${formatRs(next.amount)}`
      : "Turned off heavy rain surcharge",
    recordType: "zone",
    recordId: "weather",
  });
  return respond(weather);
}

/** Minutes since midnight from "19:30". */
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const dayMatches = (days: SurchargeRule["days"], weekday: number) => {
  switch (days) {
    case "Every day":
      return true;
    case "Mon to Fri":
      return weekday >= 1 && weekday <= 5;
    case "Fri to Sun":
      return weekday === 5 || weekday === 6 || weekday === 0;
    case "Sat and Sun":
      return weekday === 6 || weekday === 0;
  }
};

/** Is the rule running at this moment? Windows that pass midnight ("23:00" to "02:00") wrap. */
export function surchargeActive(rule: SurchargeRule, at: number): boolean {
  if (!rule.enabled) return false;
  const d = new Date(at);
  const minute = d.getHours() * 60 + d.getMinutes();
  const start = toMin(rule.start);
  const end = toMin(rule.end);
  if (start <= end) return dayMatches(rule.days, d.getDay()) && minute >= start && minute < end;
  // Overnight: the early-morning part belongs to the previous day's rule
  if (minute >= start) return dayMatches(rule.days, d.getDay());
  return minute < end && dayMatches(rule.days, (d.getDay() + 6) % 7);
}

export interface FeeQuote {
  base: number;
  distance: number;
  smallOrder: number;
  surcharges: { label: string; amount: number }[];
  deliveryTotal: number;
  total: number;
}

/** The delivery fee the customer pays, line by line. Same rules as the customer app's totals.ts. */
export function quoteDelivery(
  p: Pricing,
  zoneId: string,
  km: number,
  subtotal: number,
  at: number,
): FeeQuote {
  const z = p.zones.find((x) => x.id === zoneId)!;
  const distance = Math.round(Math.max(0, km - 2) * z.perKm);
  const smallOrder = subtotal < z.smallOrderUnder ? z.smallOrderFee : 0;
  const extra = p.surcharges
    .filter((r) => surchargeActive(r, at))
    .map((r) => ({ label: r.label, amount: r.amount }));
  if (p.weather.enabled) extra.push({ label: "Heavy rain", amount: p.weather.amount });
  const deliveryTotal = z.baseFee + distance + smallOrder + extra.reduce((s, x) => s + x.amount, 0);
  return {
    base: z.baseFee,
    distance,
    smallOrder,
    surcharges: extra,
    deliveryTotal,
    total: subtotal + deliveryTotal,
  };
}
