// Mock outlet service (VITE_API_MODE=mock): opening hours, special closures, pause and busy mode in
// localStorage. Live: merchant + catalog via gateway-merchant.
import { latency, readJson, writeJson } from "../storage";
import type { Closure, DayHours, Outlet, OutletStatus } from "../types";

const KEY = "kade.partner.outlet.v1";

const lateNight = [{ open: "11:00", close: "02:00" }];

const seed = (): Outlet => ({
  name: "Galle Road Kottu House",
  area: "Kollupitiya",
  address: "312 Galle Road, Colombo 03",
  phone: "+94 11 257 4410",
  status: { busyExtra: 0, pausedUntil: null },
  hours: [
    { day: "mon", isOpen: true, ranges: lateNight },
    { day: "tue", isOpen: true, ranges: lateNight },
    { day: "wed", isOpen: true, ranges: lateNight },
    { day: "thu", isOpen: true, ranges: lateNight },
    { day: "fri", isOpen: true, ranges: [{ open: "11:00", close: "03:00" }] },
    { day: "sat", isOpen: true, ranges: [{ open: "11:00", close: "03:00" }] },
    {
      day: "sun",
      isOpen: true,
      ranges: [
        { open: "11:00", close: "15:00" },
        { open: "18:00", close: "02:00" },
      ],
    },
  ],
  // Full-moon Poya days: many kitchens close or serve a short menu.
  closures: [
    { id: "c1", date: "2026-10-26", reason: "Vap Poya" },
    { id: "c2", date: "2026-11-24", reason: "Il Poya" },
    { id: "c3", date: "2026-12-23", reason: "Unduvap Poya" },
  ],
});

const read = () => readJson<Outlet>(KEY, seed);

function save(change: (o: Outlet) => void): Outlet {
  const outlet = read();
  change(outlet);
  writeJson(KEY, outlet);
  return structuredClone(outlet);
}

export async function getOutlet(): Promise<Outlet> {
  await latency(100);
  return structuredClone(read());
}

/** Synchronous read for the order simulation: no orders arrive while the outlet is paused. */
export const readStatusNow = (): OutletStatus => read().status;

export async function setBusy(busyExtra: OutletStatus["busyExtra"]): Promise<Outlet> {
  await latency(100);
  return save((o) => {
    o.status.busyExtra = busyExtra;
  });
}

/** Pause new orders until `until`; null resumes now. */
export async function setPause(until: number | null): Promise<Outlet> {
  await latency(150);
  return save((o) => {
    o.status.pausedUntil = until;
  });
}

export async function saveHours(hours: DayHours[]): Promise<Outlet> {
  await latency();
  return save((o) => {
    o.hours = hours;
  });
}

export async function addClosure(closure: Omit<Closure, "id">): Promise<Outlet> {
  await latency();
  return save((o) => {
    o.closures = [...o.closures, { ...closure, id: `c-${Date.now().toString(36)}` }].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  });
}

export async function removeClosure(id: string): Promise<Outlet> {
  await latency();
  return save((o) => {
    o.closures = o.closures.filter((c) => c.id !== id);
  });
}

export async function saveDetails(details: Pick<Outlet, "name" | "address" | "phone">): Promise<Outlet> {
  await latency();
  return save((o) => Object.assign(o, details));
}
