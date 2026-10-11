# Go service template

Copy-me starting point for Kadé's Go services (`dispatch`, `location`, `realtime`). It implements
`kade.template.v1.TemplateService` end to end, plus every pattern those services need. Conventions
live in [`docs/backend/CONVENTIONS.md`](../../../docs/backend/CONVENTIONS.md).

|            |                                                                                        |
| ---------- | -------------------------------------------------------------------------------------- |
| Module     | `github.com/UvinduPathirana/kade/services/_templates/go` (Go 1.25, in root `go.work`)  |
| Ports      | gRPC `50192`, HTTP `8192` (`/health/live`, `/health/ready`, `/metrics`, `/ws`)         |
| Owns       | database `template_go`: `notes`, `outbox`, `processed_events`, `idempotency_keys`      |
| API        | `CreateNote` (needs `x-user-id`; honours `idempotency_key`), `GetNote`                 |
| Events out | `NoteCreated` → outbox → Debezium → `kade.note.events`                                 |
| Events in  | `kade.note.events` (`NoteCreated`), consumer group = `SERVICE_NAME`                    |
| Stream out | `kade.template.v1.Note` on `STREAM_TOPIC` (`kade.note.views`, one per `GetNote`), Schema Registry encoded; the topic must exist (auto-create is off) |
| Redis      | GEO helper (`redisx.GeoIndex`), pub/sub for the WebSocket hub                          |

## New service from the template

```bash
services/_templates/go/new-service.sh dispatch 50110 8110
```

It copies the folder to `services/<name>`, rewrites the module path, `SERVICE_NAME`, database and
login (`<name>` with `-` → `_`), ports, the `gen/go` replace path and the Dockerfile/Compose paths,
and adds `./services/<name>` to `go.work`.

### After copying (checklist)

1. **Compose:** set `profiles:` in `compose.yaml` (`ordering | fulfilment | money | engagement`),
   trim `depends_on`/env to what you use, then ask the lead to add the include to
   `deploy/compose/services.yaml`, your database to `deploy/compose/postgres/init`, and your topics
   to `deploy/compose/kafka/create-topics.sh`.
2. **Domain:** replace `internal/note` with your package and `migrations/00001_init.sql` with your
   tables. Keep `outbox` (exact DDL), `processed_events` and `idempotency_keys`.
3. **API:** register your generated server in `internal/app/app.go` → `registerAPI`.
4. **Consumers:** set the topics in `app.New` and register handlers in `registerConsumers`.
5. **Outbox:** once migrations have run, register Debezium:
   `deploy/compose/connect/register-outbox.sh <db_login> <database>`.
6. **Drop what you don't need:** no Redis → remove `REDIS_URL`; no registry stream → remove
   `SCHEMA_REGISTRY_URL` and `a.Stream`; no gRPC (realtime) → remove the gRPC server.
7. **README:** rewrite this file for your service (owns, API, events in/out, how to run alone).

## Run and test (Docker only; no local Go needed)

```bash
# From the repo root. Named volumes keep module and build caches between runs.
docker run --rm -v "$PWD:/repo" -w /repo/services/_templates/go \
  -v kade-go-mod:/go/pkg/mod -v kade-go-build:/root/.cache/go-build -e GOFLAGS=-buildvcs=false \
  golang:1.25 sh -c 'go vet ./... && go test -race ./...'   # unit tests: no infrastructure needed

# Integration tests against the shared stack (pnpm infra:up first). Join the kade network: the
# Kafka broker advertises localhost:19092 to the host, which is unreachable from a container.
docker run --rm --network kade -v "$PWD:/repo" -w /repo/services/_templates/go \
  -v kade-go-mod:/go/pkg/mod -v kade-go-build:/root/.cache/go-build -e GOFLAGS=-buildvcs=false \
  golang:1.25 go test -tags integration -count=1 -v ./integration/...

# Image + container on the stack
docker build -f services/_templates/go/Dockerfile -t kade/template-go:dev .
docker compose -f deploy/compose/compose.yaml --profile templates up -d template-go   # once included
```

Integration tests use their own consumer group (`template-go-it`) and random ports, so they can run
while the container is up. Override addresses with `IT_DATABASE_URL`, `IT_KAFKA_BROKERS`,
`IT_SCHEMA_REGISTRY_URL`, `IT_REDIS_URL`; on the host they use `localhost` and the
`*_HOST_PORT` variables from `deploy/compose/.env`.

Try it by hand (needs `grpcurl`; reflection is on):

```bash
grpcurl -plaintext -H 'x-user-id: u1' -d '{"text":"hi","idempotency_key":"k1"}' localhost:50192 kade.template.v1.TemplateService/CreateNote
websocat 'ws://localhost:8192/ws?channel=note:<id>'
```

## Configuration

Standard variables from CONVENTIONS: `SERVICE_NAME`, `GRPC_PORT`, `HTTP_PORT`, `DATABASE_URL`
(required), `KAFKA_BROKERS`, `SCHEMA_REGISTRY_URL`, `REDIS_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`
(optional: an empty value turns that integration off). Extras: `LOG_LEVEL`, `RPC_DEFAULT_TIMEOUT`
(5s), `SHUTDOWN_TIMEOUT` (20s), `MIGRATE_ON_START` (true), `NOTE_EVENTS_TOPIC`, `STREAM_TOPIC`.
Invalid config fails fast with every problem listed.

## Layout

```
cmd/server            main + `server healthcheck` (the distroless image has no curl)
internal/app          wiring, Run, graceful shutdown       ← registerAPI / registerConsumers
internal/note         example domain: store, gRPC service, event handler (replace)
internal/config       env → Config with validation
internal/platform/    reusable plumbing, normally left as is:
  telemetry  grpcx  apperr  auth  db  outbox  idempotency  kafka  redisx  ws  health
migrations            goose SQL files, embedded, run on start under an advisory lock
integration           tests against the shared stack (build tag `integration`)
```

## Patterns

**Errors.** Handlers return `*apperr.Error{Code, Reason}`; one interceptor turns it into a gRPC
status with `google.rpc.ErrorInfo{reason, domain=SERVICE_NAME}` and logs it. Unknown errors become
`INTERNAL` without leaking details; panics are recovered. Reasons (`NOTE_NOT_FOUND`) are API.

**Identity and deadlines.** Gateways send `x-user-id`, `x-roles`, `x-outlet-id`;
`auth.FromContext(ctx)` reads them. `grpcx.Dial` forwards them on outgoing calls, adds the 2 s
default deadline, and retries only methods you list in `WithRetryableMethods` (idempotent reads).
The server caps calls that arrive without a deadline (`RPC_DEFAULT_TIMEOUT`).

**Outbox.** Never produce business events from a handler. In one transaction write the change and
`outbox.Insert(ctx, tx, outbox.Event{AggregateType: "order", AggregateID: id, Message: evt})`. The
row stores the proto bytes, `type` = full message name and the current `traceparent`; Debezium
publishes it to `kade.<aggregatetype>.events` with headers `id`, `eventType`, `traceparent`.

**Idempotency keys.** `idempotency.Claim` inserts `(scope, key)` first, in the same tx as the
work. A concurrent retry blocks on the primary key, then replays the stored response; the same key
with a different request returns `IDEMPOTENCY_KEY_REUSED`. Keys are scoped per caller.

**Idempotent consumer.** `kafka.Handle(router, func(ctx, tx, d, evt *orderv1.OrderPlaced) error)`.
The consumer decodes by the `eventType` header (unknown types are skipped), records the event id
in `processed_events` in the handler's transaction (redelivery = no-op), retries 5 times with
exponential backoff, then writes to `<topic>.dlq` with `error`, `attempts`, `failed-by` (the
consumer group: every group of a topic shares its DLQ) and `original-*` headers.
Return `kafka.Permanent(err)` to dead-letter immediately. Use `d.AfterCommit(fn)` for
non-transactional effects (Redis publish). Partitions run concurrently, records in a partition
in order; offsets are committed only for finished records, and rebalances wait for the batch.

**Schema Registry stream producer** (for `location` → `kade.rider.locations`):

```go
p, _ := kafka.NewStreamProducer[*locationv1.RiderLocation](ctx, a.Kafka, reg, "kade.rider.locations")
p.Produce(ctx, riderID, loc, onDone) // async; key = rider id keeps each rider ordered
```

At start-up it registers the message's `.proto` (rendered from the compiled descriptor) under
`<topic>-value`, with imported kade files as references (well-known types are built into the
registry), then frames every record as `0x00 | schema id | message index | protobuf`. That is the
Confluent wire format, so Java and TS Confluent deserializers read it. The producer client lingers
5 ms, compresses with lz4, is idempotent with acks=all, and uses the Java-compatible murmur2
partitioner. When 10k records are buffered, `Produce` blocks; that is the backpressure signal.
Consumers decode with `kafka.DecodeConfluent`. Not an outbox stream: losing a GPS ping is fine.

**Redis GEO** (for `dispatch`): `redisx.NewGeoIndex(rdb, "dispatch:riders:available:colombo")`
gives `Upsert`, `Remove` and `Nearby(center, radiusMeters, limit)` (GEOSEARCH, nearest first).
GEO members never expire: pair it with a last-seen sorted set, trimmed on a ticker.

**WebSocket hub** (for `realtime`): `GET /ws?channel=order:42` subscribes a socket. Any instance
publishes to Redis channel `order:42`; each instance keeps one pub/sub connection and subscribes
to a channel only while a local client watches it. Slow clients are dropped (they reconnect and
refetch) instead of buffering without bound; shutdown closes sockets with 1001 so clients
reconnect elsewhere. Add authorisation through `ws.Options.Authorize`. The template's
`NoteCreated` consumer publishes to `note:<id>` after commit, so the full path
outbox → Kafka → consumer → Redis → browser is exercised by the integration tests.

**Observability.** OTel traces, metrics and logs go to `OTEL_EXPORTER_OTLP_ENDPOINT` (OTLP/HTTP).
`traceparent` travels through gRPC metadata (otelgrpc), the outbox, and Kafka headers (extracted by
the consumer, injected by the stream producer and DLQ), so one request is one trace across hops.
Logs are JSON on stdout with `trace_id`/`span_id` (always log with `...Context(ctx, ...)`).
`/metrics` serves Prometheus: Go runtime, gRPC, pgx pool, Redis, consumer and WebSocket metrics.

**Shutdown.** On SIGTERM: readiness turns 503 and gRPC health NOT_SERVING; gRPC drains in-flight
calls; WebSockets close with 1001; HTTP stops; the consumer finishes its batch, commits and leaves
the group; buffered stream records flush; pools close; telemetry flushes. Everything is bounded
by `SHUTDOWN_TIMEOUT`; Compose's `stop_grace_period` is longer.
