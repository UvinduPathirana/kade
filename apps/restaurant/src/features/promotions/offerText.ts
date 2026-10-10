import { formatRs } from "@kade/ui";
import type { Menu, OfferInput } from "@/api/types";
import { shortDate } from "@/lib/time";

type OfferShape = Pick<
  OfferInput,
  "type" | "value" | "maxDiscount" | "minOrder" | "buy" | "get" | "bogoItemId" | "sectionIds"
>;

const itemName = (menu: Menu | undefined, id?: string) =>
  menu?.sections.flatMap((s) => s.items).find((i) => i.id === id)?.name;

/** What it's on: "kottu", "kottu and devilled", or nothing for the whole menu. */
function scope(o: OfferShape, menu?: Menu) {
  if (!o.sectionIds.length) return "";
  const names = o.sectionIds
    .map((id) => menu?.sections.find((s) => s.id === id)?.name.toLowerCase())
    .filter(Boolean) as string[];
  if (!names.length) return " selected dishes";
  return ` ${names.length > 2 ? "selected dishes" : names.join(" and ")}`;
}

/** The offer's headline, exactly as customers see it on the restaurant card: "20% off kottu". */
export function offerTitle(o: OfferShape, menu?: Menu): string {
  switch (o.type) {
    case "percent":
      return `${o.value || 0}% off${scope(o, menu) || " everything"}`;
    case "amount":
      return `${formatRs(o.value || 0)} off${o.minOrder ? ` orders over ${formatRs(o.minOrder)}` : ""}`;
    case "bogo":
      return `Buy ${o.buy || 1} ${itemName(menu, o.bogoItemId) ?? "dish"}, get ${o.get || 1} free`;
    case "freeDelivery":
      return o.minOrder ? `Free delivery over ${formatRs(o.minOrder)}` : "Free delivery";
  }
}

/** The small print under the headline. */
export function offerTerms(o: OfferShape & Pick<OfferInput, "endDate">): string {
  const parts: string[] = [];
  if (o.type === "percent" && o.maxDiscount) parts.push(`Up to ${formatRs(o.maxDiscount)} off.`);
  if (o.type === "percent" && o.minOrder) parts.push(`Orders over ${formatRs(o.minOrder)}.`);
  if (o.endDate) parts.push(`Ends ${shortDate(o.endDate)}.`);
  return parts.join(" ");
}

export const offerTypeLabels: Record<OfferInput["type"], string> = {
  percent: "Percent off",
  amount: "Rupees off",
  bogo: "Buy one, get one",
  freeDelivery: "Free delivery",
};
