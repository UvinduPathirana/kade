// order.v1 → the console's OrderView (apps/admin/src/api/orders.ts).
import { PaymentMethodKind, RefundMethod as ProtoRefundMethod } from "@kade/proto/kade/common/v1/commerce";
import {
  Fault as ProtoFault,
  OrderStatus,
  type Order,
  type Refund as ProtoRefund,
} from "@kade/proto/kade/order/v1/order_service";
import type { Zone as PricingZone } from "@kade/proto/kade/pricing/v1/pricing_service";
import { personId, restaurantNumber } from "../ids.js";
import { ms, msOpt, nonEmpty, rs, zonePosition } from "../lib.js";
import type { OrderView, Refund } from "../schemas.js";

type AppStatus = OrderView["status"];
type AppFault = NonNullable<OrderView["cancel"]>["fault"];

export const ORDER_STATUS: Record<OrderStatus, AppStatus> = {
  [OrderStatus.ORDER_STATUS_UNSPECIFIED]: "placed",
  [OrderStatus.ORDER_STATUS_PENDING]: "placed",
  [OrderStatus.ORDER_STATUS_SCHEDULED]: "placed",
  [OrderStatus.ORDER_STATUS_PLACED]: "placed",
  [OrderStatus.ORDER_STATUS_ACCEPTED]: "accepted",
  [OrderStatus.ORDER_STATUS_PREPARING]: "preparing",
  [OrderStatus.ORDER_STATUS_READY]: "ready",
  [OrderStatus.ORDER_STATUS_PICKED_UP]: "pickedUp",
  [OrderStatus.ORDER_STATUS_DELIVERED]: "delivered",
  [OrderStatus.ORDER_STATUS_COLLECTED]: "delivered",
  [OrderStatus.ORDER_STATUS_CANCELLED]: "cancelled",
  [OrderStatus.ORDER_STATUS_REJECTED]: "rejected",
  [OrderStatus.ORDER_STATUS_FAILED]: "cancelled",
  [OrderStatus.UNRECOGNIZED]: "placed",
};

/** Orders ops never sees: the checkout saga is still running, or it failed before placing. */
export const isHidden = (o: Order) =>
  o.status === OrderStatus.ORDER_STATUS_PENDING || o.status === OrderStatus.ORDER_STATUS_FAILED;

export const FINAL: AppStatus[] = ["delivered", "cancelled", "rejected"];
export const isFinal = (s: AppStatus) => FINAL.includes(s);

export const FAULT_FROM_PROTO: Record<number, AppFault> = {
  [ProtoFault.FAULT_CUSTOMER]: "customer",
  [ProtoFault.FAULT_RESTAURANT]: "restaurant",
  [ProtoFault.FAULT_RIDER]: "rider",
  [ProtoFault.FAULT_KADE]: "kade",
};
export const FAULT_TO_PROTO: Record<AppFault, ProtoFault> = {
  customer: ProtoFault.FAULT_CUSTOMER,
  restaurant: ProtoFault.FAULT_RESTAURANT,
  rider: ProtoFault.FAULT_RIDER,
  kade: ProtoFault.FAULT_KADE,
};
export const FAULT_LABELS: Record<AppFault, string> = {
  customer: "Customer",
  restaurant: "Restaurant",
  rider: "Rider",
  kade: "Kadé",
};

export const REFUND_METHOD_TO_PROTO = {
  card: ProtoRefundMethod.REFUND_METHOD_CARD,
  credit: ProtoRefundMethod.REFUND_METHOD_CREDIT,
} as const;
export const refundMethod = (m: ProtoRefundMethod): "card" | "credit" =>
  m === ProtoRefundMethod.REFUND_METHOD_CARD ? "card" : "credit";

export function lateMinutes(status: AppStatus, dueAt: number, now: number): number {
  if (isFinal(status) || !dueAt) return 0;
  return Math.max(0, Math.floor((now - dueAt) / 60_000));
}

/** Console order id: the order number ("KD-4821"); falls back to the UUID if a service omits it. */
export const orderRef = (o: { id: string; orderNumber: string }) => o.orderNumber || o.id;

export function toOrderView(o: Order, zones: PricingZone[], now = Date.now(), email = ""): OrderView {
  const status = ORDER_STATUS[o.status] ?? "placed";
  const zoneId = o.zoneId || o.address?.zoneId || o.restaurant?.zoneId || "";
  const zone = zones.find((z) => z.id === zoneId);
  const t = o.totals;
  const dueAt = ms(o.dueAt);
  const cardLast4 = o.payment?.kind === PaymentMethodKind.PAYMENT_METHOD_KIND_CARD ? o.payment.cardLast4 : "";
  const rider = o.rider?.riderId ? o.rider : undefined;
  const id = orderRef(o);
  return {
    id,
    placedAt: ms(o.placedAt ?? o.createdAt),
    status,
    customerId: personId(o.customer?.id),
    restaurantId: restaurantNumber(o.restaurant?.id ?? ""),
    riderId: rider ? personId(rider.riderId) : undefined,
    zoneId,
    address: o.address?.line || (o.restaurant ? `Pickup at ${o.restaurant.name}` : ""),
    payment: o.payment?.kind === PaymentMethodKind.PAYMENT_METHOD_KIND_CASH ? "cash" : "card",
    cardLast4: nonEmpty(cardLast4),
    lines: o.lines.map((l) => ({
      name: l.choiceNames.length ? `${l.name} (${l.choiceNames.join(", ")})` : l.name,
      qty: l.quantity,
      price: rs(l.unitPrice),
    })),
    subtotal: rs(t?.subtotal),
    deliveryFee: rs(t?.deliveryFee) + rs(t?.smallOrderFee),
    discount: rs(t?.saving) + rs(t?.promoDiscount),
    promoCode: nonEmpty(o.promo?.code),
    total: rs(t?.total),
    dueAt,
    deliveredAt: msOpt(o.deliveredAt ?? o.collectedAt),
    distanceKm: Math.round(o.distanceKm * 10) / 10,
    timeline: o.timeline.map((e) => ({ at: ms(e.at), label: e.label, by: nonEmpty(e.by) })),
    notes: o.notes.map((n) => ({ id: n.id, at: ms(n.at), author: n.author, body: n.body })),
    refunded: rs(o.refunded),
    cancel: o.cancellation
      ? {
          reason: o.cancellation.reason,
          fault: FAULT_FROM_PROTO[o.cancellation.fault] ?? "kade",
          by: o.cancellation.by || "Kadé",
        }
      : undefined,
    pos: zonePosition(zone, o.address?.location, id),
    restaurant: {
      id: String(restaurantNumber(o.restaurant?.id ?? "")),
      name: o.restaurant?.name ?? "",
      phone: o.restaurant?.phone ?? "",
      area: o.restaurant?.area ?? "",
    },
    customer: {
      id: personId(o.customer?.id),
      name: o.customer?.name ?? "",
      phone: o.customer?.phone ?? "",
      email,
    },
    rider: rider ? { id: personId(rider.riderId), name: rider.name, phone: rider.phone } : undefined,
    zone: { code: zone?.code ?? zoneId, name: zone?.name ?? "" },
    lateMin: lateMinutes(status, dueAt, now),
  };
}

export function toRefund(r: ProtoRefund): Refund {
  return {
    id: r.id,
    at: ms(r.at),
    orderId: r.orderNumber || r.orderId,
    customerId: personId(r.customerId),
    amount: rs(r.amount),
    method: refundMethod(r.method),
    reason: r.reason,
    by: r.by || "Kadé",
  };
}
