#!/usr/bin/env bash
# Creates every topic in the registry (docs/backend/CONVENTIONS.md). Idempotent.
# Runs as the one-shot `kafka-init` service; re-run with:
#   docker compose -f deploy/compose/compose.yaml run --rm kafka-init
set -euo pipefail

BOOTSTRAP="${BOOTSTRAP:-kafka:9092}"
KT=/opt/kafka/bin/kafka-topics.sh

# Aggregates published through the outbox -> kade.<aggregate>.events (6 partitions).
AGGREGATES=(restaurant menu customer promotion order payment merchant delivery rider ledger review ticket
  note) # note = service templates

create() { # name partitions [config...]
  local name="$1" partitions="$2"; shift 2
  local cfg=()
  for c in "$@"; do cfg+=(--config "$c"); done
  "$KT" --bootstrap-server "$BOOTSTRAP" --create --if-not-exists \
    --topic "$name" --partitions "$partitions" --replication-factor 1 "${cfg[@]}" >/dev/null
  echo "  $name ($partitions)"
}

until "$KT" --bootstrap-server "$BOOTSTRAP" --list >/dev/null 2>&1; do
  echo "waiting for $BOOTSTRAP..."; sleep 2
done

echo "creating topics:"
for a in "${AGGREGATES[@]}"; do
  create "kade.$a.events" 6
  create "kade.$a.events.dlq" 1 retention.ms=1209600000 # 14 days
done
# High-volume GPS stream, produced directly with the Schema Registry serializer.
create kade.rider.locations 12 retention.ms=86400000 # 1 day
create kade.note.views 6 retention.ms=86400000 # Go template registry stream demo
create kade.rider.locations.dlq 1 retention.ms=1209600000

echo "done: $("$KT" --bootstrap-server "$BOOTSTRAP" --list | grep -c '^kade\.') kade.* topics"
