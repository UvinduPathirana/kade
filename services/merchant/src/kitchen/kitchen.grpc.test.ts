import { Metadata, status } from "@grpc/grpc-js";
import { TicketStatus } from "@kade/proto/kade/merchant/v1/merchant_service";
import { RejectionReason } from "@kade/proto/kade/order/v1/order_service";
import { beforeEach, describe, expect, it } from "vitest";
import type { MerchantEvents } from "../domain/merchant-events.js";
import type { OutletAccess, OutletCaller } from "../outlets/outlet-access.js";
import type { OutletRow } from "../outlets/outlets.repository.js";
import type { Database, Tx } from "../platform/db/database.js";
import { createRequestContext, type RequestContext } from "../platform/grpc/context.js";
import { DomainError } from "../platform/grpc/errors.js";
import type { IdempotencyStore } from "../platform/idempotency/idempotency.js";
import { DemoBoard, demoTicket } from "../seed/demo-board.js";
import { KitchenGrpcService } from "./kitchen.grpc.js";
import { order } from "../../test/fixtures.js";
import { ticketFromOrder } from "./ticket-mapper.js";
import type { TicketPatch, TicketRow, TicketsRepository } from "./tickets.repository.js";

const OUTLET = "00000000-0000-7000-8000-000000000001";
const tx = {} as Tx;

class FakeTickets {
  rows = new Map<string, TicketRow>();
  put(row: TicketRow) {
    this.rows.set(row.orderId, structuredClone(row));
  }
  async lock(_tx: unknown, id: string) {
    return this.rows.get(id);
  }
  async find(_db: unknown, id: string) {
    return this.rows.get(id);
  }
  async update(_tx: unknown, id: string, patch: TicketPatch) {
    const next = { ...this.rows.get(id)!, ...patch } as TicketRow;
    this.rows.set(id, next);
    return next;
  }
  async expireMissed(_db: unknown, now: Date) {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.status === "new" && r.acceptBy < now) {
        Object.assign(r, { status: "missed", closedAt: r.acceptBy, rejectReason: "timeout" });
        n++;
      }
    }
    return n;
  }
  async board() {
    return [...this.rows.values()];
  }
}

let tickets: FakeTickets;
let events: { type: string; event: Record<string, unknown> }[];
let service: KitchenGrpcService;
let busy = 0;

function newTicket(over: Partial<TicketRow> = {}): TicketRow {
  const now = new Date();
  const base = ticketFromOrder(
    order({ placedAt: now, acceptBy: new Date(now.getTime() + 180_000) }),
    "new",
    now,
  );
  return { createdAt: now, updatedAt: now, ...base, ...over } as TicketRow;
}

beforeEach(() => {
  tickets = new FakeTickets();
  events = [];
  busy = 0;
  const database = {
    db: {},
    transaction: async <T>(_c: unknown, fn: (t: Tx) => Promise<T>) => fn(tx),
  } as unknown as Database;
  const access = {
    authorise: async (): Promise<OutletCaller> => ({
      outlet: { id: OUTLET, busyExtraMinutes: busy } as OutletRow,
      staff: undefined,
      role: "kitchen",
      isOps: false,
    }),
  } as unknown as OutletAccess;
  const record = (type: string) => async (_tx: Tx, event: Record<string, unknown>) =>
    void events.push({ type, event });
  const merchantEvents = {
    ticketAccepted: record("TicketAccepted"),
    ticketRejected: record("TicketRejected"),
    ticketReady: record("TicketReady"),
    ticketHandedOver: record("TicketHandedOver"),
  } as unknown as MerchantEvents;
  const idempotency = {
    run: (_t: Tx, _o: unknown, work: () => Promise<unknown>) => work(),
  } as unknown as IdempotencyStore;
  const demo = new DemoBoard(
    database,
    tickets as unknown as TicketsRepository,
    { DEMO_BOARD: false } as never,
    {} as never,
  );
  service = new KitchenGrpcService(
    database,
    access,
    tickets as unknown as TicketsRepository,
    merchantEvents,
    idempotency,
    demo,
  );
});

function ctx(): RequestContext {
  const md = new Metadata();
  md.set("x-user-id", "00000000-0000-7000-8005-000000000003");
  md.set("x-roles", "merchant_staff");
  md.set("x-outlet-id", OUTLET);
  return createRequestContext({ metadata: md });
}

async function reasonOf(p: Promise<unknown>): Promise<[status, string]> {
  const err = await p.then(
    () => expect.unreachable(),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  return [(err as DomainError).code, (err as DomainError).reason];
}

const ids = (t: TicketRow) => ({ outletId: OUTLET, orderId: t.orderId, idempotencyKey: "" });

describe("acceptOrder", () => {
  it("accepts within the window, adds busy minutes and emits TicketAccepted", async () => {
    busy = 10;
    const t = newTicket();
    tickets.put(t);
    const before = Date.now();
    const { ticket } = await service.acceptOrder({ ...ids(t), prepMinutes: 15 }, ctx());
    expect(ticket).toMatchObject({ status: TicketStatus.TICKET_STATUS_PREPARING, prepMinutes: 25 });
    expect(ticket!.readyBy!.getTime()).toBeGreaterThanOrEqual(before + 25 * 60_000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "TicketAccepted",
      event: { outletId: OUTLET, orderId: t.orderId, orderNumber: "KD-4821", prepMinutes: 25 },
    });
    expect((events[0]!.event.actor as { userId: string }).userId).toBe(
      "00000000-0000-7000-8005-000000000003",
    );
  });

  it("refuses after accept_by with TICKET_MISSED and leaves the ticket missed", async () => {
    const t = newTicket({ acceptBy: new Date(Date.now() - 1000) });
    tickets.put(t);
    expect(await reasonOf(service.acceptOrder({ ...ids(t), prepMinutes: 15 }, ctx()))).toEqual([
      status.FAILED_PRECONDITION,
      "TICKET_MISSED",
    ]);
    expect(tickets.rows.get(t.orderId)?.status).toBe("missed");
    expect(events).toHaveLength(0);
  });

  it("refuses a second accept with TICKET_ALREADY_ACCEPTED", async () => {
    const t = newTicket();
    tickets.put(t);
    await service.acceptOrder({ ...ids(t), prepMinutes: 15 }, ctx());
    expect(await reasonOf(service.acceptOrder({ ...ids(t), prepMinutes: 15 }, ctx()))).toEqual([
      status.FAILED_PRECONDITION,
      "TICKET_ALREADY_ACCEPTED",
    ]);
  });

  it.each([0, 121, 2.5])("rejects prep time %s", async (prepMinutes) => {
    const t = newTicket();
    tickets.put(t);
    expect(await reasonOf(service.acceptOrder({ ...ids(t), prepMinutes }, ctx()))).toEqual([
      status.INVALID_ARGUMENT,
      "PREP_MINUTES_INVALID",
    ]);
  });

  it("returns TICKET_NOT_FOUND for another outlet's ticket", async () => {
    const t = newTicket({ outletId: "00000000-0000-7000-8000-000000000002" });
    tickets.put(t);
    expect(await reasonOf(service.acceptOrder({ ...ids(t), prepMinutes: 15 }, ctx()))).toEqual([
      status.NOT_FOUND,
      "TICKET_NOT_FOUND",
    ]);
  });
});

describe("rejectOrder", () => {
  it("rejects a new ticket with a reason and emits TicketRejected", async () => {
    const t = newTicket();
    tickets.put(t);
    const { ticket } = await service.rejectOrder(
      { ...ids(t), reason: RejectionReason.REJECTION_REASON_SOLD_OUT, note: " Out of cheese " },
      ctx(),
    );
    expect(ticket).toMatchObject({
      status: TicketStatus.TICKET_STATUS_REJECTED,
      rejectReason: RejectionReason.REJECTION_REASON_SOLD_OUT,
      rejectNote: "Out of cheese",
    });
    expect(ticket?.closedAt).toBeInstanceOf(Date);
    expect(events.map((e) => e.type)).toEqual(["TicketRejected"]);
  });

  it("does not let the kitchen claim a timeout", async () => {
    const t = newTicket();
    tickets.put(t);
    expect(
      await reasonOf(
        service.rejectOrder({ ...ids(t), reason: RejectionReason.REJECTION_REASON_TIMEOUT, note: "" }, ctx()),
      ),
    ).toEqual([status.INVALID_ARGUMENT, "REJECT_REASON_INVALID"]);
  });
});

describe("markOrderReady / handOverOrder", () => {
  it("follows preparing → ready → picked up, one event each", async () => {
    const t = newTicket();
    tickets.put(t);
    expect(await reasonOf(service.markOrderReady(ids(t), ctx()))).toEqual([
      status.FAILED_PRECONDITION,
      "TICKET_NOT_PREPARING",
    ]);
    expect(await reasonOf(service.handOverOrder(ids(t), ctx()))).toEqual([
      status.FAILED_PRECONDITION,
      "TICKET_NOT_READY",
    ]);
    await service.acceptOrder({ ...ids(t), prepMinutes: 10 }, ctx());
    const ready = await service.markOrderReady(ids(t), ctx());
    expect(ready.ticket?.status).toBe(TicketStatus.TICKET_STATUS_READY);
    const gone = await service.handOverOrder(ids(t), ctx());
    expect(gone.ticket).toMatchObject({ status: TicketStatus.TICKET_STATUS_PICKED_UP });
    expect(gone.ticket?.closedAt).toBeInstanceOf(Date);
    expect(events.map((e) => e.type)).toEqual(["TicketAccepted", "TicketReady", "TicketHandedOver"]);
  });
});

describe("demo tickets", () => {
  it("work like real ones but never publish", async () => {
    const t = { ...demoTicket(2499, new Date()), createdAt: new Date(), updatedAt: new Date() } as TicketRow;
    tickets.put(t);
    await service.acceptOrder({ ...ids(t), prepMinutes: 15 }, ctx());
    await service.markOrderReady(ids(t), ctx());
    await service.handOverOrder(ids(t), ctx());
    expect(tickets.rows.get(t.orderId)?.status).toBe("picked_up");
    expect(events).toHaveLength(0);
  });
});
