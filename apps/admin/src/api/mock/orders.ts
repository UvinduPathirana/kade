// Orders for the last seven days, plus a tiny dispatch simulation that moves today's live orders on.
// Later: the order service (GET /orders, order status stream) and the dispatch service.
import { formatRs } from "@kade/ui";
import { DAY, HOUR, MIN, simNow, TODAY_START } from "./clock";
import { customers, dishes, restaurants, riders } from "./partners";
import { seeded } from "./random";
import { zones } from "./zones";
import type { Order, OrderStatus, Refund, Restaurant, Rider } from "../types";

const streets: Record<string, string[]> = {
  c01: ["York Street", "Chatham Street", "Janadhipathi Mawatha"],
  c02: ["Union Place", "Justice Akbar Mawatha", "Glennie Street"],
  c03: ["Charles Place", "Alfred House Gardens", "Flower Road", "Duplication Road", "Bagatalle Road"],
  c04: ["Lauries Road", "Fussels Lane", "Vajira Road", "Bullers Lane", "Clifford Place"],
  c05: ["Park Road", "Thimbirigasyaya Road", "Elvitigala Mawatha"],
  c06: ["Hamden Lane", "Ramakrishna Road", "Pamankada Road", "Fife Road", "Vihara Road"],
  c07: ["Horton Place", "Ward Place", "Rosmead Place", "Barnes Place"],
  c08: ["Kynsey Road", "Castle Street", "Baseline Road"],
  c09: ["Dematagoda Road", "Kolonnawa Road"],
  c10: ["Maradana Road", "Deans Road"],
  c11: ["Main Street", "Keyzer Street"],
  c12: ["Hulftsdorp Street", "Silversmith Street"],
  c13: ["Kotahena Street", "George R. de Silva Mawatha"],
  c14: ["Grandpass Road", "Prince of Wales Avenue"],
  c15: ["Mattakkuliya Road", "Modara Street"],
  raj: ["Parliament Road", "Kotte Road", "Obeysekerapura Road"],
  nug: ["High Level Road", "Stanley Thilakaratne Mawatha", "Nawala Road"],
  deh: ["Galle Road, Dehiwala", "Hill Street", "Station Road", "Karagampitiya Road"],
  mtl: ["De Saram Road", "Hotel Road"],
};

/** Where people order to: weighted towards the busy coastal zones. */
const demand = [
  "c03",
  "c03",
  "c03",
  "c04",
  "c04",
  "c04",
  "c06",
  "c06",
  "c07",
  "c07",
  "c02",
  "c08",
  "c05",
  "deh",
  "deh",
  "c01",
  "c13",
  "c10",
  "raj",
  "nug",
  "c11",
  "c09",
  "c12",
  "c14",
  "c15",
];

/** Order volume by hour of day, 0–1. */
export const hourCurve = [
  0.3, 0.15, 0.05, 0, 0, 0, 0.1, 0.25, 0.35, 0.3, 0.35, 0.6, 1, 0.95, 0.55, 0.35, 0.4, 0.55, 0.8, 1, 0.95,
  0.7, 0.5, 0.4,
];

interface Schedule {
  accept: number;
  ready: number;
  pickup: number;
  deliver: number;
}

/** When each live order reaches each stage. Infinity holds an order where it is (a slow kitchen). */
export const schedules = new Map<string, Schedule>();

let orderSeq = 48000;
const nextOrderId = () => `KD-${++orderSeq}`;

export function restaurantById(id: number): Restaurant {
  return restaurants.find((r) => r.id === id)!;
}

function buildOrder(rand: ReturnType<typeof seeded>, placedAt: number): Order {
  const restaurant = rand.pick(restaurants.filter((r) => r.id !== 16 && r.id !== 13));
  const zoneId = rand.chance(0.45) ? restaurant.zoneId : rand.pick(demand);
  const menu = dishes[restaurant.id]!;
  const lineCount = rand.int(1, 3);
  const lines = Array.from({ length: lineCount }, () => {
    const [name, price] = rand.pick(menu);
    return { name, qty: price < 400 ? rand.int(2, 6) : rand.int(1, 2), price };
  }).filter((l, i, xs) => xs.findIndex((x) => x.name === l.name) === i);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const zone = zones.find((z) => z.id === zoneId)!;
  const distanceKm = zoneId === restaurant.zoneId ? rand.int(5, 25) / 10 : rand.int(25, 70) / 10;
  const deliveryFee =
    zone.baseFee + Math.round(Math.max(0, distanceKm - 2) * zone.perKm) + (subtotal < 500 ? 80 : 0);
  const promo = rand.chance(0.12)
    ? restaurant.id === 1 && rand.chance(0.5)
      ? "FIRSTKOTTU"
      : "KADE100"
    : undefined;
  const discount =
    promo === "FIRSTKOTTU"
      ? Math.min(500, Math.round(subtotal * 0.15))
      : promo === "KADE100" && subtotal >= 1000
        ? 100
        : 0;
  const payment = rand.chance(0.38) ? "cash" : "card";
  const customer = rand.pick(customers.filter((c) => !c.blocked));
  return {
    id: nextOrderId(),
    placedAt,
    status: "delivered",
    customerId: customer.id,
    restaurantId: restaurant.id,
    zoneId,
    address: `No. ${rand.int(3, 220)}, ${rand.pick(streets[zoneId] ?? ["Galle Road"])}`,
    payment,
    cardLast4: payment === "card" ? String(rand.int(1000, 9999)) : undefined,
    lines,
    subtotal,
    deliveryFee,
    discount: promo === "KADE100" && subtotal < 1000 ? 0 : discount,
    promoCode: discount > 0 ? promo : undefined,
    total: subtotal + deliveryFee - discount,
    dueAt: placedAt + (restaurant.etaMin + 15) * MIN,
    distanceKm,
    timeline: [{ at: placedAt, label: "Order placed" }],
    notes: [],
    refunded: 0,
    pos: { x: 0.12 + rand.next() * 0.76, y: 0.12 + rand.next() * 0.76 },
  };
}

const onlineRiders = () => riders.filter((r) => r.status === "online" || r.status === "onJob");

function riderFor(order: Order, rand: () => number, busy: Set<string>): Rider | undefined {
  const pool = onlineRiders().filter((r) => !busy.has(r.id));
  const local = pool.filter((r) => r.zoneIds.includes(order.zoneId) || r.pos.zoneId === order.zoneId);
  const from = local.length ? local : pool;
  return from[Math.floor(rand() * from.length)];
}

/** Writes the stage events into an order's timeline up to `at`. */
function applyStages(order: Order, s: Schedule, at: number, rider?: Rider) {
  const r = restaurantById(order.restaurantId);
  const stages: [number, OrderStatus, string, string?][] = [
    [s.accept, "accepted", `Accepted by ${r.name}`],
    [s.accept + MIN, "preparing", "Kitchen started cooking"],
    [s.ready, "ready", "Ready for pickup"],
    [s.pickup, "pickedUp", "Picked up", rider?.name],
    [s.deliver, "delivered", "Delivered", rider?.name],
  ];
  for (const [time, status, label, by] of stages) {
    if (time > at) break;
    if (order.timeline.some((e) => e.label === label)) continue;
    order.timeline.push({ at: time, label, by });
    order.status = status;
    if (status === "delivered") order.deliveredAt = time;
  }
}

/* ---------- Generate the last seven days ---------- */

export const orders: Order[] = [];
export const refunds: Refund[] = [];

/** Card orders that never arrive are refunded automatically. */
function refundInFull(o: Order, at: number, reason: string) {
  if (o.payment !== "card") return;
  o.refunded = o.total;
  o.timeline.push({ at, label: `Refunded ${formatRs(o.total)} to card ending ${o.cardLast4}`, by: "Kadé" });
  refunds.push({
    id: `RF-${6900 + refunds.length}`,
    at,
    orderId: o.id,
    customerId: o.customerId,
    amount: o.total,
    method: "card",
    reason,
    by: "Automatic",
  });
}

(function generate() {
  const now = simNow();
  const rand = seeded(2026);
  const busy = new Set<string>();
  for (let day = 6; day >= 0; day--) {
    const dayStart = TODAY_START - day * DAY;
    // Today in full; earlier days as a lighter sample to keep the demo quick
    const perPeakHour = day === 0 ? 60 : 9;
    for (let h = 0; h < 24; h++) {
      const count = Math.round(hourCurve[h]! * perPeakHour * (0.85 + rand.next() * 0.3));
      for (let i = 0; i < count; i++) {
        const placedAt = dayStart + h * HOUR + Math.floor(rand.next() * HOUR);
        if (placedAt > now - 30_000) continue;
        const o = buildOrder(rand, placedAt);
        const r = restaurantById(o.restaurantId);
        const s: Schedule = {
          accept: placedAt + rand.int(40, 150) * 1000,
          ready: placedAt + Math.round(r.etaMin * 0.8 + rand.int(0, 4)) * MIN,
          pickup: 0,
          deliver: 0,
        };
        s.pickup = s.ready + rand.int(1, 4) * MIN;
        s.deliver = s.pickup + Math.round((3 + o.distanceKm * 2) * MIN) + rand.int(0, 3) * MIN;
        const roll = rand.next();
        if (roll < 0.025) {
          o.status = "cancelled";
          const fault = rand.pick(["customer", "restaurant", "rider", "kade"] as const);
          const reason = {
            customer: "Customer changed their mind",
            restaurant: "Restaurant ran out of an item",
            rider: "No rider could reach the restaurant",
            kade: "Payment couldn't be confirmed",
          }[fault];
          o.cancel = { reason, fault, by: fault === "customer" ? "Customer" : "Ruwani Silva" };
          o.timeline.push({ at: placedAt + 6 * MIN, label: `Cancelled: ${reason}`, by: o.cancel.by });
          refundInFull(o, placedAt + 6 * MIN, `Cancelled: ${reason}`);
          orders.push(o);
          continue;
        }
        if (roll < 0.035) {
          o.status = "rejected";
          o.timeline.push({ at: s.accept, label: `Rejected by ${r.name}: kitchen too busy` });
          refundInFull(o, s.accept, "Rejected by the restaurant");
          orders.push(o);
          continue;
        }
        if (s.deliver > now) {
          if (s.ready <= now || s.pickup <= now) {
            const rider = riderFor(o, rand.next, busy);
            if (rider) {
              o.riderId = rider.id;
              busy.add(rider.id);
            }
          }
          schedules.set(o.id, s);
        } else {
          o.riderId = rand.pick(riders.slice(0, 40)).id;
        }
        applyStages(
          o,
          s,
          now,
          riders.find((x) => x.id === o.riderId),
        );
        orders.push(o);
      }
    }
  }

  // A handful of live orders are stuck, so the "needs attention" queue has real work in it
  const live = orders.filter((o) => schedules.has(o.id));
  const stuck: [index: number, stage: keyof Schedule, ageMin: number, lateMin: number][] = [
    [3, "pickup", 41, 14],
    [8, "ready", 37, 11],
    [12, "deliver", 52, 18],
    [16, "pickup", 33, 3],
  ];
  for (const [i, stage, ageMin, lateMin] of stuck) {
    const o = live[i];
    if (!o) continue;
    const s = schedules.get(o.id)!;
    const shift = now - ageMin * MIN - o.placedAt;
    o.placedAt += shift;
    o.dueAt = now - lateMin * MIN;
    o.timeline = [{ at: o.placedAt, label: "Order placed" }];
    s.accept = o.placedAt + 90_000;
    s.ready = stage === "ready" ? Infinity : o.placedAt + 18 * MIN;
    s.pickup = stage === "ready" || stage === "pickup" ? Infinity : o.placedAt + 22 * MIN;
    s.deliver = Infinity;
    if (!o.riderId && stage !== "ready") {
      const rider = riderFor(o, rand.next, busy);
      if (rider) {
        o.riderId = rider.id;
        busy.add(rider.id);
      }
    }
    applyStages(
      o,
      s,
      now,
      riders.find((x) => x.id === o.riderId),
    );
  }

  for (const rider of riders) if (busy.has(rider.id) && rider.status === "online") rider.status = "onJob";

  // Past refunds for the ledger; Sanduni (customer flag F-1) has several
  const past = orders.filter((o) => o.status === "delivered" && o.placedAt < TODAY_START);
  const reasons = [
    "Missing item",
    "Wrong item",
    "Late delivery",
    "Food quality",
    "Missing item",
    "Spilled in transit",
  ];
  const sanduni = customers[7]!;
  past.slice(0, 40).forEach((o, i) => {
    if (i % 3 !== 0 && i > 18) return;
    if (i < 6) o.customerId = sanduni.id;
    const amount = i % 4 === 0 ? o.total : Math.round(o.lines[0]!.price * o.lines[0]!.qty);
    o.refunded = amount;
    const refundAt = (o.deliveredAt ?? o.placedAt) + 25 * MIN;
    const method = o.payment === "cash" || i % 2 ? "credit" : "card";
    const reason = i < 6 ? "Missing item" : reasons[i % reasons.length]!;
    const by = i % 3 === 0 ? "Ruwani Silva" : "Imran Lafir";
    o.timeline.push({
      at: refundAt,
      label: `Refunded ${formatRs(amount)} to ${method === "card" ? "card" : "Kadé credit"}`,
      by,
    });
    refunds.push({
      id: `RF-${7100 + i}`,
      at: refundAt,
      orderId: o.id,
      customerId: o.customerId,
      amount,
      method,
      reason,
      by,
    });
  });
  refunds.sort((a, b) => b.at - a.at);
})();

/* ---------- Live simulation ---------- */

let lastTick = simNow();
let arrivalsDue = 0;
const live = seeded(77);

/** Moves live orders on, brings in new ones and nudges riders. Called on every live read. */
export function simulate() {
  const now = simNow();
  if (now - lastTick < 1000) return;
  // New orders arrive roughly every 20 seconds during the rush
  arrivalsDue = Math.min(4, arrivalsDue + (now - lastTick) / 20_000);
  for (; arrivalsDue >= 1; arrivalsDue--) {
    const o = buildOrder(live, now - live.int(0, 20) * 1000);
    const r = restaurantById(o.restaurantId);
    if (!r.accepting || r.status !== "open") continue;
    schedules.set(o.id, {
      accept: o.placedAt + live.int(40, 120) * 1000,
      ready: o.placedAt + Math.round(r.etaMin * 0.8 + 2) * MIN,
      pickup: o.placedAt + Math.round(r.etaMin * 0.8 + 5) * MIN,
      deliver: o.placedAt + Math.round(r.etaMin * 0.8 + 8 + o.distanceKm * 2) * MIN,
    });
    orders.push(o);
  }

  const busy = new Set(
    orders.filter((o) => schedules.has(o.id) && o.riderId && !isFinal(o.status)).map((o) => o.riderId!),
  );
  for (const [id, s] of schedules) {
    const o = orders.find((x) => x.id === id);
    if (!o || isFinal(o.status)) {
      schedules.delete(id);
      continue;
    }
    if (!o.riderId && s.ready - 3 * MIN <= now) {
      const rider = riderFor(o, live.next, busy);
      if (rider) {
        o.riderId = rider.id;
        busy.add(rider.id);
        o.timeline.push({ at: now, label: `${rider.name} assigned`, by: "Dispatch" });
      }
    }
    const rider = riders.find((x) => x.id === o.riderId);
    if (!rider && s.pickup <= now) continue; // can't pick up without a rider
    applyStages(o, s, now, rider);
    if (o.status === "delivered") {
      schedules.delete(id);
      if (rider) {
        if (o.payment === "cash") rider.cashHeld += o.total;
        rider.pos = { zoneId: o.zoneId, x: o.pos.x, y: o.pos.y };
        busy.delete(rider.id);
      }
    }
  }

  for (const rider of riders) {
    if (rider.status === "suspended" || rider.status === "offline") continue;
    rider.status = busy.has(rider.id) ? "onJob" : "online";
    rider.pos.x = Math.min(0.9, Math.max(0.1, rider.pos.x + (live.next() - 0.5) * 0.06));
    rider.pos.y = Math.min(0.9, Math.max(0.1, rider.pos.y + (live.next() - 0.5) * 0.06));
  }
  lastTick = now;
}

export const FINAL: OrderStatus[] = ["delivered", "cancelled", "rejected"];
export const isFinal = (s: OrderStatus) => FINAL.includes(s);

/** Stop the simulation moving an order on (it has been cancelled or reassigned by hand). */
export function holdOrder(id: string) {
  schedules.delete(id);
}

export function resumeOrder(o: Order, now: number) {
  const r = restaurantById(o.restaurantId);
  const s: Schedule =
    o.status === "pickedUp"
      ? {
          accept: o.placedAt,
          ready: o.placedAt,
          pickup: o.placedAt,
          deliver: now + (6 + o.distanceKm * 3) * MIN,
        }
      : {
          accept: Math.min(now, o.placedAt + MIN),
          ready: Math.max(now + 2 * MIN, o.placedAt + r.etaMin * MIN),
          pickup: 0,
          deliver: 0,
        };
  if (o.status !== "pickedUp") {
    s.pickup = s.ready + 4 * MIN;
    s.deliver = s.pickup + (6 + o.distanceKm * 3) * MIN;
  }
  schedules.set(o.id, s);
}
