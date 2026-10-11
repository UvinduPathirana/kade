#!/usr/bin/env node
// End-to-end order through the real gateways and services:
// Dilini (customer) places a cash order at Galle Road Kottu House → Ruwan (restaurant owner) accepts it
// and marks it ready → a simulated rider (dispatch) picks it up and delivers it → the order is DELIVERED.
// Uses the gateways' dev tokens (AUTH_DEV_BYPASS in compose). Usage: node scripts/e2e-order.mjs [--pickup]
const CUSTOMER = process.env.CUSTOMER_GW ?? "http://localhost:8201";
const MERCHANT = process.env.MERCHANT_GW ?? "http://localhost:8202";
const DILINI = "Bearer dev:00000000-0000-7000-8005-000000000001:customer";
const RUWAN = "Bearer dev:00000000-0000-7000-8005-000000000002:merchant_owner";
const pickup = process.argv.includes("--pickup");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a);

async function call(base, auth, method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: auth, "content-type": "application/json", ...headers },
    body: body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`);
  return data;
}

const addresses = await call(CUSTOMER, DILINI, "GET", "/v1/me/addresses");
const home = (Array.isArray(addresses) ? addresses : addresses.addresses ?? [])[0];
log("deliver to:", home?.label, home?.line);

const menu = await call(CUSTOMER, DILINI, "GET", "/v1/restaurants/1/menu");
const items = menu.sections.flatMap((s) => s.items);
const kottu = items.find((i) => i.name === "Chicken kottu");
const fishRoll = items.find((i) => i.name === "Fish roll");
const lines = [
  { key: `${kottu.id}|Medium`, itemId: kottu.id, name: kottu.name, unitPrice: kottu.price, qty: 1, choices: ["Medium"], note: "" },
  { key: `${fishRoll.id}|`, itemId: fishRoll.id, name: fishRoll.name, unitPrice: fishRoll.price, qty: 2, choices: [], note: "" },
];
log("cart:", lines.map((l) => `${l.qty}× ${l.name}`).join(", "));

const order = await call(
  CUSTOMER,
  DILINI,
  "POST",
  "/v1/orders",
  {
    mode: pickup ? "pickup" : "delivery",
    restaurant: { id: 1 },
    lines,
    address: pickup ? undefined : home,
    riderNote: "Green gate next to the pharmacy",
    payment: { type: "cash" },
    tip: 0,
  },
  { "idempotency-key": `e2e-${Date.now()}` },
);
log(`placed ${order.id} — status ${order.status}, total Rs ${order.totals?.total}`);

// Restaurant: wait for the ticket, accept, then mark ready
let ticket;
for (let i = 0; i < 30 && !ticket; i++) {
  const list = await call(MERCHANT, RUWAN, "GET", "/v1/tickets");
  const all = Array.isArray(list) ? list : (list.tickets ?? []);
  ticket = all.find((t) => String(t.number ?? t.id).includes(order.id.replace("KD-", "")));
  if (!ticket) await sleep(1000);
}
if (!ticket) throw new Error("ticket never reached the restaurant board");
log(`kitchen board shows ticket ${ticket.id} (${ticket.status})`);
await call(MERCHANT, RUWAN, "POST", `/v1/tickets/${ticket.id}/accept`, { prepMinutes: 10 });
log("restaurant accepted, prep 10 min");
await sleep(4000);
await call(MERCHANT, RUWAN, "POST", `/v1/tickets/${ticket.id}/ready`);
log("restaurant marked ready");
if (pickup) {
  await call(CUSTOMER, DILINI, "POST", `/v1/orders/${order.id}/collected`);
  log("customer collected");
}

// Follow the order until it's finished
let last = "";
for (let i = 0; i < 120; i++) {
  const o = await call(CUSTOMER, DILINI, "GET", `/v1/orders/${order.id}`);
  const s = `${o.status}${o.rider ? ` — rider ${o.rider.name}` : ""}`;
  if (s !== last) log("order:", s), (last = s);
  if (["delivered", "collected", "cancelled", "rejected", "failed"].includes(o.status)) break;
  await sleep(2000);
}
console.log(last.startsWith("delivered") || last.startsWith("collected") ? "\nE2E PASSED" : "\nE2E DID NOT FINISH");
