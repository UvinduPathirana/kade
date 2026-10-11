// Dispatch service: offers jobs to riders one at a time and records each step of a delivery.
// Live: gateway-rider (dispatch DispatchService; offers polled, pushed over /ws when realtime runs).
// Mock (VITE_API_MODE=mock): offers from a small pool, every step kept in this browser.
import { liveFor } from "./config";
import * as live from "./live/dispatch";
import * as mock from "./mock/dispatch";
export {
  DispatchError,
  NoOfferError,
  OFFER_SECONDS,
  declineReasons,
  type CompleteDeliveryInput,
} from "./shared";

// The mock must answer exactly like the live service.
const impl: typeof live = liveFor("dispatch") ? live : mock;

export const {
  setAvailability,
  requestOffer,
  acceptOffer,
  declineOffer,
  getActiveJob,
  arriveAtRestaurant,
  reportNotReady,
  confirmPickup,
  arriveAtCustomer,
  completeDelivery,
  rateTrip,
  reportLocation,
} = impl;
