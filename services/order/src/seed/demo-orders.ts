// Demo history for dilini (the customer app's seeded past orders: KD-4821, KD-3307, KD-2954,
// KD-2410), so order history, reorder and "ordered before" work on a fresh stack. Deterministic ids
// (CONVENTIONS "Seeded ids", group 8003), inserted once, no events (they're history, not news).
// On when SEED_DEMO_ORDERS=true (Compose and .env.example); tests leave it off.
import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { FulfilmentMode, PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import {
  CancelledBy,
  Fault,
  OrderStatus,
  PlaceOrderRequest,
  type Order,
  type OrderLine,
  type OrderRestaurant,
  type OrderRider,
} from "@kade/proto/kade/order/v1/order_service";
import { inArray } from "drizzle-orm";
import { orders } from "../db/schema.js";
import { lkr } from "../orders/money.js";
import { CONFIG, type Config } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { OrderRepository } from "../orders/order.repository.js";

const DAY = 86_400_000;
const DILINI = { id: "00000000-0000-7000-8005-000000000001", name: "Dilini Fernando", phone: "+94771234567" };
const id = (group: string, n: number) => `00000000-0000-7000-${group}-${String(n).padStart(12, "0")}`;
const itemId = (code: string) => {
  const [r, s, i] = code.split("-").map((x) => x.padStart(4, "0"));
  return `00000000-0000-7000-8010-${r}${s}${i}`;
};

const NIMAL: OrderRider = {
  riderId: id("8001", 101),
  name: "Nimal Perera",
  firstName: "Nimal",
  rating: 4.9,
  vehicle: "Bajaj Pulsar",
  plate: "WP BCD-4521",
  maskedPhone: "+94 11 520 1234",
  phone: "",
};
const KASUN: OrderRider = {
  riderId: id("8001", 102),
  name: "Kasun Silva",
  firstName: "Kasun",
  rating: 4.8,
  vehicle: "Honda Dio",
  plate: "WP BHK-1180",
  maskedPhone: "+94 11 520 1235",
  phone: "",
};
const HOME = {
  id: "",
  label: "Home",
  line: "42 Flower Road, Colombo 07",
  area: "Kollupitiya",
  note: "Blue gate, ring twice",
  location: { lat: 6.9101, lng: 79.8612 },
  zoneId: "c07",
};
const WORK = {
  id: "",
  label: "Work",
  line: "18 Galle Road, Colombo 04",
  area: "Bambalapitiya",
  note: "",
  location: { lat: 6.8935, lng: 79.8553 },
  zoneId: "c04",
};
const VISA = {
  kind: PaymentMethodKind.PAYMENT_METHOD_KIND_CARD,
  cardId: "",
  cardBrand: 1,
  cardLast4: "4242",
};
const CASH = { kind: PaymentMethodKind.PAYMENT_METHOD_KIND_CASH, cardId: "", cardBrand: 0, cardLast4: "" };

function restaurant(
  n: number,
  name: string,
  area: string,
  eta: [number, number],
  discount = 0,
): OrderRestaurant {
  return {
    id: id("8000", n),
    name,
    imageId: "",
    area,
    address: "",
    phone: "",
    zoneId: "",
    etaMinMinutes: eta[0],
    etaMaxMinutes: eta[1],
    discountPercent: discount,
  };
}

function line(
  code: string,
  name: string,
  rupees: number,
  quantity: number,
  choices: string[] = [],
): OrderLine {
  return {
    key: [code, ...choices, ""].join("|"),
    itemId: itemId(code),
    name,
    unitPrice: lkr(rupees * 100),
    quantity,
    options: [],
    choiceNames: choices,
    note: "",
    sectionId: "",
  };
}

interface Spec {
  n: number;
  daysAgo: number;
  at: [number, number];
  mode: FulfilmentMode;
  restaurant: OrderRestaurant;
  lines: OrderLine[];
  deliveryFee: number;
  tip?: number;
  payment: typeof VISA;
  address?: typeof HOME;
  rider?: OrderRider;
  end: "delivered" | "collected" | "cancelled";
}

const SPECS: Spec[] = [
  {
    n: 4821,
    daysAgo: 3,
    at: [20, 5],
    mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
    restaurant: restaurant(1, "Galle Road Kottu House", "Kollupitiya", [15, 25], 20),
    lines: [
      line("1-0-1", "Cheese kottu", 1450, 1, ["Medium"]),
      line("1-0-0", "Chicken kottu", 1150, 1, ["Sri Lankan hot", "Extra egg"]),
      line("1-4-0", "Faluda", 450, 2, ["Normal"]),
    ],
    deliveryFee: 150,
    tip: 100,
    payment: VISA,
    address: HOME,
    rider: NIMAL,
    end: "delivered",
  },
  {
    n: 3307,
    daysAgo: 9,
    at: [12, 40],
    mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
    restaurant: restaurant(2, "Amma's Rice & Curry", "Bambalapitiya", [20, 30]),
    lines: [line("2-0-0", "Chicken rice and curry", 750, 2, ["Regular"]), line("2-1-2", "Parippu", 300, 1)],
    deliveryFee: 0,
    payment: CASH,
    address: WORK,
    rider: KASUN,
    end: "delivered",
  },
  {
    n: 2954,
    daysAgo: 17,
    at: [19, 15],
    mode: FulfilmentMode.FULFILMENT_MODE_PICKUP,
    restaurant: restaurant(6, "Smash Shed", "Kollupitiya", [20, 30]),
    lines: [line("6-0-0", "Double smash", 1850, 1), line("6-1-0", "Fries", 550, 1)],
    deliveryFee: 0,
    payment: VISA,
    end: "collected",
  },
  {
    n: 2410,
    daysAgo: 24,
    at: [16, 30],
    mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
    restaurant: restaurant(3, "Kompanna Short Eats", "Slave Island", [10, 20]),
    lines: [line("3-0-0", "Fish bun", 140, 6)],
    deliveryFee: 120,
    payment: VISA,
    address: HOME,
    end: "cancelled",
  },
];

export function demoOrder(spec: Spec, now = Date.now()): Order {
  const placed = new Date(now - spec.daysAgo * DAY);
  placed.setHours(spec.at[0], spec.at[1], 0, 0);
  const t = (min: number) => new Date(placed.getTime() + min * 60_000);
  const delivery = spec.mode === FulfilmentMode.FULFILMENT_MODE_DELIVERY;
  // apps/customer/src/features/cart/totals.ts, in rupees then minor units.
  const count = spec.lines.reduce((s, l) => s + l.quantity, 0);
  const subtotal = spec.lines.reduce((s, l) => s + (l.unitPrice?.amountMinor ?? 0) * l.quantity, 0) / 100;
  const saving = Math.round((subtotal * spec.restaurant.discountPercent) / 100);
  const fee = delivery && count > 0 ? spec.deliveryFee : 0;
  const small = subtotal < 500 ? 60 : 0;
  const tip = delivery ? (spec.tip ?? 0) : 0;
  const total = subtotal - saving + fee + small + tip;
  const status =
    spec.end === "delivered"
      ? OrderStatus.ORDER_STATUS_DELIVERED
      : spec.end === "collected"
        ? OrderStatus.ORDER_STATUS_COLLECTED
        : OrderStatus.ORDER_STATUS_CANCELLED;
  const timeline =
    spec.end === "cancelled"
      ? [
          { at: placed, status: OrderStatus.ORDER_STATUS_PLACED, label: "Order placed", by: "" },
          { at: t(1), status, label: "Cancelled: Changed my mind", by: DILINI.name },
        ]
      : [
          { at: placed, status: OrderStatus.ORDER_STATUS_PLACED, label: "Order placed", by: "" },
          {
            at: t(1),
            status: OrderStatus.ORDER_STATUS_ACCEPTED,
            label: "Accepted by the kitchen (15 min)",
            by: "",
          },
          { at: t(1), status: OrderStatus.ORDER_STATUS_PREPARING, label: "Preparing", by: "" },
          ...(delivery
            ? [
                {
                  at: t(17),
                  status: OrderStatus.ORDER_STATUS_PICKED_UP,
                  label: `Picked up by ${spec.rider?.firstName}`,
                  by: "",
                },
                { at: t(28), status, label: "Delivered", by: "" },
              ]
            : [
                { at: t(16), status: OrderStatus.ORDER_STATUS_READY, label: "Ready to collect", by: "" },
                { at: t(23), status, label: "Collected", by: "" },
              ]),
        ];
  return {
    id: id("8003", spec.n),
    orderNumber: `KD-${spec.n}`,
    status,
    mode: spec.mode,
    customer: DILINI,
    restaurant: spec.restaurant,
    lines: spec.lines,
    address: spec.address,
    riderNote: "",
    kitchenNote: "",
    cutlery: false,
    payment: spec.payment,
    paymentId: "",
    totals: {
      itemCount: count,
      subtotal: lkr(subtotal * 100),
      saving: lkr(saving * 100),
      deliveryFee: lkr(fee * 100),
      smallOrderFee: lkr(small * 100),
      promoDiscount: lkr(0),
      tip: lkr(tip * 100),
      credit: lkr(0),
      total: lkr(total * 100),
    },
    substitution: 0,
    groupId: "",
    zoneId: spec.address?.zoneId ?? "",
    distanceKm: 0,
    deliveryCode: "",
    rider: spec.rider,
    deliveryId: "",
    createdAt: placed,
    placedAt: placed,
    acceptedAt: spec.end === "cancelled" ? undefined : t(1),
    prepMinutes: spec.end === "cancelled" ? 0 : 15,
    readyAt: spec.end === "collected" ? t(16) : undefined,
    pickedUpAt: spec.end === "delivered" ? t(17) : undefined,
    deliveredAt: spec.end === "delivered" ? t(28) : undefined,
    collectedAt: spec.end === "collected" ? t(23) : undefined,
    dueAt: t(spec.restaurant.etaMaxMinutes),
    updatedAt: timeline.at(-1)!.at,
    cancellation:
      spec.end === "cancelled"
        ? {
            reason: "Changed my mind",
            fault: Fault.FAULT_CUSTOMER,
            cancelledBy: CancelledBy.CANCELLED_BY_CUSTOMER,
            by: DILINI.name,
            at: t(1),
          }
        : undefined,
    refunded: lkr(0),
    timeline,
    notes: [],
    failureReason: "",
    failureMessage: "",
    customerRepeatCount: 0,
  };
}

@Injectable()
export class DemoOrderSeeder implements OnApplicationBootstrap {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(Database) private readonly database: Database,
    @Inject(OrderRepository) private readonly orders: OrderRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.SEED_DEMO_ORDERS) return;
    const all = SPECS.map((s) => demoOrder(s));
    const existing = await this.database.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        inArray(
          orders.id,
          all.map((o) => o.id),
        ),
      );
    const have = new Set(existing.map((r) => r.id));
    const missing = all.filter((o) => !have.has(o.id));
    if (missing.length === 0) return;
    await this.database.transaction(undefined, async (tx) => {
      for (const order of missing) {
        const request = PlaceOrderRequest.fromPartial({
          customerId: DILINI.id,
          restaurantId: order.restaurant!.id,
          mode: order.mode,
          payment: order.payment,
          idempotencyKey: `seed:${order.orderNumber}`,
        });
        await this.orders.insert(tx, order, request, "seed");
      }
    });
    this.logger.info({ orders: missing.map((o) => o.orderNumber) }, "demo order history seeded");
  }
}
