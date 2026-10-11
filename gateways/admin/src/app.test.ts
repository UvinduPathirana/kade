import { BinaryWriter } from "@bufbuild/protobuf/wire";
import { Metadata, status, type ServiceError } from "@grpc/grpc-js";
import { PaymentMethodKind, RefundMethod } from "@kade/proto/kade/common/v1/commerce";
import { RiderStatus } from "@kade/proto/kade/dispatch/v1/dispatch_service";
import { AuditRecordType, StaffRole, StaffStatus } from "@kade/proto/kade/identity/v1/identity_service";
import { OutletAdminStatus, type OutletAdminView } from "@kade/proto/kade/merchant/v1/merchant_service";
import { OrderStatus, type Order } from "@kade/proto/kade/order/v1/order_service";
import {
  MessageAuthorKind,
  RequesterKind,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "@kade/proto/kade/support/v1/support_service";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type Gateway } from "./app.js";
import { createAuthenticator } from "./auth.js";
import { loadConfig } from "./config.js";
import type { Upstreams } from "./grpc/clients.js";
import { STATUS_DETAILS_KEY } from "./grpc/error-details.js";

const config = loadConfig({
  SERVICE_NAME: "gateway-test",
  HTTP_PORT: "0",
  KEYCLOAK_ISSUER: "http://localhost:8080/realms/kade",
  CORS_ORIGINS: "http://localhost:5177",
  AUTH_DEV_BYPASS: "true",
  DEPLOY_ENV: "dev",
});

interface Call {
  service: keyof Upstreams;
  method: string;
  request: Record<string, unknown>;
  metadata: Metadata;
  deadline: number;
}
type Handler = (req: Record<string, unknown>) => unknown;

let calls: Call[];
let handlers: Record<string, Handler>;
let gw: Gateway;

const unavailable = (): ServiceError => grpcError(status.UNAVAILABLE, "connect ECONNREFUSED 127.0.0.1:50110");

// Fake upstreams: every client method looks up "<service>.<method>" in `handlers`; unknown calls
// fail as UNAVAILABLE (a service that isn't running), which is exactly what soft joins must survive.
function fakeUpstreams(): Upstreams {
  const client = (service: keyof Upstreams) =>
    new Proxy(
      {},
      {
        get:
          (_t, method: string) =>
          (
            request: Record<string, unknown>,
            metadata: Metadata,
            options: { deadline: number },
            cb: (e: unknown, r?: unknown) => void,
          ) => {
            calls.push({ service, method, request, metadata, deadline: options.deadline });
            const h = handlers[`${service}.${method}`];
            queueMicrotask(() => {
              if (!h) return cb(unavailable());
              try {
                cb(null, h(request));
              } catch (err) {
                cb(err);
              }
            });
            return { cancel: () => undefined };
          },
      },
    );
  const names: (keyof Upstreams)[] = [
    "order",
    "dispatchOps",
    "riders",
    "outlets",
    "applications",
    "merchandising",
    "customers",
    "credit",
    "staff",
    "audit",
    "pricing",
    "vouchers",
    "ledger",
    "payouts",
    "riderFinance",
    "tickets",
  ];
  return Object.fromEntries(names.map((n) => [n, client(n)])) as unknown as Upstreams;
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

const money = (rupees: number) => ({ amountMinor: rupees * 100, currency: "LKR" });
const NOW = Date.now();
const ORDER_ID = "0199d3a0-0000-7000-8000-00000000abcd";
const RESTAURANT_1 = "00000000-0000-7000-8000-000000000001";
const RIDER_101 = "00000000-0000-7000-8001-000000000101";
const CUSTOMER_2040 = "00000000-0000-7000-8002-000000002040";

function order(over: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    orderNumber: "KD-4821",
    status: OrderStatus.ORDER_STATUS_PICKED_UP,
    mode: 1,
    customer: { id: CUSTOMER_2040, name: "Amaya Perera", phone: "+94771234567" },
    restaurant: {
      id: RESTAURANT_1,
      name: "Galle Road Kottu House",
      imageId: "",
      area: "Kollupitiya",
      address: "",
      phone: "+94112345678",
      location: { lat: 6.91, lng: 79.85 },
      zoneId: "c03",
      etaMinMinutes: 20,
      etaMaxMinutes: 30,
      discountPercent: 0,
    },
    lines: [
      {
        key: "l1",
        itemId: "i1",
        name: "Chicken kottu",
        unitPrice: money(1150),
        quantity: 2,
        options: [],
        choiceNames: ["Spicy"],
        note: "",
        sectionId: "",
      },
    ],
    address: { id: "", label: "Home", line: "42 Flower Road", area: "Kollupitiya", note: "", zoneId: "c03" },
    riderNote: "",
    kitchenNote: "",
    cutlery: false,
    payment: {
      kind: PaymentMethodKind.PAYMENT_METHOD_KIND_CARD,
      cardId: "c",
      cardBrand: 1,
      cardLast4: "4242",
    },
    paymentId: "",
    totals: {
      itemCount: 2,
      subtotal: money(2300),
      saving: money(100),
      deliveryFee: money(150),
      smallOrderFee: money(0),
      promoDiscount: money(200),
      tip: money(0),
      credit: money(0),
      total: money(2150),
    },
    substitution: 0,
    groupId: "",
    zoneId: "c03",
    distanceKm: 3.14,
    deliveryCode: "",
    rider: {
      riderId: RIDER_101,
      name: "Nimal Silva",
      firstName: "Nimal",
      rating: 4.8,
      vehicle: "",
      plate: "",
      maskedPhone: "",
      phone: "+94770000101",
    },
    deliveryId: "",
    placedAt: new Date(NOW - 50 * 60_000),
    dueAt: new Date(NOW - 12 * 60_000),
    prepMinutes: 15,
    refunded: money(0),
    timeline: [{ at: new Date(NOW - 50 * 60_000), status: 3, label: "Placed", by: "" }],
    notes: [],
    failureReason: "",
    failureMessage: "",
    customerRepeatCount: 0,
    ...over,
  };
}

const zones = [
  {
    id: "c03",
    code: "Colombo 03",
    name: "Kollupitiya",
    open: true,
    baseFee: money(100),
    perKm: money(30),
    smallOrderFee: money(80),
    smallOrderUnder: money(500),
    ridersNeeded: 6,
    boundary: [
      { lat: 6.92, lng: 79.84 },
      { lat: 6.92, lng: 79.86 },
      { lat: 6.9, lng: 79.86 },
      { lat: 6.9, lng: 79.84 },
    ],
  },
];

const outlet = (over: Partial<NonNullable<OutletAdminView["outlet"]>["status"]> = {}): OutletAdminView => ({
  outlet: {
    id: RESTAURANT_1,
    name: "Galle Road Kottu House",
    area: "Kollupitiya",
    address: "",
    phone: "+94112345678",
    zoneId: "c03",
    status: {
      busyExtraMinutes: 0,
      adminStatus: OutletAdminStatus.OUTLET_ADMIN_STATUS_OPEN,
      adminStatusReason: "",
      accepting: true,
      ...over,
    },
    commissionBps: 1800,
    joinedAt: new Date("2025-03-01T00:00:00Z"),
    bank: { bank: "Sampath Bank", branch: "", accountName: "", accountNumber: "", accountLast4: "1234" },
  },
  cuisine: "Sri Lankan",
  categoryId: "kottu",
  imageId: "1589302168068-964664d93dc0",
  rating: 4.62,
  ordersWeek: 210,
  acceptanceRate: 0.97,
  waitingMinutes: 0,
  owner: { id: "u", name: "Ruwan Fernando", phone: "+94771111111" },
  ownerEmail: "ruwan@example.lk",
  etaMinMinutes: 20,
  hasOffer: true,
});

beforeEach(async () => {
  calls = [];
  handlers = {
    "pricing.listZones": () => ({ zones }),
    "audit.recordAudit": (r) => ({ entry: { id: "a1", ...r } }),
  };
  gw = await buildApp({
    config,
    logger: pino({ level: "silent" }),
    authenticator: createAuthenticator(config, async () => {
      throw new Error("no JWKS in unit tests");
    }),
    upstreams: fakeUpstreams(),
  });
  await gw.app.ready();
});
afterEach(() => gw.app.close());

const as = (who: string, roles: string) => ({ authorization: `Bearer dev:${who}:${roles}` });
const ops = as("00000000-0000-7000-8005-000000000005", "ops");
const support = as("00000000-0000-7000-8005-000000000007", "support");
const finance = as("00000000-0000-7000-8005-000000000006", "finance");
const callsTo = (service: keyof Upstreams, method: string) =>
  calls.filter((c) => c.service === service && c.method === method);

describe("auth and roles", () => {
  it("needs a token, then a staff role", async () => {
    const anon = await gw.app.inject({ url: "/v1/orders" });
    expect(anon.statusCode).toBe(401);
    expect(anon.headers["content-type"]).toContain("application/problem+json");
    const customer = await gw.app.inject({ url: "/v1/orders", headers: as("dilini", "customer") });
    expect(customer.statusCode).toBe(403);
    expect(customer.json().code).toBe("PERMISSION_DENIED");
    expect(calls.filter((c) => c.service === "order")).toHaveLength(0);
  });

  it("tells the console who is signed in, with effective permissions", async () => {
    handlers["staff.listStaff"] = () => ({
      staff: [
        {
          id: "00000000-0000-7000-8005-000000000005",
          name: "Tharushi Jayawardena",
          email: "ops@kade.lk",
          role: StaffRole.STAFF_ROLE_OPS,
          title: "Dispatcher",
          status: StaffStatus.STAFF_STATUS_ACTIVE,
        },
      ],
    });
    const res = await gw.app.inject({ url: "/v1/me", headers: ops });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: "U-5",
      name: "Tharushi Jayawardena",
      short: "Tharushi",
      role: "ops",
      title: "Dispatcher",
    });
    expect(res.json().permissions).toContain("orders.cancel");
    expect(res.json().permissions).not.toContain("finance.payouts");
  });
});

describe("orders", () => {
  it("maps orders to the console's shape and forwards identity with a deadline", async () => {
    handlers["order.listOrders"] = () => ({
      orders: [order(), order({ status: OrderStatus.ORDER_STATUS_PENDING })],
    });
    const before = Date.now();
    const res = await gw.app.inject({ url: "/v1/orders", headers: ops });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(1); // PENDING is still in checkout: hidden
    expect(list[0]).toMatchObject({
      id: "KD-4821",
      status: "pickedUp",
      customerId: "C-2040",
      restaurantId: 1,
      riderId: "R-101",
      zoneId: "c03",
      payment: "card",
      cardLast4: "4242",
      lines: [{ name: "Chicken kottu (Spicy)", qty: 2, price: 1150 }],
      subtotal: 2300,
      deliveryFee: 150,
      discount: 300,
      total: 2150,
      refunded: 0,
      lateMin: 12,
      restaurant: { id: "1", name: "Galle Road Kottu House" },
      rider: { id: "R-101", name: "Nimal Silva" },
      zone: { code: "Colombo 03", name: "Kollupitiya" },
    });
    expect(list[0].pos.x).toBeGreaterThan(0);
    const call = callsTo("order", "listOrders")[0]!;
    expect(call.metadata.get("x-user-id")).toEqual(["00000000-0000-7000-8005-000000000005"]);
    expect(call.metadata.get("x-roles")).toEqual(["ops"]);
    expect(call.deadline - before).toBeGreaterThanOrEqual(config.GRPC_DEADLINE_MS);
  });

  it("looks an order up by its number", async () => {
    handlers["order.getOrder"] = () => ({ order: order() });
    const res = await gw.app.inject({ url: "/v1/orders/KD-4821", headers: support });
    expect(res.statusCode).toBe(200);
    expect(callsTo("order", "getOrder")[0]!.request).toMatchObject({ orderNumber: "KD-4821", orderId: "" });
    // profile isn't running: the email is optional, the order still loads
    expect(res.json().customer.email).toBe("");
  });

  it("checks refund size against the role's permissions, calls order in minor units and audits", async () => {
    handlers["order.getOrder"] = () => ({ order: order() });
    handlers["order.refundOrder"] = () => ({ order: order({ refunded: money(450) }) });
    const big = await gw.app.inject({
      method: "POST",
      url: "/v1/orders/KD-4821/refunds",
      headers: support,
      payload: { amount: 6000, method: "card", reason: "Spilled" },
    });
    expect(big.statusCode).toBe(403);
    expect(callsTo("order", "refundOrder")).toHaveLength(0);

    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/orders/KD-4821/refunds",
      headers: { ...support, "idempotency-key": "k-1" },
      payload: { amount: 450, method: "card", reason: "Spilled" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().refunded).toBe(450);
    expect(callsTo("order", "refundOrder")[0]!.request).toMatchObject({
      orderId: ORDER_ID,
      amount: { amountMinor: 45_000, currency: "LKR" },
      method: RefundMethod.REFUND_METHOD_CARD,
      reason: "Spilled",
      idempotencyKey: "k-1",
    });
    expect(callsTo("audit", "recordAudit")[0]!.request).toMatchObject({
      action: "Refunded Rs 450 to card",
      recordType: AuditRecordType.AUDIT_RECORD_TYPE_ORDER,
      recordId: "KD-4821",
      detail: "Spilled",
    });
  });

  it("denies cancelling to finance, and honours identity's edited matrix", async () => {
    const denied = await gw.app.inject({
      method: "POST",
      url: "/v1/orders/KD-4821/cancel",
      headers: finance,
      payload: { reason: "Duplicate", fault: "customer", refund: true },
    });
    expect(denied.statusCode).toBe(403);

    handlers["staff.getPermissionMatrix"] = () => ({
      permissions: [],
      matrix: [{ role: StaffRole.STAFF_ROLE_FINANCE, permissionIds: ["orders.view", "orders.cancel"] }],
    });
    handlers["order.getOrder"] = () => ({ order: order() });
    handlers["order.cancelOrder"] = () => ({ order: order({ status: OrderStatus.ORDER_STATUS_CANCELLED }) });
    // a fresh gateway, so the cached default matrix doesn't apply
    await gw.app.close();
    gw = await buildApp({
      config,
      logger: pino({ level: "silent" }),
      authenticator: createAuthenticator(config, async () => {
        throw new Error("unused");
      }),
      upstreams: fakeUpstreams(),
    });
    const allowed = await gw.app.inject({
      method: "POST",
      url: "/v1/orders/KD-4821/cancel",
      headers: finance,
      payload: { reason: "Duplicate", fault: "customer", refund: true },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ status: "cancelled", lateMin: 0 });
    expect(callsTo("audit", "recordAudit")[0]!.request).toMatchObject({
      action: "Cancelled order",
      detail: "Duplicate. Customer at fault.",
    });
  });

  it("passes service reasons through as problem codes", async () => {
    handlers["order.getOrder"] = () => ({ order: order() });
    handlers["order.refundOrder"] = () => {
      throw grpcError(
        status.FAILED_PRECONDITION,
        "This order was paid in cash. Refund it as Kadé credit.",
        "CASH_ORDER_REFUND_TO_CREDIT",
      );
    };
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/orders/KD-4821/refunds",
      headers: ops,
      payload: { amount: 100, method: "card", reason: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "CASH_ORDER_REFUND_TO_CREDIT",
      detail: "This order was paid in cash. Refund it as Kadé credit.",
    });
    expect(callsTo("audit", "recordAudit")).toHaveLength(0);
  });

  it("hides upstream detail when a service is down", async () => {
    const res = await gw.app.inject({ url: "/v1/orders", headers: ops });
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).not.toContain("ECONNREFUSED");
  });
});

describe("live dashboard", () => {
  it("aggregates from order, merchant and pricing while dispatch is down", async () => {
    const late = order();
    const waiting = order({
      id: "o2",
      orderNumber: "KD-4822",
      status: OrderStatus.ORDER_STATUS_PREPARING,
      rider: undefined,
      dueAt: new Date(NOW + 20 * 60_000),
    });
    handlers["order.listOrders"] = (r) =>
      r.activeOnly
        ? { orders: [late, waiting] }
        : r.placedBefore
          ? { orders: [] }
          : { orders: [late, waiting] };
    handlers["outlets.listOutlets"] = () => ({ outlets: [outlet({ accepting: false })] });
    const res = await gw.app.inject({ url: "/v1/live", headers: support });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s).toMatchObject({ inProgress: 2, waitingForRider: 1, late: 1, ordersToday: 2, ridersNeeded: 6 });
    expect(s.attention.map((a: { kind: string }) => a.kind)).toEqual(["lateOrder", "restaurantNotAccepting"]);
    expect(s.attention[0]).toMatchObject({ title: "KD-4821 is 12 min late", href: "/orders?order=KD-4821" });
    expect(s.attention[1]).toMatchObject({ href: "/restaurants?id=1" });
    expect(s.dots.map((d: { kind: string }) => d.kind).sort()).toEqual(["late", "waiting"]);
    expect(s.zones).toEqual([{ id: "c03", orders: 2, riders: 0, open: true }]);
  });

  it("uses dispatch's snapshot when it is up", async () => {
    handlers["dispatchOps.getLiveSnapshot"] = () => ({
      snapshot: {
        at: new Date(NOW),
        inProgress: 7,
        waitingForRider: 2,
        late: 1,
        ridersOnline: 9,
        ridersNeeded: 12,
        shortestZoneCode: "Colombo 03",
        shortestZoneShort: 3,
        avgDeliveryMinutes: 31.6,
        cancellationsToday: 1,
        ordersToday: 40,
        attention: [
          {
            id: "r",
            kind: 3,
            title: "Nimal holds cash",
            detail: "",
            severity: 61,
            recordType: "rider",
            recordId: RIDER_101,
            phone: "",
          },
        ],
        ordersByHour: [{ hour: 19, today: 12, lastWeek: 10 }],
        dots: [
          {
            id: RIDER_101,
            kind: 4,
            zoneId: "c03",
            location: { lat: 6.91, lng: 79.85 },
            label: "Nimal, free",
          },
        ],
        zones: [{ zoneId: "c03", zoneCode: "Colombo 03", orders: 4, riders: 3, ridersNeeded: 6, open: true }],
      },
    });
    const s = (await gw.app.inject({ url: "/v1/live", headers: ops })).json();
    expect(s).toMatchObject({
      inProgress: 7,
      avgDeliveryMin: 32,
      shortestZone: { code: "Colombo 03", short: 3 },
    });
    expect(s.attention[0]).toMatchObject({ kind: "riderCash", href: "/riders?id=R-101" });
    expect(s.dots[0]).toMatchObject({ kind: "rider", zoneId: "c03", x: 0.5, y: 0.5 });
    expect(callsTo("order", "listOrders")).toHaveLength(0);
  });
});

describe("partners, support and team", () => {
  it("maps outlets to restaurants and audits commission changes", async () => {
    handlers["outlets.listOutlets"] = () => ({ outlets: [outlet()] });
    const list = await gw.app.inject({ url: "/v1/restaurants", headers: ops });
    expect(list.json()[0]).toMatchObject({
      id: 1,
      commission: 18,
      status: "open",
      accepting: true,
      bank: "Sampath Bank ending 1234",
      category: "kottu",
      rating: 4.6,
      joinedOn: "2025-03-01",
    });

    handlers["outlets.getOutletAdmin"] = () => ({ outlet: outlet() });
    handlers["outlets.updateCommission"] = () => ({
      outlet: { ...outlet(), outlet: { ...outlet().outlet!, commissionBps: 1500 } },
    });
    const opsTry = await gw.app.inject({
      method: "PUT",
      url: "/v1/restaurants/1/commission",
      headers: ops,
      payload: { commission: 15 },
    });
    expect(opsTry.statusCode).toBe(403);
    const res = await gw.app.inject({
      method: "PUT",
      url: "/v1/restaurants/1/commission",
      headers: finance,
      payload: { commission: 15 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().commission).toBe(15);
    expect(callsTo("outlets", "updateCommission")[0]!.request).toMatchObject({
      outletId: RESTAURANT_1,
      commissionBps: 1500,
    });
    expect(callsTo("audit", "recordAudit")[0]!.request).toMatchObject({
      action: "Changed commission from 18% to 15%",
    });
  });

  it("fills each ticket's conversation and keeps support to support/ops/admin", async () => {
    const ticket = {
      id: "T-1",
      subject: "Missing raita",
      category: TicketCategory.TICKET_CATEGORY_MISSING_ITEM,
      priority: TicketPriority.TICKET_PRIORITY_HIGH,
      requester: { kind: RequesterKind.REQUESTER_KIND_CUSTOMER, id: CUSTOMER_2040, name: "Amaya" },
      orderId: ORDER_ID,
      orderNumber: "KD-4821",
      channel: 1,
      openedAt: new Date(NOW - 600_000),
      slaDueAt: new Date(NOW + 600_000),
      assigneeId: "00000000-0000-7000-8005-000000000007",
      assigneeName: "",
      status: TicketStatus.TICKET_STATUS_OPEN,
      messages: [] as unknown[],
    };
    handlers["tickets.listTickets"] = () => ({ tickets: [ticket] });
    handlers["tickets.getTicket"] = () => ({
      ticket: {
        ...ticket,
        messages: [
          {
            id: "m1",
            ticketId: "T-1",
            at: new Date(NOW),
            from: MessageAuthorKind.MESSAGE_AUTHOR_KIND_REQUESTER,
            author: "Amaya",
            body: "No raita",
          },
        ],
      },
    });
    expect((await gw.app.inject({ url: "/v1/tickets", headers: finance })).statusCode).toBe(403);
    const res = await gw.app.inject({ url: "/v1/tickets", headers: support });
    expect(res.json()[0]).toMatchObject({
      id: "T-1",
      category: "missingItem",
      priority: "high",
      requester: { kind: "customer", id: "C-2040" },
      orderId: "KD-4821",
      assigneeId: "U-7",
      status: "open",
      messages: [{ from: "requester", body: "No raita" }],
    });
  });

  it("only lets team.manage invite, and only @kade.lk", async () => {
    const opsTry = await gw.app.inject({
      method: "POST",
      url: "/v1/team/staff",
      headers: ops,
      payload: { name: "A", email: "a@kade.lk", role: "ops" },
    });
    expect(opsTry.statusCode).toBe(403);
    const bad = await gw.app.inject({
      method: "POST",
      url: "/v1/team/staff",
      headers: as("00000000-0000-7000-8005-000000000008", "admin,ops,finance,support"),
      payload: { name: "A", email: "a@gmail.com", role: "ops" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: "EMAIL_NOT_KADE", detail: "Use their @kade.lk work email." });
  });
});

describe("edge concerns", () => {
  it("answers CORS preflight for the console's origin only", async () => {
    const preflight = (origin: string) =>
      gw.app.inject({
        method: "OPTIONS",
        url: "/v1/orders",
        headers: { origin, "access-control-request-method": "GET" },
      });
    expect((await preflight("http://localhost:5177")).headers["access-control-allow-origin"]).toBe(
      "http://localhost:5177",
    );
    expect((await preflight("https://evil.example")).headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns problem+json for unknown routes and serves health", async () => {
    expect((await gw.app.inject({ url: "/nope" })).json().code).toBe("ROUTE_NOT_FOUND");
    expect((await gw.app.inject({ url: "/health/ready" })).statusCode).toBe(200);
    gw.lifecycle.draining = true;
    expect((await gw.app.inject({ url: "/health/ready" })).statusCode).toBe(503);
  });
});

describe("WebSocket /ws", () => {
  it("authenticates staff with the first message and answers ping", async () => {
    const ws = await gw.app.injectWS("/ws");
    const next = () =>
      new Promise<unknown>((resolve) => ws.once("message", (data) => resolve(JSON.parse(data.toString()))));
    ws.send(JSON.stringify({ type: "auth", token: "dev:ops-1:ops" }));
    expect(await next()).toEqual({ type: "ready", userId: "ops-1" });
    ws.send(JSON.stringify({ type: "ping" }));
    expect(await next()).toEqual({ type: "pong" });
    ws.terminate();
  });

  it("closes 4403 for non-staff and 4401 without auth", async () => {
    const customer = await gw.app.injectWS("/ws");
    const c1 = new Promise<number>((resolve) => customer.once("close", (code) => resolve(code)));
    customer.send(JSON.stringify({ type: "auth", token: "dev:dilini:customer" }));
    expect(await c1).toBe(4403);
    const anon = await gw.app.injectWS("/ws");
    const c2 = new Promise<number>((resolve) => anon.once("close", (code) => resolve(code)));
    anon.send(JSON.stringify({ type: "ping" }));
    expect(await c2).toBe(4401);
  });
});

export const _unused = RiderStatus;
