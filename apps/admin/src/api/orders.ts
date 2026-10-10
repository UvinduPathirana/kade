// Orders API. Later: the order service (GET /orders, POST /orders/:id/cancel, /refunds, /notes) and the
// dispatch service for reassigning riders.
import { formatRs } from "@kade/ui";
import { ApiError, audit, find, ME, respond, simNow } from "./client";
import { MIN } from "./mock/clock";
import { holdOrder, isFinal, orders, refunds, resumeOrder, restaurantById, simulate } from "./mock/orders";
import { customers, riders } from "./mock/partners";
import { zones } from "./mock/zones";
import type { Fault, Order, RefundMethod, Rider } from "./types";

export interface Party {
  id: string;
  name: string;
  phone: string;
}

export interface OrderView extends Order {
  restaurant: Party & { area: string };
  customer: Party & { email: string };
  rider?: Party;
  zone: { code: string; name: string };
  /** Minutes past the promised time while still active; 0 otherwise. */
  lateMin: number;
}

export function lateMinutes(o: Order, now = simNow()): number {
  if (isFinal(o.status)) return 0;
  return Math.max(0, Math.floor((now - o.dueAt) / MIN));
}

export function toView(o: Order, now = simNow()): OrderView {
  const r = restaurantById(o.restaurantId);
  const c = customers.find((x) => x.id === o.customerId)!;
  const rider = riders.find((x) => x.id === o.riderId);
  const zone = zones.find((z) => z.id === o.zoneId)!;
  return {
    ...o,
    restaurant: { id: String(r.id), name: r.name, phone: r.phone, area: r.area },
    customer: { id: c.id, name: c.name, phone: c.phone, email: c.email },
    rider: rider && { id: rider.id, name: rider.name, phone: rider.phone },
    zone: { code: zone.code, name: zone.name },
    lateMin: lateMinutes(o, now),
  };
}

export async function listOrders(): Promise<OrderView[]> {
  simulate();
  const now = simNow();
  return respond(
    orders
      .slice()
      .sort((a, b) => b.placedAt - a.placedAt)
      .map((o) => toView(o, now)),
  );
}

export async function getOrder(id: string): Promise<OrderView> {
  simulate();
  return respond(toView(find(orders, (o) => o.id === id, `Order ${id}`)));
}

export interface NearbyRider {
  id: string;
  name: string;
  vehicle: Rider["vehicle"];
  status: Rider["status"];
  zoneCode: string;
  /** Straight-line estimate from the restaurant. */
  km: number;
  cashHeld: number;
  rating: number;
}

const zoneIndex = (id: string) => zones.findIndex((z) => z.id === id);

export async function listNearbyRiders(orderId: string): Promise<NearbyRider[]> {
  const o = find(orders, (x) => x.id === orderId, `Order ${orderId}`);
  const from = zoneIndex(restaurantById(o.restaurantId).zoneId);
  return respond(
    riders
      .filter((r) => (r.status === "online" || r.status === "onJob") && r.id !== o.riderId)
      .map((r) => ({
        id: r.id,
        name: r.name,
        vehicle: r.vehicle,
        status: r.status,
        zoneCode: zones[zoneIndex(r.pos.zoneId)]!.code,
        km: Math.round((Math.abs(zoneIndex(r.pos.zoneId) - from) * 0.9 + r.pos.x * 0.8 + 0.3) * 10) / 10,
        cashHeld: r.cashHeld,
        rating: r.rating,
      }))
      .sort((a, b) => Number(a.status === "onJob") - Number(b.status === "onJob") || a.km - b.km)
      .slice(0, 8),
  );
}

async function mutate(id: string, fn: (o: Order) => void, action: string, detail?: string) {
  const o = find(orders, (x) => x.id === id, `Order ${id}`);
  fn(o);
  audit({ action, recordType: "order", recordId: id, detail });
  return respond(toView(o));
}

export async function reassignRider({
  orderId,
  riderId,
  reason,
}: {
  orderId: string;
  riderId: string;
  reason: string;
}) {
  const rider = find(riders, (r) => r.id === riderId, "Rider");
  return mutate(
    orderId,
    (o) => {
      if (isFinal(o.status)) throw new ApiError("This order is finished, so its rider can't change.");
      o.riderId = rider.id;
      rider.status = "onJob";
      o.timeline.push({ at: simNow(), label: `${rider.name} assigned by ops: ${reason}`, by: ME.name });
      // The new rider has to collect it again
      if (o.status === "pickedUp") o.status = "ready";
      resumeOrder(o, simNow());
    },
    `Assigned ${rider.name}`,
    reason,
  );
}

export async function refundOrder({
  orderId,
  amount,
  method,
  reason,
}: {
  orderId: string;
  amount: number;
  method: RefundMethod;
  reason: string;
}) {
  return mutate(
    orderId,
    (o) => {
      const left = o.total - o.refunded;
      if (amount <= 0 || amount > left)
        throw new ApiError(`Refund between Rs 1 and ${formatRs(left)}, the amount not yet refunded.`);
      if (method === "card" && o.payment !== "card")
        throw new ApiError("This order was paid in cash. Refund it as Kadé credit.");
      o.refunded += amount;
      const at = simNow();
      const to = method === "card" ? `card ending ${o.cardLast4}` : "Kadé credit";
      o.timeline.push({ at, label: `Refunded ${formatRs(amount)} to ${to}: ${reason}`, by: ME.name });
      refunds.unshift({
        id: `RF-${7200 + refunds.length}`,
        at,
        orderId: o.id,
        customerId: o.customerId,
        amount,
        method,
        reason,
        by: ME.name,
      });
      if (method === "credit") {
        const c = customers.find((x) => x.id === o.customerId);
        if (c) {
          c.credit += amount;
          c.creditHistory.unshift({
            id: `CH-${c.creditHistory.length + 1}`,
            at,
            amount,
            reason: `Refund on ${o.id}: ${reason}`,
            by: ME.name,
          });
        }
      }
    },
    `Refunded ${formatRs(amount)} to ${method === "card" ? "card" : "Kadé credit"}`,
    reason,
  );
}

export const faultLabels: Record<Fault, string> = {
  customer: "Customer",
  restaurant: "Restaurant",
  rider: "Rider",
  kade: "Kadé",
};

export async function cancelOrder({
  orderId,
  reason,
  fault,
  refund,
}: {
  orderId: string;
  reason: string;
  fault: Fault;
  refund: boolean;
}) {
  return mutate(
    orderId,
    (o) => {
      if (isFinal(o.status)) throw new ApiError("This order is already finished and can't be cancelled.");
      holdOrder(o.id);
      const at = simNow();
      o.status = "cancelled";
      o.cancel = { reason, fault, by: ME.name };
      o.timeline.push({ at, label: `Cancelled: ${reason} (${faultLabels[fault]} at fault)`, by: ME.name });
      if (refund && o.payment === "card" && o.refunded < o.total) {
        const amount = o.total - o.refunded;
        o.refunded = o.total;
        o.timeline.push({
          at,
          label: `Refunded ${formatRs(amount)} to card ending ${o.cardLast4}`,
          by: ME.name,
        });
        refunds.unshift({
          id: `RF-${7200 + refunds.length}`,
          at,
          orderId: o.id,
          customerId: o.customerId,
          amount,
          method: "card",
          reason: `Cancelled: ${reason}`,
          by: ME.name,
        });
      }
      const rider = riders.find((r) => r.id === o.riderId);
      if (rider?.status === "onJob") rider.status = "online";
    },
    "Cancelled order",
    `${reason}. ${faultLabels[fault]} at fault.`,
  );
}

export async function addOrderNote({ orderId, body }: { orderId: string; body: string }) {
  return mutate(
    orderId,
    (o) => {
      o.notes.push({ id: `N-${o.notes.length + 1}`, at: simNow(), author: ME.name, body });
    },
    "Added internal note",
    body.length > 60 ? `${body.slice(0, 60)}…` : body,
  );
}
