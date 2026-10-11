# search

Scaffolded from `services/_templates/ts` (see its README for how the platform pieces work).

- **Owns:** TODO (tables, aggregate)
- **API:** TODO `kade.search.v1` (proto/kade/<domain>/v1/<domain>_service.proto)
- **Events out:** TODO aggregate `<x>` -> `kade.<x>.events` (outbox)
- **Events in:** TODO topics consumed (group `search`)
- **Ports:** gRPC 50102, HTTP 8102 (`/health/live`, `/health/ready`, `/metrics`)
- **Database:** `search` (login `search`)

## Run alone

```sh
pnpm infra:up
cp services/search/.env.example services/search/.env
pnpm --filter @kade/search dev
```

## Test

```sh
pnpm --filter @kade/search test               # unit
pnpm --filter @kade/search test:integration   # against the shared stack
```
