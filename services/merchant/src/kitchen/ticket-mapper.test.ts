import { FulfilmentMode, PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import { TicketStatus } from "@kade/proto/kade/merchant/v1/merchant_service";
import { OrderStatus, RejectionReason } from "@kade/proto/kade/order/v1/order_service";
import { order, placedAt } from "../../test/fixtures.js";
import { describe, expect, it } from "vitest";
import { advance, ticketFromOrder, ticketStatusOfOrder, toTicket } from "./ticket-mapper.js";
import type { TicketRow } from "./tickets.repository.js";

function row(over: Partial<TicketRow> = {}): TicketRow {
  return { ...(ticketFromOrder(order(), "new", placedAt) as TicketRow), ...over } as TicketRow;
}

describe("ticketStatusOfOrder", () => {
  it.each([
    [OrderStatus.ORDER_STATUS_PLACED, "new"],
    [OrderStatus.ORDER_STATUS_ACCEPTED, "preparing"],
    [OrderStatus.ORDER_STATUS_PREPARING, "preparing"],
    [OrderStatus.ORDER_STATUS_READY, "ready"],
    [OrderStatus.ORDER_STATUS_PICKED_UP, "picked_up"],
    [OrderStatus.ORDER_STATUS_DELIVERED, "picked_up"],
    [OrderStatus.ORDER_STATUS_COLLECTED, "picked_up"],
    [OrderStatus.ORDER_STATUS_CANCELLED, "cancelled"],
    [OrderStatus.ORDER_STATUS_PENDING, undefined],
    [OrderStatus.ORDER_STATUS_SCHEDULED, undefined],
    [OrderStatus.ORDER_STATUS_FAILED, undefined],
  ])("maps %s to %s", (status, expected) => {
    expect(ticketStatusOfOrder({ status, rejection: undefined })).toBe(expected);
  });

  it("tells missed (timeout) from rejected", () => {
    const rejected = OrderStatus.ORDER_STATUS_REJECTED;
    expect(
      ticketStatusOfOrder({
        status: rejected,
        rejection: { reason: RejectionReason.REJECTION_REASON_TIMEOUT, note: "" },
      }),
    ).toBe("missed");
    expect(
      ticketStatusOfOrder({
        status: rejected,
        rejection: { reason: RejectionReason.REJECTION_REASON_TOO_BUSY, note: "" },
      }),
    ).toBe("rejected");
  });
});

describe("ticketFromOrder / toTicket", () => {
  it("projects what the kitchen needs, first name only, ticket number from the order number", () => {
    const t = toTicket(row());
    expect(t).toMatchObject({
      orderNumber: "KD-4821",
      ticketNumber: "4821",
      outletId: "00000000-0000-7000-8000-000000000001",
      status: TicketStatus.TICKET_STATUS_NEW,
      mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
      customerFirstName: "Dilini",
      repeatCount: 3,
      kitchenNote: "Pack the gravy separately",
      cutlery: true,
      payment: PaymentMethodKind.PAYMENT_METHOD_KIND_CASH,
      subtotal: { amountMinor: 230_000, currency: "LKR" },
      acceptBy: new Date(placedAt.getTime() + 180_000),
    });
    expect(t.lines).toEqual([
      {
        itemId: "1-1-0",
        name: "Chicken kottu",
        quantity: 2,
        choiceNames: ["Sri Lankan hot"],
        note: "No leeks please",
        unitPrice: { amountMinor: 115_000, currency: "LKR" },
      },
    ]);
  });

  it("defaults accept_by to placed_at + 3 minutes", () => {
    const t = ticketFromOrder(order({ acceptBy: undefined }), "new", placedAt);
    expect(t.acceptBy).toEqual(new Date(placedAt.getTime() + 180_000));
  });
});

describe("advance", () => {
  it("moves forward", () => {
    expect(advance(row(), { status: "preparing", prepMinutes: 15 })).toEqual({
      status: "preparing",
      prepMinutes: 15,
    });
    expect(advance(row({ status: "preparing" }), { status: "ready" })).toEqual({ status: "ready" });
  });

  it("never moves backwards (late or replayed events)", () => {
    expect(advance(row({ status: "ready" }), { status: "preparing" })).toBeUndefined();
    expect(advance(row({ status: "picked_up" }), { status: "ready" })).toBeUndefined();
  });

  it("lets order's final word replace ours (missed → cancelled), and a late timeout beat our accept", () => {
    expect(advance(row({ status: "missed" }), { status: "cancelled" })).toEqual({ status: "cancelled" });
    expect(advance(row({ status: "preparing" }), { status: "missed" })).toEqual({ status: "missed" });
  });

  it("same status only fills gaps", () => {
    const at = new Date();
    const current = row({ status: "preparing", prepMinutes: 25, readyBy: null });
    expect(advance(current, { status: "preparing", prepMinutes: 15, readyBy: at })).toEqual({ readyBy: at });
    expect(
      advance(row({ status: "preparing", prepMinutes: 25, readyBy: at }), {
        status: "preparing",
        prepMinutes: 15,
      }),
    ).toBeUndefined();
  });
});
