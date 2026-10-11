# catalog

Scaffolded from `services/_templates/ts` (see its README for how the platform pieces work).

- **Owns:** TODO (tables, aggregate)
- **API:** TODO `kade.catalog.v1` (proto/kade/<domain>/v1/<domain>_service.proto)
- **Events out:** TODO aggregate `<x>` -> `kade.<x>.events` (outbox)
- **Events in:** TODO topics consumed (group `catalog`)
- **Ports:** gRPC 50101, HTTP 8101 (`/health/live`, `/health/ready`, `/metrics`)
- **Database:** `catalog` (login `catalog`)

## Run alone

```sh
pnpm infra:up
cp services/catalog/.env.example services/catalog/.env
pnpm --filter @kade/catalog dev
```

## Test

```sh
pnpm --filter @kade/catalog test               # unit
pnpm --filter @kade/catalog test:integration   # against the shared stack
```
