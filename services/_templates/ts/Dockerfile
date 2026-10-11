# syntax=docker/dockerfile:1.7
# Build context is the REPO ROOT (the service needs gen/ts and the workspace lockfile):
#   docker build -f services/_templates/ts/Dockerfile -t kade/template-ts .
# new-service.mjs rewrites the paths and package name below when copying the template.

ARG NODE_IMAGE=node:24.21.0-alpine3.24
ARG ALPINE_IMAGE=alpine:3.24

# ---------------------------------------------------------------- build
FROM ${NODE_IMAGE} AS build
RUN corepack enable
WORKDIR /repo
# Manifests first: the dependency layer is cached until a package.json or the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY gen/ts/package.json gen/ts/
COPY services/_templates/ts/package.json services/_templates/ts/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@kade/template-ts..."
COPY gen/ts gen/ts
COPY services/_templates/ts services/_templates/ts
RUN pnpm --filter @kade/proto build && pnpm --filter @kade/template-ts build
# Production-only node_modules + dist + drizzle/ into /out (workspace deps copied, not symlinked).
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @kade/template-ts deploy --prod --legacy /out \
 # @kade/proto has no "files" field and git-ignores dist/, so deploy skips its build output.
 && cp -R gen/ts/dist "$(readlink -f /out/node_modules/@kade/proto)/" \
 # librdkafka sources and object files (~27 MB) are only needed to compile the binding.
 && (cd "$(readlink -f /out/node_modules/@confluentinc/kafka-javascript)" && rm -rf deps src build/Release/obj.target) \
 # Fail the build, not the boot, if the native binding is missing (pnpm onlyBuiltDependencies).
 && node -e "require('/out/node_modules/@confluentinc/kafka-javascript')"

# ---------------------------------------------------------------- runtime
# Plain Alpine plus the node binary: no npm, corepack or yarn (~40 MB less than the node image).
FROM ${ALPINE_IMAGE}
RUN apk add --no-cache libstdc++ \
 && addgroup -S -g 10001 app && adduser -S -u 10001 -G app app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
# Owned by root, run as app: the process cannot modify its own code.
COPY --from=build /out ./
USER app
ENV NODE_ENV=production
EXPOSE 50100 8100
CMD ["node", "--enable-source-maps", "--import", "./dist/instrumentation.js", "dist/main.js"]
