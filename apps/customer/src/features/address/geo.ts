import { landmarks } from "@/api/addresses";

/*
 * Geometry of the illustrated map in PinMap: 1000 × 1400 units, north up, the sea to the west.
 * The location service will answer these questions (reverse geocoding, zone checks) once a real map
 * provider is in; until then they're worked out against the drawing.
 */
export const MAP_W = 1000;
export const MAP_H = 1400;

/** Where the coastline sits at a given y, read off the sea path in PinMap. */
const coast: [number, number][] = [
  [0, 250],
  [360, 262],
  [800, 284],
  [1400, 296],
];

function coastX(y: number): number {
  for (let i = 1; i < coast.length; i++) {
    const [y0, x0] = coast[i - 1]!;
    const [y1, x1] = coast[i]!;
    if (y <= y1) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
  }
  return coast[coast.length - 1]![1];
}

export const clampToMap = (p: { x: number; y: number }) => ({
  x: Math.round(Math.max(120, Math.min(MAP_W - 60, p.x))),
  y: Math.round(Math.max(40, Math.min(MAP_H - 40, p.y))),
});

export type PinSpot =
  { ok: true; label: string; area: string; district: string } | { ok: false; reason: string };

/** Says where the pin is in words, or why a rider couldn't go there. */
export function describePin(p: { x: number; y: number }): PinSpot {
  if (p.x < coastX(p.y) + 8)
    return { ok: false, reason: "The pin is in the sea. Drag the map so it sits on your building." };
  let best = landmarks()[0]!;
  let bestD = Infinity;
  for (const l of landmarks()) {
    const d = Math.hypot(l.pin!.x - p.x, l.pin!.y - p.y);
    if (d < bestD) {
      best = l;
      bestD = d;
    }
  }
  const district = best.detail.split(", ").pop()!;
  return { ok: true, label: bestD < 30 ? best.name : `Near ${best.name}`, area: best.area, district };
}
