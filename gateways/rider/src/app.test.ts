import { BinaryWriter } from "@bufbuild/protobuf/wire";
import { Metadata, status, type ServiceError } from "@grpc/grpc-js";
import { PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import { ApplicationStatus } from "@kade/proto/kade/common/v1/onboarding";
import { ProofKind, type Delivery } from "@kade/proto/kade/dispatch/v1/dispatch_service";
import { EarningsPeriod } from "@kade/proto/kade/ledger/v1/ledger_service";
import type { LocationServiceClient } from "@kade/proto/kade/location/v1/location_service";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type Gateway } from "./app.js";
import { createAuthenticator } from "./auth.js";
import { loadConfig } from "./config.js";
import type { Upstreams } from "./grpc/clients.js";
import { STATUS_DETAILS_KEY } from "./grpc/error-details.js";
import { LocationForwarder } from "./location.js";
import { toGeoPoint, toMapPoint } from "./map.js";

const NIMAL = "00000000-0000-7000-8001-000000000101";

const config = loadConfig({
  SERVICE_NAME: "gateway-test",
  HTTP_PORT: "0",
  KEYCLOAK_ISSUER: "http://localhost:8080/realms/kade",
  CORS_ORIGINS: "http://localhost:5176",
  AUTH_DEV_BYPASS: "true",
  DEPLOY_ENV: "dev",
  RIDER_IDS: "nimal=fallback-rider",
  REALTIME_WS_URL: "",
});

interface Call {
  method: string;
  request: Record<string, unknown>;
  metadata: Metadata;
}

type Reply = { error: ServiceError } | { response: unknown };
let calls: Call[];
let replies: Record<string, Reply>;
let streamed: unknown[];
let gw: Gateway;

/** Records what the gateway sends and replays the canned answer for "<client>.<method>". */
function fakeClient(name: string): unknown {
  return new Proxy(
    {},
    {
      get: (_t, method: string) => {
        if (method === "close") return () => undefined;
        return (
          request: Record<string, unknown>,
          metadata: Metadata,
          _options: unknown,
          cb: (e: unknown, r?: unknown) => void,
        ) => {
          const key = `${name}.${method}`;
          calls.push({ method: key, request, metadata });
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
    const info = new BinaryWriter().uint32(10).string(reason).uint32(18).string("dispatch").finish();
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

const delivery = {
  id: "del-1",
  orderId: "order-4817",
  orderNumber: "KD-4817",
  zoneId: "c03",
  status: 2,
  riderId: NIMAL,
  pickup: {
    restaurantId: "r1",
    name: "Galle Road Kottu House",
    area: "Kollupitiya",
    address: "312 Galle Rd",
    phone: "+94 11 257 4410",
    location: toGeoPoint({ x: 150, y: 175 }),
  },
  dropoff: {
    firstName: "Dilini",
    area: "Bambalapitiya",
    address: "18/2 Daisy Villa Ave",
    note: "Blue gate",
    maskedPhone: "+94 11 520 3381",
    location: toGeoPoint({ x: 320, y: 300 }),
  },
  toPickupKm: 1.1,
  tripKm: 3.4,
  minutes: 24,
  pay: { base: rs(180), distance: rs(230), tip: rs(0), boost: rs(50), total: rs(460) },
  payment: PaymentMethodKind.PAYMENT_METHOD_KIND_CASH,
  cashToCollect: rs(2340),
  customerPaysWith: rs(5000),
  items: [{ id: "a", quantity: 2, name: "Chicken cheese kottu", options: "Large" }],
  sealed: false,
  proof: ProofKind.PROOF_KIND_UNSPECIFIED,
  proofPhotoRef: "",
  attempts: 1,
} as Delivery;

beforeEach(async () => {
  calls = [];
  streamed = [];
  replies = { "riders.getMyRider": { response: { rider: { id: NIMAL } } } };
  const names = ["dispatch", "riders", "location", "finance", "reviews", "support"] as const;
  const upstreams = Object.fromEntries(names.map((n) => [n, fakeClient(n)])) as unknown as Upstreams;
  const locationClient = {
    streamRiderLocations: () => ({
      write: (m: unknown) => streamed.push(m),
      end: () => undefined,
      on: () => undefined,
    }),
  } as unknown as LocationServiceClient;
  const logger = pino({ level: "silent" });
  gw = await buildApp({
    config,
    logger,
    authenticator: createAuthenticator(config, async () => {
      throw new Error("no JWKS in unit tests");
    }),
    upstreams,
    location: new LocationForwarder(locationClient, logger),
  });
  await gw.app.ready();
});
afterEach(() => gw.app.close());

const rider = { authorization: "Bearer dev:nimal:rider" };
const callsTo = (method: string) => calls.filter((c) => c.method === method);

describe("map projection", () => {
  it("round-trips map units through WGS84", () => {
    for (const p of [
      { x: 150, y: 175 },
      { x: 255, y: 120 },
      { x: 340, y: 395 },
    ]) {
      const back = toMapPoint(toGeoPoint(p));
      expect(back.x).toBeCloseTo(p.x, 0);
      expect(back.y).toBeCloseTo(p.y, 0);
    }
  });
});

describe("auth and rider resolution", () => {
  it("requires a rider token", async () => {
    expect((await gw.app.inject({ url: "/v1/offer" })).statusCode).toBe(401);
    expect(
      (await gw.app.inject({ url: "/v1/offer", headers: { authorization: "Bearer dev:dilini:customer" } }))
        .statusCode,
    ).toBe(403);
  });

  it("resolves the rider id with GetMyRider (not the user id)", async () => {
    replies["dispatch.getCurrentOffer"] = { response: {} };
    const res = await gw.app.inject({ url: "/v1/offer", headers: rider });
    expect(res.statusCode).toBe(204);
    expect(callsTo("dispatch.getCurrentOffer")[0]!.request).toEqual({ riderId: NIMAL });
    expect(callsTo("dispatch.getCurrentOffer")[0]!.metadata.get("x-user-id")).toEqual(["nimal"]);
  });

  it("falls back to RIDER_IDS while dispatch can't answer", async () => {
    delete replies["riders.getMyRider"];
    replies["dispatch.getCurrentOffer"] = { response: {} };
    await gw.app.inject({ url: "/v1/offer", headers: rider });
    expect(callsTo("dispatch.getCurrentOffer")[0]!.request).toEqual({ riderId: "fallback-rider" });
  });
});

describe("offers and the job", () => {
  it("maps an offer to the app's shape (rupees, map units, no delivery code)", async () => {
    const offeredAt = new Date();
    replies["dispatch.getCurrentOffer"] = {
      response: {
        offer: {
          id: "off-1",
          deliveryId: "del-1",
          riderId: NIMAL,
          delivery,
          from: toGeoPoint({ x: 255, y: 120 }),
          offeredAt,
          expiresAt: new Date(offeredAt.getTime() + 30_000),
          status: 1,
          declineReason: "",
          notReadyMinutes: 6,
        },
      },
    };
    const res = await gw.app.inject({ url: "/v1/offer", headers: rider });
    expect(res.statusCode).toBe(200);
    const offer = res.json();
    expect(offer).toMatchObject({
      id: "off-1",
      orderNumber: "KD-4817",
      pay: { base: 180, distance: 230, tip: 0, boost: 50 },
      payment: "cash",
      cashToCollect: 2340,
      customerPaysWith: 5000,
      items: [{ id: "a", qty: 2, name: "Chicken cheese kottu", options: "Large" }],
      notReadyMinutes: 6,
      deliveryCode: "",
      offeredAt: offeredAt.getTime(),
      expiresAt: offeredAt.getTime() + 30_000,
      customer: { firstName: "Dilini", note: "Blue gate" },
    });
    expect(offer.restaurant.point.x).toBeCloseTo(150, 0);
    expect(offer.from.y).toBeCloseTo(120, 0);
  });

  it("marks the job ready once the kitchen has, and shows a repeated note once", async () => {
    const foodReadyAt = new Date(Date.now() - 60_000);
    replies["dispatch.getActiveJob"] = {
      response: {
        delivery: {
          ...delivery,
          readyBy: new Date(Date.now() + 5 * 60_000),
          foodReadyAt,
          dropoff: { ...delivery.dropoff!, note: "Green gate · green gate" },
        },
      },
    };
    const res = await gw.app.inject({ url: "/v1/job", headers: rider });
    expect(res.json()).toMatchObject({
      notReadyMinutes: 0,
      foodReadyAt: foodReadyAt.getTime(),
      customer: { note: "Green gate" },
    });

    replies["dispatch.getActiveJob"] = {
      response: { delivery: { ...delivery, readyBy: new Date(Date.now() + 5 * 60_000) } },
    };
    const waiting = (await gw.app.inject({ url: "/v1/job", headers: rider })).json();
    expect(waiting.foodReadyAt).toBeUndefined();
    expect(waiting.notReadyMinutes).toBe(5);
  });

  it("accepts and answers with the job keyed by delivery id", async () => {
    replies["dispatch.acceptOffer"] = { response: { delivery } };
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/offers/off-1/accept",
      headers: { ...rider, "idempotency-key": "k-1" },
    });
    expect(res.json()).toMatchObject({ id: "del-1", orderNumber: "KD-4817" });
    expect(callsTo("dispatch.acceptOffer")[0]!.request).toEqual({
      riderId: NIMAL,
      offerId: "off-1",
      idempotencyKey: "k-1",
    });
  });

  it("uses the app's copy for an expired offer", async () => {
    replies["dispatch.acceptOffer"] = {
      error: grpcError(status.FAILED_PRECONDITION, "expired", "OFFER_EXPIRED"),
    };
    const res = await gw.app.inject({ method: "POST", url: "/v1/offers/off-1/accept", headers: rider });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toBe("This offer ended before it reached us. It's gone to another rider.");
  });

  it("completes with proof and cash in minor units, answering with the trip", async () => {
    const deliveredAt = new Date();
    replies["dispatch.completeDelivery"] = {
      response: {
        trip: {
          id: "del-1",
          orderNumber: "KD-4817",
          restaurantName: "Galle Road Kottu House",
          pickupArea: "Kollupitiya",
          dropoffArea: "Bambalapitiya",
          customerFirstName: "Dilini",
          km: 4.5,
          pay: delivery.pay,
          payment: PaymentMethodKind.PAYMENT_METHOD_KIND_CASH,
          cashCollected: rs(2340),
          deliveredAt,
          proof: ProofKind.PROOF_KIND_CODE,
          customerRating: 0,
        },
      },
    };
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/jobs/del-1/complete",
      headers: rider,
      payload: { proof: "code", code: "4821", cashCollected: 2340 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: "del-1",
      cashCollected: 2340,
      proof: "code",
      deliveredAt: deliveredAt.getTime(),
    });
    expect(res.json().customerRating).toBeUndefined();
    expect(callsTo("dispatch.completeDelivery")[0]!.request).toMatchObject({
      deliveryId: "del-1",
      proof: ProofKind.PROOF_KIND_CODE,
      code: "4821",
      cashCollected: { amountMinor: 234_000 },
    });
  });

  it("sends the map position when going online", async () => {
    replies["dispatch.setAvailability"] = { response: { cashAllowed: false } };
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/availability",
      headers: rider,
      payload: { online: true, position: { x: 255, y: 120 } },
    });
    expect(res.json()).toEqual({ online: true, cashAllowed: false });
    const sent = callsTo("dispatch.setAvailability")[0]!.request as {
      position: { lat: number; lng: number };
    };
    expect(sent.position.lat).toBeCloseTo(6.905, 2);
    expect(sent.position.lng).toBeCloseTo(79.859, 2);
  });

  it("streams GPS fixes to location", async () => {
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/location",
      headers: rider,
      payload: { fixes: [{ lat: 6.9, lng: 79.85, accuracyM: 8 }, { point: { x: 200, y: 200 } }] },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ forwarded: 2, dropped: 0 });
    expect(streamed[0]).toMatchObject({
      location: { riderId: NIMAL, position: { lat: 6.9, lng: 79.85 }, accuracyM: 8 },
    });
  });
});

describe("money and account", () => {
  it("labels earnings bars in Colombo time and phrases the comparison", async () => {
    replies["finance.getRiderEarnings"] = {
      response: {
        summary: {
          period: EarningsPeriod.EARNINGS_PERIOD_TODAY,
          total: rs(3120),
          trips: 7,
          onlineMinutes: 300,
          tips: rs(200),
          bars: [{ start: new Date("2026-10-12T03:30:00Z"), amount: rs(460), trips: 1 }],
          comparisonDelta: rs(640),
          comparisonLabel: "last Monday",
          comparisonTone: 1,
        },
      },
    };
    const res = await gw.app.inject({ url: "/v1/earnings?period=today", headers: rider });
    expect(res.json()).toEqual({
      period: "today",
      total: 3120,
      trips: 7,
      onlineMinutes: 300,
      tips: 200,
      bars: [{ label: "9", fullLabel: "9 am to 10 am", amount: 460, trips: 1 }],
      comparison: { text: "Rs 640 more than last Monday", tone: "good" },
    });
    expect(callsTo("finance.getRiderEarnings")[0]!.request).toEqual({
      riderId: NIMAL,
      period: EarningsPeriod.EARNINGS_PERIOD_TODAY,
    });
  });

  it("falls back to dispatch's trips and cash while ledger is down", async () => {
    const now = Date.now();
    const trip = (secondsAgo: number, total: number, tip: number) => ({
      id: `t-${secondsAgo}`,
      pay: { base: rs(180), distance: rs(0), tip: rs(tip), boost: rs(0), total: rs(total) },
      deliveredAt: new Date(now - secondsAgo * 1000),
    });
    replies["dispatch.listTrips"] = {
      response: { trips: [trip(1, 460, 100), trip(2, 300, 0), trip(86_400 * 40, 999, 0)] },
    };
    const today = await gw.app.inject({ url: "/v1/earnings/today", headers: rider });
    expect(today.statusCode).toBe(200);
    expect(today.json()).toEqual({ amount: 760, trips: 2, onlineMinutes: 0, tips: 100 });
    const from = callsTo("dispatch.listTrips")[0]!.request.from as Date;
    expect(now - from.getTime()).toBeLessThanOrEqual(86_400_000);

    const week = (await gw.app.inject({ url: "/v1/earnings?period=week", headers: rider })).json();
    expect(week.bars).toHaveLength(7);
    expect(week.total).toBe(760);

    replies["riders.getRiderProfile"] = {
      response: { rider: { id: NIMAL, cashHeld: rs(14_330), cashLimit: rs(15_000) } },
    };
    const cash = await gw.app.inject({ url: "/v1/cash", headers: rider });
    expect(cash.json()).toEqual({ collected: 14_330, owedToRider: 0, limit: 15_000, lastDepositAt: 0 });
  });

  it("maps the rider profile", async () => {
    replies["riders.getRiderProfile"] = {
      response: {
        rider: {
          id: NIMAL,
          name: "Nimal Perera",
          firstName: "Nimal",
          phone: "+94774125583",
          vehicle: { type: 1, model: "Bajaj Pulsar 150", plate: "WP BCD-4521" },
          rating: 4.91,
          ratingCount: 1284,
          joinedAt: new Date("2024-03-10T00:00:00Z"),
          bank: { bank: "Commercial Bank", branch: "Kollupitiya", accountLast4: "4417" },
          depositReference: "KR-4521-NP",
        },
      },
    };
    const res = await gw.app.inject({ url: "/v1/profile", headers: rider });
    expect(res.json()).toEqual({
      name: "Nimal Perera",
      firstName: "Nimal",
      phone: "+94774125583",
      vehicle: { type: "motorbike", model: "Bajaj Pulsar 150", plate: "WP BCD-4521" },
      rating: 4.9,
      ratingCount: 1284,
      memberSince: "March 2024",
      bank: { name: "Commercial Bank", branch: "Kollupitiya", last4: "4417" },
      depositReference: "KR-4521-NP",
    });
  });
});

describe("onboarding (public)", () => {
  it("submits without sign-in and reports the review state", async () => {
    replies["riders.submitRiderApplication"] = {
      response: {
        application: {
          id: "RA-1",
          name: "Sunil Fernando",
          status: ApplicationStatus.APPLICATION_STATUS_PENDING,
          submittedAt: new Date(1_000),
        },
      },
    };
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/applications",
      payload: {
        name: "Sunil Fernando",
        nic: "199012345678",
        phone: "+94771112223",
        city: "Colombo",
        vehicle: "motorbike",
        documents: { licence: "licence.jpg" },
        bank: { bank: "BOC", branch: "Fort", account: "1234-5678", holder: "S Fernando" },
        lessons: ["safety"],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ state: "inReview", id: "RA-1", submittedAt: 1_000, firstName: "Sunil" });
    expect(callsTo("riders.getMyRider")).toHaveLength(0);
  });

  it("names the document to fix", async () => {
    replies["riders.getRiderApplicationStatus"] = {
      response: {
        application: {
          id: "RA-1",
          name: "Sunil",
          status: ApplicationStatus.APPLICATION_STATUS_CHANGES_REQUESTED,
        },
        needsFix: { kind: "revenue", name: "Revenue licence", rejectReason: "Blurred" },
      },
    };
    const res = await gw.app.inject({ url: "/v1/applications/status?phone=%2B94771112223" });
    expect(res.json()).toEqual({
      state: "needsFix",
      id: "RA-1",
      firstName: "Sunil",
      doc: "revenue",
      docName: "Revenue licence",
      reason: "Blurred",
    });
  });
});

describe("edge concerns", () => {
  it("answers CORS preflight for the app's origin only", async () => {
    const preflight = (origin: string) =>
      gw.app.inject({
        method: "OPTIONS",
        url: "/v1/offer",
        headers: { origin, "access-control-request-method": "GET" },
      });
    expect((await preflight("http://localhost:5176")).headers["access-control-allow-origin"]).toBe(
      "http://localhost:5176",
    );
    expect((await preflight("https://evil.example")).headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("hides upstream detail on 5xx", async () => {
    const res = await gw.app.inject({ url: "/v1/trips", headers: rider });
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).not.toContain("ECONNREFUSED");
  });
});

describe("WebSocket /ws", () => {
  it("authenticates, resolves the rider and says realtime is off when not configured", async () => {
    const ws = await gw.app.injectWS("/ws");
    const next = () =>
      new Promise<unknown>((resolve) => ws.once("message", (data) => resolve(JSON.parse(data.toString()))));
    ws.send(JSON.stringify({ type: "auth", token: "dev:nimal:rider" }));
    expect(await next()).toEqual({ type: "ready", userId: "nimal", realtime: false });
    ws.send(JSON.stringify({ type: "ping" }));
    expect(await next()).toEqual({ type: "pong" });
    ws.terminate();
  });
});
