// Outlet API: opening hours, special closures, pause and busy mode. Live: gateway-merchant
// (merchant OutletService + catalog hours). Mock: localStorage. The customer app reads the same
// status: paused or closed outlets show "Opens at …" in the feed.
import { liveFor } from "./config";
import * as live from "./live/outlet";
import * as mock from "./mock/outlet";
export { isPaused } from "./shared";

// The mock must answer exactly like the live service.
const impl: typeof live = liveFor("outlet") ? live : mock;

export const { getOutlet, setBusy, setPause, saveHours, addClosure, removeClosure, saveDetails } = impl;
