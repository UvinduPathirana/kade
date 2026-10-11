# TypeScript service template (`@kade/template-ts`)

The starting point for every TypeScript service (catalog, search, profile, cart, pricing, order,
merchant, notification, review, support). It implements `kade.template.v1.TemplateService`
end to end so every pattern in [CONVENTIONS](../../../docs/backend/CONVENTIONS.md) has working code:

| Concern         | Where                                     | Notes                                                                                 |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Config          | `src/platform/config.ts`                  | Validated with zod at boot; every problem listed at once; exits 78                    |
| gRPC server     | `src/platform/grpc/`                      | `@grpc/grpc-js` + ts-proto definitions; `@GrpcService` handlers                       |
| Request context | `src/platform/grpc/context.ts`            | `x-user-id`, `x-roles`, `x-outlet-id`, deadline, cancel signal                        |
| Errors          | `src/platform/grpc/errors.ts`             | `DomainError` → status code + `google.rpc.ErrorInfo` reason                           |
| Postgres        | `src/platform/db/database.ts`             | Drizzle + `pg`; migrations on start (advisory-locked); deadline → `statement_timeout` |
| Outbox          | `src/platform/outbox/outbox.ts`           | Same transaction as the change; `traceparent` captured                                |
| Idempotency     | `src/platform/idempotency/idempotency.ts` | `idempotency_key` replays the stored response                                         |
| Kafka consumer  | `src/platform/kafka/`                     | `@EventConsumer` / `@OnEvent`; dedup via `processed_events`; backoff; DLQ             |
| HTTP            | `src/platform/health.ts`                  | `/health/live`, `/health/ready` (Postgres + Kafka), `/metrics`                        |
| Telemetry       | `src/instrumentation.ts`                  | OTel traces (gRPC, HTTP, pg, Kafka), metrics, pino logs with `trace_id` → OTLP        |
| Shutdown        | `src/main.ts`                             | Readiness → 503, gRPC drains, consumer commits, pool closes, telemetry flushes        |
| Example domain  | `src/notes/`, `src/db/schema.ts`          | **Replace this** with your aggregate                                                  |

`src/platform/` is plumbing every service carries a copy of (services share contracts, not code).
Change it rarely, and port useful fixes back here.

Registry entry for the template itself: gRPC **50100**, HTTP **8100**, database `template_ts`,
topic `kade.note.events`, Compose profile `templates`.

## Library choices

- **NestJS 11** for DI, modules and lifecycle hooks only. gRPC uses `@grpc/grpc-js` directly with
  the generated ts-proto service definition (no `@nestjs/microservices`), so handlers are typed by
  the proto and there is no second serialisation layer.
- **Explicit `@Inject(Token)` on every constructor parameter**, no `emitDecoratorMetadata`. That
  works under Vitest (its transformer cannot emit metadata), in ESM, and with
  `consistent-type-imports`.
- **Drizzle ORM + `pg`**: SQL-shaped, typed queries, and `drizzle-kit` generates plain SQL migrations.
- **`@confluentinc/kafka-javascript`** (librdkafka with a KafkaJS-style API). KafkaJS has been
  unmaintained since 2023 and is not tested against Kafka 4 (we run 4.3). Confluent's client is
  maintained, follows the broker protocol, and ships prebuilt binaries for linux musl/glibc
  arm64/x64 and macOS for Node 24, so nothing compiles in Docker. Its prefetch queue is capped
  (`queued.max.messages.kbytes`) so it fits in 192 MB. It has no OTel auto-instrumentation, so the
  runner creates the consumer span and propagates `traceparent` from the Kafka header itself.
- **pino**: JSON logs; `@opentelemetry/instrumentation-pino` adds `trace_id` and ships to Loki.
- **OTel metrics → both** OTLP (push) and `/metrics` (Prometheus pull) from one MeterProvider.

## Writing a service

### Add an RPC

1. Add it to your proto (`proto/kade/<domain>/v1/<domain>_service.proto`), run `pnpm proto:gen`.
2. Implement the method on your `@GrpcService(XServiceService)` class. The class
   `implements GrpcHandlers<XServiceService>`, so TypeScript flags a missing or mistyped method:

   ```ts
   async getMenu(request: GetMenuRequest, ctx: RequestContext): Promise<GetMenuResponse> {
     ctx.requireRole("merchant_staff", "ops");            // authorise from gateway metadata
     const menu = await this.menus.find(this.database.db, request.restaurantId);
     if (!menu) throw notFound("MENU_NOT_FOUND", "This menu isn't available.");
     return { menu: toProto(menu) };
   }
   ```

   Throw `DomainError`s (`invalidArgument`, `notFound`, `failedPrecondition`, `permissionDenied`,
   …) with a stable UPPER_SNAKE reason. The message should be safe to show a user. Anything else
   becomes `INTERNAL` and is logged with a stack trace.

3. Writes go through `this.database.transaction(ctx, tx => …)`. Passing `ctx` turns the caller's
   deadline into `statement_timeout`. Wrap retryable mutations in `this.idempotency.run(...)`
   (see `createNote`).

### Emit an event

Inside the same transaction as the state change:

```ts
await this.outbox.append(tx, {
  aggregateType: "menu", // → topic kade.menu.events
  aggregateId: menu.id, // Kafka key (per-aggregate ordering)
  type: "kade.catalog.v1.MenuUpdated", // consumers decode by this
  payload: MenuUpdated.encode(event).finish(),
});
```

Debezium publishes it. Never produce to Kafka from a handler.

### Consume events

```ts
@EventConsumer({ topics: ["kade.restaurant.events"] })
@Injectable()
export class RestaurantEventsConsumer {
  constructor(@Inject(SearchIndex) private readonly index: SearchIndex) {}

  @OnEvent("kade.catalog.v1.RestaurantUpdated", RestaurantUpdated)
  async restaurantUpdated(event: RestaurantUpdated, ctx: EventContext): Promise<void> {
    await this.index.upsert(ctx.tx, event); // write via ctx.tx: commits with the dedup row
  }
}
```

Register the class in a module's `providers`. Group is `SERVICE_NAME`. The runner dedups on the
`id` header in the same transaction, retries 5 times with exponential backoff, and then sends the
message to `<topic>.dlq` with headers `error`, `original-topic`, `original-partition`,
`original-offset`, `attempts` and `failed-by`. Throw `PermanentEventError` to skip the retries.
Unknown event types are skipped. For side effects outside Postgres (SMS, push), make the external
call idempotent on `ctx.eventId`.

## Copy checklist (new service)

```sh
node services/_templates/ts/new-service.mjs catalog 50101 8101            # db defaults to the name
node services/_templates/ts/new-service.mjs order 50107 8107 --db orders
```

The script copies the template to `services/<name>`. It substitutes the package name,
`SERVICE_NAME`, ports, database URL and login, Docker/Compose paths, the image name and the
Compose profile. Then:

- [ ] `pnpm install` (the new package is already in the workspace via `services/*`).
- [ ] **Proto:** add `proto/kade/<domain>/v1/<domain>_service.proto` and `<domain>_events.proto`
      (lead-owned: request it). `pnpm proto:gen`. Switch imports from `@kade/proto/kade/template/v1/template`.
- [ ] **Domain:** replace `src/notes/` and the service tables in `src/db/schema.ts`. Keep `outbox`,
      `processed_events` and `idempotency_keys` exactly as they are.
- [ ] **Migrations:** `rm -r drizzle && pnpm db:generate --name init`. Later changes: edit the
      schema, then `pnpm db:generate --name <what-changed>`. Never edit an applied migration.
- [ ] **Topics:** your aggregate's `kade.<aggregate>.events` and `.dlq` must be in
      `deploy/compose/kafka/create-topics.sh` (lead-owned). Set `@EventConsumer` topics.
- [ ] **Database:** the login/database must be in `deploy/compose/postgres/init/01-databases.sh`
      (registry services already are).
- [ ] **Connector:** start the service once (migrations create `outbox`), then
      `deploy/compose/connect/register-outbox.sh <login> <database>`.
- [ ] **Dependencies:** add `<NAME>_GRPC` addresses and other env vars to `src/platform/config.ts`,
      `.env.example` and `compose.yaml`.
- [ ] **Compose:** ask the lead to add `services/<name>/compose.yaml` to `deploy/compose/services.yaml`.
- [ ] **README:** fill in what it owns, its API, and events in/out.

## Running

Start the shared stack first: `pnpm infra:up` (see `docs/backend/RUNBOOK.md`).

**On the host** (fast loop, against the stack's host ports):

```sh
cp services/_templates/ts/.env.example services/_templates/ts/.env   # adjust ports to your deploy/compose/.env
pnpm --filter @kade/proto build
pnpm --filter @kade/template-ts dev        # tsc --watch + node --watch
```

**In Docker** (the fragment joins the external `kade` network):

```sh
# once included in deploy/compose/services.yaml:
docker compose -f deploy/compose/compose.yaml --profile templates up -d --build template-ts
# image only:
docker build -f services/_templates/ts/Dockerfile -t kade/template-ts:dev .
```

Then register the outbox connector once: `deploy/compose/connect/register-outbox.sh template_ts template_ts`.

Try it (`grpcurl` has no reflection here, so use the generated client):

```sh
cd services/_templates/ts && node --input-type=module -e '
import { credentials, Metadata } from "@grpc/grpc-js";
import { TemplateServiceClient } from "@kade/proto/kade/template/v1/template";
const c = new TemplateServiceClient("localhost:50100", credentials.createInsecure());
const md = new Metadata(); md.set("x-user-id", "me");
c.createNote({ text: "hi", amount: { amountMinor: 115000, currency: "LKR" }, idempotencyKey: "k1" }, md,
  { deadline: Date.now() + 2000 }, (e, r) => { console.log(e ?? r); c.close(); });'
```

Traces: Grafana → Explore → Tempo, service `template-ts`. One trace covers the gRPC call, the
SQL, and (through the outbox `traceparent`) the consumer's processing.

## Testing

```sh
pnpm --filter @kade/template-ts test                  # unit: handlers, errors, context, config (no I/O)
pnpm --filter @kade/template-ts test:integration      # shared stack: Postgres template_ts + Kafka + Debezium
```

The integration suite boots the whole app in-process on random ports. It checks:

- CreateNote writes the note and its outbox row in one transaction.
- Idempotent retries (sequential and concurrent) return the original result; reusing a key with a
  different body is rejected.
- Errors map to status codes with ErrorInfo reasons.
- A note flows outbox → Debezium → Kafka → consumer exactly once.
- Replayed events are deduplicated.
- Poison messages reach the DLQ.

Defaults are `localhost:5432` and `localhost:19092`. Override with `DATABASE_URL` / `KAFKA_BROKERS`
if your `deploy/compose/.env` remaps host ports. It never starts its own containers.

Image: ~73 MB compressed, ~360 MB on disk (Alpine plus only the node binary, `pnpm deploy --prod`,
librdkafka sources pruned, non-root uid 10001). Memory: ~80 MB anonymous at idle under a 192 MB limit.
`docker stats` can show up to ~170 MiB, because it also counts reclaimable page cache (the 120 MB
node binary and node_modules).
