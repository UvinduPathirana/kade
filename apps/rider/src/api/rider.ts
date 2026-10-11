// Rider service: profile, documents, trip history and ratings. Live: gateway-rider (dispatch,
// review). Mock: mock data plus trips completed in this browser.
import { liveFor } from "./config";
import * as live from "./live/rider";
import * as mock from "./mock/rider";
export { NotFoundError } from "./shared";

// The mock must answer exactly like the live service.
const impl: typeof live = liveFor("rider") ? live : mock;

export const { getProfile, listDocuments, listTrips, getTrip, getRatings } = impl;
