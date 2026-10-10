# Kadé design system

Food delivery for Colombo, Sri Lanka. Prices in LKR (`Rs 1,150`). Built with plain HTML, CSS and JS, following `.claude/skills/frontend-design`.

## Tokens (`assets/css/tokens.css`)

| Token | Hex | Use |
|---|---|---|
| `--leaf` | `#1E5B3A` | Primary buttons, selected states, links that act |
| `--turmeric` | `#F2B705` | One bold surface per page, never more (home: the search band) |
| `--chilli` | `#C8331E` | Offers, discounts, savings only |
| `--ink` | `#10251A` | Text |
| `--steam` | `#F1F3F0` | Chips, section washes, inactive controls |

Type: **Bricolage Grotesque** for headings and the wordmark, **Instrument Sans** for everything else. Sentence case only, with no all-caps labels.

Radii follow hierarchy: pills for controls, 14px for photos, 20px for panels, 32px for the hero surface.

## Shared data and cart (`assets/js`)
- `data.js`: `window.Kade` catalogue: restaurants, categories, menus (`menuFor`), option groups, reviews, `img()`, `rs()`
- `cart.js`: one cart for all pages, saved in localStorage (`kade.cart.v1`), plus Delivery/Pickup mode (`kade.mode`). One restaurant per cart; adding from another asks "Start a new order?". Renders the cart drawer and header badge. Any `[data-mode]` button switches mode.
- Load order on every customer page: `data.js`, `cart.js`, then the page script.

## Shared components (`assets/css/base.css`)
- `.site-header`: wordmark, address, Delivery/Pickup toggle, compact search (appears once the hero search scrolls away), account, cart
- `.chip` with `aria-pressed` for filters
- `.r-card`: restaurant card. Delivery time comes first, then fee, then rating. The offer badge is chilli. Favourite heart.
- `.shelf`: horizontal scroll row with arrow buttons
- `.drawer`: right-side panel (cart). Esc and the backdrop close it, and focus goes back to the button that opened it.
- `.btn-primary`: full-width pill, label on the left and amount on the right
- `.confirm`: small native `<dialog>` for yes/no decisions
- Item options sheet (`restaurant.css`): native `<dialog>`, centred on desktop, bottom sheet on phones. Required groups show an error and take focus if skipped.

## Rules we agreed
- The bold moment is the turmeric band plus the rotating dish headline. Everything else stays calm.
- Time-first: every place shows its delivery time before its delivery fee.
- Motion: only the hero rotation runs on its own. It is turned off under `prefers-reduced-motion` and pauses while the hero has focus.
- Below 860px, Delivery/Pickup moves into the hero. Below 640px, a bottom tab bar appears (Home, Browse, Orders, Account).
- Food photos are hotlinked from Unsplash as placeholders. Replace them with restaurant uploads later.

## Pages
See `PAGES.md` for the full plan and build order.
