// Demo data, shaped like the apps' mocks (apps/customer/src/api, apps/admin/src/api/mock) so the
// screens look the same on live data. Ids follow CONVENTIONS.md "Seeded ids":
//   Keycloak demo users (fixed subs)       -> 00000000-0000-7000-8005-<N, 12 digits> (dilini 1 … admin 8)
//   customers without logins (C-N)         -> 00000000-0000-7000-8002-<N, 12 digits>
//   restaurants (favourites)               -> 00000000-0000-7000-8000-<N, 12 digits>
//   staff without logins (S-N, profile-only) -> 00000000-0000-7000-8006-<N, 12 digits>
import { FraudFlagKind, FraudFlagStatus } from "@kade/proto/kade/profile/v1/profile_service";
import { AuditRecordType, StaffRole, StaffStatus } from "@kade/proto/kade/identity/v1/identity_service";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const seedId = (group: string, n: number): string =>
  `00000000-0000-7000-${group}-${String(n).padStart(12, "0")}`;
export const seedCustomerId = (n: number): string => seedId("8002", n);
export const seedStaffId = (n: number): string => seedId("8006", n);
export const keycloakUserId = (n: number): string => seedId("8005", n);
export const restaurantId = (n: number): string => seedId("8000", n);

export interface DemoAddress {
  zoneId: string;
  label: string;
  line: string;
  area: string;
  note: string;
  lat: number;
  lng: number;
}

/** What a demo Keycloak customer gets the first time profile sees them. */
export interface DemoCustomerProfile {
  /** Keycloak subject (fixed in deploy/compose/keycloak/kade-realm.json). */
  id: string;
  username: string;
  email: string;
  name: string;
  phone: string;
  addresses: DemoAddress[];
  credit: { amountMinor: number; label: string; daysAgo: number }[];
  favourites: "configured"; // SEED_FAVOURITE_RESTAURANT_IDS
}

export const DEMO_CUSTOMERS: DemoCustomerProfile[] = [
  {
    id: keycloakUserId(1),
    username: "dilini",
    email: "dilini@kade.test",
    name: "Dilini Perera",
    phone: "+94771234567",
    addresses: [
      {
        zoneId: "c03",
        label: "Home",
        line: "42 Galle Rd, Colombo 03",
        area: "Kollupitiya",
        note: "Green gate next to the pharmacy",
        lat: 6.9114,
        lng: 79.8496,
      },
      {
        zoneId: "c07",
        label: "Work",
        line: "18 Bauddhaloka Mawatha, Colombo 07",
        area: "Cinnamon Gardens",
        note: "Leave it at reception, 3rd floor",
        lat: 6.9018,
        lng: 79.8667,
      },
    ],
    credit: [{ amountMinor: 50_000, label: "Kasun's first order, from your invite", daysAgo: 4 }],
    favourites: "configured",
  },
];

export const demoProfileByEmail = (email: string): DemoCustomerProfile | undefined =>
  DEMO_CUSTOMERS.find((d) => d.email === email.trim().toLowerCase());

/** Demo Keycloak staff users, mirrored into the staff table with their Keycloak subject as id. */
export const DEMO_KEYCLOAK_STAFF: SeedStaffLogin[] = [
  {
    id: keycloakUserId(8),
    name: "Platform Admin",
    email: "admin@kade.test",
    role: StaffRole.STAFF_ROLE_ADMIN,
    title: "Platform admin",
  },
  {
    id: keycloakUserId(5),
    name: "Ops Desk",
    email: "ops@kade.test",
    role: StaffRole.STAFF_ROLE_OPS,
    title: "Ops desk",
  },
  {
    id: keycloakUserId(6),
    name: "Finance Desk",
    email: "finance@kade.test",
    role: StaffRole.STAFF_ROLE_FINANCE,
    title: "Finance desk",
  },
  {
    id: keycloakUserId(7),
    name: "Support Desk",
    email: "support@kade.test",
    role: StaffRole.STAFF_ROLE_SUPPORT,
    title: "Support desk",
  },
];

export interface SeedStaffLogin {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  title: string;
}

// ---------------------------------------------------------------------------------------------
// Admin console customers (apps/admin/src/api/mock/partners.ts)
// ---------------------------------------------------------------------------------------------

const CUSTOMER_NAMES = [
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

// Area, zone id (CONVENTIONS "Zone ids"), lat, lng.
const AREAS: [string, string, number, number][] = [
  ["Kollupitiya", "c03", 6.9147, 79.8501],
  ["Bambalapitiya", "c04", 6.8905, 79.8562],
  ["Wellawatte", "c06", 6.8746, 79.8605],
  ["Cinnamon Gardens", "c07", 6.9077, 79.8664],
  ["Borella", "c08", 6.9147, 79.8778],
  ["Havelock Town", "c05", 6.8833, 79.8667],
  ["Dehiwala", "deh", 6.8511, 79.8659],
  ["Rajagiriya", "raj", 6.9094, 79.8945],
  ["Kotahena", "c13", 6.9497, 79.8611],
  ["Slave Island", "c02", 6.9238, 79.8507],
  ["Nugegoda", "nug", 6.8649, 79.8997],
  ["Fort", "c01", 6.9344, 79.8428],
];

/** Small deterministic PRNG (mulberry32) so the seed is identical on every machine. */
function seeded(seed: number): { int(min: number, max: number): number; chance(p: number): boolean } {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
  };
}

export interface SeedFlag {
  kind: FraudFlagKind;
  detail: string;
  raisedAgoMs: number;
  status: FraudFlagStatus;
  resolution?: string;
}

export interface SeedCustomer {
  id: string;
  number: number;
  name: string;
  phone: string;
  email: string;
  area: string;
  address: DemoAddress;
  joinedAt: Date;
  ordersCount: number;
  spendMinor: number;
  lastOrderAgoMs: number;
  creditMinor: number;
  blocked: boolean;
  blockReason: string;
  flags: SeedFlag[];
}

export function seedCustomers(): SeedCustomer[] {
  const list = CUSTOMER_NAMES.map((name, i): SeedCustomer => {
    const r = seeded(900 + i);
    const [first = "", last = ""] = name.toLowerCase().split(" ");
    const ordersCount = r.int(2, 140);
    const [area, zoneId, lat, lng] = AREAS[i % AREAS.length]!;
    const number = 2040 + i * 7;
    const domains = ["gmail.com", "yahoo.com", "outlook.com"];
    return {
      id: seedCustomerId(number),
      number,
      name,
      phone: `+947${r.int(0, 8)}${r.int(100, 999)}${r.int(1000, 9999)}`,
      email: `${first}.${last.replace(/\s/g, "").slice(0, 1)}${r.int(10, 99)}@${domains[r.int(0, 2)]}`,
      area,
      address: {
        zoneId,
        label: "Home",
        line: `${r.int(2, 180)} ${["Galle Rd", "Duplication Rd", "Havelock Rd", "Ward Pl", "Marine Dr"][r.int(0, 4)]}, ${area}`,
        area,
        note: "",
        lat: lat + r.int(-50, 50) / 10_000,
        lng: lng + r.int(-50, 50) / 10_000,
      },
      joinedAt: new Date(Date.UTC(2024 + r.int(0, 2), r.int(0, 11), r.int(1, 28))),
      ordersCount,
      spendMinor: ordersCount * r.int(1400, 3200) * 100,
      lastOrderAgoMs: r.int(1, 30 * 24) * HOUR,
      creditMinor: r.chance(0.25) ? r.int(1, 6) * 100 * 100 : 0,
      blocked: false,
      blockReason: "",
      flags: [],
    };
  });
  list[7]!.flags.push({
    kind: FraudFlagKind.FRAUD_FLAG_KIND_REFUNDS,
    detail: '6 refund requests in 14 days, all "missing item", Rs 7,850 refunded',
    raisedAgoMs: 5 * HOUR,
    status: FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN,
  });
  list[12]!.flags.push({
    kind: FraudFlagKind.FRAUD_FLAG_KIND_CANCELLATIONS,
    detail: "5 cash orders cancelled at the door this month; riders were paid Rs 1,250 in failed-trip fees",
    raisedAgoMs: DAY,
    status: FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN,
  });
  list[19]!.flags.push(
    {
      kind: FraudFlagKind.FRAUD_FLAG_KIND_PAYMENT_FAILURES,
      detail: "4 cards declined in 2 hours, 3 different issuing banks",
      raisedAgoMs: 2 * HOUR,
      status: FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN,
    },
    {
      kind: FraudFlagKind.FRAUD_FLAG_KIND_REFUNDS,
      detail: "3 refund requests in 7 days",
      raisedAgoMs: 9 * DAY,
      status: FraudFlagStatus.FRAUD_FLAG_STATUS_CLEARED,
      resolution: "Checked with the restaurant; items were missing. Cleared by Kasun.",
    },
  );
  list[30]!.blocked = true;
  list[30]!.blockReason = "Used 11 new accounts to claim FIRSTKOTTU";
  list[30]!.flags.push({
    kind: FraudFlagKind.FRAUD_FLAG_KIND_REFUNDS,
    detail: "Same phone number linked to 11 new-customer vouchers",
    raisedAgoMs: 12 * DAY,
    status: FraudFlagStatus.FRAUD_FLAG_STATUS_ACTIONED,
    resolution: "Blocked by Dilini",
  });
  return list;
}

// ---------------------------------------------------------------------------------------------
// Team, permissions and audit (apps/admin/src/api/mock/partners.ts, backOffice.ts)
// ---------------------------------------------------------------------------------------------

export interface SeedStaff {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  title: string;
  status: StaffStatus;
  lastActiveAgoMs?: number;
}

export const SEED_STAFF: SeedStaff[] = [
  ["Dilini Perera", "dilini@kade.lk", StaffRole.STAFF_ROLE_OPS, "Ops lead", 0],
  ["Kasun Wickramasinghe", "kasun@kade.lk", StaffRole.STAFF_ROLE_ADMIN, "Head of operations", 40 * MIN],
  ["Hasini Fernando", "hasini@kade.lk", StaffRole.STAFF_ROLE_FINANCE, "Finance manager", 3 * HOUR],
  ["Ruwani Silva", "ruwani@kade.lk", StaffRole.STAFF_ROLE_SUPPORT, "Support agent", 2 * MIN],
  ["Imran Lafir", "imran@kade.lk", StaffRole.STAFF_ROLE_SUPPORT, "Support agent", 6 * MIN],
  ["Tharushi Jayawardena", "tharushi@kade.lk", StaffRole.STAFF_ROLE_OPS, "Dispatcher", 1 * MIN],
  ["Nalin Gunasekara", "nalin@kade.lk", StaffRole.STAFF_ROLE_OPS, "Rider onboarding", 26 * HOUR],
  ["Shalini Rajaratnam", "shalini@kade.lk", StaffRole.STAFF_ROLE_FINANCE, "Accounts assistant", undefined],
].map(([name, email, role, title, ago], i) => ({
  id: seedStaffId(i + 1),
  name: name as string,
  email: email as string,
  role: role as StaffRole,
  title: title as string,
  status: ago === undefined ? StaffStatus.STAFF_STATUS_INVITED : StaffStatus.STAFF_STATUS_ACTIVE,
  lastActiveAgoMs: ago as number | undefined,
}));

export const PERMISSIONS: { id: string; label: string; group: string }[] = [
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

export const DEFAULT_MATRIX: { role: StaffRole; permissionIds: string[] }[] = [
  { role: StaffRole.STAFF_ROLE_ADMIN, permissionIds: PERMISSIONS.map((p) => p.id) },
  {
    role: StaffRole.STAFF_ROLE_OPS,
    permissionIds: [
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
  },
  {
    role: StaffRole.STAFF_ROLE_FINANCE,
    permissionIds: [
      "orders.view",
      "orders.refundSmall",
      "orders.refundAny",
      "partners.commission",
      "finance.payouts",
      "finance.cash",
    ],
  },
  {
    role: StaffRole.STAFF_ROLE_SUPPORT,
    permissionIds: ["orders.view", "orders.refundSmall", "customers.credit"],
  },
];

export interface SeedAudit {
  agoMs: number;
  staff: number; // S-N
  action: string;
  recordType: AuditRecordType;
  recordId: string;
  detail: string;
}

export const SEED_AUDIT: SeedAudit[] = [
  {
    agoMs: 48 * MIN,
    staff: 1,
    action: "Paused restaurant",
    recordType: AuditRecordType.AUDIT_RECORD_TYPE_RESTAURANT,
    recordId: restaurantId(13),
    detail: "Fryer repair, asked by the owner",
  },
  {
    agoMs: 70 * MIN,
    staff: 5,
    action: "Issued Rs 300 Kadé credit",
    recordType: AuditRecordType.AUDIT_RECORD_TYPE_CUSTOMER,
    recordId: seedCustomerId(2040 + 16 * 7),
    detail: "Late delivery",
  },
  {
    agoMs: 2 * HOUR,
    staff: 1,
    action: "Turned on dinner peak surcharge",
    recordType: AuditRecordType.AUDIT_RECORD_TYPE_ZONE,
    recordId: "s2",
    detail: "",
  },
  {
    agoMs: 5 * HOUR,
    staff: 7,
    action: "Approved rider documents",
    recordType: AuditRecordType.AUDIT_RECORD_TYPE_RIDER,
    recordId: "RAP-301",
    detail: "Driving licence, revenue licence, insurance",
  },
  {
    agoMs: 6 * HOUR,
    staff: 2,
    action: "Changed commission from 18% to 20%",
    recordType: AuditRecordType.AUDIT_RECORD_TYPE_RESTAURANT,
    recordId: restaurantId(9),
    detail: "New contract from 1 October",
  },
  {
    agoMs: 9 * HOUR,
    staff: 1,
    action: "Paused voucher",
    recordType: AuditRecordType.AUDIT_RECORD_TYPE_VOUCHER,
    recordId: "RAINYDAY",
    detail: "Budget nearly spent",
  },
  {
    agoMs: 22 * HOUR,
    staff: 2,
    action: "Invited staff member",
    recordType: AuditRecordType.AUDIT_RECORD_TYPE_TEAM,
    recordId: seedStaffId(8),
    detail: "Finance",
  },
  {
    agoMs: 26 * HOUR,
    staff: 3,
    action: "Approved payout batch",
    recordType: AuditRecordType.AUDIT_RECORD_TYPE_PAYOUT,
    recordId: "PB-40",
    detail: "15 restaurants",
  },
  {
    agoMs: 12 * DAY,
    staff: 1,
    action: "Blocked customer",
    recordType: AuditRecordType.AUDIT_RECORD_TYPE_CUSTOMER,
    recordId: seedCustomerId(2040 + 30 * 7),
    detail: "Used 11 new accounts to claim FIRSTKOTTU",
  },
];

export const TIME = { MIN, HOUR, DAY };
