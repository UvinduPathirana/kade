// Deterministic ids for seeded records (docs/backend/CONVENTIONS.md, "Seeded ids"):
// 00000000-0000-7000-<group>-<12 decimal digits>. Every service seeds against the same values.

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

function seeded(group: string, digits: string): string {
  if (digits.length !== 12) throw new Error(`seeded id needs 12 digits, got ${digits}`);
  return `00000000-0000-7000-${group}-${digits}`;
}

/** Restaurant N (the apps' numeric id) → 00000000-0000-7000-8000-00000000000N. */
export const restaurantId = (n: number): string => seeded("8000", pad(n, 12));
/** Menu item for the apps' "R-S-I" id. */
export const menuItemId = (r: number, s: number, i: number): string =>
  seeded("8010", pad(r, 4) + pad(s, 4) + pad(i, 4));
export const menuSectionId = (r: number, s: number): string => seeded("8011", pad(r, 6) + pad(s, 6));
/** g is 1-based in OPTION_GROUP_ORDER. */
export const optionGroupId = (r: number, g: number): string => seeded("8012", pad(r, 6) + pad(g, 6));
/** g and c are 1-based. */
export const optionChoiceId = (r: number, g: number, c: number): string =>
  seeded("8013", pad(r, 4) + pad(g, 4) + pad(c, 4));
export const collectionId = (n: number): string => seeded("8014", pad(n, 12));

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export type RestaurantRef = { id: string } | { legacyId: number };

/**
 * Restaurant references callers may send: a UUID, or the apps' bare number ("16", looked up by
 * legacy_id). Returns undefined for anything else.
 */
export function parseRestaurantRef(value: string): RestaurantRef | undefined {
  const v = value.trim();
  if (isUuid(v)) return { id: v.toLowerCase() };
  if (/^\d{1,9}$/.test(v)) return { legacyId: Number(v) };
  return undefined;
}
