# syntax=docker/dockerfile:1.7
# Build context: the REPO ROOT (the service imports the generated code in gen/go).
#   docker build -f services/_templates/go/Dockerfile -t kade/template-go .

FROM golang:1.25 AS build
ENV CGO_ENABLED=0 GOWORK=off GOTOOLCHAIN=local GOFLAGS=-buildvcs=false
# Mirror the repo layout so go.mod's `replace ... => ../../../gen/go` resolves.
WORKDIR /src/services/_templates/go

# Dependencies first so they stay cached across source edits.
COPY gen/go/go.mod gen/go/go.sum /src/gen/go/
COPY services/_templates/go/go.mod services/_templates/go/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY gen/go /src/gen/go
COPY services/_templates/go ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# distroless/static: CA certs + tzdata, no shell, runs as uid 65532.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /app/server
USER nonroot:nonroot
EXPOSE 50192 8192
ENTRYPOINT ["/app/server"]
