import type { Address as PbAddress } from "@kade/proto/kade/common/v1/address";
import {
  CardBrand,
  FulfilmentMode,
  PaymentMethodKind,
  SubstitutionPreference,
  type PaymentMethod as PbPaymentMethod,
} from "@kade/proto/kade/common/v1/commerce";
import {
  OrderStatus as PbOrderStatus,
  RejectionReason,
  type GroupOrder as PbGroupOrder,
  type Order as PbOrder,
  type OrderLine as PbOrderLine,
} from "@kade/proto/kade/order/v1/order_service";
import { Thumb, type OrderRating as PbOrderRating } from "@kade/proto/kade/review/v1/review_service";
import {
  IssueKind as PbIssueKind,
  IssueResolution as PbIssueResolution,
  type OrderIssue as PbOrderIssue,
} from "@kade/proto/kade/support/v1/support_service";
import { fromRupees, toRupees } from "../money.js";
import type {
  GroupOrder,
  IssueInput,
  Order,
  OrderLine,
  OrderStatus,
  PaymentMethod,
  SavedAddress,
} from "../schemas.js";
import { geoFromMap, mapFromGeo } from "./geo.js";
import { restaurantNumber } from "./ids.js";

const ms = (d: Date | undefined): number | undefined => (d ? d.getTime() : undefined);

export const toMode = (m: FulfilmentMode): "delivery" | "pickup" =>
  m === FulfilmentMode.FULFILMENT_MODE_PICKUP ? "pickup" : "delivery";

export const fromMode = (m: "delivery" | "pickup"): FulfilmentMode =>
  m === "pickup" ? FulfilmentMode.FULFILMENT_MODE_PICKUP : FulfilmentMode.FULFILMENT_MODE_DELIVERY;

/** One order status, in the customer app's vocabulary (proto/README.md, "Order state machine"). */
export function toStatus(s: PbOrderStatus, mode: "delivery" | "pickup"): OrderStatus {
  switch (s) {
    case PbOrderStatus.ORDER_STATUS_SCHEDULED:
      return "scheduled";
    case PbOrderStatus.ORDER_STATUS_ACCEPTED:
      return "accepted";
    case PbOrderStatus.ORDER_STATUS_PREPARING:
      return "preparing";
    // Delivery: still "preparing" from the customer's point of view until the rider has it.
    case PbOrderStatus.ORDER_STATUS_READY:
      return mode === "pickup" ? "ready" : "preparing";
    case PbOrderStatus.ORDER_STATUS_PICKED_UP:
      return "pickedUp";
    case PbOrderStatus.ORDER_STATUS_DELIVERED:
      return "delivered";
    case PbOrderStatus.ORDER_STATUS_COLLECTED:
      return "collected";
    case PbOrderStatus.ORDER_STATUS_CANCELLED:
    case PbOrderStatus.ORDER_STATUS_REJECTED:
    case PbOrderStatus.ORDER_STATUS_FAILED:
      return "cancelled";
    default: // PENDING, PLACED
      return "placed";
  }
}

const BRANDS: Record<number, string> = {
  [CardBrand.CARD_BRAND_VISA]: "Visa",
  [CardBrand.CARD_BRAND_MASTERCARD]: "Mastercard",
  [CardBrand.CARD_BRAND_AMEX]: "Amex",
};
export const brandName = (b: CardBrand): "Visa" | "Mastercard" | "Amex" =>
  (BRANDS[b] as "Visa" | "Mastercard" | "Amex" | undefined) ?? "Visa";
export function brandFromName(name: string): CardBrand {
  const n = name.toLowerCase();
  if (n.startsWith("master")) return CardBrand.CARD_BRAND_MASTERCARD;
  if (n.startsWith("amex") || n.startsWith("american")) return CardBrand.CARD_BRAND_AMEX;
  if (n.startsWith("visa")) return CardBrand.CARD_BRAND_VISA;
  return CardBrand.CARD_BRAND_UNSPECIFIED;
}

export function toPayment(p: PbPaymentMethod | undefined): PaymentMethod {
  if (p?.kind === PaymentMethodKind.PAYMENT_METHOD_KIND_CARD) {
    return { type: "card", brand: brandName(p.cardBrand), last4: p.cardLast4 };
  }
  const payingWith = p?.cashPayingWith ? toRupees(p.cashPayingWith) : 0;
  return payingWith > 0 ? { type: "cash", payingWith } : { type: "cash" };
}

/** Home and Work keep the app's well-known ids ("home", "work"), which drive its icons. */
export function appAddressId(a: Pick<PbAddress, "id" | "label">): string {
  const l = a.label.trim().toLowerCase();
  return l === "home" || l === "work" ? l : a.id;
}

export function toSavedAddress(a: PbAddress): SavedAddress {
  const out: SavedAddress = { id: appAddressId(a), label: a.label, line: a.line };
  if (a.area) out.area = a.area;
  if (a.note) out.note = a.note;
  const pin = mapFromGeo(a.location);
  if (pin) out.pin = pin;
  return out;
}

/** App address -> proto. `id` is the profile id to write ("" creates). */
export function fromSavedAddress(a: SavedAddress, id = ""): PbAddress {
  return {
    id,
    label: a.label,
    line: a.line,
    area: a.area ?? "",
    note: a.note ?? "",
    location: a.pin ? geoFromMap(a.pin) : undefined,
    zoneId: "",
  };
}

export function toLine(l: PbOrderLine): OrderLine {
  return {
    key: l.key,
    itemId: l.itemId,
    name: l.name,
    unitPrice: toRupees(l.unitPrice),
    qty: l.quantity,
    choices: l.choiceNames,
    note: l.note,
  };
}

const ISSUE_KINDS: Record<number, IssueInput["kind"]> = {
  [PbIssueKind.ISSUE_KIND_MISSING]: "missing",
  [PbIssueKind.ISSUE_KIND_WRONG]: "wrong",
  [PbIssueKind.ISSUE_KIND_SPILLED]: "spilled",
  [PbIssueKind.ISSUE_KIND_LATE]: "late",
  [PbIssueKind.ISSUE_KIND_NEVER_ARRIVED]: "neverArrived",
  [PbIssueKind.ISSUE_KIND_CHARGED]: "charged",
};
export const fromIssueKind = (k: IssueInput["kind"]): PbIssueKind =>
  Number(Object.entries(ISSUE_KINDS).find(([, v]) => v === k)?.[0] ?? 0) as PbIssueKind;

const RESOLUTIONS: Record<number, IssueInput["resolution"]> = {
  [PbIssueResolution.ISSUE_RESOLUTION_CREDIT]: "credit",
  [PbIssueResolution.ISSUE_RESOLUTION_CARD]: "card",
  [PbIssueResolution.ISSUE_RESOLUTION_REVIEW]: "review",
};
export const fromResolution = (r: IssueInput["resolution"]): PbIssueResolution =>
  Number(Object.entries(RESOLUTIONS).find(([, v]) => v === r)?.[0] ?? 0) as PbIssueResolution;

export function toIssue(i: PbOrderIssue): NonNullable<Order["issue"]> {
  const out: NonNullable<Order["issue"]> = {
    kind: ISSUE_KINDS[i.kind] ?? "charged",
    lines: i.lines.map((l) => ({ key: l.lineKey, qty: l.quantity })),
    note: i.note,
    resolution: RESOLUTIONS[i.resolution] ?? "review",
    amount: toRupees(i.amount),
    reportedAt: ms(i.reportedAt) ?? 0,
  };
  if (i.photoName) out.photoName = i.photoName;
  return out;
}

export function toRating(r: PbOrderRating): NonNullable<Order["rating"]> {
  const out: NonNullable<Order["rating"]> = {
    riderTags: r.riderTags,
    dishes: Object.fromEntries(
      r.dishes
        .filter((d) => d.thumb !== Thumb.THUMB_UNSPECIFIED)
        .map((d) => [d.itemId, d.thumb === Thumb.THUMB_UP ? ("up" as const) : ("down" as const)]),
    ),
    comment: r.comment,
    ratedAt: ms(r.ratedAt) ?? 0,
  };
  if (r.riderStars > 0) out.riderStars = r.riderStars;
  return out;
}

const REJECTION_COPY: Record<number, string> = {
  [RejectionReason.REJECTION_REASON_TOO_BUSY]: "The restaurant was too busy to take it.",
  [RejectionReason.REJECTION_REASON_SOLD_OUT]: "Something in your order had sold out.",
  [RejectionReason.REJECTION_REASON_CLOSING_SOON]: "The restaurant was about to close.",
  [RejectionReason.REJECTION_REASON_TIMEOUT]: "The restaurant didn't accept it in time.",
};

export interface OrderJoins {
  rating?: PbOrderRating;
  issue?: PbOrderIssue;
}

/** Proto order -> app order. Ops-only fields (notes, real phones, customer contact) never leave. */
export function toOrder(o: PbOrder, joins: OrderJoins = {}): Order {
  const mode = toMode(o.mode);
  const r = o.restaurant;
  const t = o.totals;
  const out: Order = {
    id: o.orderNumber || o.id,
    ref: o.id,
    status: toStatus(o.status, mode),
    placedAt: ms(o.placedAt) ?? ms(o.createdAt) ?? 0,
    mode,
    restaurant: {
      id: r ? restaurantNumber(r.id) : 0,
      name: r?.name ?? "",
      imageId: r?.imageId ?? "",
      eta: [r?.etaMinMinutes ?? 0, Math.max(r?.etaMinMinutes ?? 0, r?.etaMaxMinutes ?? 0)],
      deliveryFee: toRupees(t?.deliveryFee),
      area: r?.area ?? "",
    },
    lines: o.lines.map(toLine),
    riderNote: o.riderNote,
    payment: toPayment(o.payment),
    totals: {
      subtotal: toRupees(t?.subtotal),
      saving: toRupees(t?.saving),
      deliveryFee: toRupees(t?.deliveryFee),
      smallOrderFee: toRupees(t?.smallOrderFee),
      promoDiscount: toRupees(t?.promoDiscount),
      tip: toRupees(t?.tip),
      total: toRupees(t?.total),
    },
  };
  if (r && r.discountPercent > 0) out.restaurant.discountPercent = r.discountPercent;
  const credit = toRupees(t?.credit);
  if (credit > 0) out.totals.credit = credit;
  if (mode === "delivery" && o.address) out.address = toSavedAddress(o.address);
  if (o.scheduledFor) out.scheduledFor = o.scheduledFor.getTime();
  if (o.promo?.code) out.promoCode = o.promo.code;
  if (o.rider && (o.rider.name || o.rider.firstName)) {
    out.rider = {
      name: o.rider.firstName || o.rider.name,
      rating: o.rider.rating,
      vehicle: o.rider.vehicle,
      plate: o.rider.plate,
      maskedPhone: o.rider.maskedPhone,
    };
  }
  if (out.status === "cancelled") {
    out.cancelledAt = ms(o.cancellation?.at) ?? ms(o.rejection?.at) ?? ms(o.updatedAt) ?? out.placedAt;
    const reason =
      o.status === PbOrderStatus.ORDER_STATUS_REJECTED
        ? (REJECTION_COPY[o.rejection?.reason ?? 0] ?? "The restaurant couldn't take it.")
        : o.status === PbOrderStatus.ORDER_STATUS_FAILED
          ? o.failureMessage
          : o.cancellation?.reason;
    if (reason) out.cancelReason = reason;
  }
  const set = (
    k: "collectedAt" | "deliveredAt" | "acceptedAt" | "readyBy" | "pickedUpAt" | "dueAt",
    d?: Date,
  ) => {
    if (d) out[k] = d.getTime();
  };
  set("collectedAt", o.collectedAt);
  set("deliveredAt", o.deliveredAt);
  set("acceptedAt", o.acceptedAt);
  set("readyBy", o.readyBy);
  set("pickedUpAt", o.pickedUpAt);
  set("dueAt", o.dueAt);
  if (o.deliveryCode) out.deliveryCode = o.deliveryCode;
  if (o.substitution === SubstitutionPreference.SUBSTITUTION_PREFERENCE_SIMILAR) out.substitution = "similar";
  if (o.substitution === SubstitutionPreference.SUBSTITUTION_PREFERENCE_REFUND) out.substitution = "refund";
  if (o.groupId) out.groupId = o.groupId;
  if (joins.rating) out.rating = toRating(joins.rating);
  if (joins.issue) out.issue = toIssue(joins.issue);
  return out;
}

export function fromPayment(p: PaymentMethod, cardId = ""): PbPaymentMethod {
  if (p.type === "card") {
    return {
      kind: PaymentMethodKind.PAYMENT_METHOD_KIND_CARD,
      cardId: p.cardId ?? cardId,
      cardBrand: brandFromName(p.brand),
      cardLast4: p.last4,
      cashPayingWith: undefined,
    };
  }
  return {
    kind: PaymentMethodKind.PAYMENT_METHOD_KIND_CASH,
    cardId: "",
    cardBrand: CardBrand.CARD_BRAND_UNSPECIFIED,
    cardLast4: "",
    cashPayingWith: p.payingWith ? fromRupees(p.payingWith) : undefined,
  };
}

export function toGroup(g: PbGroupOrder): GroupOrder {
  const created = ms(g.createdAt) ?? 0;
  const out: GroupOrder = {
    id: g.id,
    restaurantId: restaurantNumber(g.restaurantId),
    restaurantName: g.restaurantName,
    hostName: g.hostName,
    createdAt: created,
    closesAt: ms(g.closesAt) ?? created,
    members: g.members.map((m) => ({
      name: m.name,
      joinsAfter: Math.max(0, (ms(m.joinedAt) ?? created) - created),
      lines: m.pricedLines.map(toLine),
    })),
  };
  const limit = toRupees(g.limit);
  if (limit > 0) out.limit = limit;
  if (g.orderId) out.orderId = g.orderId;
  return out;
}
