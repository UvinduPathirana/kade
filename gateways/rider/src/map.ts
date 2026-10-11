import type { GeoPoint } from "@kade/proto/kade/common/v1/types";

/**
 * The rider app draws an illustrated 400 × 600 map of Colombo's coast (north up, sea on the left;
 * apps/rider/src/features/map/geo.ts). Services speak WGS84. This is the one linear projection
 * between the two: y 0 → 6.9200° N, y 600 → 6.8450° N (Kollupitiya … Dehiwala), x 0 → 79.8360° E,
 * one map unit ≈ 0.0000915° of longitude (Galle Road x 150 ≈ 79.8497°, Duplication Road x 255 ≈ 79.8593°).
 */
export interface MapPoint {
  x: number;
  y: number;
}

const VIEW = { w: 400, h: 600 };
const NORTH = 6.92;
const SOUTH = 6.845;
const WEST = 79.836;
const LNG_PER_UNIT = 0.0000915;
const LAT_PER_UNIT = (NORTH - SOUTH) / VIEW.h;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10) / 10;

export function toMapPoint(p: GeoPoint | undefined, fallback: MapPoint = { x: 255, y: 120 }): MapPoint {
  if (!p || (p.lat === 0 && p.lng === 0)) return fallback;
  return {
    x: round(clamp((p.lng - WEST) / LNG_PER_UNIT, 0, VIEW.w)),
    y: round(clamp((NORTH - p.lat) / LAT_PER_UNIT, 0, VIEW.h)),
  };
}

export function toGeoPoint(p: MapPoint): GeoPoint {
  return {
    lat: Math.round((NORTH - p.y * LAT_PER_UNIT) * 1e6) / 1e6,
    lng: Math.round((WEST + p.x * LNG_PER_UNIT) * 1e6) / 1e6,
  };
}
