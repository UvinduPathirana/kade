// Live dashboard API. Later: the dispatch service streams this snapshot over a socket; for now the
// dashboard polls every 5 seconds and the mock simulation moves orders on between reads.
import { formatRs, plural } from "@kade/ui";
import { respond, simNow } from "./client";
import { HOUR, MIN, TODAY_START } from "./mock/clock";
import { hourCurve, isFinal, orders, restaurantById, simulate } from "./mock/orders";
import { restaurants, riders } from "./mock/partners";
import { seeded } from "./mock/random";
import { zones } from "./mock/zones";
import { lateMinutes } from "./orders";
import type { AttentionItem, LiveSnapshot, MapDot, Order } from "./types";
import { formatClock } from "@/lib/format";

/** Fixed spot for each restaurant inside its zone, so waiting orders cluster at the kitchen. */
const kitchenSpot = (id: number) => {
  const r = seeded(id * 31);
  return { x: 0.25 + r.next() * 0.5, y: 0.25 + r.next() * 0.5 };
};

const riderName = (id?: string) => riders.find((r) => r.id === id)?.name;

function whereIsIt(o: Order): string {
  const r = restaurantById(o.restaurantId);
  const rider = riderName(o.riderId);
  switch (o.status) {
    case "placed":
      return `Waiting for ${r.name} to accept.`;
    case "accepted":
    case "preparing":
      return `${r.name} is still cooking${rider ? `; ${rider} is waiting` : ""}.`;
    case "ready":
      return rider
        ? `Ready at ${r.name}; ${rider} hasn't picked it up.`
        : `Ready at ${r.name} with no rider assigned.`;
    case "pickedUp":
      return `With ${rider ?? "the rider"}, not delivered yet.`;
    default:
      return "";
  }
}

const lastSaturday = (() => {
  const r = seeded(4040);
  return hourCurve.map((v) => Math.round(v * 56 * (0.85 + r.next() * 0.3)));
})();

export async function getLiveSnapshot(): Promise<LiveSnapshot> {
  simulate();
  const now = simNow();
  const active = orders.filter((o) => !isFinal(o.status));
  const today = orders.filter((o) => o.placedAt >= TODAY_START);
  const online = riders.filter((r) => r.status === "online" || r.status === "onJob");
  const openZones = zones.filter((z) => z.open);

  const recent = orders.filter((o) => o.deliveredAt && o.deliveredAt > now - 2 * HOUR);
  const avgDeliveryMin = recent.length
    ? Math.round(recent.reduce((s, o) => s + (o.deliveredAt! - o.placedAt), 0) / recent.length / MIN)
    : 0;

  const zoneStats = zones.map((z) => ({
    id: z.id,
    open: z.open,
    orders: active.filter((o) => o.zoneId === z.id).length,
    riders: online.filter((r) => r.pos.zoneId === z.id).length,
  }));
  const shortages = openZones
    .map((z) => ({ zone: z, short: z.ridersNeeded - zoneStats.find((s) => s.id === z.id)!.riders }))
    .filter((s) => s.short > 0)
    .sort((a, b) => b.short - a.short);

  const attention: AttentionItem[] = [];
  for (const o of active) {
    const late = lateMinutes(o, now);
    if (late < 10) continue;
    attention.push({
      id: `late-${o.id}`,
      kind: "lateOrder",
      title: `${o.id} is ${late} min late`,
      detail: `${whereIsIt(o)} Promised by ${formatClock(o.dueAt)}.`,
      severity: 100 + late,
      href: `/orders?order=${o.id}`,
    });
  }
  for (const r of restaurants) {
    if (r.status !== "open" || r.accepting) continue;
    attention.push({
      id: `rest-${r.id}`,
      kind: "restaurantNotAccepting",
      title: `${r.name} isn't accepting orders`,
      detail: `Oldest order has waited ${r.waitingMinutes ?? 5} min. The tablet hasn't responded since ${formatClock(now - (r.waitingMinutes ?? 5) * MIN)}.`,
      severity: 80 + (r.waitingMinutes ?? 0),
      href: `/restaurants?id=${r.id}`,
      phone: r.phone,
    });
  }
  for (const r of riders) {
    if (r.cashHeld <= r.cashLimit || r.status === "suspended") continue;
    attention.push({
      id: `cash-${r.id}`,
      kind: "riderCash",
      title: `${r.name} is holding ${formatRs(r.cashHeld)} in cash`,
      detail: `${formatRs(r.cashHeld - r.cashLimit)} over the ${formatRs(r.cashLimit)} limit. Stop cash orders until they deposit.`,
      severity: 60 + Math.round((r.cashHeld - r.cashLimit) / 1000),
      href: `/riders?id=${r.id}`,
      phone: r.phone,
    });
  }
  for (const s of shortages.filter((x) => x.short >= 2)) {
    attention.push({
      id: `short-${s.zone.id}`,
      kind: "ridersShort",
      title: `${s.zone.code} needs ${s.short} more riders`,
      detail: `${s.zone.name} has ${s.zone.ridersNeeded - s.short} online for ${plural(zoneStats.find((z) => z.id === s.zone.id)!.orders, "active order")}.`,
      severity: 40 + s.short,
      href: "/riders",
    });
  }
  attention.sort((a, b) => b.severity - a.severity);

  const dots: MapDot[] = [];
  for (const o of active) {
    const late = lateMinutes(o, now) > 0;
    const onTheWay = o.status === "pickedUp";
    const r = restaurantById(o.restaurantId);
    const spot = onTheWay ? o.pos : kitchenSpot(r.id);
    const jitter = seeded(Number(o.id.slice(3)));
    dots.push({
      id: o.id,
      kind: late ? "late" : onTheWay ? "onTheWay" : "waiting",
      zoneId: onTheWay ? o.zoneId : r.zoneId,
      x: spot.x + (onTheWay ? 0 : (jitter.next() - 0.5) * 0.18),
      y: spot.y + (onTheWay ? 0 : (jitter.next() - 0.5) * 0.18),
      label: `${o.id}, ${late ? "late" : onTheWay ? "on the way" : "at the restaurant"}`,
    });
  }
  for (const r of online) {
    if (r.status === "onJob") continue;
    dots.push({
      id: r.id,
      kind: "rider",
      zoneId: r.pos.zoneId,
      x: r.pos.x,
      y: r.pos.y,
      label: `${r.name}, free`,
    });
  }

  const currentHour = new Date(now).getHours();
  const ordersByHour = [];
  for (let h = 7; h <= currentHour; h++) {
    const start = TODAY_START + h * HOUR;
    ordersByHour.push({
      hour: h,
      today: today.filter((o) => o.placedAt >= start && o.placedAt < start + HOUR).length,
      lastWeek: lastSaturday[h]!,
    });
  }

  const ridersNeeded = openZones.reduce((s, z) => s + z.ridersNeeded, 0);
  return respond(
    {
      at: now,
      inProgress: active.length,
      waitingForRider: active.filter((o) => !o.riderId).length,
      late: active.filter((o) => lateMinutes(o, now) > 0).length,
      ridersOnline: online.length,
      ridersNeeded,
      shortestZone: shortages[0] && { code: shortages[0].zone.code, short: shortages[0].short },
      avgDeliveryMin,
      cancellationsToday: today.filter((o) => o.status === "cancelled" || o.status === "rejected").length,
      ordersToday: today.length,
      attention,
      ordersByHour,
      dots,
      zones: zoneStats,
    },
    60,
  );
}
