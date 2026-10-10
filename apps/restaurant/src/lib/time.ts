import { useEffect, useState } from "react";

/** "7:42 pm" */
export function clockTime(at: number): string {
  return new Date(at)
    .toLocaleTimeString("en-LK", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
}

/** "Sat 10 Oct" */
export function shortDate(at: number | string): string {
  const d = typeof at === "string" ? new Date(`${at}T00:00:00`) : new Date(at);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** "2:05" for timers. Negative values are clamped to 0:00. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "1 min", "12 min" (rounded up, so a timer never says 0 min while time is left). */
export const minutes = (ms: number) => `${Math.max(1, Math.ceil(ms / 60_000))} min`;

/** Re-renders every `interval` ms with the current time. Timers read this, not Date.now() in render. */
export function useNow(interval = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [interval]);
  return now;
}
