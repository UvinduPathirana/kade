import { pickupMinutes } from "@/lib/eta";
import type { Order, OrderStatus } from "./types";

/*
 * Live mode: the order service owns status (`order.status`) and the times it moved on; the helpers
 * below use those. Mock mode: status is derived from time since the order was placed so the demo moves
 * on its own, along this timeline (seconds after placing):
 */
export const TIMELINE = {
  accepted: 20,
  preparing: 30,
  pickedUp: 60, // delivery: rider has the food
  ready: 60, // pickup: food is at the counter
  delivered: 100,
} as const;

export const FINAL_STATUSES: OrderStatus[] = ["delivered", "collected", "cancelled"];

/** When the kitchen gets the order: now, or early enough before a scheduled time to arrive on time. */
export function startOf(order: Order): number {
  if (!order.scheduledFor) return order.placedAt;
  const lead = order.mode === "delivery" ? order.restaurant.eta[1] : pickupMinutes(order.restaurant.eta);
  return order.scheduledFor - lead * 60_000;
}

const secondsIn = (order: Order, now: number) => (now - startOf(order)) / 1000;

export function orderStatus(order: Order, now = Date.now()): OrderStatus {
  if (order.status) return order.status;
  if (order.cancelledAt) return "cancelled";
  if (order.collectedAt) return "collected";
  const s = secondsIn(order, now);
  if (s < 0) return "scheduled";
  if (s < TIMELINE.accepted) return "placed";
  if (s < TIMELINE.preparing) return "accepted";
  if (order.mode === "pickup") return s < TIMELINE.ready ? "preparing" : "ready";
  if (s < TIMELINE.pickedUp) return "preparing";
  if (s < TIMELINE.delivered) return "pickedUp";
  return "delivered";
}

/** 0 → 1 progress through the current leg, used to move the rider on the map and count down minutes. */
export function legProgress(order: Order, now = Date.now()): number {
  const s = secondsIn(order, now);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const status = orderStatus(order, now);
  if (order.status) {
    const leg = (from: number | undefined, to: number | undefined) =>
      from && to && to > from ? clamp((now - from) / (to - from)) : 0.5;
    if (status === "pickedUp") return leg(order.pickedUpAt, order.dueAt);
    if (status === "accepted" || status === "preparing") return leg(order.acceptedAt, order.readyBy);
    return status === "delivered" || status === "collected" || status === "ready" ? 1 : 0;
  }
  if (status === "pickedUp") return clamp((s - TIMELINE.pickedUp) / (TIMELINE.delivered - TIMELINE.pickedUp));
  if (status === "accepted" || status === "preparing")
    return clamp((s - TIMELINE.accepted) / (TIMELINE.pickedUp - TIMELINE.accepted));
  return status === "delivered" ? 1 : 0;
}

/**
 * Minutes until the food arrives (or is ready), in the restaurant's real-world timescale.
 * The demo timeline is compressed, so map overall progress onto the restaurant's quoted window.
 */
export function minutesLeft(order: Order, now = Date.now()): number {
  if (order.status) {
    const due = order.mode === "pickup" ? (order.readyBy ?? order.dueAt) : order.dueAt;
    if (due) return Math.max(1, Math.ceil((due - now) / 60_000));
    const quotedMax = order.mode === "delivery" ? order.restaurant.eta[1] : order.restaurant.eta[0];
    return Math.max(1, Math.ceil((startOf(order) + quotedMax * 60_000 - now) / 60_000));
  }
  const end = order.mode === "delivery" ? TIMELINE.delivered : TIMELINE.ready;
  const s = Math.max(0, secondsIn(order, now));
  const quoted =
    order.mode === "delivery" ? order.restaurant.eta[1] : Math.max(10, order.restaurant.eta[0] - 5);
  return Math.max(1, Math.ceil(quoted * (1 - Math.min(1, s / end))));
}

/** When it arrived or was collected (live: recorded; mock: the end of the demo timeline). */
export function finishedAt(order: Order): number {
  return order.collectedAt ?? order.deliveredAt ?? startOf(order) + TIMELINE.delivered * 1000;
}

/** Clock time like "7:42 pm". */
export function clockTime(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString("en-LK", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
}
