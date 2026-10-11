import { BinaryWriter } from "@bufbuild/protobuf/wire";
import { Metadata, status, type ServiceError } from "@grpc/grpc-js";
import {
  AvailabilityState,
  DishTag,
  type Menu,
  type Restaurant,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import { CardBrand, FulfilmentMode, PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import { OrderStatus, type Order } from "@kade/proto/kade/order/v1/order_service";
import { Thumb } from "@kade/proto/kade/review/v1/review_service";
import { IssueKind, IssueResolution } from "@kade/proto/kade/support/v1/support_service";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type Gateway } from "./app.js";
import { createAuthenticator } from "./auth.js";
import { loadConfig } from "./config.js";
import type { Upstreams } from "./grpc/clients.js";
import { STATUS_DETAILS_KEY } from "./grpc/error-details.js";
import type { UpstreamSocket } from "./routes/ws.js";

const config = loadConfig({
  SERVICE_NAME: "gateway-test",
  HTTP_PORT: "0",
  KEYCLOAK_ISSUER: "http://localhost:8080/realms/kade",
  CORS_ORIGINS: "http://localhost:5174",
  AUTH_DEV_BYPASS: "true",
  DEPLOY_ENV: "dev",
});

const DILINI = "00000000-0000-7000-8005-000000000001";
const R1 = "00000000-0000-7000-8000-000000000001";
const devAuth = { authorization: `Bearer dev:${DILINI}:customer` };
const money = (rupees: number) => ({ amountMinor: rupees * 100, currency: "LKR" });

interface Call {
  method: string;
  request: Record<string, unknown>;
  metadata: Metadata;
  deadline: number;
}

type Handler = (request: Record<string, unknown>) => unknown;
let calls: Call[];
let handlers: Record<string, Handler>;
let gw: Gateway;
let upstreamSockets: FakeUpstream[];
let realtimeUp: boolean;

/** Stands in for every generated client: "<upstream>.<method>" -> handler; records each call. */
function fakeClient(upstream: string): unknown {
  return new Proxy(
    {},
    {
      get: (_t, name) =>
        typeof name !== "string" || name === "then"
          ? undefined
          : (
              request: Record<string, unknown>,
              metadata: Metadata,
              options: { deadline: number },
              cb: (e: unknown, r?: unknown) => void,
            ) => {
              const method = `${upstream}.${name}`;
              calls.push({ method, request, metadata, deadline: options.deadline });
              const handler = handlers[method];
              queueMicrotask(() => {
                if (!handler) return cb(grpcError(status.UNIMPLEMENTED, `${method} not faked`));
                try {
                  const out = handler(request);
                  if (out instanceof Error) cb(out);
                  else cb(null, out);
                } catch (err) {
                  cb(err);
                }
              });
              return { cancel: () => undefined };
            },
    },
  );
}

function grpcError(code: status, details: string, reason?: string): ServiceError {
  const metadata = new Metadata();
  if (reason) {
    const info = new BinaryWriter().uint32(10).string(reason).uint32(18).string("order.kade.lk").finish();
    const any = new BinaryWriter()
      .uint32(10)
      .string("type.googleapis.com/google.rpc.ErrorInfo")
      .uint32(18)
      .bytes(info)
      .finish();
    const st = new BinaryWriter()
      .uint32(8)
      .int32(code)
      .uint32(18)
      .string(details)
      .uint32(26)
      .bytes(any)
      .finish();
    metadata.set(STATUS_DETAILS_KEY, Buffer.from(st));
  }
  return Object.assign(new Error(details), { code, details, metadata });
}

class FakeUpstream implements UpstreamSocket {
  readyState = 0;
  sent: string[] = [];
  private listeners: Record<string, ((e: { data: unknown }) => void)[]> = {};
  constructor(public headers: Record<string, string>) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.emit("close");
  }
  addEventListener(type: string, fn: (e: { data: unknown }) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  emit(type: string, data?: unknown) {
    for (const fn of this.listeners[type] ?? []) fn({ data });
  }
}

const restaurant = (over: Partial<Restaurant> = {}): Restaurant => ({
  id: R1,
  name: "Galle Road Kottu House",
  kind: 1,
  categoryId: "kottu",
  cuisine: "Sri Lankan",
  imageId: "1589302168068-964664d93dc0",
  etaMinMinutes: 15,
  etaMaxMinutes: 25,
  deliveryFee: money(150),
  rating: 4.8,
  ratingCount: 3240,
  priceLevel: 1,
  offerLabel: "20% off kottu",
  discountPercent: 20,
  freeDeliveryOffer: false,
  hasVegetarian: false,
  area: "Kollupitiya",
  address: "214 Galle Rd",
  phone: "+94112345678",
  location: { lat: 6.91, lng: 79.85 },
  zoneId: "c03",
  distanceKm: 1.23,
  hoursLabel: "11 am – 2 am",
  availability: {
    state: AvailabilityState.AVAILABILITY_STATE_OPEN,
    closedLabel: "",
    opensAt: undefined,
    busyExtraMinutes: 0,
  },
  offerId: "",
  createdAt: undefined,
  updatedAt: undefined,
  ...over,
});

const ITEM = "0199d3a0-0000-7000-8000-00000000a001";
const menu: Menu = {
  restaurantId: R1,
  version: 1,
  updatedAt: undefined,
  sections: [
    {
      id: "s1",
      name: "Kottu",
      position: 0,
      items: [
        {
          id: ITEM,
          restaurantId: R1,
          sectionId: "s1",
          name: "Chicken kottu",
          description: "Chopped roti",
          price: money(1150),
          imageId: "",
          tags: [DishTag.DISH_TAG_SPICY],
          optionGroupIds: ["g-spice", "g-extra"],
          popularRank: 1,
          soldOut: false,
          soldOutUntil: undefined,
          unit: "",
          position: 0,
        },
      ],
    },
  ],
  popular: [],
  optionGroups: [
    {
      id: "g-spice",
      name: "Spice level",
      required: true,
      maxChoices: 1,
      choices: [
        { id: "c-mild", name: "Mild", price: money(0) },
        { id: "c-hot", name: "Sri Lankan hot", price: money(0) },
      ],
    },
    {
      id: "g-extra",
      name: "Add-ons",
      required: false,
      maxChoices: 3,
      choices: [{ id: "c-egg", name: "Extra egg", price: money(100) }],
    },
  ],
};

const order = (over: Partial<Order> = {}): Order => ({
  id: "0199d3a0-0000-7000-8003-000000004821",
  orderNumber: "KD-4821",
  status: OrderStatus.ORDER_STATUS_PREPARING,
  mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
  customer: { id: DILINI, name: "Dilini", phone: "+94771234567" },
  restaurant: {
    id: R1,
    name: "Galle Road Kottu House",
    imageId: "img",
    area: "Kollupitiya",
    address: "214 Galle Rd",
    phone: "+94112345678",
    location: undefined,
    zoneId: "c03",
    etaMinMinutes: 15,
    etaMaxMinutes: 25,
    discountPercent: 20,
  },
  lines: [
    {
      key: "k1",
      itemId: ITEM,
      name: "Chicken kottu",
      unitPrice: money(1250),
      quantity: 2,
      options: [],
      choiceNames: ["Sri Lankan hot", "Extra egg"],
      note: "",
      sectionId: "s1",
    },
  ],
  address: {
    id: "a1",
    label: "Home",
    line: "42 Galle Rd, Colombo 03",
    area: "Kollupitiya",
    note: "Green gate",
    location: { lat: 6.91, lng: 79.85 },
    zoneId: "c03",
  },
  riderNote: "Green gate",
  kitchenNote: "",
  cutlery: false,
  scheduledFor: undefined,
  payment: {
    kind: PaymentMethodKind.PAYMENT_METHOD_KIND_CARD,
    cardId: "card-1",
    cardBrand: CardBrand.CARD_BRAND_VISA,
    cardLast4: "4242",
    cashPayingWith: undefined,
  },
  paymentId: "",
  promo: undefined,
  totals: {
    itemCount: 2,
    subtotal: money(2500),
    saving: money(500),
    deliveryFee: money(150),
    smallOrderFee: money(0),
    promoDiscount: money(0),
    tip: money(100),
    credit: money(0),
    total: money(2250),
  },
  substitution: 0,
  groupId: "",
  zoneId: "c03",
  distanceKm: 1.2,
  deliveryCode: "4821",
  rider: {
    riderId: "r1",
    name: "Nimal Perera",
    firstName: "Nimal",
    rating: 4.9,
    vehicle: "Bajaj Pulsar",
    plate: "WP BCD-4521",
    maskedPhone: "+94 11 520 1234",
    phone: "+94770000000",
  },
  deliveryId: "",
  createdAt: new Date("2026-10-12T14:00:00Z"),
  placedAt: new Date("2026-10-12T14:00:05Z"),
  acceptBy: undefined,
  acceptedAt: new Date("2026-10-12T14:00:30Z"),
  prepMinutes: 15,
  readyBy: new Date("2026-10-12T14:15:30Z"),
  readyAt: undefined,
  pickedUpAt: undefined,
  deliveredAt: undefined,
  collectedAt: undefined,
  dueAt: new Date("2026-10-12T14:25:05Z"),
  updatedAt: undefined,
  cancellation: undefined,
  rejection: undefined,
  refunded: undefined,
  timeline: [],
  notes: [{ id: "n1", at: undefined, author: "ops", body: "internal" }],
  failureReason: "",
  failureMessage: "",
  customerRepeatCount: 0,
  ...over,
});

beforeEach(async () => {
  calls = [];
  upstreamSockets = [];
  realtimeUp = true;
  handlers = {
    "customer.ensureCustomer": () => ({
      customer: { id: DILINI, name: "Dilini Perera", phone: "+94771234567", email: "", plusActive: false },
      isNew: false,
    }),
  };
  const names = [
    "catalog",
    "search",
    "customer",
    "address",
    "favourite",
    "credit",
    "plus",
    "cart",
    "promotion",
    "giftCard",
    "referral",
    "order",
    "group",
    "savedCard",
    "review",
    "support",
  ] as const;
  const upstreams = Object.fromEntries(names.map((n) => [n, fakeClient(n)])) as unknown as Upstreams;
  gw = await buildApp({
    config,
    logger: pino({ level: "silent" }),
    authenticator: createAuthenticator(config, async () => {
      throw new Error("no JWKS in unit tests");
    }),
    upstreams,
    connectUpstream: (_url, headers) => {
      const s = new FakeUpstream(headers);
      upstreamSockets.push(s);
      queueMicrotask(() => {
        if (realtimeUp) {
          s.readyState = 1;
          s.emit("open");
        } else s.emit("error");
      });
      return s;
    },
  });
  await gw.app.ready();
});
afterEach(() => gw.app.close());

const callsTo = (method: string) => calls.filter((c) => c.method === method);

describe("browsing (public)", () => {
  it("maps restaurants to the app's shape: numeric ids, rupees, labels, ordered-before", async () => {
    handlers["catalog.listRestaurants"] = () => ({
      restaurants: [
        restaurant(),
        restaurant({
          id: "00000000-0000-7000-8000-000000000012",
          offerLabel: "",
          discountPercent: 0,
          ratingCount: 640,
          availability: {
            state: AvailabilityState.AVAILABILITY_STATE_CLOSED,
            closedLabel: "Opens at 8 am",
            opensAt: undefined,
            busyExtraMinutes: 0,
          },
        }),
      ],
    });
    handlers["order.listOrders"] = () => ({ orders: [order()] });

    const res = await gw.app.inject({ url: "/v1/restaurants?x=300&y=250", headers: devAuth });
    expect(res.statusCode).toBe(200);
    const [a, b] = res.json();
    expect(a).toEqual({
      id: 1,
      name: "Galle Road Kottu House",
      categoryId: "kottu",
      imageId: "1589302168068-964664d93dc0",
      eta: [15, 25],
      deliveryFee: 150,
      rating: 4.8,
      ratingCount: "3k+",
      priceLevel: 1,
      offer: "20% off kottu",
      discountPercent: 20,
      hasVegetarian: false,
      orderedBefore: true,
      area: "Kollupitiya",
      distanceKm: 1.2,
      hours: "11 am – 2 am",
    });
    expect(b).toMatchObject({ id: 12, ratingCount: "600+", closedLabel: "Opens at 8 am" });
    expect(b.offer).toBeUndefined();
    expect(b.orderedBefore).toBeUndefined();
    const req = callsTo("catalog.listRestaurants")[0]!.request;
    expect(req.deliverTo).toEqual({ lat: expect.closeTo(6.928, 2), lng: expect.closeTo(79.848, 2) });
  });

  it("works signed out without the ordered-before lookup", async () => {
    handlers["catalog.listRestaurants"] = () => ({ restaurants: [restaurant()] });
    const res = await gw.app.inject({ url: "/v1/restaurants" });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].orderedBefore).toBeUndefined();
    expect(callsTo("order.listOrders")).toHaveLength(0);
    expect(callsTo("customer.ensureCustomer")).toHaveLength(0);
  });

  it("looks restaurants up by the app's number and maps the menu", async () => {
    handlers["catalog.getMenu"] = () => ({ menu });
    const res = await gw.app.inject({ url: "/v1/restaurants/1/menu" });
    expect(res.statusCode).toBe(200);
    expect(callsTo("catalog.getMenu")[0]!.request).toEqual({ restaurantId: R1 });
    expect(res.json()).toEqual({
      restaurantId: 1,
      sections: [
        {
          id: "s1",
          name: "Kottu",
          items: [
            {
              id: ITEM,
              name: "Chicken kottu",
              price: 1150,
              description: "Chopped roti",
              tags: ["Spicy"],
              optionGroupIds: ["g-spice", "g-extra"],
              popularRank: 1,
            },
          ],
        },
      ],
      popular: [],
      optionGroups: {
        "g-spice": {
          id: "g-spice",
          name: "Spice level",
          required: true,
          max: 1,
          choices: [
            { name: "Mild", price: 0 },
            { name: "Sri Lankan hot", price: 0 },
          ],
        },
        "g-extra": {
          id: "g-extra",
          name: "Add-ons",
          required: false,
          max: 3,
          choices: [{ name: "Extra egg", price: 100 }],
        },
      },
    });
  });

  it("prepends the All category", async () => {
    handlers["catalog.listCategories"] = () => ({
      categories: [{ id: "kottu", label: "Kottu", imageId: "x", visible: true, position: 1 }],
    });
    const res = await gw.app.inject({ url: "/v1/categories" });
    expect(res.json().map((c: { id: string }) => c.id)).toEqual(["all", "kottu"]);
  });

  it("validates promo codes with the service's message", async () => {
    handlers["promotion.validatePromo"] = () => ({
      result: { ok: false, code: "KADE100", message: "KADE100 needs an order of Rs 1,000 or more." },
    });
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/promos/validate",
      payload: { code: " kade100 ", restaurantId: 1, subtotal: 600 },
    });
    expect(res.json()).toEqual({ ok: false, error: "KADE100 needs an order of Rs 1,000 or more." });
    const req = callsTo("promotion.validatePromo")[0]!.request as {
      code: string;
      basket: { subtotal: unknown };
    };
    expect(req.code).toBe("KADE100");
    expect(req.basket.subtotal).toEqual(money(600));
  });
});

describe("account", () => {
  it("requires a token for /v1/me and upserts the customer", async () => {
    expect((await gw.app.inject({ url: "/v1/me" })).statusCode).toBe(401);
    handlers["customer.ensureCustomer"] = () => ({
      customer: { id: DILINI, name: "", phone: "", email: "", plusActive: false },
      isNew: true,
    });
    const res = await gw.app.inject({ url: "/v1/me", headers: devAuth });
    expect(res.json()).toEqual({ user: { name: "", phone: "" }, isNew: true, plusActive: false });
    expect(callsTo("customer.ensureCustomer")[0]!.metadata.get("x-user-id")).toEqual([DILINI]);
  });

  it("ensures the customer once, then caches it", async () => {
    handlers["credit.getCreditAccount"] = () => ({
      account: {
        customerId: DILINI,
        balance: money(500),
        history: [{ id: "c1", at: new Date(1000), amount: money(500), label: "Invite" }],
      },
    });
    await gw.app.inject({ url: "/v1/me/credit", headers: devAuth });
    const res = await gw.app.inject({ url: "/v1/me/credit", headers: devAuth });
    expect(res.json()).toEqual({
      balance: 500,
      history: [{ id: "c1", at: 1000, amount: 500, label: "Invite" }],
    });
    expect(callsTo("customer.ensureCustomer")).toHaveLength(1);
  });

  it("saves Home over the existing Home address and converts the pin", async () => {
    handlers["address.listAddresses"] = () => ({
      addresses: [
        { id: "a-uuid", label: "Home", line: "old", area: "", note: "", location: undefined, zoneId: "" },
      ],
    });
    handlers["address.saveAddress"] = (r) => ({ address: r.address });
    const res = await gw.app.inject({
      method: "PUT",
      url: "/v1/me/addresses/home",
      headers: devAuth,
      payload: {
        id: "home",
        label: "Home",
        line: "42 Galle Rd",
        area: "Kollupitiya",
        pin: { x: 352, y: 500 },
      },
    });
    expect(res.statusCode).toBe(200);
    const saved = callsTo("address.saveAddress")[0]!.request as { address: { id: string } };
    expect(saved.address.id).toBe("a-uuid");
    expect(res.json()).toEqual({
      id: "home",
      label: "Home",
      line: "42 Galle Rd",
      area: "Kollupitiya",
      pin: { x: 352, y: 500 },
    });
  });
});

describe("orders", () => {
  it("places an order: option names -> ids, card lookup, idempotency, long deadline", async () => {
    handlers["catalog.getMenu"] = () => ({ menu });
    handlers["savedCard.listSavedCards"] = () => ({
      cards: [{ id: "card-1", brand: CardBrand.CARD_BRAND_VISA, last4: "4242" }],
    });
    handlers["order.placeOrder"] = () => ({ order: order({ status: OrderStatus.ORDER_STATUS_PLACED }) });
    handlers["cart.clearCart"] = () => ({ cart: undefined });

    const before = Date.now();
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { ...devAuth, "idempotency-key": "checkout-1" },
      payload: {
        mode: "delivery",
        restaurant: {
          id: 1,
          name: "Galle Road Kottu House",
          imageId: "x",
          eta: [15, 25],
          deliveryFee: 150,
          area: "",
        },
        lines: [
          {
            key: "k1",
            itemId: ITEM,
            name: "Chicken kottu",
            unitPrice: 1250,
            qty: 2,
            choices: ["Sri Lankan hot", "Extra egg"],
            note: "",
          },
        ],
        address: { id: "home", label: "Home", line: "42 Galle Rd", pin: { x: 352, y: 500 } },
        riderNote: "Green gate",
        payment: { type: "card", brand: "Visa", last4: "4242" },
        tip: 100,
        useCredit: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const call = callsTo("order.placeOrder")[0]!;
    expect(call.request).toMatchObject({
      customerId: DILINI,
      restaurantId: R1,
      mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
      lines: [
        {
          key: "k1",
          itemId: ITEM,
          quantity: 2,
          options: [
            { optionGroupId: "g-spice", choiceId: "c-hot" },
            { optionGroupId: "g-extra", choiceId: "c-egg" },
          ],
        },
      ],
      payment: { kind: PaymentMethodKind.PAYMENT_METHOD_KIND_CARD, cardId: "card-1", cardLast4: "4242" },
      tip: money(100),
      useCredit: true,
      idempotencyKey: "checkout-1",
    });
    expect((call.request as { address: { id: string } }).address.id).toBe("");
    expect(call.deadline - before).toBeGreaterThanOrEqual(config.PLACE_ORDER_DEADLINE_MS);
    expect(res.json()).toMatchObject({ id: "KD-4821", status: "placed", totals: { total: 2250, tip: 100 } });
    await new Promise((r) => setTimeout(r, 5));
    expect(callsTo("cart.clearCart")).toHaveLength(1);
  });

  it("rejects option names that are no longer on the menu", async () => {
    handlers["catalog.getMenu"] = () => ({ menu });
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: devAuth,
      payload: {
        mode: "pickup",
        restaurant: { id: 1 },
        lines: [{ key: "k", itemId: ITEM, name: "x", unitPrice: 1, qty: 1, choices: ["Volcano"], note: "" }],
        riderNote: "",
        payment: { type: "cash" },
        tip: 0,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("OPTION_INVALID");
    expect(callsTo("order.placeOrder")).toHaveLength(0);
  });

  it("passes PAYMENT_DECLINED through as the problem code", async () => {
    handlers["catalog.getMenu"] = () => ({ menu });
    handlers["order.placeOrder"] = () =>
      grpcError(status.FAILED_PRECONDITION, "Your bank declined Visa •••• 0002.", "PAYMENT_DECLINED");
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: devAuth,
      payload: {
        mode: "pickup",
        restaurant: { id: 1 },
        lines: [{ key: "k", itemId: ITEM, name: "x", unitPrice: 1, qty: 1, choices: [], note: "" }],
        riderNote: "",
        payment: { type: "card", brand: "Visa", last4: "0002", cardId: "card-2" },
        tip: 0,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "PAYMENT_DECLINED",
      detail: "Your bank declined Visa •••• 0002.",
    });
  });

  it("lists orders with ratings and issues joined, and strips ops-only fields", async () => {
    handlers["order.listOrders"] = () => ({
      orders: [order({ status: OrderStatus.ORDER_STATUS_DELIVERED, deliveredAt: new Date(5000) })],
    });
    handlers["review.batchGetOrderRatings"] = () => ({
      ratings: [
        {
          orderId: order().id,
          riderStars: 5,
          riderTags: ["Friendly"],
          dishes: [{ itemId: ITEM, itemName: "Chicken kottu", thumb: Thumb.THUMB_UP }],
          comment: "Great",
          ratedAt: new Date(6000),
        },
      ],
    });
    handlers["support.batchGetOrderIssues"] = () => ({
      issues: [
        {
          orderId: order().id,
          kind: IssueKind.ISSUE_KIND_MISSING,
          lines: [{ lineKey: "k1", quantity: 1 }],
          note: "",
          photoName: "",
          resolution: IssueResolution.ISSUE_RESOLUTION_CREDIT,
          amount: money(1000),
          reportedAt: new Date(7000),
        },
      ],
    });
    const res = await gw.app.inject({ url: "/v1/orders", headers: devAuth });
    expect(res.statusCode).toBe(200);
    const [o] = res.json();
    expect(o).toMatchObject({
      id: "KD-4821",
      ref: order().id,
      status: "delivered",
      deliveredAt: 5000,
      restaurant: { id: 1, discountPercent: 20 },
      lines: [{ key: "k1", unitPrice: 1250, qty: 2, choices: ["Sri Lankan hot", "Extra egg"] }],
      address: { id: "home", label: "Home" },
      payment: { type: "card", brand: "Visa", last4: "4242" },
      rider: { name: "Nimal", maskedPhone: "+94 11 520 1234" },
      rating: {
        riderStars: 5,
        riderTags: ["Friendly"],
        dishes: { [ITEM]: "up" },
        comment: "Great",
        ratedAt: 6000,
      },
      issue: {
        kind: "missing",
        lines: [{ key: "k1", qty: 1 }],
        resolution: "credit",
        amount: 1000,
        reportedAt: 7000,
      },
    });
    const body = res.body;
    expect(body).not.toContain("+94770000000");
    expect(body).not.toContain("internal");
    expect(body).not.toContain("+94771234567");
  });

  it("treats someone else's order as not found", async () => {
    handlers["order.getOrder"] = () => ({
      order: order({ customer: { id: "someone-else", name: "", phone: "" } }),
    });
    const res = await gw.app.inject({ url: "/v1/orders/KD-4821", headers: devAuth });
    expect(res.statusCode).toBe(404);
    expect(callsTo("order.getOrder")[0]!.request).toEqual({ orderId: "", orderNumber: "KD-4821" });
  });

  it("maps READY to preparing for delivery and ready for pickup", async () => {
    handlers["order.getOrder"] = (r) => ({
      order: order({
        status: OrderStatus.ORDER_STATUS_READY,
        mode:
          r.orderNumber === "KD-1"
            ? FulfilmentMode.FULFILMENT_MODE_PICKUP
            : FulfilmentMode.FULFILMENT_MODE_DELIVERY,
      }),
    });
    handlers["review.batchGetOrderRatings"] = () => ({ ratings: [] });
    handlers["support.batchGetOrderIssues"] = () => ({ issues: [] });
    expect((await gw.app.inject({ url: "/v1/orders/KD-1", headers: devAuth })).json().status).toBe("ready");
    expect((await gw.app.inject({ url: "/v1/orders/KD-2", headers: devAuth })).json().status).toBe(
      "preparing",
    );
  });

  it("returns { order: null } when nothing is on its way", async () => {
    handlers["order.getActiveOrder"] = () => ({});
    const res = await gw.app.inject({ url: "/v1/orders/active", headers: devAuth });
    expect(res.json()).toEqual({ order: null });
  });
});

describe("gRPC error mapping and edges", () => {
  it("hides upstream detail on 5xx", async () => {
    handlers["catalog.listCategories"] = () =>
      grpcError(status.UNAVAILABLE, "connect ECONNREFUSED 10.0.0.7:50101");
    const res = await gw.app.inject({ url: "/v1/categories" });
    expect(res.statusCode).toBe(503);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().detail).not.toContain("ECONNREFUSED");
  });

  it("answers CORS preflight for the app's origin only", async () => {
    const preflight = (origin: string) =>
      gw.app.inject({
        method: "OPTIONS",
        url: "/v1/orders",
        headers: { origin, "access-control-request-method": "POST" },
      });
    expect((await preflight("http://localhost:5174")).headers["access-control-allow-origin"]).toBe(
      "http://localhost:5174",
    );
    expect((await preflight("https://evil.example")).headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns problem+json for unknown routes and serves health", async () => {
    expect((await gw.app.inject({ url: "/nope" })).json().code).toBe("ROUTE_NOT_FOUND");
    expect((await gw.app.inject({ url: "/health/ready" })).statusCode).toBe(200);
    gw.lifecycle.draining = true;
    expect((await gw.app.inject({ url: "/health/ready" })).statusCode).toBe(503);
  });

  it("serves the OpenAPI document with named components", async () => {
    const doc = (await gw.app.inject({ url: "/openapi.json" })).json();
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(["Restaurant", "Order", "Menu"]),
    );
    expect(doc.paths["/v1/orders"].post.operationId).toBe("placeOrder");
  });
});

describe("WebSocket /ws (proxy to realtime)", () => {
  const next = (ws: { once: (e: "message", fn: (d: Buffer) => void) => void }) =>
    new Promise<unknown>((resolve) => ws.once("message", (d) => resolve(JSON.parse(d.toString()))));

  it("authenticates, connects upstream with identity headers and pipes frames both ways", async () => {
    const ws = await gw.app.injectWS("/ws");
    ws.send(JSON.stringify({ type: "auth", token: `dev:${DILINI}:customer` }));
    expect(await next(ws)).toEqual({ type: "ready", userId: DILINI, realtime: true });
    const up = upstreamSockets[0]!;
    expect(up.headers).toEqual({ "x-user-id": DILINI, "x-roles": "customer" });

    ws.send(JSON.stringify({ subscribe: { channels: ["order:1"] } }));
    ws.send(JSON.stringify({ type: "ping" }));
    expect(await next(ws)).toEqual({ type: "pong" });
    expect(up.sent).toEqual([JSON.stringify({ subscribe: { channels: ["order:1"] } })]);

    const pushed = next(ws);
    up.emit("message", JSON.stringify({ message: { channel: "order:1" } }));
    expect(await pushed).toEqual({ message: { channel: "order:1" } });
    ws.terminate();
  });

  it("degrades gracefully when realtime is down", async () => {
    realtimeUp = false;
    const ws = await gw.app.injectWS("/ws");
    const msgs: unknown[] = [];
    const two = new Promise<void>((resolve) =>
      ws.on("message", (d: Buffer) => {
        msgs.push(JSON.parse(d.toString()));
        if (msgs.length === 2) resolve();
      }),
    );
    ws.send(JSON.stringify({ type: "auth", token: `dev:${DILINI}:customer` }));
    await two;
    expect(msgs[0]).toEqual({ type: "ready", userId: DILINI, realtime: false });
    expect(msgs[1]).toMatchObject({ type: "error", code: "REALTIME_UNAVAILABLE" });
    ws.terminate();
  });

  it("closes with 4401 when the first message is not auth", async () => {
    const ws = await gw.app.injectWS("/ws");
    const closed = new Promise<number>((resolve) => ws.once("close", (code: number) => resolve(code)));
    ws.send(JSON.stringify({ type: "ping" }));
    expect(await closed).toBe(4401);
  });
});
