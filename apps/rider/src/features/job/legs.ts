/*
 * Demo timing for the two riding legs. A real job moves with GPS; here the marker moves along the route
 * over a compressed time so the demo plays out in under two minutes.
 */
export const PICKUP_LEG_SECONDS = 40;
export const DROPOFF_LEG_SECONDS = 50;

export function legProgress(startedAt: number, legSeconds: number, now: number): number {
  return Math.max(0, Math.min(1, (now - startedAt) / (legSeconds * 1000)));
}

/** Real-world minutes left on a leg that takes `minutes` in total. */
export function minutesLeft(minutes: number, progress: number): number {
  return Math.max(1, Math.ceil(minutes * (1 - progress)));
}
