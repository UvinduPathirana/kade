// Proto -> restaurant-app shapes (and back). The only place enum names and field layouts of the
// services meet the app's vocabulary (proto/README.md, "How the apps' data maps onto the contracts").
import {
  DishTag as ProtoDishTag,
  type DayHours as ProtoDayHours,
  type Closure as ProtoClosure,
  type Menu as ProtoMenu,
  type MenuItem as ProtoMenuItem,
  type Restaurant,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import type { DayOfWeek } from "@kade/proto/kade/common/v1/commerce";
import { FulfilmentMode, PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import {
  StatementStatus,
  type DailySales as ProtoDailySales,
  type Statement as ProtoStatement,
} from "@kade/proto/kade/ledger/v1/ledger_service";
import {
  BusinessType,
  MenuSubmissionMethod,
  OutletStaffRole,
  PaperWidth,
  TicketStatus,
  type Outlet as ProtoOutlet,
  type OutletSettings,
  type OutletStaffMember,
  type PartnerApplication as ProtoApplication,
  type SubmitApplicationRequest,
  type Ticket as ProtoTicket,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import { RejectionReason } from "@kade/proto/kade/order/v1/order_service";
import {
  OfferType as ProtoOfferType,
  type Offer as ProtoOffer,
} from "@kade/proto/kade/promotion/v1/promotion_service";
import type { Review as ProtoReview } from "@kade/proto/kade/review/v1/review_service";
import { fromRupees, toRupees } from "./money.js";
import type { MenuItemInput, OfferInput, PartnerApplication, PartnerSettings } from "./schemas.js";

// App types (apps/restaurant/src/api/types.ts). Kept as plain interfaces here so mappers are typed
// precisely; the TypeBox schemas in schemas.ts describe the same shapes for validation and OpenAPI.
export type TicketStatusName = "new" | "preparing" | "ready" | "pickedUp" | "missed" | "rejected";
export type RejectReasonName = "tooBusy" | "soldOut" | "closingSoon" | "other";

export interface AppTicketLine {
  itemId: string;
  name: string;
  qty: number;
  choices: string[];
  note: string;
  unitPrice: number;
}
export interface AppTicket {
  id: string;
  placedAt: number;
  acceptBy: number;
  status: TicketStatusName;
  mode: "delivery" | "pickup";
  customerName: string;
  repeatCount: number;
  lines: AppTicketLine[];
  kitchenNote: string;
  cutlery: boolean;
  payment: "card" | "cash";
  subtotal: number;
  acceptedAt?: number;
  prepMinutes?: number;
  readyBy?: number;
  readyAt?: number;
  pickedUpAt?: number;
  closedAt?: number;
  rejectReason?: RejectReasonName;
  rejectNote?: string;
  rider?: { name: string; vehicle: string; plate: string; maskedPhone: string };
  riderArrivesAt?: number;
}

const ms = (d: Date | undefined): number | undefined => (d ? d.getTime() : undefined);

/** Drops undefined values so optional fields are absent (not null) in JSON. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/** "KD-2417" -> "2417"; the kitchen calls out the digits. */
export function ticketNumberOf(t: Pick<ProtoTicket, "ticketNumber" | "orderNumber" | "orderId">): string {
  return t.ticketNumber || t.orderNumber.replace(/^\D+/, "") || t.orderId;
}

const REJECT_TO_APP: Partial<Record<RejectionReason, RejectReasonName>> = {
  [RejectionReason.REJECTION_REASON_TOO_BUSY]: "tooBusy",
  [RejectionReason.REJECTION_REASON_SOLD_OUT]: "soldOut",
  [RejectionReason.REJECTION_REASON_CLOSING_SOON]: "closingSoon",
  [RejectionReason.REJECTION_REASON_OTHER]: "other",
};
export const REJECT_FROM_APP: Record<RejectReasonName, RejectionReason> = {
  tooBusy: RejectionReason.REJECTION_REASON_TOO_BUSY,
  soldOut: RejectionReason.REJECTION_REASON_SOLD_OUT,
  closingSoon: RejectionReason.REJECTION_REASON_CLOSING_SOON,
  other: RejectionReason.REJECTION_REASON_OTHER,
};

function ticketStatus(t: ProtoTicket): TicketStatusName {
  switch (t.status) {
    case TicketStatus.TICKET_STATUS_PREPARING:
      return "preparing";
    case TicketStatus.TICKET_STATUS_READY:
      return "ready";
    case TicketStatus.TICKET_STATUS_PICKED_UP:
      return "pickedUp";
    case TicketStatus.TICKET_STATUS_MISSED:
      return "missed";
    // The app has no "cancelled" lane: a cancelled order leaves the board like a rejected one.
    case TicketStatus.TICKET_STATUS_REJECTED:
    case TicketStatus.TICKET_STATUS_CANCELLED:
      return "rejected";
    default:
      return t.rejectReason === RejectionReason.REJECTION_REASON_TIMEOUT ? "missed" : "new";
  }
}

export function toTicket(t: ProtoTicket | undefined, now = Date.now()): AppTicket {
  if (!t) throw new Error("upstream returned no ticket");
  const status = ticketStatus(t);
  const placedAt = ms(t.placedAt) ?? now;
  const isDelivery = t.mode !== FulfilmentMode.FULFILMENT_MODE_PICKUP;
  let riderArrivesAt = ms(t.riderArrivesAt);
  // At the counter already: the board shows "waiting" from the moment they arrived (or now).
  if (t.riderAtCounter) riderArrivesAt = Math.min(riderArrivesAt ?? now, now);
  return compact<AppTicket>({
    id: ticketNumberOf(t),
    placedAt,
    acceptBy: ms(t.acceptBy) ?? placedAt + 3 * 60_000,
    status,
    mode: isDelivery ? "delivery" : "pickup",
    customerName: t.customerFirstName,
    repeatCount: t.repeatCount,
    lines: t.lines.map((l) => ({
      itemId: l.itemId,
      name: l.name,
      qty: l.quantity,
      choices: l.choiceNames,
      note: l.note,
      unitPrice: toRupees(l.unitPrice),
    })),
    kitchenNote: t.kitchenNote,
    cutlery: t.cutlery,
    payment: t.payment === PaymentMethodKind.PAYMENT_METHOD_KIND_CASH ? "cash" : "card",
    subtotal: toRupees(t.subtotal),
    acceptedAt: ms(t.acceptedAt),
    prepMinutes: t.prepMinutes || undefined,
    readyBy: ms(t.readyBy),
    readyAt: ms(t.readyAt),
    pickedUpAt: ms(t.pickedUpAt),
    closedAt: ms(t.closedAt),
    rejectReason: status === "rejected" ? (REJECT_TO_APP[t.rejectReason] ?? "other") : undefined,
    rejectNote:
      status === "rejected"
        ? t.rejectNote ||
          (t.status === TicketStatus.TICKET_STATUS_CANCELLED ? "The order was cancelled." : undefined)
        : undefined,
    rider:
      isDelivery && t.rider?.name
        ? {
            name: t.rider.name,
            vehicle: t.rider.vehicle,
            plate: t.rider.plate,
            maskedPhone: t.rider.maskedPhone,
          }
        : undefined,
    riderArrivesAt: isDelivery && t.rider?.name ? riderArrivesAt : undefined,
  });
}

// ---------- Menu ----------

const TAG_TO_APP: Partial<Record<ProtoDishTag, "Vegetarian" | "Spicy">> = {
  [ProtoDishTag.DISH_TAG_VEGETARIAN]: "Vegetarian",
  [ProtoDishTag.DISH_TAG_SPICY]: "Spicy",
};
const TAG_FROM_APP = {
  Vegetarian: ProtoDishTag.DISH_TAG_VEGETARIAN,
  Spicy: ProtoDishTag.DISH_TAG_SPICY,
} as const;

export function toMenu(menu: ProtoMenu | undefined) {
  if (!menu) throw new Error("upstream returned no menu");
  return {
    sections: [...menu.sections]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        name: s.name,
        items: [...s.items].sort((a, b) => a.position - b.position).map(toMenuItem),
      })),
    optionGroups: menu.optionGroups.map((g) => ({
      id: g.id,
      name: g.name,
      required: g.required,
      max: g.maxChoices || 1,
      choices: g.choices.map((c) => ({ name: c.name, price: toRupees(c.price) })),
    })),
  };
}

function toMenuItem(i: ProtoMenuItem) {
  return compact({
    id: i.id,
    name: i.name,
    description: i.description,
    price: toRupees(i.price),
    imageId: i.imageId || undefined,
    tags: i.tags.flatMap((t) => TAG_TO_APP[t] ?? []),
    optionGroupIds: i.optionGroupIds,
    soldOut: i.soldOut,
  });
}

export function fromMenuItemInput(restaurantId: string, input: MenuItemInput): ProtoMenuItem {
  return {
    id: input.id ?? "",
    restaurantId,
    sectionId: input.sectionId,
    name: input.name.trim(),
    description: input.description.trim(),
    price: fromRupees(input.price),
    imageId: input.imageId ?? "",
    tags: input.tags.map((t) => TAG_FROM_APP[t]),
    optionGroupIds: input.optionGroupIds,
    popularRank: 0,
    soldOut: false,
    soldOutUntil: undefined,
    unit: "",
    position: 0,
  };
}

// ---------- Outlet ----------

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Weekday = (typeof DAYS)[number];

export function toDayHours(h: ProtoDayHours): {
  day: Weekday;
  isOpen: boolean;
  ranges: { open: string; close: string }[];
} {
  return {
    day: DAYS[(h.day || 1) - 1] ?? "mon",
    isOpen: h.isOpen,
    ranges: h.ranges.map((r) => ({ open: r.open, close: r.close })),
  };
}

export function fromDayHours(h: {
  day: Weekday;
  isOpen: boolean;
  ranges: { open: string; close: string }[];
}): ProtoDayHours {
  return {
    day: (DAYS.indexOf(h.day) + 1) as DayOfWeek,
    isOpen: h.isOpen,
    ranges: h.ranges.map((r) => ({ open: r.open, close: r.close })),
  };
}

export function toOutlet(
  outlet: ProtoOutlet | undefined,
  details: Restaurant | undefined,
  hours: ProtoDayHours[],
  closures: ProtoClosure[],
  now = Date.now(),
) {
  if (!outlet) throw new Error("upstream returned no outlet");
  const busy = outlet.status?.busyExtraMinutes ?? 0;
  const pausedUntil = ms(outlet.status?.pausedUntil);
  // Hours come back in any order; the app expects Monday first.
  const byDay = new Map(hours.map((h) => [h.day, h]));
  return {
    // Catalog is the system of record for the details the kitchen edits; merchant mirrors them.
    name: details?.name || outlet.name,
    area: details?.area || outlet.area,
    address: details?.address || outlet.address,
    phone: details?.phone || outlet.phone,
    status: {
      busyExtra: (busy >= 20 ? 20 : busy >= 10 ? 10 : 0) as 0 | 10 | 20,
      pausedUntil: pausedUntil && pausedUntil > now ? pausedUntil : null,
    },
    hours: DAYS.map(
      (_, i) => byDay.get((i + 1) as DayOfWeek) ?? { day: (i + 1) as DayOfWeek, isOpen: false, ranges: [] },
    ).map(toDayHours),
    closures: [...closures]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((c) => ({ id: c.id, date: c.date, reason: c.reason })),
  };
}

// ---------- Offers ----------

const OFFER_TO_APP: Record<number, "percent" | "amount" | "bogo" | "freeDelivery"> = {
  [ProtoOfferType.OFFER_TYPE_PERCENT]: "percent",
  [ProtoOfferType.OFFER_TYPE_AMOUNT]: "amount",
  [ProtoOfferType.OFFER_TYPE_BOGO]: "bogo",
  [ProtoOfferType.OFFER_TYPE_FREE_DELIVERY]: "freeDelivery",
};
const OFFER_FROM_APP = {
  percent: ProtoOfferType.OFFER_TYPE_PERCENT,
  amount: ProtoOfferType.OFFER_TYPE_AMOUNT,
  bogo: ProtoOfferType.OFFER_TYPE_BOGO,
  freeDelivery: ProtoOfferType.OFFER_TYPE_FREE_DELIVERY,
} as const;

export function toOffer(o: ProtoOffer | undefined) {
  if (!o) throw new Error("upstream returned no offer");
  const type = OFFER_TO_APP[o.type] ?? "percent";
  return compact({
    id: o.id,
    type,
    value: type === "percent" ? o.percent : type === "amount" ? toRupees(o.amount) : 0,
    maxDiscount: toRupees(o.maxDiscount),
    minOrder: toRupees(o.minOrder),
    buy: o.buy,
    get: o.get,
    bogoItemId: o.bogoItemId || undefined,
    sectionIds: o.sectionIds,
    startDate: o.startDate,
    endDate: o.endDate,
    budget: toRupees(o.budget),
    spent: toRupees(o.spent),
    orders: o.orders,
    endedAt: ms(o.endedAt),
  });
}

export function fromOfferInput(restaurantId: string, o: OfferInput): ProtoOffer {
  return {
    id: "",
    restaurantId,
    type: OFFER_FROM_APP[o.type as keyof typeof OFFER_FROM_APP],
    percent: o.type === "percent" ? o.value : 0,
    amount: fromRupees(o.type === "amount" ? o.value : 0),
    maxDiscount: fromRupees(o.maxDiscount),
    minOrder: fromRupees(o.minOrder),
    buy: o.buy,
    get: o.get,
    bogoItemId: o.bogoItemId ?? "",
    sectionIds: o.sectionIds,
    startDate: o.startDate,
    endDate: o.endDate,
    budget: fromRupees(o.budget),
    spent: undefined,
    orders: 0,
    endedAt: undefined,
    state: 0,
    label: "",
  };
}

// ---------- Payouts ----------

export function toDailySales(d: ProtoDailySales) {
  return {
    date: d.date,
    orders: d.orders,
    card: toRupees(d.card),
    cash: toRupees(d.cash),
    offerCost: toRupees(d.offerCost),
  };
}

export function toStatement(s: ProtoStatement) {
  return {
    id: s.id,
    from: s.period?.fromDate ?? "",
    to: s.period?.toDate ?? "",
    orders: s.orders,
    gross: toRupees(s.gross),
    commission: toRupees(s.commission),
    offerCost: toRupees(s.offerCost),
    net: toRupees(s.net),
    status: s.status === StatementStatus.STATEMENT_STATUS_PAID ? ("paid" as const) : ("pending" as const),
    payDate: s.payDate,
  };
}

// ---------- Reviews ----------

/** The calendar day in Colombo, "2026-10-12". */
export function colomboDate(d: Date | undefined): string {
  return (d ?? new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
}

export function toReview(r: ProtoReview | undefined) {
  if (!r) throw new Error("upstream returned no review");
  return compact({
    id: r.id,
    name: r.customerName,
    date: colomboDate(r.createdAt),
    dish: r.dish,
    stars: r.stars,
    text: r.text,
    reply: r.reply?.text ? { text: r.reply.text, at: ms(r.reply.at) ?? Date.now() } : undefined,
  });
}

// ---------- Staff, settings, onboarding ----------

const ROLE_TO_APP: Record<number, "owner" | "manager" | "kitchen"> = {
  [OutletStaffRole.OUTLET_STAFF_ROLE_OWNER]: "owner",
  [OutletStaffRole.OUTLET_STAFF_ROLE_MANAGER]: "manager",
  [OutletStaffRole.OUTLET_STAFF_ROLE_KITCHEN]: "kitchen",
};
export const ROLE_FROM_APP = {
  owner: OutletStaffRole.OUTLET_STAFF_ROLE_OWNER,
  manager: OutletStaffRole.OUTLET_STAFF_ROLE_MANAGER,
  kitchen: OutletStaffRole.OUTLET_STAFF_ROLE_KITCHEN,
} as const;

export function toStaffMember(m: OutletStaffMember | undefined) {
  if (!m) throw new Error("upstream returned no staff member");
  return {
    id: m.id,
    name: m.name,
    phone: m.phone,
    role: ROLE_TO_APP[m.role] ?? "kitchen",
    lastActive: m.pending ? null : (ms(m.lastActiveAt) ?? null),
  };
}

export function toSettings(s: OutletSettings | undefined): PartnerSettings {
  return {
    devices: {
      autoPrint: s?.devices?.autoPrint ?? false,
      printerName: s?.devices?.printerName ?? "",
      paperWidth: s?.devices?.paperWidth === PaperWidth.PAPER_WIDTH_58MM ? "58" : "80",
      copies: s?.devices?.copies === 2 ? 2 : 1,
    },
    notifications: {
      smsPaused: s?.notifications?.smsPaused ?? false,
      emailStatements: s?.notifications?.emailStatements ?? false,
      newReviews: s?.notifications?.newReviews ?? false,
      lowRatings: s?.notifications?.lowRatings ?? false,
    },
  };
}

export function fromSettings(s: PartnerSettings): OutletSettings {
  return {
    devices: {
      autoPrint: s.devices.autoPrint,
      printerName: s.devices.printerName,
      paperWidth: s.devices.paperWidth === "58" ? PaperWidth.PAPER_WIDTH_58MM : PaperWidth.PAPER_WIDTH_80MM,
      copies: s.devices.copies,
    },
    notifications: { ...s.notifications },
  };
}

const BUSINESS_FROM_APP = {
  restaurant: BusinessType.BUSINESS_TYPE_RESTAURANT,
  cafe: BusinessType.BUSINESS_TYPE_CAFE,
  bakery: BusinessType.BUSINESS_TYPE_BAKERY,
  homeKitchen: BusinessType.BUSINESS_TYPE_HOME_KITCHEN,
  cloudKitchen: BusinessType.BUSINESS_TYPE_CLOUD_KITCHEN,
} as const;
const MENU_FROM_APP = {
  file: MenuSubmissionMethod.MENU_SUBMISSION_METHOD_FILE,
  photo: MenuSubmissionMethod.MENU_SUBMISSION_METHOD_PHOTO,
  later: MenuSubmissionMethod.MENU_SUBMISSION_METHOD_LATER,
} as const;
const DOCUMENT_NAMES = {
  registration: "Business registration",
  foodSafety: "Food safety certificate",
  ownerId: "Owner's NIC",
} as const;

export function fromApplication(a: PartnerApplication, idempotencyKey: string): SubmitApplicationRequest {
  const digits = a.bank.accountNumber.replace(/\D/g, "");
  return {
    business: {
      name: a.business.name.trim(),
      type: BUSINESS_FROM_APP[a.business.type as keyof typeof BUSINESS_FROM_APP],
      address: a.business.address,
      city: a.business.city,
      brNumber: a.business.brNumber,
      cuisine: "",
      area: a.business.city,
      location: undefined,
    },
    owner: { ...a.owner },
    // The app keeps file names only; uploads go to object storage once that exists.
    documents: (Object.keys(DOCUMENT_NAMES) as (keyof typeof DOCUMENT_NAMES)[])
      .filter((kind) => a.documents[kind])
      .map((kind) => ({
        id: "",
        kind,
        name: DOCUMENT_NAMES[kind],
        fileName: a.documents[kind],
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
      accountName: a.bank.accountName,
      accountNumber: digits,
      accountLast4: digits.slice(-4),
    },
    menu: {
      method: MENU_FROM_APP[a.menu.method],
      fileName: a.menu.fileName,
      fileRef: "",
    },
    idempotencyKey,
  };
}

export function toSubmitted(app: ProtoApplication | undefined, fallback: PartnerApplication) {
  return {
    reference: app?.reference || "KP-PENDING",
    submittedAt: ms(app?.submittedAt) ?? Date.now(),
    businessName: app?.business?.name || fallback.business.name,
    phone: app?.owner?.phone || fallback.owner.phone,
  };
}
