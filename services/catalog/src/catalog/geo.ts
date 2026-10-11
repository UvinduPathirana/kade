const R_KM = 6371.0088;
const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, radians. */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return Math.atan2(y, x);
}

/** The point `km` away from `from` along `brng` (radians). */
export function destination(from: LatLng, brng: number, km: number): LatLng {
  const d = km / R_KM;
  const lat1 = rad(from.lat);
  const lng1 = rad(from.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lng2 =
    lng1 +
    Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lng: deg(lng2) };
}

/** One decimal, as the apps show ("1.2 km"). */
export const roundKm = (km: number): number => Math.round(km * 10) / 10;

/** Customer app map units (1000×1400, north up) → WGS84 (CONVENTIONS.md "Map units"). */
export function fromMapUnits(x: number, y: number): LatLng {
  return { lat: 6.9457 - 0.00007126 * y, lng: 79.82772 + 0.00006806 * x };
}
