// Shared cart + order mode, saved in localStorage so every customer page sees the same order.
// Also renders the cart drawer, the header badge and the "start a new order?" confirmation.
(() => {
  const { rs, img, restaurant } = window.Kade;
  const CART_KEY = "kade.cart.v1";
  const MODE_KEY = "kade.mode";
  const listeners = new Set();

  const seed = {
    restaurantId: 3,
    lines: [
      { key: "3-0-0|No chilli", itemId: "3-0-0", name: "Fish bun", unit: 140, qty: 4, choices: [], note: "No chilli" },
      { key: "3-0-1|", itemId: "3-0-1", name: "Vegetable roti", unit: 120, qty: 3, choices: [], note: "" },
      { key: "3-0-2|", itemId: "3-0-2", name: "Chicken patty", unit: 160, qty: 2, choices: [], note: "" },
    ],
  };

  const read = () => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      return raw ? JSON.parse(raw) : structuredClone(seed);
    } catch { return structuredClone(seed); }
  };

  let cart = read();
  let mode = localStorage.getItem(MODE_KEY) || "delivery";

  const save = () => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    listeners.forEach((fn) => fn());
  };

  const lineKey = (line) => `${line.itemId}|${[...line.choices, line.note].join("|")}`;

  const store = {
    get cart() { return cart; },
    get mode() { return mode; },
    set mode(m) { mode = m; localStorage.setItem(MODE_KEY, m); listeners.forEach((fn) => fn()); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Returns false when the cart holds another restaurant's items (caller should confirm first). */
    add(restaurantId, line, { replace = false } = {}) {
      if (cart.lines.length && cart.restaurantId !== restaurantId && !replace) return false;
      if (replace || cart.restaurantId !== restaurantId) cart = { restaurantId, lines: [] };
      const key = lineKey(line);
      const existing = cart.lines.find((l) => l.key === key);
      existing ? (existing.qty += line.qty) : cart.lines.push({ ...line, key });
      save();
      return key;
    },
    setQty(key, qty) {
      const line = cart.lines.find((l) => l.key === key);
      if (!line) return;
      line.qty = qty;
      if (qty <= 0) cart.lines = cart.lines.filter((l) => l !== line);
      save();
    },
    totals() {
      const r = restaurant(cart.restaurantId);
      const count = cart.lines.reduce((s, l) => s + l.qty, 0);
      const subtotal = cart.lines.reduce((s, l) => s + l.unit * l.qty, 0);
      const saving = r?.discount ? Math.round((subtotal * r.discount) / 100) : 0;
      const fee = mode === "delivery" && count ? r?.fee ?? 0 : 0;
      return { restaurant: r, count, subtotal, saving, fee, total: subtotal - saving + fee };
    },
  };

  // ---------- UI ----------
  const etaText = (r) => (mode === "delivery" ? `Delivery in ${r.eta[0]}–${r.eta[1]} min` : `Pickup in about ${Math.max(10, r.eta[0] - 5)} min`);

  function lineHTML(l) {
    const detail = [...l.choices, l.note].filter(Boolean).join(", ");
    return `
      <li class="cart-item" data-line="${l.key}">
        <strong>${l.name}</strong>
        <div class="stepper" role="group" aria-label="Quantity of ${l.name}">
          <button type="button" aria-label="${l.qty === 1 ? "Remove" : "Remove one"} ${l.name}" data-qty="${l.key}" data-d="-1">−</button>
          <output>${l.qty}</output>
          <button type="button" aria-label="Add one ${l.name}" data-qty="${l.key}" data-d="1">+</button>
        </div>
        <small>${detail ? detail + ", " : ""}${rs(l.unit * l.qty)}</small>
      </li>`;
  }

  function summaryHTML(t) {
    return `
      <div class="cart-sum">
        <div><span>Subtotal</span><span>${rs(t.subtotal)}</span></div>
        ${t.fee ? `<div><span>Delivery fee</span><span>${rs(t.fee)}</span></div>` : ""}
        ${mode === "delivery" && !t.fee ? `<div><span>Delivery fee</span><span class="free">Free</span></div>` : ""}
        ${t.saving ? `<div class="saving"><span>Offer: ${t.restaurant.discount}% off</span><span>− ${rs(t.saving)}</span></div>` : ""}
        <div class="total"><span>Total</span><span>${rs(t.total)}</span></div>
      </div>`;
  }

  /** Cart contents (store, lines, totals) — used by the drawer and by the restaurant page's side panel. */
  function contentsHTML() {
    const t = store.totals();
    if (!t.count) {
      return `<div class="cart-empty"><strong>Your cart is empty</strong><p>Add dishes from a restaurant and they'll show up here.</p></div>`;
    }
    const r = t.restaurant;
    return `
      <a class="cart-store" href="restaurant.html?id=${r.id}">
        <img src="${img(r.photo, 120, 120)}" alt="">
        <div><strong>${r.name}</strong><span>${etaText(r)}</span></div>
      </a>
      <ul>${cart.lines.map(lineHTML).join("")}</ul>
      ${summaryHTML(t)}`;
  }

  function checkoutHTML() {
    const t = store.totals();
    return t.count
      ? `<a class="btn-primary" href="#checkout"><span>Go to checkout</span><span>${rs(t.total)}</span></a>`
      : `<a class="btn-primary btn-primary--quiet" href="index.html"><span>Browse restaurants</span></a>`;
  }

  let drawer, scrim, lastFocus;

  function renderDrawer() {
    if (!drawer) return;
    drawer.querySelector("[data-cart-body]").innerHTML = contentsHTML();
    drawer.querySelector("[data-cart-foot]").innerHTML = checkoutHTML();
  }

  function renderBadge() {
    const { count } = store.totals();
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = count;
      el.setAttribute("aria-label", `${count} ${count === 1 ? "item" : "items"}`);
    });
  }

  function setDrawer(open) {
    drawer.classList.toggle("is-open", open);
    scrim.classList.toggle("is-open", open);
    document.body.style.overflow = open ? "hidden" : "";
    if (open) { lastFocus = document.activeElement; setTimeout(() => drawer.querySelector("[data-cart-close]").focus(), 50); }
    else lastFocus?.focus();
  }

  // ---------- "Start a new order?" ----------
  let confirmDialog;
  function confirmNewOrder(newName) {
    const current = store.totals().restaurant;
    if (!confirmDialog) {
      confirmDialog = document.createElement("dialog");
      confirmDialog.className = "confirm";
      document.body.append(confirmDialog);
    }
    confirmDialog.innerHTML = `
      <form method="dialog">
        <h2>Start a new order?</h2>
        <p>Your cart has dishes from ${current.name}. Adding from ${newName} will remove them.</p>
        <div class="confirm__actions">
          <button class="btn-ghost" value="keep">Keep current cart</button>
          <button class="btn-solid" value="new" autofocus>Start new order</button>
        </div>
      </form>`;
    confirmDialog.showModal();
    return new Promise((resolve) => {
      confirmDialog.addEventListener("close", () => resolve(confirmDialog.returnValue === "new"), { once: true });
    });
  }

  function mount() {
    drawer = document.querySelector("[data-cart]");
    scrim = document.querySelector("[data-scrim]");
    if (drawer) {
      drawer.innerHTML = `
        <div class="drawer__head">
          <h2 id="cart-title">Your cart</h2>
          <button class="icon-btn" type="button" aria-label="Close cart" data-cart-close><svg class="icon"><use href="#i-close"/></svg></button>
        </div>
        <div class="drawer__body" data-cart-body></div>
        <div class="drawer__foot" data-cart-foot></div>`;
      scrim.addEventListener("click", () => setDrawer(false));
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawer.classList.contains("is-open")) setDrawer(false); });
    }

    document.addEventListener("click", (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.hasAttribute("data-cart-open")) setDrawer(true);
      else if (t.hasAttribute("data-cart-close")) setDrawer(false);
      else if (t.dataset.qty) {
        const line = cart.lines.find((l) => l.key === t.dataset.qty);
        if (line) store.setQty(line.key, line.qty + Number(t.dataset.d));
      } else if (t.dataset.mode) {
        store.mode = t.dataset.mode;
      }
    });

    const sync = () => {
      renderDrawer();
      renderBadge();
      document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === mode));
    };
    store.subscribe(sync);
    window.addEventListener("storage", (e) => { if (e.key === CART_KEY) { cart = read(); sync(); } });
    sync();
  }

  Object.assign(window.Kade, { store, cartUI: { mount, contentsHTML, checkoutHTML, open: () => setDrawer(true), confirmNewOrder } });
})();
