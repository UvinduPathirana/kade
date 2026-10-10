import type { OrderView } from "@/api/orders";
import type { OrderStatus } from "@/api/types";
import { formatClock } from "@/lib/format";

const FINAL: OrderStatus[] = ["delivered", "cancelled", "rejected"];
export const isFinalStatus = (s: OrderStatus) => FINAL.includes(s);

export const statusLabels: Record<OrderStatus, string> = {
  placed: "Waiting for kitchen",
  accepted: "Accepted",
  preparing: "Cooking",
  ready: "Ready for pickup",
  pickedUp: "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

/** The order's situation as one sentence, for the top of the side panel. */
export function statusSentence(o: OrderView): string {
  const rider = o.rider?.name.split(" ")[0];
  const due = `Due ${formatClock(o.dueAt)}${o.lateMin ? `, ${o.lateMin} min late` : ""}.`;
  switch (o.status) {
    case "placed":
      return `Waiting for ${o.restaurant.name} to accept. ${due}`;
    case "accepted":
    case "preparing":
      return `${o.restaurant.name} is cooking${rider ? `; ${rider} is assigned` : "; no rider yet"}. ${due}`;
    case "ready":
      return rider
        ? `Ready and waiting for ${rider} to collect. ${due}`
        : `Ready, but no rider is assigned. ${due}`;
    case "pickedUp":
      return `On the way with ${rider ?? "the rider"}. ${due}`;
    case "delivered":
      return `Delivered at ${formatClock(o.deliveredAt ?? o.dueAt)}${o.deliveredAt && o.deliveredAt > o.dueAt ? `, ${Math.round((o.deliveredAt - o.dueAt) / 60000)} min after the promised time` : ""}.`;
    case "cancelled":
      return `Cancelled. ${o.cancel?.reason ?? ""}`.trim();
    case "rejected":
      return `Rejected by ${o.restaurant.name}.`;
  }
}
