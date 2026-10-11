# pricing

Pricing is a pure calculation service over versioned rule tables. It holds no orders and publishes
no events. `QuoteCart` is **the** price calculation. Cart (checkout preview), order (saga) and catalog
(delivery fee on listings) all call it, so the total a customer sees is the total they're charged.

- **Owns:** `zones`, `surcharge_rules` and `pricing_settings` (one row: the heavy-rain toggle, the Plus
  free-delivery threshold and `rules_version`). Postgres database `pricing`, login `pricing`.
- **API:** `kade.pricing.v1.PricingService` ([proto](../../proto/kade/pricing/v1/pricing_service.proto)).
- **Events out / in:** none. The template's `outbox`, `processed_events` and `idempotency_keys` tables
  exist but stay unused. Kafka isn't wired in, and readiness checks Postgres only.
- **Ports:** gRPC 50105, HTTP 8105 (`/health/live`, `/health/ready`, `/metrics`).

## The formula

`src/pricing/totals.ts` is a line-for-line port of `apps/customer/src/features/cart/totals.ts`, in
minor units. Keep the two in step. `totals.test.ts` embeds the app's function verbatim as an oracle
and compares against it on table cases plus 5,000 random carts.

```
subtotal      = Σ unit_price × qty
saving        = offer_saving set ? min(offer_saving, subtotal) : round(subtotal × percent / 100) to whole rupees
plus_waives   = plus_active && subtotal ≥ Rs 1,500
delivery_fee  = delivery && count > 0 && !plus_waives && !free_delivery_offer ? zone fee : 0
small_order   = count > 0 && subtotal < zone.small_order_under ? zone.small_order_fee : 0   (Rs 60 under Rs 500)
promo         = min(promo_discount, subtotal − saving)
tip           = delivery ? max(0, tip) : 0
credit        = min(max(0, credit_available), subtotal − saving − promo + delivery_fee + small_order + tip)
total         = … − credit
```

**Zone fee** (a port of `quoteDelivery` in `apps/admin/src/api/pricing.ts`):
`base + round(max(0, km − 2) × per_km) + active surcharges + heavy rain`. `km` is the straight-line
distance from restaurant to address, rounded to 0.1 km. Surcharge windows are evaluated in
Asia/Colombo (UTC+05:30). A window that passes midnight (`23:00`–`02:00`) wraps, and its early-morning
part belongs to the previous day's rule.

**Which zone:**

- Delivery uses the zone of the delivery address.
- If no address is known yet, delivery uses the restaurant's zone at 0 km.
- An address outside every open zone gives `out_of_zone = true` and a delivery fee of 0. Callers must
  block checkout.
- Pickup uses the restaurant's zone for the small-order fee. When no zone applies, it falls back to
  Rs 60 under Rs 500.

**Zones** are identified by the ops console slugs `c01`…`c15`, `deh`, `raj`, `nug` and `mtl`
(CONVENTIONS). Each zone is stored as a centre plus a 3 km radius, and a point belongs to the
nearest centre within its radius. `ResolveZone` is the source of truth, and `Zone.boundary` is a
16-point ring for maps.

**Seed data** (`drizzle/0001_seed.sql`) copies the ops console mock data (19 zones, with Mount Lavinia
closed, the four surcharge rules and rain at Rs 50 off), with one exception. The small-order fee is
Rs 60 under Rs 500 in every zone, matching the customer app. The admin mock says Rs 80.

## RPCs

| RPC                                                                                                    | Notes                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QuoteCart`                                                                                            | Pure; safe to retry. Returns totals, fee breakdown, waiver (`NONE`/`PLUS`/`OFFER`/`PICKUP`), `out_of_zone`, `rules_version`, `quote_id` (sha256 of inputs + version). |
| `QuoteDeliveryFee`                                                                                     | Admin preview (`zone_id` + `distance_km` + `subtotal`) or by location.                                                                                                |
| `BatchQuoteDeliveryFees`                                                                               | Up to 500 restaurants to one point (catalog listings). Waivers are not applied.                                                                                       |
| `ResolveZone`                                                                                          | `in_zone` is false for a closed zone, but the zone is still returned.                                                                                                 |
| `GetPricingConfig`, `ListZones`                                                                        | Reads.                                                                                                                                                                |
| `SetZoneOpen`, `UpdateZoneFees`, `SaveSurchargeRule`, `SetSurchargeRuleEnabled`, `SetWeatherSurcharge` | Need role `ops` or `admin` (`x-roles`). Each bumps `rules_version`.                                                                                                   |

Reads use an in-process cache (`RULES_CACHE_MS`, default 2 s). Writes invalidate it on the replica
that made them.

## Error reasons

| Reason                                                                                                                                                            | Code                | When                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------- |
| `MODE_REQUIRED`, `DISCOUNT_PERCENT_INVALID`, `LINE_INVALID`, `LOCATION_REQUIRED`, `CURRENCY_UNSUPPORTED`, `AMOUNT_INVALID`, `DISTANCE_INVALID`, `BATCH_TOO_LARGE` | INVALID_ARGUMENT    | bad quote input                                   |
| `OUT_OF_ZONE`                                                                                                                                                     | FAILED_PRECONDITION | `QuoteDeliveryFee` by location outside open zones |
| `ZONE_NOT_FOUND`, `SURCHARGE_RULE_NOT_FOUND`                                                                                                                      | NOT_FOUND           |                                                   |
| `ZONE_FEES_INVALID`                                                                                                                                               | INVALID_ARGUMENT    | "Fees must be between Rs 0 and Rs 5,000."         |
| `SURCHARGE_LABEL_REQUIRED`, `SURCHARGE_AMOUNT_INVALID`, `SURCHARGE_DAYS_INVALID`, `SURCHARGE_TIME_INVALID`, `SURCHARGE_RULE_REQUIRED`                             | INVALID_ARGUMENT    | console copy in the message                       |
| `WEATHER_AMOUNT_INVALID`                                                                                                                                          | INVALID_ARGUMENT    | "Rain surcharge must be between Rs 1 and Rs 500." |
| `PERMISSION_DENIED`                                                                                                                                               | PERMISSION_DENIED   | admin RPC without `ops`/`admin`                   |

## Run alone

```sh
pnpm infra:up
cp services/pricing/.env.example services/pricing/.env
pnpm --filter @kade/pricing dev
```

Docker: `docker build -f services/pricing/Dockerfile -t kade/pricing:dev .`. The fragment is
`services/pricing/compose.yaml` (profile `ordering`, depends on Postgres only).

## Test

```sh
pnpm --filter @kade/pricing test               # unit: formula parity, surcharges, geo, quotes, handlers
pnpm --filter @kade/pricing test:integration   # shared Postgres (localhost:15432); restores every rule it changes
```
