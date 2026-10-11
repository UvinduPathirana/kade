# pricing

Scaffolded from `services/_templates/ts` (see its README for how the platform pieces work).

- **Owns:** TODO (tables, aggregate)
- **API:** TODO `kade.pricing.v1` (proto/kade/<domain>/v1/<domain>_service.proto)
- **Events out:** TODO aggregate `<x>` -> `kade.<x>.events` (outbox)
- **Events in:** TODO topics consumed (group `pricing`)
- **Ports:** gRPC 50105, HTTP 8105 (`/health/live`, `/health/ready`, `/metrics`)
- **Database:** `pricing` (login `pricing`)

## Run alone

```sh
pnpm infra:up
cp services/pricing/.env.example services/pricing/.env
pnpm --filter @kade/pricing dev
```

## Test

```sh
pnpm --filter @kade/pricing test               # unit
pnpm --filter @kade/pricing test:integration   # against the shared stack
```
