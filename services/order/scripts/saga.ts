// Drive the order saga by hand against a running order service (host or Compose), playing the
// parts of the services that may not exist yet: the kitchen (merchant events) and the rider
// (dispatch events) are produced straight onto Kafka with the outbox headers (id, eventType).
//
//   node scripts/saga.ts run [--cash] [--pickup] [--promo KADE100] [--decline]   place + full happy path
//   node scripts/saga.ts place [--cash] [--pickup] [--promo CODE] [--decline] [--schedule 90]
//   node scripts/saga.ts accept <orderId> [prepMinutes] | reject <orderId> | ready <orderId>
//   node scripts/saga.ts rider <orderId> | pickup <orderId> | deliver <orderId> | handover <orderId>
//   --items <id,id,…> menu item ids (default: Chicken kottu ×2 + Cheese kottu at Galle Road Kottu House)
//   node scripts/saga.ts kitchen accept|reject|ready|handover <orderId>   through the real merchant
//                                                    service (MERCHANT_GRPC, localhost:50109) instead
//   node scripts/saga.ts get <orderId|KD-5001> | cancel <orderId>
//
// Env: ORDER_GRPC (localhost:50107), KAFKA_BROKERS (localhost:19092).
// Watch it: Temporal UI http://localhost:8233/namespaces/kade/workflows (workflow id = order id).
import { credentials, Metadata } from "@grpc/grpc-js";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import {
  DeliveryCompleted,
  DeliveryPickedUp,
  DeliveryRequested,
  RiderAssigned,
} from "@kade/proto/kade/dispatch/v1/dispatch_events";
import {
  TicketAccepted,
  TicketHandedOver,
  TicketReady,
  TicketRejected,
} from "@kade/proto/kade/merchant/v1/merchant_events";
import { KitchenServiceClient } from "@kade/proto/kade/merchant/v1/merchant_service";
import { OrderServiceClient, orderStatusToJSON } from "@kade/proto/kade/order/v1/order_service";
import { randomUUID } from "node:crypto";

const RESTAURANT = "00000000-0000-7000-8000-000000000001"; // Galle Road Kottu House
const CUSTOMER = "00000000-0000-7000-8005-000000000001"; // dilini
const RIDER = "00000000-0000-7000-8001-000000000101"; // Nimal

// Seeded menu (catalog): Chicken kottu ×2 (Medium, extra egg) and Cheese kottu (Mild).
const SPICE = "00000000-0000-7000-8012-000001000001";
const EXTRAS = "00000000-0000-7000-8012-000001000002";
const DEFAULT_LINES = [
  {
    key: "l1",
    itemId: "00000000-0000-7000-8010-000100000000",
    quantity: 2,
    options: [
      { optionGroupId: SPICE, choiceId: "00000000-0000-7000-8013-000100010002" },
      { optionGroupId: EXTRAS, choiceId: "00000000-0000-7000-8013-000100020001" },
    ],
    note: "",
  },
  {
    key: "l2",
    itemId: "00000000-0000-7000-8010-000100000001",
    quantity: 1,
    options: [{ optionGroupId: SPICE, choiceId: "00000000-0000-7000-8013-000100010001" }],
    note: "No leeks please",
  },
];

const client = new OrderServiceClient(
  process.env.ORDER_GRPC ?? "localhost:50107",
  credentials.createInsecure(),
);
const kafka = new KafkaJS.Kafka({
  kafkaJS: {
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:19092").split(","),
    logLevel: KafkaJS.logLevel.ERROR,
  },
});
const producer = kafka.producer();

const args = process.argv.slice(2);

/** The real kitchen: merchant.KitchenService as Ruwan (owner of restaurant 1). */
function kitchen(action: string, orderId: string): Promise<void> {
  const merchant = new KitchenServiceClient(
    process.env.MERCHANT_GRPC ?? "localhost:50109",
    credentials.createInsecure(),
  );
  const m = new Metadata();
  m.set("x-user-id", "00000000-0000-7000-8005-000000000002");
  m.set("x-roles", "merchant_owner,merchant_staff");
  m.set("x-outlet-id", RESTAURANT);
  const method = {
    accept: "acceptOrder",
    reject: "rejectOrder",
    ready: "markOrderReady",
    handover: "handOverOrder",
  }[action];
  if (!method) throw new Error(`kitchen ${action}? use accept|reject|ready|handover`);
  const request = {
    outletId: RESTAURANT,
    orderId,
    prepMinutes: 15,
    reason: 1,
    note: "Too busy",
    idempotencyKey: randomUUID(),
  };
  return new Promise((resolve, reject) =>
    (merchant as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!.call(
      merchant,
      request,
      m,
      { deadline: Date.now() + 5_000 },
      (err: Error | null) => {
        merchant.close();
        if (err) reject(err);
        else {
          console.log(`  → merchant.KitchenService/${method}`);
          resolve();
        }
      },
    ),
  );
}
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function call<Res>(method: string, request: unknown, timeoutMs = 25_000): Promise<Res> {
  const md = new Metadata();
  md.set("x-user-id", CUSTOMER);
  md.set("x-roles", "customer");
  return new Promise((resolve, reject) =>
    (client as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!.call(
      client,
      request,
      md,
      { deadline: Date.now() + timeoutMs },
      (err: Error | null, res: Res) => (err ? reject(err) : resolve(res)),
    ),
  );
}

interface OrderLike {
  id: string;
  orderNumber: string;
  status: number;
  deliveryCode: string;
  totals?: { total?: { amountMinor: number } };
  timeline: { label: string }[];
}

function show(o: OrderLike | undefined): void {
  if (!o) return console.log("(no order)");
  console.log(
    `${o.orderNumber} ${o.id} ${orderStatusToJSON(o.status as never)} total Rs ${(o.totals?.total?.amountMinor ?? 0) / 100}`,
  );
  console.log(`  timeline: ${o.timeline.map((t) => t.label).join(" → ")}`);
}

async function place(): Promise<OrderLike> {
  const cash = flag("cash");
  const pickup = flag("pickup");
  const schedule = opt("schedule");
  const { order } = await call<{ order: OrderLike }>("placeOrder", {
    customerId: CUSTOMER,
    restaurantId: RESTAURANT,
    mode: pickup ? 2 : 1,
    lines: DEFAULT_LINES,
    address: pickup
      ? undefined
      : {
          id: "",
          label: "Home",
          line: "42 Flower Road, Colombo 07",
          area: "Kollupitiya",
          note: "",
          location: { lat: 6.9101, lng: 79.8612 },
          zoneId: "",
        },
    riderNote: "",
    kitchenNote: "",
    cutlery: false,
    scheduledFor: schedule ? new Date(Date.now() + Number(schedule) * 60_000) : undefined,
    payment: cash
      ? {
          kind: 2,
          cardId: "",
          cardBrand: 0,
          cardLast4: "",
          cashPayingWith: { amountMinor: 500_000, currency: "LKR" },
        }
      : { kind: 1, cardId: "card-1", cardBrand: 1, cardLast4: flag("decline") ? "0002" : "4242" },
    promoCode: opt("promo") ?? "",
    tip: { amountMinor: pickup ? 0 : 10_000, currency: "LKR" },
    useCredit: false,
    substitution: 0,
    groupId: "",
    idempotencyKey: randomUUID(),
  });
  show(order);
  return order;
}

async function get(idOrNumber: string): Promise<OrderLike> {
  const byNumber = idOrNumber.toUpperCase().startsWith("KD-");
  const { order } = await call<{ order: OrderLike }>("getOrder", {
    orderId: byNumber ? "" : idOrNumber,
    orderNumber: byNumber ? idOrNumber : "",
  });
  return order;
}

async function send(topic: string, key: string, type: string, payload: Uint8Array): Promise<void> {
  await producer.send({
    topic,
    messages: [{ key, value: Buffer.from(payload), headers: { id: randomUUID(), eventType: type } }],
  });
  console.log(`  → ${topic} ${type}`);
}

const now = () => new Date();
const deliveryId = (orderId: string) => `del-${orderId.slice(-12)}`;
const ticket = (orderId: string) => ({ outletId: RESTAURANT, orderId, orderNumber: "", occurredAt: now() });

const events = {
  accept: (id: string, prep = 15) =>
    send(
      "kade.merchant.events",
      RESTAURANT,
      "kade.merchant.v1.TicketAccepted",
      TicketAccepted.encode({
        ...ticket(id),
        prepMinutes: prep,
        readyBy: new Date(Date.now() + prep * 60_000),
      }).finish(),
    ),
  reject: (id: string) =>
    send(
      "kade.merchant.events",
      RESTAURANT,
      "kade.merchant.v1.TicketRejected",
      TicketRejected.encode({ ...ticket(id), reason: 1, note: "Too busy tonight" }).finish(),
    ),
  ready: (id: string) =>
    send(
      "kade.merchant.events",
      RESTAURANT,
      "kade.merchant.v1.TicketReady",
      TicketReady.encode(ticket(id)).finish(),
    ),
  handover: (id: string) =>
    send(
      "kade.merchant.events",
      RESTAURANT,
      "kade.merchant.v1.TicketHandedOver",
      TicketHandedOver.encode(ticket(id)).finish(),
    ),
  rider: async (id: string) => {
    await send(
      "kade.delivery.events",
      deliveryId(id),
      "kade.dispatch.v1.DeliveryRequested",
      DeliveryRequested.encode({ deliveryId: deliveryId(id), orderId: id, occurredAt: now() }).finish(),
    );
    await send(
      "kade.delivery.events",
      deliveryId(id),
      "kade.dispatch.v1.RiderAssigned",
      RiderAssigned.encode({
        deliveryId: deliveryId(id),
        orderId: id,
        orderNumber: "",
        restaurantId: RESTAURANT,
        rider: {
          riderId: RIDER,
          name: "Nimal Perera",
          firstName: "Nimal",
          rating: 4.9,
          vehicle: "Bajaj Pulsar",
          plate: "WP BCD-4521",
          maskedPhone: "+94 11 520 1234",
          phone: "+94771234567",
        },
        reassigned: false,
        reason: "",
        occurredAt: now(),
      }).finish(),
    );
  },
  pickup: (id: string) =>
    send(
      "kade.delivery.events",
      deliveryId(id),
      "kade.dispatch.v1.DeliveryPickedUp",
      DeliveryPickedUp.encode({
        deliveryId: deliveryId(id),
        orderId: id,
        restaurantId: RESTAURANT,
        riderId: RIDER,
        sealed: true,
        occurredAt: now(),
      }).finish(),
    ),
  deliver: async (id: string) => {
    const order = await get(id);
    await send(
      "kade.delivery.events",
      deliveryId(id),
      "kade.dispatch.v1.DeliveryCompleted",
      DeliveryCompleted.encode({
        deliveryId: deliveryId(id),
        orderId: id,
        orderNumber: order.orderNumber,
        riderId: RIDER,
        proof: 0,
        cashCollected: order.totals?.total,
        km: 3.2,
        zoneId: "c07",
        occurredAt: now(),
      }).finish(),
    );
  },
};

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function step(label: string, id: string, fn: () => Promise<void>): Promise<void> {
  console.log(label);
  await fn();
  await pause(2_500); // Debezium isn't involved here, but consumer + workflow + activity take a moment
  show(await get(id));
}

async function main(): Promise<void> {
  const [command, id, extra] = args.filter(
    (a, i) =>
      !a.startsWith("--") &&
      !(
        i > 0 &&
        args[i - 1]?.startsWith("--") &&
        ["promo", "schedule", "items"].includes(args[i - 1]!.slice(2))
      ),
  );
  await producer.connect();
  try {
    switch (command) {
      case "place":
        await place();
        break;
      case "get":
        show(await get(id!));
        break;
      case "cancel":
        show(
          (
            await call<{ order: OrderLike }>("cancelOrder", {
              orderId: id,
              cancelledBy: 1,
              reason: "Changed my mind",
              fault: 0,
              refund: false,
              by: "",
              idempotencyKey: randomUUID(),
            })
          ).order,
        );
        break;
      case "accept":
        await events.accept(id!, extra ? Number(extra) : 15);
        break;
      case "kitchen":
        await kitchen(id!, extra!);
        break;
      case "reject":
      case "ready":
      case "rider":
      case "pickup":
      case "deliver":
      case "handover":
        await events[command](id!);
        break;
      case "run": {
        const order = await place();
        if (order.status !== 3) break; // PLACED
        await step("kitchen accepts", order.id, () => events.accept(order.id, 12));
        if (flag("pickup")) {
          await step("food ready", order.id, () => events.ready(order.id));
          await step("customer collects (kitchen hands over)", order.id, () => events.handover(order.id));
        } else {
          await step("rider assigned", order.id, () => events.rider(order.id));
          await step("food ready", order.id, () => events.ready(order.id));
          await step("rider picks up", order.id, () => events.pickup(order.id));
          await step("delivered", order.id, () => events.deliver(order.id));
        }
        break;
      }
      default:
        console.log("usage: see the comment at the top of scripts/saga.ts");
    }
  } finally {
    await producer.disconnect();
    client.close();
  }
}

await main().catch((err: { code?: number; details?: string; message: string }) => {
  console.error(`failed: ${err.code ?? ""} ${err.details ?? err.message}`);
  process.exitCode = 1;
});
