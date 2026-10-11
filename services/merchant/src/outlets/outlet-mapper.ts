import {
  OutletSettings,
  PaperWidth,
  type Outlet,
  type OutletAdminView,
  type OutletStatus,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import type { SettingsJson } from "../db/schema.js";
import { adminStatus } from "../domain/enums.js";
import { MINUTE } from "../domain/values.js";
import type { OutletRow, OutletStats } from "./outlets.repository.js";

/** A tablet that hasn't sent a heartbeat for this long stops "accepting" (ops attention item). */
export const TABLET_SILENT_MS = 5 * MINUTE;

/** Pause is in force. */
export function isPaused(row: Pick<OutletRow, "pausedUntil">, now: Date): boolean {
  return !!row.pausedUntil && row.pausedUntil.getTime() > now.getTime();
}

/** Tablet online: never reported (no tablet tracking yet) or reported recently. */
export function tabletOnline(row: Pick<OutletRow, "lastHeartbeatAt">, now: Date): boolean {
  return !row.lastHeartbeatAt || now.getTime() - row.lastHeartbeatAt.getTime() <= TABLET_SILENT_MS;
}

/** Open to ops, not paused by the kitchen and the tablet is online. */
export function computeAccepting(
  row: Pick<OutletRow, "adminStatus" | "pausedUntil" | "lastHeartbeatAt">,
  now: Date,
): boolean {
  return row.adminStatus === "open" && !isPaused(row, now) && tabletOnline(row, now);
}

export function toOutletStatus(row: OutletRow, now: Date): OutletStatus {
  return {
    busyExtraMinutes: row.busyExtraMinutes,
    pausedUntil: isPaused(row, now) ? row.pausedUntil! : undefined,
    adminStatus: adminStatus.toProto(row.adminStatus),
    adminStatusReason: row.adminStatusReason,
    accepting: computeAccepting(row, now),
    lastHeartbeatAt: row.lastHeartbeatAt ?? undefined,
  };
}

/** True when two statuses differ in anything a consumer cares about (heartbeat time excluded). */
export function statusChanged(a: OutletStatus, b: OutletStatus): boolean {
  return (
    a.busyExtraMinutes !== b.busyExtraMinutes ||
    (a.pausedUntil?.getTime() ?? 0) !== (b.pausedUntil?.getTime() ?? 0) ||
    a.adminStatus !== b.adminStatus ||
    a.adminStatusReason !== b.adminStatusReason ||
    a.accepting !== b.accepting
  );
}

export function toOutlet(row: OutletRow, now: Date): Outlet {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    address: row.address,
    phone: row.phone,
    zoneId: row.zoneId,
    status: toOutletStatus(row, now),
    commissionBps: row.commissionBps,
    joinedAt: row.joinedAt,
    bank: row.bank
      ? {
          bank: row.bank.bank,
          branch: row.bank.branch,
          accountName: row.bank.accountName,
          accountNumber: "",
          accountLast4: row.bank.accountLast4,
        }
      : undefined,
  };
}

export function toAdminView(row: OutletRow, stats: OutletStats | undefined, now: Date): OutletAdminView {
  // Real history wins once there is any; until then the onboarding/seed figures are shown.
  const acceptanceRate =
    stats && stats.decided > 0
      ? Math.round((stats.accepted / stats.decided) * 100) / 100
      : row.baseAcceptanceRate;
  const waitingMs = stats?.oldestWaitingSince ? now.getTime() - stats.oldestWaitingSince.getTime() : 0;
  return {
    outlet: toOutlet(row, now),
    cuisine: row.cuisine,
    categoryId: row.categoryId,
    imageId: row.imageId,
    rating: row.rating,
    ordersWeek: row.baseOrdersWeek + (stats?.ordersWeek ?? 0),
    acceptanceRate,
    // Only worth flagging once an order has waited a couple of minutes.
    waitingMinutes: waitingMs >= 2 * MINUTE ? Math.floor(waitingMs / MINUTE) : 0,
    owner: { id: "", name: row.ownerName, phone: row.ownerPhone },
    ownerEmail: row.ownerEmail,
    etaMinMinutes: row.etaMinMinutes,
    hasOffer: row.hasOffer,
  };
}

export const DEFAULT_SETTINGS: OutletSettings = {
  devices: { autoPrint: true, printerName: "", paperWidth: PaperWidth.PAPER_WIDTH_80MM, copies: 1 },
  notifications: { smsPaused: false, emailStatements: true, newReviews: true, lowRatings: true },
};

export function settingsFromJson(json: SettingsJson | null | undefined): OutletSettings {
  const s = OutletSettings.fromJSON(json ?? {});
  return {
    devices: { ...DEFAULT_SETTINGS.devices!, ...s.devices },
    notifications: { ...DEFAULT_SETTINGS.notifications!, ...s.notifications },
  };
}

export function settingsToJson(settings: OutletSettings): SettingsJson {
  return OutletSettings.toJSON(settings) as SettingsJson;
}
