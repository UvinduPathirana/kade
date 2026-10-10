# Kadé design system

Food delivery for Colombo, Sri Lanka. Prices in LKR (`Rs 1,150`). The design system is the `@kade/ui` package (`packages/ui`), shared by every Kadé app. Designed following `.claude/skills/frontend-design`.

## Tokens (`packages/ui/src/styles/tokens.css`)

All tokens are CSS variables prefixed `--kd-`. Use them in every CSS Module; never hard-code a colour, radius or spacing value that has a token.

| Token           | Hex       | Use                                              |
| --------------- | --------- | ------------------------------------------------ |
| `--kd-leaf`     | `#1E5B3A` | Primary buttons, selected states, links that act |
| `--kd-turmeric` | `#F2B705` | One bold surface per page, never more            |
| `--kd-chilli`   | `#C8331E` | Offers, discounts, savings and errors only       |
| `--kd-ink`      | `#10251A` | Text                                             |
| `--kd-steam`    | `#F1F3F0` | Chips, section washes, inactive controls         |

Also: `--kd-leaf-deep` / `--kd-leaf-tint`, `--kd-chilli-tint`, `--kd-ink-muted`, `--kd-line`, `--kd-white`, `--kd-scrim`.

**Type:** **Bricolage Grotesque** (`--kd-font-display`) for headings and the wordmark, **Instrument Sans** (`--kd-font-ui`) for everything else. Scale `--kd-text-xs` 13 / `sm` 15 / `md` 17 / `lg` 21 / `xl` 28 / `2xl` 40 / `hero`. Sentence case only, with no all-caps labels. Each app loads the two fonts in its `index.html`.

**Radii follow hierarchy:** `--kd-radius-pill` for controls, `-media` 14px for photos, `-panel` 20px for panels and dialogs, `-hero` 32px for the hero surface.

**Spacing:** 4px base, `--kd-s-1` (4) … `--kd-s-8` (64). Layout: `--kd-page-max` 1320px, `--kd-gutter`, `--kd-header-h` (72px, 60px on phones).

## Components (`@kade/ui`)

| Component                                                          | What it's for                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                           | Variants `primary` (leaf), `secondary` (steam), `outline`, `ink` (on turmeric), `turmeric` (the page's one bold action). `trailing` pins an amount to the end: "Go to checkout ··· Rs 3,110". Pass `href` to render a link. |
| `IconButton`                                                       | Icon-only, `label` required. `plain` / `soft` / `overlay` (on photos). `pressed` makes it a toggle (saved heart).                                                                                                           |
| `Chip`                                                             | Filters and small actions. `pressed` for toggles.                                                                                                                                                                           |
| `SegmentedControl`                                                 | Mutually exclusive options. `pill` (header Delivery/Pickup) or `card` (options that carry their own facts).                                                                                                                 |
| `Stepper`                                                          | Quantity. With `min={0}` the minus button reads "Remove …" at 1.                                                                                                                                                            |
| `Rating`, `Stars`                                                  | Score pill (★ 4.8) and a five-star row for reviews.                                                                                                                                                                         |
| `Tag`                                                              | `neutral`, `veg`, `hot`, `offer` (solid chilli on photos), `offerSoft`, `positive`.                                                                                                                                         |
| `RestaurantCard`                                                   | Feed/shelf card. Time first (`eta`), then `facts`. The whole card is one link; the heart sits above it.                                                                                                                     |
| `Shelf`                                                            | Horizontal snap-scrolling row with optional arrows; four across on wide screens.                                                                                                                                            |
| `Container`, `SectionHeader`, `EmptyState`, `TextLink`, `Wordmark` | Layout building blocks. Empty states say what happened and what to do next.                                                                                                                                                 |
| `Drawer`, `Sheet`, `ConfirmDialog`                                 | Radix Dialog underneath: focus trap, Escape and backdrop close, focus returns to whatever opened it. `Sheet` is centred on desktop and a bottom sheet on phones.                                                            |
| `Choice`, `ChoiceGroup`, `TextArea`, `SearchField`                 | Form controls. `ChoiceGroup` shows Required/Optional, turns leaf when complete and announces its error.                                                                                                                     |
| `Icon`                                                             | The shared 24px stroke icon set. Add new icons there.                                                                                                                                                                       |
| `formatRs`, `plural`, `cx`                                         | Helpers.                                                                                                                                                                                                                    |

| `Switch` | Immediate on/off settings (sold out, busy mode). `role="switch"`. |
| `Tabs` | Accessible tabs with optional counts ("New 3"). Arrow keys move between tabs. |
| `Select` | Native select styled as a field. |
| `StatTile`, `StatGroup` | A figure people act on, with label and comparison. Only for numbers that drive a decision. |
| `DataTable` | Dense operations table: sticky header, tabular numbers, keyboard-clickable rows, `hideOnNarrow` columns. |
| `AppShell` | Frame for the operations apps: labelled sidebar on desktop, icon rail on tablets, bottom tabs on phones. `tone="ink"` for always-on screens. |
| `ToastProvider`, `useToast` | Confirmations after an action, named in the past tense of the action ("Order accepted"). |

**Routing:** `@kade/ui` never imports a router. Each app passes its link via `<UIProvider linkComponent={AppLink}>`; every component with `href` uses it.

## Customer app (`apps/customer`)

- `src/api/`: `catalog.ts` and `orders.ts` are the only things pages call for data. Today they serve mock data (orders persist in localStorage); later they call the catalogue, menu and order microservices. `queries.ts` wraps each call in TanStack Query; live order status polls every second, standing in for the order service's status stream.
- `src/api/orderStatus.ts`: the order's status is derived from time since it was placed (accepted at 20 s, cooking at 30 s, picked up at 60 s, delivered at 100 s) so the demo moves on its own. Customers can cancel only before the kitchen accepts.
- `src/api/promos.ts`: demo codes `KADE100` (Rs 100 off Rs 1,000+) and `FIRSTKOTTU` (15% off at Galle Road Kottu House, up to Rs 500). The order service re-checks codes and recomputes totals; it never trusts the client's numbers.
- `src/features/cart/`: Zustand store saved to localStorage (`kade.cart.v2`) with the cart, a snapshot of its restaurant, and Delivery/Pickup mode. One restaurant per cart; `add()` returns `false` when the cart holds another restaurant's dishes, and the page asks "Start a new order?". `totals.ts` is the pure price calculation.
- `src/features/feed/`, `src/features/menu/`: page sections for home and the restaurant page.
- `src/layout/`: site header, footer, phone tab bar.
- `src/features/cart/totals.ts`: the one price calculation (subtotal, offer, promo, delivery fee, small-order fee under Rs 500, tip) shared by cart, checkout and the order service.
- Routes: `/` home, `/restaurant/:id`, `/cart`, `/checkout`, `/orders/:id` (tracking, then rating and receipt), plus planned routes that show a "still being built" page.

## Operations apps

All four apps share the tokens, type and voice. Each has its own job, so each spends its one bold surface differently.

| App                           | Device                                                  | Direction                                                                                                                                                    | Turmeric surface                                           |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `apps/restaurant` (port 5175) | Kitchen tablet, landscape, arm's length, greasy fingers | Big type and 56px+ touch targets, glanceable from a metre away. `AppShell tone="ink"`, so the screen recedes and the orders read. Timers in tabular numbers. | The new-order alert card: what the kitchen must accept now |
| `apps/rider` (port 5176)      | Phone, one hand, outdoors in Colombo sun                | Map-first, very high contrast, everything thumb-reachable at the bottom. One action per screen, large primary buttons.                                       | "Go online" and the incoming job offer                     |
| `apps/admin` (port 5177)      | Desktop, operations staff all day                       | Dense and calm: tables, filters, side panels, small type. No turmeric. Chilli only for things needing intervention.                                          | None                                                       |

## Rules we agreed

- One turmeric surface per page: the search band on home, "Add to order" in item options, "Place order" at checkout, the status band on tracking and delivered. Everything else stays calm.
- Status is written as a sentence in the hero's voice: "Nimal is 7 minutes away.", "Delivered at 7:41 pm. Enjoy your cheese kottu."
- The delivery map is an illustration (Galle Road, the coastal railway, the sea) until the rider app sends real positions. Its colours live in `DeliveryMap.module.css`, not the global tokens.
- Time-first: every place shows its delivery time before its delivery fee.
- Motion: only the hero rotation runs on its own. It is turned off under `prefers-reduced-motion` and pauses while the hero has focus. Other motion answers an action (sheet opening, a heart popping, the added line flashing).
- Below 860px, Delivery/Pickup moves into the hero. Below 640px, a bottom tab bar appears (Home, Browse, Orders, Account).
- Food photos are hotlinked from Unsplash as placeholders. Replace them with restaurant uploads later.
- `prototype/` holds the original static HTML designs for reference. Don't edit it; build in the apps.

## Pages

See `PAGES.md` for the full plan and build order.
