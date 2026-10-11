// Mock payouts (VITE_API_MODE=mock): earnings, quests, cash held and weekly bank transfers computed
// from mock history plus trips completed in this browser. Live: ledger and dispatch via gateway-rider.
import { dayKey, daysAgoAt, todayAt } from "@/lib/time";
import { CASH_LIMIT, historyDay, seedCash, seedPayouts } from "./data";
import { allTrips, latency, tripsOn } from "./rider";
import {
  payTotal,
  type CashBalance,
  type EarningsBar,
  type EarningsSummary,
  type Payout,
  type Period,
  type Quest,
} from "../types";

interface Day {
  amount: number;
  trips: number;
  onlineMinutes: number;
  tips: number;
}

/** Started the shift at 7:45 am. */
const SHIFT_START = { hour: 7, minute: 45 };

function today(now: number): Day {
  const trips = tripsOn(dayKey(now), now);
  return {
    amount: trips.reduce((s, t) => s + payTotal(t.pay), 0),
    trips: trips.length,
    onlineMinutes: Math.max(
      0,
      Math.round((now - todayAt(SHIFT_START.hour, SHIFT_START.minute, now)) / 60_000),
    ),
    tips: trips.reduce((s, t) => s + t.pay.tip, 0),
  };
}

const dayOf = (daysAgo: number, now: number): Day => (daysAgo === 0 ? today(now) : historyDay(daysAgo));

const sum = (days: Day[]): Day =>
  days.reduce(
    (a, d) => ({
      amount: a.amount + d.amount,
      trips: a.trips + d.trips,
      onlineMinutes: a.onlineMinutes + d.onlineMinutes,
      tips: a.tips + d.tips,
    }),
    { amount: 0, trips: 0, onlineMinutes: 0, tips: 0 },
  );

const fmtDay = (ms: number, opts: Intl.DateTimeFormatOptions) =>
  new Date(ms).toLocaleDateString("en-GB", opts);

function compare(current: number, previous: number, against: string): EarningsSummary["comparison"] {
  if (!previous) return undefined;
  const diff = current - previous;
  const rs = `Rs ${Math.abs(diff).toLocaleString("en-LK")}`;
  if (Math.abs(diff) < 50) return { text: `About the same as ${against}`, tone: "neutral" };
  return diff > 0
    ? { text: `${rs} more than ${against}`, tone: "good" }
    : { text: `${rs} less than ${against} so far`, tone: "neutral" };
}

export async function getEarnings(period: Period): Promise<EarningsSummary> {
  await latency(250);
  const now = Date.now();

  if (period === "today") {
    const trips = tripsOn(dayKey(now), now);
    const first = 8;
    const last = Math.max(first, new Date(now).getHours());
    const bars: EarningsBar[] = [];
    for (let h = first; h <= last; h++) {
      const inHour = trips.filter((t) => new Date(t.deliveredAt).getHours() === h);
      const label = h === 12 ? "12" : String(h % 12);
      const full = `${h % 12 || 12} ${h < 12 ? "am" : "pm"} to ${(h + 1) % 12 || 12} ${h + 1 < 12 ? "am" : "pm"}`;
      bars.push({
        label,
        fullLabel: full,
        amount: inHour.reduce((s, t) => s + payTotal(t.pay), 0),
        trips: inHour.length,
      });
    }
    const t = today(now);
    const lastWeek = historyDay(7);
    const weekday = fmtDay(now, { weekday: "long" });
    return { period, ...total(t), bars, comparison: compare(t.amount, lastWeek.amount, `last ${weekday}`) };
  }

  if (period === "week") {
    // Monday to Sunday of this week
    const sinceMonday = (new Date(now).getDay() + 6) % 7;
    const bars: EarningsBar[] = [];
    const days: Day[] = [];
    for (let i = 0; i < 7; i++) {
      const daysAgo = sinceMonday - i;
      const at = daysAgoAt(daysAgo, 12, 0, now);
      const d = daysAgo < 0 ? { amount: 0, trips: 0, onlineMinutes: 0, tips: 0 } : dayOf(daysAgo, now);
      if (daysAgo >= 0) days.push(d);
      bars.push({
        label: fmtDay(at, { weekday: "short" }).slice(0, 2),
        fullLabel:
          fmtDay(at, { weekday: "long", day: "numeric", month: "long" }) +
          (daysAgo < 0 ? ", still to come" : ""),
        amount: d.amount,
        trips: d.trips,
      });
    }
    const s = sum(days);
    const prev = sum(Array.from({ length: sinceMonday + 1 }, (_, i) => historyDay(i + 7)));
    return { period, ...total(s), bars, comparison: compare(s.amount, prev.amount, "this time last week") };
  }

  // Month to date
  const date = new Date(now).getDate();
  const bars: EarningsBar[] = [];
  const days: Day[] = [];
  for (let i = date - 1; i >= 0; i--) {
    const d = dayOf(i, now);
    const at = daysAgoAt(i, 12, 0, now);
    days.push(d);
    bars.push({
      label: String(new Date(at).getDate()),
      fullLabel: fmtDay(at, { weekday: "long", day: "numeric", month: "long" }),
      amount: d.amount,
      trips: d.trips,
    });
  }
  const s = sum(days);
  return { period, ...total(s), bars };
}

const total = (d: Day) => ({ total: d.amount, trips: d.trips, onlineMinutes: d.onlineMinutes, tips: d.tips });

/** Today's figures for the home screen. */
export async function getTodaySummary() {
  await latency(150);
  const now = Date.now();
  return today(now);
}

export async function getQuests(): Promise<Quest[]> {
  await latency(200);
  const now = Date.now();
  const todayTrips = tripsOn(dayKey(now), now).length;
  const weekTrips = sum(
    Array.from({ length: ((new Date(now).getDay() + 6) % 7) + 1 }, (_, i) => dayOf(i, now)),
  ).trips;
  return [
    {
      id: "q-today",
      title: todayTrips >= 12 ? "12 trips done today" : `Complete ${12 - todayTrips} more trips by 10 pm`,
      detail: "Rs 800 bonus for 12 trips today",
      done: Math.min(12, todayTrips),
      target: 12,
      bonus: 800,
      endsAt: todayAt(22, 0, now),
    },
    {
      id: "q-lunch",
      title: "Lunch rush boost",
      detail: "Rs 60 extra on every trip from 12 to 2 pm in Kollupitiya and Bambalapitiya",
      done: tripsOn(dayKey(now), now).filter((t) => {
        const h = new Date(t.acceptedAt).getHours();
        return h >= 12 && h < 14;
      }).length,
      target: 4,
      bonus: 240,
      endsAt: todayAt(14, 0, now),
    },
    {
      id: "q-week",
      title: "Weekly streak",
      detail: "Rs 2,500 bonus for 70 trips this week",
      done: Math.min(70, weekTrips),
      target: 70,
      bonus: 2_500,
      endsAt: daysAgoAt(-(7 - ((new Date(now).getDay() + 6) % 7)), 0, 0, now),
    },
  ];
}

export async function getCashBalance(): Promise<CashBalance> {
  await latency(150);
  const now = Date.now();
  const lastDepositAt = daysAgoAt(seedCash.lastDepositDaysAgo, 17, 30, now);
  // Only trips completed in this demo change the balance; the seed already includes earlier ones
  const local = allTrips(now).filter((t) => t.id.startsWith("J-"));
  return {
    collected: seedCash.collected + local.reduce((s, t) => s + t.cashCollected, 0),
    owedToRider: seedCash.owedToRider + local.reduce((s, t) => s + payTotal(t.pay), 0),
    limit: CASH_LIMIT,
    lastDepositAt,
  };
}

export async function listPayouts(): Promise<Payout[]> {
  await latency(200);
  return seedPayouts();
}
