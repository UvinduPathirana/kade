import {
  Channel,
  NotificationStatus,
  RecipientKind,
} from "@kade/proto/kade/notification/v1/notification_service";
import { OrderPickedUp, OrderPlaced } from "@kade/proto/kade/order/v1/order_events";
import { OrderStatus } from "@kade/proto/kade/order/v1/order_service";
import { beforeEach, describe, expect, it } from "vitest";
import type { Tx } from "../platform/db/database.js";
import { eventHandlersOf, type EventContext } from "../platform/kafka/event-handler.js";
import { OrderEventsConsumer } from "./consumers/order-events.consumer.js";
import type { DevSink, OutgoingMessage } from "./dev-sink.js";
import type {
  NewNotification,
  NotificationRow,
  NotificationsRepository,
  OrderContactRow,
  PushDeviceRow,
} from "./notifications.repository.js";
import { Notifier } from "./notifier.js";

/** In-memory stand-in for the repository: same merge and idempotency semantics. */
class FakeRepo {
  rows: NotificationRow[] = [];
  devicesByUser = new Map<string, PushDeviceRow[]>();
  contacts = new Map<string, OrderContactRow>();

  async insertOnce(_tx: Tx, row: NewNotification) {
    const existing = this.rows.find((r) => r.idempotencyKey === row.idempotencyKey);
    if (existing) return { row: existing, created: false };
    const full = { providerReference: null, sentAt: null, ...row } as NotificationRow;
    this.rows.push(full);
    return { row: full, created: true };
  }
  async update(_tx: unknown, id: string, set: Partial<NotificationRow>) {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, set);
    return row;
  }
  async devices(_db: unknown, userId: string) {
    return this.devicesByUser.get(userId) ?? [];
  }
  async contact(_db: unknown, orderId: string) {
    return this.contacts.get(orderId);
  }
  async upsertContact(_tx: Tx, c: Partial<OrderContactRow> & { orderId: string }) {
    const merged = { ...this.contacts.get(c.orderId) } as Record<string, unknown>;
    for (const [k, v] of Object.entries(c)) if (v !== undefined && v !== "" && v !== 0) merged[k] = v;
    const row = {
      orderNumber: "",
      customerId: "",
      customerName: "",
      customerPhone: "",
      restaurantName: "",
      riderName: "",
      ...merged,
    } as OrderContactRow;
    this.contacts.set(c.orderId, row);
    return row;
  }
}

const tx = {} as Tx;
let repo: FakeRepo;
let sent: OutgoingMessage[];
let notifier: Notifier;

beforeEach(() => {
  repo = new FakeRepo();
  sent = [];
  const sink = {
    deliver: async (m: OutgoingMessage) => (sent.push(m), { providerReference: `dev-${m.id}` }),
  } as DevSink;
  notifier = new Notifier(repo as unknown as NotificationsRepository, sink);
});

const customer = {
  kind: RecipientKind.RECIPIENT_KIND_CUSTOMER,
  userId: "c1",
  phone: "",
  email: "",
  name: "Dilini",
};

describe("Notifier", () => {
  it("falls back from push to SMS when the user has no device", async () => {
    const row = await notifier.send(tx, {
      channel: Channel.CHANNEL_PUSH,
      recipient: { ...customer, phone: "+94771234567" },
      template: "otp",
      params: { code: "4821" },
    });
    expect(row).toMatchObject({
      channel: Channel.CHANNEL_SMS,
      status: NotificationStatus.NOTIFICATION_STATUS_SENT,
      attempts: 1,
    });
    expect(sent[0]?.body).toMatch(/^4821 is your Kadé code/);
  });

  it("pushes to registered devices", async () => {
    repo.devicesByUser.set("c1", [
      { userId: "c1", deviceId: "d1", kind: 1, platform: 1, token: "t", registeredAt: new Date() },
    ]);
    const row = await notifier.send(tx, {
      channel: Channel.CHANNEL_UNSPECIFIED,
      recipient: customer,
      template: "ticket_reply",
      params: { agent: "Tharushi", text: "Hi" },
    });
    expect(row.channel).toBe(Channel.CHANNEL_PUSH);
    expect(sent[0]?.devices).toHaveLength(1);
  });

  it("stores a suppressed message when there is no way to reach the person", async () => {
    const row = await notifier.send(tx, {
      channel: Channel.CHANNEL_PUSH,
      recipient: customer,
      template: "ticket_reply",
      params: { agent: "A", text: "B" },
    });
    expect(row.status).toBe(NotificationStatus.NOTIFICATION_STATUS_SUPPRESSED);
    expect(row.error).toMatch(/No push device/);
    expect(sent).toHaveLength(0);
  });

  it("queues scheduled messages instead of sending them", async () => {
    const now = new Date("2026-10-12T10:00:00Z");
    const row = await notifier.send(
      tx,
      {
        channel: Channel.CHANNEL_SMS,
        recipient: { ...customer, phone: "+94" },
        template: "otp",
        params: { code: "1" },
        sendAt: new Date(now.getTime() + 60_000),
      },
      now,
    );
    expect(row.status).toBe(NotificationStatus.NOTIFICATION_STATUS_QUEUED);
    expect(sent).toHaveLength(0);
  });

  it("sends once per idempotency key", async () => {
    const input = {
      channel: Channel.CHANNEL_SMS,
      recipient: { ...customer, phone: "+94" },
      template: "otp",
      params: { code: "1" },
      idempotencyKey: "k",
    };
    const a = await notifier.send(tx, input);
    const b = await notifier.send(tx, input);
    expect(b.id).toBe(a.id);
    expect(sent).toHaveLength(1);
  });
});

describe("OrderEventsConsumer", () => {
  const ctx = (eventId: string) => ({ tx, eventId }) as EventContext;

  it("handles the order lifecycle events", () => {
    const types = eventHandlersOf(
      new OrderEventsConsumer(repo as unknown as NotificationsRepository, notifier),
    ).map((h) => h.eventType);
    expect(types).toEqual(
      expect.arrayContaining([
        "kade.order.v1.OrderPlaced",
        "kade.order.v1.OrderPickedUp",
        "kade.order.v1.OrderRefunded",
      ]),
    );
  });

  it("remembers the order from OrderPlaced and names rider and restaurant on pickup", async () => {
    const consumer = new OrderEventsConsumer(repo as unknown as NotificationsRepository, notifier);
    await consumer.orderPlaced(
      OrderPlaced.fromPartial({
        orderId: "o1",
        order: {
          id: "o1",
          orderNumber: "KD-4821",
          status: OrderStatus.ORDER_STATUS_PLACED,
          customer: { id: "c1", name: "Dilini Perera", phone: "+94771234567" },
          restaurant: { id: "r1", name: "Galle Road Kottu House" },
        },
      }),
      ctx("e1"),
    );
    await repo.upsertContact(tx, { orderId: "o1", riderName: "Nimal" });
    await consumer.orderPickedUp(
      OrderPickedUp.fromPartial({ orderId: "o1", orderNumber: "KD-4821", customerId: "c1" }),
      ctx("e2"),
    );
    expect(sent.map((m) => m.body)).toEqual([
      "We've sent order KD-4821 to Galle Road Kottu House. We'll let you know as soon as they accept.",
      "Nimal is on the way with your order from Galle Road Kottu House.",
    ]);
    expect(repo.rows.every((r) => r.referenceId === "o1")).toBe(true);
  });
});
