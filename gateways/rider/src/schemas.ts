import { Type, type Static, type TSchema } from "typebox";

// App-facing shapes: exactly what apps/rider/src/api/types.ts declares, so the app's screens stay
// unchanged. Money is whole rupees; instants are epoch milliseconds; positions are map units of the
// illustrated Colombo map (see map.ts). Registered with app.addSchema() for named OpenAPI components.

const Rupees = (description = "Whole rupees (LKR).") => Type.Integer({ description });
const EpochMs = (description = "Epoch milliseconds.") => Type.Number({ description });

export const MapPoint = Type.Object(
  { x: Type.Number({ minimum: 0, maximum: 400 }), y: Type.Number({ minimum: 0, maximum: 600 }) },
  { $id: "MapPoint", description: "Point on the illustrated 400 × 600 Colombo map." },
);
const Point = Type.Ref("MapPoint");

export const Pay = Type.Object(
  { base: Rupees(), distance: Rupees(), tip: Rupees(), boost: Rupees() },
  { $id: "Pay" },
);

export const Payment = Type.Union([Type.Literal("cash"), Type.Literal("card")]);

export const Offer = Type.Object(
  {
    id: Type.String({ description: "Offer id while offered; delivery id once accepted (the job)." }),
    orderNumber: Type.String(),
    restaurant: Type.Object({
      name: Type.String(),
      area: Type.String(),
      address: Type.String(),
      phone: Type.String(),
      point: Point,
    }),
    customer: Type.Object({
      firstName: Type.String(),
      area: Type.String(),
      address: Type.String(),
      note: Type.Optional(Type.String()),
      maskedPhone: Type.String(),
      point: Point,
    }),
    from: Point,
    toPickupKm: Type.Number(),
    tripKm: Type.Number(),
    minutes: Type.Integer(),
    pay: Type.Ref("Pay"),
    payment: Payment,
    cashToCollect: Rupees(),
    customerPaysWith: Type.Optional(Rupees()),
    items: Type.Array(
      Type.Object({
        id: Type.String(),
        qty: Type.Integer(),
        name: Type.String(),
        options: Type.Optional(Type.String()),
      }),
    ),
    sealed: Type.Boolean(),
    notReadyMinutes: Type.Integer(),
    deliveryCode: Type.String({ description: "Always empty: dispatch checks the code server-side." }),
    offeredAt: EpochMs(),
    expiresAt: EpochMs(),
  },
  { $id: "Offer" },
);

export const Trip = Type.Object(
  {
    id: Type.String(),
    orderNumber: Type.String(),
    restaurantName: Type.String(),
    pickupArea: Type.String(),
    dropoffArea: Type.String(),
    customerFirstName: Type.String(),
    km: Type.Number(),
    pay: Type.Ref("Pay"),
    payment: Payment,
    cashCollected: Rupees(),
    acceptedAt: EpochMs(),
    arrivedAtRestaurantAt: EpochMs(),
    pickedUpAt: EpochMs(),
    deliveredAt: EpochMs(),
    proof: Type.Union([Type.Literal("code"), Type.Literal("photo")]),
    customerRating: Type.Optional(Type.Integer()),
    from: Point,
    pickupPoint: Point,
    dropoffPoint: Point,
  },
  { $id: "Trip" },
);

export const RiderProfile = Type.Object(
  {
    name: Type.String(),
    firstName: Type.String(),
    phone: Type.String(),
    vehicle: Type.Object({
      type: Type.Union([Type.Literal("motorbike"), Type.Literal("tukTuk"), Type.Literal("bicycle")]),
      model: Type.String(),
      plate: Type.String(),
    }),
    rating: Type.Number(),
    ratingCount: Type.Integer(),
    memberSince: Type.String({ description: "e.g. March 2024" }),
    bank: Type.Object({ name: Type.String(), branch: Type.String(), last4: Type.String() }),
    depositReference: Type.String(),
  },
  { $id: "RiderProfile" },
);

export const RiderDocument = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    expiresOn: Type.Optional(Type.String()),
    status: Type.Union([
      Type.Literal("valid"),
      Type.Literal("expiring"),
      Type.Literal("expired"),
      Type.Literal("inReview"),
    ]),
  },
  { $id: "RiderDocument" },
);

export const CashBalance = Type.Object(
  { collected: Rupees(), owedToRider: Rupees(), limit: Rupees(), lastDepositAt: EpochMs() },
  { $id: "CashBalance" },
);

export const Period = Type.Union([Type.Literal("today"), Type.Literal("week"), Type.Literal("month")]);

export const EarningsSummary = Type.Object(
  {
    period: Period,
    total: Rupees(),
    trips: Type.Integer(),
    onlineMinutes: Type.Integer(),
    tips: Rupees(),
    bars: Type.Array(
      Type.Object({
        label: Type.String(),
        fullLabel: Type.String(),
        amount: Rupees(),
        trips: Type.Integer(),
      }),
    ),
    comparison: Type.Optional(
      Type.Object({
        text: Type.String(),
        tone: Type.Union([Type.Literal("good"), Type.Literal("bad"), Type.Literal("neutral")]),
      }),
    ),
  },
  { $id: "EarningsSummary" },
);

export const TodaySummary = Type.Object(
  { amount: Rupees(), trips: Type.Integer(), onlineMinutes: Type.Integer(), tips: Rupees() },
  { $id: "TodaySummary" },
);

export const Quest = Type.Object(
  {
    id: Type.String(),
    title: Type.String(),
    detail: Type.String(),
    done: Type.Integer(),
    target: Type.Integer(),
    bonus: Rupees(),
    endsAt: EpochMs(),
  },
  { $id: "Quest" },
);

export const Payout = Type.Object(
  {
    id: Type.String(),
    weekOf: Type.String(),
    paidAt: EpochMs(),
    amount: Rupees(),
    cashOffset: Rupees(),
    status: Type.Union([Type.Literal("paid"), Type.Literal("scheduled")]),
  },
  { $id: "Payout" },
);

export const RatingsSummary = Type.Object(
  {
    overall: Type.Number(),
    count: Type.Integer(),
    breakdown: Type.Array(Type.Integer(), { minItems: 5, maxItems: 5 }),
    compliments: Type.Array(Type.Object({ label: Type.String(), count: Type.Integer() })),
    improve: Type.Array(Type.Object({ label: Type.String(), detail: Type.String() })),
    recent: Type.Array(
      Type.Object({
        id: Type.String(),
        stars: Type.Integer(),
        comment: Type.Optional(Type.String()),
        at: EpochMs(),
        area: Type.String(),
      }),
    ),
  },
  { $id: "RatingsSummary" },
);

export const HelpTopic = Type.Object(
  { id: Type.String(), title: Type.String(), summary: Type.String(), steps: Type.Array(Type.String()) },
  { $id: "HelpTopic" },
);

export const ChatMessage = Type.Object(
  {
    id: Type.String(),
    from: Type.Union([Type.Literal("rider"), Type.Literal("support")]),
    text: Type.String(),
    at: EpochMs(),
  },
  { $id: "ChatMessage" },
);

export const DocKey = Type.Union([
  Type.Literal("licence"),
  Type.Literal("revenue"),
  Type.Literal("insurance"),
  Type.Literal("nicFront"),
  Type.Literal("nicBack"),
]);

export const VehicleType = Type.Union([
  Type.Literal("motorbike"),
  Type.Literal("tukTuk"),
  Type.Literal("bicycle"),
]);

export const ApplicationInput = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    nic: Type.String({ maxLength: 20 }),
    phone: Type.String({ minLength: 7, maxLength: 20 }),
    city: Type.String({ maxLength: 80 }),
    vehicle: VehicleType,
    documents: Type.Partial(
      Type.Object({
        licence: Type.String(),
        revenue: Type.String(),
        insurance: Type.String(),
        nicFront: Type.String(),
        nicBack: Type.String(),
      }),
    ),
    bank: Type.Object({
      bank: Type.String(),
      branch: Type.String(),
      account: Type.String(),
      holder: Type.String(),
    }),
    lessons: Type.Array(Type.String()),
  },
  { $id: "ApplicationInput" },
);
export type ApplicationInput = Static<typeof ApplicationInput>;

export const ApplicationStatus = Type.Object(
  {
    state: Type.Union([
      Type.Literal("none"),
      Type.Literal("inReview"),
      Type.Literal("needsFix"),
      Type.Literal("approved"),
    ]),
    id: Type.Optional(Type.String()),
    submittedAt: Type.Optional(EpochMs()),
    firstName: Type.Optional(Type.String()),
    doc: Type.Optional(DocKey),
    docName: Type.Optional(Type.String()),
    reason: Type.Optional(Type.String()),
  },
  { $id: "ApplicationStatus", description: "Discriminated by state (see apps/rider/src/api/onboarding.ts)." },
);

export const Problem = Type.Object(
  {
    type: Type.String({ format: "uri" }),
    title: Type.String(),
    status: Type.Integer(),
    detail: Type.Optional(Type.String({ description: "User-facing message; show as-is." })),
    code: Type.String({ description: "Stable machine code, e.g. OFFER_EXPIRED." }),
    instance: Type.Optional(Type.String()),
    traceId: Type.Optional(Type.String()),
  },
  { $id: "Problem", description: "RFC 9457 problem details (application/problem+json)." },
);

export const sharedSchemas = [
  MapPoint,
  Pay,
  Offer,
  Trip,
  RiderProfile,
  RiderDocument,
  CashBalance,
  EarningsSummary,
  TodaySummary,
  Quest,
  Payout,
  RatingsSummary,
  HelpTopic,
  ChatMessage,
  ApplicationInput,
  ApplicationStatus,
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
