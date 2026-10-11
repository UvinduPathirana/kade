// Support: help topics and the rider support chat. Live: gateway-rider (support service; quick
// replies to customers through dispatch). Mock: canned replies.
import { liveFor } from "./config";
import * as live from "./live/support";
import * as mock from "./mock/support";
export { supportPhone } from "./mock/data";

// The mock must answer exactly like the live service.
const impl: typeof live = liveFor("support") ? live : mock;

export const { listHelpTopics, sendSupportMessage, messageCustomer } = impl;
