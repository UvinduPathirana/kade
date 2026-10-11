// Id translation between services (UUIDs) and the console (CONVENTIONS "Seeded ids").
//
// - Restaurants are numbers in the console. Seeded outlets are `00000000-0000-7000-8000-<N, 12 digits>`
//   and become N. Any other outlet UUID gets a stable number above 10^12, remembered here so the
//   console can send it back.
// - People ids: seeded riders (8001), customers (8002) and Keycloak users (8005) read as R-101,
//   C-2040 and U-5, which is what staff quote to each other. Everything else passes through.
// - Orders: the console's order id is the human order number (KD-4821); the gateway looks up the
//   UUID with order.GetOrder(order_number) when it needs it.

const SEEDED = /^00000000-0000-7000-(8\d{3})-(\d{12})$/;
const seeded = (group: string, n: number) => `00000000-0000-7000-${group}-${String(n).padStart(12, "0")}`;

const BIG = 1_000_000_000_000;
const restaurantUuids = new Map<number, string>();

export function restaurantNumber(uuid: string): number {
  if (!uuid) return 0;
  const m = SEEDED.exec(uuid);
  if (m && m[1] === "8000") return parseInt(m[2]!, 10);
  if (/^\d+$/.test(uuid)) return parseInt(uuid, 10);
  // 44 bits of the UUID's random tail keep the number a safe integer.
  const n = BIG + parseInt(uuid.replace(/-/g, "").slice(-11), 16);
  restaurantUuids.set(n, uuid);
  return n;
}

export function restaurantUuid(n: number): string {
  if (n < BIG) return seeded("8000", n);
  const uuid = restaurantUuids.get(n);
  if (!uuid) throw new UnknownIdError(`Restaurant ${n}`);
  return uuid;
}

export class UnknownIdError extends Error {
  override name = "UnknownIdError";
}

// 8006: staff records without a Keycloak login (seeded team members).
const PERSON_PREFIX: Record<string, string> = { "8001": "R", "8002": "C", "8005": "U", "8006": "S" };
const PERSON_GROUP: Record<string, string> = { R: "8001", C: "8002", U: "8005", S: "8006" };

/** Rider, customer or staff UUID → the console's id (R-101, C-2040, U-5, or the UUID itself). */
export function personId(uuid: string | undefined): string {
  if (!uuid) return "";
  const m = SEEDED.exec(uuid);
  const prefix = m && PERSON_PREFIX[m[1]!];
  return prefix ? `${prefix}-${parseInt(m[2]!, 10)}` : uuid;
}

/** The console's person id → UUID (inverse of personId). */
export function personUuid(id: string): string {
  const m = /^([RCUS])-(\d{1,12})$/.exec(id);
  return m ? seeded(PERSON_GROUP[m[1]!]!, parseInt(m[2]!, 10)) : id;
}

/** Audit record ids are stored as service ids (UUIDs); the console shows its own ids. */
export function auditRecordToService(type: string, id: string): string {
  if (type === "restaurant" && /^\d+$/.test(id)) {
    try {
      return restaurantUuid(Number(id));
    } catch {
      return id;
    }
  }
  if (type === "rider" || type === "customer" || type === "team") return personUuid(id);
  return id;
}

export function auditRecordToConsole(type: string, id: string): string {
  if (type === "restaurant" && SEEDED.test(id)) return String(restaurantNumber(id));
  if (type === "rider" || type === "customer" || type === "team") return personId(id);
  return id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);
