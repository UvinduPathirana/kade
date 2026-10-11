// Demo clock. In mock mode the console opens on Saturday 10 October 2026 at 7:42 pm, the Saturday
// dinner rush, and runs forward in real time from there, so every page agrees on "now". In live
// mode it is simply the real clock.
import { isLive } from "../config";

const LOADED_AT = Date.now();
const SIM_START = isLive ? LOADED_AT : new Date(2026, 9, 10, 19, 42, 0).getTime();

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function simNow(): number {
  return SIM_START + (Date.now() - LOADED_AT);
}

/** Midnight at the start of the demo day (live: today, local time). */
export const TODAY_START = isLive
  ? new Date(LOADED_AT).setHours(0, 0, 0, 0)
  : new Date(2026, 9, 10).getTime();
