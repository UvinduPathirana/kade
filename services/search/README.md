# search

Dish and restaurant search for the customer app's search page (dishes and restaurants tabs), the
suggestions under the empty search box, and the address picker's place search. It is a CQRS
projection of catalog built with Postgres full-text search (`tsvector`) plus `pg_trgm` for typos;
no OpenSearch. Built from `services/_templates/ts`.

- **Owns** (`search` DB): `search_restaurants` (Restaurant snapshot, normalised search text,
  generated `simple` + `english` tsvectors, availability inputs, hours, closure dates, menu version),
  `search_dishes` (MenuItem snapshot, tsvectors, sold-out, menu order), `places`,
  `popular_searches`, and the platform tables (`processed_events`; `outbox` stays empty).
- **API** (`proto/kade/search/v1/search_service.proto`), all RPCs implemented: `Search`,
  `ListPopularSearches`, `SearchPlaces`, `ReverseGeocode`, `RebuildIndex`.
- **Events in** (group `search`): `kade.restaurant.events` (`RestaurantCreated`,
  `RestaurantUpdated`, `RestaurantAvailabilityChanged`, `RestaurantHoursChanged`) and
  `kade.menu.events` (`MenuUpdated`, `MenuItemAvailabilityChanged`). **Events out:** none.
- **Calls:** catalog only to backfill/rebuild (`CATALOG_GRPC`, never on the read path); pricing
  `BatchQuoteDeliveryFees` for result restaurants when `deliver_to` is given (`PRICING_GRPC`).
- **Ports:** gRPC 50102, HTTP 8102.

## How indexing works

1. Catalog writes snapshot events through its outbox; Debezium publishes them keyed by restaurant id.
2. `CatalogEventsConsumer` applies them in the runner's transaction (deduplicated on the event id in
   `processed_events`). Every write is an upsert guarded by the event's `occurred_at` (restaurant
   snapshot, availability and hours each separately) or by the menu version (dishes), so
   redeliveries, replays and a backfill racing the stream converge on the latest state.
3. `MenuUpdated` replaces a restaurant's dishes; `MenuItemAvailabilityChanged` flips one dish.
4. **Rebuild:** a new consumer group (or a wiped database) replays both topics from the earliest
   offset. Topics keep 7 days, so `RebuildIndex` (and an empty index at startup) also truncates the
   projection and backfills every restaurant's snapshot, hours and menu from catalog
   (`ListRestaurants` → `GetOpeningHours` + `GetMenu`), retrying while catalog is down.
   `RebuildIndex` returns at once with `started_at`; it needs ops/admin when called by a user.

## How a query runs

- The query is normalised like the app (lowercase, accents and apostrophes stripped) and split into
  words. **Every word must match** as a prefix (`kott` finds kottu) in either the `simple` vector or
  the stemmed `english` vector (`fish buns` finds "Fish bun"). Dishes match on name + description;
  restaurants on name + cuisine + category label + area.
- If full text finds nothing, `pg_trgm` word similarity (≥ 0.45) on names catches typos
  (`biriyani` → biryani).
- **Restaurants:** open first, then name matches, then feed order (seed order). Paged (`page_size`
  default 50).
- **Dishes:** name matches before description matches, available before sold out, open places
  first, then feed and menu order; `max_dishes` default 40 (max 100).
- Availability is recomputed at query time from the stored hours/closures (same rules as catalog;
  `DEMO_TIME` works here too), so "open now" is right without events. Suspended restaurants and
  their dishes are hidden. Sold-out resets at `sold_out_until`.
- Result restaurants have `distance_km` from `deliver_to`, today's `hours_label`, and
  `delivery_fee` from pricing; **`delivery_fee` is unset when there is no `deliver_to` or pricing is
  down** (gateways can fill it from `catalog.BatchGetRestaurants`).
- `SearchPlaces` scores like the app (name starts with, contains, then detail/area; at least two
  characters; default 6). `ReverseGeocode` returns the nearest in-zone place. Places come from the
  app's mock with pins converted by CONVENTIONS.md's map formula; `zone_id` uses the admin slugs.

## Run alone

```sh
pnpm infra:up
cp services/search/.env.example services/search/.env    # this laptop: Postgres on localhost:15432
pnpm --filter @kade/search dev
```

## Test

```sh
pnpm --filter @kade/search test               # unit: text, availability, ordering, places, consumer
pnpm --filter @kade/search test:integration   # shared stack + a running catalog on localhost:50101
```

The integration suite creates a restaurant and a dish through catalog's gRPC API, waits for them to
arrive via outbox → Debezium → Kafka → projection, follows a sold-out toggle and a suspension,
checks stale snapshots/menu versions are ignored, searches the seed (with a typo), runs
`RebuildIndex`, and covers places and suggestions.
