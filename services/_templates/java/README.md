# Java service template (`template-java`)

The copy-me starting point for Kadé's Java services: **payment**, **promotion** and **ledger**. It implements
`kade.template.v1.TemplateService` (proto/kade/template/v1/template.proto) end to end: gRPC, Postgres with explicit
SQL, the transactional outbox, idempotency keys, optimistic locking, an idempotent Kafka consumer with a dead-letter
topic, health and metrics, and OpenTelemetry. Read `docs/backend/CONVENTIONS.md` first; this README covers only the
Java specifics.

|           |                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------ |
| Owns      | `notes` (example), `note_totals` (example running totals)                                              |
| API       | `CreateNote` (idempotent with `idempotency_key`), `GetNote`; needs `x-user-id` metadata                |
| Publishes | `kade.template.v1.NoteCreated` via the outbox → `kade.note.events`                                     |
| Consumes  | `kade.note.events` (`NoteCreated` → `note_totals`), group = `SERVICE_NAME`, DLQ `kade.note.events.dlq` |
| Ports     | gRPC `50193`, HTTP `8193` (`/health/live`, `/health/ready`, `/metrics`)                                |
| Database  | `template_java` (login `template_java`), Debezium connector `outbox-template_java`                     |

## Stack and why

| Concern                | Choice                                                                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                | Java 21, Spring Boot 3.5, Gradle 8.14 (Kotlin DSL, wrapper)                                                                                                                                  | Boot 3.5 is the supported 3.x line; Java 21 gives virtual threads and records                                                                                                                                                                                                                                                                                                                           |
| gRPC server            | **Spring gRPC 0.12** (`org.springframework.grpc`)                                                                                                                                            | The official Spring project, and 0.12 is the release built for Boot 3.5 (1.x needs Boot 4, so the upgrade path is clear). Gives `@GlobalServerInterceptor`, a `GrpcExceptionHandler` hook, Micrometer observation, grpc health backed by actuator, reflection. `net.devh` grpc-spring-boot-starter last shipped in 2024 and trails Boot releases                                                        |
| Protobuf               | protobuf Gradle plugin 0.9.5, protoc 4.32.1, grpc-java 1.76 (versions from the Spring gRPC BOM)                                                                                              | Generated at build time from the repo's `proto/`; nothing generated is committed                                                                                                                                                                                                                                                                                                                        |
| SQL                    | **Spring `JdbcClient`** (spring-jdbc) with hand-written SQL                                                                                                                                  | Money services need to see every statement: conditional `UPDATE ... WHERE version = ?`, `ON CONFLICT DO NOTHING`, row counts. No JPA (dirty checking, lazy loading, flush order). Spring Data JDBC repositories add derived queries and delete-and-reinsert for child collections; jOOQ needs a codegen step against a live schema. `JdbcClient` is the layer both of those sit on, with nothing hidden |
| Migrations             | Flyway 11 (`src/main/resources/db/migration`)                                                                                                                                                | Run on start (CONVENTIONS checklist)                                                                                                                                                                                                                                                                                                                                                                    |
| Kafka                  | Spring Kafka 3.3, `ByteArrayDeserializer`, `DefaultErrorHandler` + `DeadLetterPublishingRecoverer`                                                                                           | Standard retry and DLQ machinery; observation turns `traceparent` headers into spans                                                                                                                                                                                                                                                                                                                    |
| Tracing, metrics, logs | **Micrometer Observation with the OpenTelemetry bridge**, OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT` (traces, metrics, logs); Prometheus at `/metrics`; datasource-micrometer for JDBC spans | Chosen over the OTel Java agent because of the 256 MB limit: the agent adds roughly 40–60 MB RSS and seconds of startup through bytecode instrumentation. Boot already instruments gRPC (Spring gRPC), HTTP, Kafka and JDBC through Micrometer, and W3C `traceparent` propagates through gRPC metadata and Kafka headers                                                                                |
| JSON logs              | Boot structured logging (`logstash` format) with `trace_id`/`span_id`                                                                                                                        | One JSON object per line on stdout                                                                                                                                                                                                                                                                                                                                                                      |

## Layout

```
src/main/java/lk/kade/template/
  TemplateApplication.java
  config/        KadeProperties (env → typed config), DATABASE_URL → JDBC translation, Clock
  grpc/          Caller + IdentityInterceptor, DeadlineInterceptor/Deadlines, GrpcErrorHandler, client deadline
  error/         ServiceException (code + stable reason), ErrorReasons, OptimisticLockException
  money/         Money (long minor units ↔ kade.common.v1.Money)
  outbox/        OutboxWriter, TraceContext (traceparent), UuidV7
  idempotency/   IdempotencyService
  db/            OptimisticRetry
  kafka/         EventDispatcher, ProtoEventHandler, KafkaConfig (retry + DLQ), KafkaHealthIndicator
  observability/ OTLP log export
  note/          the example domain: service, repositories, gRPC adapter, consumer   ← replace this
src/main/resources/db/migration/
  V1__outbox_and_idempotency.sql   infrastructure tables (keep)
  V2__notes.sql                    example tables (replace)
src/test/             unit tests (no infrastructure)            ./gradlew test
src/integrationTest/  against the shared Compose stack           ./gradlew integrationTest
```

## Build, run, test (Docker only; no local JDK needed)

Always build through **`scripts/java-build.sh <service-dir> <gradle args>`** from the repo root: it runs the wrapper
in the `gradle:8.14-jdk21` image on the `kade` network with the shared `kade-gradle` cache, and holds a repo-wide
lock so only one Java build runs at a time on the laptop (Gradle heap is capped at 768 MB in `gradle.properties`).

```bash
J=services/_templates/java

scripts/java-build.sh $J test               # unit tests (what CI runs; no Postgres/Kafka)
scripts/java-build.sh $J integrationTest    # against the shared stack (pnpm infra:up first)
scripts/java-build.sh $J bootJar

# Image (context = this folder, proto/ as a named build context). Don't build images while Gradle runs.
docker build --build-context proto=proto -t kade/template-java:dev $J

# Run it against the shared stack (profile `templates`)
docker compose -p kade-template-java -f $J/compose.yaml --profile templates up -d --build
curl -s localhost:8193/health/ready
grpcurl -plaintext -H 'x-user-id: u1' -d '{"text":"hi","amount":{"amount_minor":115000,"currency":"LKR"}}' \
  localhost:50193 kade.template.v1.TemplateService/CreateNote
docker compose -p kade-template-java -f $J/compose.yaml down

# Outbox → Kafka: register the Debezium connector once the migrations have created the outbox table
deploy/compose/connect/register-outbox.sh template_java template_java
```

Integration tests default to in-network addresses (`postgres:5432`, `kafka:9092`, `otel:4318`, `connect:8083`), which
is what the build container on the `kade` network sees; set `DATABASE_URL`/`KAFKA_BROKERS` to override. (On this
laptop Postgres is published on host port 15432, and Kafka advertises `localhost:19092`, so host-network addresses
don't work from containers.)

The integration tests use `SERVICE_NAME=template-java-it` (their own consumer group), fresh ids, and a random
currency code per test, so they can run while the template container is up. `endToEndThroughDebezium` is skipped
unless the `outbox-template_java` connector is RUNNING.

## Configuration

Every setting comes from the CONVENTIONS environment variables, bound in `application.yaml`:

| Env                           | Spring property                                                                  | Notes                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `SERVICE_NAME`                | `kade.service-name`, `spring.application.name`, `spring.kafka.consumer.group-id` | also OTel `service.name`, ErrorInfo `domain`                                            |
| `GRPC_PORT` / `HTTP_PORT`     | `spring.grpc.server.port` / `server.port`                                        |                                                                                         |
| `DATABASE_URL`                | `kade.database-url` → `spring.datasource.*`                                      | `postgres://user:pass@host:port/db` translated by `DatabaseUrlEnvironmentPostProcessor` |
| `KAFKA_BROKERS`               | `spring.kafka.bootstrap-servers`                                                 |                                                                                         |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `kade.otel.endpoint` → `management.otlp.*`                                       | `/v1/traces`, `/v1/metrics`, `/v1/logs` appended                                        |
| `<NAME>_GRPC`                 | `spring.grpc.client.channels.<name>.address`                                     | add per dependency                                                                      |

Typed access: inject `KadeProperties`.

## Patterns (read before writing money code)

**Money.** `Money(long amountMinor, String currency)` mirrors `kade.common.v1.Money`. No `double`/`float`, ever.
Arithmetic is overflow-checked (`Math.addExact`), currencies never mix, rates are basis points with an explicit
`RoundingMode`, and `allocate(…)` splits without losing a cent (Rs 100.00 / 3 = 33.34 + 33.33 + 33.33). Store
money as `amount_minor bigint` + `currency text`. Convert at the edges: `Money.fromProto(...)`, `money.toProto()`.

**Transactional outbox.** Never publish to Kafka from a request handler. In one `@Transactional` method write the
business rows and call `outbox.append(aggregateType, aggregateId, protoEvent)`. The row (`type` = the proto full
name, payload = protobuf bytes, `traceparent` = current span) commits or rolls back with the business change;
Debezium publishes it to `kade.<aggregateType>.events`. `OutboxWriter` is `MANDATORY`: calling it outside a
transaction fails.

**Idempotency keys.** `IdempotencyService.execute(operation, principal, key, requestWithoutKey, parser, action)`
opens the transaction, claims `(operation, principal, key)` with `INSERT ... ON CONFLICT DO NOTHING`, runs the
action, and stores the protobuf response in the same transaction. A retry returns the stored response; a concurrent
duplicate blocks on the unique key until the first commits, then returns its response; the same key with a
different body is `FAILED_PRECONDITION / IDEMPOTENCY_KEY_REUSED`. Keys are scoped per caller. Purge old rows by
`created_at` when a service needs it.

**Optimistic locking.** Versioned rows (`version bigint`) are read, decided on in Java, and written with
`UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?`. Zero rows → `OptimisticLockException`
(`ABORTED / CONCURRENT_MODIFICATION`). Wrap the whole transactional method in `OptimisticRetry.run(n, ...)` for RPCs;
consumers get retries from the Kafka error handler. Use it for budgets and balances where the decision needs the
current value; when no check is needed, a single atomic `UPDATE ... SET x = x + ?` is simpler. See
`NoteTotalsRepository` and `OptimisticLockingIT`.

**Idempotent consumers.** `EventDispatcher` reads the `eventType` header, finds the `ProtoEventHandler` for it,
inserts the `id` header into `processed_events`, and runs the handler in the same transaction. Duplicate → skipped.
Unknown event types are ignored. Failures retry with exponential backoff (200 ms doubling, 5 attempts in total) and
then go to `<topic>.dlq` with the cross-language headers `error`, `original-topic`, `original-partition`, `original-offset`, `attempts`, `failed-by`. Undecodable
records skip the retries. Topics are created by the infra stack, never by services.

**Errors.** Throw `ServiceException(code, REASON, message)` (helpers: `invalidArgument`, `notFound`,
`failedPrecondition`, …). `GrpcErrorHandler` turns it into a gRPC status with a `google.rpc.ErrorInfo{reason,
domain = SERVICE_NAME, metadata}`. Anything unexpected becomes `INTERNAL` without leaking the message.

**Identity and deadlines.** `Caller.current()` holds `x-user-id`, `x-roles` (comma- or space-separated) and
`x-outlet-id`; use `requireAuthenticated()` / `requireAnyRole(...)`. Every incoming call runs under a deadline (2 s
default when the caller sent none, clamped to 10 s); `Deadlines.check()` before expensive work. Outgoing stubs from
Spring gRPC's channel factory get a 2 s default deadline.

## How to add an RPC

1. Add it to your proto (`proto/kade/<domain>/v1/<domain>_service.proto`, lead-owned) and list the package in
   `protoPackages` in `build.gradle.kts`.
2. Extend the generated `<Service>Grpc.<Service>ImplBase` in a `@Service` class (Spring gRPC registers every
   `BindableService` bean). Override the method: authorise with `Caller.current()`, validate and map the request
   (`Money.fromProto`), call a `@Transactional` domain service, `onNext` + `onCompleted`. Don't catch exceptions;
   throw `ServiceException`.
3. Mutating and retryable? Wrap the domain call in `idempotency.execute(...)` (see `NoteGrpcService.createNote`).
4. Emits an event? `outbox.append(...)` inside the same transaction.
5. Test: unit-test the domain, add an integration test like `NoteGrpcIT`.

## How to add a consumer

1. List the event's proto package in `protoPackages`.
2. Add a `@KafkaListener(id = "<topic>-listener", idIsGroup = false, topics = "kade.<aggregate>.events")` method
   that calls `dispatcher.dispatch(record)` (one listener per topic). Keep `idIsGroup = false`: without it Spring
   uses the listener id as the consumer group instead of `SERVICE_NAME`.
3. Add a `@Component` extending `ProtoEventHandler<YourEvent>` (`super(YourEvent.getDefaultInstance())`) and put the
   side effect in `handle(eventId, event)`, using the same DataSource. It runs exactly once per event id.
4. Throw for transient failures (retried, then dead-lettered); throw `MalformedEventException` for records that can
   never succeed.
5. Integration test: publish a record with `id` + `eventType` headers like `NoteEventsConsumerIT`.

## Copy-the-template checklist

```bash
services/_templates/java/new-service.sh <name> <grpcPort> <httpPort> [database]   # e.g. payment 50108 8108
```

The script copies to `services/<name>`, renames the package (`lk.kade.<name>`), the application class, the service
name, DB login/database, ports, and the proto path, and adds `kade/<name>/v1` to the generated packages if it exists.
Then:

- [ ] `scripts/java-build.sh services/<name> test integrationTest` passes in the copy.
- [ ] Replace the `note` package, `V2__notes.sql` and the example tests with your domain; delete
      `kade/template/v1` from `protoPackages` once nothing uses it. Keep `V1__outbox_and_idempotency.sql`.
- [ ] Set the Compose profile (`ordering`, `money`, …) and `<NAME>_GRPC` env for dependencies in `compose.yaml`.
- [ ] Every mutating RPC that a client may retry takes an `idempotency_key` and goes through `IdempotencyService`.
- [ ] Money only via `Money`/`long` minor units; balances/budgets carry a `version` column.
- [ ] Every event via the outbox; every consumer via `EventDispatcher`.
- [ ] Ask the lead to include the fragment in `deploy/compose/services.yaml`; register the outbox connector.
- [ ] README: what it owns, API, events in/out, how to run it alone.

## Memory

Runtime: `eclipse-temurin:21-jre-alpine`, non-root (uid 10001), layered jar, AppCDS archive built at image build
time. Image: 155 MB. JVM flags are in `JAVA_OPTS` in the Dockerfile (SerialGC, heap 50% of the limit, capped
metaspace/code cache/direct memory, `-Xss512k`, `ActiveProcessorCount=2`, CDS without relocation, exit on OOM).

Measured idle in a 256 MB container against the shared stack (docker stats, after 75–90 s):

| Variant | Idle memory | Startup |
| --- | --- | --- |
| no AppCDS | 222 MiB | 2.4 s |
| AppCDS (default relocation) | 190 MiB | 1.8 s |
| AppCDS, `ArchiveRelocationMode=0` | 159 MiB | 2.0 s |
| + `ActiveProcessorCount=2`, heap free ratios (shipped) | **148–150 MiB** | 1.6–4.5 s |

Startup varies with how busy the laptop is. Heap in use at idle is about 40 MB; the rest is metaspace (~40 MB),
code cache (~20 MB), thread stacks and the CDS mapping. Not yet measured under sustained load: run
`LOAD_TARGET=template-java:50193 scripts/java-build.sh services/_templates/java integrationTest --tests '*LoadSmokeIT'`
with the container up and watch `docker stats`.
