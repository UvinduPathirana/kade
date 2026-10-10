import { clockTime, minutesLeft, startOf } from "@/api/orderStatus";
import type { Order, OrderStatus } from "@/api/types";

const mins = (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`;

/** Headline + one supporting line for each status. Time-first, plain words, no exclamation marks. */
export function statusCopy(
  order: Order,
  status: OrderStatus,
  now = Date.now(),
): { headline: string; detail: string } {
  const r = order.restaurant.name;
  const rider = order.rider?.name ?? "Your rider";
  const m = minutesLeft(order, now);
  const delivery = order.mode === "delivery";

  switch (status) {
    case "scheduled":
      return {
        headline: `Scheduled for ${clockTime(order.scheduledFor!)}.`,
        detail: `We'll send it to ${r} at ${clockTime(startOf(order))} so it ${delivery ? "arrives" : "is ready"} on time. You can cancel until then.`,
      };
    case "placed":
      return {
        headline: "Waiting for the kitchen to accept.",
        detail: `${r} usually accepts within a minute. You can cancel until they do.`,
      };
    case "accepted":
      return {
        headline: delivery ? `Accepted. ${mins(m)} to go.` : `Accepted. Ready in about ${mins(m)}.`,
        detail: delivery
          ? `The kitchen has your order. ${rider} will collect it.`
          : "The kitchen has your order.",
      };
    case "preparing":
      return {
        headline: delivery ? `Cooking now. ${mins(m)} to go.` : `Cooking now. Ready in about ${mins(m)}.`,
        detail: delivery ? `${rider} is heading to ${r}.` : "We'll tell you as soon as it's at the counter.",
      };
    case "pickedUp":
      return {
        headline: `${rider} is ${mins(m)} away.`,
        detail: `${rider} has your food. Arriving around ${clockTime(now + m * 60_000)}.`,
      };
    case "ready":
      return {
        headline: "Ready to collect.",
        detail: `Show order ${order.id} at the counter, 214 Galle Rd, ${order.restaurant.area}.`,
      };
    case "delivered":
      return { headline: "Delivered.", detail: "Enjoy your food." };
    case "collected":
      return { headline: "Collected.", detail: "Enjoy your food." };
    case "cancelled":
      return {
        headline: "Order cancelled.",
        detail: order.payment.type === "card" ? "You haven't been charged." : "There's nothing to pay.",
      };
  }
}
