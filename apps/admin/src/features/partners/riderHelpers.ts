import type { ReviewDoc } from "@/api/types";
import { daysUntil } from "@/lib/format";

export const vehicleLabels = { motorbike: "Motorbike", tukTuk: "Tuk-tuk", bicycle: "Bicycle" } as const;

/** The document most in need of attention: expired first, then the soonest to expire within 30 days. */
export function worstDoc(docs: ReviewDoc[]): { doc: ReviewDoc; days: number } | null {
  const dated = docs
    .filter((d) => d.expiresOn)
    .map((d) => ({ doc: d, days: daysUntil(d.expiresOn!) }))
    .sort((a, b) => a.days - b.days);
  const first = dated[0];
  return first && first.days <= 30 ? first : null;
}
