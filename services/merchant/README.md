# merchant

Scaffolded from `services/_templates/ts` (see its README for how the platform pieces work).

- **Owns:** TODO (tables, aggregate)
- **API:** TODO `kade.merchant.v1` (proto/kade/<domain>/v1/<domain>_service.proto)
- **Events out:** TODO aggregate `<x>` -> `kade.<x>.events` (outbox)
- **Events in:** TODO topics consumed (group `merchant`)
- **Ports:** gRPC 50109, HTTP 8109 (`/health/live`, `/health/ready`, `/metrics`)
- **Database:** `merchant` (login `merchant`)

## Run alone

```sh
pnpm infra:up
cp services/merchant/.env.example services/merchant/.env
pnpm --filter @kade/merchant dev
```

## Test

```sh
pnpm --filter @kade/merchant test               # unit
pnpm --filter @kade/merchant test:integration   # against the shared stack
```
