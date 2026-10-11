import { OutletAdminStatus } from "@kade/proto/kade/merchant/v1/merchant_service";
import { describe, expect, it } from "vitest";
import { computeAccepting, statusChanged, toAdminView, toOutletStatus } from "./outlet-mapper.js";
import type { OutletRow } from "./outlets.repository.js";

const now = new Date("2026-10-12T19:00:00Z");
const min = (m: number) => new Date(now.getTime() + m * 60_000);

function row(over: Partial<OutletRow> = {}): OutletRow {
  return {
    id: "o1",
    name: "Galle Road Kottu House",
    adminStatus: "open",
    adminStatusReason: "",
    busyExtraMinutes: 0,
    pausedUntil: null,
    lastHeartbeatAt: null,
    accepting: true,
    commissionBps: 1800,
    bank: null,
    rating: 4.8,
    baseOrdersWeek: 300,
    baseAcceptanceRate: 0.95,
    ownerName: "Mohamed Rizwan",
    ownerPhone: "+94773124410",
    ...over,
  } as OutletRow;
}

describe("computeAccepting", () => {
  it("is true when open, not paused and the tablet is online (or never reported)", () => {
    expect(computeAccepting(row(), now)).toBe(true);
    expect(computeAccepting(row({ lastHeartbeatAt: min(-1) }), now)).toBe(true);
  });

  it.each([
    ["paused by the kitchen", { pausedUntil: min(30) }],
    ["suspended by ops", { adminStatus: "suspended" }],
    ["closed by ops", { adminStatus: "closed" }],
    ["tablet silent", { lastHeartbeatAt: min(-6) }],
  ])("is false when %s", (_label, over) => {
    expect(computeAccepting(row(over as Partial<OutletRow>), now)).toBe(false);
  });

  it("ignores a pause that has ended", () => {
    expect(computeAccepting(row({ pausedUntil: min(-1) }), now)).toBe(true);
    expect(toOutletStatus(row({ pausedUntil: min(-1) }), now).pausedUntil).toBeUndefined();
  });
});

describe("statusChanged", () => {
  it("ignores heartbeat time, notices busy/pause/status/accepting", () => {
    const a = toOutletStatus(row({ lastHeartbeatAt: min(-1) }), now);
    expect(statusChanged(a, toOutletStatus(row({ lastHeartbeatAt: now }), now))).toBe(false);
    expect(statusChanged(a, toOutletStatus(row({ busyExtraMinutes: 10 }), now))).toBe(true);
    expect(statusChanged(a, toOutletStatus(row({ pausedUntil: min(15) }), now))).toBe(true);
    const suspended = toOutletStatus(row({ adminStatus: "suspended", adminStatusReason: "Hygiene" }), now);
    expect(suspended).toMatchObject({
      adminStatus: OutletAdminStatus.OUTLET_ADMIN_STATUS_SUSPENDED,
      accepting: false,
    });
    expect(statusChanged(a, suspended)).toBe(true);
  });
});

describe("toAdminView", () => {
  it("uses seed figures until there is real history, then real acceptance", () => {
    expect(toAdminView(row(), undefined, now)).toMatchObject({
      ordersWeek: 300,
      acceptanceRate: 0.95,
      waitingMinutes: 0,
    });
    const v = toAdminView(
      row(),
      { ordersWeek: 4, decided: 4, accepted: 3, oldestWaitingSince: min(-5) },
      now,
    );
    expect(v).toMatchObject({
      ordersWeek: 304,
      acceptanceRate: 0.75,
      waitingMinutes: 5,
      owner: { name: "Mohamed Rizwan" },
    });
  });
});
