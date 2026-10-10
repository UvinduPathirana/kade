// Address API. Saved addresses will live with the customer service (GET/POST /me/addresses); place search
// and the delivery-zone check will call the location service. Today: mock places, saved addresses in localStorage.
import type { Place, SavedAddress } from "./types";

const KEY = "kade.addresses.v1";
const WAITLIST_KEY = "kade.waitlist.v1";

/** Where Kadé delivers today. Written once so every screen says the same thing. */
export const DELIVERY_ZONE = "Colombo 01 to 15 and Dehiwala";

export const defaultAddresses: SavedAddress[] = [
  {
    id: "home",
    label: "Home",
    line: "42 Galle Rd, Colombo 03",
    area: "Kollupitiya",
    note: "Green gate next to the pharmacy",
    pin: { x: 352, y: 500 },
  },
  {
    id: "work",
    label: "Work",
    line: "18 Bauddhaloka Mawatha, Colombo 07",
    area: "Cinnamon Gardens",
    note: "Leave it at reception, 3rd floor",
    pin: { x: 566, y: 640 },
  },
];

/* Pins are positions on the illustrated map in features/address/PinMap (1000 × 1400 units, north up). */
const places: Place[] = [
  ["galle-face", "Galle Face Green", "Colombo 03", "Galle Face", 300, 250],
  ["one-galle-face", "One Galle Face", "Fort, Colombo 02", "Fort", 306, 196],
  ["dutch-hospital", "Dutch Hospital", "Fort, Colombo 01", "Fort", 338, 122],
  ["pettah-market", "Pettah Market", "Pettah, Colombo 11", "Pettah", 404, 82],
  ["kotahena", "Kotahena", "Colombo 13", "Kotahena", 470, 34],
  ["slave-island", "Slave Island", "Colombo 02", "Slave Island", 430, 330],
  ["liberty-plaza", "Liberty Plaza", "Kollupitiya, Colombo 03", "Kollupitiya", 412, 520],
  ["duplication-rd", "Duplication Rd", "Kollupitiya, Colombo 03", "Kollupitiya", 452, 560],
  ["vmd-park", "Viharamahadevi Park", "Cinnamon Gardens, Colombo 07", "Cinnamon Gardens", 560, 470],
  ["independence-sq", "Independence Square", "Cinnamon Gardens, Colombo 07", "Cinnamon Gardens", 616, 604],
  ["racecourse", "Racecourse", "Cinnamon Gardens, Colombo 07", "Cinnamon Gardens", 652, 700],
  ["borella", "Borella Junction", "Borella, Colombo 08", "Borella", 724, 430],
  ["majestic-city", "Majestic City", "Bambalapitiya, Colombo 04", "Bambalapitiya", 364, 742],
  ["havelock-town", "Havelock Rd", "Havelock Town, Colombo 05", "Havelock Town", 522, 862],
  ["narahenpita", "Narahenpita Junction", "Colombo 05", "Narahenpita", 742, 784],
  ["savoy", "Savoy Cinema", "Wellawatte, Colombo 06", "Wellawatte", 372, 982],
  ["marine-drive", "Marine Drive", "Wellawatte, Colombo 06", "Wellawatte", 318, 1010],
  ["dehiwala-junction", "Dehiwala Junction", "Dehiwala", "Dehiwala", 392, 1236],
  ["dehiwala-zoo", "Dehiwala Zoo", "Dehiwala", "Dehiwala", 540, 1262],
]
  .map(([id, name, detail, area, x, y]): Place => ({
    id: id as string,
    name: name as string,
    detail: detail as string,
    area: area as string,
    inZone: true,
    pin: { x: x as number, y: y as number },
  }))
  .concat(
    [
      ["nugegoda", "Nugegoda", "Western Province"],
      ["rajagiriya", "Rajagiriya", "Western Province"],
      ["battaramulla", "Battaramulla", "Western Province"],
      ["mount-lavinia", "Mount Lavinia", "Western Province"],
      ["moratuwa", "Moratuwa", "Western Province"],
      ["negombo", "Negombo", "Western Province"],
      ["kandy", "Kandy", "Central Province"],
      ["galle", "Galle", "Southern Province"],
      ["jaffna", "Jaffna", "Northern Province"],
      ["kurunegala", "Kurunegala", "North Western Province"],
    ].map(([id, name, detail]) => ({ id: id!, name: name!, detail: detail!, area: name!, inZone: false })),
  );

const latency = (ms = 250) => new Promise((r) => setTimeout(r, ms));

function readAll(): SavedAddress[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedAddress[]) : structuredClone(defaultAddresses);
  } catch {
    return structuredClone(defaultAddresses);
  }
}

export async function listAddresses(): Promise<SavedAddress[]> {
  return readAll();
}

/** Adds a new address, or replaces the one with the same id. */
export async function saveAddress(address: SavedAddress): Promise<SavedAddress> {
  await latency();
  const all = readAll().filter((a) => a.id !== address.id);
  localStorage.setItem(KEY, JSON.stringify([address, ...all]));
  return address;
}

/** Id for an address that isn't Home or Work. */
export const newAddressId = () => `addr-${Date.now().toString(36)}`;

export async function removeAddress(id: string): Promise<void> {
  await latency();
  localStorage.setItem(KEY, JSON.stringify(readAll().filter((a) => a.id !== id)));
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Places matching what someone typed. Names that start with the query come first. */
export async function searchPlaces(query: string): Promise<Place[]> {
  await latency(150);
  const q = normalise(query);
  if (q.length < 2) return [];
  const score = (p: Place) => {
    const name = normalise(p.name);
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    return normalise(`${p.detail} ${p.area}`).includes(q) ? 2 : 3;
  };
  return places
    .map((p) => [p, score(p)] as const)
    .filter(([, s]) => s < 3)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 6)
    .map(([p]) => p);
}

/** In-zone places, used to say where a dragged pin is. */
export function landmarks(): Place[] {
  return places.filter((p) => p.inZone);
}

/** "Tell me when you deliver here." Later: the growth team's launch list. */
export async function joinWaitlist(place: Place): Promise<void> {
  await latency();
  const list = JSON.parse(localStorage.getItem(WAITLIST_KEY) ?? "[]") as string[];
  localStorage.setItem(WAITLIST_KEY, JSON.stringify([...new Set([...list, place.id])]));
}

/** Postal districts riders cover today, and what's next. Later: the zones table in the admin console. */
export const deliveryAreas: { code: string; name: string }[] = [
  { code: "01", name: "Fort" },
  { code: "02", name: "Slave Island" },
  { code: "03", name: "Kollupitiya" },
  { code: "04", name: "Bambalapitiya" },
  { code: "05", name: "Havelock Town" },
  { code: "06", name: "Wellawatte" },
  { code: "07", name: "Cinnamon Gardens" },
  { code: "08", name: "Borella" },
  { code: "09", name: "Dematagoda" },
  { code: "10", name: "Maradana" },
  { code: "11", name: "Pettah" },
  { code: "12", name: "Hulftsdorp" },
  { code: "13", name: "Kotahena" },
  { code: "14", name: "Grandpass" },
  { code: "15", name: "Mattakkuliya" },
];

export const comingNext = ["Mount Lavinia", "Nugegoda", "Rajagiriya", "Battaramulla"];
