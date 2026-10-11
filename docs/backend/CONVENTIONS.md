# Backend conventions

Every service, gateway and agent follows this file. If something here is wrong or missing, raise it with the lead instead of working around it; `proto/`, `deploy/compose/` and root config are lead-owned.

## Repo layout

```
proto/                      Protobuf contracts (buf module): gRPC APIs + Kafka event messages
  kade/<domain>/v1/*.proto
gen/
  ts/      @kade/proto       generated TypeScript (ts-proto), workspace package
  go/      gen module        generated Go (protocolbuffers/go + grpc/go)
  (Java generates at build time from proto/ via the protobuf Gradle plugin)
services/<name>/            one folder per service (own Dockerfile, compose.yaml fragment, migrations, tests)
services/_templates/<lang>/ copy-me starting points (ts, go, java)
gateways/<app>/             backend-for-frontend per app (TypeScript)
deploy/compose/             infrastructure stack + includes for every service fragment
docs/backend/               conventions, runbooks, architecture notes
```

## Service registry

Ports are fixed so services, gateways and Compose agree. gRPC listens on the gRPC port; the HTTP port serves `/health/live`, `/health/ready`, `/metrics` (and REST/WebSocket for gateways and `realtime`).

| Service | Lang | gRPC | HTTP | Database | Publishes (aggregate → topic) |
| --- | --- | --- | --- | --- | --- |
| catalog | TS | 50101 | 8101 | `catalog` | restaurant, menu → `kade.restaurant.events`, `kade.menu.events` |
| search | TS | 50102 | 8102 | `search` (+ OpenSearch later) | — |
| profile | TS | 50103 | 8103 | `profile` | customer → `kade.customer.events` |
| cart | TS | 50104 | 8104 | Redis | — |
| pricing | TS | 50105 | 8105 | `pricing` | — |
| promotion | Java | 50106 | 8106 | `promotion` | promotion → `kade.promotion.events` |
| order | TS | 50107 | 8107 | `orders` | order → `kade.order.events` |
| payment | Java | 50108 | 8108 | `payment` | payment → `kade.payment.events` |
| merchant | TS | 50109 | 8109 | `merchant` | merchant → `kade.merchant.events` |
| dispatch | Go | 50110 | 8110 | `dispatch` + Redis GEO | delivery → `kade.delivery.events` |
| location | Go | 50111 | 8111 | — (stream only) | `kade.rider.locations` (high volume, schema registry) |
| realtime | Go | — | 8112 | Redis pub/sub | — |
| ledger | Java | 50113 | 8113 | `ledger` | ledger → `kade.ledger.events` |
| notification | TS | 50114 | 8114 | `notification` | — |
| review | TS | 50115 | 8115 | `review` | review → `kade.review.events` |
| support | TS | 50116 | 8116 | `support` | ticket → `kade.ticket.events` |

| Gateway | App | HTTP | Notes |
| --- | --- | --- | --- |
| gateway-customer | apps/customer (5174) | 8201 | REST + WebSocket (`/ws`) |
| gateway-merchant | apps/restaurant (5175) | 8202 | REST + WebSocket |
| gateway-rider | apps/rider (5176) | 8203 | REST + WebSocket |
| gateway-admin | apps/admin (5177) | 8204 | REST + WebSocket |

| Infrastructure | Host port | In-network address |
| --- | --- | --- |
| Postgres 17 | 5432 | `postgres:5432` |
| Kafka (KRaft) | 19092 | `kafka:9092` |
| Schema Registry | 8085 | `schema-registry:8081` |
| Kafka Connect (Debezium) | 8083 | `connect:8083` |
| Temporal | 7233 | `temporal:7233` |
| Temporal UI | 8233 | — |
| Keycloak | 8080 | `keycloak:8080` |
| Redis | 6379 | `redis:6379` |
| Grafana (otel-lgtm) | 3000 | OTLP `otel:4317` (gRPC), `otel:4318` (HTTP) |
| Kafka UI (`tools` profile) | 8090 | — |

## Environment variables (same names in every language)

| Variable | Example (in Compose) | Notes |
| --- | --- | --- |
| `SERVICE_NAME` | `order` | also the OTel service name |
| `GRPC_PORT`, `HTTP_PORT` | `50107`, `8107` | from the registry |
| `DATABASE_URL` | `postgres://order:order@postgres:5432/orders` | each service gets its own user/password = service name in dev |
| `KAFKA_BROKERS` | `kafka:9092` | comma-separated |
| `SCHEMA_REGISTRY_URL` | `http://schema-registry:8081` | only for registry-encoded streams |
| `TEMPORAL_ADDRESS` | `temporal:7233` | namespace `kade` |
| `REDIS_URL` | `redis://redis:6379` | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel:4318` | traces, metrics, logs |
| `KEYCLOAK_ISSUER` | `http://keycloak:8080/realms/kade` | gateways only |
| `<NAME>_GRPC` | `CATALOG_GRPC=catalog:50101` | address of each dependency |

Running a service on the host against the Compose stack: use the host ports (`localhost:5432`, `localhost:19092`, …) and `localhost:<port>` for other services.

## Contracts (proto/)

- One package per domain: `kade.<domain>.v1`. Service definitions in `<domain>_service.proto`, events in `<domain>_events.proto`.
- Shared types in `kade.common.v1`: `Money`, `EventEnvelope` metadata, `GeoPoint`, pagination.
- **Money is `int64` minor units (cents) in LKR** (`kade.common.v1.Money { int64 amount_minor; string currency = "LKR"; }`). Never floats. Gateways convert to whole rupees for the apps, which display `Rs 1,150`.
- Times are `google.protobuf.Timestamp`. IDs are UUIDv7 strings; human-facing order numbers (`KD-4821`) are a separate `order_number` field.
- `buf lint` and `buf breaking` (against `main`) must pass. Never reuse or renumber a field; deprecate instead.

## Events and the outbox

- **Topics:** `kade.<aggregate>.events`, keyed by aggregate id, so all events for one order stay in order on one partition. 6 partitions in dev.
- **Writing events:** never publish to Kafka directly from a request handler. Write the business change **and** an outbox row in the same database transaction; Debezium's outbox router publishes it.

```sql
CREATE TABLE outbox (
  id            uuid PRIMARY KEY,          -- event id, also used for consumer deduplication
  aggregatetype text NOT NULL,             -- e.g. 'order' → topic kade.order.events
  aggregateid   text NOT NULL,             -- Kafka key
  type          text NOT NULL,             -- fully-qualified proto message, e.g. 'kade.order.v1.OrderPlaced'
  payload       bytea NOT NULL,            -- protobuf-encoded event message
  traceparent   text,                      -- W3C trace context, copied into a Kafka header
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

  Debezium routes each row to `kade.<aggregatetype>.events` with headers `id`, `eventType` (= `type`) and `traceparent`; the value is the raw protobuf bytes.
- **Consuming:** consumer group = service name. Decode by the `eventType` header. Every consumer is idempotent: record handled event ids in its own `processed_events(event_id uuid primary key, handled_at timestamptz)` table in the same transaction as its side effects.
- **Failures:** retry with backoff; after 5 attempts send to `<topic>.dlq` with the error in a header.
- **High-volume streams** (`kade.rider.locations`) are produced directly (not outbox) with the Confluent Protobuf serializer and the Schema Registry.

## Synchronous calls

- gRPC between services, with a deadline on every call (default 2 s) and retries only for idempotent reads.
- Errors use gRPC status codes plus a `google.rpc.ErrorInfo` with a stable `reason` (e.g. `PROMO_MIN_SUBTOTAL`). Gateways map them to HTTP `application/problem+json` with the user-facing message the apps already show.
- Mutating RPCs that can be retried take an `idempotency_key`.

## Auth

- Keycloak realm `kade` with clients `customer-app`, `merchant-app`, `rider-app`, `admin-app`; roles `customer`, `merchant_staff`, `merchant_owner`, `rider`, `ops`, `finance`, `support`, `admin`.
- Gateways validate the JWT and pass identity to services as gRPC metadata: `x-user-id`, `x-roles`, `x-outlet-id` (merchant staff). Services trust the internal network and authorise from that metadata.

## Observability

- OpenTelemetry in every service: traces (gRPC server/client, HTTP, Kafka produce/consume, DB), metrics, structured JSON logs with `trace_id`.
- Propagate `traceparent` through gRPC metadata and Kafka headers so one order is one trace across sync and async hops.

## Service checklist (definition of done)

1. Builds and runs from its Dockerfile; `compose.yaml` fragment with memory limit and healthcheck.
2. Migrations run on start (Drizzle for TS, goose for Go, Flyway for Java).
3. `/health/live`, `/health/ready` (checks DB/Kafka), `/metrics`.
4. gRPC API implements its proto; events written through the outbox; consumers idempotent.
5. Unit tests, plus at least one integration test against the shared stack.
6. README: what it owns, its API, events in/out, how to run it alone.
