import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import {
  CancelledBy,
  Fault,
  OrderStatus as S,
  RejectionReason,
} from "@kade/proto/kade/order/v1/order_service";
import { describe, expect, it } from "vitest";
import { order } from "./fixtures.test-util.js";
import {
  applyAccepted,
  applyCancelled,
  applyCollected,
  applyDelivered,
  applyFailed,
  applyPickedUp,
  applyPlaced,
  applyReady,
  applyRejected,
  applyReleased,
  applyRider,
  canCancel,
} from "./transitions.js";

const at = new Date("2026-10-12T12:01:00Z");
const types = (events: { type: string }[]) => events.map((e) => e.type.replace("kade.order.v1.", ""));

describe("order transitions", () => {
  it("PENDING → PLACED with accept_by = now + accept window, and OrderPlaced", () => {
    const o = order();
    const events = applyPlaced(o, { at, acceptTimeoutMs: 180_000, paymentId: "pay-1" });
    expect(o.status).toBe(S.ORDER_STATUS_PLACED);
    expect(o.acceptBy).toEqual(new Date(at.getTime() + 180_000));
    expect(o.paymentId).toBe("pay-1");
    expect(o.dueAt).toEqual(new Date(at.getTime() + 25 * 60_000));
    expect(types(events)).toEqual(["OrderPlaced"]);
    expect(applyPlaced(o, { at, acceptTimeoutMs: 1 })).toEqual([]); // idempotent
  });

  it("future kitchen start → SCHEDULED, then released to PLACED with OrderReleasedToKitchen", () => {
    const o = order();
    o.scheduledFor = new Date("2026-10-12T19:00:00Z");
    applyPlaced(o, { at, acceptTimeoutMs: 180_000, releaseAt: new Date("2026-10-12T18:35:00Z") });
    expect(o.status).toBe(S.ORDER_STATUS_SCHEDULED);
    expect(o.acceptBy).toBeUndefined();
    const later = new Date("2026-10-12T18:35:00Z");
    expect(types(applyReleased(o, later, 180_000))).toEqual(["OrderReleasedToKitchen"]);
    expect(o.status).toBe(S.ORDER_STATUS_PLACED);
    expect(o.acceptBy).toEqual(new Date(later.getTime() + 180_000));
  });

  it("accept emits OrderAccepted then OrderPreparing and lands in PREPARING", () => {
    const o = order(S.ORDER_STATUS_PLACED);
    const events = applyAccepted(o, { at, prepMinutes: 15 });
    expect(types(events)).toEqual(["OrderAccepted", "OrderPreparing"]);
    expect(o.status).toBe(S.ORDER_STATUS_PREPARING);
    expect(o.readyBy).toEqual(new Date(at.getTime() + 15 * 60_000));
    expect(o.timeline.map((t) => t.label)).toContain("Accepted by the kitchen (15 min)");
    expect(applyAccepted(o, { at, prepMinutes: 15 })).toEqual([]);
  });

  it("reject and timeout record the rejection", () => {
    const o = order(S.ORDER_STATUS_PLACED);
    expect(types(applyRejected(o, { at, reason: RejectionReason.REJECTION_REASON_TIMEOUT }))).toEqual([
      "OrderRejected",
    ]);
    expect(o.rejection?.reason).toBe(RejectionReason.REJECTION_REASON_TIMEOUT);
    expect(o.timeline.at(-1)?.label).toMatch(/Missed/);
    expect(applyRejected(order(S.ORDER_STATUS_PREPARING), { at, reason: 1 })).toEqual([]);
  });

  it("customers cancel only SCHEDULED/PLACED; ops any non-final", () => {
    expect(canCancel(S.ORDER_STATUS_PLACED, CancelledBy.CANCELLED_BY_CUSTOMER)).toBe(true);
    expect(canCancel(S.ORDER_STATUS_PREPARING, CancelledBy.CANCELLED_BY_CUSTOMER)).toBe(false);
    expect(canCancel(S.ORDER_STATUS_PICKED_UP, CancelledBy.CANCELLED_BY_OPS)).toBe(true);
    expect(canCancel(S.ORDER_STATUS_DELIVERED, CancelledBy.CANCELLED_BY_OPS)).toBe(false);
    expect(canCancel(S.ORDER_STATUS_PENDING, CancelledBy.CANCELLED_BY_OPS)).toBe(false);
    const o = order(S.ORDER_STATUS_PLACED);
    const events = applyCancelled(o, {
      at,
      cancelledBy: CancelledBy.CANCELLED_BY_CUSTOMER,
      reason: "Changed my mind",
      fault: Fault.FAULT_UNSPECIFIED,
      by: "Dilini",
    });
    expect(types(events)).toEqual(["OrderCancelled"]);
    expect(o.cancellation).toMatchObject({ fault: Fault.FAULT_CUSTOMER, by: "Dilini" });
  });

  it("delivery: ready → picked up → delivered; a missed pickup is filled in", () => {
    const o = order(S.ORDER_STATUS_PREPARING);
    expect(types(applyReady(o, at))).toEqual(["OrderReady"]);
    expect(types(applyPickedUp(o, at, "rider-1"))).toEqual(["OrderPickedUp"]);
    expect(types(applyDelivered(o, at))).toEqual(["OrderDelivered"]);
    expect(o.status).toBe(S.ORDER_STATUS_DELIVERED);

    const skipped = order(S.ORDER_STATUS_PREPARING);
    expect(types(applyDelivered(skipped, at, "rider-2"))).toEqual(["OrderPickedUp", "OrderDelivered"]);
    expect(skipped.rider?.riderId).toBe("rider-2");
  });

  it("pickup orders collect, delivery orders don't", () => {
    const pickup = order(S.ORDER_STATUS_READY, { mode: FulfilmentMode.FULFILMENT_MODE_PICKUP });
    expect(types(applyCollected(pickup, at))).toEqual(["OrderCollected"]);
    expect(applyCollected(order(S.ORDER_STATUS_READY), at)).toEqual([]);
    expect(
      applyPickedUp(order(S.ORDER_STATUS_READY, { mode: FulfilmentMode.FULFILMENT_MODE_PICKUP }), at),
    ).toEqual([]);
  });

  it("rider changes emit OrderRiderChanged only when the rider changes", () => {
    const o = order(S.ORDER_STATUS_PREPARING);
    const rider = {
      riderId: "r1",
      name: "Nimal Perera",
      firstName: "Nimal",
      rating: 4.9,
      vehicle: "Bajaj Pulsar",
      plate: "WP BCD-4521",
      maskedPhone: "",
      phone: "",
    };
    expect(types(applyRider(o, at, rider, "del-1"))).toEqual(["OrderRiderChanged"]);
    expect(applyRider(o, at, rider, "del-1")).toEqual([]);
    expect(types(applyRider(o, at, undefined, ""))).toEqual(["OrderRiderChanged"]);
    expect(o.deliveryId).toBe("del-1");
  });

  it("failed only from PENDING", () => {
    const o = order();
    expect(types(applyFailed(o, at, "PAYMENT_DECLINED", "declined"))).toEqual(["OrderFailed"]);
    expect(o).toMatchObject({ status: S.ORDER_STATUS_FAILED, failureReason: "PAYMENT_DECLINED" });
    expect(applyFailed(order(S.ORDER_STATUS_PLACED), at, "X", "")).toEqual([]);
  });
});
