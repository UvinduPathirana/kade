/** Clock time like "7:42 pm". */
export function clockTime(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString("en-LK", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
}

/** "Sat 10 Oct" */
export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** "Today", "Yesterday" or "Thu 8 Oct". */
export function dayLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return shortDate(ms);
}

/** Calendar day key "2026-10-10" in local time, for grouping. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "1 h 25 min" / "25 min" */
export function duration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** "4.2 km" */
export const km = (n: number) => `${n.toFixed(1)} km`;

/** Today at the given hour and minute, as a timestamp. */
export function todayAt(hour: number, minute = 0, now = Date.now()): number {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** N days ago at the given time. */
export function daysAgoAt(days: number, hour: number, minute = 0, now = Date.now()): number {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}
