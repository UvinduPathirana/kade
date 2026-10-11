# Gateway template (`@kade/gateway-rider`)

The starting point for the four backend-for-frontend gateways (`gateway-customer` 8201,
`gateway-merchant` 8202, `gateway-rider` 8203, `gateway-admin` 8204). Each serves exactly one app.
The gateway:

- serves REST/JSON and a WebSocket `/ws`;
- validates Keycloak JWTs and calls services over gRPC, with a deadline and identity metadata on
  every call;
- turns gRPC errors into `application/problem+json` and Money into whole rupees;
- generates an OpenAPI document from its routes, so the apps get typed clients.

Template defaults: HTTP **8203**, upstream `TEMPLATE_GRPC=template-ts:50100`, profile `templates`.

## Why Fastify (not NestJS)

A gateway is mostly routes, schemas and upstream calls; it holds no domain state or consumers.

- **Fastify 5 + TypeBox:** one schema per route does request validation, response serialisation,
  TypeScript types (via the type provider) and the OpenAPI document (`@fastify/swagger`). No
  decorators-to-OpenAPI layer to keep in sync.
- **Lean:** about 74 MB anonymous memory idle in its 160 MB container (template-ts, with Nest, Drizzle and
  librdkafka, is about 80 MB). Fastify's per-request overhead is also lower than Nest + Express.
- **First-party plugins:** `@fastify/websocket`, `@fastify/cors`, and `@fastify/otel` for OTel route spans.

## Layout

| File                  | What                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `src/config.ts`       | Env validation (zod). Add one `<NAME>_GRPC` per upstream                                    |
| `src/auth.ts`         | Keycloak JWT verification (JWKS, issuer, `azp`), realm roles → `Identity`, dev bypass       |
| `src/grpc/clients.ts` | One channel per upstream; retry policy only for idempotent reads                            |
| `src/grpc/call.ts`    | `unary()` adds deadline + `x-user-id`/`x-roles`/`x-outlet-id`, cancels on client disconnect |
| `src/problem.ts`      | gRPC status + ErrorInfo reason → HTTP problem; user-facing copy per reason                  |
| `src/money.ts`        | `toRupees` / `fromRupees`: the only place minor units meet rupees                           |
| `src/schemas.ts`      | Shared TypeBox schemas (named OpenAPI components), `ref()`, `problems()`                    |
| `src/routes/*.ts`     | REST routes, `/ws`, health + metrics                                                        |
| `src/app.ts`          | Fastify assembly: swagger, CORS, websocket, auth hook, error handlers                       |
| `src/openapi.ts`      | Writes `openapi.json` from the routes without starting a server                             |
| `openapi.json`        | Generated; committed so Wave 2 can generate clients without running anything                |

## Auth

Every route requires a valid token unless its config says otherwise:
`config: { auth: "optional" }` (identity if present), `config: { auth: "public" }`, or
`config: { roles: ["merchant_owner", "ops"] }` (403 without one of them).

- **Keycloak:** `Authorization: Bearer <access token>`. The checks are signature (JWKS),
  `iss` = `KEYCLOAK_ISSUER`, and `azp` ∈ `KEYCLOAK_CLIENTS` (each gateway accepts only its own
  app's client). Identity comes from `sub`, realm roles (Kadé roles only), and an optional
  `outlet_id` claim.
- **Issuer vs JWKS URL:** Keycloak signs `iss=http://localhost:8080/realms/kade` (its
  `KC_HOSTNAME`, the browser's view), but inside Docker the keys come from
  `KEYCLOAK_JWKS_URL=http://keycloak:8080/...`. That is why there are two variables.
- **Dev bypass** (`AUTH_DEV_BYPASS=true`, refused unless `DEPLOY_ENV=dev`, logged loudly at start):
  `Authorization: Bearer dev:<userId>:<role,role>[:<outletId>]`, e.g. `dev:dilini:customer`. Real
  JWTs keep working alongside it.

## WebSocket protocol (`/ws`)

Browsers cannot set headers on a WebSocket, and tokens in URLs leak into logs, so the token goes in
the first message:

```jsonc
→ {"type":"auth","token":"<access token or dev:...>"}   // within 5 s, else close 4401
← {"type":"ready","userId":"..."}
→ {"type":"ping"}            ← {"type":"pong"}
← {"type":"note.created","note":{...}}                  // server pushes, per user
```

The in-process `Hub` only reaches sockets on this replica. Cross-replica fan-out (kitchen board,
live tracking) is the Go `realtime` service's job (Redis pub/sub).

## Errors

Every error is `application/problem+json`:

```json
{
  "type": "https://kade.lk/problems/note-not-found",
  "title": "Not found",
  "status": 404,
  "detail": "We couldn't find that note.",
  "code": "NOTE_NOT_FOUND",
  "instance": "/v1/notes/…",
  "traceId": "…"
}
```

`code` is the service's ErrorInfo reason (stable; apps switch on it). `detail` is safe to show.
For 5xx it is always generic, so upstream internals never reach the app. Overrides live in
`USER_MESSAGES` in `src/problem.ts`. Status mapping follows Google's gRPC→HTTP table
(`DEADLINE_EXCEEDED` → 504, `UNAVAILABLE` → 503, …).

## Adding a route

```ts
app.get(
  "/v1/restaurants/:id",
  {
    config: { auth: "optional" },
    schema: {
      operationId: "getRestaurant", // becomes the client method name
      params: Type.Object({ id: Type.String({ format: "uuid" }) }),
      response: { 200: ref(Restaurant), ...problems(404, 503, 504) },
    },
  },
  async (req, reply) => {
    const res = await unary(
      catalog.getRestaurant.bind(catalog),
      { id: req.params.id },
      callContext(req, reply),
    );
    return toRestaurant(res.restaurant); // proto → app shape (rupees, ISO dates)
  },
);
```

Then `pnpm --filter @kade/gateway-rider openapi` and commit `openapi.json`. Mutations take an
`Idempotency-Key` header and forward it as the RPC's `idempotency_key`.

## Copy checklist (new gateway)

- [ ] `cp -r gateways/_template gateways/<app>` (e.g. `gateways/customer`). In `package.json`, rename
      to `@kade/gateway-<app>`. In the `Dockerfile`, `compose.yaml` and `.env.example`, replace
      `gateways/_template`, `gateway-rider` and `8203` with the registry values. Then `pnpm install`.
- [ ] `KEYCLOAK_CLIENTS` = the app's client (`customer-app`, `merchant-app`, `rider-app`, `admin-app`).
      `CORS_ORIGINS` = the app's dev origin (5174, 5175, 5176, 5177).
- [ ] Replace `TEMPLATE_GRPC` / `createTemplateClient` / `routes/notes.ts` with the real upstreams.
      Add each `<NAME>_GRPC` to config, compose and `depends_on`.
- [ ] Compose profile: customer → `ordering`; merchant, rider → `fulfilment`; admin → `engagement`.
      Ask the lead to include the fragment in `deploy/compose/services.yaml`.
- [ ] Regenerate `openapi.json`.

## Run

```sh
pnpm infra:up                                         # shared stack
cp gateways/_template/.env.example gateways/_template/.env
pnpm --filter @kade/proto build
pnpm --filter @kade/gateway-rider dev              # needs template-ts on :50100

curl -s -X POST localhost:8203/v1/notes -H 'Authorization: Bearer dev:dilini:customer' \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: k1' -d '{"text":"hi","amount":1150}'
```

Docker: `docker compose -f deploy/compose/compose.yaml --profile templates up -d --build gateway-rider`
(once the fragment is included). Image: `docker build -f gateways/_template/Dockerfile .` from the repo root.

## Test

```sh
pnpm --filter @kade/gateway-rider test   # routes via inject/injectWS with a fake gRPC client, JWT with a local JWKS
```
