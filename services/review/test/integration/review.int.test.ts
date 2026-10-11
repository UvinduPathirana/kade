// Integration test against the SHARED stack (pnpm infra:up): Postgres `review`, Kafka and the Debezium
// connector outbox-review (deploy/compose/connect/register-outbox.sh review review). Defaults use this
// laptop's host ports (Postgres 15432); override with DATABASE_URL / KAFKA_BROKERS.
import { credentials, Metadata, status, type ServiceError } from "@grpc/grpc-js";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import type { INestApplication } from "@nestjs/common";
import { OrderDelivered } from "@kade/proto/kade/order/v1/order_events";
import { OrderStatus } from "@kade/proto/kade/order/v1/order_service";
import { OrderRated, RestaurantRatingChanged } from "@kade/proto/kade/review/v1/review_events";
import {
  ReviewServiceClient,
  Thumb,
  type SubmitOrderRatingRequest,
} from "@kade/proto/kade/review/v1/review_service";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "../../src/app.js";
import { loadConfig } from "../../src/platform/config.js";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "../../src/platform/grpc/error-details.js";
import { GrpcServer } from "../../src/platform/grpc/grpc-server.js";
import { createLogger } from "../../src/platform/logger.js";
import { NIMAL, restaurantId } from "../../src/seed/seed.js";

const config = loadConfig({
  SERVICE_NAME: "review",
  DATABASE_URL: "postgres://review:review@localhost:15432/review",
  KAFKA_BROKERS: "localhost:19092",
  LOG_LEVEL: "warn",
  ...process.env,
  ORDER_GRPC: undefined, // events only: no fallback to a running order service
  GRPC_PORT: "0",
  HTTP_PORT: "0",
  OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
});
const KOTTU_HOUSE = restaurantId(1);

let app: INestApplication;
let client: ReviewServiceClient;
let pool: pg.Pool;
let kafka: KafkaJS.Kafka;
let producer: KafkaJS.Producer;

beforeAll(async () => {
  app = await startApp(config, createLogger(config));
  client = new ReviewServiceClient(`localhost:${app.get(GrpcServer).port}`, credentials.createInsecure());
  pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  kafka = new KafkaJS.Kafka({ kafkaJS: { brokers: config.KAFKA_BROKERS, logLevel: KafkaJS.logLevel.ERROR } });
  producer = kafka.producer();
  await producer.connect();
});

afterAll(async () => {
  client?.close();
  await producer?.disconnect();
  await pool?.end();
  await app?.close();
});

function md(userId: string, roles: string, outletId?: string): Metadata {
  const m = new Metadata();
  m.set("x-user-id", userId);
  m.set("x-roles", roles);
  if (outletId) m.set("x-outlet-id", outletId);
  return m;
}

function rpc<Res>(method: string, req: object, meta = new Metadata()): Promise<Res> {
  return new Promise((resolve, reject) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any)[method](
      req,
      meta,
      { deadline: Date.now() + 5_000 },
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

async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function deliver(orderId: string, customerId: string): Promise<void> {
  const order = OrderDelivered.fromPartial({
    orderId,
    order: {
      id: orderId,
      orderNumber: "KD-4821",
      status: OrderStatus.ORDER_STATUS_DELIVERED,
      customer: { id: customerId, name: "Dilini Perera", phone: "+94771234567" },
      restaurant: { id: KOTTU_HOUSE, name: "Galle Road Kottu House" },
      rider: { riderId: NIMAL, name: "Nimal Fernando", firstName: "Nimal" },
      address: { area: "Kollupitiya" },
      lines: [
        { key: "l1", itemId: "cheese-kottu", name: "Cheese kottu", quantity: 2 },
        { key: "l2", itemId: "faluda", name: "Faluda", quantity: 1 },
      ],
      deliveredAt: new Date(),
    },
  });
  await producer.send({
    topic: "kade.order.events",
    messages: [
      {
        key: orderId,
        value: Buffer.from(OrderDelivered.encode(order).finish()),
        headers: { id: uuidv7(), eventType: "kade.order.v1.OrderDelivered" },
      },
    ],
  });
  await eventually(async () => {
    const { rows } = await pool.query("select 1 from rateable_orders where order_id = $1", [orderId]);
    return rows[0];
  }, 45_000);
}

describe("seeded demo data", () => {
  it("lists the restaurant app's reviews newest first, with replies", async () => {
    const res = await rpc<{ reviews: { customerName: string; stars: number; reply?: { text: string } }[] }>(
      "listRestaurantReviews",
      {
        restaurantId: KOTTU_HOUSE,
        withTextOnly: false,
        unrepliedOnly: false,
        maxStars: 0,
        page: { pageSize: 100, pageToken: "" },
      },
    );
    const seeded = res.reviews.filter((r) =>
      ["Shehani", "Dilan", "Ravindu", "Aisha"].includes(r.customerName),
    );
    expect(seeded.slice(0, 4).map((r) => r.customerName)).toEqual(["Shehani", "Dilan", "Ravindu", "Aisha"]);
    expect(seeded[2]?.reply?.text).toMatch(/^Thank you Ravindu/);

    const low = await rpc<{ reviews: { stars: number }[] }>("listRestaurantReviews", {
      restaurantId: KOTTU_HOUSE,
      withTextOnly: true,
      unrepliedOnly: true,
      maxStars: 2,
      page: { pageSize: 100, pageToken: "" },
    });
    expect(low.reviews.length).toBeGreaterThanOrEqual(2);
    expect(low.reviews.every((r) => r.stars <= 2)).toBe(true);
  });

  it("starts summaries from the apps' rating history", async () => {
    const { summary } = await rpc<{ summary: { average: number; count: number } }>(
      "getRestaurantRatingSummary",
      {
        restaurantId: KOTTU_HOUSE,
      },
    );
    expect(summary.count).toBeGreaterThanOrEqual(3140);
    expect(summary.average).toBeCloseTo(4.8, 1);

    const rider = await rpc<{
      summary: { average: number; count: number; breakdown: number[] };
      compliments: { label: string }[];
      recent: unknown[];
    }>("getRiderRatingsSummary", { riderId: NIMAL });
    expect(rider.summary.count).toBeGreaterThanOrEqual(1284);
    expect(rider.summary.average).toBeCloseTo(4.9, 1);
    expect(rider.summary.breakdown.reduce((a, b) => a + b, 0)).toBe(100);
    expect(rider.compliments[0]?.label).toBe("Friendly");
    expect(rider.recent.length).toBeGreaterThanOrEqual(4);
  });
});

describe("rating a delivered order", () => {
  const customer = uuidv7();
  const orderId = uuidv7();
  const rating = (patch: Partial<SubmitOrderRatingRequest> = {}): SubmitOrderRatingRequest => ({
    orderId,
    customerId: customer,
    riderStars: 5,
    riderTags: ["Friendly", "Careful with the food"],
    dishes: [{ itemId: "cheese-kottu", itemName: "", thumb: Thumb.THUMB_UP }],
    restaurantStars: 4,
    comment: "Hot and spicy, like it should be.",
    idempotencyKey: "",
    ...patch,
  });

  it("refuses an order that hasn't arrived", async () => {
    expect(await reasonOf(rpc("submitOrderRating", rating(), md(customer, "customer")))).toEqual([
      status.FAILED_PRECONDITION,
      "ORDER_NOT_RATEABLE",
    ]);
  });

  it("stores the rating, publishes it and opens a public review the outlet can answer", async () => {
    await deliver(orderId, customer);
    expect(await reasonOf(rpc("submitOrderRating", rating(), md(uuidv7(), "customer")))).toEqual([
      status.PERMISSION_DENIED,
      "NOT_YOUR_ORDER",
    ]);

    const key = uuidv7();
    const first = await rpc<{ rating: { riderStars: number; dishes: { itemName: string }[] } }>(
      "submitOrderRating",
      rating({ idempotencyKey: key }),
      md(customer, "customer"),
    );
    expect(first.rating.riderStars).toBe(5);
    expect(first.rating.dishes[0]?.itemName).toBe("Cheese kottu");
    await rpc("submitOrderRating", rating({ idempotencyKey: key }), md(customer, "customer")); // retried

    const { rows: events } = await pool.query<{ type: string; aggregateid: string; payload: Buffer }>(
      "select type, aggregateid, payload from outbox where aggregateid in ($1, $2, $3) and created_at > now() - interval '1 minute' order by created_at",
      [orderId, KOTTU_HOUSE, NIMAL],
    );
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "kade.review.v1.OrderRated")).toHaveLength(1);
    expect(types).toContain("kade.review.v1.RestaurantRatingChanged");
    expect(types).toContain("kade.review.v1.RiderRatingChanged");
    const rated = OrderRated.decode(events.find((e) => e.type === "kade.review.v1.OrderRated")!.payload);
    expect(rated.rating?.restaurantStars).toBe(4);
    const changed = RestaurantRatingChanged.decode(
      events.find((e) => e.type === "kade.review.v1.RestaurantRatingChanged")!.payload,
    );
    expect(changed.summary!.count).toBeGreaterThan(3140);

    const batch = await rpc<{ ratings: { orderId: string; riderTags: string[] }[] }>("batchGetOrderRatings", {
      orderIds: [orderId, uuidv7()],
    });
    expect(batch.ratings).toEqual([
      expect.objectContaining({ orderId, riderTags: ["Friendly", "Careful with the food"] }),
    ]);

    const { reviews } = await rpc<{ reviews: { id: string; orderId: string; customerName: string }[] }>(
      "listRestaurantReviews",
      {
        restaurantId: KOTTU_HOUSE,
        withTextOnly: false,
        unrepliedOnly: true,
        maxStars: 0,
        page: { pageSize: 5, pageToken: "" },
      },
    );
    const mine = reviews.find((r) => r.orderId === orderId)!;
    expect(mine.customerName).toBe("Dilini P.");

    expect(
      await reasonOf(
        rpc(
          "replyToReview",
          { reviewId: mine.id, text: "Thanks!", by: "Kasun" },
          md("u", "merchant_staff", restaurantId(2)),
        ),
      ),
    ).toEqual([status.PERMISSION_DENIED, "REVIEW_NOT_YOURS"]);
    const replied = await rpc<{ review: { reply?: { text: string; by: string } } }>(
      "replyToReview",
      { reviewId: mine.id, text: "Thank you Dilini, see you soon.", by: "Ruwan" },
      md("ruwan", "merchant_owner", KOTTU_HOUSE),
    );
    expect(replied.review.reply).toMatchObject({ text: "Thank you Dilini, see you soon.", by: "Ruwan" });

    // Replacing within 7 days keeps one review and its reply.
    await rpc("submitOrderRating", rating({ restaurantStars: 5 }), md(customer, "customer"));
    const { rows } = await pool.query("select stars, reply_text from reviews where order_id = $1", [orderId]);
    expect(rows).toEqual([{ stars: 5, reply_text: "Thank you Dilini, see you soon." }]);

    const dishes = await rpc<{ dishes: { itemId: string; up: number }[] }>("getDishRatings", {
      restaurantId: KOTTU_HOUSE,
    });
    expect(dishes.dishes.find((d) => d.itemId === "cheese-kottu")?.up).toBeGreaterThanOrEqual(1);
  });

  it("publishes rating events to kade.review.events through Debezium", async () => {
    const consumer = kafka.consumer({ kafkaJS: { groupId: `review-it-${uuidv7()}`, fromBeginning: true } });
    await consumer.connect();
    await consumer.subscribe({ topics: ["kade.review.events"] });
    const seen = new Promise<string>((resolve) => {
      void consumer.run({
        eachMessage: async ({ message }) => {
          if (message.key?.toString() === orderId) resolve(message.headers?.eventType?.toString() ?? "");
        },
      });
    });
    try {
      const type = await Promise.race([
        seen,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("no event on kade.review.events")), 45_000),
        ),
      ]);
      expect(type).toBe("kade.review.v1.OrderRated");
    } finally {
      await consumer.disconnect();
    }
  });
});
