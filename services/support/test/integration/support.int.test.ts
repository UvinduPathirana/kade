// Integration test against the SHARED stack (pnpm infra:up): Postgres `support`, Kafka and the Debezium
// connector outbox-support (deploy/compose/connect/register-outbox.sh support support). Order and
// profile are replaced by an in-process fake gRPC server, so the test controls refunds and can take
// order "down". Defaults use this laptop's host ports (Postgres 15432); override with DATABASE_URL /
// KAFKA_BROKERS.
import {
  credentials,
  Metadata,
  Server,
  ServerCredentials,
  status,
  type ServiceError,
  type sendUnaryData,
  type ServerUnaryCall,
} from "@grpc/grpc-js";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import type { INestApplication } from "@nestjs/common";
import { PaymentMethodKind, RefundMethod } from "@kade/proto/kade/common/v1/commerce";
import {
  Order,
  OrderServiceService,
  OrderStatus,
  RefundOrderResponse,
  type RefundOrderRequest,
} from "@kade/proto/kade/order/v1/order_service";
import {
  ChangeCreditResponse,
  CreditServiceService,
  type ChangeCreditRequest,
} from "@kade/proto/kade/profile/v1/profile_service";
import {
  IssueKind,
  IssueResolution,
  RequesterKind,
  ResolutionKind,
  SupportServiceClient,
  TicketAdminServiceClient,
  TicketPriority,
  TicketStatus,
  type Ticket,
} from "@kade/proto/kade/support/v1/support_service";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "../../src/app.js";
import { loadConfig } from "../../src/platform/config.js";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "../../src/platform/grpc/error-details.js";
import { GrpcServer } from "../../src/platform/grpc/grpc-server.js";
import { createLogger } from "../../src/platform/logger.js";
import { seededId } from "../../src/seed/seed.js";
import { SlaMonitor } from "../../src/tickets/sla-monitor.js";

// ---------------------------------------------------------------- fake order + profile
const orders = new Map<string, Order>();
const refundCalls: RefundOrderRequest[] = [];
const creditCalls: ChangeCreditRequest[] = [];
const fake = new Server();
type Unary<Req, Res> = (call: ServerUnaryCall<Req, Res>, cb: sendUnaryData<Res>) => void;
const getOrder: Unary<{ orderId: string }, { order?: Order }> = (call, cb) => {
  const order = orders.get(call.request.orderId);
  if (!order) cb({ code: status.NOT_FOUND, details: "no such order" });
  else cb(null, { order });
};
const refundOrder: Unary<RefundOrderRequest, object> = (call, cb) => {
  refundCalls.push(call.request);
  const order = orders.get(call.request.orderId)!;
  const id = `refund-${call.request.idempotencyKey}`;
  cb(
    null,
    RefundOrderResponse.fromPartial({
      order,
      refund: { id, orderId: order.id, amount: call.request.amount, method: call.request.method },
    }),
  );
};
const changeCredit: Unary<ChangeCreditRequest, object> = (call, cb) => {
  creditCalls.push(call.request);
  cb(
    null,
    ChangeCreditResponse.fromPartial({
      entry: { id: `credit-${call.request.idempotencyKey}`, amount: call.request.amount },
    }),
  );
};
fake.addService(OrderServiceService, { getOrder, refundOrder } as never);
fake.addService(CreditServiceService, { changeCredit } as never);

let fakePort = 0;
let app: INestApplication;
let support: SupportServiceClient;
let admin: TicketAdminServiceClient;
let pool: pg.Pool;

const rs = (n: number) => ({ amountMinor: n * 100, currency: "LKR" });
function deliveredOrder(customerId: string, card: boolean): Order {
  const id = uuidv7();
  const order = Order.fromPartial({
    id,
    orderNumber: `KD-${Math.floor(Math.random() * 9000) + 1000}`,
    status: OrderStatus.ORDER_STATUS_DELIVERED,
    customer: { id: customerId, name: "Dilini Perera" },
    restaurant: { id: seededId("8000", 1), name: "Galle Road Kottu House", discountPercent: 0 },
    lines: [
      { key: "l1", itemId: "cheese-kottu", name: "Cheese kottu", unitPrice: rs(1450), quantity: 2 },
      { key: "l2", itemId: "faluda", name: "Faluda", unitPrice: rs(450), quantity: 1 },
    ],
    totals: { deliveryFee: rs(150), total: rs(3500) },
    payment: {
      kind: card ? PaymentMethodKind.PAYMENT_METHOD_KIND_CARD : PaymentMethodKind.PAYMENT_METHOD_KIND_CASH,
    },
  });
  orders.set(id, order);
  return order;
}

beforeAll(async () => {
  fakePort = await new Promise<number>((resolve, reject) =>
    fake.bindAsync("127.0.0.1:0", ServerCredentials.createInsecure(), (err, port) =>
      err ? reject(err) : resolve(port),
    ),
  );
  const config = loadConfig({
    SERVICE_NAME: "support",
    DATABASE_URL: "postgres://support:support@localhost:15432/support",
    KAFKA_BROKERS: "localhost:19092",
    LOG_LEVEL: "warn",
    ...process.env,
    ORDER_GRPC: `127.0.0.1:${fakePort}`,
    PROFILE_GRPC: `127.0.0.1:${fakePort}`,
    SLA_CHECK_INTERVAL_MS: "3600000",
    GRPC_PORT: "0",
    HTTP_PORT: "0",
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
  });
  app = await startApp(config, createLogger(config));
  const address = `localhost:${app.get(GrpcServer).port}`;
  support = new SupportServiceClient(address, credentials.createInsecure());
  admin = new TicketAdminServiceClient(address, credentials.createInsecure());
  pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
});

afterAll(async () => {
  support?.close();
  admin?.close();
  fake.forceShutdown();
  await pool?.end();
  await app?.close();
});

function md(userId: string, roles: string): Metadata {
  const m = new Metadata();
  m.set("x-user-id", userId);
  m.set("x-roles", roles);
  return m;
}
const listReq = (patch: object = {}) => ({
  status: 0,
  category: 0,
  priority: 0,
  assigneeId: "",
  unassignedOnly: false,
  slaBreachedOnly: false,
  orderId: "",
  requesterId: "",
  page: { pageSize: 200, pageToken: "" },
  ...patch,
});
const AGENT = seededId("8006", 4); // Ruwani Silva
const agent = () => md(AGENT, "support");

function rpc<Res>(client: object, method: string, req: object, meta = new Metadata()): Promise<Res> {
  return new Promise((resolve, reject) =>
    (client as Record<string, (...a: unknown[]) => void>)[method]!.call(
      client,
      req,
      meta,
      { deadline: Date.now() + 8_000 },
      (err: ServiceError | null, res: Res) => (err ? reject(err) : resolve(res)),
    ),
  );
}

async function reasonOf(promise: Promise<unknown>): Promise<[status, string | undefined]> {
  const err = (await promise.then(
    () => expect.unreachable("expected the call to fail"),
    (e: unknown) => e,
  )) as ServiceError;
  const details = err.metadata.get(STATUS_DETAILS_KEY)[0];
  return [err.code, details ? decodeErrorInfo(details as Buffer)?.reason : undefined];
}

async function outboxTypes(ticketId: string): Promise<string[]> {
  const { rows } = await pool.query<{ type: string }>(
    "select type from outbox where aggregateid = $1 order by created_at, id",
    [ticketId],
  );
  return rows.map((r) => r.type.replace("kade.support.v1.", ""));
}

describe("admin console queue", () => {
  it("serves the seeded tickets and macros", async () => {
    const { tickets } = await rpc<{ tickets: Ticket[] }>(admin, "listTickets", listReq(), agent());
    const seeded = tickets.filter((t) => t.id.includes("-8b01-"));
    expect(seeded).toHaveLength(12);
    const t2 = seeded.find((t) => t.id === seededId("8b01", 2))!;
    expect(t2).toMatchObject({
      subject: "Missing cheese kottu",
      assigneeName: "Ruwani Silva",
      orderNumber: "KD-4798",
    });

    const { macros } = await rpc<{ macros: { id: string }[] }>(admin, "listMacros", {}, agent());
    expect(macros.map((m) => m.id)).toEqual(["mc1", "mc2", "mc3", "mc4", "mc5"]);

    expect(await reasonOf(rpc(admin, "listTickets", listReq(), md("c", "customer")))).toEqual([
      status.PERMISSION_DENIED,
      "PERMISSION_DENIED",
    ]);
  });
});

describe("order issues", () => {
  it("previews, reports and pays straight to credit through order.RefundOrder", async () => {
    const customer = uuidv7();
    const order = deliveredOrder(customer, true);
    const lines = [{ lineKey: "l1", quantity: 1 }];
    const preview = await rpc<{ amount: { amountMinor: number } }>(
      support,
      "previewOrderIssue",
      { orderId: order.id, kind: IssueKind.ISSUE_KIND_MISSING, lines },
      md(customer, "customer"),
    );
    expect(preview.amount.amountMinor).toBe(1_450_00);

    const req = {
      orderId: order.id,
      customerId: customer,
      kind: IssueKind.ISSUE_KIND_MISSING,
      lines,
      note: "Only one came.",
      photoRef: "",
      photoName: "",
      resolution: IssueResolution.ISSUE_RESOLUTION_CREDIT,
      idempotencyKey: uuidv7(),
    };
    const res = await rpc<{ issue: { refundId: string; amount: { amountMinor: number } }; ticket: Ticket }>(
      support,
      "reportOrderIssue",
      req,
      md(customer, "customer"),
    );
    expect(res.issue).toMatchObject({
      refundId: `refund-issue:${order.id}`,
      amount: { amountMinor: 1_450_00 },
    });
    expect(res.ticket.status).toBe(TicketStatus.TICKET_STATUS_RESOLVED);
    expect(res.ticket.messages[0]?.body).toBe("Missing: 1 × Cheese kottu. Only one came.");
    expect(refundCalls.at(-1)).toMatchObject({
      method: RefundMethod.REFUND_METHOD_CREDIT,
      ticketId: res.ticket.id,
    });

    // A retry replays; a second report is refused.
    const again = await rpc<{ ticket: Ticket }>(support, "reportOrderIssue", req, md(customer, "customer"));
    expect(again.ticket.id).toBe(res.ticket.id);
    expect(
      await reasonOf(
        rpc(support, "reportOrderIssue", { ...req, idempotencyKey: "" }, md(customer, "customer")),
      ),
    ).toEqual([status.FAILED_PRECONDITION, "ISSUE_ALREADY_REPORTED"]);

    expect(await outboxTypes(res.ticket.id)).toEqual([
      "TicketOpened",
      "OrderIssueReported",
      "TicketResolved",
    ]);
    const batch = await rpc<{ issues: { orderId: string }[] }>(support, "batchGetOrderIssues", {
      orderIds: [order.id, uuidv7()],
    });
    expect(batch.issues.map((i) => i.orderId)).toEqual([order.id]);
  });

  it("enforces the app's rules", async () => {
    const customer = uuidv7();
    const cash = deliveredOrder(customer, false);
    const base = {
      orderId: cash.id,
      customerId: customer,
      lines: [],
      note: "",
      photoRef: "",
      photoName: "",
      idempotencyKey: "",
    };
    expect(
      await reasonOf(
        rpc(
          support,
          "reportOrderIssue",
          { ...base, kind: IssueKind.ISSUE_KIND_LATE, resolution: IssueResolution.ISSUE_RESOLUTION_CARD },
          md(customer, "customer"),
        ),
      ),
    ).toEqual([status.FAILED_PRECONDITION, "CASH_ORDER_REFUND_TO_CREDIT"]);
    expect(
      await reasonOf(
        rpc(
          support,
          "reportOrderIssue",
          { ...base, kind: IssueKind.ISSUE_KIND_MISSING, resolution: 0 },
          md(customer, "customer"),
        ),
      ),
    ).toEqual([status.INVALID_ARGUMENT, "ISSUE_LINES_REQUIRED"]);
    expect(
      await reasonOf(
        rpc(
          support,
          "reportOrderIssue",
          { ...base, kind: IssueKind.ISSUE_KIND_LATE, resolution: 0 },
          md(uuidv7(), "customer"),
        ),
      ),
    ).toEqual([status.PERMISSION_DENIED, "NOT_YOUR_ORDER"]);
    orders.set(cash.id, { ...cash, status: OrderStatus.ORDER_STATUS_PREPARING });
    expect(
      await reasonOf(
        rpc(
          support,
          "reportOrderIssue",
          { ...base, kind: IssueKind.ISSUE_KIND_LATE, resolution: 0 },
          md(customer, "customer"),
        ),
      ),
    ).toEqual([status.FAILED_PRECONDITION, "ORDER_NOT_ARRIVED"]);
  });
});

describe("chat and the support desk", () => {
  it("runs a conversation from greeting to refund, with SLA and events", async () => {
    const customer = uuidv7();
    const order = deliveredOrder(customer, true);
    const requester = { kind: RequesterKind.REQUESTER_KIND_CUSTOMER, id: customer, name: "Dilini Perera" };
    const started = await rpc<{ ticket: Ticket }>(
      support,
      "getOrStartConversation",
      { requester, orderId: "" },
      md(customer, "customer"),
    );
    expect(started.ticket.messages[0]?.body).toMatch(/^Hi Dilini, I'm Tharushi from Kadé support/);
    const same = await rpc<{ ticket: Ticket }>(
      support,
      "getOrStartConversation",
      { requester, orderId: order.id },
      md(customer, "customer"),
    );
    expect(same.ticket.id).toBe(started.ticket.id);
    expect(same.ticket.orderNumber).toBe(order.orderNumber);
    const ticketId = started.ticket.id;

    await rpc(
      support,
      "sendMessage",
      { ticketId, requester, text: "The faluda spilled everywhere.", idempotencyKey: uuidv7() },
      md(customer, "customer"),
    );
    const listed = await rpc<{ messages: { body: string }[] }>(
      support,
      "listMessages",
      { ticketId, page: { pageSize: 10, pageToken: "" } },
      md(customer, "customer"),
    );
    expect(listed.messages.map((m) => m.body).slice(1)).toEqual([
      "The faluda spilled everywhere.",
      "Thanks. Someone from the support team will reply here, usually within a few minutes.",
    ]);

    const replied = await rpc<{ ticket: Ticket }>(
      admin,
      "replyToTicket",
      {
        ticketId,
        agentId: "",
        agentName: "",
        body: "Sorry Dilini, sorting it now.",
        idempotencyKey: uuidv7(),
      },
      agent(),
    );
    expect(replied.ticket).toMatchObject({
      status: TicketStatus.TICKET_STATUS_PENDING,
      assigneeName: "Ruwani Silva",
    });
    expect(replied.ticket.firstResponseAt).toBeInstanceOf(Date);

    const prio = await rpc<{ ticket: Ticket }>(
      admin,
      "setTicketPriority",
      { ticketId, priority: TicketPriority.TICKET_PRIORITY_URGENT },
      agent(),
    );
    expect(prio.ticket.slaDueAt!.getTime() - prio.ticket.openedAt!.getTime()).toBe(15 * 60_000);

    const assigned = await rpc<{ ticket: Ticket }>(
      admin,
      "assignTicket",
      { ticketId, assigneeId: seededId("8006", 5) },
      agent(),
    );
    expect(assigned.ticket.assigneeName).toBe("Imran Lafir");
    expect(assigned.ticket.messages.at(-1)?.body).toBe("Assigned to Imran Lafir by Ruwani.");

    expect(
      await reasonOf(
        rpc(
          admin,
          "resolveTicket",
          {
            ticketId,
            kind: ResolutionKind.RESOLUTION_KIND_REFUND,
            amount: rs(9000),
            method: RefundMethod.REFUND_METHOD_CARD,
            note: "",
            agentId: "",
            agentName: "",
            idempotencyKey: "",
          },
          agent(),
        ),
      ),
    ).toEqual([status.FAILED_PRECONDITION, "REFUND_EXCEEDS_REMAINING"]);

    const key = uuidv7();
    const resolved = await rpc<{ ticket: Ticket }>(
      admin,
      "resolveTicket",
      {
        ticketId,
        kind: ResolutionKind.RESOLUTION_KIND_REFUND,
        amount: rs(450),
        method: RefundMethod.REFUND_METHOD_CARD,
        note: "Driver confirmed spill.",
        agentId: "",
        agentName: "",
        idempotencyKey: key,
      },
      agent(),
    );
    expect(resolved.ticket.status).toBe(TicketStatus.TICKET_STATUS_RESOLVED);
    expect(resolved.ticket.resolution).toMatchObject({
      summary: "Refunded Rs 450 to card",
      externalRef: `refund-ticket:${ticketId}:${key}`,
      resolvedBy: "Ruwani Silva",
    });
    expect(resolved.ticket.messages.at(-1)?.body).toBe(
      "Resolved by Ruwani: Refunded Rs 450 to card. Driver confirmed spill.",
    );
    expect(refundCalls.at(-1)).toMatchObject({ orderId: order.id, ticketId, by: "Ruwani Silva" });
    expect(
      await reasonOf(
        rpc(
          admin,
          "resolveTicket",
          {
            ticketId,
            kind: ResolutionKind.RESOLUTION_KIND_NONE,
            method: 0,
            note: "",
            agentId: "",
            agentName: "",
            idempotencyKey: "",
          },
          agent(),
        ),
      ),
    ).toEqual([status.FAILED_PRECONDITION, "TICKET_ALREADY_RESOLVED"]);

    const reopened = await rpc<{ ticket: Ticket }>(
      admin,
      "reopenTicket",
      { ticketId, agentName: "" },
      agent(),
    );
    expect(reopened.ticket.status).toBe(TicketStatus.TICKET_STATUS_OPEN);
    const credit = await rpc<{ ticket: Ticket }>(
      admin,
      "resolveTicket",
      {
        ticketId,
        kind: ResolutionKind.RESOLUTION_KIND_CREDIT,
        amount: rs(300),
        method: 0,
        note: "",
        agentId: "",
        agentName: "",
        idempotencyKey: uuidv7(),
      },
      agent(),
    );
    expect(credit.ticket.resolution?.summary).toBe("Issued Rs 300 Kadé credit");
    expect(creditCalls.at(-1)).toMatchObject({ customerId: customer, amount: rs(300) });

    expect(await outboxTypes(ticketId)).toEqual([
      "TicketOpened",
      "TicketMessageAdded", // customer
      "TicketMessageAdded", // auto acknowledgement
      "TicketMessageAdded", // agent reply
      "TicketAssigned", // claimed by replying
      "TicketPriorityChanged",
      "TicketMessageAdded", // "Assigned to Imran…"
      "TicketAssigned",
      "TicketMessageAdded", // resolved
      "TicketResolved",
      "TicketMessageAdded", // reopened
      "TicketReopened",
      "TicketMessageAdded",
      "TicketResolved",
    ]);
  });

  it("announces SLA breaches once", async () => {
    const requester = {
      kind: RequesterKind.REQUESTER_KIND_RIDER,
      id: seededId("8001", 900 + Math.floor(Math.random() * 99)),
      name: "Nimal",
    };
    const { ticket } = await rpc<{ ticket: Ticket }>(
      support,
      "getOrStartConversation",
      { requester, orderId: "" },
      md("nimal", "rider"),
    );
    await pool.query("update tickets set sla_due_at = now() - interval '1 minute' where id = $1", [
      ticket.id,
    ]);
    const monitor = app.get(SlaMonitor);
    expect(await monitor.check()).toContain(ticket.id);
    expect(await monitor.check()).not.toContain(ticket.id);
    const breached = await rpc<{ tickets: Ticket[] }>(
      admin,
      "listTickets",
      listReq({ slaBreachedOnly: true, requesterId: requester.id }),
      agent(),
    );
    expect(breached.tickets.map((t) => t.id)).toEqual([ticket.id]);
    expect(await outboxTypes(ticket.id)).toEqual(["TicketOpened", "TicketSlaBreached"]);
  });

  it("publishes ticket events to kade.ticket.events through Debezium", async () => {
    const requester = { kind: RequesterKind.REQUESTER_KIND_CUSTOMER, id: uuidv7(), name: "Kasun" };
    const { ticket } = await rpc<{ ticket: Ticket }>(support, "getOrStartConversation", {
      requester,
      orderId: "",
    });
    const consumer = new KafkaJS.Kafka({
      kafkaJS: { brokers: ["localhost:19092"], logLevel: KafkaJS.logLevel.ERROR },
    }).consumer({ kafkaJS: { groupId: `support-it-${uuidv7()}`, fromBeginning: true } });
    await consumer.connect();
    await consumer.subscribe({ topics: ["kade.ticket.events"] });
    const seen = new Promise<string>((resolve) => {
      void consumer.run({
        eachMessage: async ({ message }) => {
          if (message.key?.toString() === ticket.id) resolve(message.headers?.eventType?.toString() ?? "");
        },
      });
    });
    try {
      const type = await Promise.race([
        seen,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("no event on kade.ticket.events")), 45_000),
        ),
      ]);
      expect(type).toBe("kade.support.v1.TicketOpened");
    } finally {
      await consumer.disconnect();
    }
  });

  it("returns a clear error and keeps the ticket open when order is down", async () => {
    const customer = uuidv7();
    const order = deliveredOrder(customer, true);
    const requester = { kind: RequesterKind.REQUESTER_KIND_CUSTOMER, id: customer, name: "Dilini" };
    const { ticket } = await rpc<{ ticket: Ticket }>(
      support,
      "getOrStartConversation",
      { requester, orderId: order.id },
      md(customer, "customer"),
    );
    await new Promise<void>((resolve) => fake.tryShutdown(() => resolve()));

    const err = await rpc(
      admin,
      "resolveTicket",
      {
        ticketId: ticket.id,
        kind: ResolutionKind.RESOLUTION_KIND_REFUND,
        amount: rs(100),
        method: RefundMethod.REFUND_METHOD_CREDIT,
        note: "",
        agentId: "",
        agentName: "",
        idempotencyKey: uuidv7(),
      },
      agent(),
    ).then(
      () => expect.unreachable(),
      (e: ServiceError) => e,
    );
    expect(err.code).toBe(status.UNAVAILABLE);
    expect(err.details).toMatch(/couldn't reach the order service, so nothing was refunded/);
    const { rows } = await pool.query("select status from tickets where id = $1", [ticket.id]);
    expect(rows[0].status).toBe(TicketStatus.TICKET_STATUS_OPEN);
  });
});
