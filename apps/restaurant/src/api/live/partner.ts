// Staff and tablet settings (merchant) over gateway-merchant, plus the public partner application.
import { readJson, writeJson } from "../storage";
import { del, enc, get, post, put } from "../http";
import type {
  PartnerApplication,
  PartnerSettings,
  StaffMember,
  StaffRole,
  SubmittedApplication,
} from "../types";

export const listStaff = () => get<StaffMember[]>("/v1/staff");

export const inviteStaff = (input: Pick<StaffMember, "name" | "phone" | "role">) =>
  post<StaffMember>("/v1/staff", input);

export const changeRole = ({ id, role }: { id: string; role: StaffRole }) =>
  put<StaffMember[]>(`/v1/staff/${enc(id)}/role`, { role });

export const removeStaff = (id: string) => del<StaffMember[]>(`/v1/staff/${enc(id)}`);

export const getSettings = () => get<PartnerSettings>("/v1/settings");

export const saveSettings = (settings: PartnerSettings) => put<PartnerSettings>("/v1/settings", settings);

/** Sends a sample ticket to the paired printer; resolves with the printer's name. */
export async function printTestTicket(): Promise<string> {
  const res = await post<{ printerName: string; message: string }>("/v1/settings/print-test");
  return res.printerName || res.message;
}

// The applicant has no account yet: the receipt is kept on this device, as the mock did.
const APPLICATION_KEY = "kade.partner.application.live.v1";

export async function submitApplication(app: PartnerApplication): Promise<SubmittedApplication> {
  const submitted = await post<SubmittedApplication>("/v1/applications", app, { anonymous: true });
  writeJson(APPLICATION_KEY, submitted);
  return submitted;
}

export async function getApplication(): Promise<SubmittedApplication | null> {
  return readJson<SubmittedApplication | null>(APPLICATION_KEY, () => null);
}
