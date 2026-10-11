# Backend runbook (local stack)

The shared infrastructure lives in `deploy/compose/`. Services never run their own Kafka or Postgres; they all use this stack.

> **Host ports on this laptop:** Postgres is on **15432**, not 5432, because Homebrew `postgresql@16` already listens on `127.0.0.1:5432`. Grafana is on **3001** because a Next.js dev server uses 3000. Both come from `deploy/compose/.env`, which is git-ignored. Every other port matches `CONVENTIONS.md`. In-network addresses never change (`postgres:5432` and so on).

## Start / stop

```bash
pnpm infra:up                      # docker compose -f deploy/compose/compose.yaml up -d  (core infra)
pnpm infra:down                    # stop + remove containers, keep data volumes
docker compose -f deploy/compose/compose.yaml ps            # health of everything
docker compose -f deploy/compose/compose.yaml logs -f kafka # logs of one container
```

Give it about 60–90 s on a cold start. Keycloak and Temporal are the slowest. Everything has a healthcheck, so `ps` shows `(healthy)` when the stack is ready. `kafka-init` is a one-shot job and should show `Exited (0)`.

Tip: `alias kc='docker compose -f deploy/compose/compose.yaml'`. The rest of this page writes it out in full.

## Profiles

Services without a profile always start. That set is **`core`**, and it's what `pnpm infra:up` starts. You don't need a flag for it.

| Profile | Contents | Start with |
| --- | --- | --- |
| `core` | Postgres, Redis, Kafka (+ topic init), Schema Registry, Kafka Connect/Debezium, Temporal (+ UI, admin-tools), Keycloak, otel-lgtm | `pnpm infra:up` |
| `ordering` | catalog, search, profile, cart, pricing, promotion, order, payment, gateway-customer | `… --profile ordering up -d` |
| `fulfilment` | merchant, dispatch, location, realtime, gateway-merchant, gateway-rider | `--profile fulfilment` |
| `money` | ledger (payment and promotion also join `money`) | `--profile money` |
| `engagement` | notification, review, support, gateway-admin | `--profile engagement` |
| `obs` | reserved for heavier observability add-ons. `otel-lgtm` is always on because it's the OTLP endpoint. | `--profile obs` |
| `tools` | Kafka UI | `--profile tools` |

You can combine profiles, for example `docker compose -f deploy/compose/compose.yaml --profile ordering --profile tools up -d`.

### Adding a service (the `include:` mechanism)

`compose.yaml` includes `services.yaml`, and `services.yaml` lists one `include:` entry per `services/<name>/compose.yaml`. The lead owns that list. Ask the lead to enable your fragment. The three template paths are already there, commented out.

A fragment looks like this (tested: `depends_on` on infra services and the shared network both work across the include):

```yaml
services:
  order:
    build: { context: ../.., dockerfile: services/order/Dockerfile }   # paths relative to the fragment
    profiles: [ordering]
    environment:
      SERVICE_NAME: order
      DATABASE_URL: postgres://order:order@postgres:5432/orders
      KAFKA_BROKERS: kafka:9092
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel:4318
    depends_on:
      postgres: { condition: service_healthy }
      kafka: { condition: service_healthy }
    healthcheck: { test: ["CMD", "wget", "-qO-", "http://localhost:8107/health/ready"], interval: 10s }
    deploy: { resources: { limits: { memory: 256m } } }
    networks: [kade]
networks:
  kade: { name: kade, external: true }
```

Rules for every fragment:

- Put the service in exactly one profile, so `pnpm infra:up` still starts infra only.
- Join the `kade` network as `external`.
- Set a memory limit and a healthcheck.
- Cap the JVM heap for Java services (`JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=70`).

## URLs and credentials

| What | Host | In-network | Credentials |
| --- | --- | --- | --- |
| Postgres 17 | `localhost:15432` (this laptop; default 5432) | `postgres:5432` | superuser `postgres`/`postgres`; per service `<svc>`/`<svc>` |
| Kafka (KRaft) | `localhost:19092` | `kafka:9092` | none (PLAINTEXT) |
| Schema Registry | http://localhost:8085 | `http://schema-registry:8081` | — |
| Kafka Connect (Debezium) | http://localhost:8083 | `http://connect:8083` | — |
| Temporal gRPC | `localhost:7233` | `temporal:7233` | namespace **`kade`** |
| Temporal UI | http://localhost:8233 | — | — |
| Keycloak | http://localhost:8080 | `http://keycloak:8080` | master admin `admin`/`admin` (http://localhost:8080/admin) |
| Redis 7 | `localhost:6379` | `redis:6379` | — |
| Grafana (otel-lgtm) | http://localhost:3001 (this laptop; default 3000) | — | anonymous admin |
| OTLP | `localhost:4317` (gRPC), http://localhost:4318 | `otel:4317`, `http://otel:4318` | — |
| Kafka UI (`tools`) | http://localhost:8090 | — | — |

### Databases

One database and one login per service. In dev the password is the same as the user. Each login can only connect to its own database, because `CONNECT` is revoked from `PUBLIC`. Service logins have `REPLICATION` so Debezium can read their WAL.

| Login | Database | | Login | Database |
| --- | --- | --- | --- | --- |
| catalog | catalog | | dispatch | dispatch |
| search | search | | ledger | ledger |
| profile | profile | | notification | notification |
| pricing | pricing | | review | review |
| promotion | promotion | | support | support |
| **order** | **orders** | | template_ts | template_ts |
| payment | payment | | template_go | template_go |
| merchant | merchant | | template_java | template_java |
| temporal | temporal, temporal_visibility | | keycloak | keycloak |

```bash
psql postgres://template_ts:template_ts@localhost:15432/template_ts
docker compose -f deploy/compose/compose.yaml exec postgres psql -U postgres     # superuser shell
```

`order` is a reserved word in SQL. Quote it in DDL (`"order"`). URLs don't need quoting.

### Kafka topics

`kafka-init` creates these topics. Auto-creation is **off**, so a topic that isn't listed here doesn't exist. Ask the lead to add new ones to `deploy/compose/kafka/create-topics.sh`.

| Topic | Partitions | Retention |
| --- | --- | --- |
| `kade.{restaurant,menu,customer,promotion,order,payment,merchant,delivery,ledger,review,ticket}.events` | 6 | 7 days |
| `kade.note.events` (service templates) | 6 | 7 days |
| `kade.<aggregate>.events.dlq` (one per topic above) | 1 | 14 days |
| `kade.rider.locations` | 12 | 1 day |
| `kade.rider.locations.dlq` | 1 | 14 days |

```bash
docker compose -f deploy/compose/compose.yaml run --rm kafka-init      # re-create after a reset (idempotent)
docker compose -f deploy/compose/compose.yaml exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
# tail a topic with headers:
docker compose -f deploy/compose/compose.yaml exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 --topic kade.order.events --from-beginning \
  --formatter-property print.key=true --formatter-property print.headers=true
```

### Keycloak realm `kade`

The realm is imported from `deploy/compose/keycloak/kade-realm.json` on first boot.

- **Clients:** four public clients with PKCE (S256): `customer-app` (http://localhost:5174/*), `merchant-app` (5175), `rider-app` (5176), `admin-app` (5177). Direct-access (password) grants are enabled for dev scripts and tests.
- **Roles:** `customer`, `merchant_staff`, `merchant_owner`, `rider`, `ops`, `finance`, `support`, `admin`. Roles are in the access token under `realm_access.roles`.
- **Default role:** `customer` is in the realm's default role, so self-registered users (and every demo user) also have `customer`. Check for the specific role you need, not for the absence of other roles.

Demo users all have the password **`kade123`**:

| User | Roles |
| --- | --- |
| `dilini` | customer |
| `ruwan` | merchant_owner, merchant_staff |
| `kasun` | merchant_staff |
| `nimal` | rider |
| `ops` | ops |
| `finance` | finance |
| `support` | support |
| `admin` | admin, ops, finance, support |

```bash
curl -s http://localhost:8080/realms/kade/.well-known/openid-configuration
curl -s -d grant_type=password -d client_id=customer-app -d username=dilini -d password=kade123 \
  http://localhost:8080/realms/kade/protocol/openid-connect/token
```

**Issuer:** `KC_HOSTNAME` is set, so every token has `iss = http://localhost:8080/realms/kade`, even when the token was fetched from inside the network. Discovery fetched from inside the network still returns in-network URLs for the backchannel (`jwks_uri = http://keycloak:8080/realms/kade/protocol/openid-connect/certs`). Gateways should do two things:

- Validate `iss` against `http://localhost:8080/realms/kade`.
- Load the JWKS from `http://keycloak:8080/realms/kade/protocol/openid-connect/certs`, or from discovery at `http://keycloak:8080/realms/kade/.well-known/openid-configuration`.

## Registering a service's outbox connector

Run this after the service's first migration has created `public.outbox` (schema in `CONVENTIONS.md`). If the table is missing, the script exits with code 2 and a clear message.

```bash
deploy/compose/connect/register-outbox.sh <service> <database>
deploy/compose/connect/register-outbox.sh order orders
deploy/compose/connect/register-outbox.sh template_ts template_ts
```

The script runs `PUT /connectors/outbox-<service>/config`, so it creates the connector or updates it in place. It then waits for the task to be `RUNNING`. Here's what the connector does:

- Logs in as `<service>`/`<service>` and uses replication slot and publication `outbox_<service>`, with a filtered publication on `public.outbox` only.
- Routes by `aggregatetype` to `kade.<aggregatetype>.events`. The topic must already exist, because auto-create is off.
- Sets the key to `aggregateid` (string) and the value to the raw `payload` bytes (`ByteArrayConverter`).
- Adds headers `id`, `eventType` (= `type`) and `traceparent`. When the column is NULL, the `traceparent` header has a null value.
- Uses `snapshot.mode=initial`: rows already in the table are published once when the connector is first registered. Consumers dedupe on `id` anyway.
- Sends a heartbeat every 60 s so idle databases don't pin WAL. The heartbeat records are filtered out, so no heartbeat topic is needed.

Optional environment variables: `CONNECT_URL` (default `http://localhost:8083`), `DB_HOST` (default `postgres`), `DB_PASSWORD`, `SNAPSHOT_MODE`.

```bash
curl -s localhost:8083/connectors?expand=status | jq            # all connectors + state
curl -s -X POST localhost:8083/connectors/outbox-order/restart?includeTasks=true
curl -s -X DELETE localhost:8083/connectors/outbox-order        # remove connector...
docker compose -f deploy/compose/compose.yaml exec postgres psql -U postgres -d orders \
  -c "select pg_drop_replication_slot('outbox_order')" -c "drop publication if exists outbox_order"   # ...and its slot
```

Always drop the slot when you delete a connector for good. An orphaned slot keeps WAL until `max_slot_wal_keep_size` (1 GB) invalidates it.

## Temporal

```bash
docker compose -f deploy/compose/compose.yaml exec temporal-admin-tools temporal operator namespace describe -n kade
docker compose -f deploy/compose/compose.yaml exec temporal-admin-tools temporal workflow list -n kade
```

Workers connect to `temporal:7233` (in-network) or `localhost:7233` (host) with namespace `kade`. Retention is 72 h.

## Observability

Send OTLP to `http://otel:4318` (HTTP) or `otel:4317` (gRPC). Grafana has Tempo, Loki and Prometheus pre-wired under Explore. Smoke test:

```bash
curl -X POST localhost:4318/v1/traces -H 'Content-Type: application/json' -d '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"smoke"}}]},"scopeSpans":[{"spans":[{"traceId":"5b8efff798038103d269b633813fc60c","spanId":"eee19b7ec3c1b174","name":"smoke","kind":1,"startTimeUnixNano":"1","endTimeUnixNano":"2"}]}]}]}'
```

## Reset data

```bash
pnpm infra:down
docker volume rm kade_postgres-data     # all databases (re-runs postgres/init on next up; Keycloak re-imports the realm)
docker volume rm kade_kafka-data        # all topics, offsets and Connect state (connectors must be re-registered)
docker volume rm kade_redis-data kade_otel-data
pnpm infra:up
```

To wipe everything at once: `docker compose -f deploy/compose/compose.yaml down -v`.

Some resets have side effects:

- If you reset only Postgres, the replication slots disappear. Re-register connectors after migrations.
- If you reset only Kafka, Connect's offsets disappear, and `snapshot.mode=initial` re-publishes the rows still in each outbox table.
- If you change the realm JSON, Keycloak won't re-import over an existing realm. Delete the realm in the admin console, or reset Postgres.

## Memory

Every container has a hard limit and every JVM has a heap cap:

| Container | Image | Limit | Heap cap | Measured (idle, warm) |
| --- | --- | --- | --- | --- |
| postgres | `postgres:17.11-alpine` | 512 MiB | shared_buffers 128 MB | 157 MiB |
| redis | `redis:7.4.11-alpine` | 128 MiB | maxmemory 96 MB | 7 MiB |
| kafka | `apache/kafka:4.3.1` | 1 GiB | `-Xmx512m` | 450 MiB |
| kafka-init (one-shot) | `apache/kafka:4.3.1` | 256 MiB | `-Xmx128m` | exits |
| schema-registry | `confluentinc/cp-schema-registry:8.2.4` | 384 MiB | `-Xmx192m` | 257 MiB |
| connect | `quay.io/debezium/connect:3.7.0.Final` | 1 GiB | `-Xmx512m` | 595 MiB (peaked at 778 MiB before restart) |
| temporal | `temporalio/auto-setup:1.29.7` | 512 MiB | — | 184 MiB |
| temporal-admin-tools | `temporalio/admin-tools:1.29.7-tctl-1.18.4-cli-1.7.2` | 64 MiB | — | 6 MiB |
| temporal-ui | `temporalio/ui:2.55.0` | 128 MiB | — | 9 MiB |
| keycloak | `quay.io/keycloak/keycloak:26.8.0` | 768 MiB | `-Xmx384m` | 465 MiB |
| otel | `grafana/otel-lgtm:0.36.0` | 1 GiB | `GOMEMLIMIT=128MiB` per process | 527 MiB (was 859 MiB without `GOMEMLIMIT`) |
| kafka-ui (`tools`) | `kafbat/kafka-ui:v1.5.0` | 384 MiB | `-Xmx256m` | 300 MiB |

Totals for the core stack, from `docker stats --no-stream` on 2026-10-12 with one outbox connector registered:

- **2.6 GiB** used at idle (warm).
- About **3.2 GiB** after Connect has been busy for a while.
- **5.4 GiB** if every container hit its limit at once.
- Kafka UI adds about 0.3 GiB.

Disk: the `kafka-data` volume reports about 2.8 GB because Kafka preallocates index files sparsely. Real usage is a few MB.

Docker Desktop currently has about 7.7 GB. That leaves about 4.5 GB for services, or roughly 15 small TS/Go services at 128–256 MiB each, plus at most one Java build at a time. Raise Docker Desktop to 10–12 GB before running more than one profile.

## Troubleshooting

- **`psql` on localhost:5432 reaches the wrong server.** That's Homebrew Postgres 16. Use port 15432 (see `deploy/compose/.env`), or stop Homebrew Postgres with `brew services stop postgresql@16`, delete the `.env` line and run `pnpm infra:up`.
- **"Bind for 0.0.0.0:NNNN failed: port is already allocated".** Something else owns that host port. Override it in `deploy/compose/.env` (see `.env.example`).
- **A container keeps restarting with exit code 137.** It's being OOM-killed. Check `docker stats`. Raise the limit in `compose.yaml` (lead-owned), or reduce the heap.
- **The connector task is `FAILED`.** Run `curl -s localhost:8083/connectors/outbox-<svc>/status | jq -r '.tasks[0].trace'`. Common causes:
  - The outbox table is missing. Run migrations first.
  - The topic `kade.<aggregatetype>.events` doesn't exist. `aggregatetype` must match the registry.
  - The table's columns differ from the convention.
- **The connector is RUNNING but nothing arrives.** Check that `aggregatetype` matches a topic, and that the insert was committed. Look for errors with `docker compose … logs connect | grep -i error`.
- **A producer gets `UNKNOWN_TOPIC_OR_PARTITION`.** Auto-create is off. Add the topic to `create-topics.sh`, then run `docker compose … run --rm kafka-init`.
- **A host client can't reach Kafka.** Use `localhost:19092`. Port 9092 only works inside the `kade` network.
- **Keycloak token `iss` doesn't match.** Expect `http://localhost:8080/realms/kade` (see "Issuer" above).
- **Temporal "namespace kade not found".** Temporal is still starting. Wait for `(healthy)`. The healthcheck describes the `kade` namespace.
- **Compose warns "Found orphan containers".** A fragment was removed from `services.yaml`. Add `--remove-orphans`.
