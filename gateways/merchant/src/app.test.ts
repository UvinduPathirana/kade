import { BinaryWriter } from "@bufbuild/protobuf/wire";
import { Metadata, status, type ServiceError } from "@grpc/grpc-js";
import { DayOfWeek, FulfilmentMode, PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import { OutletStaffRole, TicketStatus, type Ticket } from "@kade/proto/kade/merchant/v1/merchant_service";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type Gateway } from "./app.js";
import { createAuthenticator } from "./auth.js";
import { loadConfig } from "./config.js";
import type { Upstreams } from "./grpc/clients.js";
import { STATUS_DETAILS_KEY } from "./grpc/error-details.js";

const OUTLET = "00000000-0000-7000-8000-000000000001";

const config = loadConfig({
  SERVICE_NAME: "gateway-test",
  HTTP_PORT: "0",
  KEYCLOAK_ISSUER: "http://localhost:8080/realms/kade",
  CORS_ORIGINS: "http://localhost:5175",
  AUTH_DEV_BYPASS: "true",
  DEPLOY_ENV: "dev",
  DEFAULT_OUTLET_ID: "fallback-outlet",
  REALTIME_WS_URL: "",
});

interface Call {
  method: string;
  request: Record<string, unknown>;
  metadata: Metadata;
  deadline: number;
}

type Reply = { error: ServiceError } | { response: unknown };
let calls: Call[];
let replies: Record<string, Reply>;
let gw: Gateway;

/**
 * Stands in for every generated client: records what the gateway sends and replays the canned
 * answer for "<client>.<method>" (missing answers fail like an unreachable service).
 */
function fakeClient(name: string): unknown {
  return new Proxy(
    {},
    {
      get: (_t, method: string) => {
        if (method === "close") return () => undefined;
        return (
          request: Record<string, unknown>,
          metadata: Metadata,
          options: { deadline: number },
          cb: (e: unknown, r?: unknown) => void,
        ) => {
          const key = `${name}.${method}`;
          calls.push({ method: key, request, metadata, deadline: options.deadline });
          const reply = replies[key] ?? { error: grpcError(status.UNAVAILABLE, "connect ECONNREFUSED") };
          queueMicrotask(() => ("error" in reply ? cb(reply.error) : cb(null, reply.response)));
          return { cancel: () => undefined };
        };
      },
    },
  );
}

function grpcError(code: status, details: string, reason?: string): ServiceError {
  const metadata = new Metadata();
  if (reason) {
    const info = new BinaryWriter().uint32(10).string(reason).uint32(18).string("merchant").finish();
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

const rs = (rupees: number) => ({ amountMinor: rupees * 100, currency: "LKR" });
const placedAt = new Date("2026-10-12T14:00:00Z");

const ticket: Ticket = {
  orderId: "order-2417",
  orderNumber: "KD-2417",
  ticketNumber: "2417",
  outletId: OUTLET,
  status: TicketStatus.TICKET_STATUS_NEW,
  mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
  customerFirstName: "Shehani",
  repeatCount: 3,
  lines: [
    {
      itemId: "i1",
      name: "Cheese kottu",
      quantity: 2,
      choiceNames: ["Medium"],
      note: "",
      unitPrice: rs(1450),
    },
  ],
  kitchenNote: "",
  cutlery: true,
  payment: PaymentMethodKind.PAYMENT_METHOD_KIND_CASH,
  subtotal: rs(2900),
  scheduledFor: undefined,
  placedAt,
  acceptBy: new Date(placedAt.getTime() + 180_000),
  acceptedAt: undefined,
  prepMinutes: 0,
  readyBy: undefined,
  readyAt: undefined,
  pickedUpAt: undefined,
  closedAt: undefined,
  rejectReason: 0,
  rejectNote: "",
  rider: undefined,
  riderArrivesAt: undefined,
  riderAtCounter: false,
};

const myOutlets: Reply = {
  response: {
    outlets: [
      {
        outletId: OUTLET,
        outletName: "Galle Road Kottu House",
        role: OutletStaffRole.OUTLET_STAFF_ROLE_OWNER,
      },
    ],
  },
};

beforeEach(async () => {
  calls = [];
  replies = { "staff.getMyOutlets": myOutlets };
  const names = [
    "kitchen",
    "outlets",
    "staff",
    "applications",
    "catalog",
    "menus",
    "restaurants",
    "reviews",
    "finance",
    "offers",
  ] as const;
  const upstreams = Object.fromEntries(names.map((n) => [n, fakeClient(n)])) as unknown as Upstreams;
  gw = await buildApp({
    config,
    logger: pino({ level: "silent" }),
    authenticator: createAuthenticator(config, async () => {
      throw new Error("no JWKS in unit tests");
    }),
    upstreams,
  });
  await gw.app.ready();
});
afterEach(() => gw.app.close());

const owner = { authorization: "Bearer dev:ruwan:merchant_owner,merchant_staff" };
const kitchen = { authorization: "Bearer dev:kasun:merchant_staff" };
const callsTo = (method: string) => calls.filter((c) => c.method === method);

describe("auth and outlet resolution", () => {
  it("requires a token and answers with problem+json", async () => {
    const res = await gw.app.inject({ url: "/v1/tickets" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ status: 401, code: "UNAUTHENTICATED", instance: "/v1/tickets" });
    expect(calls).toHaveLength(0);
  });

  it("refuses accounts without a merchant role", async () => {
    const res = await gw.app.inject({
      url: "/v1/tickets",
      headers: { authorization: "Bearer dev:dilini:customer" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("resolves the outlet with GetMyOutlets and sends it as x-outlet-id", async () => {
    replies["kitchen.listTickets"] = { response: { tickets: [ticket] } };
    const res = await gw.app.inject({ url: "/v1/tickets", headers: owner });
    expect(res.statusCode).toBe(200);
    const list = callsTo("kitchen.listTickets")[0]!;
    expect(list.request).toMatchObject({ outletId: OUTLET, closedWithinMinutes: 90 });
    expect(list.metadata.get("x-outlet-id")).toEqual([OUTLET]);
    expect(list.metadata.get("x-user-id")).toEqual(["ruwan"]);
    // Cached: a second request doesn't ask merchant again.
    await gw.app.inject({ url: "/v1/tickets", headers: owner });
    expect(callsTo("staff.getMyOutlets")).toHaveLength(1);
  });

  it("falls back to DEFAULT_OUTLET_ID while merchant can't answer", async () => {
    delete replies["staff.getMyOutlets"];
    replies["kitchen.listTickets"] = { response: { tickets: [] } };
    const res = await gw.app.inject({ url: "/v1/tickets", headers: kitchen });
    expect(res.statusCode).toBe(200);
    expect(callsTo("kitchen.listTickets")[0]!.request).toMatchObject({ outletId: "fallback-outlet" });
  });

  it("uses the token's outlet claim when present", async () => {
    replies["kitchen.listTickets"] = { response: { tickets: [] } };
    await gw.app.inject({
      url: "/v1/tickets",
      headers: { authorization: "Bearer dev:kasun:merchant_staff:o-9" },
    });
    expect(callsTo("staff.getMyOutlets")).toHaveLength(0);
    expect(callsTo("kitchen.listTickets")[0]!.request).toMatchObject({ outletId: "o-9" });
  });

  it("answers /v1/me with the outlet", async () => {
    const res = await gw.app.inject({ url: "/v1/me", headers: owner });
    expect(res.json()).toMatchObject({
      userId: "ruwan",
      outletId: OUTLET,
      outletName: "Galle Road Kottu House",
    });
  });
});

describe("kitchen board", () => {
  it("maps tickets to the app's shape (rupees, epoch ms, short number)", async () => {
    replies["kitchen.listTickets"] = { response: { tickets: [ticket] } };
    const res = await gw.app.inject({ url: "/v1/tickets", headers: owner });
    expect(res.json()).toEqual([
      {
        id: "2417",
        placedAt: placedAt.getTime(),
        acceptBy: placedAt.getTime() + 180_000,
        status: "new",
        mode: "delivery",
        customerName: "Shehani",
        repeatCount: 3,
        lines: [
          { itemId: "i1", name: "Cheese kottu", qty: 2, choices: ["Medium"], note: "", unitPrice: 1450 },
        ],
        kitchenNote: "",
        cutlery: true,
        payment: "cash",
        subtotal: 2900,
      },
    ]);
  });

  it("accepts by ticket number: looks up the order id, forwards prep time and idempotency key", async () => {
    replies["kitchen.listTickets"] = { response: { tickets: [ticket] } };
    replies["kitchen.acceptOrder"] = {
      response: {
        ticket: {
          ...ticket,
          status: TicketStatus.TICKET_STATUS_PREPARING,
          prepMinutes: 15,
          acceptedAt: placedAt,
        },
      },
    };
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/tickets/2417/accept",
      headers: { ...owner, "idempotency-key": "k-1" },
      payload: { prepMinutes: 15 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "2417", status: "preparing", prepMinutes: 15 });
    expect(callsTo("kitchen.acceptOrder")[0]!.request).toEqual({
      outletId: OUTLET,
      orderId: "order-2417",
      prepMinutes: 15,
      idempotencyKey: "k-1",
    });
  });

  it("maps upstream reasons to the app's copy", async () => {
    replies["kitchen.listTickets"] = { response: { tickets: [ticket] } };
    replies["kitchen.acceptOrder"] = {
      error: grpcError(status.FAILED_PRECONDITION, "accept_by passed", "TICKET_MISSED"),
    };
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/tickets/2417/accept",
      headers: owner,
      payload: { prepMinutes: 15 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "TICKET_MISSED",
      detail: "This order wasn't accepted in time.",
    });
  });

  it("keeps ids unique when two orders share a ticket number", async () => {
    const twin = { ...ticket, orderId: "order-abcd" };
    replies["kitchen.listTickets"] = { response: { tickets: [ticket, twin] } };
    replies["kitchen.markOrderReady"] = { response: { ticket: twin } };
    const ids = (await gw.app.inject({ url: "/v1/tickets", headers: owner }))
      .json()
      .map((t: { id: string }) => t.id);
    expect(ids).toEqual(["2417-2417", "2417-abcd"]);
    const res = await gw.app.inject({ method: "POST", url: "/v1/tickets/2417-abcd/ready", headers: owner });
    expect(res.json().id).toBe("2417-abcd");
    expect(callsTo("kitchen.markOrderReady")[0]!.request).toMatchObject({ orderId: "order-abcd" });
  });

  it("404s for a number that isn't on the board", async () => {
    replies["kitchen.listTickets"] = { response: { tickets: [] } };
    const res = await gw.app.inject({ url: "/v1/tickets/9999", headers: owner });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      code: "TICKET_NOT_FOUND",
      detail: "Order #9999 is no longer on the board.",
    });
  });

  it("hides upstream detail on 5xx", async () => {
    const res = await gw.app.inject({ url: "/v1/tickets", headers: owner });
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).not.toContain("ECONNREFUSED");
  });
});

describe("menu, outlet, business", () => {
  it("sorts the menu and converts prices both ways", async () => {
    const menu = {
      restaurantId: OUTLET,
      sections: [
        { id: "s2", name: "Drinks", position: 2, items: [] },
        {
          id: "s1",
          name: "Kottu",
          position: 1,
          items: [
            {
              id: "i1",
              name: "Cheese kottu",
              description: "",
              price: rs(1450),
              imageId: "",
              tags: [2],
              optionGroupIds: [],
              soldOut: false,
              position: 0,
            },
          ],
        },
      ],
      optionGroups: [
        {
          id: "g1",
          name: "Spice",
          required: true,
          maxChoices: 1,
          choices: [{ id: "c", name: "Hot", price: rs(0) }],
        },
      ],
      popular: [],
    };
    replies["catalog.getMenu"] = { response: { menu } };
    replies["menus.saveMenuItem"] = { response: { menu } };
    const res = await gw.app.inject({ url: "/v1/menu", headers: kitchen });
    expect(res.json()).toEqual({
      sections: [
        {
          id: "s1",
          name: "Kottu",
          items: [
            {
              id: "i1",
              name: "Cheese kottu",
              description: "",
              price: 1450,
              tags: ["Spicy"],
              optionGroupIds: [],
              soldOut: false,
            },
          ],
        },
        { id: "s2", name: "Drinks", items: [] },
      ],
      optionGroups: [
        { id: "g1", name: "Spice", required: true, max: 1, choices: [{ name: "Hot", price: 0 }] },
      ],
    });
    await gw.app.inject({
      method: "POST",
      url: "/v1/menu/items",
      headers: owner,
      payload: {
        sectionId: "s1",
        name: "Egg kottu",
        description: "",
        price: 1100,
        tags: ["Vegetarian"],
        optionGroupIds: [],
      },
    });
    expect(callsTo("menus.saveMenuItem")[0]!.request).toMatchObject({
      restaurantId: OUTLET,
      item: { id: "", sectionId: "s1", name: "Egg kottu", price: { amountMinor: 110_000 }, tags: [1] },
    });
  });

  it("composes the outlet and resumes when the pause is cleared", async () => {
    replies["outlets.getOutlet"] = {
      response: {
        outlet: {
          id: OUTLET,
          name: "Old name",
          area: "Kollupitiya",
          address: "a",
          phone: "p",
          status: { busyExtraMinutes: 10 },
        },
      },
    };
    replies["restaurants.getOpeningHours"] = {
      response: {
        hours: [
          { day: DayOfWeek.DAY_OF_WEEK_TUESDAY, isOpen: true, ranges: [{ open: "11:00", close: "02:00" }] },
        ],
        closures: [],
      },
    };
    replies["catalog.getRestaurant"] = {
      response: {
        restaurant: {
          name: "Galle Road Kottu House",
          area: "Kollupitiya",
          address: "312 Galle Road",
          phone: "+94",
        },
      },
    };
    replies["outlets.resumeOutlet"] = { response: {} };
    const res = await gw.app.inject({
      method: "PUT",
      url: "/v1/outlet/pause",
      headers: owner,
      payload: { until: null },
    });
    expect(res.statusCode).toBe(200);
    const outlet = res.json();
    expect(outlet).toMatchObject({
      name: "Galle Road Kottu House",
      status: { busyExtra: 10, pausedUntil: null },
    });
    expect(outlet.hours).toHaveLength(7);
    expect(outlet.hours[1]).toEqual({
      day: "tue",
      isOpen: true,
      ranges: [{ open: "11:00", close: "02:00" }],
    });
    expect(outlet.hours[0]).toEqual({ day: "mon", isOpen: false, ranges: [] });
    expect(callsTo("outlets.resumeOutlet")).toHaveLength(1);
  });

  it("keeps payouts to owners", async () => {
    const res = await gw.app.inject({ url: "/v1/statements", headers: kitchen });
    expect(res.statusCode).toBe(403);
  });

  it("validates offer dates before calling promotion", async () => {
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/offers",
      headers: owner,
      payload: {
        type: "percent",
        value: 20,
        maxDiscount: 0,
        minOrder: 0,
        buy: 0,
        get: 0,
        sectionIds: [],
        startDate: "2026-10-20",
        endDate: "2026-10-10",
        budget: 1000,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toBe("The end date is before the start date.");
    expect(callsTo("offers.createOffer")).toHaveLength(0);
  });

  it("takes partner applications without sign-in", async () => {
    replies["applications.submitApplication"] = {
      response: {
        application: {
          reference: "KP-20418",
          submittedAt: placedAt,
          business: { name: "Hela Bojun" },
          owner: { phone: "+94771234567" },
        },
      },
    };
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/applications",
      payload: {
        business: {
          name: "Hela Bojun",
          type: "restaurant",
          address: "1 Main St",
          city: "Colombo",
          brNumber: "PV1",
        },
        owner: { name: "Ama", phone: "+94771234567", email: "a@b.lk", nic: "1990" },
        documents: { registration: "br.pdf", foodSafety: "", ownerId: "nic.jpg" },
        bank: { bank: "BOC", branch: "Fort", accountName: "Ama", accountNumber: "1234 5678" },
        menu: { method: "later", fileName: "" },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      reference: "KP-20418",
      submittedAt: placedAt.getTime(),
      businessName: "Hela Bojun",
      phone: "+94771234567",
    });
    const sent = callsTo("applications.submitApplication")[0]!.request as {
      documents: unknown[];
      bank: unknown;
    };
    expect(sent.documents).toHaveLength(2);
    expect(sent.bank).toMatchObject({ accountNumber: "12345678", accountLast4: "5678" });
    expect(callsTo("staff.getMyOutlets")).toHaveLength(0);
  });
});

describe("edge concerns", () => {
  it("answers CORS preflight for the app's origin only", async () => {
    const preflight = (origin: string) =>
      gw.app.inject({
        method: "OPTIONS",
        url: "/v1/tickets",
        headers: { origin, "access-control-request-method": "GET" },
      });
    expect((await preflight("http://localhost:5175")).headers["access-control-allow-origin"]).toBe(
      "http://localhost:5175",
    );
    expect((await preflight("https://evil.example")).headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns problem+json for unknown routes", async () => {
    const res = await gw.app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("ROUTE_NOT_FOUND");
  });

  it("serves health and fails readiness while draining", async () => {
    expect((await gw.app.inject({ url: "/health/ready" })).statusCode).toBe(200);
    gw.lifecycle.draining = true;
    expect((await gw.app.inject({ url: "/health/ready" })).statusCode).toBe(503);
  });
});

describe("WebSocket /ws", () => {
  it("authenticates with the first message and says realtime is off when it isn't configured", async () => {
    const ws = await gw.app.injectWS("/ws");
    const next = () =>
      new Promise<unknown>((resolve) => ws.once("message", (data) => resolve(JSON.parse(data.toString()))));
    ws.send(JSON.stringify({ type: "auth", token: "dev:ruwan:merchant_owner" }));
    expect(await next()).toEqual({ type: "ready", userId: "ruwan", realtime: false });
    ws.send(JSON.stringify({ type: "ping" }));
    expect(await next()).toEqual({ type: "pong" });
    ws.terminate();
  });

  it("closes with 4401 when the first message is not auth", async () => {
    const ws = await gw.app.injectWS("/ws");
    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    ws.send(JSON.stringify({ type: "ping" }));
    expect(await closed).toBe(4401);
  });
});
