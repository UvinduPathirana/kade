# syntax=docker/dockerfile:1.7
# Build context is the REPO ROOT (the service needs gen/ts and the workspace lockfile):
#   docker build -f services/order/Dockerfile -t kade/order .
#
# glibc (Debian bookworm), not Alpine: the Temporal worker's native core (@temporalio/core-bridge)
# ships Linux binaries for glibc only, so it cannot load on musl.

ARG NODE_IMAGE=node:24.21.0-bookworm-slim
ARG RUNTIME_IMAGE=debian:bookworm-slim

# ---------------------------------------------------------------- build
FROM ${NODE_IMAGE} AS build
RUN corepack enable
WORKDIR /repo
# Manifests first: the dependency layer is cached until a package.json or the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY gen/ts/package.json gen/ts/
COPY services/order/package.json services/order/
# Own store cache (not the Alpine services' one): pnpm's side-effects cache would otherwise hand us
# librdkafka built for musl.
RUN --mount=type=cache,id=pnpm-store-glibc,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --config.side-effects-cache=false --filter "@kade/order..."
COPY gen/ts gen/ts
COPY services/order services/order
# `build` also bundles the workflow code into dist/workflow-bundle.js (no webpack run at boot).
RUN pnpm --filter @kade/proto build && pnpm --filter @kade/order build
# Production-only node_modules + dist + drizzle/ into /out (workspace deps copied, not symlinked).
RUN --mount=type=cache,id=pnpm-store-glibc,target=/root/.local/share/pnpm/store \
    pnpm --filter @kade/order deploy --prod --legacy /out \
 # librdkafka sources and object files (~27 MB) are only needed to compile the binding.
 && (cd "$(readlink -f /out/node_modules/@confluentinc/kafka-javascript)" && rm -rf deps src build/Release/obj.target) \
 # Temporal core: keep only this platform's native library (the package ships five).
 && arch="$(uname -m | sed 's/arm64/aarch64/')" \
 && find /out/node_modules/.pnpm -path '*@temporalio/core-bridge/releases/*' -maxdepth 6 -mindepth 6 -type d \
      ! -name "${arch}-unknown-linux-gnu" -exec rm -rf {} + \
 # The workflow bundle is prebuilt, so the bundler's compilers are never run: drop swc and esbuild
 # binaries (webpack itself stays; @temporalio/worker requires it at load time).
 && rm -rf /out/node_modules/.pnpm/@swc+core-* /out/node_modules/.pnpm/@esbuild+* \
 # Fail the build, not the boot, if a native binding is missing.
 && cd /out && node -e "require('@confluentinc/kafka-javascript'); require('@temporalio/worker'); console.log('native modules ok')"

# ---------------------------------------------------------------- runtime
# Debian slim plus the node binary: no npm, corepack or yarn. wget is for the Compose healthcheck.
FROM ${RUNTIME_IMAGE}
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 app && useradd -u 10001 -g app -M -s /usr/sbin/nologin app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
# Owned by root, run as app: the process cannot modify its own code.
COPY --from=build /out ./
USER app
ENV NODE_ENV=production
EXPOSE 50107 8107
CMD ["node", "--enable-source-maps", "--import", "./dist/instrumentation.js", "dist/main.js"]
