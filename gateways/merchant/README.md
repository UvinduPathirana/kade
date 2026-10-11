# gateway-merchant (`@kade/gateway-merchant`)

Backend-for-frontend for the restaurant app (`apps/restaurant`, http://localhost:5175). HTTP **8202**,
Compose profile `fulfilment`. Built from `gateways/_template` (Fastify 5 + TypeBox, Keycloak JWT,
gRPC upstreams with deadlines, problem+json, OpenAPI); see that README for the platform pieces.

It serves exactly the shapes in `apps/restaurant/src/api/types.ts`, so the app's screens are the
same in mock and live mode. All mapping happens here: Money minor units → whole rupees, Timestamps →
epoch ms, enums → the app's words (`TICKET_STATUS_PICKED_UP` → `"pickedUp"`), short ticket numbers
↔ order ids.

## Identity and the outlet

- Tokens: Keycloak realm `kade`, client `merchant-app` (`KEYCLOAK_CLIENTS`), roles `merchant_staff` /
  `merchant_owner`. Dev bypass: `Bearer dev:<user>:<roles>[:<outletId>]`.
- Every staff route acts for the caller's outlet, sent upstream as `x-outlet-id` (with `x-user-id`,
  `x-roles`). Resolution order: the token's `outlet_id` claim → `merchant.OutletStaffService/GetMyOutlets`
  (cached 5 min) → `STAFF_OUTLETS` (`ruwan=<outletId>,…`, username or user id) → `DEFAULT_OUTLET_ID`
  (dev only). Env answers are cached 30 s so merchant wins as soon as it answers.
- Owner-only: sales, statements, inviting / re-roling / removing staff.

## Routes (→ app function → upstream)

| Route                                                                               | App (`src/api`)                                              | Upstream                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `GET /v1/tickets`                                                                   | `orders.listTickets` (polled 1 s; also the tablet heartbeat) | merchant `KitchenService.ListTickets` (+ `OutletService.ReportTabletHeartbeat` every 30 s) |
| `GET /v1/tickets/:id`                                                               | `orders.getTicket` (404 → `null`)                            | `KitchenService.GetTicket`                                                                 |
| `POST /v1/tickets/:id/accept` `{prepMinutes}`                                       | `orders.acceptTicket`                                        | `KitchenService.AcceptOrder`                                                               |
| `POST /v1/tickets/:id/reject` `{reason, note}`                                      | `orders.rejectTicket`                                        | `KitchenService.RejectOrder`                                                               |
| `POST /v1/tickets/:id/ready`                                                        | `orders.markReady`                                           | `KitchenService.MarkOrderReady`                                                            |
| `POST /v1/tickets/:id/handover`                                                     | `orders.handOver`                                            | `KitchenService.HandOverOrder`                                                             |
| `GET /v1/menu`                                                                      | `menu.getMenu`                                               | catalog `CatalogService.GetMenu`                                                           |
| `PUT /v1/menu/items/:id/sold-out`                                                   | `menu.setSoldOut`                                            | `MenuManagementService.SetMenuItemSoldOut`                                                 |
| `POST /v1/menu/items`                                                               | `menu.saveItem` (create without id, else update)             | `MenuManagementService.SaveMenuItem`                                                       |
| `DELETE /v1/menu/items/:id`                                                         | `menu.deleteItem`                                            | `MenuManagementService.DeleteMenuItem`                                                     |
| `POST /v1/menu/sections` / `…/:id/move`                                             | `menu.addSection` / `menu.moveSection`                       | `CreateMenuSection` / `MoveMenuSection`                                                    |
| `GET /v1/outlet`                                                                    | `outlet.getOutlet`                                           | merchant `GetOutlet` + catalog `GetOpeningHours` + `GetRestaurant` (details)               |
| `PUT /v1/outlet/busy` `{busyExtra}`                                                 | `outlet.setBusy`                                             | `OutletService.SetBusyMode`                                                                |
| `PUT /v1/outlet/pause` `{until\|null}`                                              | `outlet.setPause`                                            | `PauseOutlet` / `ResumeOutlet`                                                             |
| `PUT /v1/outlet/hours`                                                              | `outlet.saveHours`                                           | catalog `SetOpeningHours`                                                                  |
| `POST /v1/outlet/closures`, `DELETE …/:id`                                          | `outlet.addClosure` / `removeClosure`                        | catalog `AddClosure` / `RemoveClosure`                                                     |
| `PUT /v1/outlet/details`                                                            | `outlet.saveDetails`                                         | catalog `UpdateRestaurantDetails`                                                          |
| `GET /v1/offers`, `POST /v1/offers`, `POST /v1/offers/:id/end`                      | `promotions.*`                                               | promotion `OfferService`                                                                   |
| `GET /v1/sales?from&to`                                                             | `payouts.getSales`                                           | ledger `RestaurantFinanceService.GetOutletSales`                                           |
| `GET /v1/statements`, `GET /v1/statements/:id/csv`                                  | `payouts.listStatements` / `statementCsv`                    | `ListOutletStatements` / `ExportOutletStatementCsv`                                        |
| `GET /v1/reviews`, `PUT /v1/reviews/:id/reply`                                      | `reviews.*`                                                  | review `ListRestaurantReviews` / `ReplyToReview`                                           |
| `GET /v1/staff`, `POST /v1/staff`, `PUT /v1/staff/:id/role`, `DELETE /v1/staff/:id` | `partner.*Staff`, `changeRole`                               | merchant `OutletStaffService`                                                              |
| `GET /v1/settings`, `PUT /v1/settings`, `POST /v1/settings/print-test`              | `partner.getSettings` / `saveSettings` / `printTestTicket`   | merchant `OutletService`                                                                   |
| `POST /v1/applications` (public)                                                    | `partner.submitApplication`                                  | merchant `PartnerApplicationService.SubmitApplication`                                     |
| `GET /v1/me`                                                                        | — (who am I, which outlet)                                   | `GetMyOutlets`                                                                             |
| `GET /ws`                                                                           | —                                                            | proxied to realtime `:8112/ws`, auto-subscribed to `outlet:<id>`                           |

`openapi.json` is generated: `pnpm --filter @kade/gateway-merchant openapi`.

## WebSocket

First message `{"type":"auth","token":"…"}`. The gateway validates it, resolves the outlet and opens
`REALTIME_WS_URL` with `x-user-id` / `x-roles` / `x-outlet-id`, subscribes `outlet:<id>` and relays
realtime's proto3-JSON frames as they are. Without realtime the socket answers
`{"type":"ready","realtime":false}` and `ping`/`pong`; the app keeps polling either way.

## Run

```sh
cp gateways/merchant/.env.example gateways/merchant/.env    # host ports, merchant-app, dev fallbacks
pnpm --filter @kade/gateway-merchant dev                     # http://localhost:8202
TOKEN=$(curl -s -d grant_type=password -d client_id=merchant-app -d username=ruwan -d password=kade123 \
  http://localhost:8080/realms/kade/protocol/openid-connect/token | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" localhost:8202/v1/tickets
```

Docker: `docker compose -f deploy/compose/compose.yaml --profile fulfilment up -d --build gateway-merchant`
(once the fragment is included in `deploy/compose/services.yaml`).

## Test

```sh
pnpm --filter @kade/gateway-merchant test   # routes via inject/injectWS against fake gRPC clients
```
