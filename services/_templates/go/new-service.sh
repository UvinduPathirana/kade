#!/usr/bin/env bash
# Copies the Go template to services/<name> with module path, names and ports substituted, and
# adds it to go.work.
#
#   services/_templates/go/new-service.sh dispatch 50110 8110
#   services/_templates/go/new-service.sh realtime 0 8112     # HTTP/WebSocket only: gRPC port 0 = none
#
# Then follow the checklist in services/<name>/README.md ("After copying").
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <name> <grpcPort> <httpPort>   (ports from docs/backend/CONVENTIONS.md)" >&2
  exit 64
fi
NAME="$1" GRPC_PORT="$2" HTTP_PORT="$3"
[[ "$NAME" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "name must be lowercase kebab-case: $NAME" >&2; exit 64; }
[[ "$GRPC_PORT" =~ ^[0-9]+$ && "$HTTP_PORT" =~ ^[0-9]+$ ]] || { echo "ports must be numbers" >&2; exit 64; }

SRC="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SRC/../../.." && pwd)"
DEST="$ROOT/services/$NAME"
DB="${NAME//-/_}" # login and database name (dev: password = login)
[[ -e "$DEST" ]] && { echo "$DEST already exists" >&2; exit 1; }

mkdir -p "$DEST"
trap 'echo "failed: removing $DEST" >&2; rm -rf "$DEST"' ERR
# Copy everything except this script and local build output.
tar -C "$SRC" --exclude=./new-service.sh --exclude=./bin -cf - . | tar -C "$DEST" -xf -

# GRPC_PORT=0 means "no gRPC server" for this service; keep a free placeholder in config and say so.
GRPC_SUB="$GRPC_PORT"
[[ "$GRPC_PORT" == 0 ]] && GRPC_SUB="5${HTTP_PORT}"

# Order matters: most specific strings first.
SED_EXPR=(
  -e "s#github.com/UvinduPathirana/kade/services/_templates/go#github.com/UvinduPathirana/kade/services/${NAME}#g"
  -e "s#\.\./\.\./\.\./gen/go#../../gen/go#g"
  -e "s#services/_templates/go#services/${NAME}#g"
  -e "s#context: \.\./\.\./\.\.#context: ../..#g"
  -e "s#template_go#${DB}#g"
  -e "s#template-go#${NAME}#g"
  -e "s#50192#${GRPC_SUB}#g"
  -e "s#8192#${HTTP_PORT}#g"
  -e "s|profiles: \[templates\]|profiles: [CHANGE_ME] # ordering, fulfilment, money or engagement|"
)
# Text files only.
while IFS= read -r -d '' f; do
  if LC_ALL=C grep -Iq . "$f" 2>/dev/null; then
    sed "${SED_EXPR[@]}" "$f" > "$f.tmp"
    cat "$f.tmp" > "$f" # keep the original file mode (new-service copies keep scripts executable)
    rm "$f.tmp"
  fi
done < <(find "$DEST" -type f -print0)

# Register in go.work (idempotent).
WORK="$ROOT/go.work"
if ! grep -q "\./services/${NAME}\$" "$WORK"; then
  awk -v line="	./services/${NAME}" '
    /^use \(/ { inuse=1 }
    inuse && /^\)/ { print line; inuse=0 }
    { print }
  ' "$WORK" > "$WORK.tmp" && mv "$WORK.tmp" "$WORK"
fi

cat <<EOF
Created services/${NAME} (module github.com/UvinduPathirana/kade/services/${NAME})
  SERVICE_NAME=${NAME}  GRPC_PORT=${GRPC_SUB}  HTTP_PORT=${HTTP_PORT}  DB=${DB}  consumer group=${NAME}
  go.work: ./services/${NAME} added

Next (see services/${NAME}/README.md, "After copying"):
  1. Set the Compose profile in services/${NAME}/compose.yaml (now CHANGE_ME).
  2. Replace internal/note + migrations/00001_init.sql with your domain; keep outbox/processed_events/idempotency_keys.
  3. Register your proto service in internal/app/app.go (registerAPI) and consumers (registerConsumers).
  4. Ask the lead for: database/login '${DB}' in deploy/compose/postgres/init, topics, the services.yaml include.
EOF
[[ "$GRPC_PORT" == 0 ]] && echo "  NOTE: no gRPC port in the registry: GRPC_PORT=${GRPC_SUB} is a placeholder; remove the gRPC server in internal/app/app.go if unused."
exit 0
