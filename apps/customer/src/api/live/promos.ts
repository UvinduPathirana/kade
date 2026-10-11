import { api } from "../http";
import type { OrderMode } from "../types";

export type LivePromoResult =
  { ok: true; code: string; label: string; discount: number } | { ok: false; error: string };

export const listPromos = () => api<{ code: string; label: string; detail: string }[]>("GET", "/v1/promos");

export async function checkPromo(
  code: string,
  subtotal: number,
  restaurantId: number,
  mode: OrderMode = "delivery",
): Promise<LivePromoResult> {
  const r = await api<{ ok: boolean; code?: string; label?: string; discount?: number; error?: string }>(
    "POST",
    "/v1/promos/validate",
    { body: { code, subtotal, restaurantId, mode } },
  );
  return r.ok
    ? { ok: true, code: r.code ?? code.trim().toUpperCase(), label: r.label ?? "", discount: r.discount ?? 0 }
    : { ok: false, error: r.error ?? `${code} can't be used on this order.` };
}
