// Rider sign-up over gateway-rider (dispatch RiderService). The applicant has no account yet, so the
// application id and phone are kept on this device and the status is looked up by phone.
import { enc, get, post } from "../http";
import type { ApplicationInput, ApplicationStatus, DocKey } from "../shared";

const KEY = "kade.rider.application.live.v1";

interface Stored {
  id: string;
  phone: string;
}

const read = (): Stored | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as Stored | null;
  } catch {
    return null;
  }
};

export async function submitApplication(input: ApplicationInput): Promise<ApplicationStatus> {
  const status = await post<ApplicationStatus>("/v1/applications", input, { anonymous: true });
  if (status.state !== "none")
    localStorage.setItem(KEY, JSON.stringify({ id: status.id, phone: input.phone }));
  return status;
}

export async function getApplicationStatus(): Promise<ApplicationStatus> {
  const stored = read();
  if (!stored) return { state: "none" };
  return get<ApplicationStatus>(`/v1/applications/status?phone=${enc(stored.phone)}`, { anonymous: true });
}

export async function resubmitDocument(input: { doc: DocKey; fileName: string }): Promise<ApplicationStatus> {
  const stored = read();
  if (!stored) return { state: "none" };
  return post<ApplicationStatus>(`/v1/applications/${enc(stored.id)}/documents`, input, { anonymous: true });
}

export function clearApplication() {
  localStorage.removeItem(KEY);
}
