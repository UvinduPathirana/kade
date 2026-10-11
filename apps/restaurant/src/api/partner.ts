// Partner API: staff, devices, notifications and onboarding. Live: gateway-merchant (merchant
// OutletStaffService, OutletService, PartnerApplicationService). Mock: localStorage.
import { liveFor } from "./config";
import * as live from "./live/partner";
import * as mock from "./mock/partner";
export { roleDescriptions, roleLabels } from "./shared";

// The mock must answer exactly like the live service.
const impl: typeof live = liveFor("partner") ? live : mock;

export const {
  listStaff,
  inviteStaff,
  changeRole,
  removeStaff,
  getSettings,
  saveSettings,
  printTestTicket,
  submitApplication,
  getApplication,
} = impl;
