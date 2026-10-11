# syntax=docker/dockerfile:1.7
# Build context is the REPO ROOT:
#   docker build -f gateways/_template/Dockerfile -t kade/gateway-merchant .

ARG NODE_IMAGE=node:24.21.0-alpine3.24
ARG ALPINE_IMAGE=alpine:3.24

FROM ${NODE_IMAGE} AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY gen/ts/package.json gen/ts/
COPY gateways/_template/package.json gateways/_template/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@kade/gateway-merchant..."
COPY gen/ts gen/ts
COPY gateways/_template gateways/_template
RUN pnpm --filter @kade/proto build && pnpm --filter @kade/gateway-merchant build
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @kade/gateway-merchant deploy --prod --legacy /out \
 # @kade/proto has no "files" field and git-ignores dist/, so deploy skips its build output.
 && cp -R gen/ts/dist "$(readlink -f /out/node_modules/@kade/proto)/"

# Plain Alpine plus the node binary (no npm/corepack/yarn); non-root; code owned by root.
FROM ${ALPINE_IMAGE}
RUN apk add --no-cache libstdc++ \
 && addgroup -S -g 10001 app && adduser -S -u 10001 -G app app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /out ./
USER app
ENV NODE_ENV=production
EXPOSE 8202
CMD ["node", "--enable-source-maps", "--import", "./dist/instrumentation.js", "dist/main.js"]
