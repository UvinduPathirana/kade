// Finance, promotions, support, home feed and audit data.
import { DAY, HOUR, MIN, simNow } from "./clock";
import { orders } from "./orders";
import { customers, photos, restaurants, riders, staff } from "./partners";
import { seeded } from "./random";
import type {
  AuditEntry,
  CashRecord,
  Collection,
  HomeCategory,
  Macro,
  PayoutBatch,
  RiderSettlement,
  Ticket,
  Voucher,
} from "../types";

const now = simNow();

/* ---------- Restaurant payouts (payouts service) ---------- */

function batch(
  id: string,
  week: string,
  payDate: string,
  status: PayoutBatch["status"],
  seed: number,
): PayoutBatch {
  const r = seeded(seed);
  return {
    id,
    week,
    payDate,
    status,
    approvedBy: status === "draft" ? undefined : "Hasini Fernando",
    lines: restaurants
      .filter((x) => x.id !== 15)
      .map((x) => {
        const count = Math.round(x.ordersWeek * (0.85 + r.next() * 0.3));
        const gross = count * r.int(1300, 2900);
        const commission = Math.round((gross * x.commission) / 100);
        const adjustments = r.chance(0.35) ? -r.int(1, 8) * 450 : 0;
        return {
          restaurantId: x.id,
          orders: count,
          gross,
          commission,
          adjustments,
          net: gross - commission + adjustments,
        };
      }),
  };
}

export const payoutBatches: PayoutBatch[] = [
  batch("PB-41", "28 Sep to 4 Oct", "2026-10-13", "draft", 41),
  batch("PB-40", "21 Sep to 27 Sep", "2026-10-06", "paid", 40),
  batch("PB-39", "14 Sep to 20 Sep", "2026-09-29", "paid", 39),
];

/* ---------- Rider settlements and cash (payouts service) ---------- */

export const riderSettlements: RiderSettlement[] = riders
  .filter((x) => x.status !== "suspended")
  .slice(0, 40)
  .map((x, i) => {
    const r = seeded(700 + i);
    const trips = x.tripsWeek;
    const earnings = trips * r.int(290, 360) + (trips > 50 ? 2500 : 0);
    const cashHeld = i === 5 ? 21450 : i === 17 ? 18200 : r.int(2, 30) * 750;
    return {
      riderId: x.id,
      week: "28 Sep to 4 Oct",
      trips,
      earnings,
      cashHeld,
      status: i % 7 === 3 ? "settled" : "open",
    };
  });

export const cashRecords: CashRecord[] = [];
riders.slice(0, 34).forEach((x, i) => {
  const r = seeded(1200 + i);
  for (const [d, date] of [
    [2, "2026-10-08"],
    [1, "2026-10-09"],
  ] as const) {
    const collected = r.int(4, 22) * 650;
    let deposited: number | null = collected;
    if ((i + d) % 9 === 0) deposited = collected - r.int(1, 6) * 150;
    if (d === 1 && i % 6 === 2) deposited = null;
    cashRecords.push({
      id: `CR-${date.slice(8)}-${x.id.slice(2)}`,
      riderId: x.id,
      date,
      collected,
      deposited,
      bankRef: deposited === null ? undefined : `BOC${date.replaceAll("-", "")}${r.int(10, 99)}`,
    });
  }
});

/* ---------- Vouchers (promotions service) ---------- */

export const vouchers: Voucher[] = [
  {
    code: "KADE100",
    description: "Rs 100 off orders of Rs 1,000 or more",
    type: "fixed",
    value: 100,
    minOrder: 1000,
    restaurantIds: [],
    newCustomersOnly: false,
    startsOn: "2026-09-01",
    endsOn: "2026-12-31",
    uses: 4182,
    limit: 10000,
    budget: 1000000,
    spent: 418200,
    status: "active",
  },
  {
    code: "FIRSTKOTTU",
    description: "15% off at Galle Road Kottu House, up to Rs 500, first order",
    type: "percent",
    value: 15,
    maxDiscount: 500,
    minOrder: 0,
    restaurantIds: [1],
    newCustomersOnly: true,
    startsOn: "2026-08-15",
    endsOn: "2026-11-30",
    uses: 1296,
    limit: 3000,
    budget: 500000,
    spent: 231840,
    status: "active",
  },
  {
    code: "MARKET500",
    description: "Rs 500 off a first Kadé Market shop of Rs 3,000 or more",
    type: "fixed",
    value: 500,
    minOrder: 3000,
    restaurantIds: [15],
    newCustomersOnly: true,
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
    uses: 388,
    limit: 1000,
    budget: 500000,
    spent: 194000,
    status: "active",
  },
  {
    code: "RAINYDAY",
    description: "Free delivery on rainy evenings",
    type: "freeDelivery",
    value: 0,
    minOrder: 1500,
    restaurantIds: [],
    newCustomersOnly: false,
    startsOn: "2026-10-01",
    endsOn: "2026-11-30",
    uses: 912,
    limit: 2500,
    budget: 300000,
    spent: 287400,
    status: "paused",
  },
  {
    code: "WATALAPPAN2",
    description: "Rs 200 off two watalappan at Watalappan Bar",
    type: "fixed",
    value: 200,
    minOrder: 900,
    restaurantIds: [12],
    newCustomersOnly: false,
    startsOn: "2026-10-17",
    endsOn: "2026-10-31",
    uses: 0,
    limit: 800,
    budget: 160000,
    spent: 0,
    status: "scheduled",
  },
  {
    code: "AVURUDU26",
    description: "20% off rice and curry for Avurudu, up to Rs 400",
    type: "percent",
    value: 20,
    maxDiscount: 400,
    minOrder: 1000,
    restaurantIds: [2, 14],
    newCustomersOnly: false,
    startsOn: "2026-04-10",
    endsOn: "2026-04-20",
    uses: 2210,
    limit: 2500,
    budget: 750000,
    spent: 702300,
    status: "ended",
  },
];

/* ---------- Support (support service) ---------- */

const todays = orders.filter((o) => o.placedAt > now - 6 * HOUR);
const pickOrder = (i: number) => todays[(i * 7) % todays.length]!;
const sla = { urgent: 15 * MIN, high: HOUR, normal: 4 * HOUR, low: DAY };

function ticket(
  n: number,
  t: Omit<Ticket, "id" | "slaDueAt" | "messages" | "status"> & {
    status?: Ticket["status"];
    body: string;
    extra?: Ticket["messages"];
  },
): Ticket {
  const { body, extra = [], status = "open", ...rest } = t;
  return {
    ...rest,
    id: `T-${3300 + n}`,
    status,
    slaDueAt: t.openedAt + sla[t.priority],
    messages: [
      { id: `m${n}-1`, at: t.openedAt, from: "requester", author: t.requester.name, body },
      ...extra,
    ],
  };
}

const cust = (i: number) => {
  const c = customers[i]!;
  return { kind: "customer" as const, id: c.id, name: c.name };
};

export const tickets: Ticket[] = [
  ticket(1, {
    subject: "Order 40 minutes late, rider not answering",
    category: "late",
    priority: "urgent",
    requester: cust(3),
    orderId: pickOrder(1).id,
    openedAt: now - 11 * MIN,
    body: "My order was meant to be here at 7.20. The app still says on the way and the rider isn't picking up. Kids are waiting for dinner.",
  }),
  ticket(2, {
    subject: "Missing cheese kottu",
    category: "missingItem",
    priority: "high",
    requester: cust(5),
    orderId: pickOrder(2).id,
    openedAt: now - 38 * MIN,
    assigneeId: "S-4",
    body: "I ordered two cheese kottu and only one came. The bag was sealed.",
    extra: [
      {
        id: "m2-2",
        at: now - 31 * MIN,
        from: "agent",
        author: "Ruwani Silva",
        body: "Sorry about that, Arjun. I've asked the restaurant to check the docket. I'll come back to you within 15 minutes.",
      },
    ],
  }),
  ticket(3, {
    subject: "Charged twice for one order",
    category: "payment",
    priority: "high",
    requester: cust(9),
    orderId: pickOrder(3).id,
    openedAt: now - 52 * MIN,
    body: "I see two charges of the same amount from Kadé on my Commercial Bank card.",
  }),
  ticket(4, {
    subject: "Customer gave wrong gate, waiting 10 min",
    category: "rider",
    priority: "urgent",
    requester: { kind: "rider", id: riders[2]!.id, name: riders[2]!.name },
    orderId: pickOrder(4).id,
    openedAt: now - 6 * MIN,
    assigneeId: "S-1",
    body: "Address says Lauries Road but customer is at Lauries Place. Called twice, no answer. Do I wait?",
  }),
  ticket(5, {
    subject: "Got chicken biryani instead of mutton",
    category: "wrongItem",
    priority: "normal",
    requester: cust(11),
    orderId: pickOrder(5).id,
    openedAt: now - 2 * HOUR,
    assigneeId: "S-5",
    body: "Ordered mutton biryani, received chicken. Paid Rs 1,950 for the mutton.",
  }),
  ticket(6, {
    subject: "Tablet keeps logging out",
    category: "restaurant",
    priority: "high",
    requester: { kind: "restaurant", id: "7", name: "Wood & Fire Pizza" },
    openedAt: now - 24 * MIN,
    body: "Our tablet logged out three times tonight and we missed orders. Can someone call us?",
  }),
  ticket(7, {
    subject: "Can't add a new card",
    category: "account",
    priority: "low",
    requester: cust(14),
    openedAt: now - 5 * HOUR,
    body: "When I add my Sampath card it says try again later.",
  }),
  ticket(8, {
    subject: "Food arrived cold",
    category: "late",
    priority: "normal",
    requester: cust(16),
    orderId: pickOrder(8).id,
    openedAt: now - 3 * HOUR,
    assigneeId: "S-1",
    status: "pending",
    body: "The noodles were cold and soggy. Took over an hour.",
    extra: [
      {
        id: "m8-2",
        at: now - 2 * HOUR - 40 * MIN,
        from: "agent",
        author: "Dilini Perera",
        body: "Sorry Yohan. Could you send a photo of the food so I can sort this out with the restaurant?",
      },
      {
        id: "m8-3",
        at: now - 2 * HOUR - 39 * MIN,
        from: "system",
        author: "Kadé",
        body: "Waiting for the customer to reply.",
      },
    ],
  }),
  ticket(9, {
    subject: "Cash payout for last week is short",
    category: "payment",
    priority: "normal",
    requester: { kind: "rider", id: riders[9]!.id, name: riders[9]!.name },
    openedAt: now - 7 * HOUR,
    body: "My settlement shows Rs 2,100 less than I worked out. I deposited Rs 9,750 on Thursday at BOC Wellawatte.",
  }),
  ticket(10, {
    subject: "Promo code FIRSTKOTTU not working",
    category: "account",
    priority: "low",
    requester: cust(21),
    openedAt: now - 9 * HOUR,
    status: "resolved",
    resolution: "Explained the code is for first orders only.",
    body: "It says the code only works on first orders but I've never used it.",
    extra: [
      {
        id: "m10-2",
        at: now - 8 * HOUR,
        from: "agent",
        author: "Imran Lafir",
        body: "Hi Dulaj, FIRSTKOTTU is for your first order on Kadé, and this account placed one in August. KADE100 still works on orders over Rs 1,000.",
      },
    ],
  }),
  ticket(11, {
    subject: "Rider was very polite, want to tip more",
    category: "rider",
    priority: "low",
    requester: cust(24),
    orderId: pickOrder(11).id,
    openedAt: now - 70 * MIN,
    body: "Is there a way to add a tip after rating? Kasun went out of his way in the rain.",
  }),
  ticket(12, {
    subject: "Spilled curry in the bag",
    category: "missingItem",
    priority: "high",
    requester: cust(27),
    orderId: pickOrder(12).id,
    openedAt: now - 15 * MIN,
    body: "The fish curry leaked all over the rice. Half of it is not eatable.",
  }),
];

export const macros: Macro[] = [
  {
    id: "mc1",
    title: "Apology, looking into it",
    body: "Sorry about this. I'm checking with the restaurant and rider now and will reply within 15 minutes.",
  },
  {
    id: "mc2",
    title: "Refund issued",
    body: "I've refunded {amount} to your {method}. Card refunds take 5 to 7 working days to show; Kadé credit is ready to use now.",
  },
  {
    id: "mc3",
    title: "Ask for a photo",
    body: "Could you send a photo of the food and the receipt sticker on the bag? That helps us sort it out with the restaurant.",
  },
  {
    id: "mc4",
    title: "Rider: wait 5 more minutes",
    body: "Please wait 5 more minutes at the gate. I'm calling the customer now. If there's no answer, mark the order undeliverable and you'll still be paid for the trip.",
  },
  {
    id: "mc5",
    title: "Double charge: pending hold",
    body: "The second charge is a pending hold from your bank, not a payment. It drops off within 3 working days. If it's still there after that, reply here and I'll raise it with our payments team.",
  },
];

/* ---------- Home feed (catalogue service) ---------- */

export const homeCategories: HomeCategory[] = [
  { id: "rice", label: "Rice & curry", imageId: photos.curry, visible: true },
  { id: "kottu", label: "Kottu", imageId: photos.kottu, visible: true },
  { id: "shorteats", label: "Short eats", imageId: photos.samosa, visible: true },
  { id: "biryani", label: "Biryani", imageId: photos.biryani, visible: true },
  { id: "seafood", label: "Seafood", imageId: photos.fishCurry, visible: true },
  { id: "burgers", label: "Burgers", imageId: photos.burger, visible: true },
  { id: "pizza", label: "Pizza", imageId: photos.pizza, visible: true },
  { id: "asian", label: "Noodles & ramen", imageId: photos.ramen, visible: true },
  { id: "sushi", label: "Sushi", imageId: photos.sushi, visible: true },
  { id: "healthy", label: "Salads & bowls", imageId: photos.bowl, visible: true },
  { id: "dessert", label: "Desserts", imageId: photos.donut, visible: true },
  { id: "grocery", label: "Grocery", imageId: photos.grocery, visible: false },
];

export const imageLibrary = Object.entries(photos).map(([name, id]) => ({ name, id }));

export const collections: Collection[] = [
  {
    id: "col-1",
    title: "Rainy evening comfort",
    subtitle: "Kottu, curry and something sweet",
    placement: "banner",
    source: "handPicked",
    restaurantIds: [1, 2, 12, 14],
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
    visible: true,
  },
  {
    id: "col-2",
    title: "Here in 20 minutes",
    subtitle: "Kitchens close to you",
    placement: "shelf",
    source: "rules",
    rule: { maxEta: 20 },
    restaurantIds: [],
    startsOn: "2026-09-01",
    visible: true,
  },
  {
    id: "col-3",
    title: "Offers near you",
    subtitle: "Deals from restaurants in your area",
    placement: "shelf",
    source: "rules",
    rule: { offersOnly: true },
    restaurantIds: [],
    startsOn: "2026-09-01",
    visible: true,
  },
  {
    id: "col-4",
    title: "Top rated rice and curry",
    subtitle: "4.7 stars and up",
    placement: "shelf",
    source: "rules",
    rule: { category: "rice", minRating: 4.7 },
    restaurantIds: [],
    startsOn: "2026-09-15",
    visible: true,
  },
  {
    id: "col-5",
    title: "Watalappan week",
    subtitle: "Rs 200 off two with WATALAPPAN2",
    placement: "banner",
    source: "handPicked",
    restaurantIds: [12, 4],
    startsOn: "2026-10-17",
    endsOn: "2026-10-31",
    visible: true,
  },
];

/* ---------- Audit log (identity service) ---------- */

const who = (id: string) => staff.find((s) => s.id === id)!.name;

export const auditLog: AuditEntry[] = [
  {
    id: "A-1",
    at: now - 12 * MIN,
    actor: who("S-4"),
    action: "Refunded Rs 1,450 to card",
    recordType: "order",
    recordId: pickOrder(20).id,
    detail: "Missing item",
  },
  {
    id: "A-2",
    at: now - 26 * MIN,
    actor: who("S-6"),
    action: "Assigned another rider",
    recordType: "order",
    recordId: pickOrder(21).id,
    detail: "First rider had a puncture",
  },
  {
    id: "A-3",
    at: now - 48 * MIN,
    actor: who("S-1"),
    action: "Paused restaurant",
    recordType: "restaurant",
    recordId: "13",
    detail: "Fryer repair, asked by the owner",
  },
  {
    id: "A-4",
    at: now - 70 * MIN,
    actor: who("S-5"),
    action: "Issued Rs 300 Kadé credit",
    recordType: "customer",
    recordId: customers[16]!.id,
    detail: "Late delivery",
  },
  {
    id: "A-5",
    at: now - 2 * HOUR,
    actor: who("S-1"),
    action: "Turned on dinner peak surcharge",
    recordType: "zone",
    recordId: "s2",
  },
  {
    id: "A-6",
    at: now - 3 * HOUR,
    actor: who("S-3"),
    action: "Recorded cash deposit Rs 9,750",
    recordType: "rider",
    recordId: riders[9]!.id,
    detail: "BOC2026100941",
  },
  {
    id: "A-7",
    at: now - 5 * HOUR,
    actor: who("S-7"),
    action: "Approved rider documents",
    recordType: "rider",
    recordId: "RAP-301",
    detail: "Driving licence, revenue licence, insurance",
  },
  {
    id: "A-8",
    at: now - 6 * HOUR,
    actor: who("S-2"),
    action: "Changed commission from 18% to 20%",
    recordType: "restaurant",
    recordId: "9",
    detail: "New contract from 1 October",
  },
  {
    id: "A-9",
    at: now - 9 * HOUR,
    actor: who("S-1"),
    action: "Paused voucher",
    recordType: "voucher",
    recordId: "RAINYDAY",
    detail: "Budget nearly spent",
  },
  {
    id: "A-10",
    at: now - 22 * HOUR,
    actor: who("S-2"),
    action: "Invited staff member",
    recordType: "team",
    recordId: "S-8",
    detail: "Finance",
  },
  {
    id: "A-11",
    at: now - 26 * HOUR,
    actor: who("S-3"),
    action: "Approved payout batch",
    recordType: "payout",
    recordId: "PB-40",
    detail: "15 restaurants",
  },
  {
    id: "A-12",
    at: now - 30 * HOUR,
    actor: who("S-1"),
    action: "Scheduled collection",
    recordType: "content",
    recordId: "col-5",
    detail: "Watalappan week, 17 to 31 Oct",
  },
  {
    id: "A-13",
    at: now - 2 * DAY,
    actor: who("S-4"),
    action: "Cleared fraud flag",
    recordType: "customer",
    recordId: customers[19]!.id,
    detail: "Items were missing",
  },
  {
    id: "A-14",
    at: now - 3 * DAY,
    actor: who("S-1"),
    action: "Closed zone",
    recordType: "zone",
    recordId: "mtl",
    detail: "Not enough riders south of Dehiwala after 7 pm",
  },
  {
    id: "A-15",
    at: now - 4 * DAY,
    actor: who("S-2"),
    action: "Suspended rider",
    recordType: "rider",
    recordId: riders[46]!.id,
    detail: "Three complaints, under review",
  },
  {
    id: "A-16",
    at: now - 12 * DAY,
    actor: who("S-1"),
    action: "Blocked customer",
    recordType: "customer",
    recordId: customers[30]!.id,
    detail: "Voucher abuse with new accounts",
  },
];
