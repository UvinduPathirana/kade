# syntax=docker/dockerfile:1.7
# Build context: the REPO ROOT (the service imports the generated code in gen/go).
#   docker build -f services/realtime/Dockerfile -t kade/realtime .

FROM golang:1.25 AS build
ENV CGO_ENABLED=0 GOWORK=off GOTOOLCHAIN=local GOFLAGS=-buildvcs=false
# Mirror the repo layout so go.mod's `replace ... => ../../gen/go` resolves.
WORKDIR /src/services/realtime

# Dependencies first so they stay cached across source edits.
COPY gen/go/go.mod gen/go/go.sum /src/gen/go/
COPY services/realtime/go.mod services/realtime/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY gen/go /src/gen/go
COPY services/realtime ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server && \
    go build -trimpath -ldflags="-s -w" -o /out/wswatch ./cmd/wswatch

# distroless/static: CA certs + tzdata, no shell, runs as uid 65532.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /app/server
# Test client: docker exec <container> /app/wswatch -user ... -roles ops ops:live
COPY --from=build /out/wswatch /app/wswatch
USER nonroot:nonroot
EXPOSE 8112
ENTRYPOINT ["/app/server"]
