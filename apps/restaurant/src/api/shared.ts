// Pure helpers the screens use, the same whichever backend (mock or live) answers. The API modules
// (orders.ts, outlet.ts, …) re-export them so components import from one place.
import type { DailySales, Offer, OutletStatus, RejectReason, StaffRole, Ticket, TicketRider } from "./types";

// ---------- Orders ----------

/** The kitchen has this long to accept a new order (the order service's timer). */
export const ACCEPT_WINDOW_MS = 3 * 60_000;

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

// ---------- Outlet ----------

/** True while the pause is in force. */
export const isPaused = (status: OutletStatus, now = Date.now()) =>
  status.pausedUntil !== null && status.pausedUntil > now;

// ---------- Staff ----------

export const roleLabels: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  kitchen: "Kitchen",
};
export const roleDescriptions: Record<StaffRole, string> = {
  owner: "Everything, including payouts and bank details",
  manager: "Orders, menu, hours, promotions and reviews",
  kitchen: "Live orders and sold-out switches only",
};

// ---------- Promotions ----------

export type OfferState = "active" | "scheduled" | "ended";

/** Today as an ISO date in Colombo time (the outlet's clock, whatever the tablet's timezone). */
export const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

export function offerState(o: Offer, today = todayIso()): OfferState {
  if (o.endedAt || o.endDate < today || o.spent >= o.budget) return "ended";
  if (o.startDate > today) return "scheduled";
  return "active";
}

// ---------- Payouts ----------

/** Kadé keeps 18% commission on food sales. */
export const COMMISSION_RATE = 0.18;
const DAY = 86_400_000;

const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);
const fromIso = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso: string, n: number) => toIso(fromIso(iso) + n * DAY);
/** 0 = Monday … 6 = Sunday */
export const weekday = (iso: string) => (new Date(fromIso(iso)).getUTCDay() + 6) % 7;
export const mondayOf = (iso: string) => addDays(iso, -weekday(iso));

export const grossOf = (d: Pick<DailySales, "card" | "cash">) => d.card + d.cash;
