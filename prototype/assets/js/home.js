// Customer home feed. Data comes from data.js, cart + order mode from cart.js.
(() => {
  const { img, rs, photos: P, categories, restaurants, store, cartUI } = window.Kade;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const heroDishes = [
    { dish: "Kottu,", eta: "22 minutes away.", photo: P.kottu, place: "Galle Road Kottu House", meta: "Rs 1,150 for a chicken kottu", id: 1 },
    { dish: "Fish curry,", eta: "34 minutes away.", photo: P.fishCurry, place: "Negombo Fish Curry Co.", meta: "Rs 1,600 with red rice", id: 5 },
    { dish: "Fish buns,", eta: "14 minutes away.", photo: P.buns, place: "Kompanna Short Eats", meta: "Rs 140 each, still warm", id: 3 },
    { dish: "Biryani,", eta: "29 minutes away.", photo: P.biryani, place: "Marine Drive Biryani", meta: "Rs 1,450 for chicken biryani", id: 4 },
  ];

  const state = { cat: "all", filters: new Set(), favs: new Set([2, 12]) };

  // ---------- Rendering ----------
  const starSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-star"/></svg>';

  function card(r) {
    const eta = store.mode === "delivery" ? `${r.eta[0]}–${r.eta[1]} min` : `Ready in ${Math.max(10, r.eta[0] - 5)} min`;
    const fee = store.mode === "pickup"
      ? `<span>${r.km.toFixed(1)} km</span>`
      : r.fee === 0 ? `<span class="free">No delivery fee</span>` : `<span>${rs(r.fee)} delivery</span>`;
    const fav = state.favs.has(r.id);
    return `
      <article class="r-card">
        <div class="r-card__media">
          <img src="${img(r.photo)}" alt="" loading="lazy">
          ${r.offer ? `<span class="r-card__offer">${r.offer}</span>` : ""}
          ${r.closed ? `<span class="r-card__closed">${r.closed}</span>` : ""}
        </div>
        <button class="fav-btn" type="button" aria-pressed="${fav}" aria-label="Save ${r.name} to favourites" data-fav="${r.id}">
          <svg class="icon"><use href="#i-heart"/></svg>
        </button>
        <div class="r-card__body">
          <div class="r-card__title">
            <h3 class="r-card__name"><a class="r-card__link" href="restaurant.html?id=${r.id}">${r.name}</a></h3>
            <span class="rating" aria-label="Rated ${r.rating} from ${r.reviews} reviews">${starSvg}${r.rating}</span>
          </div>
          <p class="r-card__facts">
            <span class="eta">${eta}</span>
            ${fee}
          </p>
        </div>
      </article>`;
  }

  function passes(r) {
    if (state.cat !== "all" && r.cat !== state.cat) return false;
    const f = state.filters;
    if (f.has("offers") && !r.offer) return false;
    if (f.has("fast") && r.eta[1] > 30) return false;
    if (f.has("rated") && r.rating < 4.5) return false;
    if (f.has("free") && r.fee !== 0) return false;
    if (f.has("veg") && !r.veg) return false;
    if (f.has("budget") && r.price > 1) return false;
    return true;
  }

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  function renderCategories() {
    $("[data-categories]").innerHTML = categories.map((c) => `
      <button class="cat" type="button" aria-pressed="${state.cat === c.id}" data-cat="${c.id}">
        <img src="${img(c.photo, 160, 160)}" alt="" loading="lazy">${c.label}
      </button>`).join("");
  }

  function renderFeed() {
    const open = restaurants.filter((r) => !r.closed);
    const shelves = {
      offers: open.filter((r) => r.offer),
      again: restaurants.filter((r) => r.again),
      fast: [...open].sort((a, b) => a.eta[0] - b.eta[0]).slice(0, 8),
    };
    for (const [key, list] of Object.entries(shelves)) {
      $(`[data-shelf="${key}"]`).innerHTML = list.map(card).join("");
    }

    const list = restaurants.filter(passes);
    const grid = $("[data-grid]");
    const noun = store.mode === "delivery" ? "deliver to you" : "for pickup near you";
    $("[data-result-count]").textContent = `${list.length} ${list.length === 1 ? "place" : "places"} ${noun}`;
    grid.innerHTML = list.length
      ? list.map(card).join("")
      : `<div class="empty"><strong>Nothing matches all of these filters</strong><p>Remove a filter or pick another category to see more places.</p><button class="chip" type="button" data-clear>Clear filters</button></div>`;
  }

  // ---------- Hero rotation (the page's one orchestrated motion) ----------
  function startHero() {
    const title = $(".hero__title"), plate = $(".hero__plate");
    const dishEl = $("[data-hero-dish]"), etaEl = $("[data-hero-eta]");
    const imgEl = $("[data-hero-img]"), placeEl = $("[data-hero-place]"), metaEl = $("[data-hero-meta]");
    heroDishes.forEach((d) => { new Image().src = img(d.photo, 800, 800); });
    let i = 0, paused = false;
    $(".hero__band").addEventListener("focusin", () => (paused = true));
    $(".hero__band").addEventListener("focusout", () => (paused = false));

    setInterval(() => {
      if (paused || document.hidden) return;
      i = (i + 1) % heroDishes.length;
      const d = heroDishes[i];
      title.classList.add("is-leaving"); plate.classList.add("is-leaving");
      setTimeout(() => {
        dishEl.textContent = d.dish; etaEl.textContent = d.eta;
        imgEl.src = img(d.photo, 800, 800);
        placeEl.textContent = d.place; metaEl.textContent = d.meta;
        title.classList.replace("is-leaving", "is-entering");
        plate.classList.replace("is-leaving", "is-entering");
        setTimeout(() => { title.classList.remove("is-entering"); plate.classList.remove("is-entering"); }, 650);
      }, 320);
    }, 4200);
  }

  // ---------- Events ----------
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;

    if (t.dataset.cat) {
      state.cat = state.cat === t.dataset.cat && t.dataset.cat !== "all" ? "all" : t.dataset.cat;
      $$("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.cat === state.cat));
      renderFeed();
    } else if (t.dataset.filter) {
      const on = !state.filters.has(t.dataset.filter);
      on ? state.filters.add(t.dataset.filter) : state.filters.delete(t.dataset.filter);
      t.setAttribute("aria-pressed", on);
      renderFeed();
    } else if (t.hasAttribute("data-clear")) {
      state.filters.clear(); state.cat = "all";
      $$("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", "false"));
      $$("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.cat === "all"));
      renderFeed();
    } else if (t.dataset.fav) {
      const id = Number(t.dataset.fav);
      state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
      $$(`[data-fav="${id}"]`).forEach((b) => {
        b.setAttribute("aria-pressed", state.favs.has(id));
        b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
      });
    } else if (t.dataset.scroll) {
      const shelf = document.getElementById(t.dataset.scroll);
      shelf.scrollBy({ left: Number(t.dataset.dir) * shelf.clientWidth * 0.9, behavior: reduceMotion ? "auto" : "smooth" });
    } else if (t.hasAttribute("data-try")) {
      e.preventDefault();
      const q = $("#q"); q.value = t.textContent; q.focus();
    } else if (t.closest(".lang")) {
      $$(".lang button").forEach((b) => b.setAttribute("aria-pressed", b === t));
    }
  });

  $("[data-search]").addEventListener("submit", (e) => e.preventDefault());

  // Header gains a border and a compact search once the hero search scrolls away
  const header = $("#header");
  const mirror = $("[data-search-mirror]");
  new IntersectionObserver(([entry]) => {
    const away = !entry.isIntersecting;
    header.classList.toggle("show-search", away);
    $(".header-search").setAttribute("aria-hidden", !away);
    mirror.tabIndex = away ? 0 : -1;
  }, { rootMargin: "-72px 0px 0px 0px" }).observe($(".hero__search"));
  window.addEventListener("scroll", () => header.classList.toggle("is-scrolled", window.scrollY > 4), { passive: true });

  cartUI.mount();
  let lastMode = store.mode;
  store.subscribe(() => { if (store.mode !== lastMode) { lastMode = store.mode; renderFeed(); } });

  renderCategories();
  renderFeed();
  if (!reduceMotion) startHero();
})();
