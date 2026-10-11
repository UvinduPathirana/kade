# catalog

Restaurants, menus, option groups, categories, home-feed collections, opening hours, closures and
sold-out state. It serves the customer app's home, category and restaurant pages, the restaurant
app's menu editor and hours screens, and the admin console's home-feed content. Built from
`services/_templates/ts` (see its README for the platform pieces).

- **Owns** (`catalog` DB): `restaurants` (details, ETA window, fallback fee, rating, offer,
  merchant-owned busy/pause/ops status, weekly `hours` JSON, menu version), `closures`,
  `menu_sections`, `menu_items`, `option_groups` (choices as JSON), `categories`, `collections`,
  `seed_runs`, plus the platform tables `outbox`, `processed_events`, `idempotency_keys`.
- **API** (`proto/kade/catalog/v1/catalog_service.proto`), all RPCs implemented:
  - `CatalogService`: `ListCategories`, `GetCategory`, `ListRestaurants`, `GetRestaurant`,
    `BatchGetRestaurants`, `GetMenu`, `GetHomeFeed`, `ValidateCart`.
  - `MenuManagementService`: `SaveMenuItem` (idempotency key), `DeleteMenuItem`,
    `SetMenuItemSoldOut`, `CreateMenuSection`, `RenameMenuSection`, `DeleteMenuSection`,
    `MoveMenuSection`, `SaveOptionGroup`, `DeleteOptionGroup`.
  - `RestaurantManagementService`: `CreateRestaurant` (idempotent on `restaurant_id`),
    `UpdateRestaurantDetails`, `GetOpeningHours`, `SetOpeningHours`, `AddClosure`, `RemoveClosure`.
  - `MerchandisingService`: `ListHomeCategories`, `UpdateHomeCategory`, `MoveHomeCategory`,
    `ListCollections`, `SaveCollection`, `SetCollectionVisible`, `MoveCollection`.
- **Events out** (outbox, key = restaurant id): `kade.restaurant.events` ← `RestaurantCreated`,
  `RestaurantUpdated` (with `changed_fields`), `RestaurantAvailabilityChanged`,
  `RestaurantHoursChanged`; `kade.menu.events` ← `MenuUpdated` (whole menu, every structural
  change), `MenuItemAvailabilityChanged` (sold out / back). Snapshots carry no fee or distance.
- **Events in** (group `catalog`): `kade.merchant.events` `OutletStatusChanged` (busy, pause,
  suspension), `kade.review.events` `RestaurantRatingChanged`, `kade.promotion.events`
  `OfferActivated` / `OfferEnded`. Each change is re-published as a catalog event.
- **Calls**: `pricing.BatchQuoteDeliveryFees` (listings with `deliver_to`) and `pricing.ResolveZone`
  (new locations), 400 ms deadline, with a 10 s back-off after a failure. Without pricing, the
  stored fee (the customer mock's fee) and zone slug are used.
- **Ports:** gRPC 50101, HTTP 8101 (`/health/live`, `/health/ready`, `/metrics`).

## Behaviour gateways should know

- **Ids.** Seeded restaurant N (the apps' numeric id) is `00000000-0000-7000-8000-` + N padded to
  12 digits; recover N with `parseInt(id.slice(-12), 10)`. Every `restaurant_id`/`id` field also
  accepts the bare number (`"16"`, looked up by `legacy_id`). Menu items, sections, option groups,
  choices and collections use groups 8010–8014 (CONVENTIONS.md); closures use 8015. The app's item
  id `"1-0-0"` is `00000000-0000-7000-8010-000100000000`.
- **Money** is minor units (Rs 1,150 = `115000`). `image_id` is the Unsplash photo id the apps
  already use (`https://images.unsplash.com/photo-<id>?w=…`).
- **Ratings.** `rating_count` is an integer (`3000`); the app's `"3k+"` is
  `n >= 1000 ? floor(n/1000)+"k+" : floor(n/100)*100+"+"`.
- **Availability** is computed from the weekly hours and closures in Asia/Colombo at request time
  (open, `CLOSED` with `closed_label` "Opens at 8 am" / "Opens tomorrow at 11 am", `PAUSED` "Back at
  7:30 pm", `SUSPENDED`). Suspended restaurants are hidden from `ListRestaurants` (unless `ids` is
  given) and from the home feed. `DEMO_TIME=HH:MM` pins the time of day for demos.
- **Distance / fee.** Pass the customer's location as `deliver_to`. Seeded restaurants sit at the
  mock's distance from the Home address (42 Galle Rd, map pin 352,500 → `6.91007, 79.85168`), so a
  listing for Home shows the app's "1.2 km". Free-delivery restaurants (mock fee 0) have
  `free_delivery_offer`, so their fee is 0 whatever pricing quotes. Pickup → fee 0.
- **ETA** = stored window + busy minutes. **Order:** open first, then distance.
- **Pagination:** `page_size` default 50 (max 100); `next_page_token` is opaque.
- **ValidateCart** accepts option choices by id or by name (`"Sri Lankan hot"`) and groups by id or
  app slug (`"spice"`); unit price = item + paid choices; `choice_names` in menu order.
- **Sold out** set from the restaurant app resets by itself at the next opening (`sold_out_until`).
  Seeded sold-out items stay sold out until switched back on.
- **Auth:** calls without `x-user-id` are internal and trusted. Merchant staff/owners may edit only
  their `x-outlet-id`; ops/admin may edit any restaurant; merchandising and `CreateRestaurant` need
  ops/admin.

## Seed

On startup (`SEED_ON_START`, default true) the seeder applies `SEED_VERSION` once (marker in
`seed_runs`, advisory-locked): the customer mock's 13 categories (incl. `all`), 16 restaurants,
their menus (132 dishes; one template per category, as the mock's `buildMenu`), per-restaurant
option groups, Galle Road Kottu House's split hours and three Poya closures from the restaurant app,
zone slugs and cuisines from the admin mock, and the admin mock's five home collections. It writes
`RestaurantCreated`, `RestaurantHoursChanged` and `MenuUpdated` for every restaurant to the outbox
so search can build its index. Deleting seeded data in an app sticks across restarts.

## Run alone

```sh
pnpm infra:up
cp services/catalog/.env.example services/catalog/.env    # this laptop: Postgres on localhost:15432
pnpm --filter @kade/catalog dev
deploy/compose/connect/register-outbox.sh catalog catalog  # once, after the first start
```

## Test

```sh
pnpm --filter @kade/catalog test               # unit: hours, mapping, cart validation, seed, auth
pnpm --filter @kade/catalog test:integration   # shared stack: Postgres catalog + Kafka + Debezium
```

The integration suite boots the app in-process with `DEMO_TIME=13:00` and covers the seeded reads,
cart validation, menu editing with outbox rows, hours/closures, merchandising, errors with reasons,
outbox → Debezium → `kade.restaurant.events`, and the merchant pause event. Restaurants it creates
get random ids and are suspended at the end, so they never appear in the feed or in search.
