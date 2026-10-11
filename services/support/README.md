# support

Scaffolded from `services/_templates/ts` (see its README for how the platform pieces work).

- **Owns:** TODO (tables, aggregate)
- **API:** TODO `kade.support.v1` (proto/kade/<domain>/v1/<domain>_service.proto)
- **Events out:** TODO aggregate `<x>` -> `kade.<x>.events` (outbox)
- **Events in:** TODO topics consumed (group `support`)
- **Ports:** gRPC 50116, HTTP 8116 (`/health/live`, `/health/ready`, `/metrics`)
- **Database:** `support` (login `support`)

## Run alone

```sh
pnpm infra:up
cp services/support/.env.example services/support/.env
pnpm --filter @kade/support dev
```

## Test

```sh
pnpm --filter @kade/support test               # unit
pnpm --filter @kade/support test:integration   # against the shared stack
```
