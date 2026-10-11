// Opening hours, closures and availability (same rules as catalog's src/catalog/hours.ts; services
// share contracts, not code). Search recomputes availability at query time from the hours in the
// projection, because "open now" changes without any event. All local times are Asia/Colombo, which is a fixed
// UTC+05:30 with no daylight saving, so plain arithmetic is exact.
import { AvailabilityState, type RestaurantAvailability } from "@kade/proto/kade/catalog/v1/catalog_service";
import type { HoursDay } from "../db/schema.js";

const OFFSET_MS = (5 * 60 + 30) * 60_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface LocalParts {
  /** ISO date in Colombo. */
  date: string;
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
}

export function colomboParts(t: Date): LocalParts {
  const local = new Date(t.getTime() + OFFSET_MS);
  const jsDay = local.getUTCDay(); // 0 = Sunday
  return {
    date: local.toISOString().slice(0, 10),
    weekday: jsDay === 0 ? 7 : jsDay,
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** Colombo midnight of an ISO date, as an instant. */
export function localMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) - OFFSET_MS;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isHhmm(value: string): boolean {
  return HHMM.test(value);
}

export function minutesOf(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) throw new Error(`bad time ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface Interval {
  start: number;
  end: number;
}

/** Opening intervals that START on this local date (an overnight range ends the next morning). */
export function intervalsOn(hours: HoursDay[], closedDates: ReadonlySet<string>, date: string): Interval[] {
  if (closedDates.has(date)) return [];
  const day = hours.find((h) => h.day === weekdayOf(date));
  if (!day?.isOpen) return [];
  const midnight = localMidnight(date);
  return day.ranges.map((r) => {
    const open = minutesOf(r.open);
    let close = minutesOf(r.close);
    if (close <= open) close += 24 * 60;
    return { start: midnight + open * 60_000, end: midnight + close * 60_000 };
  });
}

export function isOpenAt(hours: HoursDay[], closedDates: ReadonlySet<string>, t: Date): boolean {
  const today = colomboParts(t).date;
  const now = t.getTime();
  return [addDays(today, -1), today].some((d) =>
    intervalsOn(hours, closedDates, d).some((i) => i.start <= now && now < i.end),
  );
}

/** The next time the kitchen opens strictly after t (within the next 14 days). */
export function nextOpening(hours: HoursDay[], closedDates: ReadonlySet<string>, t: Date): Date | undefined {
  const today = colomboParts(t).date;
  const now = t.getTime();
  for (let d = 0; d <= 14; d++) {
    const starts = intervalsOn(hours, closedDates, addDays(today, d))
      .map((i) => i.start)
      .filter((s) => s > now)
      .sort((a, b) => a - b);
    if (starts[0] !== undefined) return new Date(starts[0]);
  }
  return undefined;
}

/** "8 am", "7:30 pm", "12 pm", "12 am". */
export function formatClock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return min === 0 ? `${h12} ${suffix}` : `${h12}:${String(min).padStart(2, "0")} ${suffix}`;
}

/** Today's hours for display, e.g. "11 am – 2 am" or "11 am – 3 pm, 6 pm – 2 am". */
export function hoursLabel(hours: HoursDay[], closedDates: ReadonlySet<string>, t: Date): string {
  const { date } = colomboParts(t);
  if (closedDates.has(date)) return "Closed today";
  const day = hours.find((h) => h.day === weekdayOf(date));
  if (!day?.isOpen || day.ranges.length === 0) return "Closed today";
  return day.ranges
    .map((r) => `${formatClock(minutesOf(r.open))} – ${formatClock(minutesOf(r.close))}`)
    .join(", ");
}

/** "Opens at 8 am", "Opens tomorrow at 11 am", "Opens Mon at 11 am". */
export function opensLabel(prefix: string, at: Date, now: Date): string {
  const target = colomboParts(at);
  const today = colomboParts(now).date;
  const time = formatClock(target.minutes);
  if (target.date === today) return `${prefix} at ${time}`;
  if (target.date === addDays(today, 1)) return `${prefix} tomorrow at ${time}`;
  return `${prefix} ${WEEKDAYS[target.weekday - 1]} at ${time}`;
}

export interface AvailabilityInput {
  hours: HoursDay[];
  closedDates: ReadonlySet<string>;
  /** open | paused | suspended | closed (merchant's ops status). */
  adminStatus: string;
  pausedUntil: Date | null;
  busyExtraMinutes: number;
}

export function computeAvailability(input: AvailabilityInput, now: Date): RestaurantAvailability {
  const busyExtraMinutes = input.busyExtraMinutes;
  if (input.adminStatus === "suspended") {
    return {
      state: AvailabilityState.AVAILABILITY_STATE_SUSPENDED,
      closedLabel: "Unavailable",
      busyExtraMinutes,
    };
  }
  if (input.adminStatus === "closed") {
    return { state: AvailabilityState.AVAILABILITY_STATE_CLOSED, closedLabel: "Closed", busyExtraMinutes };
  }
  if (input.pausedUntil && input.pausedUntil.getTime() > now.getTime()) {
    return {
      state: AvailabilityState.AVAILABILITY_STATE_PAUSED,
      closedLabel: opensLabel("Back", input.pausedUntil, now),
      opensAt: input.pausedUntil,
      busyExtraMinutes,
    };
  }
  if (input.adminStatus === "paused") {
    return { state: AvailabilityState.AVAILABILITY_STATE_PAUSED, closedLabel: "Paused", busyExtraMinutes };
  }
  if (isOpenAt(input.hours, input.closedDates, now)) {
    return { state: AvailabilityState.AVAILABILITY_STATE_OPEN, closedLabel: "", busyExtraMinutes };
  }
  const next = nextOpening(input.hours, input.closedDates, now);
  return {
    state: AvailabilityState.AVAILABILITY_STATE_CLOSED,
    closedLabel: next ? opensLabel("Opens", next, now) : "Closed",
    opensAt: next,
    busyExtraMinutes,
  };
}

/**
 * The service clock. DEMO_TIME ("HH:MM", Colombo) pins the time of day to make availability
 * deterministic for demos; unset = real time.
 */
export function makeClock(demoTime: string | undefined): () => Date {
  if (!demoTime) return () => new Date();
  const minutes = minutesOf(demoTime);
  return () => {
    const { date } = colomboParts(new Date());
    return new Date(localMidnight(date) + minutes * 60_000);
  };
}
