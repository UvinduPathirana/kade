import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { demoSeeds } from "../db/schema.js";
import type { TicketLineJson, TicketRiderJson } from "../db/schema.js";
import { ACCEPT_WINDOW_MS, MINUTE, seededId } from "../domain/values.js";
import type { NewTicket, TicketPatch, TicketRow } from "../kitchen/tickets.repository.js";
import { TicketsRepository } from "../kitchen/tickets.repository.js";
import { CONFIG, type Config } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { DEMO_OUTLET_ID } from "./seed-data.js";

/** A demo evening is laid out again once it is this old, so the board never looks stale. */
export const DEMO_TTL_MS = 2 * 60 * MINUTE;
const CHECK_EVERY_MS = 30_000;
const FIRST_NUMBER = 2401;

/** Demo order ids: group 8d00 ("demo"), never produced by the order service. */
export const demoOrderId = (n: number) => seededId("8d00", n);
export const isDemoOrderId = (id: string) => id.startsWith("00000000-0000-7000-8d00-");

export const DEMO_RIDERS: TicketRiderJson[] = [
  {
    riderId: seededId("8001", 102),
    name: "Kasun",
    vehicle: "Honda Dio",
    plate: "WP BHK-1180",
    maskedPhone: "+94 11 520 1235",
  },
  {
    riderId: seededId("8001", 101),
    name: "Nimal",
    vehicle: "Bajaj Pulsar",
    plate: "WP BCD-4521",
    maskedPhone: "+94 11 520 1234",
  },
  {
    riderId: seededId("8001", 106),
    name: "Sanjeewa",
    vehicle: "TVS Ntorq",
    plate: "WP BJA-3307",
    maskedPhone: "+94 11 520 1240",
  },
  {
    riderId: seededId("8001", 113),
    name: "Ifham",
    vehicle: "Yamaha FZ",
    plate: "WP BEX-9120",
    maskedPhone: "+94 11 520 1251",
  },
  {
    riderId: seededId("8001", 107),
    name: "Ruwan",
    vehicle: "Bajaj CT100",
    plate: "WP BFM-0416",
    maskedPhone: "+94 11 520 1262",
  },
];

// Galle Road Kottu House menu (apps/restaurant/src/api/mock/menu.ts), prices in rupees.
type Dish = [itemId: string, name: string, price: number, extras: boolean];
const MAINS: Dish[] = [
  ["1-1-0", "Chicken kottu", 1150, true],
  ["1-1-1", "Cheese kottu", 1450, true],
  ["1-1-2", "Dolphin kottu", 1650, true],
  ["1-1-3", "Egg kottu", 950, true],
  ["1-1-4", "Vegetable kottu", 850, true],
  ["1-1-5", "Beef kottu", 1350, true],
  ["1-2-0", "Chicken fried rice", 1100, false],
  ["1-2-1", "Nasi goreng", 1350, false],
  ["1-3-0", "Devilled chicken", 1400, false],
  ["1-3-1", "Hot butter cuttlefish", 1650, false],
];
const SIDES: Dish[] = [
  ["1-4-0", "Fish roll", 180, false],
  ["1-4-1", "Chicken patty", 160, false],
  ["1-4-2", "Egg roti", 220, false],
  ["1-5-1", "Iced Milo", 400, false],
  ["1-5-3", "Watalappan", 450, false],
];
const SPICE = ["Mild", "Medium", "Sri Lankan hot"];
const EXTRAS: [string, number][] = [
  ["Extra egg", 150],
  ["Extra cheese", 250],
  ["Extra chicken", 350],
  ["Curry gravy on the side", 0],
];
const NAMES = [
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
];
const DISH_NOTES = [
  "No leeks please",
  "Extra crispy",
  "For a child, keep it very mild",
  "Less oil",
  "Cut the roti small",
];
const ORDER_NOTES = [
  "Please pack the gravy separately",
  "Two spoons and extra serviettes",
  "Please don't add chilli paste",
];

function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

function line(r: () => number, [itemId, name, price, extras]: Dish): TicketLineJson {
  const choiceNames: string[] = [];
  let unit = price;
  if (extras || name.startsWith("Devilled") || name.startsWith("Hot")) choiceNames.push(pick(r, SPICE));
  if (extras && r() < 0.45) {
    const [extra, cost] = pick(r, EXTRAS);
    choiceNames.push(extra);
    unit += cost;
  }
  return {
    itemId,
    name,
    quantity: r() < 0.3 ? 2 : 1,
    choiceNames,
    note: r() < 0.25 ? pick(r, DISH_NOTES) : "",
    unitPriceMinor: unit * 100,
  };
}

/** A believable demo ticket, reproducible from its number. */
export function demoTicket(n: number, placedAt: Date): NewTicket {
  const r = rng(n * 7919);
  const lines = [line(r, pick(r, MAINS))];
  if (r() < 0.6) lines.push(line(r, pick(r, MAINS)));
  if (r() < 0.5) lines.push(line(r, pick(r, SIDES)));
  const merged = lines.reduce<TicketLineJson[]>((acc, l) => {
    const same = acc.find(
      (a) => a.itemId === l.itemId && a.note === l.note && a.choiceNames.join() === l.choiceNames.join(),
    );
    if (same) same.quantity += l.quantity;
    else acc.push(l);
    return acc;
  }, []);
  return {
    orderId: demoOrderId(n),
    outletId: DEMO_OUTLET_ID,
    source: "demo",
    orderNumber: `KD-${n}`,
    ticketNumber: String(n),
    status: "new",
    mode: r() < 0.8 ? "delivery" : "pickup",
    customerId: "",
    customerFirstName: pick(r, NAMES),
    repeatCount: r() < 0.4 ? Math.floor(r() * 12) + 1 : 0,
    lines: merged,
    kitchenNote: r() < 0.3 ? pick(r, ORDER_NOTES) : "",
    cutlery: r() < 0.5,
    payment: r() < 0.65 ? "card" : "cash",
    subtotalMinor: merged.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0),
    placedAt,
    acceptBy: new Date(placedAt.getTime() + ACCEPT_WINDOW_MS),
  };
}

function accepted(t: NewTicket, at: Date, prepMinutes: number, riderIndex: number): NewTicket {
  const readyBy = new Date(at.getTime() + prepMinutes * MINUTE);
  return {
    ...t,
    status: "preparing",
    acceptedAt: at,
    prepMinutes,
    readyBy,
    ...(t.mode === "delivery" && {
      rider: DEMO_RIDERS[riderIndex % DEMO_RIDERS.length]!,
      riderArrivesAt: new Date(readyBy.getTime() + ((riderIndex % 5) - 2) * MINUTE),
    }),
  };
}

/** A busy evening already under way: some cooking, one waiting for its rider, a few gone out. */
export function demoEvening(now: Date): NewTicket[] {
  const ago = (mins: number) => new Date(now.getTime() - mins * MINUTE);
  const t = (i: number, minsAgo: number) => demoTicket(FIRST_NUMBER + i, ago(minsAgo));
  const pickedUp = (x: NewTicket, i: number, readyMinsAgo: number): NewTicket => {
    const a = accepted(x, new Date((x.placedAt as Date).getTime() + MINUTE), 15, i);
    const readyAt = ago(readyMinsAgo);
    const gone = new Date(readyAt.getTime() + 2 * MINUTE);
    return { ...a, status: "picked_up", readyAt, pickedUpAt: gone, closedAt: gone };
  };
  const missed = t(2, 38);
  const ready = { ...accepted(t(4, 19), ago(18), 15, 4), status: "ready", readyAt: ago(3) } as NewTicket;
  // The ready order's rider has just reached the counter.
  if (ready.mode === "delivery") Object.assign(ready, { riderArrivesAt: ago(1.5), riderAtCounter: true });
  return [
    pickedUp(t(0, 52), 0, 30),
    pickedUp(t(1, 44), 1, 22),
    { ...missed, status: "missed", rejectReason: "timeout", closedAt: missed.acceptBy },
    pickedUp(t(3, 30), 3, 9),
    ready,
    accepted(t(5, 9), ago(8), 15, 0),
    accepted(t(6, 4), ago(3.5), 20, 1),
    t(7, 1.6),
    t(8, 0.9),
    t(9, 0.2),
  ];
}

/**
 * The seeded evening on Galle Road Kottu House's board (source = 'demo', order ids …-8d00-…, numbers
 * KD-2401…2410). Demo tickets can be accepted/rejected/readied/handed over like real ones, but never
 * publish events (no order exists behind them). Laid out at boot and again when older than 2 hours.
 */
@Injectable()
export class DemoBoard {
  private lastCheck = 0;

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(TicketsRepository) private readonly tickets: TicketsRepository,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  get enabled(): boolean {
    return this.config.DEMO_BOARD;
  }

  /** Re-lays the demo evening if it is missing or stale. Cheap: checks at most every 30 s. */
  async ensureFresh(outletId: string, now = new Date(), force = false): Promise<boolean> {
    if (!this.enabled || outletId !== DEMO_OUTLET_ID) return false;
    if (!force && now.getTime() - this.lastCheck < CHECK_EVERY_MS) return false;
    this.lastCheck = now.getTime();
    const key = `board:${outletId}`;
    return this.database.transaction(undefined, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      const [seed] = await tx.select().from(demoSeeds).where(eq(demoSeeds.key, key));
      if (!force && seed && now.getTime() - seed.seededAt.getTime() < DEMO_TTL_MS) return false;
      await this.tickets.deleteDemo(tx, outletId);
      await this.tickets.insertMany(tx, demoEvening(now));
      await tx
        .insert(demoSeeds)
        .values({ key, seededAt: now })
        .onConflictDoUpdate({ target: demoSeeds.key, set: { seededAt: now } });
      this.logger.info({ outletId }, "demo kitchen board laid out");
      return true;
    });
  }

  /** Demo delivery tickets get a rider when accepted (dispatch would do this for real orders). */
  riderOnAccept(t: TicketRow, readyBy: Date): TicketPatch {
    if (t.mode !== "delivery") return {};
    const i = Number(t.ticketNumber) || 0;
    return {
      rider: DEMO_RIDERS[i % DEMO_RIDERS.length]!,
      riderArrivesAt: new Date(readyBy.getTime() + ((i % 5) - 2) * MINUTE),
      riderAtCounter: false,
    };
  }

  /** Food ready early: a closer rider is sent who arrives within a minute (as in the app's mock). */
  riderOnReady(t: TicketRow, now: Date): TicketPatch {
    if (t.mode !== "delivery" || !t.riderArrivesAt) return {};
    return t.riderArrivesAt.getTime() > now.getTime() + MINUTE
      ? { riderArrivesAt: new Date(now.getTime() + 45_000) }
      : {};
  }
}
