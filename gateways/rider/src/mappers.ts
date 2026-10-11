// Proto -> rider-app shapes (and back): enum names, map units, rupees and labels in Colombo time.
import {
  ApplicationStatus,
  DocumentStatus,
  type PartnerDocument,
} from "@kade/proto/kade/common/v1/onboarding";
import { PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import {
  ProofKind,
  VehicleType,
  type Delivery,
  type DeliveryOffer,
  type Quest as ProtoQuest,
  type Rider,
  type RiderApplication,
  type RiderPay,
  type SubmitRiderApplicationRequest,
  type Trip as ProtoTrip,
} from "@kade/proto/kade/dispatch/v1/dispatch_service";
import {
  ComparisonTone,
  EarningsPeriod,
  RiderPayoutStatus,
  type EarningsSummary as ProtoEarnings,
  type RiderCashBalance,
  type RiderPayout,
} from "@kade/proto/kade/ledger/v1/ledger_service";
import type { GetRiderRatingsSummaryResponse } from "@kade/proto/kade/review/v1/review_service";
import { toMapPoint, type MapPoint } from "./map.js";
import { toRupees } from "./money.js";
import type { ApplicationInput } from "./schemas.js";

const ms = (d: Date | undefined): number | undefined => (d ? d.getTime() : undefined);

function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

const TZ = "Asia/Colombo";
const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  d.toLocaleString("en-GB", { timeZone: TZ, ...opts });

export interface AppPay {
  base: number;
  distance: number;
  tip: number;
  boost: number;
}

export function toPay(p: RiderPay | undefined): AppPay {
  return {
    base: toRupees(p?.base),
    distance: toRupees(p?.distance),
    tip: toRupees(p?.tip),
    boost: toRupees(p?.boost),
  };
}

const payment = (k: PaymentMethodKind): "cash" | "card" =>
  k === PaymentMethodKind.PAYMENT_METHOD_KIND_CASH ? "cash" : "card";

export interface AppOffer {
  id: string;
  orderNumber: string;
  restaurant: { name: string; area: string; address: string; phone: string; point: MapPoint };
  customer: {
    firstName: string;
    area: string;
    address: string;
    note?: string;
    maskedPhone: string;
    point: MapPoint;
  };
  from: MapPoint;
  toPickupKm: number;
  tripKm: number;
  minutes: number;
  pay: AppPay;
  payment: "cash" | "card";
  cashToCollect: number;
  customerPaysWith?: number;
  items: { id: string; qty: number; name: string; options?: string }[];
  sealed: boolean;
  notReadyMinutes: number;
  foodReadyAt?: number;
  deliveryCode: string;
  offeredAt: number;
  expiresAt: number;
}

/**
 * Dispatch joins the address note and the order's rider note with " · "; older deliveries can
 * repeat the same text twice ("Green gate · Green gate"). Show each part once.
 */
export function dedupeNote(note: string | undefined): string | undefined {
  const parts: string[] = [];
  for (const p of (note ?? "").split(" · ")) {
    const t = p.trim();
    if (t && !parts.some((q) => q.toLowerCase() === t.toLowerCase())) parts.push(t);
  }
  return parts.length ? parts.join(" · ") : undefined;
}

/** A delivery as the app's Offer (also the shape of the active job). */
export function toJob(
  d: Delivery | undefined,
  extra: {
    id?: string;
    from?: MapPoint;
    offeredAt?: number;
    expiresAt?: number;
    notReadyMinutes?: number;
  } = {},
): AppOffer {
  if (!d) throw new Error("upstream returned no delivery");
  const now = Date.now();
  const pickupPoint = toMapPoint(d.pickup?.location);
  const foodReadyAt = ms(d.foodReadyAt);
  const readyIn =
    foodReadyAt === undefined && d.readyBy ? Math.max(0, Math.ceil((d.readyBy.getTime() - now) / 60_000)) : 0;
  const isCash = d.payment === PaymentMethodKind.PAYMENT_METHOD_KIND_CASH;
  return {
    id: extra.id ?? d.id,
    orderNumber: d.orderNumber,
    restaurant: {
      name: d.pickup?.name ?? "",
      area: d.pickup?.area ?? "",
      address: d.pickup?.address ?? "",
      phone: d.pickup?.phone ?? "",
      point: pickupPoint,
    },
    customer: compact({
      firstName: d.dropoff?.firstName ?? "",
      area: d.dropoff?.area ?? "",
      address: d.dropoff?.address ?? "",
      note: dedupeNote(d.dropoff?.note),
      maskedPhone: d.dropoff?.maskedPhone ?? "",
      point: toMapPoint(d.dropoff?.location, { x: 320, y: 300 }),
    }),
    from: extra.from ?? pickupPoint,
    toPickupKm: Math.round(d.toPickupKm * 10) / 10,
    tripKm: Math.round(d.tripKm * 10) / 10,
    minutes: d.minutes,
    pay: toPay(d.pay),
    payment: payment(d.payment),
    cashToCollect: isCash ? toRupees(d.cashToCollect) : 0,
    ...(isCash && d.customerPaysWith?.amountMinor ? { customerPaysWith: toRupees(d.customerPaysWith) } : {}),
    items: d.items.map((i) =>
      compact({ id: i.id, qty: i.quantity, name: i.name, options: i.options || undefined }),
    ),
    sealed: d.sealed,
    notReadyMinutes: foodReadyAt === undefined ? (extra.notReadyMinutes ?? readyIn) : 0,
    foodReadyAt,
    // Dispatch checks the code server-side; the rider never sees it.
    deliveryCode: "",
    offeredAt: extra.offeredAt ?? ms(d.assignedAt) ?? now,
    expiresAt: extra.expiresAt ?? now,
  };
}

export function toOffer(o: DeliveryOffer): AppOffer {
  const offeredAt = ms(o.offeredAt) ?? Date.now();
  return toJob(o.delivery, {
    id: o.id,
    from: o.from ? toMapPoint(o.from) : undefined,
    offeredAt,
    expiresAt: ms(o.expiresAt) ?? offeredAt + 30_000,
    notReadyMinutes: o.notReadyMinutes,
  });
}

export function toTrip(t: ProtoTrip | undefined) {
  if (!t) throw new Error("upstream returned no trip");
  const deliveredAt = ms(t.deliveredAt) ?? Date.now();
  const acceptedAt = ms(t.acceptedAt) ?? deliveredAt;
  return compact({
    id: t.id,
    orderNumber: t.orderNumber,
    restaurantName: t.restaurantName,
    pickupArea: t.pickupArea,
    dropoffArea: t.dropoffArea,
    customerFirstName: t.customerFirstName,
    km: Math.round(t.km * 10) / 10,
    pay: toPay(t.pay),
    payment: payment(t.payment),
    cashCollected: toRupees(t.cashCollected),
    acceptedAt,
    arrivedAtRestaurantAt: ms(t.arrivedAtRestaurantAt) ?? acceptedAt,
    pickedUpAt: ms(t.pickedUpAt) ?? deliveredAt,
    deliveredAt,
    proof: t.proof === ProofKind.PROOF_KIND_PHOTO ? ("photo" as const) : ("code" as const),
    customerRating: t.customerRating || undefined,
    from: toMapPoint(t.from),
    pickupPoint: toMapPoint(t.pickupPoint),
    dropoffPoint: toMapPoint(t.dropoffPoint, { x: 320, y: 300 }),
  });
}

// ---------- Rider ----------

const VEHICLES: Record<number, "motorbike" | "tukTuk" | "bicycle"> = {
  [VehicleType.VEHICLE_TYPE_MOTORBIKE]: "motorbike",
  [VehicleType.VEHICLE_TYPE_TUK_TUK]: "tukTuk",
  [VehicleType.VEHICLE_TYPE_BICYCLE]: "bicycle",
};
export const VEHICLE_FROM_APP = {
  motorbike: VehicleType.VEHICLE_TYPE_MOTORBIKE,
  tukTuk: VehicleType.VEHICLE_TYPE_TUK_TUK,
  bicycle: VehicleType.VEHICLE_TYPE_BICYCLE,
} as const;

export function toProfile(r: Rider | undefined) {
  if (!r) throw new Error("upstream returned no rider");
  return {
    name: r.name,
    firstName: r.firstName || r.name.split(/\s+/)[0] || "",
    phone: r.phone,
    vehicle: {
      type: VEHICLES[r.vehicle?.type ?? 0] ?? "motorbike",
      model: r.vehicle?.model ?? "",
      plate: r.vehicle?.plate ?? "",
    },
    rating: Math.round(r.rating * 10) / 10,
    ratingCount: r.ratingCount,
    memberSince: r.joinedAt ? fmt(r.joinedAt, { month: "long", year: "numeric" }) : "",
    bank: { name: r.bank?.bank ?? "", branch: r.bank?.branch ?? "", last4: r.bank?.accountLast4 ?? "" },
    depositReference: r.depositReference,
  };
}

const DOC_STATUS: Record<number, "valid" | "expiring" | "expired" | "inReview"> = {
  [DocumentStatus.DOCUMENT_STATUS_APPROVED]: "valid",
  [DocumentStatus.DOCUMENT_STATUS_EXPIRING]: "expiring",
  [DocumentStatus.DOCUMENT_STATUS_EXPIRED]: "expired",
  // Rejected needs a new upload: shown like an expired one (action needed).
  [DocumentStatus.DOCUMENT_STATUS_REJECTED]: "expired",
  [DocumentStatus.DOCUMENT_STATUS_PENDING]: "inReview",
};

export function toDocument(d: PartnerDocument) {
  return compact({
    id: d.kind || d.id,
    name: d.name,
    expiresOn: d.expiresOn || undefined,
    status: DOC_STATUS[d.status] ?? "inReview",
  });
}

// ---------- Money ----------

export type Period = "today" | "week" | "month";

function barLabels(start: Date, period: Period) {
  if (period === "today") {
    const h = Number(fmt(start, { hour: "numeric", hour12: false })) % 24;
    const ampm = (x: number) => `${x % 12 || 12} ${x % 24 < 12 ? "am" : "pm"}`;
    return { label: h === 12 ? "12" : String(h % 12 || 12), fullLabel: `${ampm(h)} to ${ampm(h + 1)}` };
  }
  const fullLabel = fmt(start, { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
  if (period === "week") return { label: fmt(start, { weekday: "short" }).slice(0, 2), fullLabel };
  return { label: fmt(start, { day: "numeric" }), fullLabel };
}

export function toEarnings(e: ProtoEarnings | undefined, period: Period) {
  const total = toRupees(e?.total);
  const delta = toRupees(e?.comparisonDelta);
  let comparison: { text: string; tone: "good" | "bad" | "neutral" } | undefined;
  if (e?.comparisonLabel) {
    const rs = `Rs ${Math.abs(delta).toLocaleString("en-LK")}`;
    const tone =
      e.comparisonTone === ComparisonTone.COMPARISON_TONE_GOOD
        ? "good"
        : e.comparisonTone === ComparisonTone.COMPARISON_TONE_BAD
          ? "bad"
          : "neutral";
    comparison =
      Math.abs(delta) < 50
        ? { text: `About the same as ${e.comparisonLabel}`, tone: "neutral" }
        : delta > 0
          ? { text: `${rs} more than ${e.comparisonLabel}`, tone }
          : { text: `${rs} less than ${e.comparisonLabel} so far`, tone };
  }
  return compact({
    period,
    total,
    trips: e?.trips ?? 0,
    onlineMinutes: e?.onlineMinutes ?? 0,
    tips: toRupees(e?.tips),
    bars: (e?.bars ?? []).map((b) => ({
      ...barLabels(b.start ?? new Date(), period),
      amount: toRupees(b.amount),
      trips: b.trips,
    })),
    comparison,
  });
}

// ---------- Fallback while ledger isn't answering ----------

const COLOMBO_OFFSET_MS = 330 * 60_000; // UTC+05:30, no DST
const DAY_MS = 86_400_000;

/** Start of today, this week (Monday) or this month in Colombo time. */
export function periodStart(period: Period, now = Date.now()): Date {
  const local = new Date(now + COLOMBO_OFFSET_MS); // read with getUTC* = Colombo wall clock
  let dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  if (period === "week") dayStart -= ((local.getUTCDay() + 6) % 7) * DAY_MS;
  if (period === "month") dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return new Date(dayStart - COLOMBO_OFFSET_MS);
}

const lkr = (amountMinor: number) => ({ amountMinor, currency: "LKR" });

/**
 * Earnings for the period from dispatch's delivered trips (pay, tips and boosts as dispatch priced
 * them). Hourly bars from 8 am for today, daily bars otherwise. No online minutes or comparison.
 */
export function earningsFromTrips(trips: ProtoTrip[], period: Period, now = Date.now()): ProtoEarnings {
  const start = periodStart(period, now).getTime();
  const inPeriod = trips.filter((t) => {
    const at = ms(t.deliveredAt);
    return at !== undefined && at >= start && at <= now;
  });
  const bucket = period === "today" ? 3_600_000 : DAY_MS;
  const earliest = Math.min(...inPeriod.map((t) => ms(t.deliveredAt)!));
  const first =
    period === "today"
      ? Math.min(start + 8 * 3_600_000, start + Math.floor((earliest - start) / bucket) * bucket)
      : start;
  const last =
    period === "week"
      ? start + 6 * DAY_MS
      : Math.max(first, start + Math.floor((now - start) / bucket) * bucket);
  const bars: ProtoEarnings["bars"] = [];
  for (let at = first; at <= last; at += bucket) {
    const these = inPeriod.filter((t) => {
      const d = ms(t.deliveredAt)!;
      return d >= at && d < at + bucket;
    });
    bars.push({
      start: new Date(at),
      amount: lkr(these.reduce((s, t) => s + (t.pay?.total?.amountMinor ?? 0), 0)),
      trips: these.length,
    });
  }
  const sum = (f: (p: RiderPay | undefined) => number) => inPeriod.reduce((s, t) => s + f(t.pay), 0);
  return {
    period: EarningsPeriod.EARNINGS_PERIOD_UNSPECIFIED,
    total: lkr(sum((p) => p?.total?.amountMinor ?? 0)),
    trips: inPeriod.length,
    onlineMinutes: 0,
    tips: lkr(sum((p) => p?.tip?.amountMinor ?? 0)),
    boosts: lkr(sum((p) => p?.boost?.amountMinor ?? 0)),
    bars,
    comparisonDelta: undefined,
    comparisonLabel: "",
    comparisonTone: ComparisonTone.COMPARISON_TONE_UNSPECIFIED,
  };
}

/** Cash held as dispatch last heard it from ledger (RiderCashBalanceChanged; seeded until then). */
export function cashFromRider(r: Rider | undefined) {
  return {
    collected: toRupees(r?.cashHeld),
    owedToRider: 0,
    limit: toRupees(r?.cashLimit),
    lastDepositAt: 0,
  };
}

export function toCash(c: RiderCashBalance | undefined) {
  return {
    collected: toRupees(c?.collected),
    owedToRider: toRupees(c?.owedToRider),
    limit: toRupees(c?.limit),
    lastDepositAt: ms(c?.lastDepositAt) ?? 0,
  };
}

export function toPayout(p: RiderPayout) {
  return {
    id: p.id,
    weekOf: p.weekOf,
    paidAt: ms(p.paidAt) ?? 0,
    amount: toRupees(p.amount),
    cashOffset: toRupees(p.cashOffset),
    status:
      p.status === RiderPayoutStatus.RIDER_PAYOUT_STATUS_PAID ? ("paid" as const) : ("scheduled" as const),
  };
}

export function toQuest(q: ProtoQuest) {
  return {
    id: q.id,
    title: q.title,
    detail: q.detail,
    done: q.done,
    target: q.target,
    bonus: toRupees(q.bonus),
    endsAt: ms(q.endsAt) ?? Date.now(),
  };
}

export function toRatings(r: GetRiderRatingsSummaryResponse) {
  const b = r.summary?.breakdown ?? [];
  return {
    overall: Math.round((r.summary?.average ?? 0) * 100) / 100,
    count: r.summary?.count ?? 0,
    breakdown: [0, 1, 2, 3, 4].map((i) => b[i] ?? 0),
    compliments: r.compliments.map((c) => ({ label: c.label, count: c.count })),
    improve: r.improve.map((i) => ({ label: i.label, detail: i.detail })),
    recent: r.recent.map((x) =>
      compact({ id: x.id, stars: x.stars, comment: x.comment || undefined, at: ms(x.at) ?? 0, area: x.area }),
    ),
  };
}

// ---------- Onboarding ----------

const DOC_NAMES = {
  licence: "Driving licence",
  revenue: "Revenue licence",
  insurance: "Insurance",
  nicFront: "NIC (front)",
  nicBack: "NIC (back)",
} as const;
type DocKey = keyof typeof DOC_NAMES;

export function fromApplication(a: ApplicationInput, idempotencyKey: string): SubmitRiderApplicationRequest {
  const digits = a.bank.account.replace(/\D/g, "");
  return {
    name: a.name.trim(),
    nic: a.nic.trim(),
    phone: a.phone.trim(),
    city: a.city,
    vehicle: VEHICLE_FROM_APP[a.vehicle as keyof typeof VEHICLE_FROM_APP],
    documents: (Object.keys(DOC_NAMES) as DocKey[])
      .filter((k) => a.documents[k])
      .map((kind) => ({
        id: "",
        kind,
        name: DOC_NAMES[kind],
        fileName: a.documents[kind] ?? "",
        fileRef: "",
        status: 0,
        rejectReason: "",
        expiresOn: "",
        fields: [],
        uploadedAt: undefined,
      })),
    bank: {
      bank: a.bank.bank,
      branch: a.bank.branch,
      accountName: a.bank.holder,
      accountNumber: digits,
      accountLast4: digits.slice(-4),
    },
    lessons: a.lessons,
    idempotencyKey,
  };
}

export type AppApplicationStatus =
  | { state: "none" }
  | { state: "inReview"; id: string; submittedAt: number; firstName: string }
  | { state: "needsFix"; id: string; doc: DocKey; docName: string; reason: string; firstName: string }
  | { state: "approved"; id: string; firstName: string };

export function toApplicationStatus(
  app: RiderApplication | undefined,
  needsFix?: PartnerDocument,
): AppApplicationStatus {
  if (!app) return { state: "none" };
  const base = { id: app.id, firstName: app.name.trim().split(/\s+/)[0] ?? "" };
  switch (app.status) {
    case ApplicationStatus.APPLICATION_STATUS_APPROVED:
      return { state: "approved", ...base };
    case ApplicationStatus.APPLICATION_STATUS_CHANGES_REQUESTED:
      if (needsFix && needsFix.kind in DOC_NAMES) {
        return {
          state: "needsFix",
          ...base,
          doc: needsFix.kind as DocKey,
          docName: needsFix.name || DOC_NAMES[needsFix.kind as DocKey],
          reason: needsFix.rejectReason || app.decisionNote,
        };
      }
      // A fix was just uploaded (or we don't know which document): back in review.
      return { state: "inReview", ...base, submittedAt: ms(app.submittedAt) ?? Date.now() };
    case ApplicationStatus.APPLICATION_STATUS_REJECTED:
      // The app has no "rejected" screen; it offers to apply again.
      return { state: "none" };
    default:
      return { state: "inReview", ...base, submittedAt: ms(app.submittedAt) ?? Date.now() };
  }
}
