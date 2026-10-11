# review

Scaffolded from `services/_templates/ts` (see its README for how the platform pieces work).

- **Owns:** TODO (tables, aggregate)
- **API:** TODO `kade.review.v1` (proto/kade/<domain>/v1/<domain>_service.proto)
- **Events out:** TODO aggregate `<x>` -> `kade.<x>.events` (outbox)
- **Events in:** TODO topics consumed (group `review`)
- **Ports:** gRPC 50115, HTTP 8115 (`/health/live`, `/health/ready`, `/metrics`)
- **Database:** `review` (login `review`)

## Run alone

```sh
pnpm infra:up
cp services/review/.env.example services/review/.env
pnpm --filter @kade/review dev
```

## Test

```sh
pnpm --filter @kade/review test               # unit
pnpm --filter @kade/review test:integration   # against the shared stack
```
