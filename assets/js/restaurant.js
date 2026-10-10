// Restaurant page: store header, sticky menu nav, menu, order panel and the item options sheet.
(() => {
  const { img, rs, restaurant, menuFor, optionGroups, reviews, store, cartUI } = window.Kade;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const main = $("[data-store]");
  const r = restaurant(new URLSearchParams(location.search).get("id") || 1);

  cartUI.mount();

  if (!r) {
    main.innerHTML = `
      <div class="wrap not-found">
        <h1>This restaurant isn't on Kadé</h1>
        <p>The link may be old, or the restaurant has left Kadé. Pick another place near you.</p>
        <a class="btn-solid" style="display:inline-flex;align-items:center" href="index.html">See restaurants near you</a>
      </div>`;
    return;
  }

  document.title = `${r.name} | Kadé`;
  const menu = menuFor(r);
  const itemsById = new Map(menu.sections.flatMap((s) => s.items).map((it) => [it.id, it]));
  const star = (cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-star"/></svg>`;
  const pickupMins = Math.max(10, r.eta[0] - 5);

  // ---------- Page ----------
  const tagHTML = (t) => `<span class="tag ${t === "Vegetarian" ? "tag--veg" : t === "Spicy" ? "tag--hot" : ""}">${t}</span>`;

  const popHTML = (it, i) => `
    <button class="pop-card" type="button" data-item="${it.id}">
      <span class="pop-card__media">
        ${it.photo ? `<img src="${img(it.photo, 400, 400)}" alt="" loading="lazy">` : ""}
        <span class="pop-card__rank">${i === 0 ? "Most ordered" : `#${i + 1} most ordered`}</span>
        <span class="add-dot" data-qty-for="${it.id}"><svg class="icon"><use href="#i-plus"/></svg></span>
      </span>
      <strong>${it.name}</strong>
      <span class="price">${rs(it.price)}</span>
    </button>`;

  const itemHTML = (it) => `
    <button class="item" type="button" data-item="${it.id}" ${it.soldOut ? "disabled" : ""}>
      <span class="item__text">
        <span class="item__name">${it.name}</span>
        ${it.desc ? `<span class="item__desc">${it.desc}</span>` : ""}
        <span class="item__meta">
          <span class="item__price">${rs(it.price)}</span>
          ${it.soldOut ? `<span class="sold-out">Sold out today</span>` : it.tags.map(tagHTML).join("")}
        </span>
      </span>
      ${it.photo
        ? `<span class="item__thumb"><img src="${img(it.photo, 240, 240)}" alt="" loading="lazy">${it.soldOut ? "" : `<span class="add-dot" data-qty-for="${it.id}"><svg class="icon"><use href="#i-plus"/></svg></span>`}</span>`
        : it.soldOut ? "" : `<span class="item__add"><span class="add-dot" data-qty-for="${it.id}"><svg class="icon"><use href="#i-plus"/></svg></span></span>`}
    </button>`;

  const reviewHTML = (rv) => `
    <figure class="review">
      <div class="review__stars" role="img" aria-label="${rv.stars} out of 5 stars">${[1, 2, 3, 4, 5].map((n) => star(n > rv.stars ? "off" : "")).join("")}</div>
      <p>${rv.text}</p>
      <footer><strong>${rv.name}</strong> ordered ${rv.dish}, ${rv.when.toLowerCase()}</footer>
    </figure>`;

  const sections = [
    { id: "popular", name: "Popular" },
    { id: "reviews", name: "Reviews" },
    ...menu.sections,
  ];

  main.innerHTML = `
    <div class="wrap store-top">
      <div class="store-cover">
        <img src="${img(r.photo, 1600, 500)}" alt="">
        <div class="store-cover__actions">
          <a class="cover-btn back" href="index.html" aria-label="Back to restaurants"><svg class="icon"><use href="#i-left"/></svg></a>
          <button class="cover-btn" type="button" aria-pressed="false" aria-label="Save ${r.name} to favourites" data-store-fav><svg class="icon"><use href="#i-heart"/></svg></button>
          <button class="cover-btn" type="button" data-share><svg class="icon"><use href="#i-share"/></svg><span data-share-label>Share</span></button>
        </div>
      </div>

      <div class="store-head">
        <div>
          <h1 class="store-name">${r.name}</h1>
          <p class="store-facts">
            <span class="rating" aria-label="Rated ${r.rating}">${star()}${r.rating}</span>
            <span><strong>${r.reviews}</strong> ratings</span>
            <span>${r.area}, ${r.km.toFixed(1)} km away</span>
            <span>Open ${r.hours}</span>
          </p>
          ${r.offer ? `<p class="store-offer"><svg class="icon"><use href="#i-tag"/></svg>${r.offer}${r.discount ? ", taken off at checkout" : ""}</p>` : ""}
          ${r.closed ? `<div class="store-closed"><strong>Closed now. ${r.closed}.</strong>You can look through the menu and order once it opens.</div>` : ""}
        </div>

        <div class="service" role="group" aria-label="Order type">
          <button type="button" data-mode="delivery" aria-pressed="${store.mode === "delivery"}">
            <strong>Delivery</strong>
            <span>${r.eta[0]}–${r.eta[1]} min, ${r.fee ? rs(r.fee) + " fee" : "no fee"}</span>
          </button>
          <button type="button" data-mode="pickup" aria-pressed="${store.mode === "pickup"}">
            <strong>Pickup</strong>
            <span>Ready in ${pickupMins} min</span>
          </button>
        </div>

        <div class="store-more">
          <a class="ghost-pill" href="#group-order"><svg class="icon"><use href="#i-users"/></svg>Start a group order</a>
          <details class="store-info">
            <summary class="ghost-pill"><svg class="icon"><use href="#i-clock"/></svg>Hours and address<svg class="icon"><use href="#i-down"/></svg></summary>
            <dl class="store-info__body">
              <dt>Address</dt><dd>214 Galle Rd, ${r.area}, Colombo</dd>
              <dt>Open</dt><dd>Every day, ${r.hours}</dd>
              <dt>Minimum order</dt><dd>None. Small orders under Rs 500 add a Rs 60 fee.</dd>
            </dl>
          </details>
        </div>
      </div>
    </div>

    <nav class="menu-nav" aria-label="Menu sections">
      <div class="wrap menu-nav__row">
        <div class="menu-nav__links" data-nav>
          ${sections.map((s) => `<a href="#${s.id}" data-nav-link="${s.id}">${s.name}</a>`).join("")}
        </div>
        <label class="menu-search">
          <svg class="icon" aria-hidden="true"><use href="#i-search"/></svg>
          <span class="visually-hidden">Search the menu</span>
          <input type="search" placeholder="Search the menu" data-menu-search>
        </label>
      </div>
    </nav>

    <div class="wrap store-body">
      <div id="menu" data-menu>
        <section class="menu-section" id="popular" data-section aria-labelledby="h-popular">
          <h2 id="h-popular">Popular</h2>
          <p>What people near you order most from here</p>
          <div class="popular">${menu.popular.slice(0, 4).map(popHTML).join("")}</div>
        </section>

        <section class="menu-section" id="reviews" data-section aria-labelledby="h-reviews">
          <h2 id="h-reviews">Reviews</h2>
          <p>${r.rating} out of 5 from ${r.reviews} ratings</p>
          <div class="reviews">${reviews.map(reviewHTML).join("")}</div>
        </section>

        ${menu.sections.map((s) => `
          <section class="menu-section" id="${s.id}" data-section data-filterable aria-labelledby="h-${s.id}">
            <h2 id="h-${s.id}">${s.name}</h2>
            <div class="items">${s.items.map(itemHTML).join("")}</div>
          </section>`).join("")}

        <div class="menu-empty" data-menu-empty hidden>
          <strong data-menu-empty-title></strong>
          <p>Check the spelling, or search for an ingredient like chicken or cheese.</p>
          <button class="chip" type="button" data-clear-search>Clear search</button>
        </div>
      </div>

      <aside class="order-panel" aria-labelledby="order-title">
        <div class="order-panel__head"><h2 id="order-title">Your order</h2></div>
        <div class="order-panel__body" data-panel-body></div>
        <div class="order-panel__foot" data-panel-foot></div>
      </aside>
    </div>`;

  // ---------- Order panel, quantity dots, mobile bar ----------
  function renderOrder() {
    const t = store.totals();
    const mine = t.count && store.cart.restaurantId === r.id;
    const body = $("[data-panel-body]"), foot = $("[data-panel-foot]");

    if (mine) {
      body.innerHTML = cartUI.contentsHTML();
      foot.innerHTML = cartUI.checkoutHTML();
    } else if (t.count) {
      body.innerHTML = `<p class="order-panel__other"><strong>Your cart has dishes from ${t.restaurant.name}</strong>Adding a dish here starts a new order.</p>`;
      foot.innerHTML = `<button class="btn-primary btn-primary--quiet" type="button" data-cart-open><span>View cart</span></button>`;
    } else {
      body.innerHTML = `<div class="cart-empty"><strong>Nothing added yet</strong><p>Choose a dish to start your order.${r.discount ? ` ${r.discount}% off is taken off at checkout.` : ""}</p></div>`;
      foot.innerHTML = "";
    }

    // Quantity on each "+" so people can see what's already in the order
    const qtyByItem = {};
    if (mine) store.cart.lines.forEach((l) => (qtyByItem[l.itemId] = (qtyByItem[l.itemId] || 0) + l.qty));
    $$("[data-qty-for]").forEach((dot) => {
      const q = qtyByItem[dot.dataset.qtyFor];
      dot.classList.toggle("has-qty", !!q);
      dot.innerHTML = q ? q : `<svg class="icon"><use href="#i-plus"/></svg>`;
    });

    const bar = $("[data-order-bar]");
    bar.hidden = !mine;
    document.body.classList.toggle("has-order-bar", !!mine);
    $("[data-order-bar-total]").textContent = mine ? rs(t.total) : "";
  }

  // ---------- Item options sheet ----------
  const dialog = $("[data-item-dialog]");
  let current = null; // { item, qty }

  function groupHTML(gid) {
    const g = optionGroups[gid];
    const type = g.max === 1 ? "radio" : "checkbox";
    const hint = g.required ? `<span class="req">Required</span>` : `<span>Optional${g.max > 1 ? `, up to ${g.max}` : ""}</span>`;
    return `
      <fieldset class="opt" data-group="${gid}">
        <legend><strong>${g.name}</strong>${hint}</legend>
        <div class="opt__list">
          ${g.choices.map(([name, price], i) => `
            <label class="choice">
              <input type="${type}" name="${gid}" value="${i}">
              <span class="choice__mark" aria-hidden="true"></span>
              <span class="choice__name">${name}</span>
              ${price ? `<span class="choice__price">+ ${rs(price)}</span>` : ""}
            </label>`).join("")}
        </div>
        <p class="opt__error" role="alert">Choose ${g.name.toLowerCase()} to continue.</p>
      </fieldset>`;
  }

  function unitPrice() {
    let extra = 0;
    current.item.options.forEach((gid) => {
      $$(`input[name="${gid}"]:checked`, dialog).forEach((inp) => (extra += optionGroups[gid].choices[inp.value][1]));
    });
    return current.item.price + extra;
  }

  function updateSheet() {
    const unit = unitPrice();
    $("[data-sheet-qty]", dialog).textContent = current.qty;
    $("[data-sheet-minus]", dialog).disabled = current.qty <= 1;
    $("[data-add-label]", dialog).textContent = `Add ${current.qty} to order`;
    $("[data-add-price]", dialog).textContent = rs(unit * current.qty);

    current.item.options.forEach((gid) => {
      const g = optionGroups[gid];
      const set = $(`[data-group="${gid}"]`, dialog);
      const checked = $$(`input[name="${gid}"]:checked`, dialog).length;
      set.classList.toggle("is-done", checked > 0);
      if (checked) set.classList.remove("has-error");
      if (g.max > 1) $$(`input[name="${gid}"]`, dialog).forEach((inp) => (inp.disabled = !inp.checked && checked >= g.max));
    });
  }

  function openItem(id) {
    const item = itemsById.get(id);
    if (!item || item.soldOut) return;
    current = { item, qty: 1 };
    dialog.classList.toggle("sheet--no-photo", !item.photo);
    dialog.innerHTML = `
      <form class="sheet__form" method="dialog" novalidate data-sheet-form>
        <button class="sheet__close" type="button" aria-label="Close" data-sheet-close><svg class="icon"><use href="#i-close"/></svg></button>
        <div class="sheet__scroll">
          ${item.photo ? `<div class="sheet__photo"><img src="${img(item.photo, 1120, 630)}" alt=""></div>` : ""}
          <div class="sheet__body">
            <h2 id="item-title">${item.name}</h2>
            ${item.desc ? `<p class="sheet__desc">${item.desc}</p>` : ""}
            <p class="sheet__price">${rs(item.price)}</p>
            ${item.options.map(groupHTML).join("")}
            <label class="note">
              <strong>Note for the kitchen</strong>
              <textarea name="note" maxlength="140" placeholder="For example: no onions, gravy on the side"></textarea>
            </label>
          </div>
        </div>
        <div class="sheet__foot">
          <div class="stepper" role="group" aria-label="Quantity">
            <button type="button" aria-label="One fewer" data-sheet-minus>−</button>
            <output data-sheet-qty aria-live="polite">1</output>
            <button type="button" aria-label="One more" data-sheet-plus>+</button>
          </div>
          <button class="add-btn" type="submit" data-add><span data-add-label></span><span data-add-price></span></button>
        </div>
      </form>`;
    updateSheet();
    dialog.showModal();
    $(".sheet__scroll", dialog).scrollTop = 0;
    $("[data-sheet-close]", dialog).focus();
  }

  dialog.addEventListener("change", updateSheet);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) return dialog.close(); // backdrop
    const t = e.target.closest("button");
    if (!t) return;
    if (t.hasAttribute("data-sheet-close")) dialog.close();
    else if (t.hasAttribute("data-sheet-plus")) { current.qty = Math.min(20, current.qty + 1); updateSheet(); }
    else if (t.hasAttribute("data-sheet-minus")) { current.qty = Math.max(1, current.qty - 1); updateSheet(); }
  });

  dialog.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { item, qty } = current;

    const missing = item.options.filter((gid) => optionGroups[gid].required && !$(`input[name="${gid}"]:checked`, dialog));
    if (missing.length) {
      missing.forEach((gid) => $(`[data-group="${gid}"]`, dialog).classList.add("has-error"));
      const first = $(`[data-group="${missing[0]}"]`, dialog);
      first.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      $("input", first).focus({ preventScroll: true });
      return;
    }

    const choices = item.options.flatMap((gid) => $$(`input[name="${gid}"]:checked`, dialog).map((inp) => optionGroups[gid].choices[inp.value][0]));
    const line = { itemId: item.id, name: item.name, unit: unitPrice(), qty, choices, note: dialog.querySelector("textarea").value.trim() };

    let key = store.add(r.id, line);
    if (key === false) {
      dialog.close();
      if (!(await cartUI.confirmNewOrder(r.name))) return;
      key = store.add(r.id, line, { replace: true });
      flashLine(key);
      return;
    }

    const btn = $("[data-add]", dialog);
    btn.classList.add("is-added");
    btn.innerHTML = `<svg class="icon"><use href="#i-check"/></svg>Added to order`;
    setTimeout(() => { dialog.close(); flashLine(key); }, reduceMotion ? 0 : 550);
  });

  function flashLine(key) {
    const row = $(`.order-panel [data-line="${CSS.escape(key)}"]`);
    if (!row) return;
    row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
  }

  // ---------- Page events ----------
  main.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.item) openItem(t.dataset.item);
    else if (t.hasAttribute("data-store-fav")) {
      const on = t.getAttribute("aria-pressed") !== "true";
      t.setAttribute("aria-pressed", on);
      t.classList.remove("pop"); void t.offsetWidth; t.classList.add("pop");
    } else if (t.hasAttribute("data-share")) {
      const label = $("[data-share-label]", t);
      try {
        if (navigator.share) await navigator.share({ title: r.name, url: location.href });
        else { await navigator.clipboard.writeText(location.href); label.textContent = "Link copied"; setTimeout(() => (label.textContent = "Share"), 2000); }
      } catch { /* share sheet dismissed */ }
    } else if (t.hasAttribute("data-clear-search")) {
      const input = $("[data-menu-search]"); input.value = ""; filterMenu(""); input.focus();
    }
  });

  // Close the hours popover when clicking elsewhere
  document.addEventListener("click", (e) => {
    const info = $(".store-info");
    if (info?.open && !info.contains(e.target)) info.open = false;
  });

  // ---------- Menu search ----------
  function filterMenu(raw) {
    const q = raw.trim().toLowerCase();
    $$("#popular, #reviews").forEach((s) => (s.hidden = !!q));
    let shown = 0;
    $$("[data-filterable]").forEach((sec) => {
      let n = 0;
      $$(".item", sec).forEach((el) => {
        const it = itemsById.get(el.dataset.item);
        const hit = !q || `${it.name} ${it.desc}`.toLowerCase().includes(q);
        el.hidden = !hit; if (hit) n++;
      });
      sec.hidden = n === 0; shown += n;
    });
    $("[data-menu-empty]").hidden = shown > 0;
    $("[data-menu-empty-title]").textContent = `No dishes match "${raw.trim()}"`;
    $$("[data-nav-link]").forEach((a) => (a.hidden = document.getElementById(a.dataset.navLink).hidden));
  }
  $("[data-menu-search]").addEventListener("input", (e) => filterMenu(e.target.value));

  // ---------- Scroll spy for the sticky menu nav ----------
  const links = new Map($$("[data-nav-link]").map((a) => [a.dataset.navLink, a]));
  const visible = new Set();
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((en) => (en.isIntersecting ? visible.add(en.target.id) : visible.delete(en.target.id)));
    const active = sections.map((s) => s.id).find((id) => visible.has(id));
    if (!active) return;
    links.forEach((a, id) => a.setAttribute("aria-current", id === active));
    const a = links.get(active), nav = $("[data-nav]");
    nav.scrollTo({ left: a.offsetLeft - nav.clientWidth / 2 + a.clientWidth / 2, behavior: reduceMotion ? "auto" : "smooth" });
  }, { rootMargin: "-140px 0px -55% 0px" });
  $$("[data-section]").forEach((s) => spy.observe(s));

  store.subscribe(renderOrder);
  renderOrder();
})();
