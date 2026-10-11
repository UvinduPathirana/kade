# profile

Scaffolded from `services/_templates/ts` (see its README for how the platform pieces work).

- **Owns:** TODO (tables, aggregate)
- **API:** TODO `kade.profile.v1` (proto/kade/<domain>/v1/<domain>_service.proto)
- **Events out:** TODO aggregate `<x>` -> `kade.<x>.events` (outbox)
- **Events in:** TODO topics consumed (group `profile`)
- **Ports:** gRPC 50103, HTTP 8103 (`/health/live`, `/health/ready`, `/metrics`)
- **Database:** `profile` (login `profile`)

## Run alone

```sh
pnpm infra:up
cp services/profile/.env.example services/profile/.env
pnpm --filter @kade/profile dev
```

## Test

```sh
pnpm --filter @kade/profile test               # unit
pnpm --filter @kade/profile test:integration   # against the shared stack
```
