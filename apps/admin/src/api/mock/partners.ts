// Restaurants, riders, customers and staff. Restaurant names, areas and dishes match the customer
// app's catalogue (apps/customer/src/api/mock/catalogue.ts) so an order reads the same everywhere.
import { DAY, HOUR, MIN, simNow } from "./clock";
import { seeded } from "./random";
import type {
  Customer,
  Permission,
  PermissionMatrix,
  Restaurant,
  RestaurantApplication,
  Rider,
  RiderApplication,
  ReviewDoc,
  Staff,
  Vehicle,
} from "../types";

export const photos = {
  kottu: "1589302168068-964664d93dc0",
  biryani: "1563379091339-03b21ab4a4f8",
  curry: "1585937421612-70a008356fbe",
  curry2: "1596797038530-2c107229654b",
  fishCurry: "1574484284002-952d92456975",
  samosa: "1601050690597-df0568f70950",
  buns: "1606491956689-2ea866880c84",
  chaat: "1610192244261-3f33de3f55e4",
  ramen: "1569718212165-3a8278d5f624",
  sushi: "1579871494447-9811cf80d66c",
  burger: "1568901346375-23c9450c58cd",
  chicken: "1626074353765-517a681e40be",
  pizza: "1513104890138-7c749659a591",
  salad: "1512621776951-a57141f2eefd",
  bowl: "1546069901-ba9599a7e63c",
  spread: "1504674900247-0877df9cc836",
  donut: "1551024601-bec78aea704b",
  pudding: "1488477181946-6428a0291777",
  grocery: "1542838132-92c53300491e",
} as const;

const now = simNow();

/* ---------- Restaurants ---------- */

type Seed = [
  id: number,
  name: string,
  area: string,
  zoneId: string,
  cuisine: string,
  category: string,
  imageId: string,
  rating: number,
  etaMin: number,
  hasOffer: boolean,
  owner: string,
];

const restaurantSeeds: Seed[] = [
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
  ],
  [15, "Kadé Market", "Colombo 03", "c03", "Grocery", "grocery", photos.grocery, 4.6, 20, true, "Kadé"],
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
  ],
];

const banks = ["Commercial Bank", "Sampath Bank", "HNB", "Bank of Ceylon", "NDB"];

export const restaurants: Restaurant[] = restaurantSeeds.map(
  ([id, name, area, zoneId, cuisine, category, imageId, rating, etaMin, hasOffer, owner]) => {
    const r = seeded(id * 97);
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "");
    return {
      id,
      name,
      area,
      zoneId,
      cuisine,
      category,
      imageId,
      rating,
      etaMin,
      hasOffer,
      owner,
      ordersWeek: r.int(90, 620),
      acceptanceRate: r.int(86, 99) / 100,
      commission: id === 15 ? 0 : id === 9 ? 20 : id === 2 ? 15 : 18,
      status: id === 16 ? "closed" : "open",
      statusReason: id === 16 ? "Outside opening hours. Opens at 8 am." : undefined,
      accepting: true,
      phone: `+94 77 ${r.int(100, 999)} ${r.int(1000, 9999)}`,
      email: `orders@${slug.slice(0, 14)}.lk`,
      joinedOn: `202${r.int(4, 5)}-0${r.int(1, 9)}-1${r.int(0, 9)}`,
      bank: `${r.pick(banks)} ending ${r.int(1000, 9999)}`,
    };
  },
);

// Two kitchens are slow tonight, so the dashboard has something to act on.
Object.assign(restaurants[6]!, { accepting: false, waitingMinutes: 9, acceptanceRate: 0.78 });
Object.assign(restaurants[12]!, {
  status: "paused",
  statusReason: "Paused by the restaurant: fryer repair",
  accepting: false,
});
Object.assign(restaurants[13]!, { accepting: false, waitingMinutes: 6, acceptanceRate: 0.82 });

/** Dishes each restaurant sells, used to build order lines. */
export const dishes: Record<number, [string, number][]> = {
  1: [
    ["Chicken kottu", 1150],
    ["Cheese kottu", 1450],
    ["Dolphin kottu", 1650],
    ["Devilled chicken", 1400],
    ["Egg kottu", 950],
  ],
  2: [
    ["Chicken rice and curry", 850],
    ["Fish rice and curry", 900],
    ["Vegetable rice and curry", 650],
    ["Lamprais", 1450],
  ],
  3: [
    ["Fish bun", 180],
    ["Egg roll", 200],
    ["Vegetable roti", 150],
    ["Chicken patties", 220],
    ["Seeni sambol bun", 160],
  ],
  4: [
    ["Chicken biryani", 1550],
    ["Mutton biryani", 1950],
    ["Egg biryani", 1150],
    ["Watalappan", 450],
  ],
  5: [
    ["Ambul thiyal", 1350],
    ["Crab curry", 3200],
    ["Prawn curry", 2100],
    ["Fish rice and curry", 950],
  ],
  6: [
    ["Double smash", 1950],
    ["Chicken burger", 1650],
    ["Loaded fries", 950],
    ["Iced milo", 550],
  ],
  7: [
    ["Margherita", 2400],
    ["Devilled chicken pizza", 2900],
    ["Garlic bread", 750],
  ],
  8: [
    ["Chicken ramen", 1950],
    ["Nasi goreng", 1650],
    ["Wonton soup", 1100],
    ["Fried noodles", 1350],
  ],
  9: [
    ["Salmon maki", 2800],
    ["Ebi tempura roll", 2600],
    ["Chicken katsu don", 2200],
  ],
  10: [
    ["Jackfruit bowl", 1450],
    ["Chicken quinoa bowl", 1750],
    ["Gotukola salad", 850],
  ],
  11: [
    ["Isso wade", 250],
    ["Masala wade", 120],
    ["Ulundu wade", 120],
  ],
  12: [
    ["Watalappan", 450],
    ["Biscuit pudding", 550],
    ["Kiri pani", 500],
  ],
  13: [
    ["Two-piece meal", 1250],
    ["Spicy wings", 1100],
    ["Chicken burger", 1350],
  ],
  14: [
    ["Jaffna crab curry", 3400],
    ["Mutton curry and rice", 1650],
    ["Odiyal kool", 1800],
  ],
  15: [
    ["Fresh milk 1 l", 520],
    ["Bread", 190],
    ["Eggs, 10", 650],
    ["Red rice 5 kg", 1450],
  ],
  16: [
    ["Glazed donut box of 6", 1800],
    ["Kithul donut", 380],
  ],
};

/* ---------- Documents ---------- */

let docSeq = 1;
const doc = (
  kind: string,
  fileName: string,
  fields: ReviewDoc["fields"],
  extra: Partial<ReviewDoc> = {},
): ReviewDoc => ({
  id: `doc-${docSeq++}`,
  kind,
  fileName,
  status: "pending",
  fields,
  ...extra,
});

export const restaurantApplications: RestaurantApplication[] = [
  {
    id: "RA-118",
    name: "Hela Bojun Hala",
    area: "Borella",
    zoneId: "c08",
    cuisine: "Rice and curry",
    owner: "Chandrika Herath",
    phone: "+94 71 482 3390",
    email: "helabojun.borella@gmail.com",
    submittedAt: now - 2 * DAY - 3 * HOUR,
    status: "pending",
    documents: [
      doc("Business registration", "BR-certificate.pdf", [
        { label: "Registration no.", value: "PV 00284417" },
        { label: "Registered name", value: "Hela Bojun Hala (Pvt) Ltd" },
      ]),
      doc(
        "Food safety certificate (PHI)",
        "PHI-2026.jpg",
        [
          { label: "Issued by", value: "CMC Public Health Dept" },
          { label: "Valid until", value: "31 Mar 2027" },
        ],
        { expiresOn: "2027-03-31" },
      ),
      doc("Owner NIC", "nic-front-back.jpg", [
        { label: "Name", value: "C. Herath" },
        { label: "NIC no.", value: "198254701234" },
      ]),
      doc("Bank details", "bank-letter.pdf", [
        { label: "Bank", value: "People's Bank, Borella" },
        { label: "Account name", value: "Hela Bojun Hala (Pvt) Ltd" },
      ]),
      doc("Menu with prices", "menu-oct.pdf", [{ label: "Items", value: "34 dishes, 6 drinks" }]),
    ],
  },
  {
    id: "RA-121",
    name: "Kottu Lab",
    area: "Havelock Town",
    zoneId: "c05",
    cuisine: "Kottu",
    owner: "Shiran Gunawardena",
    phone: "+94 77 210 5512",
    email: "hello@kottulab.lk",
    submittedAt: now - 20 * HOUR,
    status: "pending",
    documents: [
      doc(
        "Business registration",
        "kottu-lab-BR.pdf",
        [
          { label: "Registration no.", value: "W 117832" },
          { label: "Registered name", value: "Kottu Lab" },
        ],
        { status: "approved" },
      ),
      doc(
        "Food safety certificate (PHI)",
        "phi.png",
        [
          { label: "Issued by", value: "CMC Public Health Dept" },
          { label: "Valid until", value: "15 Oct 2026" },
        ],
        { expiresOn: "2026-10-15" },
      ),
      doc("Owner NIC", "nic.jpg", [
        { label: "Name", value: "S. Gunawardena" },
        { label: "NIC no.", value: "199312904455" },
      ]),
      doc("Bank details", "bank.pdf", [
        { label: "Bank", value: "Sampath Bank, Havelock" },
        { label: "Account name", value: "Shiran Gunawardena" },
      ]),
      doc("Menu with prices", "menu.jpg", [{ label: "Items", value: "18 dishes" }]),
    ],
  },
  {
    id: "RA-124",
    name: "Lassana Bakes",
    area: "Dehiwala",
    zoneId: "deh",
    cuisine: "Bakery",
    owner: "Priyanka Rodrigo",
    phone: "+94 76 903 1187",
    email: "lassanabakes@outlook.com",
    submittedAt: now - 4 * HOUR,
    status: "pending",
    documents: [
      doc("Business registration", "br.pdf", [
        { label: "Registration no.", value: "Pending with Registrar" },
        { label: "Registered name", value: "Lassana Bakes" },
      ]),
      doc("Food safety certificate (PHI)", "phi-blurry.jpg", [
        { label: "Issued by", value: "Dehiwala-Mt Lavinia MC" },
        { label: "Valid until", value: "Unreadable" },
      ]),
      doc("Owner NIC", "nic.jpg", [
        { label: "Name", value: "P. Rodrigo" },
        { label: "NIC no.", value: "887455120V" },
      ]),
      doc("Bank details", "bank.jpg", [
        { label: "Bank", value: "HNB, Dehiwala" },
        { label: "Account name", value: "P. Rodrigo" },
      ]),
    ],
  },
];

/* ---------- Riders ---------- */

const riderNames = [
  "Nimal Fernando",
  "Kasun Perera",
  "Ishara Madushan",
  "Tharindu Silva",
  "Mohamed Nazeer",
  "Saman Kumara",
  "Ruwan Jayasuriya",
  "Dilshan Rathnayake",
  "Chamara Wijesinghe",
  "Ashan de Silva",
  "Pradeep Kumar",
  "Lahiru Gunasekara",
  "Fazal Mohideen",
  "Sampath Herath",
  "Janaka Bandara",
  "Nuwan Pathirana",
  "Kavinda Lakmal",
  "Suresh Rajan",
  "Amila Dissanayake",
  "Roshan Weerasinghe",
  "Chathura Senanayake",
  "Hiran Abeysekara",
  "Gayan Kodikara",
  "Malith Ekanayake",
  "Sajith Liyanage",
  "Thilina Ranasinghe",
  "Asanka Peiris",
  "Rifkhan Ahamed",
  "Upul Samarasinghe",
  "Dinuka Wanigasekara",
  "Buddhika Alwis",
  "Hasitha Mendis",
  "Prasanna Karunaratne",
  "Isuru Udana",
  "Sandun Jayawardena",
  "Ravi Shankar",
  "Mahesh Gamage",
  "Kelum Rajapaksha",
  "Nalin Abeywardena",
  "Sahan Wickrama",
  "Yasiru Kulatunga",
  "Ajith Premadasa",
  "Shehan Fonseka",
  "Danushka Mallawarachchi",
  "Viraj Seneviratne",
  "Rukshan Cooray",
  "Pubudu Hettiarachchi",
  "Niroshan Thevarajah",
];

const busyZones = [
  "c03",
  "c03",
  "c04",
  "c04",
  "c06",
  "c07",
  "c02",
  "c08",
  "c05",
  "deh",
  "c01",
  "c13",
  "c10",
  "raj",
  "nug",
  "c11",
  "c12",
  "c09",
  "c14",
  "c15",
];

export const riders: Rider[] = riderNames.map((name, i) => {
  const r = seeded(500 + i);
  const vehicle: Vehicle = i % 9 === 4 ? "tukTuk" : i % 11 === 7 ? "bicycle" : "motorbike";
  const home = busyZones[i % busyZones.length]!;
  const neighbour = r.pick(busyZones);
  const status = i < 30 ? "online" : i === 46 ? "suspended" : "offline";
  const licenceExpiry =
    i === 3 ? "2026-10-18" : i === 12 ? "2026-10-04" : `2027-0${r.int(1, 9)}-1${r.int(0, 9)}`;
  const insuranceExpiry = i === 8 ? "2026-10-27" : `2027-0${r.int(1, 9)}-2${r.int(0, 8)}`;
  return {
    id: `R-${String(101 + i)}`,
    name,
    phone: `+94 7${r.int(0, 8)} ${r.int(100, 999)} ${r.int(1000, 9999)}`,
    vehicle,
    status,
    statusReason:
      status === "suspended" ? "Three customer complaints about rude behaviour, under review" : undefined,
    zoneIds: home === neighbour ? [home] : [home, neighbour],
    rating: r.int(43, 50) / 10,
    acceptanceRate: r.int(72, 99) / 100,
    cashHeld:
      i === 5 ? 21450 : i === 17 ? 18200 : status === "offline" ? r.int(0, 3) * 1000 : r.int(1, 12) * 850,
    cashLimit: 15000,
    tripsWeek: status === "offline" ? r.int(8, 40) : r.int(25, 70),
    joinedOn: `202${r.int(4, 6)}-0${r.int(1, 9)}-0${r.int(1, 9)}`,
    documents: [
      doc(
        "Driving licence",
        "licence.jpg",
        [{ label: "Licence no.", value: `B${r.int(1000000, 9999999)}` }],
        {
          status: "approved",
          expiresOn: licenceExpiry,
        },
      ),
      doc(
        "Revenue licence",
        "revenue.jpg",
        [
          {
            label: "Vehicle no.",
            value: `WP B${r.pick(["A", "B", "C", "D"])}${r.pick(["K", "L", "M"])}-${r.int(1000, 9999)}`,
          },
        ],
        {
          status: "approved",
          expiresOn: `2027-0${r.int(1, 9)}-0${r.int(1, 9)}`,
        },
      ),
      doc(
        "Insurance",
        "insurance.pdf",
        [{ label: "Insurer", value: r.pick(["Ceylinco", "Sri Lanka Insurance", "Allianz", "Fairfirst"]) }],
        {
          status: "approved",
          expiresOn: insuranceExpiry,
        },
      ),
      doc("NIC", "nic.jpg", [{ label: "NIC no.", value: `19${r.int(85, 99)}${r.int(10000000, 99999999)}` }], {
        status: "approved",
      }),
    ],
    pos: { zoneId: home, x: 0.15 + r.next() * 0.7, y: 0.15 + r.next() * 0.7 },
  };
});

const appDocs = (ok: boolean): ReviewDoc[] => [
  doc(
    "Driving licence",
    "licence-front.jpg",
    [
      { label: "Licence no.", value: "B4471920" },
      { label: "Classes", value: "A1, B1" },
      { label: "Valid until", value: "12 Jun 2031" },
    ],
    { expiresOn: "2031-06-12" },
  ),
  doc(
    "Revenue licence",
    "revenue-licence.jpg",
    [
      { label: "Vehicle no.", value: "WP BKL-4471" },
      { label: "Valid until", value: ok ? "30 Jun 2027" : "30 Sep 2026" },
    ],
    { expiresOn: ok ? "2027-06-30" : "2026-09-30" },
  ),
  doc("Insurance", "insurance.pdf", [
    { label: "Insurer", value: "Ceylinco General" },
    { label: "Cover", value: "Third party" },
  ]),
  doc("NIC", "nic.jpg", [{ label: "NIC no.", value: "200012345678" }]),
  doc("Police clearance", "police-report.pdf", [{ label: "Issued", value: "22 Sep 2026, Bambalapitiya" }]),
];

export const riderApplications: RiderApplication[] = [
  {
    id: "RAP-301",
    name: "Sachintha Rajapakse",
    phone: "+94 77 331 0921",
    vehicle: "motorbike",
    zoneIds: ["c04", "c06"],
    submittedAt: now - 26 * HOUR,
    status: "pending",
    documents: appDocs(true),
  },
  {
    id: "RAP-302",
    name: "Mohamed Ilham",
    phone: "+94 75 802 4410",
    vehicle: "motorbike",
    zoneIds: ["c02", "c03"],
    submittedAt: now - 9 * HOUR,
    status: "pending",
    documents: appDocs(false),
  },
  {
    id: "RAP-305",
    name: "Tharaka Jayalath",
    phone: "+94 71 640 2208",
    vehicle: "bicycle",
    zoneIds: ["c07"],
    submittedAt: now - 2 * HOUR,
    status: "pending",
    documents: appDocs(true),
  },
  {
    id: "RAP-306",
    name: "Kumaran Nadarajah",
    phone: "+94 76 115 7720",
    vehicle: "tukTuk",
    zoneIds: ["c06", "deh"],
    submittedAt: now - 35 * MIN,
    status: "pending",
    documents: appDocs(true),
  },
];
riderApplications[0]!.documents.slice(0, 3).forEach((d) => (d.status = "approved"));

/* ---------- Customers ---------- */

const customerNames = [
  "Shehani Wijeratne",
  "Ravindu Jayasekara",
  "Aisha Farook",
  "Dilan Perera",
  "Nethmi Senanayake",
  "Arjun Mahendran",
  "Tania Gomes",
  "Sanduni Karunaratne",
  "Hashan Wickramaratne",
  "Fathima Rizvi",
  "Kevin Ondaatje",
  "Malsha Fernando",
  "Ramesh Kanagaratnam",
  "Nadia Marikar",
  "Chamindu Abeysinghe",
  "Sachini Gunawardena",
  "Yohan de Alwis",
  "Imesha Ranatunga",
  "Zainab Cader",
  "Pasan Liyanage",
  "Rashmi Weerakoon",
  "Dulaj Hettiarachchi",
  "Anushka Jayamaha",
  "Hiruni Dharmasena",
  "Nuwan Kothalawala",
  "Priya Thambiah",
  "Kaveesha Mendis",
  "Shamal Ratnayake",
  "Ishani Kulasekara",
  "Mevan Amarasekara",
  "Ameer Hamza",
  "Oshadi Peiris",
  "Lakindu Samaraweera",
  "Sharmila Navaratnam",
  "Thisara Dias",
  "Vihanga Tennakoon",
];
const customerAreas = [
  "Kollupitiya",
  "Bambalapitiya",
  "Wellawatte",
  "Colombo 07",
  "Borella",
  "Havelock Town",
  "Dehiwala",
  "Rajagiriya",
  "Kotahena",
  "Slave Island",
  "Nugegoda",
  "Fort",
];

export const customers: Customer[] = customerNames.map((name, i) => {
  const r = seeded(900 + i);
  const [first, last] = name.toLowerCase().split(" ");
  const ordersCount = r.int(2, 140);
  return {
    id: `C-${2040 + i * 7}`,
    name,
    phone: `+94 7${r.int(0, 8)} ${r.int(100, 999)} ${r.int(1000, 9999)}`,
    email: `${first}.${last?.slice(0, 1)}${r.int(10, 99)}@${r.pick(["gmail.com", "yahoo.com", "outlook.com"])}`,
    area: customerAreas[i % customerAreas.length]!,
    joinedOn: `202${r.int(4, 6)}-${String(r.int(1, 12)).padStart(2, "0")}-${String(r.int(1, 28)).padStart(2, "0")}`,
    ordersCount,
    spend: ordersCount * r.int(1400, 3200),
    credit: r.chance(0.25) ? r.int(1, 6) * 100 : 0,
    blocked: false,
    flags: [],
    creditHistory: [],
  };
});

// Fraud flags the risk model raised
customers[7]!.flags.push({
  id: "F-1",
  kind: "refunds",
  detail: '6 refund requests in 14 days, all "missing item", Rs 7,850 refunded',
  raisedAt: now - 5 * HOUR,
  status: "open",
});
customers[12]!.flags.push({
  id: "F-2",
  kind: "cancellations",
  detail: "5 cash orders cancelled at the door this month; riders were paid Rs 1,250 in failed-trip fees",
  raisedAt: now - DAY,
  status: "open",
});
customers[19]!.flags.push(
  {
    id: "F-3",
    kind: "paymentFailures",
    detail: "4 cards declined in 2 hours, 3 different issuing banks",
    raisedAt: now - 2 * HOUR,
    status: "open",
  },
  {
    id: "F-4",
    kind: "refunds",
    detail: "3 refund requests in 7 days",
    raisedAt: now - 9 * DAY,
    status: "cleared",
    resolution: "Checked with the restaurant; items were missing. Cleared by Kasun.",
  },
);
customers[30]!.blocked = true;
customers[30]!.blockReason = "Used 11 new accounts to claim FIRSTKOTTU";
customers[30]!.flags.push({
  id: "F-5",
  kind: "refunds",
  detail: "Same phone number linked to 11 new-customer vouchers",
  raisedAt: now - 12 * DAY,
  status: "actioned",
  resolution: "Blocked by Dilini",
});

/* ---------- Team ---------- */

export const ME = { id: "S-1", name: "Dilini Perera", short: "Dilini" };

export const staff: Staff[] = [
  {
    id: "S-1",
    name: "Dilini Perera",
    email: "dilini@kade.lk",
    role: "ops",
    title: "Ops lead",
    lastActiveAt: now,
    status: "active",
  },
  {
    id: "S-2",
    name: "Kasun Wickramasinghe",
    email: "kasun@kade.lk",
    role: "admin",
    title: "Head of operations",
    lastActiveAt: now - 40 * MIN,
    status: "active",
  },
  {
    id: "S-3",
    name: "Hasini Fernando",
    email: "hasini@kade.lk",
    role: "finance",
    title: "Finance manager",
    lastActiveAt: now - 3 * HOUR,
    status: "active",
  },
  {
    id: "S-4",
    name: "Ruwani Silva",
    email: "ruwani@kade.lk",
    role: "support",
    title: "Support agent",
    lastActiveAt: now - 2 * MIN,
    status: "active",
  },
  {
    id: "S-5",
    name: "Imran Lafir",
    email: "imran@kade.lk",
    role: "support",
    title: "Support agent",
    lastActiveAt: now - 6 * MIN,
    status: "active",
  },
  {
    id: "S-6",
    name: "Tharushi Jayawardena",
    email: "tharushi@kade.lk",
    role: "ops",
    title: "Dispatcher",
    lastActiveAt: now - 1 * MIN,
    status: "active",
  },
  {
    id: "S-7",
    name: "Nalin Gunasekara",
    email: "nalin@kade.lk",
    role: "ops",
    title: "Rider onboarding",
    lastActiveAt: now - 26 * HOUR,
    status: "active",
  },
  {
    id: "S-8",
    name: "Shalini Rajaratnam",
    email: "shalini@kade.lk",
    role: "finance",
    title: "Accounts assistant",
    status: "invited",
  },
];

export const permissions: Permission[] = [
  { id: "orders.view", label: "View orders and customers", group: "Orders" },
  { id: "orders.reassign", label: "Assign another rider", group: "Orders" },
  { id: "orders.cancel", label: "Cancel orders", group: "Orders" },
  { id: "orders.refundSmall", label: "Refund up to Rs 5,000", group: "Orders" },
  { id: "orders.refundAny", label: "Refund any amount", group: "Orders" },
  { id: "customers.credit", label: "Issue Kadé credit", group: "Customers" },
  { id: "customers.block", label: "Block customers", group: "Customers" },
  { id: "partners.approve", label: "Approve restaurants and riders", group: "Partners" },
  { id: "partners.suspend", label: "Pause or suspend restaurants and riders", group: "Partners" },
  { id: "partners.commission", label: "Change commission", group: "Partners" },
  { id: "finance.payouts", label: "Approve payout batches", group: "Finance" },
  { id: "finance.cash", label: "Record cash deposits", group: "Finance" },
  { id: "pricing.edit", label: "Edit zones, fees and surcharges", group: "Pricing and content" },
  { id: "promos.edit", label: "Create and pause vouchers", group: "Pricing and content" },
  { id: "content.edit", label: "Edit the home feed", group: "Pricing and content" },
  { id: "team.manage", label: "Invite staff and change roles", group: "Team" },
];

export const permissionMatrix: PermissionMatrix = {
  admin: permissions.map((p) => p.id),
  ops: [
    "orders.view",
    "orders.reassign",
    "orders.cancel",
    "orders.refundSmall",
    "customers.credit",
    "customers.block",
    "partners.approve",
    "partners.suspend",
    "pricing.edit",
    "promos.edit",
    "content.edit",
  ],
  finance: [
    "orders.view",
    "orders.refundSmall",
    "orders.refundAny",
    "partners.commission",
    "finance.payouts",
    "finance.cash",
  ],
  support: ["orders.view", "orders.refundSmall", "customers.credit"],
};
