// Kitchen orders API: the order board and its actions. Live: gateway-merchant (merchant
// KitchenService, tickets projected from order events). Mock (VITE_API_MODE=mock): a simulated
// evening in localStorage where a new order arrives every 40–60 seconds.
import { liveFor } from "./config";
import * as live from "./live/orders";
import * as mock from "./mock/orders";
export { ACCEPT_WINDOW_MS, itemCount, rejectReasons, riderState, type RiderState } from "./shared";

// The mock must answer exactly like the live service.
const impl: typeof live = liveFor("orders") ? live : mock;

export const { listTickets, getTicket, acceptTicket, rejectTicket, markReady, handOver } = impl;
