# cart

Each customer has one cart, stored in Redis. A cart holds dishes from one restaurant only, and
identical dishes merge into one line, as in `apps/customer/src/features/cart/store.ts`. Every add is
checked against catalog. `GetCartQuote` re-checks the whole cart, prices it with pricing, and checks
the promo code with promotion, so it is the checkout preview.

- **Owns:** Redis hash `cart:{customerId}` = `{ v: version, data: Cart JSON }`, expiring 7 days after the
  last write (`CART_TTL_SECONDS`). Writes are read → change → compare-and-set (a Lua script on `v`),
  retried with jitter, so two tabs never overwrite each other.
- **API:** `kade.cart.v1.CartService` ([proto](../../proto/kade/cart/v1/cart_service.proto)).
- **Events out / in:** none.
- **No Postgres or Kafka.** The template's DB, outbox, idempotency and consumer code is removed.
  Readiness checks Redis only. A catalog or pricing outage fails single RPCs, not the whole service.
- **Ports:** gRPC 50104, HTTP 8104 (`/health/live`, `/health/ready`, `/metrics`).
- **Depends on:** catalog `ValidateCart`, pricing `QuoteCart`, promotion `EvaluateRestaurantOffer` and
  `ValidatePromo`, and profile `GetPlusMembership` and `GetCreditAccount`. Each call gets a deadline of
  at most 2 s (`DOWNSTREAM_DEADLINE_MS`) and never more than the caller's own. It forwards `x-user-id`
  and `x-roles`, and retries once on UNAVAILABLE.

## Behaviour

- **Customer:** the cart belongs to `customer_id`, or to the caller (`x-user-id`) when that is empty.
  Customers can only use their own cart. `ops`, `support` and `admin` can use anyone's.
- **AddCartLine:**
  - Rejects dishes from another restaurant with `CART_OTHER_RESTAURANT`, before calling catalog. The
    error metadata carries `restaurant_id` and `restaurant_name` for the "Start a new order?" dialog.
  - With `replace_cart`, it starts over and drops the group id and promo code.
  - Validates the line with catalog, then stores catalog's name, unit price (item plus paid options)
    and choice names.
  - Quantity 0 counts as 1. The range is 1–99 per line, with at most 50 lines.
  - Accepts the apps' numeric restaurant ids (`3` → `00000000-0000-7000-8000-000000000003`).
  - Closed or paused restaurants still accept adds (customers can schedule). Not-found and suspended
    restaurants are rejected.
- **Line key:** `itemId|choiceId…|note`. Choices are sorted, so the order they were picked in doesn't
  matter, and the note is trimmed.
  - `UpdateCartLine` with quantity 0 removes the line.
  - Changing the note re-keys the line and merges it into an identical one if there is one.
  - `RemoveCartLine` on a missing line does nothing, so it is safe to retry.
- **ClearCart** keeps the mode, address, payment and tip. It drops the promo code and the schedule.
- **UpdateCheckoutOptions** replaces all options. It upper-cases the promo code. Tips must be Rs 0–5,000.
  A schedule must be in the future and at most 7 days ahead.
- **GetCartQuote** works like the checkout page:
  1. It runs catalog `ValidateCart` with mode, address and schedule. Lines with problems are returned
     in `lines` and left out of the totals.
  2. The restaurant offer comes from promotion `EvaluateRestaurantOffer`. If promotion is down or has
     no offer, the catalog snapshot (`discount_percent`, `free_delivery_offer`) is used instead.
  3. Plus and credit come from profile. If profile is down, the quote continues without Plus or credit.
  4. Pricing `QuoteCart` runs without the promo.
  5. If there is a code, promotion `ValidatePromo` checks it against that promo-free subtotal, saving
     and delivery fee.
  6. If the code is valid, pricing runs again with the promo.
  7. `credit_balance` is always returned. Credit is applied only when `use_credit` is on.
  8. An empty cart returns zero totals without calling catalog or pricing.

## Error reasons (for the gateway)

| Reason                                                                                                                                                                                         | Code                | Meaning                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `CART_OTHER_RESTAURANT`                                                                                                                                                                        | FAILED_PRECONDITION | Show "Start a new order?"; retry with `replace_cart`. Metadata: `restaurant_id`, `restaurant_name`. |
| `ITEM_NOT_FOUND`, `RESTAURANT_NOT_FOUND`, `CART_LINE_NOT_FOUND`                                                                                                                                | NOT_FOUND           |                                                                                                     |
| `ITEM_SOLD_OUT`, `RESTAURANT_UNAVAILABLE`, `CART_FULL`                                                                                                                                         | FAILED_PRECONDITION | Message from catalog when it gives one.                                                             |
| `OPTION_INVALID`, `REQUIRED_OPTION_MISSING`, `TOO_MANY_CHOICES`, `QUANTITY_INVALID`                                                                                                            | INVALID_ARGUMENT    | Line problems from catalog, or our own limits.                                                      |
| `RESTAURANT_REQUIRED`, `ITEM_REQUIRED`, `NOTE_TOO_LONG`, `MODE_INVALID`, `TIP_INVALID`, `SCHEDULE_IN_PAST`, `SCHEDULE_TOO_FAR`, `PROMO_CODE_INVALID`, `PAYMENT_INVALID`, `CUSTOMER_ID_INVALID` | INVALID_ARGUMENT    |                                                                                                     |
| `CATALOG_UNAVAILABLE`, `PRICING_UNAVAILABLE`                                                                                                                                                   | UNAVAILABLE         | "Try again in a moment". Metadata: `dependency`, `upstream_code`.                                   |
| `CART_STORE_UNAVAILABLE`                                                                                                                                                                       | UNAVAILABLE         | Redis down.                                                                                         |
| `CART_CONFLICT`                                                                                                                                                                                | ABORTED             | Lost 10 compare-and-set races in a row; retry.                                                      |
| `CART_NOT_YOURS`                                                                                                                                                                               | PERMISSION_DENIED   | Another customer's cart.                                                                            |
| `UNAUTHENTICATED`                                                                                                                                                                              | UNAUTHENTICATED     | No `customer_id` and no `x-user-id`.                                                                |

`GetCartQuote` never fails on a bad promo. It returns
`promo { ok: false, error_reason, error_message }` instead. `error_reason` is promotion's rejection
without the enum prefix (`PROMO_MIN_SUBTOTAL`, `PROMO_NOT_FOUND`, …), or `PROMOTION_UNAVAILABLE`.

## Run alone

```sh
pnpm infra:up
cp services/cart/.env.example services/cart/.env
pnpm --filter @kade/cart dev
```

Docker: `docker build -f services/cart/Dockerfile -t kade/cart:dev .`. The fragment is
`services/cart/compose.yaml` (profile `ordering`, depends on Redis only).

## Test

```sh
pnpm --filter @kade/cart test               # unit: cart rules, handlers with fake catalog/pricing/promotion/profile
pnpm --filter @kade/cart test:integration   # shared Redis + in-process fake catalog/pricing gRPC servers
```
