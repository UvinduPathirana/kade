# realtime

Turns Kafka events into live WebSocket pushes for the four apps: customer order tracking, the
restaurant kitchen board, rider offers and jobs, and the admin live dashboard. There is no gRPC
API and no Publish RPC: every push comes from an event that is already on Kafka, so pushes are
replayable and there is one path. Clients treat frames as hints and refetch over REST after a
reconnect.

|            |                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------- |
| Module     | `github.com/UvinduPathirana/kade/services/realtime` (Go 1.25)                                     |
| Port       | HTTP `8112`: `/ws`, `/health/live`, `/health/ready` (Kafka + Redis), `/metrics`                   |
| State      | Redis only (pub/sub fan-out, small projections, dedup). No Postgres.                               |
| Events in  | `kade.{order,merchant,delivery,rider,restaurant,menu,ticket,ledger}.events`, `kade.rider.locations` |
| Events out | none                                                                                              |
| Profile    | `fulfilment`, 64 MB                                                                               |

## How the gateways proxy `/ws`

Browsers can't set headers on a WebSocket, so the app talks to its gateway's `/ws`, the gateway
authenticates the token (first message `{"type":"auth","token":…}`), then opens its own WebSocket to
realtime and pipes frames both ways unchanged. On that upgrade request the gateway sets:

| Header        | Value                                                                                  | Needed for                  |
| ------------- | -------------------------------------------------------------------------------------- | --------------------------- |
| `x-user-id`   | Keycloak `sub` (a customer's id **is** their sub). **Required**: without it → HTTP 401 | everything                  |
| `x-roles`     | realm roles, comma-separated (`customer`, `merchant_staff`, `merchant_owner`, `rider`, `ops`, `support`, `admin`, …) | role checks |
| `x-outlet-id` | outlet ids from `merchant.OutletStaffService.GetMyOutlets`, comma-separated            | `outlet:<id>`, order/ticket |
| `x-rider-id`  | rider id from `dispatch.RiderService.GetMyRider`                                        | `rider:<id>`, order/ticket  |

`REALTIME_WS_URL=ws://realtime:8112/ws` in the gateways (in-network). Realtime trusts the internal
network. The Origin header is not checked by default (identity never comes from cookies), so a
gateway may forward the browser's Origin; set `WS_ORIGIN_PATTERNS` to restrict it.

Dev only: with `AUTH_DEV_BYPASS=true` and `DEPLOY_ENV=dev`, a socket without headers may pass its
identity as query parameters (`/ws?user=…&roles=ops&outlet=…&rider=…`) and an anonymous socket may
watch public channels. It's off in the Compose fragment.

## Protocol

One frame per text message, proto3 JSON (camelCase) of `kade.realtime.v1.ClientFrame` /
`ServerFrame` (`proto/kade/realtime/v1/realtime_messages.proto`).

```jsonc
→ {"subscribe":{"channels":["order:0190…","customer:0000…-000000000001"],"since":"2026-10-12T08:00:00Z"}}
← {"subscribed":{"granted":["order:0190…","customer:0000…"],"denied":[]}}
← {"message":{"id":"<kafka event id>","channel":"order:0190…","sourceType":"kade.order.v1.OrderAccepted",
              "occurredAt":"…","order":{"order":{…Order…}}}}
→ {"unsubscribe":{"channels":["order:0190…"]}}
→ {"ping":{"nonce":"n1"}}            ← {"pong":{"nonce":"n1"}}
```

- `GET /ws?channel=a&channel=b` subscribes at connect time (answered with a `subscribed` frame).
- `since` replays frames newer than that time from a short buffer (`REPLAY_WINDOW`, 2 min, last
  50 per channel; rider positions are not buffered). Dedupe on `message.id`.
- Up to 32 channels per socket. A malformed frame closes the socket with 1003.
- Heartbeat: the server sends a WebSocket ping every 25 s and drops a peer that doesn't pong
  within 5 s. Clients may also send `ping` frames.
- Shutdown closes sockets with **1001**; clients reconnect (to another replica), refetch, resubscribe.

## Channels and frames

| Channel                | Who may subscribe                                                                 | Frames (payload ← source events) |
| ---------------------- | --------------------------------------------------------------------------------- | -------------------------------- |
| `order:<order_id>`     | the order's customer (`x-user-id`); staff of its outlet (merchant role + `x-outlet-id`); its assigned rider (`rider` + `x-rider-id`); ops/admin/support | `order` (OrderUpdate, whole Order) ← every `kade.order.v1.Order*` event, `RiderAssigned`/`RiderUnassigned`; `riderPosition` ← `kade.rider.locations` (≤ 1/s per order) |
| `customer:<id>`        | the customer themself (id = `x-user-id`); ops/admin/support                        | `order` for each of their orders (same frames as `order:`) |
| `outlet:<outlet_id>`   | `merchant_staff`/`merchant_owner` with the id in `x-outlet-id`; ops/admin/support | `kitchenTicket` (KitchenTicketUpdate, whole Ticket; `isNew` = play the chime) ← `OrderPlaced`/`OrderReleasedToKitchen` (new), `OrderAccepted/Preparing/Ready/PickedUp/Rejected/Cancelled/RiderChanged`, `TicketAccepted/Rejected/Ready/HandedOver`, `RiderAssigned` (rider, ETA), `RiderArrivedAtRestaurant` (`riderAtCounter`), `RiderUnassigned` |
| `rider:<rider_id>`     | role `rider` with `x-rider-id` = id; ops/admin/support                            | `riderOffer` ← `DeliveryOfferSent` (offer), `DeliveryOfferExpired`/`Declined`, another rider assigned, `DeliveryCancelled` (offer **unset** = withdrawn); `riderJob` (Delivery + notice) ← `RiderAssigned`, `RiderUnassigned` ("Job reassigned", delivery no longer names the rider), `RiderArrivedAtRestaurant`, `DeliveryPickedUp`, `RiderArrivedAtCustomer`, `DeliveryCompleted` ("Delivered"), `DeliveryCancelled` ("Order cancelled"), `OrderReady` ("Food is ready") |
| `ops:live`             | ops, admin, support                                                               | `opsLive` with `sourceType` `kade.dispatch.v1.LiveSnapshot`: counters (`inProgress`, `waitingForRider`, `late`, `ridersOnline`, `ordersToday`, `cancellationsToday`, `avgDeliveryMinutes`, `ordersByHour`, `attention`), coalesced to ≤ 1/s and only when changed; `opsLive` with `sourceType` `kade.location.v1.RiderLocation`: one rider dot in `dots` (≤ 1/s per rider) |
| `group:<group_id>`     | the host and members of the group order; ops/admin/support                        | `groupOrder` ← `GroupOrderUpdated` |
| `restaurant:<id>`      | anyone                                                                             | `restaurantAvailability` ← `RestaurantAvailabilityChanged`; `menuItemAvailability` ← `MenuItemAvailabilityChanged` |
| `ticket:<ticket_id>`   | the requester (customer `x-user-id`, rider `x-rider-id`, outlet in `x-outlet-id`); support/ops/admin | `supportMessage` ← `TicketMessageAdded` |

Anything else (unknown kinds, `ops:<other>`, malformed names) is denied. Rules live in
`internal/channel/channel.go`; `channel_test.go` is the matrix.

Notes for the apps and the admin dashboard:

- `ops:live` frames are **deltas**: load the full picture with `dispatch.GetLiveSnapshot` (gateway
  REST), then apply counter frames (absent numbers are zero, proto3 JSON) and move rider dots.
- `finance` is not an ops role here. `support` sees `ops:live`, as in the realtime proto comment.
- Frames on `order:`/`customer:` have ops-only fields removed (order notes, customer/rider/restaurant
  real phone numbers): the gateways pipe frames through unchanged.
- `payment.events` aren't consumed: order turns payment outcomes into order events (`OrderFailed`,
  `OrderRefunded`), which are pushed. `ledger.events` feeds the "rider over the cash limit"
  attention item.

### Authorising `order:<id>`

Ownership comes from the events realtime consumes (`own:order:<id>` in Redis: customer, outlet,
assigned rider). If a customer opens tracking before realtime has seen the order, realtime asks
`order.GetOrder` once, as the caller (`ORDER_GRPC`, identity forwarded as gRPC metadata), and caches
the answer. Not found / not allowed / order unavailable → denied (the client retries after its REST
refetch).

## Fan-out design (multiple replicas)

```
Kafka topics ──(ONE consumer group "realtime", partitions split across replicas)──▶ replica A
replica A: update Redis views ─▶ PUBLISH rt:order:42 <ServerFrame JSON>
Redis ─▶ every replica that has a local socket on order:42 (SUBSCRIBE rt:order:42) ─▶ sockets
```

- Each event is handled by **exactly one** replica (shared group), so views are updated once and
  each frame is published once. Every replica holds one Redis pub/sub connection and subscribes to
  a channel only while one of its sockets watches it, so a frame reaches its socket wherever that
  socket landed. Adding replicas adds socket capacity; Kafka partitions (6 per topic) bound how
  many replicas share the consuming.
- The alternative, one consumer group per replica, would make every replica read every event and
  update the shared views N times; the shared group keeps work O(events).
- Views are needed because progress events carry only what changed while frames carry whole
  objects (Order, Ticket, Delivery). They are read-modify-written under Redis `WATCH`, and status
  only moves forward in the state machine, so events of one order arriving from different topics
  (order vs delivery partitions, possibly on different replicas) can't regress it.
- Dedup: the Kafka event id is claimed in Redis (`SET NX`, 24 h) before handling, so redelivery
  doesn't push twice. Failures retry 5× with backoff, then `<topic>.dlq` (`failed-by: realtime`).
- A new consumer group starts at the beginning of each topic to rebuild views; events older than
  `PUSH_STALE_AFTER` (10 min) update views but aren't pushed. GPS fixes older than 30 s are dropped.
- Throttles are cluster-wide (`SET NX PX` gates): one position per order per second, one rider dot
  per rider per second; out-of-order fixes (by `sequence`) are dropped. `ops:live` counters are
  coalesced: handlers mark a dirty flag, every replica ticks each second and the one whose `GETDEL`
  wins publishes.

## Backpressure

Each socket has a bounded queue (`WS_SEND_BUFFER`, 256 frames) and its own writer with a 5 s write
timeout. Publishing to a socket never blocks the hub. When the queue is full the socket is
**closed with 1013** (try again later), not left with gaps: frames are state, and a client that
silently missed one would show stale state, while a closed client reconnects, refetches and
resubscribes (with `since`). Counted in `kade_realtime_frames_dropped_total` and
`kade_realtime_ws_slow_closes_total`.

## Metrics (`/metrics`, also OTLP)

`kade_realtime_ws_connections` (open sockets), `kade_realtime_frames_sent_total`,
`kade_realtime_frames_dropped_total`, `kade_realtime_ws_slow_closes_total`,
`kade_realtime_subscriptions_total{result,kind}`, `kade_realtime_frames_published_total{kind}`,
`kade_consumer_events_total{topic,type,outcome}`, plus Go runtime, HTTP and Redis client metrics.

## Watching channels by hand (`wswatch`)

A small Go client that sets the gateway headers and prints frames. It ships in the image:

```bash
C=$(docker ps -qf name=realtime)
# admin dashboard
docker exec $C /app/wswatch -user 00000000-0000-7000-8005-000000000005 -roles ops ops:live
# Dilini's order (she owns it once OrderPlaced was seen, or via order.GetOrder)
docker exec $C /app/wswatch -user 00000000-0000-7000-8005-000000000001 -roles customer \
  order:<order id> customer:00000000-0000-7000-8005-000000000001
# kitchen board of Galle Road Kottu House (ruwan)
docker exec $C /app/wswatch -user 00000000-0000-7000-8005-000000000002 -roles merchant_owner,merchant_staff \
  -outlet 00000000-0000-7000-8000-000000000001 outlet:00000000-0000-7000-8000-000000000001
# Nimal's offers and job
docker exec $C /app/wswatch -user 00000000-0000-7000-8005-000000000004 -roles rider \
  -rider 00000000-0000-7000-8001-000000000101 rider:00000000-0000-7000-8001-000000000101
```

Flags: `-url` (default `ws://localhost:8112/ws`), `-since 1m` (replay), `-raw` (print JSON),
`-n 3 -timeout 30s` (exit 0 after 3 messages, 1 on timeout; handy in scripts). From the repo without
the image: `cd services/realtime && go run ./cmd/wswatch …` (or in a `golang:1.25` container with
`--network kade -url ws://realtime:8112/ws`).

## Configuration

`SERVICE_NAME`, `HTTP_PORT`, `KAFKA_BROKERS` and `REDIS_URL` are required;
`OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`, `ORDER_GRPC` optional. Extras (defaults):
`KAFKA_GROUP` (`SERVICE_NAME`), `CONSUME_TOPICS` (all of the above), `LOCATIONS_TOPIC`
(`kade.rider.locations`), `REDIS_PREFIX` (`rt:`),
`WS_SEND_BUFFER` (256), `WS_PING_INTERVAL` (25s), `WS_WRITE_TIMEOUT` (5s), `WS_MAX_SUBSCRIPTIONS`
(32), `WS_ORIGIN_PATTERNS` (none = no Origin check), `POSITION_MIN_INTERVAL` (1s),
`OPS_PUSH_INTERVAL` (1s), `VIEW_TTL` (48h), `PUSH_STALE_AFTER` (10m), `REPLAY_WINDOW` (2m),
`SHUTDOWN_TIMEOUT` (20s), `AUTH_DEV_BYPASS` + `DEPLOY_ENV=dev`. Invalid config fails fast.

The scaffold's gRPC port 50112 and `realtime` database are unused.

## Run and test (Docker only; no local Go needed)

```bash
# Unit tests (Redis is miniredis in-process; no infrastructure)
docker run --rm -v "$PWD:/repo" -w /repo/services/realtime \
  -v kade-go-mod:/go/pkg/mod -v kade-go-build:/root/.cache/go-build -e GOFLAGS=-buildvcs=false \
  golang:1.25 sh -c 'go vet ./... && go test -race ./...'

# Integration tests against the shared stack (pnpm infra:up first): Kafka event → WebSocket frame,
# unauthorised subscriptions denied, dedup. Own consumer group (realtime-it) and Redis prefix (rtit:);
# test events go to the template topics (kade.note.events / kade.note.views), never the real ones.
docker run --rm --network kade -v "$PWD:/repo" -w /repo/services/realtime \
  -v kade-go-mod:/go/pkg/mod -v kade-go-build:/root/.cache/go-build -e GOFLAGS=-buildvcs=false \
  golang:1.25 go test -tags integration -count=1 -v ./integration/...

# Image + container
docker build -f services/realtime/Dockerfile -t kade/realtime:dev .
docker compose -f deploy/compose/compose.yaml --profile fulfilment up -d realtime   # once included
```

## Layout

```
cmd/server            main + `server healthcheck` (distroless has no curl)
cmd/wswatch           WebSocket test client
internal/app          wiring, Run, graceful shutdown
internal/channel      channel names + authorisation rules (the matrix test)
internal/identity     gateway identity headers
internal/hub          WebSocket protocol, Redis pub/sub fan-out, backpressure, replay buffer
internal/fanout       event → views → frames (order.go, delivery.go, other.go: locations, ops)
internal/views        Redis projections, ownership index, dedup, throttles, ops counters
internal/platform/    telemetry, health, kafka (consumer with Redis dedup), redisx, grpcx client, auth
integration           tests against the shared stack (build tag `integration`)
```
