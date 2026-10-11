// Order API. Live mode calls the customer gateway (order service, with ratings from review and
// reported problems from support joined on); mock mode is a demo service persisted in localStorage.
import { computeTotals } from "@/features/cart/totals";
import { cardLabel } from "@/lib/cards";
import { photos } from "@/lib/images";
import { DECLINING_LAST4, changeCredit, creditBalance, isPlusMember } from "./account";
import { defaultAddresses } from "./addresses";
import { markGroupPlaced } from "./group";
import { FINAL_STATUSES, orderStatus } from "./orderStatus";
import { IS_LIVE } from "./config";
import { OrderError, PaymentDeclinedError } from "./errors";
import * as live from "./live/orders";
import { validatePromo } from "./promos";
import type {
  IssueInput,
  Order,
  OrderLine,
  OrderRating,
  OrderRestaurant,
  PlaceOrderInput,
  Rider,
} from "./types";

const KEY = "kade.orders.v1";

export { OrderError, PaymentDeclinedError };

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

const DAY = 86_400_000;

/** A few past orders so history, reorder and help have something to show on a first visit. */
function seedOrders(): Order[] {
  const at = (daysAgo: number, h: number, m: number) => {
    const d = new Date(Date.now() - daysAgo * DAY);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const l = (
    itemId: string,
    name: string,
    unitPrice: number,
    qty: number,
    choices: string[] = [],
  ): OrderLine => ({
    key: [itemId, ...choices, ""].join("|"),
    itemId,
    name,
    unitPrice,
    qty,
    choices,
    note: "",
  });
  const make = (
    o: Pick<Order, "id" | "placedAt" | "mode" | "lines" | "payment"> & {
      restaurant: OrderRestaurant;
      tip?: number;
    } & Partial<Order>,
  ): Order => {
    const { count, ...totals } = computeTotals(o.lines, o.restaurant, o.mode, { tip: o.tip ?? 0 });
    void count;
    const { tip: _tip, ...rest } = o;
    void _tip;
    return {
      address: o.mode === "delivery" ? defaultAddresses[0] : undefined,
      riderNote: "",
      totals,
      ...rest,
    };
  };
  const visa = { type: "card", brand: "Visa", last4: "4242" } as const;
  return [
    make({
      id: "KD-4821",
      placedAt: at(3, 20, 5),
      mode: "delivery",
      restaurant: {
        id: 1,
        name: "Galle Road Kottu House",
        imageId: photos.kottu,
        eta: [15, 25],
        deliveryFee: 150,
        discountPercent: 20,
        area: "Kollupitiya",
      },
      lines: [
        l("1-0-1", "Cheese kottu", 1450, 1, ["Medium"]),
        l("1-0-0", "Chicken kottu", 1150, 1, ["Sri Lankan hot", "Extra egg"]),
        l("1-4-0", "Faluda", 450, 2, ["Normal"]),
      ],
      payment: visa,
      tip: 100,
      rider: riders[0],
    }),
    make({
      id: "KD-3307",
      placedAt: at(9, 12, 40),
      mode: "delivery",
      restaurant: {
        id: 2,
        name: "Amma's Rice & Curry",
        imageId: photos.curry,
        eta: [20, 30],
        deliveryFee: 0,
        area: "Bambalapitiya",
      },
      lines: [l("2-0-0", "Chicken rice and curry", 750, 2, ["Regular"]), l("2-1-2", "Parippu", 300, 1)],
      payment: { type: "cash" },
      address: defaultAddresses[1],
      rider: riders[1],
    }),
    make({
      id: "KD-2954",
      placedAt: at(17, 19, 15),
      mode: "pickup",
      restaurant: {
        id: 6,
        name: "Smash Shed",
        imageId: photos.burger,
        eta: [20, 30],
        deliveryFee: 0,
        area: "Kollupitiya",
      },
      lines: [l("6-0-0", "Double smash", 1850, 1), l("6-1-0", "Fries", 550, 1)],
      payment: visa,
      collectedAt: at(17, 19, 38),
    }),
    make({
      id: "KD-2410",
      placedAt: at(24, 16, 30),
      mode: "delivery",
      restaurant: {
        id: 3,
        name: "Kompanna Short Eats",
        imageId: photos.buns,
        eta: [10, 20],
        deliveryFee: 120,
        area: "Slave Island",
      },
      lines: [l("3-0-0", "Fish bun", 140, 6)],
      payment: visa,
      cancelledAt: at(24, 16, 31),
    }),
  ];
}

function readAll(): Order[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) {
      const seeded = seedOrders();
      writeAll(seeded);
      return seeded;
    }
    return JSON.parse(raw) as Order[];
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

async function mockPlaceOrder(input: PlaceOrderInput): Promise<Order> {
  await latency();
  if (!input.lines.length) throw new OrderError("Your cart is empty. Add a dish before placing an order.");
  if (input.mode === "delivery" && !input.address) throw new OrderError("Choose where to deliver.");
  if (input.payment.type === "card" && input.payment.last4 === DECLINING_LAST4)
    throw new PaymentDeclinedError(
      `Your bank declined ${cardLabel(input.payment)}, so nothing was charged. Pay with another card or with cash instead.`,
    );

  // The server recomputes totals and re-checks the promo; it never trusts the client's numbers
  const preview = computeTotals(input.lines, input.restaurant, input.mode);
  let promoDiscount = 0;
  if (input.promoCode) {
    const promo = validatePromo(input.promoCode, preview.subtotal, input.restaurant.id);
    if (!promo.ok) throw new OrderError(promo.error);
    promoDiscount = promo.discount;
  }
  const totals = computeTotals(input.lines, input.restaurant, input.mode, {
    promoDiscount,
    tip: input.tip,
    plus: isPlusMember(),
    credit: input.useCredit ? creditBalance() : 0,
  });
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
    substitution: input.substitution,
    groupId: input.groupId,
  };
  writeAll([order, ...readAll()]);
  if (orderTotals.credit) changeCredit(-orderTotals.credit, `Used on order ${order.id}`);
  if (input.groupId) markGroupPlaced(input.groupId, order.id);
  return order;
}

async function mockGetOrder(id: string): Promise<Order> {
  const order = readAll().find((o) => o.id === id);
  if (!order) throw new OrderError("This order doesn't exist.");
  return order;
}

/** Every order on this account, newest first. */
async function mockListOrders(): Promise<Order[]> {
  return readAll().sort((a, b) => b.placedAt - a.placedAt);
}

/** Most recent order that is still on its way, if any. */
async function mockGetActiveOrder(): Promise<Order | null> {
  return readAll().find((o) => !FINAL_STATUSES.includes(orderStatus(o))) ?? null;
}

async function mockCancelOrder(id: string): Promise<Order> {
  await latency();
  const order = await mockGetOrder(id);
  const status = orderStatus(order);
  if (status !== "placed" && status !== "scheduled")
    throw new OrderError(
      `${order.restaurant.name} has already started on your order, so it can't be cancelled here.`,
    );
  return update(id, (o) => ({ ...o, cancelledAt: Date.now() }));
}

async function mockMarkCollected(id: string): Promise<Order> {
  await latency();
  return update(id, (o) => ({ ...o, collectedAt: Date.now() }));
}

async function mockUpdateTip(id: string, tip: number): Promise<Order> {
  await latency();
  return update(id, (o) => {
    if (o.payment.type !== "card") throw new OrderError("Cash tips are given to the rider at the door.");
    const totals = { ...o.totals, tip, total: o.totals.total - o.totals.tip + tip };
    return { ...o, totals };
  });
}

async function mockRateOrder(id: string, rating: Omit<OrderRating, "ratedAt">): Promise<Order> {
  await latency();
  return update(id, (o) => ({ ...o, rating: { ...rating, ratedAt: Date.now() } }));
}

/** What the support service would pay back for a problem. Shown before sending, so there are no surprises. */
export function issueAmount(order: Order, input: Pick<IssueInput, "kind" | "lines">): number {
  switch (input.kind) {
    case "missing":
    case "wrong":
    case "spilled": {
      const full = input.lines.reduce((sum, { key, qty }) => {
        const line = order.lines.find((l) => l.key === key);
        return sum + (line ? line.unitPrice * Math.min(qty, line.qty) : 0);
      }, 0);
      // Refund what was paid for those dishes, after the restaurant's discount
      return Math.round(full * (1 - (order.restaurant.discountPercent ?? 0) / 100));
    }
    case "late":
      return Math.max(order.totals.deliveryFee, 200);
    case "neverArrived":
      return order.totals.total + (order.totals.credit ?? 0);
    case "charged":
      return 0;
  }
}

async function mockReportIssue(id: string, input: IssueInput): Promise<Order> {
  await latency();
  const order = await mockGetOrder(id);
  const status = orderStatus(order);
  if (order.issue)
    throw new OrderError(
      "You've already reported a problem with this order. Chat with us if something else is wrong.",
    );
  if (input.kind !== "charged" && status !== "delivered" && status !== "collected")
    throw new OrderError("You can report a problem once the order has arrived.");
  if (["missing", "wrong", "spilled"].includes(input.kind) && !input.lines.some((l) => l.qty > 0))
    throw new OrderError("Choose the dishes that were affected.");
  if (input.kind === "charged" && !input.note.trim())
    throw new OrderError("Tell us what looks wrong with the charge so the payments team can check it.");
  if (input.resolution === "card" && order.payment.type !== "card")
    throw new OrderError("This order was paid in cash, so the refund can only go to your Kadé credit.");

  const amount = issueAmount(order, input);
  if (input.resolution === "credit" && amount > 0) changeCredit(amount, `Refund for order ${order.id}`);
  return update(id, (o) => ({ ...o, issue: { ...input, amount, reportedAt: Date.now() } }));
}

export const placeOrder = IS_LIVE ? live.placeOrder : mockPlaceOrder;
export const getOrder = IS_LIVE ? live.getOrder : mockGetOrder;
export const listOrders = IS_LIVE ? live.listOrders : mockListOrders;
export const getActiveOrder = IS_LIVE ? live.getActiveOrder : mockGetActiveOrder;
export const cancelOrder = IS_LIVE ? live.cancelOrder : mockCancelOrder;
export const markCollected = IS_LIVE ? live.markCollected : mockMarkCollected;
export const updateTip = IS_LIVE ? live.updateTip : mockUpdateTip;
export const rateOrder = IS_LIVE ? live.rateOrder : mockRateOrder;
export const reportIssue = IS_LIVE ? live.reportIssue : mockReportIssue;
