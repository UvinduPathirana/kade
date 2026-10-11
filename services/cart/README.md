# cart

Scaffolded from `services/_templates/ts` (see its README for how the platform pieces work).

- **Owns:** TODO (tables, aggregate)
- **API:** TODO `kade.cart.v1` (proto/kade/<domain>/v1/<domain>_service.proto)
- **Events out:** TODO aggregate `<x>` -> `kade.<x>.events` (outbox)
- **Events in:** TODO topics consumed (group `cart`)
- **Ports:** gRPC 50104, HTTP 8104 (`/health/live`, `/health/ready`, `/metrics`)
- **Database:** `cart` (login `cart`)

## Run alone

```sh
pnpm infra:up
cp services/cart/.env.example services/cart/.env
pnpm --filter @kade/cart dev
```

## Test

```sh
pnpm --filter @kade/cart test               # unit
pnpm --filter @kade/cart test:integration   # against the shared stack
```
