#!/usr/bin/env node
// Captures every Kadé page at its target device size using headless Chrome over the DevTools
// protocol (no extra dependencies). Needs the four dev servers running:
//   pnpm dev & pnpm dev:restaurant & pnpm dev:rider & pnpm dev:admin
// Usage: node scripts/screenshots.mjs [customer|restaurant|rider|admin ...]
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "screenshots");
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, mobile: false },
  tablet: { width: 1280, height: 800, mobile: false },
  phone: { width: 390, height: 844, mobile: true },
};

// ---------- Minimal CDP client ----------
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    };
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

// Helpers injected into the page before every scripted step
const HELPERS = `
  window.__q = (sel) => document.querySelector(sel);
  window.__find = (text, scope = document) =>
    [...scope.querySelectorAll('button, a, label, [role=tab], summary')].find((el) =>
      el.textContent.replace(/\\s+/g, ' ').trim().startsWith(text) && !el.disabled);
  window.__click = (text, scope) => { const el = __find(text, scope); if (el) el.click(); return !!el; };
  window.__dialog = () => { const d = [...document.querySelectorAll('[role=dialog], [role=alertdialog]')]; return d[d.length - 1]; };
  window.__set = (el, v) => {
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  window.__wait = (ms) => new Promise((r) => setTimeout(r, ms));
`;

class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sid = sessionId;
  }
  send(m, p) {
    return this.cdp.send(m, p, this.sid);
  }
  async viewport(name) {
    const v = VIEWPORTS[name];
    this.vp = v;
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: v.width,
      height: v.height,
      deviceScaleFactor: 1,
      mobile: v.mobile,
    });
    await this.send("Emulation.setTouchEmulationEnabled", { enabled: v.mobile });
  }
  async goto(url, settle = 1800) {
    await this.send("Page.navigate", { url });
    await sleep(settle);
  }
  async eval(js) {
    const res = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${HELPERS}; ${js} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? "eval failed");
    return res.result.value;
  }
  /** fullPage: capture the whole scroll height; false for overlays, which only cover the screen. */
  async shot(file, fullPage = true) {
    // Load lazy images and fonts before capturing the full length of the page
    await this.eval(`
      document.querySelectorAll('img[loading=lazy]').forEach((i) => (i.loading = 'eager'));
      await document.fonts.ready;
      await Promise.race([
        Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; }))),
        __wait(6000),
      ]);
    `);
    await sleep(400);
    const { cssContentSize } = await this.send("Page.getLayoutMetrics");
    const height = fullPage
      ? Math.min(Math.max(Math.ceil(cssContentSize.height), this.vp.height), 12000)
      : this.vp.height;
    const { data } = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: this.vp.width, height, scale: 1 },
    });
    writeFileSync(file, Buffer.from(data, "base64"));
  }
}

// ---------- Shot lists ----------
const C = "http://localhost:5174";
const R = "http://localhost:5175";
const D = "http://localhost:5176";
const A = "http://localhost:5177";

/**
 * Each step: [name, async (page) => void]. Steps run in order and may build on earlier state.
 * Steps whose name is in OVERLAYS are captured at screen size, since a dialog only covers the screen.
 */
const OVERLAYS = new Set([
  "item-options",
  "address-picker",
  "cart-drawer",
  "menu-edit-dish",
  "promotion-create",
  "order-detail",
]);
const plans = {
  customer: (vp) => [
    ["home", (p) => p.goto(`${C}/`)],
    ["welcome", (p) => p.goto(`${C}/welcome`)],
    ["signin", (p) => p.goto(`${C}/signin`)],
    ["search", (p) => p.goto(`${C}/search?q=kottu`)],
    ["browse", (p) => p.goto(`${C}/browse`)],
    ["category", (p) => p.goto(`${C}/category/kottu`)],
    ["offers", (p) => p.goto(`${C}/offers`)],
    ["restaurant", (p) => p.goto(`${C}/restaurant/1`)],
    [
      "item-options",
      async (p) => {
        await p.eval(`__click('Cheese kottu'); await __wait(900);`);
      },
    ],
    ["grocery-shop", (p) => p.goto(`${C}/restaurant/15`)],
    [
      "address-picker",
      async (p) => {
        await p.goto(`${C}/`);
        await p.eval(`__q('header button[aria-haspopup=dialog]')?.click(); await __wait(900);`);
      },
    ],
    ...(vp === "desktop"
      ? [
          [
            "cart-drawer",
            async (p) => {
              await p.goto(`${C}/`);
              await p.eval(`__click('Cart'); await __wait(900);`);
            },
          ],
        ]
      : []),
    ["cart", (p) => p.goto(`${C}/cart`)],
    ["checkout", (p) => p.goto(`${C}/checkout`)],
    [
      "order-placed",
      async (p) => {
        await p.eval(`__click('Place order'); await __wait(2200);`);
      },
    ],
    [
      "order-on-the-way",
      async (p) => {
        await p.eval(`
          const all = JSON.parse(localStorage.getItem('kade.orders.v1'));
          all[0].placedAt -= 75000; localStorage.setItem('kade.orders.v1', JSON.stringify(all));
          location.reload();`);
        await sleep(2500);
      },
    ],
    [
      "order-delivered",
      async (p) => {
        await p.eval(`
          const all = JSON.parse(localStorage.getItem('kade.orders.v1'));
          all[0].placedAt -= 60000; localStorage.setItem('kade.orders.v1', JSON.stringify(all));
          location.reload();`);
        await sleep(2500);
      },
    ],
    ["orders", (p) => p.goto(`${C}/orders`)],
    [
      "order-help",
      async (p) => {
        const id = await p.eval(`return JSON.parse(localStorage.getItem('kade.orders.v1'))[0].id;`);
        await p.goto(`${C}/orders/${id}/help`);
      },
    ],
    ["help", (p) => p.goto(`${C}/help`)],
    ["support", (p) => p.goto(`${C}/support`)],
    [
      "account",
      async (p) => {
        await p.goto(`${C}/signin`);
        await p.eval(`
          __click('Continue with Google'); await __wait(900);
          __set(__q('main input[autocomplete=name]'), 'Uvindu'); await __wait(100);
          __click('Create account'); await __wait(1200);`);
        await p.goto(`${C}/account`);
      },
    ],
    ["plus", (p) => p.goto(`${C}/plus`)],
    ["gifts", (p) => p.goto(`${C}/gifts`)],
    [
      "group-order",
      async (p) => {
        await p.goto(`${C}/restaurant/1`);
        await p.eval(`
          __click('Start a group order'); await __wait(900);
          const d = __dialog();
          if (d) { const b = [...d.querySelectorAll('button')].filter((x) => /start|create/i.test(x.textContent)).pop(); b?.click(); }
          await __wait(1500);`);
      },
    ],
    ["not-found", (p) => p.goto(`${C}/this-page-does-not-exist`)],
  ],

  restaurant: () => [
    ["live-orders", (p) => p.goto(`${R}/`, 2500)],
    ["order-ticket", (p) => p.goto(`${R}/orders/2406`)],
    ["menu", (p) => p.goto(`${R}/menu`)],
    [
      "menu-edit-dish",
      async (p) => {
        await p.eval(
          `(__find('Edit') ?? [...document.querySelectorAll('main button')].find((b) => /edit/i.test(b.getAttribute('aria-label') ?? '')))?.click(); await __wait(900);`,
        );
      },
    ],
    ["hours", (p) => p.goto(`${R}/hours`)],
    ["promotions", (p) => p.goto(`${R}/promotions`)],
    [
      "promotion-create",
      async (p) => {
        await p.eval(`__click('Create offer'); await __wait(900);`);
      },
    ],
    ["payouts", (p) => p.goto(`${R}/payouts`)],
    ["reviews", (p) => p.goto(`${R}/reviews`)],
    ["settings", (p) => p.goto(`${R}/settings`)],
    ["join", (p) => p.goto(`${R}/join`)],
    ["join-status", (p) => p.goto(`${R}/join/status`)],
    ["signed-out", (p) => p.goto(`${R}/signed-out`)],
  ],

  rider: () => [
    ["go-online", (p) => p.goto(`${D}/`)],
    [
      "online-looking",
      async (p) => {
        await p.eval(`__click('Go online'); await __wait(1200);`);
      },
    ],
    [
      "job-offer",
      async (p) => {
        await p.eval(`for (let i = 0; i < 40 && !__dialog(); i++) await __wait(500); await __wait(600);`);
      },
    ],
    [
      "pickup-navigate",
      async (p) => {
        await p.eval(`__click('Accept', __dialog()); await __wait(1500);`);
      },
    ],
    [
      "pickup-order-check",
      async (p) => {
        await p.eval(`__click("I've arrived"); await __wait(900);`);
      },
    ],
    [
      "dropoff-navigate",
      async (p) => {
        await p.eval(`
          document.querySelectorAll('main input[type=checkbox]').forEach((c) => { if (!c.checked && !c.closest('label')?.textContent.includes('sealed')) c.click(); });
          await __wait(300); __click('Picked up order'); await __wait(1500);`);
      },
    ],
    [
      "dropoff-at-door",
      async (p) => {
        await p.eval(`__click("I've arrived"); await __wait(900);`);
      },
    ],
    [
      "delivered",
      async (p) => {
        await p.eval(`
          __click('Collected Rs'); await __wait(300);
          __set(document.querySelector('main input'), '4821'); await __wait(200);
          __click('Delivered'); await __wait(1800);`);
      },
    ],
    ["earnings", (p) => p.goto(`${D}/earnings`)],
    ["trips", (p) => p.goto(`${D}/trips`)],
    [
      "trip-detail",
      async (p) => {
        await p.eval(`document.querySelector('a[href^="/trips/"]')?.click(); await __wait(1200);`);
      },
    ],
    ["account", (p) => p.goto(`${D}/account`)],
    ["join", (p) => p.goto(`${D}/join`)],
  ],

  admin: () => [
    ["live-dashboard", (p) => p.goto(`${A}/`, 2800)],
    ["orders", (p) => p.goto(`${A}/orders`, 2200)],
    [
      "order-detail",
      async (p) => {
        await p.eval(`document.querySelector('main tbody tr')?.click(); await __wait(1000);`);
      },
    ],
    ["finance", (p) => p.goto(`${A}/finance`, 2200)],
    ["restaurants", (p) => p.goto(`${A}/restaurants`, 2200)],
    ["riders", (p) => p.goto(`${A}/riders`, 2200)],
    ["customers", (p) => p.goto(`${A}/customers`, 2200)],
    ["zones-and-pricing", (p) => p.goto(`${A}/zones`, 2200)],
    ["promotions", (p) => p.goto(`${A}/promotions`, 2200)],
    ["support", (p) => p.goto(`${A}/support`, 2200)],
    ["home-feed-content", (p) => p.goto(`${A}/content`, 2200)],
    ["team-and-audit", (p) => p.goto(`${A}/team`, 2200)],
  ],
};

const runs = [
  ["customer", "desktop"],
  ["customer", "phone"],
  ["restaurant", "tablet"],
  ["rider", "phone"],
  ["admin", "desktop"],
];

// ---------- Run ----------
const only = process.argv.slice(2);
const profile = "/tmp/kade-screenshots-profile";
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-prefers-reduced-motion",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {
    // Chrome is still starting
  }
}
if (!wsUrl) throw new Error("Chrome didn't start");

const cdp = new Cdp(wsUrl);
await cdp.open();
const failures = [];

for (const [app, vp] of runs) {
  if (only.length && !only.includes(app)) continue;
  const dir = join(OUT, app, vp);
  mkdirSync(dir, { recursive: true });
  // A fresh browser context per run, so each app starts from its first-visit state
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = new Page(cdp, sessionId);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.viewport(vp);

  const steps = plans[app](vp);
  for (const [i, [name, step]] of steps.entries()) {
    const file = join(dir, `${String(i + 1).padStart(2, "0")}-${name}.png`);
    try {
      await step(page);
      await page.shot(file, !OVERLAYS.has(name));
      console.log(`✓ ${app}/${vp}/${name}`);
    } catch (e) {
      failures.push(`${app}/${vp}/${name}: ${e.message}`);
      console.log(`✗ ${app}/${vp}/${name}: ${e.message}`);
    }
  }
  await cdp.send("Target.disposeBrowserContext", { browserContextId });
}

chrome.kill();
if (failures.length) {
  console.log(`\n${failures.length} failed:\n${failures.join("\n")}`);
  process.exitCode = 1;
}
