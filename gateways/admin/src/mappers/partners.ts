// merchant / dispatch / pricing → the console's partner shapes (apps/admin/src/api/types.ts).
import {
  ApplicationStatus,
  DocumentStatus,
  type PartnerDocument,
} from "@kade/proto/kade/common/v1/onboarding";
import {
  RiderStatus,
  VehicleType,
  type Rider as ProtoRider,
  type RiderApplication as ProtoRiderApplication,
} from "@kade/proto/kade/dispatch/v1/dispatch_service";
import {
  OutletAdminStatus,
  type OutletAdminView,
  type PartnerApplication,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import type { Zone as PricingZone } from "@kade/proto/kade/pricing/v1/pricing_service";
import { personId, restaurantNumber } from "../ids.js";
import { isoDate, ms, nonEmpty, rs, zonePosition } from "../lib.js";
import type {
  Restaurant,
  RestaurantApplication,
  ReviewDoc,
  Rider,
  RiderApplication,
  Zone,
} from "../schemas.js";

export const OUTLET_STATUS: Record<number, Restaurant["status"]> = {
  [OutletAdminStatus.OUTLET_ADMIN_STATUS_OPEN]: "open",
  [OutletAdminStatus.OUTLET_ADMIN_STATUS_PAUSED]: "paused",
  [OutletAdminStatus.OUTLET_ADMIN_STATUS_SUSPENDED]: "suspended",
  [OutletAdminStatus.OUTLET_ADMIN_STATUS_CLOSED]: "closed",
};
export const OUTLET_STATUS_TO_PROTO: Record<Restaurant["status"], OutletAdminStatus> = {
  open: OutletAdminStatus.OUTLET_ADMIN_STATUS_OPEN,
  paused: OutletAdminStatus.OUTLET_ADMIN_STATUS_PAUSED,
  suspended: OutletAdminStatus.OUTLET_ADMIN_STATUS_SUSPENDED,
  closed: OutletAdminStatus.OUTLET_ADMIN_STATUS_CLOSED,
};

export const APPLICATION_STATUS: Record<number, RestaurantApplication["status"]> = {
  [ApplicationStatus.APPLICATION_STATUS_PENDING]: "pending",
  [ApplicationStatus.APPLICATION_STATUS_CHANGES_REQUESTED]: "changesRequested",
  [ApplicationStatus.APPLICATION_STATUS_APPROVED]: "approved",
  [ApplicationStatus.APPLICATION_STATUS_REJECTED]: "rejected",
};
export const DECISION_TO_PROTO = {
  approved: ApplicationStatus.APPLICATION_STATUS_APPROVED,
  changesRequested: ApplicationStatus.APPLICATION_STATUS_CHANGES_REQUESTED,
  rejected: ApplicationStatus.APPLICATION_STATUS_REJECTED,
} as const;

export const DOC_STATUS_TO_PROTO: Record<ReviewDoc["status"], DocumentStatus> = {
  pending: DocumentStatus.DOCUMENT_STATUS_PENDING,
  approved: DocumentStatus.DOCUMENT_STATUS_APPROVED,
  rejected: DocumentStatus.DOCUMENT_STATUS_REJECTED,
};

export const RIDER_STATUS: Record<number, Rider["status"]> = {
  [RiderStatus.RIDER_STATUS_ONLINE]: "online",
  [RiderStatus.RIDER_STATUS_ON_JOB]: "onJob",
  [RiderStatus.RIDER_STATUS_OFFLINE]: "offline",
  [RiderStatus.RIDER_STATUS_SUSPENDED]: "suspended",
};
export const VEHICLE: Record<number, Rider["vehicle"]> = {
  [VehicleType.VEHICLE_TYPE_MOTORBIKE]: "motorbike",
  [VehicleType.VEHICLE_TYPE_TUK_TUK]: "tukTuk",
  [VehicleType.VEHICLE_TYPE_BICYCLE]: "bicycle",
};

export function toDoc(d: PartnerDocument): ReviewDoc {
  const status: ReviewDoc["status"] =
    d.status === DocumentStatus.DOCUMENT_STATUS_APPROVED ||
    d.status === DocumentStatus.DOCUMENT_STATUS_EXPIRING
      ? "approved"
      : d.status === DocumentStatus.DOCUMENT_STATUS_REJECTED ||
          d.status === DocumentStatus.DOCUMENT_STATUS_EXPIRED
        ? "rejected"
        : "pending";
  return {
    id: d.id,
    kind: d.name || d.kind,
    fileName: d.fileName,
    status,
    rejectReason:
      nonEmpty(d.rejectReason) ??
      (d.status === DocumentStatus.DOCUMENT_STATUS_EXPIRED ? "Expired" : undefined),
    expiresOn: nonEmpty(d.expiresOn),
    fields: d.fields.map((f) => ({ label: f.label, value: f.value })),
  };
}

export function toRestaurant(v: OutletAdminView): Restaurant {
  const o = v.outlet!;
  const st = o.status;
  const bank = o.bank?.bank ? `${o.bank.bank} ending ${o.bank.accountLast4}` : "Pending verification";
  const pausedByKitchen = !!st?.pausedUntil && st.pausedUntil.getTime() > Date.now();
  return {
    id: restaurantNumber(o.id),
    name: o.name,
    area: o.area,
    zoneId: o.zoneId,
    cuisine: v.cuisine,
    imageId: v.imageId,
    rating: Math.round(v.rating * 10) / 10,
    ordersWeek: v.ordersWeek,
    acceptanceRate: v.acceptanceRate,
    commission: o.commissionBps / 100,
    status: OUTLET_STATUS[st?.adminStatus ?? 0] ?? "open",
    statusReason: nonEmpty(st?.adminStatusReason),
    accepting: !!st?.accepting && !pausedByKitchen,
    waitingMinutes: v.waitingMinutes > 0 ? v.waitingMinutes : undefined,
    owner: v.owner?.name ?? "",
    phone: o.phone || v.owner?.phone || "",
    email: v.ownerEmail,
    joinedOn: isoDate(o.joinedAt),
    bank,
    etaMin: v.etaMinMinutes,
    hasOffer: v.hasOffer,
    category: v.categoryId,
  };
}

export function toRestaurantApplication(a: PartnerApplication): RestaurantApplication {
  return {
    id: a.id,
    name: a.business?.name ?? "",
    area: a.business?.area || a.business?.city || "",
    zoneId: a.zoneId,
    cuisine: a.business?.cuisine ?? "",
    owner: a.owner?.name ?? "",
    phone: a.owner?.phone ?? "",
    email: a.owner?.email ?? "",
    submittedAt: ms(a.submittedAt),
    status: APPLICATION_STATUS[a.status] ?? "pending",
    decisionNote: nonEmpty(a.decisionNote),
    documents: a.documents.map(toDoc),
  };
}

export function toRider(r: ProtoRider, zones: PricingZone[]): Rider {
  const zoneId = r.positionZoneId || r.zoneIds[0] || "";
  return {
    id: personId(r.id),
    name: r.name,
    phone: r.phone,
    vehicle: VEHICLE[r.vehicle?.type ?? 0] ?? "motorbike",
    status: RIDER_STATUS[r.status] ?? "offline",
    statusReason: nonEmpty(r.statusReason),
    zoneIds: r.zoneIds,
    rating: Math.round(r.rating * 10) / 10,
    acceptanceRate: r.acceptanceRate,
    cashHeld: rs(r.cashHeld),
    cashLimit: rs(r.cashLimit),
    tripsWeek: r.tripsWeek,
    joinedOn: isoDate(r.joinedAt),
    documents: r.documents.map(toDoc),
    pos: {
      zoneId,
      ...zonePosition(
        zones.find((z) => z.id === zoneId),
        r.position,
        r.id,
      ),
    },
  };
}

export function toRiderApplication(a: ProtoRiderApplication): RiderApplication {
  return {
    id: a.id,
    name: a.name,
    phone: a.phone,
    vehicle: VEHICLE[a.vehicle] ?? "motorbike",
    zoneIds: a.zoneIds,
    submittedAt: ms(a.submittedAt),
    status: APPLICATION_STATUS[a.status] ?? "pending",
    decisionNote: nonEmpty(a.decisionNote),
    documents: a.documents.map(toDoc),
  };
}

export function toZone(z: PricingZone): Zone {
  return {
    id: z.id,
    code: z.code,
    name: z.name,
    open: z.open,
    baseFee: rs(z.baseFee),
    perKm: rs(z.perKm),
    smallOrderFee: rs(z.smallOrderFee),
    smallOrderUnder: rs(z.smallOrderUnder),
    ridersNeeded: z.ridersNeeded,
  };
}
