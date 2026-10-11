import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import {
  AttentionKind,
  DotKind,
  GetLiveSnapshotRequest,
  ListRidersRequest,
  RiderStatus,
  type LiveSnapshot as ProtoSnapshot,
  type Rider as ProtoRider,
} from "@kade/proto/kade/dispatch/v1/dispatch_service";
import { OutletAdminStatus, type OutletAdminView } from "@kade/proto/kade/merchant/v1/merchant_service";
import { ListOrdersRequest, type Order } from "@kade/proto/kade/order/v1/order_service";
import type { Zone as PricingZone } from "@kade/proto/kade/pricing/v1/pricing_service";
import type { Ctx } from "../context.js";
import { personId, restaurantNumber } from "../ids.js";
import { allPages, Cached, formatRs, ms, PAGE, rs, soft, zonePosition } from "../lib.js";
import { isHidden, lateMinutes, ORDER_STATUS, orderRef } from "../mappers/orders.js";
import { LiveSnapshot, problems, ref } from "../schemas.js";

type Attention = LiveSnapshot["attention"][number];
type Dot = LiveSnapshot["dots"][number];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Colombo is UTC+05:30 all year (no DST).
const COLOMBO = 5.5 * HOUR;
export const colomboMidnight = (t: number) => Math.floor((t + COLOMBO) / DAY) * DAY - COLOMBO;
export const colomboHour = (t: number) => new Date(t + COLOMBO).getUTCHours();
const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Colombo",
});
/** "7:41 pm", like the console's formatClock. */
export const formatClock = (t: number) =>
  clock
    .format(t)
    .replace(/\s?([ap])\.?m\.?/i, " $1m")
    .toLowerCase();
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/* ---------- From dispatch's own snapshot ---------- */

const ATTENTION_KIND: Record<number, Attention["kind"]> = {
  [AttentionKind.ATTENTION_KIND_LATE_ORDER]: "lateOrder",
  [AttentionKind.ATTENTION_KIND_RESTAURANT_NOT_ACCEPTING]: "restaurantNotAccepting",
  [AttentionKind.ATTENTION_KIND_RIDER_CASH]: "riderCash",
  [AttentionKind.ATTENTION_KIND_RIDERS_SHORT]: "ridersShort",
  // An order nobody would take is an order going late: same queue, same action.
  [AttentionKind.ATTENTION_KIND_UNMATCHED_DELIVERY]: "lateOrder",
};
const DOT_KIND: Record<number, Dot["kind"]> = {
  [DotKind.DOT_KIND_WAITING]: "waiting",
  [DotKind.DOT_KIND_ON_THE_WAY]: "onTheWay",
  [DotKind.DOT_KIND_LATE]: "late",
  [DotKind.DOT_KIND_RIDER]: "rider",
};

function hrefFor(recordType: string, recordId: string): string {
  switch (recordType) {
    case "order":
      return `/orders?order=${encodeURIComponent(recordId)}`;
    case "restaurant":
      return `/restaurants?id=${restaurantNumber(recordId)}`;
    case "rider":
      return `/riders?id=${encodeURIComponent(personId(recordId))}`;
    default:
      return "/riders";
  }
}

export function fromDispatch(s: ProtoSnapshot, zones: PricingZone[]): LiveSnapshot {
  return {
    at: ms(s.at) || Date.now(),
    inProgress: s.inProgress,
    waitingForRider: s.waitingForRider,
    late: s.late,
    ridersOnline: s.ridersOnline,
    ridersNeeded: s.ridersNeeded,
    shortestZone:
      s.shortestZoneCode && s.shortestZoneShort > 0
        ? { code: s.shortestZoneCode, short: s.shortestZoneShort }
        : undefined,
    avgDeliveryMin: Math.round(s.avgDeliveryMinutes),
    cancellationsToday: s.cancellationsToday,
    ordersToday: s.ordersToday,
    attention: s.attention
      .map((a) => ({
        id: a.id,
        kind: ATTENTION_KIND[a.kind] ?? "lateOrder",
        title: a.title,
        detail: a.detail,
        severity: a.severity,
        href: hrefFor(a.recordType, a.recordId),
        phone: a.phone || undefined,
      }))
      .sort((a, b) => b.severity - a.severity),
    ordersByHour: s.ordersByHour.map((h) => ({ hour: h.hour, today: h.today, lastWeek: h.lastWeek })),
    dots: s.dots.map((d) => ({
      id: d.id,
      kind: DOT_KIND[d.kind] ?? "waiting",
      zoneId: d.zoneId,
      ...zonePosition(
        zones.find((z) => z.id === d.zoneId),
        d.location,
        d.id,
      ),
      label: d.label,
    })),
    zones: s.zones.map((z) => ({ id: z.zoneId, orders: z.orders, riders: z.riders, open: z.open })),
  };
}

/* ---------- Aggregated here from order, merchant, pricing (and dispatch's rider list) ---------- */

export interface LiveInputs {
  now: number;
  active: Order[];
  today: Order[];
  lastWeekSameDay: Order[];
  outlets: OutletAdminView[];
  zones: PricingZone[];
  riders: ProtoRider[];
}

function whereIsIt(o: Order): string {
  const r = o.restaurant?.name ?? "the restaurant";
  const rider = o.rider?.riderId ? o.rider.name : undefined;
  switch (ORDER_STATUS[o.status]) {
    case "placed":
      return `Waiting for ${r} to accept.`;
    case "accepted":
    case "preparing":
      return `${r} is still cooking${rider ? `; ${rider} is waiting` : ""}.`;
    case "ready":
      return rider ? `Ready at ${r}; ${rider} hasn't picked it up.` : `Ready at ${r} with no rider assigned.`;
    case "pickedUp":
      return `With ${rider ?? "the rider"}, not delivered yet.`;
    default:
      return "";
  }
}

export function aggregate(inp: LiveInputs): LiveSnapshot {
  const { now, zones, outlets } = inp;
  const active = inp.active.filter((o) => !isHidden(o));
  const today = inp.today.filter((o) => !isHidden(o));
  const online = inp.riders.filter(
    (r) => r.status === RiderStatus.RIDER_STATUS_ONLINE || r.status === RiderStatus.RIDER_STATUS_ON_JOB,
  );
  const openZones = zones.filter((z) => z.open);
  const lateOf = (o: Order) => lateMinutes(ORDER_STATUS[o.status], ms(o.dueAt), now);
  const zoneOfOrder = (o: Order) => o.zoneId || o.address?.zoneId || o.restaurant?.zoneId || "";
  const riderZone = (r: ProtoRider) => r.positionZoneId || r.zoneIds[0] || "";

  const recent = today.filter((o) => o.deliveredAt && ms(o.deliveredAt) > now - 2 * HOUR);
  const delivered = recent.length ? recent : today.filter((o) => o.deliveredAt);
  const avgDeliveryMin = delivered.length
    ? Math.round(
        delivered.reduce((s, o) => s + (ms(o.deliveredAt) - ms(o.placedAt ?? o.createdAt)), 0) /
          delivered.length /
          MIN,
      )
    : 0;

  const zoneStats = zones.map((z) => ({
    id: z.id,
    open: z.open,
    orders: active.filter((o) => zoneOfOrder(o) === z.id).length,
    riders: online.filter((r) => riderZone(r) === z.id).length,
  }));
  // Without a rider list (dispatch down) shortages would be everything; leave them out.
  const shortages = inp.riders.length
    ? openZones
        .map((z) => ({
          zone: z,
          short: z.ridersNeeded - (zoneStats.find((s) => s.id === z.id)?.riders ?? 0),
        }))
        .filter((s) => s.short > 0)
        .sort((a, b) => b.short - a.short)
    : [];

  const attention: Attention[] = [];
  for (const o of active) {
    const late = lateOf(o);
    if (late < 10) continue;
    const id = orderRef(o);
    attention.push({
      id: `late-${id}`,
      kind: "lateOrder",
      title: `${id} is ${late} min late`,
      detail: `${whereIsIt(o)} Promised by ${formatClock(ms(o.dueAt))}.`,
      severity: 100 + late,
      href: `/orders?order=${encodeURIComponent(id)}`,
    });
  }
  for (const v of outlets) {
    const o = v.outlet;
    if (!o || o.status?.adminStatus !== OutletAdminStatus.OUTLET_ADMIN_STATUS_OPEN || o.status.accepting)
      continue;
    if (o.status.pausedUntil && o.status.pausedUntil.getTime() > now) continue;
    const wait = v.waitingMinutes || 0;
    const since = o.status.lastHeartbeatAt ? ms(o.status.lastHeartbeatAt) : now - Math.max(wait, 5) * MIN;
    attention.push({
      id: `rest-${restaurantNumber(o.id)}`,
      kind: "restaurantNotAccepting",
      title: `${o.name} isn't accepting orders`,
      detail: `${wait ? `Oldest order has waited ${wait} min. ` : ""}The tablet hasn't responded since ${formatClock(since)}.`,
      severity: 80 + wait,
      href: `/restaurants?id=${restaurantNumber(o.id)}`,
      phone: o.phone || undefined,
    });
  }
  for (const r of inp.riders) {
    const held = rs(r.cashHeld);
    const limit = rs(r.cashLimit);
    if (!limit || held <= limit || r.status === RiderStatus.RIDER_STATUS_SUSPENDED) continue;
    attention.push({
      id: `cash-${personId(r.id)}`,
      kind: "riderCash",
      title: `${r.name} is holding ${formatRs(held)} in cash`,
      detail: `${formatRs(held - limit)} over the ${formatRs(limit)} limit. Stop cash orders until they deposit.`,
      severity: 60 + Math.round((held - limit) / 1000),
      href: `/riders?id=${encodeURIComponent(personId(r.id))}`,
      phone: r.phone || undefined,
    });
  }
  for (const s of shortages.filter((x) => x.short >= 2)) {
    const zs = zoneStats.find((z) => z.id === s.zone.id)!;
    attention.push({
      id: `short-${s.zone.id}`,
      kind: "ridersShort",
      title: `${s.zone.code} needs ${s.short} more riders`,
      detail: `${s.zone.name} has ${zs.riders} online for ${plural(zs.orders, "active order")}.`,
      severity: 40 + s.short,
      href: "/riders",
    });
  }
  attention.sort((a, b) => b.severity - a.severity);

  const zoneById = (id: string) => zones.find((z) => z.id === id);
  const dots: Dot[] = [];
  for (const o of active) {
    const id = orderRef(o);
    const late = lateOf(o) > 0;
    const onTheWay = ORDER_STATUS[o.status] === "pickedUp";
    const zoneId = onTheWay ? zoneOfOrder(o) : o.restaurant?.zoneId || zoneOfOrder(o);
    const point = onTheWay ? o.address?.location : o.restaurant?.location;
    dots.push({
      id,
      kind: late ? "late" : onTheWay ? "onTheWay" : "waiting",
      zoneId,
      ...zonePosition(zoneById(zoneId), point, id),
      label: `${id}, ${late ? "late" : onTheWay ? "on the way" : "at the restaurant"}`,
    });
  }
  for (const r of online) {
    if (r.status === RiderStatus.RIDER_STATUS_ON_JOB) continue;
    const zoneId = riderZone(r);
    dots.push({
      id: personId(r.id),
      kind: "rider",
      zoneId,
      ...zonePosition(zoneById(zoneId), r.position, r.id),
      label: `${r.name}, free`,
    });
  }

  const midnight = colomboMidnight(now);
  const lastWeekMidnight = midnight - 7 * DAY;
  const ordersByHour: LiveSnapshot["ordersByHour"] = [];
  for (let h = 7; h <= colomboHour(now); h++) {
    const count = (xs: Order[], start: number) =>
      xs.filter((o) => {
        const t = ms(o.placedAt ?? o.createdAt);
        return t >= start && t < start + HOUR;
      }).length;
    ordersByHour.push({
      hour: h,
      today: count(today, midnight + h * HOUR),
      lastWeek: count(inp.lastWeekSameDay, lastWeekMidnight + h * HOUR),
    });
  }

  return {
    at: now,
    inProgress: active.length,
    waitingForRider: active.filter(
      (o) => o.mode !== FulfilmentMode.FULFILMENT_MODE_PICKUP && !o.rider?.riderId,
    ).length,
    late: active.filter((o) => lateOf(o) > 0).length,
    ridersOnline: online.length,
    ridersNeeded: openZones.reduce((s, z) => s + z.ridersNeeded, 0),
    shortestZone: shortages[0] && { code: shortages[0].zone.code, short: shortages[0].short },
    avgDeliveryMin,
    cancellationsToday: today.filter((o) => ["cancelled", "rejected"].includes(ORDER_STATUS[o.status]))
      .length,
    ordersToday: today.length,
    attention,
    ordersByHour,
    dots,
    zones: zoneStats,
  };
}

async function listOrders(ctx: Ctx, req: Partial<ListOrdersRequest>): Promise<Order[]> {
  return allPages(async (pageToken) => {
    const res = await ctx.rpc(
      ctx.up.order,
      "listOrders",
      ListOrdersRequest.fromPartial({ ...req, page: { pageSize: PAGE, pageToken } }),
    );
    return { items: res.orders, next: res.page?.nextPageToken ?? "" };
  }, 10);
}

export const liveRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Every open console polls this every 5 s; one upstream fan-out serves them all.
  const snapshot = new Cached<LiveSnapshot>(2_500);

  app.get(
    "/v1/live",
    {
      schema: {
        operationId: "getLiveSnapshot",
        tags: ["live"],
        security: [{ bearer: [] }],
        summary:
          "Live dashboard: counts, attention queue, orders by hour, map dots and zone load. From dispatch when it is up, otherwise aggregated from order, merchant, pricing and the rider list. Cached 2.5 s; poll every 5 s.",
        response: { 200: ref(LiveSnapshot), ...problems(401, 403, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      return snapshot.get(async () => {
        const zones = await soft(ctx.log, "zones", ctx.zones(), []);
        try {
          const res = await ctx.rpc(
            ctx.up.dispatchOps,
            "getLiveSnapshot",
            GetLiveSnapshotRequest.fromPartial({}),
          );
          if (res.snapshot) return fromDispatch(res.snapshot, zones);
        } catch (err) {
          ctx.log.debug({ err: (err as Error).message }, "dispatch snapshot unavailable; aggregating");
        }
        const now = Date.now();
        const midnight = colomboMidnight(now);
        // Orders are the heart of the dashboard: if order is down, so is the dashboard (503).
        const [active, today] = await Promise.all([
          listOrders(ctx, { activeOnly: true }),
          listOrders(ctx, { placedAfter: new Date(midnight) }),
        ]);
        const [lastWeekSameDay, outlets, riders] = await Promise.all([
          soft(
            ctx.log,
            "last week orders",
            listOrders(ctx, {
              placedAfter: new Date(midnight - 7 * DAY),
              placedBefore: new Date(midnight - 6 * DAY),
            }),
            [],
          ),
          soft(ctx.log, "outlets", ctx.outlets(), []),
          soft(
            ctx.log,
            "riders",
            allPages(async (pageToken) => {
              const res = await ctx.rpc(
                ctx.up.riders,
                "listRiders",
                ListRidersRequest.fromPartial({ page: { pageSize: PAGE, pageToken } }),
              );
              return { items: res.riders, next: res.page?.nextPageToken ?? "" };
            }, 5),
            [],
          ),
        ]);
        return aggregate({ now, active, today, lastWeekSameDay, outlets, zones, riders });
      });
    },
  );
};
