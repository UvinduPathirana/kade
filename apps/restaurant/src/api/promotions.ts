// Promotions API. Live: gateway-merchant (promotion OfferService). Mock: localStorage. The
// restaurant funds its own offers: discounts come off the weekly payout, and an offer stops by
// itself when its budget is spent.
import { liveFor } from "./config";
import * as live from "./live/promotions";
import * as mock from "./mock/promotions";
export { offerState, todayIso, type OfferState } from "./shared";

// The mock must answer exactly like the live service.
const impl: typeof live = liveFor("promotions") ? live : mock;

export const { listOffers, createOffer, endOffer } = impl;
