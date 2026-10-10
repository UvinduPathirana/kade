import type { MapPoint } from "@/api/types";
import { CROSS_STREETS } from "@/features/map/geo";
import { km } from "@/lib/time";

const streetAt = (y: number) =>
  CROSS_STREETS.reduce((best, s) => (Math.abs(s.y - y) < Math.abs(best.y - y) ? s : best)).name;

/** The next instruction for the illustrated route (see geo.routePath). */
export function nextTurn(
  progress: number,
  to: MapPoint,
  place: string,
  kmLeft: number,
  minutesLeft: number,
): { title: string; detail: string } {
  const detail = `${km(kmLeft)}, ${minutesLeft} min`;
  if (progress >= 1) return { title: "You're here", detail: `${place} is on this street` };
  if (progress < 0.2) return { title: "Head to Duplication Rd", detail };
  if (progress < 0.8) return { title: "Stay on Duplication Rd", detail };
  return { title: `Turn onto ${streetAt(to.y)}`, detail };
}
