#!/usr/bin/env bash
# Creates one login + one database per service (dev: user = password = service name).
# Runs once, on the first start of an empty data volume (docker-entrypoint-initdb.d).
# To re-run after editing: `pnpm infra:down` then `docker volume rm kade_postgres-data`
# (see docs/backend/RUNBOOK.md, "Reset data").
set -euo pipefail

# "login:database" pairs. Keep in sync with the service registry in docs/backend/CONVENTIONS.md.
SERVICE_DBS=(
  catalog:catalog
  search:search
  profile:profile
  pricing:pricing
  promotion:promotion
  order:orders
  payment:payment
  merchant:merchant
  dispatch:dispatch
  ledger:ledger
  notification:notification
  review:review
  support:support
  # service templates (services/_templates/<lang>)
  template_ts:template_ts
  template_go:template_go
  template_java:template_java
)

# Platform databases (no REPLICATION: nothing streams their WAL).
PLATFORM_DBS=(
  temporal:temporal
  temporal:temporal_visibility
  keycloak:keycloak
)

create() {
  local login="$1" db="$2" replication="$3"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${login}') THEN
    CREATE ROLE "${login}" LOGIN PASSWORD '${login}' ${replication};
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE "${db}" OWNER "${login}"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db}')\gexec
REVOKE ALL ON DATABASE "${db}" FROM PUBLIC;
GRANT ALL ON DATABASE "${db}" TO "${login}";
SQL
}

for pair in "${SERVICE_DBS[@]}"; do
  create "${pair%%:*}" "${pair##*:}" REPLICATION
done
for pair in "${PLATFORM_DBS[@]}"; do
  create "${pair%%:*}" "${pair##*:}" ""
done

echo "kade: created $(( ${#SERVICE_DBS[@]} + ${#PLATFORM_DBS[@]} )) databases"
