# Customer gateway (`@kade/gateway-customer`, HTTP 8201)

Backend-for-frontend for `apps/customer`. It serves REST/JSON in **exactly the shapes of
`apps/customer/src/api/types.ts`**, so the app's components work unchanged on live data. Every bit of
mapping happens here:

- **ids:** seeded restaurant UUIDs map to the app's numbers (see `src/mappers/ids.ts`). Orders use
  their number (`KD-4821`) as `id`; the UUID is `ref`.
- **money:** minor units become whole rupees.
- **enums:** status, modes and payment kinds become the app's strings.
- **maps:** WGS84 points become illustrated-map pins, via the linear fit in `src/mappers/geo.ts`.
- **joins:** ratings (review) and reported issues (support) are joined onto orders, and "ordered
  before" (order) onto restaurant cards.
- **ops-only fields are stripped:** notes, real phone numbers and customer contact.

It is built from the gateway template: Fastify 5, TypeBox, jose, `@fastify/swagger`. See
`gateways/_template/README.md` for the design (auth modes, problem+json, idempotency). The OpenAPI
document is `openapi.json`, also served at `GET /openapi.json`.

## Endpoints → app functions

| Route                                                                                           | Auth                | Upstream                                                       | App function (`apps/customer/src/api`)          |
| ----------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| `GET /v1/categories`, `GET /v1/categories/:id`                                                  | public              | catalog                                                        | `listCategories`, `getCategory`                 |
| `GET /v1/restaurants?x&y`                                                                       | optional            | catalog (+ order for `orderedBefore`)                          | `listRestaurants`                               |
| `GET /v1/restaurants/:id`                                                                       | optional            | catalog (+ order)                                              | `getRestaurant`                                 |
| `GET /v1/restaurants/:id/menu`                                                                  | public              | catalog                                                        | `getMenu`                                       |
| `GET /v1/restaurants/:id/reviews`                                                               | public              | review                                                         | `listReviews`                                   |
| `GET /v1/search?q&x&y`, `GET /v1/search/popular`                                                | public              | search                                                         | `search`, `listPopularSearches`                 |
| `GET /v1/places?q`                                                                              | public              | search                                                         | `searchPlaces`                                  |
| `GET /v1/promos`                                                                                | optional            | promotion                                                      | `listPromos`                                    |
| `POST /v1/promos/validate`                                                                      | optional            | promotion                                                      | `checkPromo` (checkout)                         |
| `GET /v1/me`                                                                                    | required            | profile `EnsureCustomer`                                       | sign-in callback (`getMe`)                      |
| `PUT /v1/me`                                                                                    | required            | profile                                                        | `saveProfile`                                   |
| `GET/PUT/DELETE /v1/me/addresses[/:id]`                                                         | required            | profile                                                        | `listAddresses`, `saveAddress`, `removeAddress` |
| `POST /v1/waitlist`                                                                             | optional            | profile                                                        | `joinWaitlist`                                  |
| `GET/PUT/DELETE /v1/me/favourites[/:restaurantId]`                                              | required            | profile                                                        | (not used by the app yet)                       |
| `GET /v1/me/cards`, `POST /v1/me/cards/session`, `POST /v1/me/cards`, `DELETE /v1/me/cards/:id` | required            | payment                                                        | `listCards`, `addCard`, `removeCard`            |
| `GET /v1/me/credit`                                                                             | required            | profile                                                        | `getCredit`                                     |
| `GET/POST/DELETE /v1/me/plus`                                                                   | required            | profile                                                        | `getPlus`, `joinPlus`, `cancelPlus`             |
| `GET/POST /v1/me/gift-cards`, `GET /v1/me/referral`                                             | required            | promotion                                                      | `listGiftCards`, `buyGiftCard`, `getReferral`   |
| `GET/PUT /v1/cart`                                                                              | required            | cart                                                           | cart sync (`live/cartSync.ts`)                  |
| `POST /v1/orders`                                                                               | required            | order `PlaceOrder` (+ catalog menu, payment cards, cart clear) | `placeOrder`                                    |
| `GET /v1/orders`, `GET /v1/orders/active`, `GET /v1/orders/:id`                                 | required            | order + review + support                                       | `listOrders`, `getActiveOrder`, `getOrder`      |
| `POST /v1/orders/:id/cancel`, `/collected`; `PUT /v1/orders/:id/tip`                            | required            | order                                                          | `cancelOrder`, `markCollected`, `updateTip`     |
| `POST /v1/orders/:id/rating`                                                                    | required            | review                                                         | `rateOrder`                                     |
| `POST /v1/orders/:id/issues/preview`, `POST /v1/orders/:id/issues`                              | required            | support                                                        | `reportIssue`                                   |
| `POST /v1/groups`, `GET /v1/groups/:id`                                                         | required / optional | order                                                          | `createGroup`, `getGroup`                       |
| `GET /v1/support/conversation`, `GET/POST /v1/support/conversation/:ticketId/messages`          | required            | support                                                        | `sendMessage`                                   |
| `GET /ws`                                                                                       | first message       | realtime (proxy)                                               | `live/realtime.ts`                              |

Notes:

- **Any Keycloak user is a customer.** Every authenticated request runs profile `EnsureCustomer`,
  cached for 10 minutes per user (30 s after a failure). `GET /v1/me` always upserts it. If profile
  is down, `/v1/me` answers from the token's claims, so sign-in still works.
- **Checkout.** The app sends its cart lines with option _names_. The gateway resolves them to
  `(option_group_id, choice_id)` against catalog's menu, and fails with `OPTION_INVALID` when a name is
  gone. A card payment's `brand + last4` resolves to the saved card id. `PlaceOrder` gets a 15 s
  deadline (`PLACE_ORDER_DEADLINE_MS`) because the saga runs synchronously.
- **Order history** hides `PENDING` and `FAILED` orders: those checkouts never went through.

## Live order status

- **Polling:** `GET /v1/orders/:id` (the app polls every 4 s while an order is live) and
  `GET /v1/orders/active`.
- **WebSocket `/ws`:**
  - The client sends `{"type":"auth","token":"…"}` first.
  - The gateway validates the token and connects **lazily** to `REALTIME_WS_URL` with `x-user-id` and
    `x-roles` headers. It then pipes proto3-JSON `ClientFrame`/`ServerFrame` both ways (for example
    `{"subscribe":{"channels":["order:<ref>"]}}`).
  - The gateway answers `{"type":"ping"}` itself with a pong.
  - If realtime is down, the client still gets `{"type":"ready","realtime":false}` and keeps polling.
  - If realtime drops mid-session, the socket closes with `1013` and the client reconnects with backoff.

## Run

```sh
pnpm infra:up                                   # shared stack (Keycloak on :8080)
cp gateways/customer/.env.example gateways/customer/.env
pnpm --filter @kade/proto build
pnpm --filter @kade/gateway-customer dev         # :8201; upstreams on localhost:501xx

TOKEN=$(curl -s -d grant_type=password -d client_id=customer-app -d username=dilini -d password=kade123 \
  http://localhost:8080/realms/kade/protocol/openid-connect/token | jq -r .access_token)
curl -s localhost:8201/v1/orders -H "Authorization: Bearer $TOKEN"
curl -s localhost:8201/v1/orders -H 'Authorization: Bearer dev:00000000-0000-7000-8005-000000000001:customer'
```

A missing upstream only affects its own routes, which answer `503` problem+json.

Docker: `docker compose -f deploy/compose/compose.yaml --profile ordering up -d --build gateway-customer`.

## Test

```sh
pnpm --filter @kade/gateway-customer test      # routes via inject/injectWS with fake gRPC clients; mappers
pnpm --filter @kade/gateway-customer openapi   # regenerate openapi.json after changing routes
```
