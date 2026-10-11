// Database values are short lowercase strings; the API speaks proto enums. One table per enum so the
// mapping is checked in both directions.
import { FulfilmentMode, PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import { ApplicationStatus, DocumentStatus } from "@kade/proto/kade/common/v1/onboarding";
import {
  OutletAdminStatus,
  OutletStaffRole,
  TicketStatus,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import { RejectionReason } from "@kade/proto/kade/order/v1/order_service";

function bimap<D extends string, P extends number>(pairs: readonly (readonly [D, P])[], fallback: P) {
  const toProto = new Map<string, P>(pairs.map(([d, p]) => [d, p]));
  const toDb = new Map<number, D>(pairs.map(([d, p]) => [p, d]));
  return {
    toProto: (d: string | null | undefined): P => (d ? (toProto.get(d) ?? fallback) : fallback),
    toDb: (p: number): D | undefined => toDb.get(p),
    values: pairs.map(([d]) => d),
  };
}

export type TicketStatusDb =
  "new" | "preparing" | "ready" | "picked_up" | "missed" | "rejected" | "cancelled";
export const ticketStatus = bimap<TicketStatusDb, TicketStatus>(
  [
    ["new", TicketStatus.TICKET_STATUS_NEW],
    ["preparing", TicketStatus.TICKET_STATUS_PREPARING],
    ["ready", TicketStatus.TICKET_STATUS_READY],
    ["picked_up", TicketStatus.TICKET_STATUS_PICKED_UP],
    ["missed", TicketStatus.TICKET_STATUS_MISSED],
    ["rejected", TicketStatus.TICKET_STATUS_REJECTED],
    ["cancelled", TicketStatus.TICKET_STATUS_CANCELLED],
  ],
  TicketStatus.TICKET_STATUS_UNSPECIFIED,
);

export const FINAL_TICKET_STATUSES: readonly TicketStatusDb[] = [
  "picked_up",
  "missed",
  "rejected",
  "cancelled",
];

/**
 * Tickets only move forward: new(0) → preparing(1) → ready(2) → final(3). Events arrive from two
 * topics (order, delivery) and from our own decisions, so a late event must never move a ticket back.
 */
export function ticketRank(s: TicketStatusDb): number {
  switch (s) {
    case "new":
      return 0;
    case "preparing":
      return 1;
    case "ready":
      return 2;
    default:
      return 3;
  }
}

export type RejectReasonDb = "too_busy" | "sold_out" | "closing_soon" | "other" | "timeout";
export const rejectReason = bimap<RejectReasonDb, RejectionReason>(
  [
    ["too_busy", RejectionReason.REJECTION_REASON_TOO_BUSY],
    ["sold_out", RejectionReason.REJECTION_REASON_SOLD_OUT],
    ["closing_soon", RejectionReason.REJECTION_REASON_CLOSING_SOON],
    ["other", RejectionReason.REJECTION_REASON_OTHER],
    ["timeout", RejectionReason.REJECTION_REASON_TIMEOUT],
  ],
  RejectionReason.REJECTION_REASON_UNSPECIFIED,
);

export type ModeDb = "delivery" | "pickup";
export const fulfilmentMode = bimap<ModeDb, FulfilmentMode>(
  [
    ["delivery", FulfilmentMode.FULFILMENT_MODE_DELIVERY],
    ["pickup", FulfilmentMode.FULFILMENT_MODE_PICKUP],
  ],
  FulfilmentMode.FULFILMENT_MODE_UNSPECIFIED,
);

export type PaymentDb = "card" | "cash";
export const paymentKind = bimap<PaymentDb, PaymentMethodKind>(
  [
    ["card", PaymentMethodKind.PAYMENT_METHOD_KIND_CARD],
    ["cash", PaymentMethodKind.PAYMENT_METHOD_KIND_CASH],
  ],
  PaymentMethodKind.PAYMENT_METHOD_KIND_UNSPECIFIED,
);

export type AdminStatusDb = "open" | "paused" | "suspended" | "closed";
export const adminStatus = bimap<AdminStatusDb, OutletAdminStatus>(
  [
    ["open", OutletAdminStatus.OUTLET_ADMIN_STATUS_OPEN],
    ["paused", OutletAdminStatus.OUTLET_ADMIN_STATUS_PAUSED],
    ["suspended", OutletAdminStatus.OUTLET_ADMIN_STATUS_SUSPENDED],
    ["closed", OutletAdminStatus.OUTLET_ADMIN_STATUS_CLOSED],
  ],
  OutletAdminStatus.OUTLET_ADMIN_STATUS_UNSPECIFIED,
);

export type StaffRoleDb = "owner" | "manager" | "kitchen";
export const staffRole = bimap<StaffRoleDb, OutletStaffRole>(
  [
    ["owner", OutletStaffRole.OUTLET_STAFF_ROLE_OWNER],
    ["manager", OutletStaffRole.OUTLET_STAFF_ROLE_MANAGER],
    ["kitchen", OutletStaffRole.OUTLET_STAFF_ROLE_KITCHEN],
  ],
  OutletStaffRole.OUTLET_STAFF_ROLE_UNSPECIFIED,
);

/** owner(3) ⊇ manager(2) ⊇ kitchen(1). */
export function staffRank(role: StaffRoleDb): number {
  return role === "owner" ? 3 : role === "manager" ? 2 : 1;
}

export type ApplicationStatusDb = "pending" | "changes_requested" | "approved" | "rejected";
export const applicationStatus = bimap<ApplicationStatusDb, ApplicationStatus>(
  [
    ["pending", ApplicationStatus.APPLICATION_STATUS_PENDING],
    ["changes_requested", ApplicationStatus.APPLICATION_STATUS_CHANGES_REQUESTED],
    ["approved", ApplicationStatus.APPLICATION_STATUS_APPROVED],
    ["rejected", ApplicationStatus.APPLICATION_STATUS_REJECTED],
  ],
  ApplicationStatus.APPLICATION_STATUS_UNSPECIFIED,
);

export { DocumentStatus };
