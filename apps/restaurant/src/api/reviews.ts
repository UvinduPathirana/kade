// Reviews API. Live: gateway-merchant (review service). Mock: localStorage. One public reply per
// review, editable.
import { liveFor } from "./config";
import * as live from "./live/reviews";
import * as mock from "./mock/reviews";

// The mock must answer exactly like the live service.
const impl: typeof live = liveFor("reviews") ? live : mock;

export const { listReviews, replyToReview } = impl;
