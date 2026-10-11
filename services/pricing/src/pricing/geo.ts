import type { LatLng, ZoneRule } from "./rules.js";

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight-line km rounded to 0.1, the figure the apps show and the fee uses. */
export const roundKm = (km: number): number => Math.round(km * 10) / 10;

/** A point counts as given unless it is missing or exactly (0, 0) (proto3 default). */
export function isSet(p: LatLng | undefined): p is LatLng {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0);
}

/** The zone whose centre is nearest, if the point is within that zone's radius. Closed zones count. */
export function resolveZone(zones: readonly ZoneRule[], point: LatLng | undefined): ZoneRule | undefined {
  if (!isSet(point)) return undefined;
  let best: { zone: ZoneRule; km: number } | undefined;
  for (const zone of zones) {
    const km = haversineKm(zone.center, point);
    if (km <= zone.radiusKm && (!best || km < best.km)) best = { zone, km };
  }
  return best?.zone;
}

/** Polygon outline for maps: a 16-point ring approximating the zone's circle. */
export function boundary(zone: ZoneRule, points = 16): LatLng[] {
  const latKm = 110.574;
  const lngKm = 111.32 * Math.cos(rad(zone.center.lat));
  return Array.from({ length: points }, (_, i) => {
    const angle = (2 * Math.PI * i) / points;
    return {
      lat: Number((zone.center.lat + (zone.radiusKm * Math.sin(angle)) / latKm).toFixed(6)),
      lng: Number((zone.center.lng + (zone.radiusKm * Math.cos(angle)) / lngKm).toFixed(6)),
    };
  });
}
