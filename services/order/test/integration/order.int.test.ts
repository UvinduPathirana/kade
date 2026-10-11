// Integration test against the SHARED stack (pnpm infra:up): Postgres `orders`, Kafka, Temporal
// (namespace kade) and, for the topic check, the Debezium connector outbox-order
// (deploy/compose/connect/register-outbox.sh order orders). Every dependency service runs as an
// in-process stub (<NAME>_MODE=stub), so this exercises the real saga: PlaceOrder → Temporal workflow
// → activities → Postgres + outbox, and kitchen/rider events from Kafka → consumer → workflow signals.
// Workflows run on a private task queue so a dev instance of the service can stay up.
import { credentials, Metadata, status, type ServiceError } from "@grpc/grpc-js";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import type { INestApplication } from "@nestjs/common";
import {
  DeliveryCompleted,
  DeliveryPickedUp,
  RiderAssigned,
} from "@kade/proto/kade/dispatch/v1/dispatch_events";
import { TicketAccepted, TicketHandedOver, TicketReady } from "@kade/proto/kade/merchant/v1/merchant_events";
import { OrderPlaced } from "@kade/proto/kade/order/v1/order_events";
import {
  GroupOrderServiceClient,
  GroupOrderStatus,
  ListOrdersRequest,
  OrderServiceClient,
  OrderStatus,
  RejectionReason,
  type Order,
  type PlaceOrderRequest,
} from "@kade/proto/kade/order/v1/order_service";
import { Client, Connection } from "@temporalio/client";
import { readFileSync } from "node:fs";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "../../src/app.js";
import { loadConfig } from "../../src/platform/config.js";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "../../src/platform/grpc/error-details.js";
import { GrpcServer } from "../../src/platform/grpc/grpc-server.js";
import { createLogger } from "../../src/platform/logger.js";

/** This laptop maps Postgres to another host port in deploy/compose/.env; follow it. */
function postgresHostPort(): string {
  try {
    const env = readFileSync(new URL("../../../../deploy/compose/.env", import.meta.url), "utf8");
    return /^POSTGRES_HOST_PORT=(\d+)/m.exec(env)?.[1] ?? "5432";
  } catch {
    return "5432";
  }
}

const ACCEPT_TIMEOUT_SECONDS = 12;
const config = loadConfig({
  SERVICE_NAME: "order",
  DATABASE_URL: `postgres://order:order@localhost:${postgresHostPort()}/orders`,
  KAFKA_BROKERS: "localhost:19092",
  TEMPORAL_ADDRESS: "localhost:7233",
  LOG_LEVEL: "warn",
  ...process.env,
  GRPC_PORT: "0",
  HTTP_PORT: "0",
  OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
  TEMPORAL_TASK_QUEUE: `order-it-${Date.now()}`,
  ACCEPT_TIMEOUT_SECONDS: String(ACCEPT_TIMEOUT_SECONDS),
  CATALOG_MODE: "stub",
  PROFILE_MODE: "stub",
  PRICING_MODE: "stub",
  PROMOTION_MODE: "stub",
  PAYMENT_MODE: "stub",
});

const RESTAURANT = "00000000-0000-7000-8000-000000000001";
const CUSTOMER = "00000000-0000-7000-8005-000000000001";
const RIDER = "00000000-0000-7000-8001-000000000101";

let app: INestApplication;
let orders: OrderServiceClient;
let groups: GroupOrderServiceClient;
let pool: pg.Pool;
let kafka: KafkaJS.Kafka;
let producer: KafkaJS.Producer;
let temporal: Client;
let temporalConnection: Connection;

beforeAll(async () => {
  app = await startApp(config, createLogger(config));
  const address = `localhost:${app.get(GrpcServer).port}`;
  orders = new OrderServiceClient(address, credentials.createInsecure());
  groups = new GroupOrderServiceClient(address, credentials.createInsecure());
  pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  kafka = new KafkaJS.Kafka({ kafkaJS: { brokers: config.KAFKA_BROKERS, logLevel: KafkaJS.logLevel.ERROR } });
  producer = kafka.producer();
  await producer.connect();
  temporalConnection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
  temporal = new Client({ connection: temporalConnection, namespace: config.TEMPORAL_NAMESPACE });
  await waitForConsumer();
}, 120_000);

afterAll(async () => {
  orders?.close();
  groups?.close();
  await producer?.disconnect();
  await pool?.end();
  await temporalConnection?.close();
  await app?.close();
});

// ---------------------------------------------------------------- helpers

function md(userId = CUSTOMER, roles = "customer"): Metadata {
  const m = new Metadata();
  m.set("x-user-id", userId);
  m.set("x-roles", roles);
  return m;
}

function rpc<Req, Res>(client: object, method: string, request: Req, meta = md()): Promise<Res> {
  return new Promise((resolve, reject) =>
    (client as Record<string, (...args: unknown[]) => unknown>)[method]!.call(
      client,
      request,
      meta,
      { deadline: Date.now() + 25_000 },
      (err: Error | null, res: Res) => (err ? reject(err) : resolve(res)),
    ),
  );
}

function request(overrides: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest {
  return {
    customerId: CUSTOMER,
    restaurantId: RESTAURANT,
    mode: 1,
    lines: [
      { key: "l1", itemId: "item-0001", quantity: 2, options: [], note: "" },
      { key: "l2", itemId: "item-0002", quantity: 1, options: [], note: "No leeks" },
    ],
    address: {
      id: "",
      label: "Home",
      line: "42 Flower Road",
      area: "Kollupitiya",
      note: "",
      location: { lat: 6.91, lng: 79.86 },
      zoneId: "",
    },
    riderNote: "",
    kitchenNote: "",
    cutlery: false,
    payment: { kind: 1, cardId: "card-1", cardBrand: 1, cardLast4: "4242" },
    promoCode: "",
    tip: { amountMinor: 10_000, currency: "LKR" },
    useCredit: false,
    substitution: 0,
    groupId: "",
    idempotencyKey: uuidv7(),
    ...overrides,
  };
}

const place = (r: PlaceOrderRequest) =>
  rpc<PlaceOrderRequest, { order: Order }>(orders, "placeOrder", r).then((x) => x.order);
const get = (orderId: string) =>
  rpc<object, { order: Order }>(orders, "getOrder", { orderId, orderNumber: "" }).then((x) => x.order);

async function grpcError(promise: Promise<unknown>): Promise<{ code: status; reason: string | undefined }> {
  const err = (await promise.then(
    () => expect.unreachable("expected the call to fail"),
    (e: unknown) => e,
  )) as ServiceError;
  const details = err.metadata.get(STATUS_DETAILS_KEY)[0];
  return { code: err.code, reason: details ? decodeErrorInfo(details as Buffer)?.reason : undefined };
}

async function eventually<T>(fn: () => Promise<T | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 200));
  }
}

const statusIs = (orderId: string, s: OrderStatus, timeoutMs?: number) =>
  eventually(async () => {
    const o = await get(orderId);
    return o.status === s && o;
  }, timeoutMs);

async function send(
  topic: string,
  key: string,
  type: string,
  payload: Uint8Array,
  id = uuidv7(),
): Promise<string> {
  await producer.send({
    topic,
    messages: [{ key, value: Buffer.from(payload), headers: { id, eventType: type } }],
  });
  return id;
}

const ticket = (orderId: string) => ({
  outletId: RESTAURANT,
  orderId,
  orderNumber: "",
  occurredAt: new Date(),
});
const kitchenAccepts = (orderId: string) =>
  send(
    "kade.merchant.events",
    RESTAURANT,
    "kade.merchant.v1.TicketAccepted",
    TicketAccepted.encode({ ...ticket(orderId), prepMinutes: 12 }).finish(),
  );

/** The consumer group has partitions and is reading: a probe event lands in processed_events. */
async function waitForConsumer(): Promise<void> {
  const id = await send(
    "kade.merchant.events",
    RESTAURANT,
    "kade.merchant.v1.TicketReady",
    TicketReady.encode(ticket(uuidv7())).finish(),
  );
  await eventually(
    async () => (await pool.query("select 1 from processed_events where event_id = $1", [id])).rowCount,
    90_000,
  );
}

// ---------------------------------------------------------------- tests

describe("PlaceOrder → Temporal saga", () => {
  it("card delivery: placed, accepted, rider, picked up (captured), delivered; workflow completes", async () => {
    const placed = await place(request());
    expect(placed).toMatchObject({
      status: OrderStatus.ORDER_STATUS_PLACED,
      orderNumber: expect.stringMatching(/^KD-\d+$/),
    });
    expect(placed.totals?.total?.amountMinor).toBe(325_000); // 3 × Rs 1,000 + Rs 150 delivery + Rs 100 tip
    expect(placed.paymentId).toBe(`stub-pay-${placed.id}`);
    expect(placed.acceptBy!.getTime() - placed.placedAt!.getTime()).toBe(ACCEPT_TIMEOUT_SECONDS * 1000);

    const handle = temporal.workflow.getHandle(placed.id);
    expect((await handle.describe()).status.name).toBe("RUNNING");

    const { rows } = await pool.query(
      "select type, payload from outbox where aggregateid = $1 order by created_at",
      [placed.id],
    );
    expect(rows.map((r) => r.type)).toEqual(["kade.order.v1.OrderPlaced"]);
    expect(OrderPlaced.decode(rows[0].payload).order?.lines).toHaveLength(2);

    await kitchenAccepts(placed.id);
    await statusIs(placed.id, OrderStatus.ORDER_STATUS_PREPARING);

    const deliveryId = uuidv7();
    await send(
      "kade.delivery.events",
      deliveryId,
      "kade.dispatch.v1.RiderAssigned",
      RiderAssigned.encode({
        deliveryId,
        orderId: placed.id,
        orderNumber: placed.orderNumber,
        restaurantId: RESTAURANT,
        rider: {
          riderId: RIDER,
          name: "Nimal Perera",
          firstName: "Nimal",
          rating: 4.9,
          vehicle: "Bajaj Pulsar",
          plate: "WP BCD-4521",
          maskedPhone: "",
          phone: "",
        },
        reassigned: false,
        reason: "",
      }).finish(),
    );
    await eventually(async () => (await get(placed.id)).rider?.riderId === RIDER);

    await send(
      "kade.delivery.events",
      deliveryId,
      "kade.dispatch.v1.DeliveryPickedUp",
      DeliveryPickedUp.encode({
        deliveryId,
        orderId: placed.id,
        restaurantId: RESTAURANT,
        riderId: RIDER,
        sealed: true,
      }).finish(),
    );
    await statusIs(placed.id, OrderStatus.ORDER_STATUS_PICKED_UP);
    await send(
      "kade.delivery.events",
      deliveryId,
      "kade.dispatch.v1.DeliveryCompleted",
      DeliveryCompleted.encode({
        deliveryId,
        orderId: placed.id,
        orderNumber: placed.orderNumber,
        riderId: RIDER,
        proof: 0,
        km: 3,
        zoneId: "c03",
      }).finish(),
    );
    const delivered = await statusIs(placed.id, OrderStatus.ORDER_STATUS_DELIVERED);

    expect(await handle.result()).toEqual({ outcome: "DELIVERED" });
    expect(delivered.deliveryId).toBe(deliveryId);
    expect(delivered.timeline.map((t) => t.label)).toEqual(
      expect.arrayContaining([
        "Order placed",
        "Accepted by the kitchen (12 min)",
        "Picked up by Nimal",
        "Delivered",
      ]),
    );
    expect(delivered.timeline.some((t) => t.label.startsWith("Card charged"))).toBe(true);
    const types = (
      await pool.query("select type from outbox where aggregateid = $1 order by created_at, id", [placed.id])
    ).rows.map((r) => r.type.replace("kade.order.v1.", ""));
    expect(types).toEqual([
      "OrderPlaced",
      "OrderAccepted",
      "OrderPreparing",
      "OrderRiderChanged",
      "OrderPickedUp",
      "OrderDelivered",
    ]);
  });

  it("pickup, cash: collected when the kitchen hands it over", async () => {
    const placed = await place(
      request({
        mode: 2,
        address: undefined,
        tip: undefined,
        payment: { kind: 2, cardId: "", cardBrand: 0, cardLast4: "" },
      }),
    );
    await kitchenAccepts(placed.id);
    await statusIs(placed.id, OrderStatus.ORDER_STATUS_PREPARING);
    await send(
      "kade.merchant.events",
      RESTAURANT,
      "kade.merchant.v1.TicketReady",
      TicketReady.encode(ticket(placed.id)).finish(),
    );
    await statusIs(placed.id, OrderStatus.ORDER_STATUS_READY);
    await send(
      "kade.merchant.events",
      RESTAURANT,
      "kade.merchant.v1.TicketHandedOver",
      TicketHandedOver.encode(ticket(placed.id)).finish(),
    );
    await statusIs(placed.id, OrderStatus.ORDER_STATUS_COLLECTED);
    expect(await temporal.workflow.getHandle(placed.id).result()).toEqual({ outcome: "COLLECTED" });
  });

  it("is idempotent on idempotency_key; a different body with the same key is refused", async () => {
    const r = request();
    const first = await place(r);
    const again = await place(r);
    expect(again.id).toBe(first.id);
    expect(await grpcError(place({ ...r, promoCode: "KADE100" }))).toEqual({
      code: status.FAILED_PRECONDITION,
      reason: "IDEMPOTENCY_KEY_REUSED",
    });
    await rpc(orders, "cancelOrder", {
      orderId: first.id,
      cancelledBy: 1,
      reason: "test",
      fault: 0,
      refund: false,
      by: "",
      idempotencyKey: "",
    });
  });

  it("declined card: FAILED_PRECONDITION PAYMENT_DECLINED, order kept as FAILED", async () => {
    const r = request({ payment: { kind: 1, cardId: "card-2", cardBrand: 1, cardLast4: "0002" } });
    expect(await grpcError(place(r))).toEqual({
      code: status.FAILED_PRECONDITION,
      reason: "PAYMENT_DECLINED",
    });
    const { rows } = await pool.query("select id, status from orders where idempotency_key = $1", [
      r.idempotencyKey,
    ]);
    expect(rows[0].status).toBe(OrderStatus.ORDER_STATUS_FAILED);
    // The retry returns the same failure.
    expect((await grpcError(place(r))).reason).toBe("PAYMENT_DECLINED");
  });

  it("validation failures: sold out, bad promo, price changed", async () => {
    expect(
      (
        await grpcError(
          place(request({ lines: [{ key: "x", itemId: "soldout-1", quantity: 1, options: [], note: "" }] })),
        )
      ).reason,
    ).toBe("ITEM_SOLD_OUT");
    expect((await grpcError(place(request({ promoCode: "NOPE" })))).reason).toBe("PROMO_NOT_FOUND");
    expect(
      (await grpcError(place(request({ expectedTotal: { amountMinor: 1, currency: "LKR" } })))).reason,
    ).toBe("PRICE_CHANGED");
    expect((await grpcError(place(request({ lines: [] })))).reason).toBe("CART_EMPTY");
  });

  it("customer cancels before the kitchen accepts; can't after", async () => {
    const placed = await place(request({ promoCode: "KADE100" }));
    const { order } = await rpc<object, { order: Order }>(orders, "cancelOrder", {
      orderId: placed.id,
      cancelledBy: 1,
      reason: "Changed my mind",
      fault: 0,
      refund: false,
      by: "",
      idempotencyKey: "",
    });
    expect(order.status).toBe(OrderStatus.ORDER_STATUS_CANCELLED);
    expect(await temporal.workflow.getHandle(placed.id).result()).toMatchObject({ outcome: "CANCELLED" });

    const second = await place(request());
    await kitchenAccepts(second.id);
    await statusIs(second.id, OrderStatus.ORDER_STATUS_PREPARING);
    expect(
      (
        await grpcError(
          rpc(orders, "cancelOrder", {
            orderId: second.id,
            cancelledBy: 1,
            reason: "",
            fault: 0,
            refund: false,
            by: "",
            idempotencyKey: "",
          }),
        )
      ).reason,
    ).toBe("ORDER_ALREADY_STARTED");
    // Ops can, with a refund flag.
    const ops = await rpc<object, { order: Order }>(
      orders,
      "cancelOrder",
      {
        orderId: second.id,
        cancelledBy: 2,
        reason: "Kitchen fire",
        fault: 2,
        refund: true,
        by: "Ops",
        idempotencyKey: "",
      },
      md("ops-1", "ops"),
    );
    expect(ops.order.status).toBe(OrderStatus.ORDER_STATUS_CANCELLED);
  });

  it(`kitchen silent for ${ACCEPT_TIMEOUT_SECONDS}s: REJECTED with TIMEOUT`, async () => {
    const placed = await place(request());
    const rejected = await statusIs(
      placed.id,
      OrderStatus.ORDER_STATUS_REJECTED,
      (ACCEPT_TIMEOUT_SECONDS + 15) * 1000,
    );
    expect(rejected.rejection?.reason).toBe(RejectionReason.REJECTION_REASON_TIMEOUT);
  }, 60_000);

  it("refund to credit after delivery is recorded and listed", async () => {
    const placed = await place(request());
    const { order, refund } = await rpc<object, { order: Order; refund: { id: string } }>(
      orders,
      "refundOrder",
      {
        orderId: placed.id,
        amount: { amountMinor: 45_000, currency: "LKR" },
        method: 2,
        reason: "Missing dish",
        by: "Agent",
        ticketId: "",
        idempotencyKey: uuidv7(),
      },
      md("agent-1", "support"),
    );
    expect(order.refunded?.amountMinor).toBe(45_000);
    const listed = await rpc<object, { refunds: { id: string }[] }>(orders, "listOrderRefunds", {
      orderId: placed.id,
    });
    expect(listed.refunds.map((r) => r.id)).toEqual([refund.id]);
    await rpc(orders, "cancelOrder", {
      orderId: placed.id,
      cancelledBy: 1,
      reason: "test",
      fault: 0,
      refund: false,
      by: "",
      idempotencyKey: "",
    });
  });

  it("lists a customer's orders newest first and finds the active one", async () => {
    const placed = await place(request());
    const { orders: mine } = await rpc<object, { orders: Order[] }>(
      orders,
      "listOrders",
      ListOrdersRequest.fromPartial({ page: { pageSize: 5, pageToken: "" } }),
    );
    expect(mine[0]?.id).toBe(placed.id);
    expect(mine.every((o) => o.customer?.id === CUSTOMER)).toBe(true);
    const active = await rpc<object, { order?: Order }>(orders, "getActiveOrder", { customerId: CUSTOMER });
    expect(active.order?.id).toBe(placed.id);
    await rpc(orders, "cancelOrder", {
      orderId: placed.id,
      cancelledBy: 1,
      reason: "test",
      fault: 0,
      refund: false,
      by: "",
      idempotencyKey: "",
    });
  });
});

describe("group orders", () => {
  it("create → join → dishes (limit enforced) → host places → group PLACED", async () => {
    const { group } = await rpc<object, { group: { id: string; shareToken: string } }>(
      groups,
      "createGroupOrder",
      {
        hostCustomerId: CUSTOMER,
        hostName: "Dilini",
        restaurantId: RESTAURANT,
        minutes: 30,
        limit: { amountMinor: 200_000, currency: "LKR" },
        idempotencyKey: uuidv7(),
      },
    );
    const joined = await rpc<object, { memberId: string }>(
      groups,
      "joinGroupOrder",
      { shareToken: group.shareToken, customerId: "", name: "Ishara" },
      md("guest-1", "customer"),
    );
    expect(joined.memberId).toBeTruthy();
    const over = rpc(groups, "setGroupMemberLines", {
      groupId: group.id,
      memberId: joined.memberId,
      lines: [{ key: "", itemId: "item-1", quantity: 3, options: [], note: "" }],
    });
    expect((await grpcError(over)).reason).toBe("GROUP_LIMIT_EXCEEDED");
    const ok = await rpc<object, { group: { members: { subtotal: { amountMinor: number } }[] } }>(
      groups,
      "setGroupMemberLines",
      {
        groupId: group.id,
        memberId: joined.memberId,
        lines: [{ key: "", itemId: "item-1", quantity: 2, options: [], note: "" }],
      },
    );
    expect(ok.group.members[0]?.subtotal.amountMinor).toBe(200_000);

    const placed = await place(request({ groupId: group.id }));
    await eventually(async () => {
      const { rows } = await pool.query("select status from group_orders where id = $1", [group.id]);
      return rows[0].status === GroupOrderStatus.GROUP_ORDER_STATUS_PLACED;
    });
    expect(
      (await grpcError(rpc(groups, "getGroupOrder", { groupId: group.id, shareToken: "" }))).reason,
    ).toBe("GROUP_CLOSED");
    await rpc(orders, "cancelOrder", {
      orderId: placed.id,
      cancelledBy: 1,
      reason: "test",
      fault: 0,
      refund: false,
      by: "",
      idempotencyKey: "",
    });
  });
});
