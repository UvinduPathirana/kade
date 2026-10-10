// Mock data standing in for the dispatch, rider and payouts services. Times are relative to now so
// the demo always reads as "today".
import { daysAgoAt, todayAt } from "@/lib/time";
import type {
  HelpTopic,
  MapPoint,
  Offer,
  Payout,
  PaymentMethod,
  RatingsSummary,
  RiderDocument,
  RiderProfile,
  Trip,
} from "../types";

export const profile: RiderProfile = {
  name: "Nimal Perera",
  firstName: "Nimal",
  phone: "+94 77 412 5583",
  vehicle: { type: "motorbike", model: "Bajaj Pulsar 150", plate: "WP BCD-4521" },
  rating: 4.9,
  ratingCount: 1284,
  memberSince: "March 2024",
  bank: { name: "Commercial Bank", branch: "Kollupitiya", last4: "4417" },
  depositReference: "KR-4521-NP",
};

export const CASH_LIMIT = 15_000;

/** Cash position at the start of the demo; trips completed in the demo are added on top. */
export const seedCash = { collected: 17_450, owedToRider: 3_120, lastDepositDaysAgo: 3 };

export const documents: RiderDocument[] = [
  { id: "licence", name: "Driving licence", expiresOn: "2029-04-18", status: "valid" },
  { id: "revenue", name: "Revenue licence", expiresOn: "2026-10-31", status: "expiring" },
  { id: "insurance", name: "Insurance", expiresOn: "2027-02-11", status: "valid" },
  { id: "nic", name: "NIC", status: "valid" },
];

// ---------- Offers (dispatch service) ----------

type OfferTemplate = Omit<Offer, "id" | "offeredAt" | "expiresAt" | "from">;

const P = (x: number, y: number): MapPoint => ({ x, y });

export const offerTemplates: OfferTemplate[] = [
  {
    orderNumber: "KD-4817",
    restaurant: {
      name: "Galle Road Kottu House",
      area: "Kollupitiya",
      address: "312 Galle Rd, Colombo 03",
      phone: "+94 11 257 4410",
      point: P(150, 175),
    },
    customer: {
      firstName: "Dilini",
      area: "Bambalapitiya",
      address: "18/2 Daisy Villa Ave, Colombo 04",
      note: "Blue gate, ring the bell twice. The dog is friendly.",
      maskedPhone: "+94 11 520 3381",
      point: P(320, 300),
    },
    toPickupKm: 1.1,
    tripKm: 3.4,
    minutes: 24,
    pay: { base: 180, distance: 230, tip: 0, boost: 50 },
    payment: "cash",
    cashToCollect: 2_340,
    customerPaysWith: 5_000,
    items: [
      { id: "a", qty: 2, name: "Chicken cheese kottu", options: "Large, extra cheese, medium spicy" },
      { id: "b", qty: 1, name: "Egg roti", options: "With lunu miris" },
      { id: "c", qty: 2, name: "Elephant House ginger beer" },
    ],
    sealed: false,
    notReadyMinutes: 6,
    deliveryCode: "4821",
  },
  {
    orderNumber: "KD-5260",
    restaurant: {
      name: "Upali's by Nawaloka",
      area: "Cinnamon Gardens",
      address: "65 C.W.W. Kannangara Mw, Colombo 07",
      phone: "+94 11 269 5812",
      point: P(340, 175),
    },
    customer: {
      firstName: "Ashan",
      area: "Havelock Town",
      address: "Apt 7B, Tower 2, Havelock City, Colombo 05",
      note: "Leave it with security at Tower 2 if I don't answer.",
      maskedPhone: "+94 11 520 3392",
      point: P(340, 395),
    },
    toPickupKm: 0.8,
    tripKm: 2.9,
    minutes: 19,
    pay: { base: 180, distance: 190, tip: 100, boost: 0 },
    payment: "card",
    cashToCollect: 0,
    items: [
      { id: "a", qty: 2, name: "Lamprais", options: "Chicken" },
      { id: "b", qty: 1, name: "Watalappan" },
    ],
    sealed: true,
    notReadyMinutes: 0,
    deliveryCode: "3907",
  },
  {
    orderNumber: "KD-6034",
    restaurant: {
      name: "Pilawoos",
      area: "Kollupitiya",
      address: "417 Galle Rd, Colombo 03",
      phone: "+94 11 257 1029",
      point: P(150, 60),
    },
    customer: {
      firstName: "Fathima",
      area: "Wellawatte",
      address: "22 Fussels Ln, Colombo 06",
      note: "Second floor, the flat above the pharmacy.",
      maskedPhone: "+94 11 520 3407",
      point: P(150, 395),
    },
    toPickupKm: 1.4,
    tripKm: 5.2,
    minutes: 31,
    pay: { base: 180, distance: 360, tip: 0, boost: 80 },
    payment: "cash",
    cashToCollect: 1_860,
    customerPaysWith: 2_000,
    items: [
      { id: "a", qty: 1, name: "Mutton kottu", options: "Regular, extra gravy" },
      { id: "b", qty: 1, name: "Cheese kottu", options: "Large" },
      { id: "c", qty: 2, name: "Fresh lime juice", options: "Less sugar" },
    ],
    sealed: false,
    notReadyMinutes: 4,
    deliveryCode: "1156",
  },
  {
    orderNumber: "KD-7712",
    restaurant: {
      name: "Saraswathie Lodge",
      area: "Bambalapitiya",
      address: "21 Lauries Rd, Colombo 04",
      phone: "+94 11 258 3611",
      point: P(150, 300),
    },
    customer: {
      firstName: "Kavindu",
      area: "Kollupitiya",
      address: "9 Alfred Pl, Colombo 03",
      maskedPhone: "+94 11 520 3415",
      point: P(320, 60),
    },
    toPickupKm: 2.0,
    tripKm: 3.0,
    minutes: 22,
    pay: { base: 180, distance: 200, tip: 50, boost: 0 },
    payment: "card",
    cashToCollect: 0,
    items: [
      { id: "a", qty: 2, name: "Masala dosai", options: "Extra sambar" },
      { id: "b", qty: 4, name: "Ulundu vadai" },
      { id: "c", qty: 1, name: "Filter coffee" },
    ],
    sealed: false,
    notReadyMinutes: 0,
    deliveryCode: "7240",
  },
];

// ---------- Past trips (rider service) ----------

type Row = [
  daysAgo: number,
  hour: number,
  minute: number,
  restaurant: string,
  pickupArea: string,
  dropoffArea: string,
  customer: string,
  km: number,
  distancePay: number,
  tip: number,
  boost: number,
  payment: PaymentMethod,
  cash: number,
  rating: number | undefined,
];

const rows: Row[] = [
  [0, 8, 5, "Perera & Sons", "Kollupitiya", "Cinnamon Gardens", "Ruwani", 2.2, 150, 0, 0, "card", 0, 5],
  [
    0,
    9,
    10,
    "Barista Kollupitiya",
    "Kollupitiya",
    "Bambalapitiya",
    "Sahan",
    2.8,
    190,
    50,
    0,
    "cash",
    1_420,
    5,
  ],
  [
    0,
    10,
    40,
    "Saraswathie Lodge",
    "Bambalapitiya",
    "Wellawatte",
    "Priya",
    2.5,
    170,
    0,
    0,
    "card",
    0,
    undefined,
  ],
  [
    0,
    12,
    15,
    "Galle Road Kottu House",
    "Kollupitiya",
    "Havelock Town",
    "Thilina",
    3.9,
    260,
    100,
    60,
    "card",
    0,
    5,
  ],
  [0, 13, 5, "Pilawoos", "Kollupitiya", "Bambalapitiya", "Ishara", 3.1, 210, 0, 60, "cash", 2_150, 4],
  [0, 13, 50, "Hotel de Pilawoos", "Kollupitiya", "Kollupitiya", "Nadeesha", 1.2, 90, 0, 60, "cash", 980, 5],
  [
    0,
    15,
    20,
    "Upali's by Nawaloka",
    "Cinnamon Gardens",
    "Dehiwala",
    "Roshan",
    6.4,
    430,
    150,
    0,
    "card",
    0,
    5,
  ],
  [1, 11, 30, "Crepe Runner", "Kollupitiya", "Bambalapitiya", "Mihiri", 2.6, 180, 0, 0, "card", 0, 5],
  [
    1,
    12,
    45,
    "Galle Road Kottu House",
    "Kollupitiya",
    "Wellawatte",
    "Charith",
    4.4,
    300,
    0,
    60,
    "cash",
    3_200,
    5,
  ],
  [1, 18, 40, "Ministry of Crab", "Fort", "Cinnamon Gardens", "Anushka", 4.1, 280, 300, 0, "card", 0, 5],
  [1, 19, 55, "Pilawoos", "Kollupitiya", "Havelock Town", "Dinesh", 3.3, 220, 0, 80, "cash", 2_640, 3],
  [1, 20, 50, "Saraswathie Lodge", "Bambalapitiya", "Bambalapitiya", "Lakshmi", 1.0, 80, 0, 80, "card", 0, 5],
  [
    2,
    12,
    10,
    "Upali's by Nawaloka",
    "Cinnamon Gardens",
    "Kollupitiya",
    "Hiran",
    1.9,
    140,
    0,
    0,
    "card",
    0,
    5,
  ],
  [
    2,
    13,
    25,
    "Barista Kollupitiya",
    "Kollupitiya",
    "Wellawatte",
    "Sanduni",
    4.0,
    270,
    100,
    0,
    "cash",
    1_780,
    5,
  ],
  [
    2,
    19,
    15,
    "Galle Road Kottu House",
    "Kollupitiya",
    "Bambalapitiya",
    "Kasun",
    2.7,
    190,
    0,
    80,
    "card",
    0,
    4,
  ],
];

const HOME_POINT = P(255, 120);

const pts = {
  Kollupitiya: P(150, 60),
  Bambalapitiya: P(150, 300),
  "Cinnamon Gardens": P(340, 175),
  "Havelock Town": P(340, 395),
  Wellawatte: P(150, 395),
  Dehiwala: P(150, 500),
  Fort: P(255, 20),
} as Record<string, MapPoint>;

export function seedTrips(now = Date.now()): Trip[] {
  return rows.map((r, i) => {
    const [
      daysAgo,
      h,
      m,
      restaurant,
      pickupArea,
      dropoffArea,
      customer,
      km,
      dist,
      tip,
      boost,
      payment,
      cash,
      rating,
    ] = r;
    const accepted = daysAgo === 0 ? todayAt(h, m, now) : daysAgoAt(daysAgo, h, m, now);
    const minutes = Math.round(12 + km * 4);
    return {
      id: `T-${8800 - i}`,
      orderNumber: `KD-${3100 + i * 37}`,
      restaurantName: restaurant,
      pickupArea,
      dropoffArea,
      customerFirstName: customer,
      km,
      pay: { base: 180, distance: dist, tip, boost },
      payment,
      cashCollected: cash,
      acceptedAt: accepted,
      arrivedAtRestaurantAt: accepted + 6 * 60_000,
      pickedUpAt: accepted + 11 * 60_000,
      deliveredAt: accepted + minutes * 60_000,
      proof: i % 3 === 1 ? "photo" : "code",
      customerRating: rating,
      from: HOME_POINT,
      pickupPoint: pts[pickupArea] ?? HOME_POINT,
      dropoffPoint: pts[dropoffArea] === pts[pickupArea] ? P(340, 60) : (pts[dropoffArea] ?? HOME_POINT),
    };
  });
}

/**
 * Daily history for the earnings charts, days ago 1…30. Deterministic so the chart doesn't jump
 * between visits. Today comes from the trips list instead.
 */
export function historyDay(daysAgo: number) {
  const seed = (daysAgo * 9301 + 49297) % 233280;
  const r = seed / 233280;
  const weekday = new Date(daysAgoAt(daysAgo, 12)).getDay();
  const weekend = weekday === 0 || weekday === 6;
  const off = daysAgo % 9 === 4; // a day off now and then
  if (off) return { amount: 0, trips: 0, onlineMinutes: 0, tips: 0 };
  const trips = Math.round((weekend ? 11 : 8) + r * 5);
  const amount = Math.round((trips * (430 + r * 90)) / 10) * 10;
  return {
    amount,
    trips,
    onlineMinutes: Math.round(trips * 34 + r * 60),
    tips: Math.round((trips * r * 60) / 10) * 10,
  };
}

// ---------- Payouts ----------

export function seedPayouts(now = Date.now()): Payout[] {
  const weeks = [
    { amount: 21_840, cashOffset: 0 },
    { amount: 18_420, cashOffset: 4_500 },
    { amount: 23_160, cashOffset: 0 },
    { amount: 19_980, cashOffset: 2_000 },
  ];
  // Payouts land every Tuesday for the week before
  const d = new Date(now);
  const sinceTuesday = (d.getDay() + 5) % 7;
  const lastTuesday = daysAgoAt(sinceTuesday, 10, 0, now);
  return [
    {
      id: "P-next",
      weekOf: "This week",
      paidAt: lastTuesday + 7 * 86_400_000,
      amount: 0,
      cashOffset: 0,
      status: "scheduled" as const,
    },
    ...weeks.map((w, i) => {
      const paidAt = lastTuesday - i * 7 * 86_400_000;
      const weekStart = new Date(paidAt - 8 * 86_400_000);
      return {
        id: `P-${i}`,
        weekOf: weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        paidAt,
        amount: w.amount,
        cashOffset: w.cashOffset,
        status: "paid" as const,
      };
    }),
  ];
}

// ---------- Ratings ----------

export function seedRatings(now = Date.now()): RatingsSummary {
  return {
    overall: 4.9,
    count: 1284,
    breakdown: [91, 6, 2, 1, 0],
    compliments: [
      { label: "Friendly", count: 214 },
      { label: "Careful with the food", count: 187 },
      { label: "Fast", count: 152 },
      { label: "Found us easily", count: 96 },
    ],
    improve: [
      {
        label: "Call when you're close",
        detail: "3 customers asked for a call before you reached the gate.",
      },
      {
        label: "Keep drinks upright",
        detail: "One order had a leaked drink last week. Use the cup holder in your bag.",
      },
    ],
    recent: [
      {
        id: "r1",
        stars: 5,
        comment: "Came right up to the third floor. Thank you.",
        at: todayAt(13, 30, now),
        area: "Bambalapitiya",
      },
      { id: "r2", stars: 4, at: todayAt(13, 35, now), area: "Bambalapitiya" },
      {
        id: "r3",
        stars: 5,
        comment: "Food was still hot.",
        at: daysAgoAt(1, 19, 10, now),
        area: "Cinnamon Gardens",
      },
      {
        id: "r4",
        stars: 3,
        comment: "Took a while to find the lane.",
        at: daysAgoAt(1, 20, 20, now),
        area: "Havelock Town",
      },
    ],
  };
}

// ---------- Support ----------

export const helpTopics: HelpTopic[] = [
  {
    id: "accident",
    title: "I've had an accident",
    summary: "Get safe first. We'll handle the order.",
    steps: [
      "Move off the road if you can. If anyone is hurt, call 1990 for an ambulance.",
      "Call 119 if the police are needed.",
      "Call Kadé rider support. We'll cancel or reassign the order so you don't have to.",
      "Take photos of your vehicle and the place when it's safe. Insurance will ask for them.",
    ],
  },
  {
    id: "unreachable",
    title: "Customer isn't answering",
    summary: "Call twice, message, then wait 5 minutes.",
    steps: [
      "Call through the app twice, a minute apart.",
      'Send a quick message: "I\'m at your gate".',
      "Wait 5 minutes at the address. The app records your waiting time.",
      "Still nothing? Chat with support. We'll tell you whether to leave it or bring it back.",
    ],
  },
  {
    id: "delay",
    title: "Restaurant is running late",
    summary: "Waiting over 10 minutes is paid.",
    steps: [
      'Tap "Order not ready yet" on the pickup screen so the kitchen\'s estimate is recorded.',
      "Waiting time after the first 10 minutes is paid at Rs 10 a minute.",
      "If the wait goes past 20 minutes, chat with support and we'll let the customer know.",
    ],
  },
  {
    id: "payment",
    title: "Problem with pay or cash",
    summary: "Missing pay, wrong cash amount or deposits.",
    steps: [
      "Check the trip's pay breakdown in Trips first.",
      "For a cash mismatch, note the order number and what the customer paid.",
      "Chat with support with the order number. Pay fixes show in the next weekly payout.",
    ],
  },
];

export const supportPhone = "+94 11 750 0500";
