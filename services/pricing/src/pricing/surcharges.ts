import type { Days, SurchargeRuleModel } from "./rules.js";

/** Asia/Colombo is UTC+05:30 all year (no DST), so a fixed offset is exact. */
const COLOMBO_OFFSET_MIN = 330;

/** Weekday (0 = Sunday) and minute of the day in Colombo. */
export function colomboClock(at: Date): { weekday: number; minute: number } {
  const local = new Date(at.getTime() + COLOMBO_OFFSET_MIN * 60_000);
  return { weekday: local.getUTCDay(), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isTime = (t: string): boolean => TIME.test(t);

/** Minutes since midnight from "19:30". */
export function toMinutes(t: string): number {
  const m = TIME.exec(t);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function dayMatches(days: Days, weekday: number): boolean {
  switch (days) {
    case "every_day":
      return true;
    case "mon_to_fri":
      return weekday >= 1 && weekday <= 5;
    case "fri_to_sun":
      return weekday === 5 || weekday === 6 || weekday === 0;
    case "sat_and_sun":
      return weekday === 6 || weekday === 0;
  }
}

/**
 * Is the rule running at this moment? Port of surchargeActive in apps/admin/src/api/pricing.ts.
 * Windows that pass midnight ("23:00" to "02:00") wrap; the early-morning part belongs to the
 * previous day's rule.
 */
export function surchargeActive(rule: SurchargeRuleModel, at: Date): boolean {
  if (!rule.enabled) return false;
  const { weekday, minute } = colomboClock(at);
  const start = toMinutes(rule.start);
  const end = toMinutes(rule.end);
  if (start <= end) return dayMatches(rule.days, weekday) && minute >= start && minute < end;
  if (minute >= start) return dayMatches(rule.days, weekday);
  return minute < end && dayMatches(rule.days, (weekday + 6) % 7);
}
