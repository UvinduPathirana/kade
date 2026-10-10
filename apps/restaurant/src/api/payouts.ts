// Payouts API. Today a mock that generates the outlet's sales from a fixed seed; later the payouts
// service (GET /outlets/:id/sales?from&to, GET /outlets/:id/statements, GET /statements/:id.csv).
// Kadé keeps 18% commission on food sales. Offers the restaurant funds come off the payout too.
// Payouts go to the bank every Tuesday for the Monday–Sunday week before.
import { todayIso } from "./promotions";
import { latency } from "./storage";
import type { DailySales, Statement } from "./types";

export const COMMISSION_RATE = 0.18;
const DAY = 86_400_000;

const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);
const fromIso = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso: string, n: number) => toIso(fromIso(iso) + n * DAY);
/** 0 = Monday … 6 = Sunday */
export const weekday = (iso: string) => (new Date(fromIso(iso)).getUTCDay() + 6) % 7;
export const mondayOf = (iso: string) => addDays(iso, -weekday(iso));

/** Deterministic noise per day, so the same date always shows the same sales. */
function noise(iso: string) {
  let h = 0;
  for (const c of iso) h = (h * 31 + c.charCodeAt(0)) % 100_003;
  return (h % 1000) / 1000;
}

function dayOf(iso: string): DailySales {
  const wd = weekday(iso);
  const n = noise(iso);
  // Friday and Saturday nights are the kottu rush; Poya days are quiet
  const orders = Math.round((wd >= 4 && wd <= 5 ? 105 : wd === 6 ? 88 : 64) * (0.85 + n * 0.3));
  const gross = orders * Math.round(2150 + n * 400);
  const card = Math.round((gross * (0.58 + n * 0.1)) / 10) * 10;
  return {
    date: iso,
    orders,
    card,
    cash: gross - card,
    offerCost: iso >= "2026-10-01" ? Math.round(gross * 0.035) : Math.round(gross * 0.012),
  };
}

export async function getSales(from: string, to: string): Promise<DailySales[]> {
  await latency(200);
  const days: DailySales[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(dayOf(d));
  return days;
}

export const grossOf = (d: Pick<DailySales, "card" | "cash">) => d.card + d.cash;

function statementFor(monday: string, today: string): Statement {
  const sunday = addDays(monday, 6);
  const end = sunday < today ? sunday : today;
  const days: DailySales[] = [];
  for (let d = monday; d <= end; d = addDays(d, 1)) days.push(dayOf(d));
  const gross = days.reduce((s, d) => s + grossOf(d), 0);
  const commission = Math.round(gross * COMMISSION_RATE);
  const offerCost = days.reduce((s, d) => s + d.offerCost, 0);
  const payDate = addDays(monday, 8);
  return {
    id: `st-${monday}`,
    from: monday,
    to: sunday,
    orders: days.reduce((s, d) => s + d.orders, 0),
    gross,
    commission,
    offerCost,
    net: gross - commission - offerCost,
    status: payDate <= today ? "paid" : "pending",
    payDate,
  };
}

/** The current week (still adding up) and the eight before it, newest first. */
export async function listStatements(): Promise<Statement[]> {
  await latency(200);
  const today = todayIso();
  const thisMonday = mondayOf(today);
  return Array.from({ length: 9 }, (_, i) => statementFor(addDays(thisMonday, -7 * i), today));
}

/** The statement as CSV: one row per day, then the totals. */
export function statementCsv(s: Statement): string {
  const rows = [
    ["Date", "Orders", "Card", "Cash", "Gross sales", "Commission 18%", "Offers you funded", "Net"],
  ];
  const end = s.to < todayIso() ? s.to : todayIso();
  for (let d = s.from; d <= end; d = addDays(d, 1)) {
    const x = dayOf(d);
    const gross = grossOf(x);
    const commission = Math.round(gross * COMMISSION_RATE);
    rows.push(
      [d, x.orders, x.card, x.cash, gross, commission, x.offerCost, gross - commission - x.offerCost].map(
        String,
      ),
    );
  }
  rows.push(["Total", s.orders, "", "", s.gross, s.commission, s.offerCost, s.net].map(String));
  return rows.map((r) => r.join(",")).join("\n");
}
