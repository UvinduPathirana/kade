// Promotions API. Today a mock in localStorage; later the promotions service
// (GET/POST /outlets/:id/offers, POST /offers/:id/end). The restaurant funds its own offers:
// discounts come off the weekly payout, and an offer stops by itself when its budget is spent.
import { latency, readJson, ServiceError, writeJson } from "./storage";
import type { Offer, OfferInput } from "./types";

const KEY = "kade.partner.offers.v1";

const base = { value: 0, maxDiscount: 0, minOrder: 0, buy: 0, get: 0, sectionIds: [] as string[] };

const seed = (): Offer[] => [
  {
    ...base,
    id: "o1",
    type: "percent",
    value: 20,
    sectionIds: ["s0"],
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    budget: 60000,
    spent: 38450,
    orders: 142,
  },
  {
    ...base,
    id: "o2",
    type: "freeDelivery",
    minOrder: 2000,
    startDate: "2026-10-16",
    endDate: "2026-10-18",
    budget: 15000,
    spent: 0,
    orders: 0,
  },
  {
    ...base,
    id: "o3",
    type: "bogo",
    buy: 2,
    get: 1,
    bogoItemId: "1-4-0",
    startDate: "2026-10-24",
    endDate: "2026-10-26",
    budget: 10000,
    spent: 0,
    orders: 0,
  },
  {
    ...base,
    id: "o4",
    type: "amount",
    value: 300,
    minOrder: 2500,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    budget: 30000,
    spent: 30000,
    orders: 100,
  },
  {
    ...base,
    id: "o5",
    type: "percent",
    value: 15,
    maxDiscount: 400,
    startDate: "2026-08-10",
    endDate: "2026-08-31",
    budget: 25000,
    spent: 18920,
    orders: 61,
  },
];

const read = () => readJson<Offer[]>(KEY, seed);

export type OfferState = "active" | "scheduled" | "ended";

/** Today as an ISO date in Colombo time (the outlet's clock, whatever the tablet's timezone). */
export const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

export function offerState(o: Offer, today = todayIso()): OfferState {
  if (o.endedAt || o.endDate < today || o.spent >= o.budget) return "ended";
  if (o.startDate > today) return "scheduled";
  return "active";
}

export async function listOffers(): Promise<Offer[]> {
  await latency(150);
  return structuredClone(read());
}

export async function createOffer(input: OfferInput): Promise<Offer> {
  await latency();
  if (input.endDate < input.startDate) throw new ServiceError("The end date is before the start date.");
  const offer: Offer = { ...input, id: `o-${Date.now().toString(36)}`, spent: 0, orders: 0 };
  writeJson(KEY, [offer, ...read()]);
  return offer;
}

/** Ends an active offer now, or cancels a scheduled one before it starts. */
export async function endOffer(id: string): Promise<Offer> {
  await latency();
  const all = read();
  const offer = all.find((o) => o.id === id);
  if (!offer) throw new ServiceError("This offer no longer exists.");
  offer.endedAt = Date.now();
  writeJson(KEY, all);
  return offer;
}
