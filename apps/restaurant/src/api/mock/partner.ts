// Mock partner service (VITE_API_MODE=mock): staff, devices, notifications and onboarding kept in
// localStorage. The live one is merchant behind gateway-merchant (see ../partner.ts).
import { latency, readJson, ServiceError, writeJson } from "../storage";
import type {
  PartnerApplication,
  PartnerSettings,
  StaffMember,
  StaffRole,
  SubmittedApplication,
} from "../types";

const STAFF_KEY = "kade.partner.staff.v1";
const SETTINGS_KEY = "kade.partner.settings.v1";
const APPLICATION_KEY = "kade.partner.application.v1";

const HOUR = 3_600_000;

const seedStaff = (): StaffMember[] => [
  {
    id: "u1",
    name: "Mohamed Rizvi",
    phone: "+94 77 312 4410",
    role: "owner",
    lastActive: Date.now() - 2 * HOUR,
  },
  {
    id: "u2",
    name: "Chathuri Perera",
    phone: "+94 71 845 2290",
    role: "manager",
    lastActive: Date.now() - 20 * 60_000,
  },
  {
    id: "u3",
    name: "Saman Kumara",
    phone: "+94 76 220 9184",
    role: "kitchen",
    lastActive: Date.now() - 5 * 60_000,
  },
  {
    id: "u4",
    name: "Ashan Silva",
    phone: "+94 70 455 6312",
    role: "kitchen",
    lastActive: Date.now() - 26 * HOUR,
  },
  { id: "u5", name: "Nadeesha Fernando", phone: "+94 75 901 3378", role: "kitchen", lastActive: null },
];

const seedSettings = (): PartnerSettings => ({
  devices: { autoPrint: true, printerName: "Kitchen printer (Epson TM-T82)", paperWidth: "80", copies: 1 },
  notifications: { smsPaused: true, emailStatements: true, newReviews: false, lowRatings: true },
});

export async function listStaff(): Promise<StaffMember[]> {
  await latency(150);
  return structuredClone(readJson(STAFF_KEY, seedStaff));
}

/** Sends an SMS invite with a sign-in link. They show as pending until they first sign in. */
export async function inviteStaff(input: Pick<StaffMember, "name" | "phone" | "role">): Promise<StaffMember> {
  await latency();
  const all = readJson(STAFF_KEY, seedStaff);
  if (all.some((s) => s.phone.replace(/\s/g, "") === input.phone.replace(/\s/g, "")))
    throw new ServiceError("Someone with this number is already on your team.");
  const member: StaffMember = { ...input, id: `u-${Date.now().toString(36)}`, lastActive: null };
  writeJson(STAFF_KEY, [...all, member]);
  return member;
}

export async function changeRole({ id, role }: { id: string; role: StaffRole }): Promise<StaffMember[]> {
  await latency(150);
  const all = readJson(STAFF_KEY, seedStaff).map((s) => (s.id === id ? { ...s, role } : s));
  if (!all.some((s) => s.role === "owner")) throw new ServiceError("Your team needs at least one owner.");
  writeJson(STAFF_KEY, all);
  return all;
}

export async function removeStaff(id: string): Promise<StaffMember[]> {
  await latency();
  const all = readJson(STAFF_KEY, seedStaff).filter((s) => s.id !== id);
  writeJson(STAFF_KEY, all);
  return all;
}

export async function getSettings(): Promise<PartnerSettings> {
  await latency(100);
  return structuredClone(readJson(SETTINGS_KEY, seedSettings));
}

export async function saveSettings(settings: PartnerSettings): Promise<PartnerSettings> {
  await latency(150);
  writeJson(SETTINGS_KEY, settings);
  return settings;
}

/** Print service: sends a sample ticket to the paired printer. */
export async function printTestTicket(): Promise<string> {
  await latency(600);
  return readJson(SETTINGS_KEY, seedSettings).devices.printerName;
}

// ---------- Onboarding ----------

export async function submitApplication(app: PartnerApplication): Promise<SubmittedApplication> {
  await latency(700);
  const submitted: SubmittedApplication = {
    reference: `KP-${Math.floor(100000 + Math.random() * 900000)}`,
    submittedAt: Date.now(),
    businessName: app.business.name,
    phone: app.owner.phone,
  };
  writeJson(APPLICATION_KEY, submitted);
  return submitted;
}

export async function getApplication(): Promise<SubmittedApplication | null> {
  await latency(100);
  return readJson<SubmittedApplication | null>(APPLICATION_KEY, () => null);
}
