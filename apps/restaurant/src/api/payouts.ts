// Payouts API: daily sales and weekly statements. Live: gateway-merchant (ledger
// RestaurantFinanceService). Mock: generated from a fixed seed. Kadé keeps 18% commission on food
// sales; offers the restaurant funds come off the payout too. Payouts reach the bank every Tuesday
// for the Monday–Sunday week before.
import { liveFor } from "./config";
import * as live from "./live/payouts";
import * as mock from "./mock/payouts";
export { COMMISSION_RATE, addDays, grossOf, mondayOf, weekday } from "./shared";

// The mock must answer exactly like the live service.
const impl: typeof live = liveFor("payouts") ? live : mock;

export const { getSales, listStatements, statementCsv } = impl;
