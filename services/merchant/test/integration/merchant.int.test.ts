// Integration test against the SHARED stack (pnpm infra:up): Postgres merchant, Kafka and the
// Debezium connector outbox-merchant (deploy/compose/connect/register-outbox.sh merchant merchant).
// Override addresses with DATABASE_URL / KAFKA_BROKERS when your host ports differ (this laptop:
// DATABASE_URL=postgres://merchant:merchant@localhost:15432/merchant).
import { credentials, Metadata, status, type ServiceError } from "@grpc/grpc-js";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import type { INestApplication } from "@nestjs/common";
import { ApplicationStatus } from "@kade/proto/kade/common/v1/onboarding";
import { RiderArrivedAtRestaurant, RiderAssigned } from "@kade/proto/kade/dispatch/v1/dispatch_events";
import {
  OutletStatusChanged,
  PartnerApplicationDecided,
  TicketAccepted,
} from "@kade/proto/kade/merchant/v1/merchant_events";
import {
  BusinessType,
  KitchenServiceClient,
  OutletAdminServiceClient,
  OutletAdminStatus,
  OutletServiceClient,
  OutletStaffRole,
  OutletStaffServiceClient,
  PartnerApplicationServiceClient,
  TicketStatus,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import { OrderPlaced, OrderRejected } from "@kade/proto/kade/order/v1/order_events";
import { OrderStatus, RejectionReason } from "@kade/proto/kade/order/v1/order_service";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "../../src/app.js";
import { EVENT } from "../../src/domain/merchant-events.js";
import { ORDER_EVENTS } from "../../src/kitchen/order-events.consumer.js";
import { DELIVERY_EVENTS } from "../../src/kitchen/delivery-events.consumer.js";
import { loadConfig } from "../../src/platform/config.js";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "../../src/platform/grpc/error-details.js";
import { GrpcServer } from "../../src/platform/grpc/grpc-server.js";
import { createLogger } from "../../src/platform/logger.js";
import { order } from "../fixtures.js";

const config = loadConfig({
  SERVICE_NAME: "merchant",
  DATABASE_URL: "postgres://merchant:merchant@localhost:15432/merchant",
  KAFKA_BROKERS: "localhost:19092",
  LOG_LEVEL: "warn",
  ...process.env,
  GRPC_PORT: "0",
  HTTP_PORT: "0",
  HOUSEKEEPING_INTERVAL_MS: "0",
  CATALOG_GRPC: undefined,
  OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
});

const OUTLET = "00000000-0000-7000-8000-000000000001"; // Galle Road Kottu House
const OUTLET_2 = "00000000-0000-7000-8000-000000000002";
const RUWAN = "00000000-0000-7000-8005-000000000002";
const KASUN = "00000000-0000-7000-8005-000000000003";

let app: INestApplication;
let kitchen: KitchenServiceClient;
let outlets: OutletServiceClient;
let staff: OutletStaffServiceClient;
let applications: PartnerApplicationServiceClient;
let admin: OutletAdminServiceClient;
let pool: pg.Pool;
let kafka: KafkaJS.Kafka;
let producer: KafkaJS.Producer;

beforeAll(async () => {
  app = await startApp(config, createLogger(config));
  const address = `localhost:${app.get(GrpcServer).port}`;
  const insecure = credentials.createInsecure();
  kitchen = new KitchenServiceClient(address, insecure);
  outlets = new OutletServiceClient(address, insecure);
  staff = new OutletStaffServiceClient(address, insecure);
  applications = new PartnerApplicationServiceClient(address, insecure);
  admin = new OutletAdminServiceClient(address, insecure);
  pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  kafka = new KafkaJS.Kafka({ kafkaJS: { brokers: config.KAFKA_BROKERS, logLevel: KafkaJS.logLevel.ERROR } });
  producer = kafka.producer();
  await producer.connect();
  // Known starting point for the shared seeded outlet.
  await call(outlets, "setBusyMode", { outletId: OUTLET, busyExtraMinutes: 0 }, as(RUWAN));
  await call(outlets, "resumeOutlet", { outletId: OUTLET }, as(RUWAN));
});

afterAll(async () => {
  await call(outlets, "setBusyMode", { outletId: OUTLET, busyExtraMinutes: 0 }, as(RUWAN)).catch(
    () => undefined,
  );
  await call(outlets, "resumeOutlet", { outletId: OUTLET }, as(RUWAN)).catch(() => undefined);
  for (const c of [kitchen, outlets, staff, applications, admin]) c?.close();
  await producer?.disconnect();
  await pool?.end();
  await app?.close();
});

// ---------- helpers ----------

function as(userId: string, roles = "merchant_owner,merchant_staff", outletId?: string): Metadata {
  const md = new Metadata();
  md.set("x-user-id", userId);
  md.set("x-roles", roles);
  if (outletId) md.set("x-outlet-id", outletId);
  return md;
}
const ops = () => as("00000000-0000-7000-8005-000000000005", "ops");
const kasun = () => as(KASUN, "merchant_staff", OUTLET);

type Unary<Req, Res> = (
  req: Req,
  md: Metadata,
  opts: { deadline: number },
  cb: (e: ServiceError | null, r: Res) => void,
) => unknown;
function call<C, K extends keyof C>(
  client: C,
  method: K,
  request: C[K] extends Unary<infer Req, unknown> ? Req : never,
  md: Metadata,
): Promise<C[K] extends Unary<never, infer Res> ? Res : never> {
  const fn = (client[method] as unknown as Unary<unknown, never>).bind(client);
  return new Promise((resolve, reject) =>
    fn(request, md, { deadline: Date.now() + 5_000 }, (err, res) => (err ? reject(err) : resolve(res))),
  );
}

async function grpcError(promise: Promise<unknown>): Promise<{ code: status; reason: string | undefined }> {
  const err = (await promise.then(
    () => expect.unreachable("expected the call to fail"),
    (e: unknown) => e,
  )) as ServiceError;
  const details = err.metadata?.get(STATUS_DETAILS_KEY)[0];
  return { code: err.code, reason: details ? decodeErrorInfo(details as Buffer)?.reason : undefined };
}

async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function publish(
  topic: string,
  key: string,
  eventType: string,
  payload: Uint8Array,
  eventId = uuidv7(),
) {
  await producer.send({
    topic,
    messages: [{ key, value: Buffer.from(payload), headers: { id: eventId, eventType } }],
  });
  return eventId;
}

async function placeOrder(over: Parameters<typeof order>[0] = {}) {
  const id = uuidv7();
  const now = new Date();
  const number = `KD-${Math.floor(10000 + Math.random() * 89999)}`;
  const o = order({
    id,
    orderNumber: number,
    placedAt: now,
    acceptBy: new Date(now.getTime() + 180_000),
    ...over,
  });
  const payload = OrderPlaced.encode({ orderId: id, order: o, occurredAt: now }).finish();
  const eventId = await publish("kade.order.events", id, ORDER_EVENTS.placed, payload);
  return { id, number, eventId, payload, order: o };
}

const ticketOf = (orderId: string, md = kasun()) =>
  call(kitchen, "getTicket", { outletId: OUTLET, orderId }, md).then((r) => r.ticket);

async function outboxRows(
  type: string,
  aggregateId = OUTLET,
): Promise<{ payload: Buffer; created_at: Date }[]> {
  const { rows } = await pool.query(
    "select payload, created_at from outbox where type = $1 and aggregateid = $2 order by created_at",
    [type, aggregateId],
  );
  return rows;
}

// ---------- tests ----------

describe("identity", () => {
  it("GetMyOutlets resolves the Keycloak demo users to Galle Road Kottu House", async () => {
    expect((await call(staff, "getMyOutlets", {}, as(RUWAN))).outlets).toEqual([
      {
        outletId: OUTLET,
        outletName: "Galle Road Kottu House",
        role: OutletStaffRole.OUTLET_STAFF_ROLE_OWNER,
      },
    ]);
    expect((await call(staff, "getMyOutlets", {}, as(KASUN, "merchant_staff"))).outlets).toEqual([
      {
        outletId: OUTLET,
        outletName: "Galle Road Kottu House",
        role: OutletStaffRole.OUTLET_STAFF_ROLE_KITCHEN,
      },
    ]);
    expect((await call(staff, "getMyOutlets", {}, as(uuidv7()))).outlets).toEqual([]);
  });

  it("authorises by outlet membership and role", async () => {
    expect(
      await grpcError(
        call(kitchen, "listTickets", { outletId: OUTLET_2, closedWithinMinutes: 0 }, as(RUWAN)),
      ),
    ).toEqual({
      code: status.PERMISSION_DENIED,
      reason: "OUTLET_FORBIDDEN",
    });
    expect(
      await grpcError(
        call(
          staff,
          "inviteOutletStaff",
          { outletId: OUTLET, name: "X", phone: "0771234567", role: 3 },
          kasun(),
        ),
      ),
    ).toEqual({ code: status.PERMISSION_DENIED, reason: "OUTLET_ROLE_REQUIRED" });
    expect(
      await grpcError(
        call(kitchen, "listTickets", { outletId: OUTLET, closedWithinMinutes: 0 }, new Metadata()),
      ),
    ).toEqual({
      code: status.UNAUTHENTICATED,
      reason: "UNAUTHENTICATED",
    });
    // ops can look at any outlet
    const { outlet } = await call(outlets, "getOutlet", { outletId: OUTLET_2 }, ops());
    expect(outlet?.name).toBe("Amma's Rice & Curry");
  });
});

describe("kitchen board", () => {
  it("has the demo evening on first load (separate from real tickets)", async () => {
    const { tickets } = await call(kitchen, "listTickets", { outletId: "", closedWithinMinutes: 0 }, kasun());
    const demo = tickets.filter((t) => t.orderId.startsWith("00000000-0000-7000-8d00-"));
    expect(demo.length).toBeGreaterThanOrEqual(5);
    expect(new Set(demo.map((t) => t.status))).toContain(TicketStatus.TICKET_STATUS_PREPARING);
    // oldest first
    const placed = tickets.map((t) => t.placedAt!.getTime());
    expect(placed).toEqual([...placed].sort((a, b) => a - b));
  });

  it("OrderPlaced → ticket → accept → ready → hand over, each decision published once via the outbox", async () => {
    const placed = await placeOrder();
    // replay the same event twice: still one ticket (processed_events + insert-if-absent)
    await producer.send({
      topic: "kade.order.events",
      messages: [1, 2].map(() => ({
        key: placed.id,
        value: Buffer.from(placed.payload),
        headers: { id: placed.eventId, eventType: ORDER_EVENTS.placed },
      })),
    });
    const ticket = await eventually(() => ticketOf(placed.id));
    expect(ticket).toMatchObject({
      status: TicketStatus.TICKET_STATUS_NEW,
      orderNumber: placed.number,
      ticketNumber: placed.number.slice(3),
      customerFirstName: "Dilini",
    });

    const key = uuidv7();
    const accepted = await call(
      kitchen,
      "acceptOrder",
      { outletId: OUTLET, orderId: placed.id, prepMinutes: 15, idempotencyKey: key },
      kasun(),
    );
    expect(accepted.ticket).toMatchObject({ status: TicketStatus.TICKET_STATUS_PREPARING, prepMinutes: 15 });
    const again = await call(
      kitchen,
      "acceptOrder",
      { outletId: OUTLET, orderId: placed.id, prepMinutes: 15, idempotencyKey: key },
      kasun(),
    );
    expect(again.ticket).toEqual(accepted.ticket);
    expect(
      await grpcError(
        call(
          kitchen,
          "acceptOrder",
          { outletId: OUTLET, orderId: placed.id, prepMinutes: 15, idempotencyKey: "" },
          kasun(),
        ),
      ),
    ).toEqual({ code: status.FAILED_PRECONDITION, reason: "TICKET_ALREADY_ACCEPTED" });

    const acceptedEvents = (await outboxRows(EVENT.ticketAccepted))
      .map((r) => TicketAccepted.decode(r.payload))
      .filter((e) => e.orderId === placed.id);
    expect(acceptedEvents).toHaveLength(1);
    expect(acceptedEvents[0]).toMatchObject({
      outletId: OUTLET,
      orderNumber: placed.number,
      prepMinutes: 15,
      actor: { userId: KASUN },
    });

    const ready = await call(
      kitchen,
      "markOrderReady",
      { outletId: OUTLET, orderId: placed.id, idempotencyKey: "" },
      kasun(),
    );
    expect(ready.ticket?.status).toBe(TicketStatus.TICKET_STATUS_READY);
    const gone = await call(
      kitchen,
      "handOverOrder",
      { outletId: OUTLET, orderId: placed.id, idempotencyKey: "" },
      kasun(),
    );
    expect(gone.ticket).toMatchObject({ status: TicketStatus.TICKET_STATUS_PICKED_UP });

    const { rows } = await pool.query(
      "select type from outbox where payload::text like $1 order by created_at",
      [`%${Buffer.from(placed.id).toString("hex")}%`],
    );
    expect(rows.map((r: { type: string }) => r.type)).toEqual([
      EVENT.ticketAccepted,
      EVENT.ticketReady,
      EVENT.ticketHandedOver,
    ]);
  });

  it("TicketAccepted reaches kade.merchant.events through Debezium", async () => {
    const placed = await placeOrder();
    await eventually(() => ticketOf(placed.id));
    const consumer = kafka.consumer({
      kafkaJS: { groupId: `merchant-it-${uuidv7()}`, fromBeginning: false },
    });
    await consumer.connect();
    await consumer.subscribe({ topics: ["kade.merchant.events"] });
    const found = new Promise<{ key: string; headers: KafkaJS.IHeaders; event: TicketAccepted }>(
      (resolve) => {
        void consumer.run({
          eachMessage: async ({ message }) => {
            if (message.headers?.eventType?.toString() !== EVENT.ticketAccepted || !message.value) return;
            const event = TicketAccepted.decode(message.value);
            if (event.orderId === placed.id)
              resolve({ key: message.key!.toString(), headers: message.headers, event });
          },
        });
      },
    );
    try {
      // the consumer needs its assignment before the event is produced (fromBeginning: false)
      await new Promise((r) => setTimeout(r, 4_000));
      await call(
        kitchen,
        "acceptOrder",
        { outletId: OUTLET, orderId: placed.id, prepMinutes: 20, idempotencyKey: "" },
        kasun(),
      );
      const got = await Promise.race([
        found,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TicketAccepted not on Kafka")), 45_000),
        ),
      ]);
      expect(got.key).toBe(OUTLET);
      expect(got.event.prepMinutes).toBe(20);
      expect(got.headers.id?.toString()).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await consumer.disconnect();
    }
  });

  it("refuses a late accept with TICKET_MISSED and shows the ticket as missed", async () => {
    const past = new Date(Date.now() - 4 * 60_000);
    const placed = await placeOrder({ placedAt: past, acceptBy: new Date(past.getTime() + 180_000) });
    await eventually(() => ticketOf(placed.id));
    expect(
      await grpcError(
        call(
          kitchen,
          "acceptOrder",
          { outletId: OUTLET, orderId: placed.id, prepMinutes: 15, idempotencyKey: "" },
          kasun(),
        ),
      ),
    ).toEqual({ code: status.FAILED_PRECONDITION, reason: "TICKET_MISSED" });
    expect((await ticketOf(placed.id))?.status).toBe(TicketStatus.TICKET_STATUS_MISSED);
  });

  it("rejects with a reason; order's timeout beats a kitchen accept that lost the race", async () => {
    const a = await placeOrder();
    await eventually(() => ticketOf(a.id));
    const rejected = await call(
      kitchen,
      "rejectOrder",
      {
        outletId: OUTLET,
        orderId: a.id,
        reason: RejectionReason.REJECTION_REASON_TOO_BUSY,
        note: "Fryer down",
        idempotencyKey: "",
      },
      kasun(),
    );
    expect(rejected.ticket).toMatchObject({
      status: TicketStatus.TICKET_STATUS_REJECTED,
      rejectNote: "Fryer down",
    });

    const b = await placeOrder();
    await eventually(() => ticketOf(b.id));
    await call(
      kitchen,
      "acceptOrder",
      { outletId: OUTLET, orderId: b.id, prepMinutes: 15, idempotencyKey: "" },
      kasun(),
    );
    const now = new Date();
    await publish(
      "kade.order.events",
      b.id,
      ORDER_EVENTS.rejected,
      OrderRejected.encode({
        orderId: b.id,
        order: { ...b.order, status: OrderStatus.ORDER_STATUS_REJECTED },
        rejection: { reason: RejectionReason.REJECTION_REASON_TIMEOUT, note: "", at: now },
        occurredAt: now,
      }).finish(),
    );
    const missed = await eventually(async () => {
      const t = await ticketOf(b.id);
      return t?.status === TicketStatus.TICKET_STATUS_MISSED ? t : undefined;
    });
    expect(missed.rejectReason).toBe(RejectionReason.REJECTION_REASON_TIMEOUT);
  });

  it("shows the rider from kade.delivery.events", async () => {
    const placed = await placeOrder();
    await eventually(() => ticketOf(placed.id));
    const deliveryId = uuidv7();
    const arrives = new Date(Date.now() + 10 * 60_000);
    await publish(
      "kade.delivery.events",
      deliveryId,
      DELIVERY_EVENTS.riderAssigned,
      RiderAssigned.encode({
        deliveryId,
        orderId: placed.id,
        orderNumber: placed.number,
        restaurantId: OUTLET,
        rider: {
          riderId: "00000000-0000-7000-8001-000000000101",
          name: "Nimal Fernando",
          firstName: "Nimal",
          vehicle: "Bajaj Pulsar",
          plate: "WP BCD-4521",
          maskedPhone: "+94 11 520 1234",
          rating: 4.9,
          phone: "",
        },
        arrivesAtRestaurantAt: arrives,
        reassigned: false,
        reason: "",
        occurredAt: new Date(),
      }).finish(),
    );
    const withRider = await eventually(async () => {
      const t = await ticketOf(placed.id);
      return t?.rider ? t : undefined;
    });
    expect(withRider.rider).toMatchObject({ name: "Nimal", plate: "WP BCD-4521" });
    expect(withRider.riderArrivesAt).toEqual(arrives);
    await publish(
      "kade.delivery.events",
      deliveryId,
      DELIVERY_EVENTS.arrivedAtRestaurant,
      RiderArrivedAtRestaurant.encode({
        deliveryId,
        orderId: placed.id,
        restaurantId: OUTLET,
        riderId: "r",
        occurredAt: new Date(),
      }).finish(),
    );
    await eventually(async () => ((await ticketOf(placed.id))?.riderAtCounter ? true : undefined));
  });
});

describe("outlet controls", () => {
  it("busy mode adds minutes to accepts and publishes OutletStatusChanged", async () => {
    const since = new Date();
    const { outlet } = await call(
      outlets,
      "setBusyMode",
      { outletId: OUTLET, busyExtraMinutes: 10 },
      kasun(),
    );
    expect(outlet?.status?.busyExtraMinutes).toBe(10);
    const changed = (await outboxRows(EVENT.outletStatusChanged))
      .filter((r) => r.created_at >= new Date(since.getTime() - 1000))
      .map((r) => OutletStatusChanged.decode(r.payload));
    expect(changed.at(-1)).toMatchObject({
      status: { busyExtraMinutes: 10 },
      previous: { busyExtraMinutes: 0 },
    });

    const placed = await placeOrder();
    await eventually(() => ticketOf(placed.id));
    const { ticket } = await call(
      kitchen,
      "acceptOrder",
      { outletId: OUTLET, orderId: placed.id, prepMinutes: 15, idempotencyKey: "" },
      kasun(),
    );
    expect(ticket?.prepMinutes).toBe(25);

    expect(
      await grpcError(call(outlets, "setBusyMode", { outletId: OUTLET, busyExtraMinutes: 15 }, kasun())),
    ).toEqual({
      code: status.INVALID_ARGUMENT,
      reason: "BUSY_MODE_INVALID",
    });
    await call(outlets, "setBusyMode", { outletId: OUTLET, busyExtraMinutes: 0 }, kasun());
  });

  it("pause and resume", async () => {
    const until = new Date(Date.now() + 30 * 60_000);
    const paused = await call(outlets, "pauseOutlet", { outletId: OUTLET, until }, as(RUWAN));
    expect(paused.outlet?.status).toMatchObject({ pausedUntil: until, accepting: false });
    const resumed = await call(outlets, "resumeOutlet", { outletId: OUTLET }, as(RUWAN));
    expect(resumed.outlet?.status).toMatchObject({ pausedUntil: undefined, accepting: true });
  });

  it("settings round-trip; test print goes to the paired printer", async () => {
    const { settings } = await call(outlets, "getOutletSettings", { outletId: OUTLET }, as(RUWAN));
    expect(settings?.devices?.printerName).toBe("Kitchen printer (Epson TM-T82)");
    const saved = await call(outlets, "updateOutletSettings", { outletId: OUTLET, settings }, as(RUWAN));
    expect(saved.settings).toEqual(settings);
    expect((await call(outlets, "printTestTicket", { outletId: OUTLET }, kasun())).message).toBe(
      "Sent to Kitchen printer (Epson TM-T82)",
    );
  });
});

describe("staff", () => {
  it("invite (pending), duplicate phone, change role, remove; never leave an outlet without an owner", async () => {
    const phone = `07${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const { member } = await call(
      staff,
      "inviteOutletStaff",
      { outletId: OUTLET, name: "Test Cook", phone, role: OutletStaffRole.OUTLET_STAFF_ROLE_KITCHEN },
      as(RUWAN),
    );
    expect(member).toMatchObject({
      name: "Test Cook",
      pending: true,
      role: OutletStaffRole.OUTLET_STAFF_ROLE_KITCHEN,
    });
    expect(
      await grpcError(
        call(staff, "inviteOutletStaff", { outletId: OUTLET, name: "Again", phone, role: 3 }, as(RUWAN)),
      ),
    ).toEqual({ code: status.ALREADY_EXISTS, reason: "STAFF_PHONE_EXISTS" });
    const changed = await call(
      staff,
      "changeOutletStaffRole",
      { outletId: OUTLET, staffId: member!.id, role: OutletStaffRole.OUTLET_STAFF_ROLE_MANAGER },
      as(RUWAN),
    );
    expect(changed.staff.find((s) => s.id === member!.id)?.role).toBe(
      OutletStaffRole.OUTLET_STAFF_ROLE_MANAGER,
    );
    const removed = await call(
      staff,
      "removeOutletStaff",
      { outletId: OUTLET, staffId: member!.id },
      as(RUWAN),
    );
    expect(removed.staff.some((s) => s.id === member!.id)).toBe(false);

    // Outlet 2 has a single owner.
    const team = (await call(staff, "listOutletStaff", { outletId: OUTLET_2 }, ops())).staff;
    const owner = team.find((s) => s.role === OutletStaffRole.OUTLET_STAFF_ROLE_OWNER)!;
    expect(
      await grpcError(
        call(staff, "changeOutletStaffRole", { outletId: OUTLET_2, staffId: owner.id, role: 3 }, ops()),
      ),
    ).toEqual({ code: status.FAILED_PRECONDITION, reason: "LAST_OWNER" });
  });
});

describe("onboarding and admin", () => {
  it("submit → pending queue → approve creates a closed outlet with the owner pending → open it", async () => {
    const phone = `07${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const submitted = await call(
      applications,
      "submitApplication",
      {
        business: {
          name: "Test Kade",
          type: BusinessType.BUSINESS_TYPE_RESTAURANT,
          address: "1 Duplication Road",
          city: "Colombo",
          brNumber: "PV 1",
          cuisine: "Kottu",
          area: "Kollupitiya",
          location: undefined,
        },
        owner: { name: "Test Owner", phone, email: "", nic: "" },
        documents: [
          {
            id: "",
            kind: "registration",
            name: "",
            fileName: "br.pdf",
            fileRef: "",
            status: 0,
            rejectReason: "",
            expiresOn: "",
            fields: [],
            uploadedAt: undefined,
          },
        ],
        bank: {
          bank: "HNB",
          branch: "Kollupitiya",
          accountName: "Test Kade",
          accountNumber: "0012345678",
          accountLast4: "",
        },
        menu: undefined,
        idempotencyKey: uuidv7(),
      },
      new Metadata(),
    );
    const app = submitted.application!;
    expect(app).toMatchObject({
      status: ApplicationStatus.APPLICATION_STATUS_PENDING,
      zoneId: "c03",
      bank: { accountNumber: "", accountLast4: "5678" },
    });
    expect(app.reference).toMatch(/^KP-\d{5}$/);
    expect((await call(applications, "getMyApplication", { phone }, new Metadata())).application?.id).toBe(
      app.id,
    );
    expect(
      await grpcError(
        call(
          applications,
          "submitApplication",
          { ...submittedRequest(phone), idempotencyKey: "" },
          new Metadata(),
        ),
      ),
    ).toEqual({ code: status.ALREADY_EXISTS, reason: "APPLICATION_PENDING" });

    const queue = await call(
      applications,
      "listApplications",
      { status: ApplicationStatus.APPLICATION_STATUS_PENDING, page: { pageSize: 200, pageToken: "" } },
      ops(),
    );
    expect(queue.applications.map((a) => a.id)).toContain(app.id);

    const decided = await call(
      applications,
      "decideApplication",
      {
        applicationId: app.id,
        decision: ApplicationStatus.APPLICATION_STATUS_APPROVED,
        note: "",
        commissionBps: 0,
        idempotencyKey: uuidv7(),
      },
      ops(),
    );
    expect(decided.application).toMatchObject({
      status: ApplicationStatus.APPLICATION_STATUS_APPROVED,
      outletId: app.id,
    });
    const [event] = (await outboxRows(EVENT.applicationDecided, app.id)).map((r) =>
      PartnerApplicationDecided.decode(r.payload),
    );
    expect(event?.application?.status).toBe(ApplicationStatus.APPLICATION_STATUS_APPROVED);

    const view = (await call(admin, "getOutletAdmin", { outletId: app.id }, ops())).outlet!;
    expect(view.outlet).toMatchObject({
      name: "Test Kade",
      commissionBps: 1800,
      status: { adminStatus: OutletAdminStatus.OUTLET_ADMIN_STATUS_CLOSED, accepting: false },
    });
    const team = (await call(staff, "listOutletStaff", { outletId: app.id }, ops())).staff;
    expect(team).toMatchObject([
      { name: "Test Owner", pending: true, role: OutletStaffRole.OUTLET_STAFF_ROLE_OWNER },
    ]);

    const commission = await call(
      admin,
      "updateCommission",
      { outletId: app.id, commissionBps: 1500 },
      ops(),
    );
    expect(commission.outlet?.outlet?.commissionBps).toBe(1500);
    expect(
      await grpcError(call(admin, "updateCommission", { outletId: app.id, commissionBps: 4000 }, ops())),
    ).toEqual({
      code: status.INVALID_ARGUMENT,
      reason: "COMMISSION_OUT_OF_RANGE",
    });
    const opened = await call(
      admin,
      "setOutletStatus",
      { outletId: app.id, status: OutletAdminStatus.OUTLET_ADMIN_STATUS_OPEN, reason: "" },
      ops(),
    );
    expect(opened.outlet?.outlet?.status).toMatchObject({
      adminStatus: OutletAdminStatus.OUTLET_ADMIN_STATUS_OPEN,
      accepting: true,
    });
    expect(
      await grpcError(
        call(admin, "listOutlets", { status: 0, zoneId: "", query: "", page: undefined }, as(RUWAN)),
      ),
    ).toEqual({
      code: status.PERMISSION_DENIED,
      reason: "PERMISSION_DENIED",
    });
    const list = await call(
      admin,
      "listOutlets",
      { status: 0, zoneId: "c03", query: "kottu", page: undefined },
      ops(),
    );
    expect(list.outlets.map((o) => o.outlet?.name)).toContain("Galle Road Kottu House");
  });
});

function submittedRequest(phone: string) {
  return {
    business: {
      name: "Test Kade",
      type: BusinessType.BUSINESS_TYPE_RESTAURANT,
      address: "1 Duplication Road",
      city: "Colombo",
      brNumber: "",
      cuisine: "",
      area: "",
      location: undefined,
    },
    owner: { name: "Test Owner", phone, email: "", nic: "" },
    documents: [
      {
        id: "",
        kind: "registration",
        name: "",
        fileName: "br.pdf",
        fileRef: "",
        status: 0,
        rejectReason: "",
        expiresOn: "",
        fields: [],
        uploadedAt: undefined,
      },
    ],
    bank: undefined,
    menu: undefined,
  };
}
