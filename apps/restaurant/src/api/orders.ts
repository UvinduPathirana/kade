// Kitchen orders API. Today a mock order service kept in localStorage that also plays the part of
// the customers: a new order arrives every 40–60 seconds while the outlet is open. Later this is
// the order service (GET /outlets/:id/orders?live, POST /orders/:id/accept|reject|ready|handover)
// with new orders pushed over a socket, and riders assigned by the dispatch service.
import { readMenuNow } from "./menu";
import { isPaused, readStatusNow } from "./outlet";
import { latency, readJson, ServiceError, writeJson } from "./storage";
import type { MenuItem, RejectReason, Ticket, TicketLine, TicketRider } from "./types";

const KEY = "kade.partner.orders.v1";
export const ACCEPT_WINDOW_MS = 3 * 60_000;
const MIN = 60_000;

interface Board {
  tickets: Ticket[];
  nextArrivalAt: number;
  nextNumber: number;
  seededAt: number;
}

// ---------- Simulated customers and riders ----------

const names = [
  "Shehani",
  "Ravindu",
  "Aisha",
  "Dinuka",
  "Fathima",
  "Tharindu",
  "Malsha",
  "Kavindi",
  "Nuwan",
  "Priyanka",
  "Ishara",
  "Roshan",
  "Zainab",
  "Chamath",
  "Hasini",
];
const dishNotes = [
  "No leeks please",
  "Extra crispy",
  "For a child, keep it very mild",
  "Less oil",
  "No egg, allergic",
  "Cut the roti small",
];
const orderNotes = [
  "Please pack the gravy separately",
  "Two spoons and extra serviettes",
  "It's a birthday, please write Happy Birthday on the box",
  "Please don't add chilli paste",
];
export const riders: TicketRider[] = [
  { name: "Kasun", vehicle: "Honda Dio", plate: "WP BHK-1180", maskedPhone: "+94 11 520 1235" },
  { name: "Nimal", vehicle: "Bajaj Pulsar", plate: "WP BCD-4521", maskedPhone: "+94 11 520 1234" },
  { name: "Sanjeewa", vehicle: "TVS Ntorq", plate: "WP BJA-3307", maskedPhone: "+94 11 520 1240" },
  { name: "Ifham", vehicle: "Yamaha FZ", plate: "WP BEX-9120", maskedPhone: "+94 11 520 1251" },
  { name: "Ruwan", vehicle: "Bajaj CT100", plate: "WP BFM-0416", maskedPhone: "+94 11 520 1262" },
];

/** Seeded random so a seed or an order is reproducible from its number. */
function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

function makeLine(r: () => number, item: MenuItem): TicketLine {
  const { optionGroups } = readMenuNow();
  const choices: string[] = [];
  let unitPrice = item.price;
  for (const gid of item.optionGroupIds) {
    const g = optionGroups.find((x) => x.id === gid);
    if (!g) continue;
    if (g.required) choices.push(pick(r, g.choices).name);
    else if (r() < 0.45) {
      const c = pick(r, g.choices);
      choices.push(c.name);
      unitPrice += c.price;
    }
  }
  return {
    itemId: item.id,
    name: item.name,
    qty: r() < 0.3 ? 2 : 1,
    choices,
    note: r() < 0.25 ? pick(r, dishNotes) : "",
    unitPrice,
  };
}

/** Builds a believable order from what's on the menu and not sold out. */
function makeTicket(n: number, placedAt: number): Ticket {
  const r = rng(n * 7919);
  const items = readMenuNow()
    .sections.flatMap((s) => s.items)
    .filter((i) => !i.soldOut);
  const mains = items.filter((i) => i.price >= 800);
  const sides = items.filter((i) => i.price < 800);
  const lines = [makeLine(r, pick(r, mains.length ? mains : items))];
  if (r() < 0.6 && mains.length) lines.push(makeLine(r, pick(r, mains)));
  if (r() < 0.5 && sides.length) lines.push(makeLine(r, pick(r, sides)));
  // Same dish with the same choices on two lines reads badly on a ticket: merge them
  const merged = lines.reduce<TicketLine[]>((acc, l) => {
    const same = acc.find(
      (a) => a.itemId === l.itemId && a.note === l.note && a.choices.join() === l.choices.join(),
    );
    if (same) same.qty += l.qty;
    else acc.push(l);
    return acc;
  }, []);
  return {
    id: String(n),
    placedAt,
    acceptBy: placedAt + ACCEPT_WINDOW_MS,
    status: "new",
    mode: r() < 0.8 ? "delivery" : "pickup",
    customerName: pick(r, names),
    repeatCount: r() < 0.4 ? Math.floor(r() * 12) + 1 : 0,
    lines: merged,
    kitchenNote: r() < 0.3 ? pick(r, orderNotes) : "",
    cutlery: r() < 0.5,
    payment: r() < 0.65 ? "card" : "cash",
    subtotal: merged.reduce((sum, l) => sum + l.unitPrice * l.qty, 0),
  };
}

function accept(t: Ticket, at: number, prepMinutes: number, riderIndex: number): Ticket {
  const readyBy = at + prepMinutes * MIN;
  return {
    ...t,
    status: "preparing",
    acceptedAt: at,
    prepMinutes,
    readyBy,
    ...(t.mode === "delivery" && {
      rider: riders[riderIndex % riders.length],
      // Dispatch times the rider to arrive about when the food is ready
      riderArrivesAt: readyBy + ((riderIndex % 5) - 2) * MIN,
    }),
  };
}

/** A busy evening already under way: some cooking, one waiting for its rider, a few gone out. */
function seedBoard(now: number): Board {
  const n = 2401;
  const t = (i: number, minsAgo: number) => makeTicket(n + i, now - minsAgo * MIN);
  const pickedUp = (x: Ticket, i: number, readyMinsAgo: number): Ticket => {
    const a = accept(x, x.placedAt + 1 * MIN, 15, i);
    const readyAt = now - readyMinsAgo * MIN;
    return { ...a, status: "pickedUp", readyAt, pickedUpAt: readyAt + 2 * MIN, closedAt: readyAt + 2 * MIN };
  };
  const tickets: Ticket[] = [
    pickedUp(t(0, 52), 0, 30),
    pickedUp(t(1, 44), 1, 22),
    { ...t(2, 38), status: "missed", closedAt: now - 35 * MIN },
    pickedUp(t(3, 30), 3, 9),
    { ...accept(t(4, 19), now - 18 * MIN, 15, 4), status: "ready", readyAt: now - 3 * MIN },
    accept(t(5, 9), now - 8 * MIN, 15, 0),
    accept(t(6, 4), now - 3.5 * MIN, 20, 1),
    t(7, 1.6),
    t(8, 0.9),
    t(9, 0.2),
  ];
  // The ready order's rider has just reached the counter
  const ready = tickets[4]!;
  ready.riderArrivesAt = now - 1.5 * MIN;
  return { tickets, nextArrivalAt: now + 45_000, nextNumber: n + 10, seededAt: now };
}

// ---------- Store ----------

const read = () => readJson<Board>(KEY, () => seedBoard(Date.now()));

/**
 * Moves the simulation forward to `now`: new orders arrive, unaccepted ones expire, old ones leave
 * the board. A board left for over two hours starts a fresh evening so the demo is never stale.
 */
function advance(now: number): Board {
  let board = read();
  if (now - board.seededAt > 2 * 60 * MIN) board = seedBoard(now);

  if (now >= board.nextArrivalAt) {
    const waiting = board.tickets.filter((t) => t.status === "new").length;
    if (!isPaused(readStatusNow(), now) && waiting < 4) {
      board.tickets.push(makeTicket(board.nextNumber++, now));
    }
    board.nextArrivalAt = now + 40_000 + Math.random() * 20_000;
  }

  board.tickets = board.tickets
    .map((t) =>
      t.status === "new" && now > t.acceptBy ? { ...t, status: "missed", closedAt: t.acceptBy } : t,
    )
    // Finished orders stay on the board for an hour; the ticket page keeps working until the reseed.
    .filter((t) => !t.closedAt || now - t.closedAt < 90 * MIN) as Ticket[];

  writeJson(KEY, board);
  return board;
}

function update(id: string, change: (t: Ticket, now: number) => Ticket): Ticket {
  const now = Date.now();
  const board = advance(now);
  const i = board.tickets.findIndex((t) => t.id === id);
  if (i < 0) throw new ServiceError(`Order #${id} is no longer on the board.`);
  const next = change(board.tickets[i]!, now);
  board.tickets[i] = next;
  writeJson(KEY, board);
  return structuredClone(next);
}

// ---------- API ----------

/** Everything on the board, oldest first. Polled every second while the app is open. */
export async function listTickets(): Promise<Ticket[]> {
  return structuredClone(advance(Date.now()).tickets);
}

export async function getTicket(id: string): Promise<Ticket | null> {
  await latency(100);
  return structuredClone(advance(Date.now()).tickets.find((t) => t.id === id) ?? null);
}

export async function acceptTicket({ id, prepMinutes }: { id: string; prepMinutes: number }) {
  await latency(200);
  return update(id, (t, now) => {
    if (t.status === "missed") throw new ServiceError(`Order #${id} wasn't accepted in time.`);
    if (t.status !== "new") throw new ServiceError(`Order #${id} has already been accepted.`);
    return accept(t, now, prepMinutes, Number(id));
  });
}

export async function rejectTicket({ id, reason, note }: { id: string; reason: RejectReason; note: string }) {
  await latency(200);
  return update(id, (t, now) => {
    if (t.status !== "new") throw new ServiceError(`Order #${id} can't be rejected now.`);
    return { ...t, status: "rejected", rejectReason: reason, rejectNote: note, closedAt: now };
  });
}

export async function markReady(id: string) {
  await latency(150);
  return update(id, (t, now) => {
    if (t.status !== "preparing") throw new ServiceError(`Order #${id} isn't being prepared.`);
    // Demo: when food is ready early, dispatch sends a closer rider who arrives within a minute
    const riderArrivesAt = t.riderArrivesAt && t.riderArrivesAt > now + MIN ? now + 45_000 : t.riderArrivesAt;
    return { ...t, status: "ready", readyAt: now, riderArrivesAt };
  });
}

/** Rider took the bag (delivery) or the customer collected it (pickup). */
export async function handOver(id: string) {
  await latency(150);
  return update(id, (t, now) => {
    if (t.status !== "ready") throw new ServiceError(`Order #${id} isn't ready yet.`);
    return { ...t, status: "pickedUp", pickedUpAt: now, closedAt: now };
  });
}

// ---------- Derived state shared by the board and the ticket ----------

export type RiderState =
  | { kind: "pickup" }
  | { kind: "finding" }
  | { kind: "onTheWay"; rider: TicketRider; arrivesIn: number }
  | { kind: "waiting"; rider: TicketRider; waitingFor: number };

export function riderState(t: Ticket, now: number): RiderState {
  if (t.mode === "pickup") return { kind: "pickup" };
  if (!t.rider || !t.riderArrivesAt) return { kind: "finding" };
  return t.riderArrivesAt > now
    ? { kind: "onTheWay", rider: t.rider, arrivesIn: t.riderArrivesAt - now }
    : { kind: "waiting", rider: t.rider, waitingFor: now - t.riderArrivesAt };
}

export const itemCount = (t: Ticket) => t.lines.reduce((n, l) => n + l.qty, 0);

export const rejectReasons: Record<RejectReason, string> = {
  tooBusy: "Kitchen is too busy",
  soldOut: "An item is sold out",
  closingSoon: "Closing soon",
  other: "Something else",
};
