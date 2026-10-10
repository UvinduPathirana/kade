# Kadé backend plan

Goal: learn complex microservices by building a real one. Every service exists because Kadé needs it, and each hard pattern appears where the product actually demands it.

## Decisions

| Area | Choice | Why |
| --- | --- | --- |
| Languages | **TypeScript (NestJS)** for most services, **Go** for high-throughput real-time services, **Java 21 + Spring Boot** for money | Polyglot on purpose: services talk only through gRPC/Protobuf and Kafka schemas, never shared code |
| Sync calls | gRPC between services; REST/JSON + WebSocket at the gateways | Typed contracts, deadlines, streaming |
| Events | **Kafka** + Schema Registry (Protobuf), Debezium for the transactional outbox | Replayable log, partitions, consumer groups |
| Workflows | **Temporal** | Order saga, restaurant accept timer, rider offer timeout as durable code; workers in TS, Go and Java share task queues |
| Identity | Keycloak (OIDC) + `profile` service | Standard tokens for four apps; phone OTP via a custom authenticator |
| Data | Postgres per service, Redis (carts, GEO, pub/sub), OpenSearch (search) | Database-per-service |
| Runtime | Docker Compose → kind + Helm + Tilt → ArgoCD (GitOps), Linkerd later | Learn the slices before the orchestration |
| Observability | OpenTelemetry → Grafana (Tempo traces, Loki logs, Prometheus metrics) | Trace one order across sync and async hops |
| Testing | Unit, Testcontainers, Pact contract tests, k6 load, chaos experiments | |

## Services

| Service | Lang | Owns | Patterns |
| --- | --- | --- | --- |
| `gateway-customer`, `gateway-merchant`, `gateway-rider`, `gateway-admin` | TS | Backend-for-frontend per app | Aggregation, authz at the edge, rate limits |
| `identity` (Keycloak) | — | Accounts, roles, OTP | OIDC, token exchange |
| `profile` | TS | Addresses, favourites, preferences | |
| `catalog` | TS | Restaurants, menus, hours, availability | Caching, events on change |
| `search` | TS | Search index from catalog events | CQRS projection, rebuild by replay |
| `cart` | TS | Carts | Redis, TTL state |
| `pricing` | TS | Zones, fees, surcharges | Pure calculation service, versioned rules |
| `promotion` | Java | Vouchers, budgets, redemptions | Reservations, optimistic locking, budget races |
| `order` | TS | Order aggregate, status timeline | **Temporal saga**, outbox, idempotency keys |
| `payment` | Java | Card (mock PSP) and cash | Idempotent charges, webhooks, retries, circuit breaker |
| `merchant` | TS | Restaurant onboarding, staff, kitchen actions | Durable 3-minute accept timer, outlet-scoped authz |
| `dispatch` | Go | Rider matching and offers | Redis GEO, 30 s offer timeouts, retries |
| `location` | Go | Rider GPS ingest (1 Hz) | Kafka partitioned by rider, backpressure |
| `realtime` | Go | WebSocket fan-out (tracking, kitchen board, rider) | Redis pub/sub, connection scaling |
| `ledger` | Java | Double-entry ledger, commission, payouts, rider cash | Correctness, reconciliation, exactly-once effects |
| `notification` | TS | SMS, push, email | Pure event consumer, retries, dead-letter topics |
| `review` | TS | Ratings and replies | |
| `support` | TS | Tickets, SLAs | |

## Order saga (Temporal, orchestrated by `order`)

1. Validate cart against `catalog` (sold out? closed?) → price with `pricing`
2. Reserve promo with `promotion` (compensate: release)
3. Authorise payment with `payment` (cash: record intent) (compensate: void)
4. Create order, emit `OrderPlaced` via outbox
5. Wait for restaurant: `merchant` signals accept/reject, or a 3-minute timer fires (compensate on reject/timeout: void payment, release promo, notify)
6. On accept → `OrderAccepted` → `dispatch` starts matching (choreography from here)
7. Capture payment on pickup; `OrderDelivered` → `ledger`, `review`, `notification`

## Milestones (each makes a real screen live)

1. **Skeleton** — repo layout (`services/`, `proto/`, `deploy/`), one service template per language, Compose with Postgres/Kafka/Temporal/Keycloak/OTel, CI.
2. **Catalogue + search** — home and restaurant pages on real data; first CQRS projection.
3. **Identity** — Keycloak, OTP sign-in, authorisation at gateways.
4. **Ordering saga** — cart, pricing, promotion, payment, order; checkout live.
5. **Restaurant flow** — accept timer, live kitchen board over WebSockets.
6. **Dispatch + live location** — Go services, GPS stream, tracking map and rider app live.
7. **Money** — ledger, commission, payouts, cash matching; admin finance live.
8. **Engagement** — notifications, reviews, support; admin gateway.
9. **Production-grade** — kind, Helm, Tilt, ArgoCD, Linkerd, chaos, k6, SLOs.

The frontend already isolates data access in each app's `src/api`; each milestone swaps one mock module for real gateway calls.
