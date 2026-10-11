// Restaurant ids. Services use UUIDs; the customer app uses small numbers (its routes are
// /restaurant/1). Seeded restaurants are `00000000-0000-7000-8000-<N, 12 digits>` (CONVENTIONS,
// "Seeded ids"), so N round-trips without state. Restaurants created later (merchant onboarding)
// have real UUIDv7s: they get a number from a hash and are remembered here so the app's number
// maps back. A cold gateway learns them again the next time a list containing them is served.

const SEEDED = /^00000000-0000-7000-8000-(\d{12})$/;
/** Numbers at or above this are hashed (non-seeded) restaurants. */
const HASHED_BASE = 1_000_000;

const hashed = new Map<number, string>();

function hash(id: string): number {
  // FNV-1a, 32-bit, folded into [HASHED_BASE, 2^31).
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return HASHED_BASE + ((h >>> 0) % (2 ** 31 - HASHED_BASE));
}

/** Catalog restaurant UUID -> the app's number. */
export function restaurantNumber(id: string): number {
  const seeded = SEEDED.exec(id);
  if (seeded) return parseInt(seeded[1]!, 10);
  if (/^\d+$/.test(id)) return parseInt(id, 10);
  const n = hash(id);
  hashed.set(n, id);
  return n;
}

/** The app's number -> catalog restaurant UUID; undefined for an unknown hashed number. */
export function restaurantUuid(n: number): string | undefined {
  if (!Number.isSafeInteger(n) || n <= 0) return undefined;
  if (n < HASHED_BASE) return `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
  return hashed.get(n);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);
