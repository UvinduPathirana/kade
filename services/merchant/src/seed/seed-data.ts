// Seed data: one outlet per restaurant in the apps' mock catalogue (ids per CONVENTIONS "Seeded ids"),
// with the figures the admin console mock shows, and the Galle Road Kottu House team (Keycloak demo
// users ruwan = owner, kasun = kitchen). Values mirror apps/admin/src/api/mock/partners.ts and
// apps/restaurant/src/api/{outlet,partner}.ts so the apps look the same on live data.
import { PaperWidth } from "@kade/proto/kade/merchant/v1/merchant_service";
import type { BankJson } from "../db/schema.js";
import type { AdminStatusDb, StaffRoleDb } from "../domain/enums.js";
import { KEYCLOAK_USERS, outletIdOf, seededId, zoneForArea } from "../domain/values.js";
import type { NewApplication } from "../applications/applications.repository.js";
import { settingsToJson } from "../outlets/outlet-mapper.js";
import type { NewOutlet } from "../outlets/outlets.repository.js";
import type { NewStaff } from "../staff/staff.repository.js";

export const DEMO_OUTLET_ID = outletIdOf(1); // Galle Road Kottu House

const photos = {
  kottu: "1589302168068-964664d93dc0",
  biryani: "1563379091339-03b21ab4a4f8",
  curry: "1585937421612-70a008356fbe",
  curry2: "1596797038530-2c107229654b",
  fishCurry: "1574484284002-952d92456975",
  buns: "1606491956689-2ea866880c84",
  chaat: "1610192244261-3f33de3f55e4",
  ramen: "1569718212165-3a8278d5f624",
  sushi: "1579871494447-9811cf80d66c",
  burger: "1568901346375-23c9450c58cd",
  chicken: "1626074353765-517a681e40be",
  pizza: "1513104890138-7c749659a591",
  salad: "1512621776951-a57141f2eefd",
  donut: "1551024601-bec78aea704b",
  pudding: "1488477181946-6428a0291777",
  grocery: "1542838132-92c53300491e",
} as const;

type Seed = [
  n: number,
  name: string,
  area: string,
  zoneId: string,
  cuisine: string,
  categoryId: string,
  imageId: string,
  rating: number,
  etaMin: number,
  hasOffer: boolean,
  owner: string,
  address: string,
  phone: string,
];

const seeds: Seed[] = [
  [
    1,
    "Galle Road Kottu House",
    "Kollupitiya",
    "c03",
    "Kottu",
    "kottu",
    photos.kottu,
    4.8,
    15,
    true,
    "Mohamed Rizwan",
    "312 Galle Road, Colombo 03",
    "+94112574410",
  ],
  [
    2,
    "Amma's Rice & Curry",
    "Bambalapitiya",
    "c04",
    "Rice and curry",
    "rice",
    photos.curry,
    4.9,
    20,
    false,
    "Kumari Jayasinghe",
    "41 Lauries Road, Colombo 04",
    "+94112583120",
  ],
  [
    3,
    "Kompanna Short Eats",
    "Slave Island",
    "c02",
    "Short eats",
    "shorteats",
    photos.buns,
    4.6,
    10,
    true,
    "Faizal Cassim",
    "18 Malay Street, Colombo 02",
    "+94112437765",
  ],
  [
    4,
    "Marine Drive Biryani",
    "Wellawatte",
    "c06",
    "Biryani",
    "biryani",
    photos.biryani,
    4.7,
    25,
    true,
    "Imran Hassan",
    "205 Marine Drive, Colombo 06",
    "+94112360912",
  ],
  [
    5,
    "Negombo Fish Curry Co.",
    "Dehiwala",
    "deh",
    "Seafood",
    "seafood",
    photos.fishCurry,
    4.5,
    30,
    false,
    "Anton Fernando",
    "77 Galle Road, Dehiwala",
    "+94112728834",
  ],
  [
    6,
    "Smash Shed",
    "Kollupitiya",
    "c03",
    "Burgers",
    "burgers",
    photos.burger,
    4.4,
    20,
    true,
    "Kavindu Perera",
    "9 Alfred Place, Colombo 03",
    "+94112301456",
  ],
  [
    7,
    "Wood & Fire Pizza",
    "Cinnamon Gardens",
    "c07",
    "Pizza",
    "pizza",
    photos.pizza,
    4.6,
    30,
    false,
    "Dinesh Wickramasinghe",
    "12 Ward Place, Colombo 07",
    "+94112695540",
  ],
  [
    8,
    "Noodle Lane",
    "Bambalapitiya",
    "c04",
    "Noodles and ramen",
    "asian",
    photos.ramen,
    4.7,
    25,
    true,
    "Wei Ling Tan",
    "56 Duplication Road, Colombo 04",
    "+94112589901",
  ],
  [
    9,
    "Sakura Colombo",
    "Colombo 07",
    "c07",
    "Sushi",
    "sushi",
    photos.sushi,
    4.8,
    35,
    false,
    "Kenji Watanabe",
    "3 Horton Place, Colombo 07",
    "+94112684472",
  ],
  [
    10,
    "Green Cabin Bowls",
    "Kollupitiya",
    "c03",
    "Salads and bowls",
    "healthy",
    photos.salad,
    4.5,
    15,
    false,
    "Nadeesha Silva",
    "28 Flower Road, Colombo 03",
    "+94112375518",
  ],
  [
    11,
    "Pettah Isso Wade",
    "Galle Face",
    "c01",
    "Short eats",
    "shorteats",
    photos.chaat,
    4.6,
    20,
    false,
    "Selvam Rajendran",
    "Galle Face Green, Colombo 01",
    "+94112441207",
  ],
  [
    12,
    "Watalappan Bar",
    "Colombo 03",
    "c03",
    "Desserts",
    "dessert",
    photos.pudding,
    4.9,
    15,
    true,
    "Fathima Zahir",
    "14 Dharmapala Mawatha, Colombo 03",
    "+94112330876",
  ],
  [
    13,
    "Ceylon Fried Chicken",
    "Bambalapitiya",
    "c04",
    "Fried chicken",
    "burgers",
    photos.chicken,
    4.3,
    20,
    false,
    "Ruwan Bandara",
    "102 Galle Road, Colombo 04",
    "+94112507733",
  ],
  [
    14,
    "Jaffna Curry Pot",
    "Wellawatte",
    "c06",
    "Rice and curry",
    "rice",
    photos.curry2,
    4.7,
    30,
    false,
    "Tharshini Sivakumar",
    "48 Ramakrishna Road, Colombo 06",
    "+94112362245",
  ],
  [
    15,
    "Kadé Market",
    "Colombo 03",
    "c03",
    "Grocery",
    "grocery",
    photos.grocery,
    4.6,
    20,
    true,
    "Kadé",
    "1 Kadé Lane, Colombo 03",
    "+94112000015",
  ],
  [
    16,
    "Donut Republic",
    "Colombo 04",
    "c04",
    "Desserts",
    "dessert",
    photos.donut,
    4.4,
    15,
    false,
    "Shanika de Mel",
    "7 Bagatalle Road, Colombo 04",
    "+94112593318",
  ],
];

const banks = ["Commercial Bank", "Sampath Bank", "HNB", "Bank of Ceylon", "NDB"];

/** Deterministic pseudo-random per outlet so the seed is stable across resets. */
function seeded(seed: number) {
  let s = seed % 2147483647 || 1;
  const next = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return {
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
  };
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z]+/g, "")
    .slice(0, 14);

export function seedOutlets(now: Date): NewOutlet[] {
  return seeds.map(
    ([
      n,
      name,
      area,
      zoneId,
      cuisine,
      categoryId,
      imageId,
      rating,
      etaMin,
      hasOffer,
      owner,
      address,
      phone,
    ]) => {
      const r = seeded(n * 97);
      let adminStatus: AdminStatusDb = "open";
      let adminStatusReason = "";
      if (n === 16) [adminStatus, adminStatusReason] = ["closed", "Outside opening hours. Opens at 8 am."];
      if (n === 13) [adminStatus, adminStatusReason] = ["paused", "Paused by the restaurant: fryer repair"];
      const bank: BankJson = {
        bank: r.pick(banks),
        branch: area,
        accountName: name,
        accountLast4: String(r.int(1000, 9999)),
      };
      return {
        id: outletIdOf(n),
        name,
        area,
        address,
        phone,
        zoneId,
        cuisine,
        categoryId,
        imageId,
        ownerName: owner,
        ownerPhone: `+9477${r.int(1000000, 9999999)}`,
        ownerEmail: `orders@${slug(name)}.lk`,
        adminStatus,
        adminStatusReason,
        // Two kitchens are slow tonight (admin dashboard attention items): their tablets went quiet.
        lastHeartbeatAt: n === 7 || n === 14 ? new Date(now.getTime() - 15 * 60_000) : null,
        accepting: !(n === 7 || n === 14 || n === 13 || n === 16),
        commissionBps: n === 15 ? 0 : n === 9 ? 2000 : n === 2 ? 1500 : 1800,
        bank,
        settings: settingsToJson({
          devices:
            n === 1
              ? {
                  autoPrint: true,
                  printerName: "Kitchen printer (Epson TM-T82)",
                  paperWidth: PaperWidth.PAPER_WIDTH_80MM,
                  copies: 1,
                }
              : { autoPrint: false, printerName: "", paperWidth: PaperWidth.PAPER_WIDTH_80MM, copies: 1 },
          notifications: { smsPaused: n === 1, emailStatements: true, newReviews: n !== 1, lowRatings: true },
        }),
        rating,
        baseOrdersWeek: r.int(90, 620),
        baseAcceptanceRate: n === 7 ? 0.78 : n === 14 ? 0.82 : r.int(86, 99) / 100,
        etaMinMinutes: etaMin,
        hasOffer,
        joinedAt: new Date(`202${r.int(4, 5)}-0${r.int(1, 9)}-1${r.int(0, 9)}T09:00:00+05:30`),
      };
    },
  );
}

/** Seeded staff ids: group 8d01 (merchant-local, not a cross-service id). */
const staffId = (n: number) => seededId("8d01", n);

type StaffSeed = [
  id: number,
  name: string,
  phone: string,
  role: StaffRoleDb,
  userId: string | null,
  lastActiveMinsAgo: number | null,
];

export function seedStaff(now: Date): NewStaff[] {
  const team: StaffSeed[] = [
    [1, "Mohamed Rizwan", "+94773124410", "owner", null, 120],
    [2, "Ruwan Fernando", "+94771002002", "owner", KEYCLOAK_USERS.ruwan, null],
    [3, "Chathuri Perera", "+94718452290", "manager", null, 20],
    [4, "Saman Kumara", "+94762209184", "kitchen", null, 5],
    [5, "Kasun Silva", "+94771003003", "kitchen", KEYCLOAK_USERS.kasun, null],
    [6, "Ashan Silva", "+94704556312", "kitchen", null, 26 * 60],
    [7, "Nadeesha Fernando", "+94759013378", "kitchen", null, null],
  ];
  const rows: NewStaff[] = team.map(([n, name, phone, role, userId, mins]) => ({
    id: staffId(n),
    outletId: DEMO_OUTLET_ID,
    userId,
    name,
    phone,
    role,
    // Linked Keycloak users are active members; Nadeesha's invite is still pending.
    pending: !userId && mins === null,
    lastActiveAt: mins === null ? null : new Date(now.getTime() - mins * 60_000),
  }));
  // Every other outlet: its owner from the admin console (no login linked yet).
  for (const o of seedOutlets(now)) {
    if (o.id === DEMO_OUTLET_ID) continue;
    const n = Number(o.id.slice(-12));
    rows.push({
      id: staffId(100 + n),
      outletId: o.id,
      userId: null,
      name: o.ownerName!,
      phone: o.ownerPhone!,
      role: "owner",
      pending: false,
      lastActiveAt: null,
    });
  }
  return rows;
}

// ---------- Partner applications waiting in the admin review queue (admin mock RA-118/121/124) ----------

type DocSeed = [
  kind: string,
  fileName: string,
  fields: [string, string][],
  status?: "approved",
  expiresOn?: string,
];
type AppSeed = {
  n: number;
  name: string;
  type: string;
  area: string;
  cuisine: string;
  address: string;
  owner: string;
  phone: string;
  email: string;
  nic: string;
  hoursAgo: number;
  bank: [bank: string, branch: string, accountName: string, last4: string];
  docs: DocSeed[];
};

const applicationSeeds: AppSeed[] = [
  {
    n: 118,
    name: "Hela Bojun Hala",
    type: "BUSINESS_TYPE_RESTAURANT",
    area: "Borella",
    cuisine: "Rice and curry",
    address: "22 Cotta Road, Colombo 08",
    owner: "Chandrika Herath",
    phone: "+94714823390",
    email: "helabojun.borella@gmail.com",
    nic: "198254701234",
    hoursAgo: 51,
    bank: ["People's Bank", "Borella", "Hela Bojun Hala (Pvt) Ltd", "4471"],
    docs: [
      [
        "registration",
        "BR-certificate.pdf",
        [
          ["Registration no.", "PV 00284417"],
          ["Registered name", "Hela Bojun Hala (Pvt) Ltd"],
        ],
      ],
      [
        "foodSafety",
        "PHI-2026.jpg",
        [
          ["Issued by", "CMC Public Health Dept"],
          ["Valid until", "31 Mar 2027"],
        ],
        undefined,
        "2027-03-31",
      ],
      [
        "ownerId",
        "nic-front-back.jpg",
        [
          ["Name", "C. Herath"],
          ["NIC no.", "198254701234"],
        ],
      ],
      [
        "bank",
        "bank-letter.pdf",
        [
          ["Bank", "People's Bank, Borella"],
          ["Account name", "Hela Bojun Hala (Pvt) Ltd"],
        ],
      ],
      ["menu", "menu-oct.pdf", [["Items", "34 dishes, 6 drinks"]]],
    ],
  },
  {
    n: 121,
    name: "Kottu Lab",
    type: "BUSINESS_TYPE_CLOUD_KITCHEN",
    area: "Havelock Town",
    cuisine: "Kottu",
    address: "5 Havelock Road, Colombo 05",
    owner: "Shiran Gunawardena",
    phone: "+94772105512",
    email: "hello@kottulab.lk",
    nic: "199312904455",
    hoursAgo: 20,
    bank: ["Sampath Bank", "Havelock", "Shiran Gunawardena", "9012"],
    docs: [
      [
        "registration",
        "kottu-lab-BR.pdf",
        [
          ["Registration no.", "W 117832"],
          ["Registered name", "Kottu Lab"],
        ],
        "approved",
      ],
      [
        "foodSafety",
        "phi.png",
        [
          ["Issued by", "CMC Public Health Dept"],
          ["Valid until", "15 Oct 2026"],
        ],
        undefined,
        "2026-10-15",
      ],
      [
        "ownerId",
        "nic.jpg",
        [
          ["Name", "S. Gunawardena"],
          ["NIC no.", "199312904455"],
        ],
      ],
      [
        "bank",
        "bank.pdf",
        [
          ["Bank", "Sampath Bank, Havelock"],
          ["Account name", "Shiran Gunawardena"],
        ],
      ],
      ["menu", "menu.jpg", [["Items", "18 dishes"]]],
    ],
  },
  {
    n: 124,
    name: "Lassana Bakes",
    type: "BUSINESS_TYPE_BAKERY",
    area: "Dehiwala",
    cuisine: "Bakery",
    address: "61 Hill Street, Dehiwala",
    owner: "Priyanka Rodrigo",
    phone: "+94769031187",
    email: "lassanabakes@outlook.com",
    nic: "887455120V",
    hoursAgo: 4,
    bank: ["HNB", "Dehiwala", "P. Rodrigo", "3307"],
    docs: [
      [
        "registration",
        "br.pdf",
        [
          ["Registration no.", "Pending with Registrar"],
          ["Registered name", "Lassana Bakes"],
        ],
      ],
      [
        "foodSafety",
        "phi-blurry.jpg",
        [
          ["Issued by", "Dehiwala-Mt Lavinia MC"],
          ["Valid until", "Unreadable"],
        ],
      ],
      [
        "ownerId",
        "nic.jpg",
        [
          ["Name", "P. Rodrigo"],
          ["NIC no.", "887455120V"],
        ],
      ],
      [
        "bank",
        "bank.jpg",
        [
          ["Bank", "HNB, Dehiwala"],
          ["Account name", "P. Rodrigo"],
        ],
      ],
    ],
  },
];

const DOC_NAMES: Record<string, string> = {
  registration: "Business registration",
  foodSafety: "Food safety certificate (PHI)",
  ownerId: "Owner NIC",
  bank: "Bank details",
  menu: "Menu with prices",
};

/** Seeded application ids: group 8d02 (merchant-local). */
export function seedApplications(now: Date): NewApplication[] {
  return applicationSeeds.map((a) => {
    const submittedAt = new Date(now.getTime() - a.hoursAgo * 3_600_000);
    return {
      id: seededId("8d02", a.n),
      reference: `KP-20${a.n}`,
      ownerPhone: a.phone,
      business: {
        name: a.name,
        type: a.type,
        address: a.address,
        city: "Colombo",
        brNumber: "",
        cuisine: a.cuisine,
        area: a.area,
      },
      owner: { name: a.owner, phone: a.phone, email: a.email, nic: a.nic },
      documents: a.docs.map(([kind, fileName, fields, status, expiresOn], i) => ({
        id: seededId("8d03", a.n * 10 + i),
        kind,
        name: DOC_NAMES[kind] ?? kind,
        fileName,
        fileRef: `applications/${a.n}/${fileName}`,
        status: status === "approved" ? "DOCUMENT_STATUS_APPROVED" : "DOCUMENT_STATUS_PENDING",
        ...(expiresOn ? { expiresOn } : {}),
        fields: fields.map(([label, value]) => ({ label, value })),
        uploadedAt: submittedAt.toISOString(),
      })),
      bank: { bank: a.bank[0], branch: a.bank[1], accountName: a.bank[2], accountLast4: a.bank[3] },
      bankAccountNumber: null,
      menu: {
        method: a.docs.some((d) => d[0] === "menu")
          ? "MENU_SUBMISSION_METHOD_FILE"
          : "MENU_SUBMISSION_METHOD_LATER",
      },
      status: "pending",
      zoneId: zoneForArea(a.area),
      submittedAt,
    };
  });
}
