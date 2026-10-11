// Payouts: earnings, quests, cash held and weekly bank transfers. Live: gateway-rider (ledger,
// dispatch quests). Mock: computed from mock history plus trips completed in this browser.
import { liveFor } from "./config";
import * as live from "./live/payouts";
import * as mock from "./mock/payouts";
export { depositPoints } from "./shared";

// The mock must answer exactly like the live service.
const impl: typeof live = liveFor("payouts") ? live : mock;

export const { getEarnings, getTodaySummary, getQuests, getCashBalance, listPayouts } = impl;
