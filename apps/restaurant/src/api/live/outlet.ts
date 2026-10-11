// Outlet status (merchant), details, hours and closures (catalog) over gateway-merchant.
import { del, enc, get, post, put } from "../http";
import type { Closure, DayHours, Outlet, OutletStatus } from "../types";

export const getOutlet = () => get<Outlet>("/v1/outlet");

export const setBusy = (busyExtra: OutletStatus["busyExtra"]) =>
  put<Outlet>("/v1/outlet/busy", { busyExtra });

export const setPause = (until: number | null) => put<Outlet>("/v1/outlet/pause", { until });

export const saveHours = (hours: DayHours[]) => put<Outlet>("/v1/outlet/hours", { hours });

export const addClosure = (closure: Omit<Closure, "id">) => post<Outlet>("/v1/outlet/closures", closure);

export const removeClosure = (id: string) => del<Outlet>(`/v1/outlet/closures/${enc(id)}`);

export const saveDetails = (details: Pick<Outlet, "name" | "address" | "phone">) =>
  put<Outlet>("/v1/outlet/details", details);
