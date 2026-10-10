// Dates and times the way Kadé writes them: "7:41 pm", "Today, 7:41 pm", "8 Oct".
import { DAY, TODAY_START } from "@/api/mock/clock";

const clock = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** "7:41 pm" */
export function formatClock(ms: number): string {
  return clock
    .format(ms)
    .replace(/\s?([ap])\.?m\.?/i, " $1m")
    .toLowerCase();
}

/** "Today, 7:41 pm", "Yesterday, 6:02 pm" or "8 Oct, 6:02 pm" */
export function formatWhen(ms: number): string {
  const day = ms >= TODAY_START ? "Today" : ms >= TODAY_START - DAY ? "Yesterday" : dayMonth.format(ms);
  return `${day}, ${formatClock(ms)}`;
}

/** "8 Oct" from an ISO date or a timestamp; adds the year when it isn't 2026. */
export function formatDate(d: string | number): string {
  const date = typeof d === "number" ? new Date(d) : new Date(`${d}T00:00:00`);
  return date.getFullYear() === 2026 ? dayMonth.format(date) : dayMonthYear.format(date);
}

/** "Sat 10 Oct" */
export function formatDay(ms: number): string {
  return weekday.format(ms).replace(",", "");
}

/** "just now", "4 min ago", "2 h ago", "3 days ago" */
export function formatAgo(ms: number, now: number): string {
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** "45 min", "1 h 12 min" */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const formatPercent = (v: number) => `${Math.round(v * 100)}%`;

/** Days from the demo's today until an ISO date (negative once it has passed). */
export function daysUntil(iso: string): number {
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - TODAY_START) / DAY);
}
