import { PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import type { Ticket } from "@kade/proto/kade/merchant/v1/merchant_service";
import {
  OrderStatus,
  RejectionReason,
  type Order,
  type OrderRider,
} from "@kade/proto/kade/order/v1/order_service";
import type { TicketLineJson, TicketRiderJson } from "../db/schema.js";
import {
  fulfilmentMode,
  paymentKind,
  rejectReason,
  ticketRank,
  ticketStatus,
  type RejectReasonDb,
  type TicketStatusDb,
} from "../domain/enums.js";
import { ACCEPT_WINDOW_MS, firstName, ticketNumberOf } from "../domain/values.js";
import type { NewTicket, TicketPatch, TicketRow } from "./tickets.repository.js";

export function toTicket(row: TicketRow): Ticket {
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    ticketNumber: row.ticketNumber,
    outletId: row.outletId,
    status: ticketStatus.toProto(row.status),
    mode: fulfilmentMode.toProto(row.mode),
    customerFirstName: row.customerFirstName,
    repeatCount: row.repeatCount,
    lines: row.lines.map((l) => ({
      itemId: l.itemId,
      name: l.name,
      quantity: l.quantity,
      choiceNames: l.choiceNames,
      note: l.note,
      unitPrice: { amountMinor: l.unitPriceMinor, currency: "LKR" },
    })),
    kitchenNote: row.kitchenNote,
    cutlery: row.cutlery,
    payment: paymentKind.toProto(row.payment),
    subtotal: { amountMinor: row.subtotalMinor, currency: "LKR" },
    scheduledFor: row.scheduledFor ?? undefined,
    placedAt: row.placedAt,
    acceptBy: row.acceptBy,
    acceptedAt: row.acceptedAt ?? undefined,
    prepMinutes: row.prepMinutes,
    readyBy: row.readyBy ?? undefined,
    readyAt: row.readyAt ?? undefined,
    pickedUpAt: row.pickedUpAt ?? undefined,
    closedAt: row.closedAt ?? undefined,
    rejectReason: rejectReason.toProto(row.rejectReason),
    rejectNote: row.rejectNote,
    rider: row.rider
      ? {
          riderId: row.rider.riderId,
          name: row.rider.name,
          vehicle: row.rider.vehicle,
          plate: row.rider.plate,
          maskedPhone: row.rider.maskedPhone,
        }
      : undefined,
    riderArrivesAt: row.riderArrivesAt ?? undefined,
    riderAtCounter: row.riderAtCounter,
  };
}

/** order.OrderStatus → ticket status (proto/README "Order state machine"); undefined = no ticket yet/ever. */
export function ticketStatusOfOrder(order: Pick<Order, "status" | "rejection">): TicketStatusDb | undefined {
  switch (order.status) {
    case OrderStatus.ORDER_STATUS_PLACED:
      return "new";
    case OrderStatus.ORDER_STATUS_ACCEPTED:
    case OrderStatus.ORDER_STATUS_PREPARING:
      return "preparing";
    case OrderStatus.ORDER_STATUS_READY:
      return "ready";
    case OrderStatus.ORDER_STATUS_PICKED_UP:
    case OrderStatus.ORDER_STATUS_DELIVERED:
    case OrderStatus.ORDER_STATUS_COLLECTED:
      return "picked_up";
    case OrderStatus.ORDER_STATUS_REJECTED:
      return order.rejection?.reason === RejectionReason.REJECTION_REASON_TIMEOUT ? "missed" : "rejected";
    case OrderStatus.ORDER_STATUS_CANCELLED:
      return "cancelled";
    default:
      return undefined; // PENDING, SCHEDULED, FAILED: not the kitchen's business (yet)
  }
}

export function riderJson(rider: OrderRider | undefined): TicketRiderJson | null {
  if (!rider?.riderId) return null;
  return {
    riderId: rider.riderId,
    name: rider.firstName || firstName(rider.name) || rider.name,
    vehicle: rider.vehicle,
    plate: rider.plate,
    maskedPhone: rider.maskedPhone,
  };
}

/** A new ticket row from an order snapshot (OrderPlaced, OrderReleasedToKitchen, or any snapshot event). */
export function ticketFromOrder(order: Order, status: TicketStatusDb, occurredAt: Date): NewTicket {
  const placedAt = order.placedAt ?? occurredAt;
  const acceptBy = order.acceptBy ?? new Date(placedAt.getTime() + ACCEPT_WINDOW_MS);
  const lines: TicketLineJson[] = order.lines.map((l) => ({
    itemId: l.itemId,
    name: l.name,
    quantity: l.quantity,
    choiceNames: [...l.choiceNames],
    note: l.note,
    unitPriceMinor: l.unitPrice?.amountMinor ?? 0,
  }));
  const subtotal =
    order.totals?.subtotal?.amountMinor ?? lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0);
  const row: NewTicket = {
    orderId: order.id,
    outletId: order.restaurant?.id ?? "",
    source: "order",
    orderNumber: order.orderNumber,
    ticketNumber: ticketNumberOf(order.orderNumber, order.id),
    status: "new",
    mode: fulfilmentMode.toDb(order.mode) ?? "delivery",
    customerId: order.customer?.id ?? "",
    customerFirstName: firstName(order.customer?.name),
    repeatCount: order.customerRepeatCount,
    lines,
    kitchenNote: order.kitchenNote,
    cutlery: order.cutlery,
    payment:
      paymentKind.toDb(order.payment?.kind ?? PaymentMethodKind.PAYMENT_METHOD_KIND_UNSPECIFIED) ?? "card",
    subtotalMinor: subtotal,
    scheduledFor: order.scheduledFor ?? null,
    placedAt,
    acceptBy,
    deliveryId: order.deliveryId || null,
    rider: riderJson(order.rider),
  };
  return { ...row, ...progressFromOrder(order, status, occurredAt) };
}

/** Fields an order snapshot tells us about the kitchen's progress (for a ticket at `status`). */
export function progressFromOrder(order: Order, status: TicketStatusDb, occurredAt: Date): TicketPatch {
  const patch: TicketPatch = { status };
  if (order.acceptedAt) patch.acceptedAt = order.acceptedAt;
  if (order.prepMinutes) patch.prepMinutes = order.prepMinutes;
  if (order.readyBy) patch.readyBy = order.readyBy;
  if (order.readyAt) patch.readyAt = order.readyAt;
  const handedAt = order.pickedUpAt ?? order.collectedAt ?? order.deliveredAt;
  if (status === "picked_up") {
    patch.pickedUpAt = handedAt ?? occurredAt;
    patch.closedAt = handedAt ?? occurredAt;
  }
  if (status === "missed" || status === "rejected") {
    patch.closedAt = order.rejection?.at ?? occurredAt;
    patch.rejectReason = (rejectReason.toDb(order.rejection?.reason ?? 0) ??
      (status === "missed" ? "timeout" : "other")) as RejectReasonDb;
    patch.rejectNote = order.rejection?.note ?? "";
  }
  if (status === "cancelled") patch.closedAt = order.cancellation?.at ?? occurredAt;
  return patch;
}

/**
 * Applies an observed status to a ticket without ever moving it backwards. Same rank: only fills in
 * fields we don't have yet. Final → different final is allowed (order is the authority, e.g. our
 * local "missed" becomes "cancelled"). Returns undefined when nothing changes.
 */
export function advance(current: TicketRow, patch: TicketPatch): TicketPatch | undefined {
  const next = patch.status as TicketStatusDb | undefined;
  const cur = current.status as TicketStatusDb;
  if (next && next !== cur) {
    const forward = ticketRank(next) > ticketRank(cur);
    const finalSwap = ticketRank(next) === 3 && ticketRank(cur) === 3;
    if (forward || finalSwap) return patch;
    return undefined;
  }
  // Same status (or no status): fill gaps only.
  const fill: TicketPatch = {};
  for (const [k, v] of Object.entries(patch) as [keyof TicketPatch, unknown][]) {
    if (k === "status" || v === undefined) continue;
    const have = current[k as keyof TicketRow];
    if (have === null || have === undefined || have === 0 || have === "")
      (fill as Record<string, unknown>)[k] = v;
  }
  return Object.keys(fill).length ? fill : undefined;
}
