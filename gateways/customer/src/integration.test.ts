// Integration test against REAL upstream services on localhost (whatever is running).
//   KADE_INTEGRATION=1 pnpm --filter @kade/gateway-customer test
// Each block probes its upstream's port first and skips itself when the service isn't up, so this
// file can run at any stage of the build-out. Identity: dilini's fixed Keycloak id via the dev bypass.
import { createConnection } from "node:net";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type Gateway } from "./app.js";
import { createAuthenticator } from "./auth.js";
import { loadConfig } from "./config.js";
import { closeUpstreams, createUpstreams, type Upstreams } from "./grpc/clients.js";

const enabled = !!process.env.KADE_INTEGRATION;
const DILINI = "00000000-0000-7000-8005-000000000001";
const auth = { authorization: `Bearer dev:${DILINI}:customer` };

const config = loadConfig({
  SERVICE_NAME: "gateway-customer-it",
  HTTP_PORT: "0",
  KEYCLOAK_ISSUER: "http://localhost:8080/realms/kade",
  CORS_ORIGINS: "http://localhost:5174",
  AUTH_DEV_BYPASS: "true",
  DEPLOY_ENV: "dev",
  GRPC_DEADLINE_MS: "5000",
  ...process.env,
});

const reachable = (address: string) =>
  new Promise<boolean>((resolve) => {
    const [host, port] = address.split(":");
    const s = createConnection({ host, port: Number(port) });
    s.setTimeout(500);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
    s.once("timeout", () => (s.destroy(), resolve(false)));
  });

let gw: Gateway;
let upstreams: Upstreams;
const up: Record<string, boolean> = {};

beforeAll(async () => {
  if (!enabled) return;
  for (const [name, addr] of Object.entries({
    catalog: config.CATALOG_GRPC,
    search: config.SEARCH_GRPC,
    profile: config.PROFILE_GRPC,
    order: config.ORDER_GRPC,
    promotion: config.PROMOTION_GRPC,
  }))
    up[name] = await reachable(addr);
  upstreams = createUpstreams(config);
  gw = await buildApp({
    config,
    logger: pino({ level: "silent" }),
    authenticator: createAuthenticator(config),
    upstreams,
  });
  await gw.app.ready();
});
afterAll(async () => {
  if (!enabled) return;
  await gw.app.close();
  closeUpstreams(upstreams);
});

describe.skipIf(!enabled)("against running services", () => {
  it("catalog: restaurants and a menu in the app's shape", async (ctx) => {
    if (!up.catalog) return ctx.skip();
    const list = await gw.app.inject({ url: "/v1/restaurants?x=352&y=500" });
    expect(list.statusCode).toBe(200);
    const restaurants = list.json() as { id: number; eta: number[]; deliveryFee: number }[];
    expect(restaurants.length).toBeGreaterThan(0);
    expect(Number.isInteger(restaurants[0]!.id)).toBe(true);
    const menu = await gw.app.inject({ url: `/v1/restaurants/${restaurants[0]!.id}/menu` });
    expect(menu.statusCode).toBe(200);
    expect(menu.json().restaurantId).toBe(restaurants[0]!.id);
  });

  it("profile: /v1/me creates or returns the customer", async (ctx) => {
    if (!up.profile) return ctx.skip();
    const res = await gw.app.inject({ url: "/v1/me", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("user");
  });

  it("order: history maps to app orders", async (ctx) => {
    if (!up.order) return ctx.skip();
    const res = await gw.app.inject({ url: "/v1/orders", headers: auth });
    expect(res.statusCode).toBe(200);
    for (const o of res.json() as { id: string; status: string; totals: { total: number } }[]) {
      expect(o.id).toMatch(/^KD-|^[0-9a-f-]{36}$/);
      expect([
        "scheduled",
        "placed",
        "accepted",
        "preparing",
        "pickedUp",
        "delivered",
        "ready",
        "collected",
        "cancelled",
      ]).toContain(o.status);
      expect(Number.isInteger(o.totals.total)).toBe(true);
    }
  });

  it("order: place a cash order, read it back, cancel it", async (ctx) => {
    if (!up.order || !up.catalog) return ctx.skip();
    const menu = await gw.app.inject({ url: "/v1/restaurants/1/menu" });
    const item = (
      menu.json() as {
        sections: {
          items: { id: string; name: string; price: number; optionGroupIds: string[]; soldOut?: boolean }[];
        }[];
      }
    ).sections
      .flatMap((s) => s.items)
      .find((i) => !i.optionGroupIds.length && !i.soldOut);
    if (!item) return ctx.skip();
    const placed = await gw.app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { ...auth, "idempotency-key": `it-${Date.now()}` },
      payload: {
        mode: "delivery",
        restaurant: { id: 1 },
        lines: [
          {
            key: "l1",
            itemId: item.id,
            name: item.name,
            unitPrice: item.price,
            qty: 2,
            choices: [],
            note: "",
          },
        ],
        address: {
          id: "home",
          label: "Home",
          line: "42 Galle Rd, Colombo 03",
          area: "Kollupitiya",
          pin: { x: 352, y: 500 },
        },
        riderNote: "",
        payment: { type: "cash" },
        tip: 0,
      },
    });
    if (placed.statusCode !== 201) {
      // A closed restaurant or a saga dependency that isn't up yet is a valid answer, as problem+json.
      expect(placed.headers["content-type"]).toContain("application/problem+json");
      return;
    }
    const order = placed.json() as { id: string; status: string };
    expect(["placed", "scheduled"]).toContain(order.status);
    const got = await gw.app.inject({ url: `/v1/orders/${order.id}`, headers: auth });
    expect(got.json().id).toBe(order.id);
    const cancelled = await gw.app.inject({
      method: "POST",
      url: `/v1/orders/${order.id}/cancel`,
      headers: auth,
    });
    expect([200, 400, 409]).toContain(cancelled.statusCode);
  });
});
