// The order state machine (proto/README.md "Order state machine") as pure functions over the Order
// proto. Each applies one transition in place, appends the timeline entry and returns the events to
// write through the outbox — or [] when the transition does not apply (already done, or the order
// is elsewhere), which makes every caller (workflow activities, consumers, RPCs) idempotent.
import { FulfilmentMode, PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import {
  CancelledBy,
  Fault,
  OrderStatus,
  RejectionReason,
  type Cancellation,
  type Order,
  type OrderRider,
} from "@kade/proto/kade/order/v1/order_service";
import { orderEvents, type OrderEvent } from "./events.js";
import { isFinal } from "./status.js";

const S = OrderStatus;
const MIN = 60_000;

export function addTimeline(order: Order, at: Date, status: OrderStatus, label: string, by = ""): void {
  order.timeline.push({ at, status, label, by });
}

function touch(order: Order, at: Date, status?: OrderStatus): void {
  if (status !== undefined) order.status = status;
  order.updatedAt = at;
}

const isDelivery = (o: Order) => o.mode === FulfilmentMode.FULFILMENT_MODE_DELIVERY;

/** Minutes from kitchen start to arrival (delivery) or to ready (pickup): apps' eta/pickupMinutes. */
export function leadMinutes(order: Order): number {
  const eta = [order.restaurant?.etaMinMinutes ?? 20, order.restaurant?.etaMaxMinutes ?? 30] as const;
  return isDelivery(order) ? eta[1] : Math.max(10, eta[0] - 5);
}

export interface PlacedInput {
  at: Date;
  /** Kitchen start for a scheduled order; undefined = now. */
  releaseAt?: Date;
  acceptTimeoutMs: number;
  paymentId?: string;
  promoReservationId?: string;
}

export function applyPlaced(order: Order, input: PlacedInput): OrderEvent[] {
  if (order.status !== S.ORDER_STATUS_PENDING) return [];
  const { at } = input;
  order.paymentId = input.paymentId ?? order.paymentId;
  if (order.promo && input.promoReservationId) order.promo.reservationId = input.promoReservationId;
  order.placedAt = at;
  if (input.releaseAt && input.releaseAt.getTime() > at.getTime()) {
    touch(order, at, S.ORDER_STATUS_SCHEDULED);
    order.dueAt = order.scheduledFor ?? new Date(input.releaseAt.getTime() + leadMinutes(order) * MIN);
    addTimeline(order, at, S.ORDER_STATUS_SCHEDULED, "Order scheduled");
  } else {
    touch(order, at, S.ORDER_STATUS_PLACED);
    order.acceptBy = new Date(at.getTime() + input.acceptTimeoutMs);
    order.dueAt = order.scheduledFor ?? new Date(at.getTime() + leadMinutes(order) * MIN);
    addTimeline(order, at, S.ORDER_STATUS_PLACED, "Order placed");
  }
  return [orderEvents.placed(order, at)];
}

export function applyReleased(order: Order, at: Date, acceptTimeoutMs: number): OrderEvent[] {
  if (order.status !== S.ORDER_STATUS_SCHEDULED) return [];
  touch(order, at, S.ORDER_STATUS_PLACED);
  order.acceptBy = new Date(at.getTime() + acceptTimeoutMs);
  addTimeline(order, at, S.ORDER_STATUS_PLACED, "Sent to the kitchen");
  return [orderEvents.released(order, at)];
}

export function applyFailed(order: Order, at: Date, reason: string, message: string): OrderEvent[] {
  if (order.status !== S.ORDER_STATUS_PENDING) return [];
  touch(order, at, S.ORDER_STATUS_FAILED);
  order.failureReason = reason;
  order.failureMessage = message;
  addTimeline(order, at, S.ORDER_STATUS_FAILED, `Checkout failed: ${message || reason}`);
  return [orderEvents.failed(order, at)];
}

export interface AcceptedInput {
  at: Date;
  prepMinutes: number;
  readyBy?: Date;
  by?: string;
}

/** PLACED → ACCEPTED (+OrderAccepted) → PREPARING (+OrderPreparing), in one step. */
export function applyAccepted(order: Order, input: AcceptedInput): OrderEvent[] {
  if (order.status !== S.ORDER_STATUS_PLACED) return [];
  const { at } = input;
  const prep = Math.max(0, input.prepMinutes);
  order.acceptedAt = at;
  order.prepMinutes = prep;
  order.readyBy = input.readyBy ?? new Date(at.getTime() + prep * MIN);
  if (!order.scheduledFor) {
    // Promise to the customer: ready + the delivery leg (the restaurant's eta minus its prep part).
    const travel = isDelivery(order) ? Math.max(10, leadMinutes(order) - prep) : 0;
    order.dueAt = new Date(order.readyBy.getTime() + travel * MIN);
  }
  touch(order, at, S.ORDER_STATUS_ACCEPTED);
  addTimeline(order, at, S.ORDER_STATUS_ACCEPTED, `Accepted by the kitchen (${prep} min)`, input.by ?? "");
  const accepted = orderEvents.accepted(order, at);
  touch(order, at, S.ORDER_STATUS_PREPARING);
  addTimeline(order, at, S.ORDER_STATUS_PREPARING, "Preparing");
  return [accepted, orderEvents.preparing(order, at)];
}

export interface RejectedInput {
  at: Date;
  reason: RejectionReason;
  note?: string;
  by?: string;
}

const REJECTION_LABEL: Record<number, string> = {
  [RejectionReason.REJECTION_REASON_TOO_BUSY]: "Too busy",
  [RejectionReason.REJECTION_REASON_SOLD_OUT]: "Sold out",
  [RejectionReason.REJECTION_REASON_CLOSING_SOON]: "Closing soon",
  [RejectionReason.REJECTION_REASON_OTHER]: "Other",
};

export function applyRejected(order: Order, input: RejectedInput): OrderEvent[] {
  if (order.status !== S.ORDER_STATUS_PLACED) return [];
  const { at } = input;
  order.rejection = { reason: input.reason, note: input.note ?? "", at };
  touch(order, at, S.ORDER_STATUS_REJECTED);
  const label =
    input.reason === RejectionReason.REJECTION_REASON_TIMEOUT
      ? "Missed: the kitchen didn't accept in time"
      : `Rejected by the kitchen: ${REJECTION_LABEL[input.reason] ?? "Other"}${input.note ? ` (${input.note})` : ""}`;
  addTimeline(order, at, S.ORDER_STATUS_REJECTED, label, input.by ?? "");
  return [orderEvents.rejected(order, at)];
}

export interface CancelInput {
  at: Date;
  cancelledBy: CancelledBy;
  reason: string;
  fault: Fault;
  by: string;
}

/** Who may cancel from where (CancelOrder rules). */
export function canCancel(status: OrderStatus, cancelledBy: CancelledBy): boolean {
  if (cancelledBy === CancelledBy.CANCELLED_BY_CUSTOMER) {
    return status === S.ORDER_STATUS_SCHEDULED || status === S.ORDER_STATUS_PLACED;
  }
  return !isFinal(status) && status !== S.ORDER_STATUS_PENDING;
}

export function applyCancelled(order: Order, input: CancelInput): OrderEvent[] {
  if (!canCancel(order.status, input.cancelledBy)) return [];
  const { at } = input;
  const previous = order.status;
  const fault =
    input.fault ||
    (input.cancelledBy === CancelledBy.CANCELLED_BY_CUSTOMER
      ? Fault.FAULT_CUSTOMER
      : Fault.FAULT_UNSPECIFIED);
  const cancellation: Cancellation = {
    reason: input.reason,
    fault,
    cancelledBy: input.cancelledBy,
    by: input.by,
    at,
  };
  order.cancellation = cancellation;
  touch(order, at, S.ORDER_STATUS_CANCELLED);
  addTimeline(
    order,
    at,
    S.ORDER_STATUS_CANCELLED,
    `Cancelled${input.reason ? `: ${input.reason}` : ""}`,
    input.by,
  );
  return [orderEvents.cancelled(order, previous, cancellation, at)];
}

export function applyReady(order: Order, at: Date): OrderEvent[] {
  if (order.status !== S.ORDER_STATUS_ACCEPTED && order.status !== S.ORDER_STATUS_PREPARING) return [];
  order.readyAt = at;
  touch(order, at, S.ORDER_STATUS_READY);
  addTimeline(
    order,
    at,
    S.ORDER_STATUS_READY,
    isDelivery(order) ? "Ready for the rider" : "Ready to collect",
  );
  return [orderEvents.ready(order, at)];
}

export function applyRider(
  order: Order,
  at: Date,
  rider: OrderRider | undefined,
  deliveryId: string,
): OrderEvent[] {
  if (isFinal(order.status)) return [];
  const before = order.rider?.riderId ?? "";
  if (deliveryId) order.deliveryId = deliveryId;
  if ((rider?.riderId ?? "") === before) {
    if (rider) order.rider = rider; // refresh display details, no event
    return [];
  }
  order.rider = rider;
  order.updatedAt = at;
  addTimeline(
    order,
    at,
    order.status,
    rider ? `Rider assigned: ${rider.firstName || rider.name}` : "Rider unassigned",
  );
  return [orderEvents.riderChanged(order, at)];
}

export function applyPickedUp(order: Order, at: Date, riderId?: string): OrderEvent[] {
  const from: OrderStatus[] = [S.ORDER_STATUS_ACCEPTED, S.ORDER_STATUS_PREPARING, S.ORDER_STATUS_READY];
  if (!isDelivery(order) || !from.includes(order.status)) return [];
  if (riderId && order.rider?.riderId !== riderId) {
    order.rider = { ...(order.rider ?? emptyRider()), riderId };
  }
  order.pickedUpAt = at;
  touch(order, at, S.ORDER_STATUS_PICKED_UP);
  const name = order.rider?.firstName || order.rider?.name;
  addTimeline(order, at, S.ORDER_STATUS_PICKED_UP, name ? `Picked up by ${name}` : "Picked up by the rider");
  return [orderEvents.pickedUp(order, at)];
}

/** DELIVERED; a missed DeliveryPickedUp is applied first so the timeline stays complete. */
export function applyDelivered(order: Order, at: Date, riderId?: string): OrderEvent[] {
  const events = order.status === S.ORDER_STATUS_PICKED_UP ? [] : applyPickedUp(order, at, riderId);
  if (order.status !== S.ORDER_STATUS_PICKED_UP) return events;
  order.deliveredAt = at;
  touch(order, at, S.ORDER_STATUS_DELIVERED);
  addTimeline(order, at, S.ORDER_STATUS_DELIVERED, "Delivered");
  return [...events, orderEvents.delivered(order, at)];
}

export function applyCollected(order: Order, at: Date, by = ""): OrderEvent[] {
  const from: OrderStatus[] = [S.ORDER_STATUS_ACCEPTED, S.ORDER_STATUS_PREPARING, S.ORDER_STATUS_READY];
  if (isDelivery(order) || !from.includes(order.status)) return [];
  if (!order.readyAt) order.readyAt = at;
  order.collectedAt = at;
  touch(order, at, S.ORDER_STATUS_COLLECTED);
  addTimeline(order, at, S.ORDER_STATUS_COLLECTED, "Collected", by);
  return [orderEvents.collected(order, at)];
}

export const isCash = (o: Order) => o.payment?.kind === PaymentMethodKind.PAYMENT_METHOD_KIND_CASH;

function emptyRider(): OrderRider {
  return {
    riderId: "",
    name: "",
    firstName: "",
    rating: 0,
    vehicle: "",
    plate: "",
    maskedPhone: "",
    phone: "",
  };
}
