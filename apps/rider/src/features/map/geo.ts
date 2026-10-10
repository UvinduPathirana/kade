import type { MapPoint } from "@/api/types";

/*
 * Geometry of the illustrated map: a 400 × 600 portrait slice of Colombo's coast, north at the top.
 * The sea is on the left, then the coastal railway, Galle Road and Duplication Road running north–south.
 * Cross streets run east–west at the y values below. A map provider replaces this once riders send GPS.
 */

export const VIEW = { w: 400, h: 600 } as const;

/** Galle Road and Duplication Road x positions (straightened for the illustration). */
export const GALLE_X = 150;
export const DUPLICATION_X = 255;

export interface Area {
  name: string;
  /** Centre of the area label and the demand zone. */
  point: MapPoint;
}

export const AREAS = {
  kollupitiya: { name: "Kollupitiya", point: { x: 205, y: 95 } },
  bambalapitiya: { name: "Bambalapitiya", point: { x: 205, y: 265 } },
  havelock: { name: "Havelock Town", point: { x: 330, y: 330 } },
  wellawatte: { name: "Wellawatte", point: { x: 205, y: 430 } },
  dehiwala: { name: "Dehiwala", point: { x: 205, y: 560 } },
  cinnamon: { name: "Cinnamon Gardens", point: { x: 335, y: 150 } },
} satisfies Record<string, Area>;

/** Cross streets (y) with their names, used for labels and for snapping routes. */
export const CROSS_STREETS = [
  { y: 60, name: "Dharmapala Mw" },
  { y: 175, name: "Thimbirigasyaya Rd" },
  { y: 300, name: "Dickmans Rd" },
  { y: 395, name: "Hampden Ln" },
  { y: 500, name: "Ramakrishna Rd" },
] as const;

/** Where the rider waits when online: the Kollupitiya junction. */
export const HOME_BASE: MapPoint = { x: 255, y: 120 };

/**
 * A road-following route between two points: out along the nearest cross street to Duplication Road,
 * down (or up) it, then along the destination's street. Good enough for an illustration.
 */
export function routePath(a: MapPoint, b: MapPoint): string {
  return `M${a.x} ${a.y} L${DUPLICATION_X} ${a.y} L${DUPLICATION_X} ${b.y} L${b.x} ${b.y}`;
}
