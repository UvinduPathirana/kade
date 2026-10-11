import { Metadata, status } from "@grpc/grpc-js";
import { FulfilmentMode, PaymentMethodKind, RefundMethod } from "@kade/proto/kade/common/v1/commerce";
import { Order, OrderStatus, type Refund } from "@kade/proto/kade/order/v1/order_service";
import { beforeEach, describe, expect, it } from "vitest";
import { stubPayment, stubProfile } from "../clients/stubs.js";
import type { Config } from "../platform/config.js";
import type { Database, Tx } from "../platform/db/database.js";
import { createRequestContext, type RequestContext } from "../platform/grpc/context.js";
import { DomainError } from "../platform/grpc/errors.js";
import type { Logger } from "../platform/logger.js";
import type { TemporalService } from "../temporal/temporal.service.js";
import { DILINI, order as makeOrder, placeRequest } from "./fixtures.test-util.js";
import { lkr } from "./money.js";
import { OrderGrpcService, validatePlaceOrder } from "./order.grpc.js";
import type { OrderRepository } from "./order.repository.js";
import { OrderStore } from "./order.store.js";
import type { RefundRepository } from "./refund.repository.js";
import { RefundService, refundable } from "./refund.service.js";

const tx = {} as Tx;
let current: Order;
let signals: unknown[][];
let refundRows: { refund: Refund; key: string }[];
let events: string[];
let service: OrderGrpcService;

function ctx(roles = "customer", userId = DILINI): RequestContext {
  const md = new Metadata();
  if (userId) md.set("x-user-id", userId);
  md.set("x-roles", roles);
  return createRequestContext({ metadata: md });
}

async function reason(p: Promise<unknown>): Promise<[status, string]> {
  const err = await p.then(
    () => expect.unreachable("expected a failure"),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  return [(err as DomainError).code, (err as DomainError).reason];
}

beforeEach(() => {
  current = makeOrder(OrderStatus.ORDER_STATUS_PLACED, { paymentId: "stub-pay-x" });
  signals = [];
  refundRows = [];
  events = [];
  const database = {
    db: {},
    transaction: async <T>(_c: unknown, fn: (t: Tx) => Promise<T>) => fn(tx),
  } as unknown as Database;
  const orders = {
    // Fresh copies, like rows read from the database.
    findById: async () => ({
      order: Order.fromJSON(Order.toJSON(current)),
      request: placeRequest(),
      requestHash: "",
      idempotencyKey: "",
    }),
    lockById: async () => ({ order: current, request: placeRequest(), requestHash: "", idempotencyKey: "" }),
    save: async (_t: Tx, o: Order) => void (current = o),
  } as unknown as OrderRepository;
  const outbox = { append: async (_t: Tx, e: { type: string }) => void events.push(e.type) };
  const store = new OrderStore(database, orders, outbox as never);
  const refunds = {
    listForOrder: async () => refundRows.map((r) => r.refund),
    findByKey: async (_db: unknown, _id: string, key: string) =>
      refundRows.find((r) => r.key === key)?.refund,
    insert: async (_t: Tx, refund: (typeof refundRows)[number]["refund"], key: string) => {
      refundRows.push({ refund, key });
      return true;
    },
  } as unknown as RefundRepository;
  const payment = stubPayment();
  const refundService = new RefundService(database, orders, refunds, store, payment, stubProfile());
  const temporal = {
    signal: async (...args: unknown[]) => {
      signals.push(args);
      return true;
    },
  } as unknown as TemporalService;
  const config = { PLACE_ORDER_WAIT_MS: 100 } as Config;
  const logger = { warn: () => undefined, error: () => undefined } as unknown as Logger;
  service = new OrderGrpcService(
    config,
    logger,
    database,
    orders,
    store,
    refunds,
    refundService,
    temporal,
    payment,
  );
});

describe("validatePlaceOrder", () => {
  it.each([
    [{ lines: [] }, "CART_EMPTY"],
    [{ idempotencyKey: "" }, "IDEMPOTENCY_KEY_REQUIRED"],
    [{ address: undefined }, "ADDRESS_REQUIRED"],
    [{ payment: undefined }, "PAYMENT_METHOD_REQUIRED"],
    [{ mode: 0 }, "MODE_REQUIRED"],
    [{ lines: [{ key: "a", itemId: "x", quantity: 0, options: [], note: "" }] }, "LINE_INVALID"],
    [{ scheduledFor: new Date(Date.now() + 8 * 86_400_000) }, "SCHEDULE_TOO_FAR"],
  ])("%j → %s", (overrides, expected) => {
    expect(() => validatePlaceOrder(placeRequest(overrides as never))).toThrow(
      expect.objectContaining({ reason: expected }),
    );
  });

  it("pickup needs no address", () => {
    expect(() =>
      validatePlaceOrder(placeRequest({ mode: FulfilmentMode.FULFILMENT_MODE_PICKUP, address: undefined })),
    ).not.toThrow();
  });
});

describe("CancelOrder", () => {
  it("a customer cancelling after the kitchen started gets ORDER_ALREADY_STARTED", async () => {
    current.status = OrderStatus.ORDER_STATUS_PREPARING;
    expect(
      await reason(
        service.cancelOrder(
          {
            orderId: current.id,
            cancelledBy: 0,
            reason: "",
            fault: 0,
            refund: false,
            by: "",
            idempotencyKey: "",
          },
          ctx(),
        ),
      ),
    ).toEqual([status.FAILED_PRECONDITION, "ORDER_ALREADY_STARTED"]);
    expect(signals).toEqual([]);
  });

  it("signals the workflow and returns the cancelled order", async () => {
    const pending = service.cancelOrder(
      {
        orderId: current.id,
        cancelledBy: 2,
        reason: "Changed my mind",
        fault: 0,
        refund: true,
        by: "",
        idempotencyKey: "",
      },
      ctx(),
    );
    setTimeout(() => (current.status = OrderStatus.ORDER_STATUS_CANCELLED), 50);
    const { order } = await pending;
    expect(order?.status).toBe(OrderStatus.ORDER_STATUS_CANCELLED);
    // A customer can't claim to be ops or ask for a refund.
    expect(signals[0]?.[2]).toMatchObject({ cancelledBy: 1, refund: false, reason: "Changed my mind" });
  });

  it("other customers can't see the order", async () => {
    expect(
      await reason(
        service.getOrder({ orderId: current.id, orderNumber: "" }, ctx("customer", "someone-else")),
      ),
    ).toEqual([status.NOT_FOUND, "ORDER_NOT_FOUND"]);
  });
});

describe("UpdateTip", () => {
  it("cash orders tip at the door", async () => {
    current.payment = {
      kind: PaymentMethodKind.PAYMENT_METHOD_KIND_CASH,
      cardId: "",
      cardBrand: 0,
      cardLast4: "",
    };
    expect(
      await reason(service.updateTip({ orderId: current.id, tip: lkr(20_000), idempotencyKey: "" }, ctx())),
    ).toEqual([status.FAILED_PRECONDITION, "CASH_TIP_AT_DOOR"]);
  });

  it("card orders adjust the total and emit OrderTipUpdated", async () => {
    await stubAuthorise();
    const { order } = await service.updateTip(
      { orderId: current.id, tip: lkr(30_000), idempotencyKey: "t1" },
      ctx(),
    );
    expect(order?.totals).toMatchObject({ tip: lkr(30_000), total: lkr(345_000) });
    expect(events).toEqual(["kade.order.v1.OrderTipUpdated"]);
  });
});

describe("RefundOrder", () => {
  it("customers can't refund themselves", async () => {
    expect(
      (await reason(service.refundOrder(refundReq(1000, RefundMethod.REFUND_METHOD_CREDIT), ctx())))[1],
    ).toBe("PERMISSION_DENIED");
  });

  it("refunds to credit, records it and emits OrderRefunded; retries are idempotent", async () => {
    current.status = OrderStatus.ORDER_STATUS_DELIVERED;
    const first = await service.refundOrder(
      refundReq(45_000, RefundMethod.REFUND_METHOD_CREDIT),
      ctx("support", "agent-1"),
    );
    expect(first.order?.refunded).toEqual(lkr(45_000));
    expect(first.order?.timeline.at(-1)?.label).toBe("Refunded Rs 450 to Kadé credit: Missing dish");
    const again = await service.refundOrder(
      refundReq(45_000, RefundMethod.REFUND_METHOD_CREDIT),
      ctx("support", "agent-1"),
    );
    expect(again.refund?.id).toBe(first.refund?.id);
    expect(events).toEqual(["kade.order.v1.OrderRefunded"]);
  });

  it("never more than what's left; cash orders only to credit", async () => {
    current.status = OrderStatus.ORDER_STATUS_DELIVERED;
    expect(
      (
        await reason(
          service.refundOrder(refundReq(400_000, RefundMethod.REFUND_METHOD_CARD), ctx("ops", "ops-1")),
        )
      )[1],
    ).toBe("REFUND_EXCEEDS_REMAINING");
    current.payment = {
      kind: PaymentMethodKind.PAYMENT_METHOD_KIND_CASH,
      cardId: "",
      cardBrand: 0,
      cardLast4: "",
    };
    expect(
      (
        await reason(
          service.refundOrder(refundReq(1_000, RefundMethod.REFUND_METHOD_CARD), ctx("ops", "ops-1")),
        )
      )[1],
    ).toBe("CASH_ORDER_REFUND_TO_CREDIT");
  });

  it("refundable covers credit spent too", () => {
    const o = makeOrder(OrderStatus.ORDER_STATUS_DELIVERED);
    o.totals = { ...o.totals!, credit: lkr(20_000), total: lkr(100_000) };
    expect(refundable(o, [])).toEqual({ anyMinor: 120_000, cardMinor: 100_000 });
  });
});

function refundReq(amountMinor: number, method: RefundMethod) {
  return {
    orderId: current.id,
    amount: lkr(amountMinor),
    method,
    reason: "Missing dish",
    by: "Agent",
    ticketId: "",
    idempotencyKey: "r1",
  };
}

async function stubAuthorise() {
  // UpdateTip adjusts the open authorisation; the stub needs one to exist.
  const svc = service as unknown as { payment: ReturnType<typeof stubPayment> };
  const p = await svc.payment.authorise({
    purpose: 1,
    referenceId: "x",
    referenceLabel: "",
    customerId: DILINI,
    method: current.payment,
    amount: lkr(325_000),
    idempotencyKey: "a",
  });
  current.paymentId = p.id;
}
