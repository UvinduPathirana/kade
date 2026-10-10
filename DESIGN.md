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

**Routing:** `@kade/ui` never imports a router. Each app passes its link via `<UIProvider linkComponent={AppLink}>`; every component with `href` uses it.

## Customer app (`apps/customer`)

- `src/api/`: `catalog.ts` is the only thing pages call for data. Today it serves `mock/catalogue.ts`; later it calls the catalogue and menu microservices. `queries.ts` wraps each call in TanStack Query.
- `src/features/cart/`: Zustand store saved to localStorage (`kade.cart.v2`) with the cart, a snapshot of its restaurant, and Delivery/Pickup mode. One restaurant per cart; `add()` returns `false` when the cart holds another restaurant's dishes, and the page asks "Start a new order?". `totals.ts` is the pure price calculation.
- `src/features/feed/`, `src/features/menu/`: page sections for home and the restaurant page.
- `src/layout/`: site header, footer, phone tab bar.
- Routes: `/` home, `/restaurant/:id`, plus planned routes that show a "still being built" page.

## Rules we agreed

- One turmeric surface per page: the search band on home, the "Add to order" button in item options. Everything else stays calm.
- Time-first: every place shows its delivery time before its delivery fee.
- Motion: only the hero rotation runs on its own. It is turned off under `prefers-reduced-motion` and pauses while the hero has focus. Other motion answers an action (sheet opening, a heart popping, the added line flashing).
- Below 860px, Delivery/Pickup moves into the hero. Below 640px, a bottom tab bar appears (Home, Browse, Orders, Account).
- Food photos are hotlinked from Unsplash as placeholders. Replace them with restaurant uploads later.
- `prototype/` holds the original static HTML designs for reference. Don't edit it; build in the apps.

## Pages

See `PAGES.md` for the full plan and build order.
