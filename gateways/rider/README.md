# gateway-rider (`@kade/gateway-rider`)

Backend-for-frontend for the rider app (`apps/rider`, http://localhost:5176). HTTP **8203**, Compose
profile `fulfilment`. Built from `gateways/_template` (Fastify 5 + TypeBox, Keycloak JWT, gRPC
upstreams with deadlines, problem+json, OpenAPI); see that README for the platform pieces.

It serves exactly the shapes in `apps/rider/src/api/types.ts`. All mapping happens here: Money →
whole rupees, Timestamps → epoch ms, enums → the app's words, and WGS84 ↔ the app's illustrated
400 × 600 Colombo map (`src/map.ts`, one linear projection: y 0 → 6.920° N, y 600 → 6.845° N,
x 0 → 79.836° E, 0.0000915° per unit).

## Identity and the rider

- Tokens: Keycloak realm `kade`, client `rider-app`, role `rider`. Dev bypass: `Bearer dev:<user>:rider`.
- `rider_id` is not the Keycloak sub. Every rider route resolves it with
  `dispatch.RiderService/GetMyRider` (by `x-user-id`, cached 10 min), then `RIDER_IDS`
  (`nimal=<riderId>`, username or user id), then `DEFAULT_RIDER_ID` (dev only, Nimal
  `…-8001-000000000101`).

## Routes (→ app function → upstream)

| Route                                                                                                        | App (`src/api`)                                                  | Upstream                                                                                              |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST /v1/availability` `{online, position}`                                                                 | `dispatch.setAvailability` (dispatch loop, on go online/offline) | dispatch `DispatchService.SetAvailability`                                                            |
| `GET /v1/offer` (200 or 204)                                                                                 | `dispatch.requestOffer` (polled every 3 s while online)          | `GetCurrentOffer`                                                                                     |
| `GET /v1/job`                                                                                                | — (resync)                                                       | `GetActiveJob`                                                                                        |
| `POST /v1/offers/:id/accept`                                                                                 | `dispatch.acceptOffer` → job (id = delivery id)                  | `AcceptOffer`                                                                                         |
| `POST /v1/offers/:id/decline` `{reason}`                                                                     | `dispatch.declineOffer`                                          | `DeclineOffer`                                                                                        |
| `POST /v1/jobs/:id/arrived-restaurant`                                                                       | `dispatch.arriveAtRestaurant`                                    | `ArriveAtRestaurant`                                                                                  |
| `POST /v1/jobs/:id/not-ready`                                                                                | `dispatch.reportNotReady`                                        | `ReportFoodNotReady`                                                                                  |
| `POST /v1/jobs/:id/picked-up` `{checkedItems, sealed}`                                                       | `dispatch.confirmPickup`                                         | `ConfirmPickup`                                                                                       |
| `POST /v1/jobs/:id/arrived-customer`                                                                         | `dispatch.arriveAtCustomer`                                      | `ArriveAtCustomer`                                                                                    |
| `POST /v1/jobs/:id/complete` `{proof, code?, fileName?, cashCollected}`                                      | `dispatch.completeDelivery` → Trip                               | `CompleteDelivery`                                                                                    |
| `POST /v1/jobs/:id/messages`                                                                                 | `support.messageCustomer`                                        | `SendCustomerMessage`                                                                                 |
| `POST /v1/location` `{fixes:[{lat,lng}\|{point}]}`                                                           | `dispatch.reportLocation` (every 5 s while online)               | location `StreamRiderLocations` (one client stream per rider; dropped quietly while location is down) |
| `GET /v1/profile`, `GET /v1/documents`                                                                       | `rider.getProfile` / `listDocuments`                             | `RiderService.GetRiderProfile` / `ListRiderDocuments`                                                 |
| `GET /v1/trips`, `GET /v1/trips/:id`                                                                         | `rider.listTrips` / `getTrip`                                    | `ListTrips` / `GetTrip`                                                                               |
| `POST /v1/trips/:id/feedback`                                                                                | `dispatch.rateTrip`                                              | review `SubmitTripFeedback`                                                                           |
| `GET /v1/ratings`                                                                                            | `rider.getRatings`                                               | review `GetRiderRatingsSummary`                                                                       |
| `GET /v1/earnings?period`, `GET /v1/earnings/today`                                                          | `payouts.getEarnings` / `getTodaySummary`                        | ledger `RiderFinanceService.GetRiderEarnings`                                                         |
| `GET /v1/cash`, `GET /v1/payouts`                                                                            | `payouts.getCashBalance` / `listPayouts`                         | `GetRiderCashBalance` / `ListRiderPayouts`                                                            |
| `GET /v1/quests`                                                                                             | `payouts.getQuests`                                              | dispatch `ListQuests`                                                                                 |
| `GET /v1/support/help-topics`, `POST /v1/support/messages`                                                   | `support.listHelpTopics` / `sendSupportMessage`                  | support `ListHelpTopics`; `GetOrStartConversation` + `SendMessage`, waits ≤ 6 s for a reply           |
| `POST /v1/applications`, `GET /v1/applications/status?phone`, `POST /v1/applications/:id/documents` (public) | `onboarding.*`                                                   | `RiderService.SubmitRiderApplication` / `GetRiderApplicationStatus` / `ResubmitRiderDocument`         |
| `GET /ws`                                                                                                    | `useRealtimeNudge` (offer pushes → poll now)                     | proxied to realtime `:8112/ws`, auto-subscribed to `rider:<riderId>`                                  |

`openapi.json` is generated: `pnpm --filter @kade/gateway-rider openapi`.

## Run

```sh
cp gateways/rider/.env.example gateways/rider/.env
pnpm --filter @kade/gateway-rider dev                        # http://localhost:8203
TOKEN=$(curl -s -d grant_type=password -d client_id=rider-app -d username=nimal -d password=kade123 \
  http://localhost:8080/realms/kade/protocol/openid-connect/token | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" localhost:8203/v1/profile
```

## Test

```sh
pnpm --filter @kade/gateway-rider test
```
