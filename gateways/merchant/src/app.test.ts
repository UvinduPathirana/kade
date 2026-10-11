import { BinaryWriter } from "@bufbuild/protobuf/wire";
import { Metadata, status, type ServiceError } from "@grpc/grpc-js";
import type {
  CreateNoteRequest,
  CreateNoteResponse,
  GetNoteRequest,
  GetNoteResponse,
  TemplateServiceClient,
} from "@kade/proto/kade/template/v1/template";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type Gateway } from "./app.js";
import { createAuthenticator } from "./auth.js";
import { loadConfig } from "./config.js";
import { STATUS_DETAILS_KEY } from "./grpc/error-details.js";

const config = loadConfig({
  SERVICE_NAME: "gateway-test",
  HTTP_PORT: "0",
  TEMPLATE_GRPC: "localhost:1",
  KEYCLOAK_ISSUER: "http://localhost:8080/realms/kade",
  CORS_ORIGINS: "http://localhost:5175",
  AUTH_DEV_BYPASS: "true",
  DEPLOY_ENV: "dev",
});

interface Captured {
  request: unknown;
  metadata: Metadata;
  deadline: number;
}

type Reply<T> = { error: ServiceError } | { response: T };
let calls: Captured[];
let nextReply: Reply<unknown>;
let gw: Gateway;

// Stands in for the generated client: records what the gateway sends, replays a canned answer.
function fakeMethod() {
  return (
    request: unknown,
    metadata: Metadata,
    options: { deadline: number },
    cb: (e: unknown, r?: unknown) => void,
  ) => {
    calls.push({ request, metadata, deadline: options.deadline });
    queueMicrotask(() => ("error" in nextReply ? cb(nextReply.error) : cb(null, nextReply.response)));
    return { cancel: () => undefined };
  };
}

function grpcError(code: status, details: string, reason?: string): ServiceError {
  const metadata = new Metadata();
  if (reason) {
    const info = new BinaryWriter().uint32(10).string(reason).uint32(18).string("template-ts").finish();
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

const note = {
  id: "0199d3a0-0000-7000-8000-000000000001",
  text: "hi",
  amount: { amountMinor: 115_000, currency: "LKR" },
  createdAt: new Date("2026-10-12T08:00:00Z"),
};

beforeEach(async () => {
  calls = [];
  nextReply = { response: { note } };
  const template = { createNote: fakeMethod(), getNote: fakeMethod() } as unknown as TemplateServiceClient;
  gw = await buildApp({
    config,
    logger: pino({ level: "silent" }),
    authenticator: createAuthenticator(config, async () => {
      throw new Error("no JWKS in unit tests");
    }),
    template,
  });
  await gw.app.ready();
});
afterEach(() => gw.app.close());

const devAuth = { authorization: "Bearer dev:dilini:customer" };

describe("POST /v1/notes", () => {
  it("requires a token and answers with problem+json", async () => {
    const res = await gw.app.inject({ method: "POST", url: "/v1/notes", payload: { text: "x", amount: 1 } });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ status: 401, code: "UNAUTHENTICATED", instance: "/v1/notes" });
    expect(calls).toHaveLength(0);
  });

  it("converts rupees, forwards identity + idempotency key, and sets a deadline", async () => {
    const before = Date.now();
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/notes",
      headers: { ...devAuth, "idempotency-key": "k-1" },
      payload: { text: "hi", amount: 1150 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: note.id,
      text: "hi",
      amount: 1150,
      currency: "LKR",
      createdAt: "2026-10-12T08:00:00.000Z",
    });
    const call = calls[0]!;
    expect(call.request as CreateNoteRequest).toEqual({
      text: "hi",
      amount: { amountMinor: 115_000, currency: "LKR" },
      idempotencyKey: "k-1",
    });
    expect(call.metadata.get("x-user-id")).toEqual(["dilini"]);
    expect(call.metadata.get("x-roles")).toEqual(["customer"]);
    expect(call.deadline - before).toBeGreaterThanOrEqual(config.GRPC_DEADLINE_MS);
    expect(call.deadline - before).toBeLessThan(config.GRPC_DEADLINE_MS + 1_000);
  });

  it("rejects invalid bodies before calling upstream", async () => {
    const res = await gw.app.inject({
      method: "POST",
      url: "/v1/notes",
      headers: devAuth,
      payload: { text: "", amount: -1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(calls).toHaveLength(0);
  });
});

describe("gRPC error mapping", () => {
  it("uses the ErrorInfo reason as the problem code", async () => {
    nextReply = { error: grpcError(status.NOT_FOUND, "We couldn't find that note.", "NOTE_NOT_FOUND") };
    const res = await gw.app.inject({ method: "GET", url: `/v1/notes/${note.id}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      type: "https://kade.lk/problems/note-not-found",
      code: "NOTE_NOT_FOUND",
      detail: "We couldn't find that note.",
    });
    expect((calls[0]!.request as GetNoteRequest).id).toBe(note.id);
  });

  it("hides upstream detail on 5xx", async () => {
    nextReply = { error: grpcError(status.UNAVAILABLE, "connect ECONNREFUSED 10.0.0.7:50100") };
    const res = await gw.app.inject({ method: "GET", url: `/v1/notes/${note.id}` });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("UNAVAILABLE");
    expect(res.json().detail).not.toContain("ECONNREFUSED");
  });

  it("maps deadline exceeded to 504", async () => {
    nextReply = { error: grpcError(status.DEADLINE_EXCEEDED, "Deadline exceeded") };
    const res = await gw.app.inject({ method: "GET", url: `/v1/notes/${note.id}` });
    expect(res.statusCode).toBe(504);
  });
});

describe("edge concerns", () => {
  it("answers CORS preflight for the app's origin only", async () => {
    const preflight = (origin: string) =>
      gw.app.inject({
        method: "OPTIONS",
        url: "/v1/notes",
        headers: { origin, "access-control-request-method": "POST" },
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
  it("authenticates with the first message, answers ping and pushes note.created", async () => {
    const ws = await gw.app.injectWS("/ws");
    const received: unknown[] = [];
    const next = () =>
      new Promise<unknown>((resolve) => ws.once("message", (data) => resolve(JSON.parse(data.toString()))));

    ws.send(JSON.stringify({ type: "auth", token: "dev:dilini:customer" }));
    received.push(await next());
    ws.send(JSON.stringify({ type: "ping" }));
    received.push(await next());

    const pushed = next();
    await gw.app.inject({
      method: "POST",
      url: "/v1/notes",
      headers: devAuth,
      payload: { text: "hi", amount: 1150 },
    });
    received.push(await pushed);

    expect(received).toEqual([
      { type: "ready", userId: "dilini" },
      { type: "pong" },
      { type: "note.created", note: expect.objectContaining({ id: note.id, amount: 1150 }) },
    ]);
    ws.terminate();
  });

  it("closes with 4401 when the first message is not auth", async () => {
    const ws = await gw.app.injectWS("/ws");
    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    ws.send(JSON.stringify({ type: "ping" }));
    expect(await closed).toBe(4401);
  });
});

// Keep the imported response types referenced (they document what the fake returns).
export type _Responses = CreateNoteResponse | GetNoteResponse;
