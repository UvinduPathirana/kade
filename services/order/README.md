# order

Scaffolded from `services/_templates/ts` (see its README for how the platform pieces work).

- **Owns:** TODO (tables, aggregate)
- **API:** TODO `kade.order.v1` (proto/kade/<domain>/v1/<domain>_service.proto)
- **Events out:** TODO aggregate `<x>` -> `kade.<x>.events` (outbox)
- **Events in:** TODO topics consumed (group `order`)
- **Ports:** gRPC 50107, HTTP 8107 (`/health/live`, `/health/ready`, `/metrics`)
- **Database:** `orders` (login `order`)

## Run alone

```sh
pnpm infra:up
cp services/order/.env.example services/order/.env
pnpm --filter @kade/order dev
```

## Test

```sh
pnpm --filter @kade/order test               # unit
pnpm --filter @kade/order test:integration   # against the shared stack
```
