import { Type, type Static, type TSchema } from "typebox";

// App-facing shapes: exactly what apps/restaurant/src/api/types.ts declares, so the app's screens
// stay unchanged. Money is whole rupees; instants are epoch milliseconds (as the app keeps them);
// whole days are ISO dates in Asia/Colombo. Registered with app.addSchema() so the OpenAPI document
// gets named components (#/components/schemas/Ticket).

const Rupees = (description = "Whole rupees (LKR).") => Type.Integer({ description });
const EpochMs = (description = "Epoch milliseconds.") => Type.Number({ description });
const IsoDate = (description = "ISO date (Asia/Colombo), e.g. 2026-10-12.") =>
  Type.String({ description, pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

// ---------- Kitchen tickets ----------

export const TicketLine = Type.Object(
  {
    itemId: Type.String(),
    name: Type.String(),
    qty: Type.Integer(),
    choices: Type.Array(Type.String()),
    note: Type.String(),
    unitPrice: Rupees("Price of one, including paid options."),
  },
  { $id: "TicketLine" },
);

export const TicketRider = Type.Object(
  { name: Type.String(), vehicle: Type.String(), plate: Type.String(), maskedPhone: Type.String() },
  { $id: "TicketRider" },
);

export const TicketStatus = Type.Union([
  Type.Literal("new"),
  Type.Literal("preparing"),
  Type.Literal("ready"),
  Type.Literal("pickedUp"),
  Type.Literal("missed"),
  Type.Literal("rejected"),
]);
export const RejectReason = Type.Union([
  Type.Literal("tooBusy"),
  Type.Literal("soldOut"),
  Type.Literal("closingSoon"),
  Type.Literal("other"),
]);

export const Ticket = Type.Object(
  {
    id: Type.String({ description: "Short number the kitchen calls out, e.g. 2417." }),
    placedAt: EpochMs(),
    acceptBy: EpochMs(),
    status: TicketStatus,
    mode: Type.Union([Type.Literal("delivery"), Type.Literal("pickup")]),
    customerName: Type.String(),
    repeatCount: Type.Integer(),
    lines: Type.Array(Type.Ref("TicketLine")),
    kitchenNote: Type.String(),
    cutlery: Type.Boolean(),
    payment: Type.Union([Type.Literal("card"), Type.Literal("cash")]),
    subtotal: Rupees(),
    acceptedAt: Type.Optional(EpochMs()),
    prepMinutes: Type.Optional(Type.Integer()),
    readyBy: Type.Optional(EpochMs()),
    readyAt: Type.Optional(EpochMs()),
    pickedUpAt: Type.Optional(EpochMs()),
    closedAt: Type.Optional(EpochMs()),
    rejectReason: Type.Optional(RejectReason),
    rejectNote: Type.Optional(Type.String()),
    rider: Type.Optional(Type.Ref("TicketRider")),
    riderArrivesAt: Type.Optional(EpochMs()),
  },
  { $id: "Ticket" },
);
export type Ticket = Static<typeof Ticket>;

// ---------- Menu ----------

export const DishTag = Type.Union([Type.Literal("Vegetarian"), Type.Literal("Spicy")]);

export const MenuItem = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    description: Type.String(),
    price: Rupees(),
    imageId: Type.Optional(Type.String()),
    tags: Type.Array(DishTag),
    optionGroupIds: Type.Array(Type.String()),
    soldOut: Type.Boolean(),
  },
  { $id: "MenuItem" },
);

export const MenuSection = Type.Object(
  { id: Type.String(), name: Type.String(), items: Type.Array(Type.Ref("MenuItem")) },
  { $id: "MenuSection" },
);

export const OptionGroup = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    required: Type.Boolean(),
    max: Type.Integer(),
    choices: Type.Array(Type.Object({ name: Type.String(), price: Rupees() })),
  },
  { $id: "OptionGroup" },
);

export const Menu = Type.Object(
  { sections: Type.Array(Type.Ref("MenuSection")), optionGroups: Type.Array(Type.Ref("OptionGroup")) },
  { $id: "Menu" },
);
export type Menu = Static<typeof Menu>;

export const MenuItemInput = Type.Object(
  {
    id: Type.Optional(Type.String({ description: "Absent: create a new dish." })),
    sectionId: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ maxLength: 1000 }),
    price: Type.Integer({ minimum: 0 }),
    imageId: Type.Optional(Type.String({ description: "Image id, or a data: URL for an uploaded photo." })),
    tags: Type.Array(DishTag),
    optionGroupIds: Type.Array(Type.String()),
  },
  { $id: "MenuItemInput" },
);
export type MenuItemInput = Static<typeof MenuItemInput>;

// ---------- Outlet ----------

export const Weekday = Type.Union([
  Type.Literal("mon"),
  Type.Literal("tue"),
  Type.Literal("wed"),
  Type.Literal("thu"),
  Type.Literal("fri"),
  Type.Literal("sat"),
  Type.Literal("sun"),
]);
const HHMM = Type.String({ pattern: "^\\d{2}:\\d{2}$" });

export const DayHours = Type.Object(
  {
    day: Weekday,
    isOpen: Type.Boolean(),
    ranges: Type.Array(Type.Object({ open: HHMM, close: HHMM }), { maxItems: 4 }),
  },
  { $id: "DayHours" },
);
export type DayHours = Static<typeof DayHours>;

export const Closure = Type.Object(
  { id: Type.String(), date: IsoDate(), reason: Type.String() },
  { $id: "Closure" },
);

export const Outlet = Type.Object(
  {
    name: Type.String(),
    area: Type.String(),
    address: Type.String(),
    phone: Type.String(),
    status: Type.Object({
      busyExtra: Type.Union([Type.Literal(0), Type.Literal(10), Type.Literal(20)]),
      pausedUntil: Type.Union([EpochMs(), Type.Null()]),
    }),
    hours: Type.Array(Type.Ref("DayHours")),
    closures: Type.Array(Type.Ref("Closure")),
  },
  { $id: "Outlet" },
);
export type Outlet = Static<typeof Outlet>;

// ---------- Promotions ----------

export const OfferType = Type.Union([
  Type.Literal("percent"),
  Type.Literal("amount"),
  Type.Literal("bogo"),
  Type.Literal("freeDelivery"),
]);

const offerFields = {
  type: OfferType,
  value: Type.Integer({ minimum: 0, description: "percent: 20 = 20% off. amount: Rs off." }),
  maxDiscount: Rupees("percent: largest discount on one order (0 = no cap)."),
  minOrder: Rupees("Smallest basket that qualifies (0 = any)."),
  buy: Type.Integer({ minimum: 0 }),
  get: Type.Integer({ minimum: 0 }),
  bogoItemId: Type.Optional(Type.String()),
  sectionIds: Type.Array(Type.String()),
  startDate: IsoDate(),
  endDate: IsoDate(),
  budget: Rupees(),
};

export const Offer = Type.Object(
  {
    id: Type.String(),
    ...offerFields,
    spent: Rupees(),
    orders: Type.Integer(),
    endedAt: Type.Optional(EpochMs()),
  },
  { $id: "Offer" },
);
export type Offer = Static<typeof Offer>;

export const OfferInput = Type.Object(offerFields, { $id: "OfferInput" });
export type OfferInput = Static<typeof OfferInput>;

// ---------- Payouts ----------

export const DailySales = Type.Object(
  { date: IsoDate(), orders: Type.Integer(), card: Rupees(), cash: Rupees(), offerCost: Rupees() },
  { $id: "DailySales" },
);

export const Statement = Type.Object(
  {
    id: Type.String(),
    from: IsoDate(),
    to: IsoDate(),
    orders: Type.Integer(),
    gross: Rupees(),
    commission: Rupees(),
    offerCost: Rupees(),
    net: Rupees(),
    status: Type.Union([Type.Literal("paid"), Type.Literal("pending")]),
    payDate: IsoDate(),
  },
  { $id: "Statement" },
);

// ---------- Reviews ----------

export const Review = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    date: IsoDate(),
    dish: Type.String(),
    stars: Type.Integer(),
    text: Type.String(),
    reply: Type.Optional(Type.Object({ text: Type.String(), at: EpochMs() })),
  },
  { $id: "Review" },
);

// ---------- Staff, settings, onboarding ----------

export const StaffRole = Type.Union([
  Type.Literal("owner"),
  Type.Literal("manager"),
  Type.Literal("kitchen"),
]);

export const StaffMember = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    phone: Type.String(),
    role: StaffRole,
    lastActive: Type.Union([EpochMs(), Type.Null()]),
  },
  { $id: "StaffMember" },
);

export const PartnerSettings = Type.Object(
  {
    devices: Type.Object({
      autoPrint: Type.Boolean(),
      printerName: Type.String(),
      paperWidth: Type.Union([Type.Literal("58"), Type.Literal("80")]),
      copies: Type.Union([Type.Literal(1), Type.Literal(2)]),
    }),
    notifications: Type.Object({
      smsPaused: Type.Boolean(),
      emailStatements: Type.Boolean(),
      newReviews: Type.Boolean(),
      lowRatings: Type.Boolean(),
    }),
  },
  { $id: "PartnerSettings" },
);
export type PartnerSettings = Static<typeof PartnerSettings>;

export const BusinessType = Type.Union([
  Type.Literal("restaurant"),
  Type.Literal("cafe"),
  Type.Literal("bakery"),
  Type.Literal("homeKitchen"),
  Type.Literal("cloudKitchen"),
]);

export const PartnerApplication = Type.Object(
  {
    business: Type.Object({
      name: Type.String({ minLength: 1 }),
      type: BusinessType,
      address: Type.String(),
      city: Type.String(),
      brNumber: Type.String(),
    }),
    owner: Type.Object({
      name: Type.String({ minLength: 1 }),
      phone: Type.String({ minLength: 1 }),
      email: Type.String(),
      nic: Type.String(),
    }),
    documents: Type.Object({
      registration: Type.String(),
      foodSafety: Type.String(),
      ownerId: Type.String(),
    }),
    bank: Type.Object({
      bank: Type.String(),
      branch: Type.String(),
      accountName: Type.String(),
      accountNumber: Type.String(),
    }),
    menu: Type.Object({
      method: Type.Union([Type.Literal("file"), Type.Literal("photo"), Type.Literal("later")]),
      fileName: Type.String(),
    }),
  },
  { $id: "PartnerApplication" },
);
export type PartnerApplication = Static<typeof PartnerApplication>;

export const SubmittedApplication = Type.Object(
  { reference: Type.String(), submittedAt: EpochMs(), businessName: Type.String(), phone: Type.String() },
  { $id: "SubmittedApplication" },
);

export const Me = Type.Object(
  {
    userId: Type.String(),
    name: Type.String(),
    roles: Type.Array(Type.String()),
    outletId: Type.String(),
    outletName: Type.String(),
  },
  { $id: "Me" },
);

export const Problem = Type.Object(
  {
    type: Type.String({ format: "uri" }),
    title: Type.String(),
    status: Type.Integer(),
    detail: Type.Optional(Type.String({ description: "User-facing message; show as-is." })),
    code: Type.String({ description: "Stable machine code, e.g. TICKET_MISSED." }),
    instance: Type.Optional(Type.String()),
    traceId: Type.Optional(Type.String()),
  },
  { $id: "Problem", description: "RFC 9457 problem details (application/problem+json)." },
);

export const sharedSchemas = [
  TicketLine,
  TicketRider,
  Ticket,
  MenuItem,
  MenuSection,
  OptionGroup,
  Menu,
  MenuItemInput,
  DayHours,
  Closure,
  Outlet,
  Offer,
  OfferInput,
  DailySales,
  Statement,
  Review,
  StaffMember,
  PartnerSettings,
  PartnerApplication,
  SubmittedApplication,
  Me,
  Problem,
];

/** A typed $ref to a registered schema: OpenAPI sees a reference, handlers keep the static type. */
export function ref<T extends TSchema>(schema: T) {
  const id = (schema as { $id?: string }).$id;
  if (!id) throw new Error("ref() needs a schema with an $id (and app.addSchema)");
  return Type.Unsafe<Static<T>>(Type.Ref(id));
}

/** Error responses for a route, documented as application/problem+json. */
export function problems(...statuses: number[]) {
  return Object.fromEntries(
    statuses.map((s) => [s, { content: { "application/problem+json": { schema: ref(Problem) } } }]),
  );
}
