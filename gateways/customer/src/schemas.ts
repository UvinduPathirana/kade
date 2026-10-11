import { Type, type Static, type TSchema } from "typebox";

// App-facing API schemas. They mirror apps/customer/src/api/types.ts exactly, so the app's components
// don't change when it moves from mock data to this gateway. Registered with app.addSchema() so the
// OpenAPI document gets named components (#/components/schemas/Restaurant), which typed-client
// generators key on. Money is whole rupees (LKR); instants are epoch milliseconds (the app's `number`
// timestamps); whole days are ISO dates.

const Rupees = (description = "Whole rupees (LKR). Rs 1,150 -> 1150.") => Type.Integer({ description });
const EpochMs = (description = "Epoch milliseconds.") => Type.Number({ description });
const Opt = <T extends TSchema>(s: T) => Type.Optional(s);

export const OrderMode = Type.Union([Type.Literal("delivery"), Type.Literal("pickup")], { $id: "OrderMode" });

export const Category = Type.Object(
  { id: Type.String(), label: Type.String(), imageId: Type.String() },
  { $id: "Category" },
);
export type Category = Static<typeof Category>;

export const Restaurant = Type.Object(
  {
    id: Type.Integer({ description: "The app's restaurant number (seeded UUID suffix)." }),
    name: Type.String(),
    categoryId: Type.String(),
    imageId: Type.String(),
    eta: Type.Tuple([Type.Integer(), Type.Integer()], { description: "Delivery window, minutes." }),
    deliveryFee: Rupees("0 = no delivery fee."),
    rating: Type.Number(),
    ratingCount: Type.String({ description: 'Display count, e.g. "3k+".' }),
    priceLevel: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)]),
    offer: Opt(Type.String()),
    discountPercent: Opt(Type.Integer()),
    hasVegetarian: Type.Boolean(),
    orderedBefore: Opt(Type.Boolean()),
    area: Type.String(),
    distanceKm: Type.Number(),
    hours: Type.String(),
    closedLabel: Opt(Type.String({ description: 'Present while closed, e.g. "Opens at 8 am".' })),
  },
  { $id: "Restaurant" },
);
export type Restaurant = Static<typeof Restaurant>;

const DishTag = Type.Union([Type.Literal("Vegetarian"), Type.Literal("Spicy")]);

export const MenuItem = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    price: Rupees(),
    description: Type.String(),
    imageId: Opt(Type.String()),
    tags: Type.Array(DishTag),
    optionGroupIds: Type.Array(Type.String()),
    popularRank: Opt(Type.Integer()),
    soldOut: Opt(Type.Boolean()),
    unit: Opt(Type.String()),
  },
  { $id: "MenuItem" },
);
export type MenuItem = Static<typeof MenuItem>;

const OptionGroup = Type.Object({
  id: Type.String(),
  name: Type.String(),
  required: Type.Boolean(),
  max: Type.Integer(),
  choices: Type.Array(Type.Object({ name: Type.String(), price: Rupees() })),
});

export const Menu = Type.Object(
  {
    restaurantId: Type.Integer(),
    sections: Type.Array(
      Type.Object({ id: Type.String(), name: Type.String(), items: Type.Array(Type.Ref("MenuItem")) }),
    ),
    popular: Type.Array(Type.Ref("MenuItem")),
    optionGroups: Type.Record(Type.String(), OptionGroup),
  },
  { $id: "Menu" },
);
export type Menu = {
  restaurantId: number;
  sections: { id: string; name: string; items: MenuItem[] }[];
  popular: MenuItem[];
  optionGroups: Record<string, Static<typeof OptionGroup>>;
};

export const Review = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    when: Type.String({ description: '"2 days ago"' }),
    dish: Type.String(),
    stars: Type.Integer(),
    text: Type.String(),
  },
  { $id: "Review" },
);
export type Review = Static<typeof Review>;

export const SearchResults = Type.Object(
  {
    query: Type.String(),
    dishes: Type.Array(Type.Object({ item: Type.Ref("MenuItem"), restaurant: Type.Ref("Restaurant") })),
    restaurants: Type.Array(Type.Ref("Restaurant")),
  },
  { $id: "SearchResults" },
);
export type SearchResults = {
  query: string;
  dishes: { item: MenuItem; restaurant: Restaurant }[];
  restaurants: Restaurant[];
};

const MapPin = Type.Object({ x: Type.Number(), y: Type.Number() }, { description: "Illustrated map units." });

export const Place = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    detail: Type.String(),
    area: Type.String(),
    inZone: Type.Boolean(),
    pin: Opt(MapPin),
  },
  { $id: "Place" },
);
export type Place = Static<typeof Place>;

export const SavedAddress = Type.Object(
  {
    id: Type.String(),
    label: Type.String(),
    line: Type.String(),
    area: Opt(Type.String()),
    note: Opt(Type.String()),
    pin: Opt(MapPin),
  },
  { $id: "SavedAddress" },
);
export type SavedAddress = Static<typeof SavedAddress>;

export const PublicPromo = Type.Object(
  { code: Type.String(), label: Type.String(), detail: Type.String() },
  { $id: "PublicPromo" },
);

export const PromoCheckInput = Type.Object(
  {
    code: Type.String({ maxLength: 32 }),
    restaurantId: Type.Integer(),
    subtotal: Rupees("Items subtotal the customer sees."),
    mode: Opt(Type.Union([Type.Literal("delivery"), Type.Literal("pickup")])),
  },
  { $id: "PromoCheckInput" },
);
export const PromoResult = Type.Object(
  {
    ok: Type.Boolean(),
    code: Opt(Type.String()),
    label: Opt(Type.String()),
    discount: Opt(Rupees()),
    error: Opt(Type.String({ description: "User-facing reason when not ok." })),
  },
  { $id: "PromoResult" },
);
export type PromoResult = Static<typeof PromoResult>;

// ---------- Orders ----------

export const PaymentMethod = Type.Union(
  [
    Type.Object({
      type: Type.Literal("card"),
      brand: Type.String(),
      last4: Type.String(),
      cardId: Opt(Type.String({ description: "Saved card id (requests); the app sends brand/last4." })),
    }),
    Type.Object({ type: Type.Literal("cash"), payingWith: Opt(Rupees()) }),
  ],
  { $id: "PaymentMethod" },
);
export type PaymentMethod = Static<typeof PaymentMethod>;

export const OrderLine = Type.Object(
  {
    key: Type.String(),
    itemId: Type.String(),
    name: Type.String(),
    unitPrice: Rupees(),
    qty: Type.Integer({ minimum: 1 }),
    choices: Type.Array(Type.String(), { description: "Chosen option names, in menu order." }),
    note: Type.String(),
  },
  { $id: "OrderLine" },
);
export type OrderLine = Static<typeof OrderLine>;

export const OrderRestaurant = Type.Object(
  {
    id: Type.Integer(),
    name: Type.String(),
    imageId: Type.String(),
    eta: Type.Tuple([Type.Integer(), Type.Integer()]),
    deliveryFee: Rupees(),
    discountPercent: Opt(Type.Integer()),
    area: Type.String(),
  },
  { $id: "OrderRestaurant" },
);
export type OrderRestaurant = Static<typeof OrderRestaurant>;

const Rider = Type.Object({
  name: Type.String(),
  rating: Type.Number(),
  vehicle: Type.String(),
  plate: Type.String(),
  maskedPhone: Type.String(),
});

const OrderTotals = Type.Object({
  subtotal: Rupees(),
  saving: Rupees(),
  deliveryFee: Rupees(),
  smallOrderFee: Rupees(),
  promoDiscount: Rupees(),
  tip: Rupees(),
  credit: Opt(Rupees()),
  total: Rupees(),
});

const OrderRating = Type.Object({
  riderStars: Opt(Type.Integer({ minimum: 1, maximum: 5 })),
  riderTags: Type.Array(Type.String()),
  dishes: Type.Record(Type.String(), Type.Union([Type.Literal("up"), Type.Literal("down")])),
  comment: Type.String(),
  ratedAt: EpochMs(),
});

export const RateOrderInput = Type.Object(
  {
    riderStars: Opt(Type.Integer({ minimum: 1, maximum: 5 })),
    riderTags: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 12 }),
    dishes: Type.Record(Type.String(), Type.Union([Type.Literal("up"), Type.Literal("down")])),
    comment: Type.String({ maxLength: 2000 }),
  },
  { $id: "RateOrderInput" },
);

const IssueKind = Type.Union([
  Type.Literal("missing"),
  Type.Literal("wrong"),
  Type.Literal("spilled"),
  Type.Literal("late"),
  Type.Literal("neverArrived"),
  Type.Literal("charged"),
]);
const IssueResolution = Type.Union([Type.Literal("credit"), Type.Literal("card"), Type.Literal("review")]);
const IssueLines = Type.Array(Type.Object({ key: Type.String(), qty: Type.Integer({ minimum: 0 }) }));

export const IssueInput = Type.Object(
  {
    kind: IssueKind,
    lines: IssueLines,
    note: Type.String({ maxLength: 2000 }),
    photoName: Opt(Type.String({ maxLength: 200 })),
    resolution: IssueResolution,
  },
  { $id: "IssueInput" },
);
export type IssueInput = {
  kind: "missing" | "wrong" | "spilled" | "late" | "neverArrived" | "charged";
  lines: { key: string; qty: number }[];
  note: string;
  photoName?: string;
  resolution: "credit" | "card" | "review";
};

export const IssuePreviewInput = Type.Object(
  { kind: IssueKind, lines: IssueLines },
  { $id: "IssuePreviewInput" },
);

const OrderIssue = Type.Object({
  kind: IssueKind,
  lines: IssueLines,
  note: Type.String(),
  photoName: Opt(Type.String()),
  resolution: IssueResolution,
  amount: Rupees(),
  reportedAt: EpochMs(),
});

export const OrderStatus = Type.Union(
  [
    Type.Literal("scheduled"),
    Type.Literal("placed"),
    Type.Literal("accepted"),
    Type.Literal("preparing"),
    Type.Literal("pickedUp"),
    Type.Literal("delivered"),
    Type.Literal("ready"),
    Type.Literal("collected"),
    Type.Literal("cancelled"),
  ],
  { $id: "OrderStatus" },
);
export type OrderStatus =
  | "scheduled"
  | "placed"
  | "accepted"
  | "preparing"
  | "pickedUp"
  | "delivered"
  | "ready"
  | "collected"
  | "cancelled";

export const Order = Type.Object(
  {
    id: Type.String({ description: 'Order number, e.g. "KD-4821" (falls back to the UUID).' }),
    ref: Type.String({ description: "Order UUID: realtime channel order:<ref>." }),
    status: Type.Ref("OrderStatus"),
    placedAt: EpochMs(),
    mode: Type.Ref("OrderMode"),
    restaurant: Type.Ref("OrderRestaurant"),
    lines: Type.Array(Type.Ref("OrderLine")),
    address: Opt(Type.Ref("SavedAddress")),
    riderNote: Type.String(),
    scheduledFor: Opt(EpochMs()),
    payment: Type.Ref("PaymentMethod"),
    promoCode: Opt(Type.String()),
    totals: OrderTotals,
    rider: Opt(Rider),
    cancelledAt: Opt(EpochMs()),
    cancelReason: Opt(Type.String()),
    collectedAt: Opt(EpochMs()),
    deliveredAt: Opt(EpochMs()),
    acceptedAt: Opt(EpochMs()),
    readyBy: Opt(EpochMs()),
    pickedUpAt: Opt(EpochMs()),
    dueAt: Opt(EpochMs("Latest time promised to the customer.")),
    deliveryCode: Opt(Type.String()),
    rating: Opt(OrderRating),
    substitution: Opt(Type.Union([Type.Literal("similar"), Type.Literal("refund")])),
    groupId: Opt(Type.String()),
    issue: Opt(OrderIssue),
  },
  { $id: "Order" },
);
export type Order = {
  id: string;
  ref: string;
  status: OrderStatus;
  placedAt: number;
  mode: "delivery" | "pickup";
  restaurant: OrderRestaurant;
  lines: OrderLine[];
  address?: SavedAddress;
  riderNote: string;
  scheduledFor?: number;
  payment: PaymentMethod;
  promoCode?: string;
  totals: Static<typeof OrderTotals>;
  rider?: Static<typeof Rider>;
  cancelledAt?: number;
  cancelReason?: string;
  collectedAt?: number;
  deliveredAt?: number;
  acceptedAt?: number;
  readyBy?: number;
  pickedUpAt?: number;
  dueAt?: number;
  deliveryCode?: string;
  rating?: Static<typeof OrderRating>;
  substitution?: "similar" | "refund";
  groupId?: string;
  issue?: Static<typeof OrderIssue>;
};

export const ActiveOrder = Type.Object(
  { order: Type.Union([Type.Ref("Order"), Type.Null()]) },
  { $id: "ActiveOrder" },
);

export const PlaceOrderInput = Type.Object(
  {
    mode: Type.Ref("OrderMode"),
    restaurant: Type.Object({ id: Type.Integer() }, { additionalProperties: true }),
    lines: Type.Array(Type.Ref("OrderLine"), { minItems: 0, maxItems: 100 }),
    address: Opt(Type.Ref("SavedAddress")),
    riderNote: Type.String({ maxLength: 500 }),
    scheduledFor: Opt(EpochMs()),
    payment: Type.Ref("PaymentMethod"),
    promoCode: Opt(Type.String({ maxLength: 32 })),
    tip: Rupees(),
    useCredit: Opt(Type.Boolean()),
    substitution: Opt(Type.Union([Type.Literal("similar"), Type.Literal("refund")])),
    groupId: Opt(Type.String()),
    expectedTotal: Opt(Rupees("The total the customer saw; PRICE_CHANGED if the server's differs.")),
  },
  { $id: "PlaceOrderInput" },
);
export type PlaceOrderInput = {
  mode: "delivery" | "pickup";
  restaurant: { id: number };
  lines: OrderLine[];
  address?: SavedAddress;
  riderNote: string;
  scheduledFor?: number;
  payment: PaymentMethod;
  promoCode?: string;
  tip: number;
  useCredit?: boolean;
  substitution?: "similar" | "refund";
  groupId?: string;
  expectedTotal?: number;
};

// ---------- Cart (server copy of the app's cart) ----------

export const Cart = Type.Object(
  {
    restaurant: Type.Union([Type.Ref("OrderRestaurant"), Type.Null()]),
    lines: Type.Array(Type.Ref("OrderLine")),
    mode: Type.Ref("OrderMode"),
    groupId: Opt(Type.String()),
  },
  { $id: "Cart" },
);
export type Cart = {
  restaurant: OrderRestaurant | null;
  lines: OrderLine[];
  mode: "delivery" | "pickup";
  groupId?: string;
};

export const CartInput = Type.Object(
  {
    restaurantId: Type.Union([Type.Integer(), Type.Null()]),
    lines: Type.Array(Type.Ref("OrderLine"), { maxItems: 100 }),
    mode: Type.Ref("OrderMode"),
  },
  { $id: "CartInput" },
);

// ---------- Account ----------

export const User = Type.Object(
  {
    name: Type.String(),
    phone: Type.String({ description: 'National format without the leading 0, e.g. "771234567".' }),
    email: Opt(Type.String()),
  },
  { $id: "User" },
);
export type User = Static<typeof User>;

export const Me = Type.Object(
  {
    user: Type.Ref("User"),
    isNew: Type.Boolean({ description: "First sign-in (or no name yet): ask for a name." }),
    plusActive: Type.Boolean(),
  },
  { $id: "Me" },
);

export const ProfileInput = Type.Object(
  { name: Type.String({ maxLength: 120 }), email: Opt(Type.String({ maxLength: 200 })) },
  { $id: "ProfileInput" },
);

const CardBrand = Type.Union([Type.Literal("Visa"), Type.Literal("Mastercard"), Type.Literal("Amex")]);

export const SavedCard = Type.Object(
  {
    id: Type.String(),
    brand: CardBrand,
    last4: Type.String(),
    expiry: Type.String({ description: "MM/YY" }),
  },
  { $id: "SavedCard" },
);
export type SavedCard = Static<typeof SavedCard>;

export const CardSetupSession = Type.Object(
  {
    sessionId: Type.String(),
    clientSecret: Type.String(),
    pspUrl: Type.String({ description: "PSP hosted-fields endpoint; empty in dev (fake PSP)." }),
  },
  { $id: "CardSetupSession" },
);

export const AddCardInput = Type.Object(
  {
    sessionId: Type.String(),
    pspToken: Type.String(),
    brand: CardBrand,
    last4: Type.String({ pattern: "^\\d{4}$" }),
    expiry: Type.String({ pattern: "^\\d{2}/\\d{2}$" }),
    holderName: Type.String({ maxLength: 120 }),
    fingerprint: Opt(Type.String({ maxLength: 128 })),
  },
  { $id: "AddCardInput" },
);

export const CreditAccount = Type.Object(
  {
    balance: Rupees(),
    history: Type.Array(
      Type.Object({ id: Type.String(), at: EpochMs(), amount: Rupees("Signed."), label: Type.String() }),
    ),
  },
  { $id: "CreditAccount" },
);
export type CreditAccount = Static<typeof CreditAccount>;

export const PlusMembership = Type.Object(
  {
    status: Type.Union([Type.Literal("none"), Type.Literal("member"), Type.Literal("cancelled")]),
    plan: Opt(Type.Union([Type.Literal("monthly"), Type.Literal("yearly")])),
    joinedAt: Opt(EpochMs()),
    trialEndsAt: Opt(EpochMs()),
    endsAt: Opt(EpochMs()),
    cardLabel: Opt(Type.String()),
  },
  { $id: "PlusMembership" },
);
export type PlusMembership = Static<typeof PlusMembership>;

export const JoinPlusInput = Type.Object(
  { plan: Type.Union([Type.Literal("monthly"), Type.Literal("yearly")]), cardId: Type.String() },
  { $id: "JoinPlusInput" },
);

export const GiftCardInput = Type.Object(
  {
    amount: Rupees(),
    to: Type.String({ maxLength: 120 }),
    contact: Type.String({ maxLength: 200 }),
    message: Type.String({ maxLength: 500 }),
    sendOn: Type.String({ format: "date" }),
    cardId: Type.String(),
  },
  { $id: "GiftCardInput" },
);
export const GiftCard = Type.Object(
  {
    id: Type.String(),
    amount: Rupees(),
    to: Type.String(),
    contact: Type.String(),
    message: Type.String(),
    sendOn: Type.String(),
    cardId: Type.String(),
    boughtAt: EpochMs(),
    cardLabel: Type.String(),
  },
  { $id: "GiftCard" },
);
export type GiftCard = Static<typeof GiftCard>;

export const Referral = Type.Object(
  {
    code: Type.String(),
    reward: Rupees(),
    friends: Type.Array(
      Type.Object({
        name: Type.String(),
        status: Type.Union([Type.Literal("invited"), Type.Literal("joined"), Type.Literal("ordered")]),
        at: EpochMs(),
      }),
    ),
  },
  { $id: "Referral" },
);
export type Referral = Static<typeof Referral>;

// ---------- Group orders ----------

export const GroupOrder = Type.Object(
  {
    id: Type.String(),
    restaurantId: Type.Integer(),
    restaurantName: Type.String(),
    hostName: Type.String(),
    createdAt: EpochMs(),
    closesAt: EpochMs(),
    limit: Opt(Rupees()),
    members: Type.Array(
      Type.Object({
        name: Type.String(),
        joinsAfter: Type.Number({ description: "ms after createdAt that this person joined" }),
        lines: Type.Array(Type.Ref("OrderLine")),
      }),
    ),
    orderId: Opt(Type.String()),
  },
  { $id: "GroupOrder" },
);
export type GroupOrder = {
  id: string;
  restaurantId: number;
  restaurantName: string;
  hostName: string;
  createdAt: number;
  closesAt: number;
  limit?: number;
  members: { name: string; joinsAfter: number; lines: OrderLine[] }[];
  orderId?: string;
};

export const CreateGroupInput = Type.Object(
  {
    restaurantId: Type.Integer(),
    hostName: Type.String({ maxLength: 120 }),
    minutes: Type.Integer({ minimum: 5, maximum: 240 }),
    limit: Opt(Rupees()),
  },
  { $id: "CreateGroupInput" },
);

// ---------- Support chat ----------

export const ChatMessage = Type.Object(
  {
    id: Type.String(),
    from: Type.Union([Type.Literal("you"), Type.Literal("agent")]),
    text: Type.String(),
    at: EpochMs(),
    order: Opt(Type.Object({ id: Type.String(), restaurant: Type.String(), total: Rupees() })),
  },
  { $id: "ChatMessage" },
);
export type ChatMessage = Static<typeof ChatMessage>;

export const Conversation = Type.Object(
  { ticketId: Type.String(), messages: Type.Array(Type.Ref("ChatMessage")) },
  { $id: "Conversation" },
);

export const SendChatInput = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 4000 }),
    order: Opt(Type.Object({ id: Type.String(), restaurant: Type.String(), total: Rupees() })),
  },
  { $id: "SendChatInput" },
);

export const Problem = Type.Object(
  {
    type: Type.String({ format: "uri" }),
    title: Type.String(),
    status: Type.Integer(),
    detail: Type.Optional(Type.String({ description: "User-facing message; show as-is." })),
    code: Type.String({ description: "Stable machine code, e.g. PROMO_MIN_SUBTOTAL." }),
    instance: Type.Optional(Type.String()),
    traceId: Type.Optional(Type.String()),
  },
  { $id: "Problem", description: "RFC 9457 problem details (application/problem+json)." },
);

export const sharedSchemas = [
  OrderMode,
  Category,
  Restaurant,
  MenuItem,
  Menu,
  Review,
  SearchResults,
  Place,
  SavedAddress,
  PublicPromo,
  PromoCheckInput,
  PromoResult,
  PaymentMethod,
  OrderLine,
  OrderRestaurant,
  RateOrderInput,
  IssueInput,
  IssuePreviewInput,
  OrderStatus,
  Order,
  ActiveOrder,
  PlaceOrderInput,
  Cart,
  CartInput,
  User,
  Me,
  ProfileInput,
  SavedCard,
  CardSetupSession,
  AddCardInput,
  CreditAccount,
  PlusMembership,
  JoinPlusInput,
  GiftCardInput,
  GiftCard,
  Referral,
  GroupOrder,
  CreateGroupInput,
  ChatMessage,
  Conversation,
  SendChatInput,
  Problem,
];

/** A typed $ref to a registered schema: OpenAPI sees a reference, handlers keep the static type. */
export function ref<T extends TSchema>(schema: T) {
  const id = (schema as { $id?: string }).$id;
  if (!id) throw new Error("ref() needs a schema with an $id (and app.addSchema)");
  return Type.Unsafe<Static<T>>(Type.Ref(id));
}

/** A typed $ref when the static type is declared by hand (schemas that contain nested $refs). */
export function refAs<S>(schema: TSchema) {
  const id = (schema as { $id?: string }).$id;
  if (!id) throw new Error("refAs() needs a schema with an $id");
  return Type.Unsafe<S>(Type.Ref(id));
}

/** Error responses for a route, documented as application/problem+json. */
export function problems(...statuses: number[]) {
  return Object.fromEntries(
    statuses.map((s) => [s, { content: { "application/problem+json": { schema: ref(Problem) } } }]),
  );
}
