// The customer app's address-picker places (apps/customer/src/api/addresses.ts). In-zone places
// carry the app's map pins, converted to WGS84 with CONVENTIONS.md's formula; out-of-zone towns use
// real coordinates. zone_id follows the admin console's slugs (c01..c15, deh, raj, nug, mtl).

export interface SeedPlace {
  id: string;
  name: string;
  detail: string;
  area: string;
  lat: number;
  lng: number;
  inZone: boolean;
  zoneId: string;
}

const fromMap = (x: number, y: number) => ({
  lat: Math.round((6.9457 - 0.00007126 * y) * 1e6) / 1e6,
  lng: Math.round((79.82772 + 0.00006806 * x) * 1e6) / 1e6,
});

const inZone: [string, string, string, string, number, number, string][] = [
  ["galle-face", "Galle Face Green", "Colombo 03", "Galle Face", 300, 250, "c03"],
  ["one-galle-face", "One Galle Face", "Fort, Colombo 02", "Fort", 306, 196, "c02"],
  ["dutch-hospital", "Dutch Hospital", "Fort, Colombo 01", "Fort", 338, 122, "c01"],
  ["pettah-market", "Pettah Market", "Pettah, Colombo 11", "Pettah", 404, 82, "c11"],
  ["kotahena", "Kotahena", "Colombo 13", "Kotahena", 470, 34, "c13"],
  ["slave-island", "Slave Island", "Colombo 02", "Slave Island", 430, 330, "c02"],
  ["liberty-plaza", "Liberty Plaza", "Kollupitiya, Colombo 03", "Kollupitiya", 412, 520, "c03"],
  ["duplication-rd", "Duplication Rd", "Kollupitiya, Colombo 03", "Kollupitiya", 452, 560, "c03"],
  ["vmd-park", "Viharamahadevi Park", "Cinnamon Gardens, Colombo 07", "Cinnamon Gardens", 560, 470, "c07"],
  [
    "independence-sq",
    "Independence Square",
    "Cinnamon Gardens, Colombo 07",
    "Cinnamon Gardens",
    616,
    604,
    "c07",
  ],
  ["racecourse", "Racecourse", "Cinnamon Gardens, Colombo 07", "Cinnamon Gardens", 652, 700, "c07"],
  ["borella", "Borella Junction", "Borella, Colombo 08", "Borella", 724, 430, "c08"],
  ["majestic-city", "Majestic City", "Bambalapitiya, Colombo 04", "Bambalapitiya", 364, 742, "c04"],
  ["havelock-town", "Havelock Rd", "Havelock Town, Colombo 05", "Havelock Town", 522, 862, "c05"],
  ["narahenpita", "Narahenpita Junction", "Colombo 05", "Narahenpita", 742, 784, "c05"],
  ["savoy", "Savoy Cinema", "Wellawatte, Colombo 06", "Wellawatte", 372, 982, "c06"],
  ["marine-drive", "Marine Drive", "Wellawatte, Colombo 06", "Wellawatte", 318, 1010, "c06"],
  ["dehiwala-junction", "Dehiwala Junction", "Dehiwala", "Dehiwala", 392, 1236, "deh"],
  ["dehiwala-zoo", "Dehiwala Zoo", "Dehiwala", "Dehiwala", 540, 1262, "deh"],
];

const outOfZone: [string, string, string, number, number, string][] = [
  ["nugegoda", "Nugegoda", "Western Province", 6.8649, 79.8997, "nug"],
  ["rajagiriya", "Rajagiriya", "Western Province", 6.9094, 79.8943, "raj"],
  ["battaramulla", "Battaramulla", "Western Province", 6.899, 79.9187, ""],
  ["mount-lavinia", "Mount Lavinia", "Western Province", 6.839, 79.865, "mtl"],
  ["moratuwa", "Moratuwa", "Western Province", 6.773, 79.8816, ""],
  ["negombo", "Negombo", "Western Province", 7.2083, 79.8358, ""],
  ["kandy", "Kandy", "Central Province", 7.2906, 80.6337, ""],
  ["galle", "Galle", "Southern Province", 6.0535, 80.221, ""],
  ["jaffna", "Jaffna", "Northern Province", 9.6615, 80.0255, ""],
  ["kurunegala", "Kurunegala", "North Western Province", 7.4863, 80.3647, ""],
];

export const seedPlaces: SeedPlace[] = [
  ...inZone.map(([id, name, detail, area, x, y, zoneId]) => ({
    id,
    name,
    detail,
    area,
    ...fromMap(x, y),
    inZone: true,
    zoneId,
  })),
  ...outOfZone.map(([id, name, detail, lat, lng, zoneId]) => ({
    id,
    name,
    detail,
    area: name,
    lat,
    lng,
    inZone: false,
    zoneId,
  })),
];

/** What people search for most this week (the customer app's list). */
export const seedPopularSearches = [
  "Kottu",
  "Biryani",
  "Fish buns",
  "Watalappan",
  "Ramen",
  "Rice and curry",
  "Eggs",
];
