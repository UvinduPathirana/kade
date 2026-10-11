// Mock rider onboarding (VITE_API_MODE=mock): the application persisted in localStorage, its review
// moving on with time. Live: dispatch RiderService via gateway-rider.
import { latency } from "./rider";
import type { ApplicationInput, ApplicationStatus, DocKey } from "../shared";
import type { VehicleType } from "../types";

const KEY = "kade.rider.application.v1";

interface StoredApplication {
  id: string;
  submittedAt: number;
  vehicle: VehicleType;
  firstName: string;
  /** Set when the rider re-uploads the document the reviewer asked about. */
  fixedAt?: number;
}

/** Demo timeline, seconds: the reviewer flags one document, then approves once it's fixed. */
const REVIEW_SECONDS = 20;
const RECHECK_SECONDS = 15;

const read = (): StoredApplication | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as StoredApplication | null;
  } catch {
    return null;
  }
};

/** Which document the reviewer flags depends on the vehicle (bicycles have no revenue licence). */
function flagged(vehicle: VehicleType): { doc: DocKey; docName: string; reason: string } {
  return vehicle === "bicycle"
    ? {
        doc: "nicBack",
        docName: "NIC (back)",
        reason: "Light glare covers the address on the back of your NIC. Take it again away from the window.",
      }
    : {
        doc: "revenue",
        docName: "Revenue licence",
        reason:
          "The expiry date on your revenue licence is blurred. Upload a sharper photo with the whole licence in frame.",
      };
}

export async function submitApplication(input: ApplicationInput): Promise<ApplicationStatus> {
  await latency(500);
  const app: StoredApplication = {
    id: `RA-${Math.floor(10_000 + Math.random() * 89_999)}`,
    submittedAt: Date.now(),
    vehicle: input.vehicle,
    firstName: input.name.trim().split(/\s+/)[0] ?? "",
  };
  localStorage.setItem(KEY, JSON.stringify(app));
  return statusOf(app);
}

function statusOf(app: StoredApplication | null, now = Date.now()): ApplicationStatus {
  if (!app) return { state: "none" };
  const base = { id: app.id, firstName: app.firstName };
  if (app.fixedAt) {
    return (now - app.fixedAt) / 1000 < RECHECK_SECONDS
      ? { state: "inReview", submittedAt: app.fixedAt, ...base }
      : { state: "approved", ...base };
  }
  return (now - app.submittedAt) / 1000 < REVIEW_SECONDS
    ? { state: "inReview", submittedAt: app.submittedAt, ...base }
    : { state: "needsFix", ...flagged(app.vehicle), ...base };
}

export async function getApplicationStatus(): Promise<ApplicationStatus> {
  await latency(150);
  return statusOf(read());
}

export async function resubmitDocument(_input: {
  doc: DocKey;
  fileName: string;
}): Promise<ApplicationStatus> {
  void _input;
  await latency(400);
  const app = read();
  if (!app) return { state: "none" };
  const next = { ...app, fixedAt: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(next));
  return statusOf(next);
}

export function clearApplication() {
  localStorage.removeItem(KEY);
}
