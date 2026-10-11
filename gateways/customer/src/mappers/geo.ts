import type { GeoPoint } from "@kade/proto/kade/common/v1/types";

// The customer app draws an illustrated Colombo map (1000 × 1400 units, north up, sea to the west)
// instead of a tile map. Services speak WGS84. This linear fit to real landmarks converts between
// the two; it is the only place map units meet coordinates. Accurate to roughly 100 map units,
// which is plenty for an illustration.
const LAT0 = 6.9457;
const LAT_PER_Y = -0.00007126;
const LNG0 = 79.82772;
const LNG_PER_X = 0.00006806;

export interface MapPin {
  x: number;
  y: number;
}

export function geoFromMap(p: MapPin): GeoPoint {
  return {
    lat: Math.round((LAT0 + LAT_PER_Y * p.y) * 1e6) / 1e6,
    lng: Math.round((LNG0 + LNG_PER_X * p.x) * 1e6) / 1e6,
  };
}

/** Undefined for a missing or zero point (proto default). */
export function mapFromGeo(g: GeoPoint | undefined): MapPin | undefined {
  if (!g || (g.lat === 0 && g.lng === 0)) return undefined;
  return { x: Math.round((g.lng - LNG0) / LNG_PER_X), y: Math.round((g.lat - LAT0) / LAT_PER_Y) };
}
