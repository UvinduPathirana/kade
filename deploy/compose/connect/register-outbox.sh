#!/usr/bin/env bash
# Registers (or updates) the Debezium outbox connector for one service database.
#
#   deploy/compose/connect/register-outbox.sh <service> <database>
#   deploy/compose/connect/register-outbox.sh order orders
#   deploy/compose/connect/register-outbox.sh template_ts template_ts
#
# Reads <database>.public.outbox (schema in docs/backend/CONVENTIONS.md) as login <service>
# (password = service name) and routes each row to kade.<aggregatetype>.events:
#   key     = aggregateid (string)
#   value   = payload (raw protobuf bytes, ByteArrayConverter)
#   headers = id, eventType (= type), traceparent
# Idempotent: PUT /connectors/<name>/config creates or updates. The outbox table must exist
# before the connector starts (run the service's migrations first).
#
# Env: CONNECT_URL (default http://localhost:8083), DB_HOST (default postgres, as seen from Connect),
#      DB_PASSWORD (default = service), SNAPSHOT_MODE (default initial).
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <service> <database>" >&2
  exit 64
fi

SERVICE="$1"
DATABASE="$2"
CONNECT_URL="${CONNECT_URL:-http://localhost:8083}"
DB_HOST="${DB_HOST:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-$SERVICE}"
SNAPSHOT_MODE="${SNAPSHOT_MODE:-initial}"

NAME="outbox-${SERVICE}"
SLOT="outbox_$(echo "$SERVICE" | tr -c 'a-zA-Z0-9_\n' '_' | tr 'A-Z' 'a-z')"

# Pre-flight: the connector creates a publication FOR TABLE public.outbox, which fails if the
# table does not exist yet. Run this after the service's first migration. Skipped when the
# Compose postgres container is not reachable (e.g. CI or a remote Connect).
COMPOSE_FILE="${COMPOSE_FILE:-$(cd "$(dirname "$0")/.." && pwd)/compose.yaml}"
if command -v docker >/dev/null 2>&1 \
  && reg=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
      psql -U postgres -d "$DATABASE" -tAc "select coalesce(to_regclass('public.outbox')::text,'')" 2>/dev/null); then
  if [[ -z "$reg" ]]; then
    echo "${DATABASE}.public.outbox does not exist yet: run ${SERVICE}'s migrations first, then re-run this script." >&2
    exit 2
  fi
fi

read -r -d '' CONFIG <<JSON || true
{
  "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
  "tasks.max": "1",
  "plugin.name": "pgoutput",
  "database.hostname": "${DB_HOST}",
  "database.port": "5432",
  "database.user": "${SERVICE}",
  "database.password": "${DB_PASSWORD}",
  "database.dbname": "${DATABASE}",
  "topic.prefix": "${SERVICE}",
  "table.include.list": "public.outbox",
  "slot.name": "${SLOT}",
  "publication.name": "${SLOT}",
  "publication.autocreate.mode": "filtered",
  "snapshot.mode": "${SNAPSHOT_MODE}",
  "tombstones.on.delete": "false",
  "binary.handling.mode": "bytes",

  "heartbeat.interval.ms": "60000",
  "extended.headers.enabled": "false",

  "key.converter": "org.apache.kafka.connect.storage.StringConverter",
  "value.converter": "org.apache.kafka.connect.converters.ByteArrayConverter",
  "header.converter": "org.apache.kafka.connect.storage.SimpleHeaderConverter",

  "transforms": "dropHeartbeats,outbox",
  "transforms.dropHeartbeats.type": "org.apache.kafka.connect.transforms.Filter",
  "transforms.dropHeartbeats.predicate": "isHeartbeat",
  "predicates": "isHeartbeat",
  "predicates.isHeartbeat.type": "org.apache.kafka.connect.transforms.predicates.TopicNameMatches",
  "predicates.isHeartbeat.pattern": "__debezium-heartbeat\\\\..*",

  "transforms.outbox.type": "io.debezium.transforms.outbox.EventRouter",
  "transforms.outbox.table.field.event.id": "id",
  "transforms.outbox.table.field.event.key": "aggregateid",
  "transforms.outbox.table.field.event.payload": "payload",
  "transforms.outbox.table.expand.json.payload": "false",
  "transforms.outbox.route.by.field": "aggregatetype",
  "transforms.outbox.route.topic.replacement": "kade.\${routedByValue}.events",
  "transforms.outbox.table.fields.additional.placement": "type:header:eventType,traceparent:header:traceparent",
  "transforms.outbox.table.fields.additional.error.on.missing": "false"
}
JSON

echo "PUT ${CONNECT_URL}/connectors/${NAME}/config"
code=$(curl -sS -o /tmp/register-outbox.$$ -w '%{http_code}' -X PUT \
  -H 'Content-Type: application/json' --data "$CONFIG" \
  "${CONNECT_URL}/connectors/${NAME}/config")
if [[ "$code" != 200 && "$code" != 201 ]]; then
  echo "failed (HTTP $code):" >&2
  cat /tmp/register-outbox.$$ >&2; echo >&2
  rm -f /tmp/register-outbox.$$
  exit 1
fi
rm -f /tmp/register-outbox.$$
[[ "$code" == 201 ]] && echo "created ${NAME}" || echo "updated ${NAME}"

# Wait for the task to report RUNNING (or surface the error).
for _ in $(seq 1 30); do
  status=$(curl -fsS "${CONNECT_URL}/connectors/${NAME}/status" 2>/dev/null || true)
  state=$(printf '%s' "$status" | sed -n 's/.*"tasks":\[{"id":0,"state":"\([A-Z]*\)".*/\1/p')
  if [[ "$state" == RUNNING ]]; then echo "${NAME}: RUNNING"; exit 0; fi
  if [[ "$state" == FAILED ]]; then echo "${NAME}: FAILED" >&2; echo "$status" >&2; exit 1; fi
  sleep 1
done
echo "${NAME}: task not RUNNING yet; check: curl -s ${CONNECT_URL}/connectors/${NAME}/status" >&2
exit 1
