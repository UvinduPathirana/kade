// Promo codes. Later: POST /promos/validate on the promotions service.
import { formatRs } from "@kade/ui";

export type PromoResult =
  { ok: true; code: string; label: string; discount: number } | { ok: false; error: string };

interface PromoRule {
  code: string;
  label: string;
  minSubtotal?: number;
  restaurantId?: number;
  restaurantName?: string;
  discount: (subtotal: number) => number;
}

const rules: PromoRule[] = [
  { code: "KADE100", label: "Rs 100 off", minSubtotal: 1000, discount: () => 100 },
  {
    code: "FIRSTKOTTU",
    label: "15% off, up to Rs 500",
    restaurantId: 1,
    restaurantName: "Galle Road Kottu House",
    discount: (s) => Math.min(500, Math.round(s * 0.15)),
  },
];

export function validatePromo(raw: string, subtotal: number, restaurantId: number): PromoResult {
  const code = raw.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a promo code." };
  const rule = rules.find((r) => r.code === code);
  if (!rule) return { ok: false, error: `${code} isn't a Kadé code. Check the spelling and try again.` };
  if (rule.restaurantId && rule.restaurantId !== restaurantId)
    return { ok: false, error: `${code} only works at ${rule.restaurantName}.` };
  if (rule.minSubtotal && subtotal < rule.minSubtotal)
    return {
      ok: false,
      error: `${code} needs an order of ${formatRs(rule.minSubtotal)} or more. Add ${formatRs(rule.minSubtotal - subtotal)} to use it.`,
    };
  return { ok: true, code, label: rule.label, discount: rule.discount(subtotal) };
}

/** Codes anyone can use right now, for the offers page. */
export function listPromos(): Promise<{ code: string; label: string; detail: string }[]> {
  return Promise.resolve(
    rules.map((r) => ({
      code: r.code,
      label: r.label,
      detail: r.restaurantName
        ? `At ${r.restaurantName}`
        : r.minSubtotal
          ? `On orders of ${formatRs(r.minSubtotal)} or more`
          : "On any order",
    })),
  );
}
