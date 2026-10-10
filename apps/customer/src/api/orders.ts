// Order API. Today a mock service persisted in localStorage; later the order service
// (POST /orders, GET /orders/:id, plus a live status stream) behind the same functions.
import { computeTotals } from "@/features/cart/totals";
import { FINAL_STATUSES, orderStatus } from "./orderStatus";
import { validatePromo } from "./promos";
import type { Order, OrderRating, PlaceOrderInput, Rider, SavedAddress } from "./types";

const KEY = "kade.orders.v1";

export class OrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderError";
  }
}

export const savedAddresses: SavedAddress[] = [
  { id: "home", label: "Home", line: "42 Galle Rd, Colombo 03" },
  { id: "work", label: "Work", line: "18 Bauddhaloka Mawatha, Colombo 07" },
];

export const savedCard = { type: "card", brand: "Visa", last4: "4242" } as const;

const riders: Rider[] = [
  {
    name: "Nimal",
    rating: 4.9,
    vehicle: "Bajaj Pulsar",
    plate: "WP BCD-4521",
    maskedPhone: "+94 11 520 1234",
  },
  { name: "Kasun", rating: 4.8, vehicle: "Honda Dio", plate: "WP BHK-1180", maskedPhone: "+94 11 520 1235" },
];

function readAll(): Order[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Order[];
  } catch {
    return [];
  }
}

function writeAll(orders: Order[]) {
  localStorage.setItem(KEY, JSON.stringify(orders));
}

function update(id: string, change: (o: Order) => Order): Order {
  const all = readAll();
  const i = all.findIndex((o) => o.id === id);
  if (i < 0) throw new OrderError("This order doesn't exist.");
  const next = change(all[i]!);
  all[i] = next;
  writeAll(all);
  return next;
}

const latency = () => new Promise((r) => setTimeout(r, 350));

export async function placeOrder(input: PlaceOrderInput): Promise<Order> {
  await latency();
  if (!input.lines.length) throw new OrderError("Your cart is empty. Add a dish before placing an order.");
  if (input.mode === "delivery" && !input.address) throw new OrderError("Choose where to deliver.");

  // The server recomputes totals and re-checks the promo; it never trusts the client's numbers
  const preview = computeTotals(input.lines, input.restaurant, input.mode);
  let promoDiscount = 0;
  if (input.promoCode) {
    const promo = validatePromo(input.promoCode, preview.subtotal, input.restaurant.id);
    if (!promo.ok) throw new OrderError(promo.error);
    promoDiscount = promo.discount;
  }
  const totals = computeTotals(input.lines, input.restaurant, input.mode, { promoDiscount, tip: input.tip });
  const { count, ...orderTotals } = totals;
  void count;

  const order: Order = {
    id: `KD-${Math.floor(1000 + Math.random() * 9000)}`,
    placedAt: Date.now(),
    mode: input.mode,
    restaurant: input.restaurant,
    lines: input.lines,
    address: input.mode === "delivery" ? input.address : undefined,
    riderNote: input.riderNote,
    scheduledFor: input.scheduledFor,
    payment: input.payment,
    promoCode: input.promoCode,
    totals: orderTotals,
    rider: input.mode === "delivery" ? riders[Math.floor(Math.random() * riders.length)] : undefined,
  };
  writeAll([order, ...readAll()]);
  return order;
}

export async function getOrder(id: string): Promise<Order> {
  const order = readAll().find((o) => o.id === id);
  if (!order) throw new OrderError("This order doesn't exist.");
  return order;
}

/** Most recent order that is still on its way, if any. */
export async function getActiveOrder(): Promise<Order | null> {
  return readAll().find((o) => !FINAL_STATUSES.includes(orderStatus(o))) ?? null;
}

export async function cancelOrder(id: string): Promise<Order> {
  await latency();
  const order = await getOrder(id);
  const status = orderStatus(order);
  if (status !== "placed" && status !== "scheduled")
    throw new OrderError(
      `${order.restaurant.name} has already started on your order, so it can't be cancelled here.`,
    );
  return update(id, (o) => ({ ...o, cancelledAt: Date.now() }));
}

export async function markCollected(id: string): Promise<Order> {
  await latency();
  return update(id, (o) => ({ ...o, collectedAt: Date.now() }));
}

export async function updateTip(id: string, tip: number): Promise<Order> {
  await latency();
  return update(id, (o) => {
    if (o.payment.type !== "card") throw new OrderError("Cash tips are given to the rider at the door.");
    const totals = { ...o.totals, tip, total: o.totals.total - o.totals.tip + tip };
    return { ...o, totals };
  });
}

export async function rateOrder(id: string, rating: Omit<OrderRating, "ratedAt">): Promise<Order> {
  await latency();
  return update(id, (o) => ({ ...o, rating: { ...rating, ratedAt: Date.now() } }));
}
