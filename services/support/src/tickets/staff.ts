/**
 * Display names for agents, by user id. Kadé staff are seeded with ids in group 8006 (admin mock
 * S-N → N) and the Keycloak demo users in group 8005 (docs/backend/CONVENTIONS.md, "Seeded ids").
 * Unknown ids fall back to the name the caller sent, then to "Kadé support".
 */
const id = (group: string, n: number): string => `00000000-0000-7000-${group}-${String(n).padStart(12, "0")}`;

export const STAFF_NAMES: Record<string, string> = {
  [id("8006", 1)]: "Dilini Perera",
  [id("8006", 2)]: "Kasun Wickramasinghe",
  [id("8006", 3)]: "Hasini Fernando",
  [id("8006", 4)]: "Ruwani Silva",
  [id("8006", 5)]: "Imran Lafir",
  [id("8006", 6)]: "Tharushi Jayawardena",
  [id("8006", 7)]: "Nalin Gunasekara",
  [id("8006", 8)]: "Shalini Rajaratnam",
  [id("8005", 5)]: "Ops Desk",
  [id("8005", 6)]: "Finance Desk",
  [id("8005", 7)]: "Support Desk",
  [id("8005", 8)]: "Platform Admin",
};

export const staffId = (n: number): string => id("8006", n);

export function staffName(userId: string | undefined, fallback?: string): string {
  return (userId && STAFF_NAMES[userId]) || fallback?.trim() || "Kadé support";
}

/** "Dilini" from "Dilini Perera", for system messages ("Assigned by Dilini."). */
export function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
