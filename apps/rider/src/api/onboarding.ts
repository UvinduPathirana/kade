// Rider onboarding: applications, documents and review. Live: gateway-rider (dispatch
// RiderService; ops review in the admin console). Mock: localStorage, the review moving on by itself.
import { liveFor } from "./config";
import * as live from "./live/onboarding";
import * as mock from "./mock/onboarding";
export type { ApplicationInput, ApplicationStatus, DocKey } from "./shared";

// The mock must answer exactly like the live service.
const impl: typeof live = liveFor("onboarding") ? live : mock;

export const { submitApplication, getApplicationStatus, resubmitDocument, clearApplication } = impl;
