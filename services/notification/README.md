# notification

Scaffolded from `services/_templates/ts` (see its README for how the platform pieces work).

- **Owns:** TODO (tables, aggregate)
- **API:** TODO `kade.notification.v1` (proto/kade/<domain>/v1/<domain>_service.proto)
- **Events out:** TODO aggregate `<x>` -> `kade.<x>.events` (outbox)
- **Events in:** TODO topics consumed (group `notification`)
- **Ports:** gRPC 50114, HTTP 8114 (`/health/live`, `/health/ready`, `/metrics`)
- **Database:** `notification` (login `notification`)

## Run alone

```sh
pnpm infra:up
cp services/notification/.env.example services/notification/.env
pnpm --filter @kade/notification dev
```

## Test

```sh
pnpm --filter @kade/notification test               # unit
pnpm --filter @kade/notification test:integration   # against the shared stack
```
