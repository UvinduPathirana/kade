import { invalidArgument } from "../platform/grpc/errors.js";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Seeded ids (CONVENTIONS "Seeded ids"): 00000000-0000-7000-<group>-<n zero-padded to 12 digits>. */
export function seededId(group: string, n: number): string {
  return `00000000-0000-7000-${group}-${String(n).padStart(12, "0")}`;
}

/** Restaurant N of the apps' mock catalogue → its outlet id (= catalog restaurant_id). */
export const outletIdOf = (n: number): string => seededId("8000", n);

/** Keycloak demo users (fixed ids in the realm import). */
export const KEYCLOAK_USERS = {
  ruwan: seededId("8005", 2),
  kasun: seededId("8005", 3),
} as const;

export const MINUTE = 60_000;

/** The kitchen has this long to accept a new ticket (the order workflow's timer is the authority). */
export const ACCEPT_WINDOW_MS = 3 * MINUTE;

export const BUSY_MODE_MINUTES = [0, 10, 20] as const;

/**
 * Normalises a Sri Lankan phone number to E.164 (+94XXXXXXXXX). Accepts "+94 77 312 4410",
 * "0773124410", "94773124410" and "773124410". Throws INVALID_ARGUMENT otherwise.
 */
export function normalisePhone(raw: string, field = "phone"): string {
  const digits = raw.replace(/[\s\-()]/g, "");
  let national: string | undefined;
  if (/^\+94\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^94\d{9}$/.test(digits)) national = digits.slice(2);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^[1-9]\d{8}$/.test(digits)) national = digits;
  if (!national) {
    throw invalidArgument("PHONE_INVALID", "Enter a Sri Lankan phone number, e.g. 077 123 4567.", { field });
  }
  return `+94${national}`;
}

/** "+94773124410" → "+94 77 312 4410" (how the apps print numbers). */
export function formatPhone(e164: string): string {
  const m = /^\+94(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+94 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** "KD-2417" → "2417": the number the kitchen calls out. */
export function ticketNumberOf(orderNumber: string, orderId: string): string {
  const digits = orderNumber.replace(/\D/g, "");
  return digits || orderId.replace(/-/g, "").slice(-4).toUpperCase();
}

export function firstName(name: string | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Areas the admin console knows, → zone slug (CONVENTIONS "Zone ids"). pricing.ResolveZone is the authority. */
const AREA_ZONES: Record<string, string> = {
  fort: "c01",
  pettah: "c01",
  "galle face": "c01",
  "colombo 01": "c01",
  "slave island": "c02",
  "colombo 02": "c02",
  kollupitiya: "c03",
  "colombo 03": "c03",
  bambalapitiya: "c04",
  "colombo 04": "c04",
  "havelock town": "c05",
  narahenpita: "c05",
  "colombo 05": "c05",
  wellawatte: "c06",
  "colombo 06": "c06",
  "cinnamon gardens": "c07",
  "colombo 07": "c07",
  borella: "c08",
  "colombo 08": "c08",
  dematagoda: "c09",
  "colombo 09": "c09",
  maradana: "c10",
  "colombo 10": "c10",
  "colombo 11": "c11",
  "colombo 12": "c12",
  kotahena: "c13",
  "colombo 13": "c13",
  grandpass: "c14",
  "colombo 14": "c14",
  mattakkuliya: "c15",
  "colombo 15": "c15",
  dehiwala: "deh",
  rajagiriya: "raj",
  nugegoda: "nug",
  "mount lavinia": "mtl",
};

export function zoneForArea(area: string, city = ""): string {
  return AREA_ZONES[area.trim().toLowerCase()] ?? AREA_ZONES[city.trim().toLowerCase()] ?? "";
}
