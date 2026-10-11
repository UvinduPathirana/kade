# location

Rider GPS ingest (Go). It receives rider positions (about 1 Hz while online) from gateway-rider. It drops duplicate, out-of-order and implausible fixes. It produces the rest straight to `kade.rider.locations`, using the Confluent Protobuf wire format with the Schema Registry and the rider id as key. It keeps the last known position of every rider in Redis.

|          |                                                                                       |
| -------- | ------------------------------------------------------------------------------------- |
| Module   | `github.com/UvinduPathirana/kade/services/location` (Go 1.25)                         |
| Ports    | gRPC `50111`, HTTP `8111` (`/health/live`, `/health/ready`, `/metrics`)               |
| Owns     | No database. Redis keys below; the `kade.rider.locations` stream                      |
| Stream   | `kade.location.v1.RiderLocation` → `kade.rider.locations` (12 partitions, key = rider id, subject `kade.rider.locations-value`) |
| Readers  | dispatch (GEO index of available riders), realtime (live maps, customer tracking)     |
| Profile  | `fulfilment`; memory limit 64 MB (about 11 MB in use)                                 |

## API (`kade.location.v1.LocationService`)

| RPC | What it does |
| --- | --- |
| `StreamRiderLocations` (client stream) | Gateway-rider forwards every rider's socket positions on one long-lived stream. Returns `{accepted, dropped}` when the client closes it. |
| `ReportRiderLocations` | Unary batch (≤ 500), e.g. positions buffered while offline. Dispatch's simulator uses it too. |
| `GetLastKnownLocation` | Latest position of one rider. Unset if older than `LAST_KNOWN_TTL` (30 min). |
| `BatchGetLastKnownLocations` | By `rider_ids` or by a `south_west`/`north_east` box, newer than `since` (default: TTL). |

Fix rules (`internal/positions/filter.go`):

- A fix is dropped as **invalid** without a rider id, or when its coordinates are missing, (0,0) or out of range.
- It is dropped as a **duplicate** when its `sequence` is not newer (or its `occurred_at`, when the sequence is 0).
- It is dropped as **implausible** when it jumps more than 200 m faster than `MAX_SPEED_MPS` (50 m/s). After 3 such fixes in a row the new place wins. A rider silent for 5 min may reappear anywhere.
- `occurred_at` defaults to now and is clamped to now. `received_at` is set by location.

**Backpressure.** The producer buffers at most 10k records / 8 MB. When the buffer is full, `Produce` blocks inside the stream's receive loop, so gRPC flow control slows the gateway down instead of memory growing.

## Redis keys (owned by location; others may read)

| Key | Type | Content |
| --- | --- | --- |
| `location:riders:geo` | GEO | member = rider id, last accepted position |
| `location:riders:last` | hash | rider id → protobuf `RiderLocation` (last accepted fix) |
| `location:riders:seen` | sorted set | rider id → `received_at` (Unix ms) |

A janitor removes riders not seen for `RETAIN_POSITIONS` (6 h) from all three keys every minute. Dispatch reads `location:riders:geo` and `location:riders:seen` for rider positions on admin screens and offers.

## Configuration

`SERVICE_NAME`, `GRPC_PORT`, `HTTP_PORT`, `KAFKA_BROKERS`, `SCHEMA_REGISTRY_URL` and `REDIS_URL` are required. `OTEL_EXPORTER_OTLP_ENDPOINT` and `LOG_LEVEL` are optional.

Optional extras, with defaults:

| Variable | Default |
| --- | --- |
| `STREAM_TOPIC` | `kade.rider.locations` |
| `LAST_KNOWN_TTL` | 30m |
| `RETAIN_POSITIONS` | 6h |
| `MAX_SPEED_MPS` | 50 |
| `RPC_DEFAULT_TIMEOUT` | 5s |
| `SHUTDOWN_TIMEOUT` | 20s |

## Run and test (Docker only)

```bash
# unit tests
docker run --rm -v "$PWD:/repo" -w /repo/services/location -v kade-go-mod:/go/pkg/mod \
  -v kade-go-build:/root/.cache/go-build -e GOFLAGS=-buildvcs=false golang:1.25 sh -c 'go vet ./... && go test ./...'
# integration tests against the shared stack (pnpm infra:up first)
docker run --rm --network kade -v "$PWD:/repo" -w /repo/services/location -v kade-go-mod:/go/pkg/mod \
  -v kade-go-build:/root/.cache/go-build -e GOFLAGS=-buildvcs=false golang:1.25 go test -tags integration -count=1 -v ./integration/...
# image + container
docker build -f services/location/Dockerfile -t kade/location:dev .
docker compose -f deploy/compose/compose.yaml --profile fulfilment up -d location
```

The integration tests stream positions over gRPC and check the Redis keys and box queries. They also read `kade.rider.locations` back and decode it with the registered schema id.

By hand:

```bash
grpcurl -plaintext -d '{"locations":[{"rider_id":"00000000-0000-7000-8001-000000000101","position":{"lat":6.911,"lng":79.849},"sequence":1}]}' \
  localhost:50111 kade.location.v1.LocationService/ReportRiderLocations
grpcurl -plaintext -d '{"rider_id":"00000000-0000-7000-8001-000000000101"}' localhost:50111 kade.location.v1.LocationService/GetLastKnownLocation
```

## Layout

- `cmd/server`: main, plus `server healthcheck`.
- `internal/positions`: filter, Redis store, gRPC service, janitor.
- `internal/app`: wiring (Redis, stream producer, gRPC, HTTP).
- `internal/platform`: shared template plumbing. db, outbox and ws are unused here.
