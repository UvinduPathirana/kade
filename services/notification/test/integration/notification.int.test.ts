// Integration test against the SHARED stack (pnpm infra:up): Postgres `notification` and Kafka.
// Notification publishes no events, so no outbox connector is needed. Defaults use this laptop's host
// ports (Postgres 15432, see docs/backend/RUNBOOK.md); override with DATABASE_URL / KAFKA_BROKERS.
import { credentials, Metadata, status, type ServiceError } from "@grpc/grpc-js";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import type { INestApplication } from "@nestjs/common";
import {
  Channel,
  NotificationServiceClient,
  NotificationStatus,
  RecipientKind,
  type ListNotificationsResponse,
  type SendNotificationRequest,
  type SendNotificationResponse,
} from "@kade/proto/kade/notification/v1/notification_service";
import { OrderPickedUp, OrderPlaced } from "@kade/proto/kade/order/v1/order_events";
import { OrderStatus } from "@kade/proto/kade/order/v1/order_service";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "../../src/app.js";
import { loadConfig } from "../../src/platform/config.js";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "../../src/platform/grpc/error-details.js";
import { GrpcServer } from "../../src/platform/grpc/grpc-server.js";
import { createLogger } from "../../src/platform/logger.js";

const config = loadConfig({
  SERVICE_NAME: "notification",
  DATABASE_URL: "postgres://notification:notification@localhost:15432/notification",
  KAFKA_BROKERS: "localhost:19092",
  LOG_LEVEL: "warn",
  ...process.env,
  GRPC_PORT: "0",
  HTTP_PORT: "0",
  OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
});

let app: INestApplication;
let client: NotificationServiceClient;
let pool: pg.Pool;
let producer: KafkaJS.Producer;

beforeAll(async () => {
  app = await startApp(config, createLogger(config));
  client = new NotificationServiceClient(
    `localhost:${app.get(GrpcServer).port}`,
    credentials.createInsecure(),
  );
  pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  producer = new KafkaJS.Kafka({
    kafkaJS: { brokers: config.KAFKA_BROKERS, logLevel: KafkaJS.logLevel.ERROR },
  }).producer();
  await producer.connect();
});

afterAll(async () => {
  client?.close();
  await producer?.disconnect();
  await pool?.end();
  await app?.close();
});

function staff(): Metadata {
  const md = new Metadata();
  md.set("x-user-id", "support-it");
  md.set("x-roles", "support");
  return md;
}

const call =
  <Req, Res>(
    method: (req: Req, md: Metadata, opts: object, cb: (e: ServiceError | null, r: Res) => void) => void,
  ) =>
  (req: Req, md = new Metadata()): Promise<Res> =>
    new Promise((resolve, reject) =>
      method.call(client, req, md, { deadline: Date.now() + 5_000 }, (err, res) =>
        err ? reject(err) : resolve(res),
      ),
    );

const send = (req: Partial<SendNotificationRequest>): Promise<SendNotificationResponse> =>
  call(client.sendNotification)({
    channel: Channel.CHANNEL_UNSPECIFIED,
    template: "",
    params: {},
    referenceId: "",
    transactional: false,
    idempotencyKey: "",
    ...req,
  } as SendNotificationRequest);
const list = (userId: string, md = staff()): Promise<ListNotificationsResponse> =>
  call(client.listNotifications)({ userId, referenceId: "", page: { pageSize: 10, pageToken: "" } }, md);

async function reasonOf(promise: Promise<unknown>): Promise<[status, string | undefined]> {
  const err = (await promise.then(
    () => expect.unreachable("expected the call to fail"),
    (e: unknown) => e,
  )) as ServiceError;
  const details = err.metadata.get(STATUS_DETAILS_KEY)[0];
  return [err.code, details ? decodeErrorInfo(details as Buffer)?.reason : undefined];
}

async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe("NotificationService over gRPC", () => {
  it("sends an OTP by SMS once per idempotency key and logs it for the user", async () => {
    const userId = uuidv7();
    const req = {
      channel: Channel.CHANNEL_SMS,
      recipient: {
        kind: RecipientKind.RECIPIENT_KIND_CUSTOMER,
        userId,
        phone: "+94771234567",
        email: "",
        name: "Dilini",
      },
      template: "otp",
      params: { code: "482193" },
      transactional: true,
      idempotencyKey: `otp:${userId}`,
    };
    const first = await send(req);
    expect(first.notification).toMatchObject({
      status: NotificationStatus.NOTIFICATION_STATUS_SENT,
      body: "482193 is your Kadé code. It expires in 5 minutes. Don't share it with anyone.",
      attempts: 1,
    });
    const again = await send(req);
    expect(again.notification?.id).toBe(first.notification?.id);

    const { notifications, page } = await list(userId);
    expect(notifications).toHaveLength(1);
    expect(page?.totalSize).toBe(1);
  });

  it("validates templates, recipients and who may read the log", async () => {
    const recipient = {
      kind: RecipientKind.RECIPIENT_KIND_CUSTOMER,
      userId: "u",
      phone: "",
      email: "",
      name: "",
    };
    expect(await reasonOf(send({ recipient, template: "nope" }))).toEqual([
      status.INVALID_ARGUMENT,
      "TEMPLATE_UNKNOWN",
    ]);
    expect(
      await reasonOf(
        send({ recipient, template: "otp", channel: Channel.CHANNEL_SMS, params: { code: "1" } }),
      ),
    ).toEqual([status.INVALID_ARGUMENT, "RECIPIENT_PHONE_REQUIRED"]);
    const md = new Metadata();
    md.set("x-user-id", "someone-else");
    md.set("x-roles", "customer");
    expect(await reasonOf(list("u", md))).toEqual([status.PERMISSION_DENIED, "PERMISSION_DENIED"]);
  });
});

describe("order events → customer messages", () => {
  it("tells the customer who is bringing the food, exactly once per event", async () => {
    const orderId = uuidv7();
    const customerId = uuidv7();
    const placedId = uuidv7();
    const pickedId = uuidv7();
    const placed = OrderPlaced.encode(
      OrderPlaced.fromPartial({
        orderId,
        order: {
          id: orderId,
          orderNumber: "KD-4821",
          status: OrderStatus.ORDER_STATUS_PLACED,
          customer: { id: customerId, name: "Dilini Perera", phone: "+94771234567" },
          restaurant: { id: "00000000-0000-7000-8000-000000000001", name: "Galle Road Kottu House" },
          rider: {
            riderId: "00000000-0000-7000-8001-000000000101",
            name: "Nimal Fernando",
            firstName: "Nimal",
          },
        },
      }),
    ).finish();
    const picked = OrderPickedUp.encode(
      OrderPickedUp.fromPartial({ orderId, orderNumber: "KD-4821", customerId }),
    ).finish();
    const msg = (id: string, type: string, value: Uint8Array) => ({
      key: orderId,
      value: Buffer.from(value),
      headers: { id, eventType: type },
    });
    await producer.send({
      topic: "kade.order.events",
      messages: [
        msg(placedId, "kade.order.v1.OrderPlaced", placed),
        msg(pickedId, "kade.order.v1.OrderPickedUp", picked),
        msg(pickedId, "kade.order.v1.OrderPickedUp", picked), // redelivery
      ],
    });

    const bodies = await eventually(async () => {
      const { rows } = await pool.query<{ body: string; channel: number; template: string }>(
        "select body, channel, template from notifications where reference_id = $1 order by id",
        [orderId],
      );
      return rows.length >= 2 ? rows : undefined;
    }, 45_000);
    // Let the duplicate land behind them on the same partition before counting.
    await new Promise((r) => setTimeout(r, 1_500));
    const { rows } = await pool.query(
      "select count(*)::int as n from notifications where reference_id = $1",
      [orderId],
    );
    expect(rows[0].n).toBe(2);
    expect(bodies.map((b) => b.body)).toEqual([
      "We've sent order KD-4821 to Galle Road Kottu House. We'll let you know as soon as they accept.",
      "Nimal is on the way with your order from Galle Road Kottu House.",
    ]);
    // No push device registered: falls back to SMS on the order's phone number.
    expect(bodies.every((b) => b.channel === Channel.CHANNEL_SMS)).toBe(true);
  });
});
