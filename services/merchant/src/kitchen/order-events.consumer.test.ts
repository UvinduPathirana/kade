import { OrderStatus } from "@kade/proto/kade/order/v1/order_service";
import { describe, expect, it, vi } from "vitest";
import { order } from "../../test/fixtures.js";
import { eventHandlersOf, type EventContext } from "../platform/kafka/event-handler.js";
import { ORDER_EVENTS, OrderEventsConsumer } from "./order-events.consumer.js";
import type { TicketProjector } from "./ticket-projector.js";

function setup() {
  const projector = {
    fromSnapshot: vi.fn(async () => undefined),
    progress: vi.fn(async () => undefined),
    rider: vi.fn(),
  };
  return {
    projector,
    consumer: new OrderEventsConsumer(projector as unknown as TicketProjector),
    ctx: { tx: {} } as EventContext,
  };
}

describe("OrderEventsConsumer", () => {
  it("handles every order event the kitchen cares about", () => {
    const { consumer } = setup();
    expect(
      eventHandlersOf(consumer)
        .map((h) => h.eventType)
        .sort(),
    ).toEqual(Object.values(ORDER_EVENTS).sort());
  });

  it("creates tickets for PLACED orders only; scheduled ones wait for release", async () => {
    const { consumer, projector, ctx } = setup();
    await consumer.placed(
      { orderId: "o", order: order({ status: OrderStatus.ORDER_STATUS_SCHEDULED }), occurredAt: new Date() },
      ctx,
    );
    expect(projector.fromSnapshot).not.toHaveBeenCalled();
    await consumer.placed({ orderId: "o", order: order(), occurredAt: new Date() }, ctx);
    expect(projector.fromSnapshot).toHaveBeenCalledTimes(1);
  });

  it("starts the accept window at release when the order has none", async () => {
    const { consumer, projector, ctx } = setup();
    const at = new Date("2026-10-12T20:00:00Z");
    await consumer.released(
      {
        orderId: "o",
        order: order({ status: OrderStatus.ORDER_STATUS_SCHEDULED, acceptBy: undefined }),
        occurredAt: at,
      },
      ctx,
    );
    const [, released, , status] = projector.fromSnapshot.mock.calls[0] as unknown as [
      unknown,
      { acceptBy: Date },
      Date,
      string,
    ];
    expect(released.acceptBy).toEqual(new Date(at.getTime() + 180_000));
    expect(status).toBe("new");
  });

  it("does not create tickets for cancelled orders that never reached the kitchen", async () => {
    const { consumer, projector, ctx } = setup();
    await consumer.cancelled(
      {
        orderId: "o",
        order: order({ status: OrderStatus.ORDER_STATUS_CANCELLED }),
        previousStatus: OrderStatus.ORDER_STATUS_SCHEDULED,
        occurredAt: new Date(),
      },
      ctx,
    );
    expect(projector.fromSnapshot).not.toHaveBeenCalled();
    expect(projector.progress).toHaveBeenCalledWith(
      ctx.tx,
      "o",
      expect.objectContaining({ status: "cancelled" }),
    );
  });
});
