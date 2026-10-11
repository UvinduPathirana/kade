# dispatch

The rider fleet and deliveries (Go). Dispatch owns:

- Riders: profiles, vehicles, documents, onboarding, zones, suspension, online state.
- Matching of accepted orders to riders, using Redis GEO.
- One offer at a time, with a 30-second timeout.
- Assignment and every pickup and drop-off step.
- Proof of delivery, and the cash collected at the door.

|            |                                                                                      |
| ---------- | ------------------------------------------------------------------------------------ |
| Module     | `github.com/UvinduPathirana/kade/services/dispatch` (Go 1.25)                        |
| Ports      | gRPC `50110`, HTTP `8110` (`/health/live`, `/health/ready`, `/metrics`)              |
| Database   | `dispatch`: `riders`, `rider_applications`, `deliveries`, `offers`, `customer_messages`, `outbox`, `processed_events`, `idempotency_keys` |
| Events out | outbox → `kade.delivery.events` (aggregatetype `delivery`), `kade.rider.events` (`rider`) |
| Events in  | `kade.order.events`, `kade.ledger.events`, `kade.review.events` (group `dispatch`); `kade.rider.locations` (group `dispatch-locations`) |
| Profile    | `fulfilment`; memory limit 96 MB (about 20 MB in use)                                |

Register the outbox connector once, after the first start:

```bash
deploy/compose/connect/register-outbox.sh dispatch dispatch
```

## APIs

Rider-app RPCs take a `rider_id`. If it is empty, dispatch uses the caller's rider (`x-user-id` = Keycloak sub). A caller with only the `rider` role may act only for themselves (`RIDER_MISMATCH`). Admin RPCs need `ops`, `admin`, `support` or `finance` (`STAFF_ONLY`); internal calls without identity are allowed.

**`DispatchService`**: the rider app.

| RPC | Notes |
| --- | --- |
| `SetAvailability` | Going online needs `position` (falls back to the last known position, then the home zone). The rider joins the GEO index. Going offline withdraws an open offer and is rejected with `RIDER_ON_JOB` during a job. Returns `cash_allowed`. Suspended riders can't go online (`RIDER_SUSPENDED`). |
| `GetCurrentOffer` | Open offer, or unset. This is the polling fallback; the push is `DeliveryOfferSent` → realtime. |
| `AcceptOffer` | `OFFER_EXPIRED` if the offer timed out, was declined or withdrawn, or the job has gone. Idempotent with `idempotency_key`. |
| `DeclineOffer` | Takes a reason. The job is offered to the next rider at once. |
| `GetActiveJob` | The rider's ASSIGNED, AT_RESTAURANT, PICKED_UP or AT_CUSTOMER delivery. |
| `ArriveAtRestaurant` | Sets ASSIGNED → AT_RESTAURANT. Repeating it is a no-op. |
| `ReportFoodNotReady` | Returns `ready_at`: now if the kitchen marked the order ready, else its `ready_by`, else now + 3 min. |
| `ConfirmPickup` | Every item id ticked, or `sealed`; otherwise `ITEMS_NOT_CHECKED`. Sets → PICKED_UP. |
| `ArriveAtCustomer` | Sets PICKED_UP → AT_CUSTOMER. Fails with `DELIVERY_NOT_PICKED_UP` before pickup. |
| `CompleteDelivery` | Code proof is checked against the order's `delivery_code` (`DELIVERY_CODE_MISMATCH`); photo proof needs `photo_ref` (`PHOTO_REQUIRED`). Cash orders need `cash_collected ≥ cash_to_collect` (`CASH_SHORT`); change is fine. Returns the `Trip`. The rider goes back ONLINE at the drop-off point. |
| `SendCustomerMessage` | Stored, then sent through `notification.SendNotification` (template `rider_message`) when `NOTIFICATION_GRPC` is set. |
| `ListTrips`, `GetTrip` | Delivered jobs, newest first, with `from`/`to` and paging. |
| `ListQuests` | 12 trips today (Rs 800), lunch rush (4 trips 12–2 pm, Rs 240), weekly streak (70 trips, Rs 2,500), counted from real trips. |

**`DispatchOpsService`**: the admin console.

| RPC | Notes |
| --- | --- |
| `GetLiveSnapshot` | In progress, waiting for a rider, late, riders online and needed, orders by hour (today and the same day last week), average delivery time, map dots and zone load. Attention items cover unmatched deliveries, late orders, riders over their cash limit and zones short of riders. |
| `ListNearbyRiders` | Available riders within 15 km of the order's restaurant, nearest first. |
| `ReassignRider` | With `rider_id`: assigns that rider directly (`reassigned=true`; the new rider collects the food again). Without one: the job goes back to matching. The old rider gets `RiderUnassigned` and goes back ONLINE. |
| `GetDelivery` | By delivery or order id, with its offer history. Not staff-only, so the customer gateway can use it for tracking. |

**`RiderService`**:

| RPC | Notes |
| --- | --- |
| `GetMyRider` | Looks up the rider by `x-user-id`. `RIDER_NOT_FOUND` if the user has no rider record. |
| `GetRiderProfile`, `ListRiderDocuments` | Return the bank account as last4 only. |
| `SubmitRiderApplication` | The caller's `x-user-id`, if any, becomes the rider's `user_id` on approval. The full account number is stored apart and never returned. |
| `GetRiderApplicationStatus` | By `phone` (digits only), or by the caller. `needs_fix` is the rejected document. |
| `ResubmitRiderDocument` | Puts the application back to PENDING. |
| `ListRiders` | Filters: status, zone, query (name, phone, id), over the cash limit. |
| `GetRider`, `ListRiderApplications` | |
| `ReviewRiderDocument` | Rejecting a document asks the applicant for changes. |
| `DecideRiderApplication` | Approval fails with `DOCUMENTS_NOT_APPROVED` until every document is approved. Approval creates an OFFLINE rider. |
| `SetRiderZones` | Fails with `ZONES_REQUIRED` or `ZONE_UNKNOWN`. |
| `SetRiderSuspended` | Withdraws an open offer and removes the rider from the GEO index. Unsuspending sets OFFLINE. |

## Matching (`internal/dispatch/matcher.go`)

1. **Trigger.** `OrderAccepted` (delivery mode, at most `MAX_EVENT_AGE` old) creates a MATCHING delivery and publishes `DeliveryRequested`. Then it wakes the matcher, which otherwise ticks every second.
2. **Candidates.** GEOSEARCH `dispatch:riders:available:colombo` around the restaurant in rings of 3, 6 and 12 km (`MATCH_RADII_KM`), nearest first.
3. **Postgres has the final say.** The rider must:
   - still be ONLINE;
   - have no other open offer;
   - not have had this job in the last `REOFFER_AFTER` (2 min);
   - be allowed cash orders, if this is a cash order (from ledger `RiderCashBalanceChanged.over_limit`);
   - have a position fresher than `RIDER_STALE_AFTER` (simulated riders are exempt).
4. **Ranking.** Riders with a login (real people, such as Nimal) come first (`PREFER_REAL_RIDERS`), then the nearest.
5. **Offer.** The offer is priced for that rider and lasts 30 s (`OFFER_TIMEOUT`). It publishes `DeliveryOfferSent`. Pay is Rs 180 base, plus about Rs 50 per km (pickup and trip legs, rounded to Rs 10), plus the card tip, plus a Rs 50 lunch or dinner peak boost.
6. **Expiry.** The expiry sweep runs every tick. It sets the offer to EXPIRED and publishes `DeliveryOfferExpired`, and the job is offered to the next rider at once. A decline does the same.
7. **No candidate.** Retries back off at 5 s, 10 s, 20 s, then every 30 s. After `MATCH_FAIL_AFTER` rounds (12) the delivery becomes UNMATCHED, `DeliveryMatchingFailed` is published once, and it appears as an ops attention item. Retries continue until a rider accepts or ops reassign.

Several replicas are safe:

- Due deliveries are claimed with `FOR UPDATE SKIP LOCKED`.
- Unique partial indexes allow one open offer per delivery and per rider.
- Redis changes happen after commit. A reconciler re-syncs the GEO index from Postgres every minute.

## Redis keys

| Key | Owner | Content |
| --- | --- | --- |
| `dispatch:riders:available:colombo` | dispatch | GEO set of ONLINE, idle riders. Added on going online or finishing a job; removed on going offline, accepting or suspension. `kade.rider.locations` pings move members that are already in it (`GEOADD XX`). |
| `dispatch:riders:available:seen` | dispatch | Sorted set: rider id → last position update (Unix ms). |
| `location:riders:geo`, `location:riders:seen` | location | Read only: freshest position for admin and rider reads. |

## Events

- **Out, `kade.delivery.events`:** `DeliveryRequested`, `DeliveryOfferSent`, `DeliveryOfferDeclined`, `DeliveryOfferExpired`, `RiderAssigned`, `RiderUnassigned`, `RiderArrivedAtRestaurant`, `DeliveryPickedUp`, `RiderArrivedAtCustomer`, `DeliveryCompleted`, `DeliveryMatchingFailed`, `DeliveryCancelled`.
- **Out, `kade.rider.events`:** `RiderApplicationSubmitted`, `RiderApplicationDecided`, `RiderStatusChanged` (online, offline, on job, suspended, zones).
- **In:**
  - `OrderAccepted`: matching starts.
  - `OrderReady`: food-ready time.
  - `OrderTipUpdated`: rider pay.
  - `OrderCancelled`: `DeliveryCancelled`, offers withdrawn, rider compensated (half the base on the way; base + pickup leg once at the restaurant).
  - `RiderCashBalanceChanged`: cash held and limit, cash orders allowed or not.
  - `RiderRatingChanged`: rating.
  - `OrderRated`: stars on the trip.
  - `kade.rider.locations`: GEO moves, and the last position saved to Postgres at most once a minute per rider.

## Seed data (`SEED_ON_START`, idempotent)

**Riders.** R-101 to R-148 from the admin console, ids `00000000-0000-7000-8001-000000000101` to `…148`:

- **R-101 Nimal Perera** (rider app profile). Rider `…-8001-000000000101`, user_id `…-8005-000000000004` (Keycloak `nimal`). Bajaj Pulsar 150, WP BCD-4521, rating 4.9 (1,284), Commercial Bank ••4417, deposit ref KR-4521-NP. Holds Rs 14,330 of a Rs 15,000 limit, so cash orders are allowed. Starts OFFLINE.
- **R-102 Kasun Perera** and the other 46: no login, `simulated`. 29 are ONLINE around their home zones (at least 4 in Kollupitiya), R-106 and R-118 are over the cash limit, and R-147 is suspended.

**Nimal's history.** His past trips from the rider app, as delivered deliveries `…-8021-…`. Trips later than the seeding time are skipped.

**Applications.** The 4 pending applications from the admin console: `…-8020-000000000301`, `302`, `305` and `306`.

## Demo fleet simulator (`SIMULATE_RIDERS=true` in Compose)

Simulated riders run their jobs through the same code paths as the rider app:

1. Accept after `SIM_ACCEPT_DELAY` (5 s).
2. Ride to the restaurant at `SIM_SECONDS_PER_KM` (20 s per km; each leg 15 s to 3 min).
3. Wait for `OrderReady` or the kitchen's `ready_by` (at most 20 min).
4. Pick up a sealed bag.
5. Ride to the customer.
6. Complete with the order's delivery code and the exact cash.

Their positions go through location's `ReportRiderLocations`, so they reach `kade.rider.locations` and realtime with `delivery_id`, `order_id` and activity set. Nimal is never simulated: when he is online and within reach, he gets the offer first.

## Configuration

Standard variables: `SERVICE_NAME`, `GRPC_PORT`, `HTTP_PORT`, `DATABASE_URL` and `REDIS_URL` (both required), `KAFKA_BROKERS`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`.

Optional gRPC dependencies: `LOCATION_GRPC`, `NOTIFICATION_GRPC`.

| Variable | Default |
| --- | --- |
| `EVENT_TOPICS` | `kade.order.events`, `kade.ledger.events`, `kade.review.events` |
| `LOCATIONS_TOPIC` | `kade.rider.locations` (`-` disables it) |
| `OFFER_TIMEOUT` | 30s |
| `MATCH_RADII_KM` | 3,6,12 |
| `MATCH_FAIL_AFTER` | 12 |
| `REOFFER_AFTER` | 2m |
| `RIDER_STALE_AFTER` | 2h |
| `PREFER_REAL_RIDERS` | true |
| `MAX_EVENT_AGE` | 6h |
| `SEED_ON_START` | true |
| `SIMULATE_RIDERS` | false |
| `SIM_SECONDS_PER_KM` | 20s |
| `SIM_ACCEPT_DELAY` | 5s |
| `RPC_DEFAULT_TIMEOUT` | 5s |
| `SHUTDOWN_TIMEOUT` | 20s |
| `MIGRATE_ON_START` | true |

## Run and test (Docker only)

```bash
docker run --rm -v "$PWD:/repo" -w /repo/services/dispatch -v kade-go-mod:/go/pkg/mod \
  -v kade-go-build:/root/.cache/go-build -e GOFLAGS=-buildvcs=false golang:1.25 sh -c 'go vet ./... && go test ./...'
docker run --rm --network kade -v "$PWD:/repo" -w /repo/services/dispatch -v kade-go-mod:/go/pkg/mod \
  -v kade-go-build:/root/.cache/go-build -e GOFLAGS=-buildvcs=false golang:1.25 go test -tags integration -count=1 -v ./integration/...
docker build -f services/dispatch/Dockerfile -t kade/dispatch:dev .
docker compose -f deploy/compose/compose.yaml --profile fulfilment up -d dispatch
```

The integration tests use their own consumer groups (`dispatch-it`) and riders far from Colombo (Galle, Kandy, Jaffna). They delete their riders and deliveries at the end. They cover:

- onboarding to rider;
- `OrderAccepted` → offer → decline → re-offer → accept → every step → delivered;
- offer expiry and order cancellation;
- the cash limit → UNMATCHED → ops reassign;
- GPS stream → GEO;
- outbox → Debezium → `kade.delivery.events`.

By hand:

```bash
grpcurl -plaintext -H 'x-user-id: 00000000-0000-7000-8005-000000000004' -H 'x-roles: rider' \
  -d '{"online":true,"position":{"lat":6.911,"lng":79.849}}' localhost:50110 kade.dispatch.v1.DispatchService/SetAvailability
grpcurl -plaintext -H 'x-user-id: 00000000-0000-7000-8005-000000000004' -H 'x-roles: rider' -d '{}' \
  localhost:50110 kade.dispatch.v1.DispatchService/GetCurrentOffer
grpcurl -plaintext -H 'x-user-id: ops' -H 'x-roles: ops' -d '{}' localhost:50110 kade.dispatch.v1.DispatchOpsService/GetLiveSnapshot
```
