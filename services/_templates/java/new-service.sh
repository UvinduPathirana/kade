#!/usr/bin/env bash
# Copies the Java service template to services/<name> with names, package and ports substituted.
#
#   services/_templates/java/new-service.sh <name> <grpcPort> <httpPort> [database]
#   services/_templates/java/new-service.sh payment 50108 8108
#   services/_templates/java/new-service.sh ledger 50113 8113
#
# <name>      service name from the registry (docs/backend/CONVENTIONS.md): SERVICE_NAME, Compose service,
#             Kafka consumer group and Postgres login (dashes become underscores for the login).
# [database]  Postgres database, default = login (registry exception: order -> orders).
#
# The copy still contains the Note example (it compiles against kade.template.v1) so it builds and its tests pass
# on day one; replace it with your domain using the checklist in the README.
# Env: KADE_SERVICES_DIR overrides the destination parent directory (default: <repo>/services).
set -euo pipefail

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 64; }
[[ $# -ge 3 && $# -le 4 ]] || usage

NAME="$1" GRPC_PORT="$2" HTTP_PORT="$3"
[[ "$NAME" =~ ^[a-z][a-z0-9-]*[a-z0-9]$ ]] || { echo "name must be lower-case kebab-case: $NAME" >&2; exit 64; }
[[ "$GRPC_PORT" =~ ^[0-9]+$ && "$HTTP_PORT" =~ ^[0-9]+$ ]] || { echo "ports must be numbers" >&2; exit 64; }
[[ "$GRPC_PORT" != "$HTTP_PORT" ]] || { echo "gRPC and HTTP ports must differ" >&2; exit 64; }

LOGIN="${NAME//-/_}"
DATABASE="${4:-$LOGIN}"
PKG="${NAME//-/}"                                                    # java package segment: lk.kade.<pkg>
PASCAL="$(echo "$NAME" | awk -F- '{for (i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')"

TEMPLATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEMPLATE_DIR/../../.." && pwd)"
DEST_PARENT="${KADE_SERVICES_DIR:-$REPO_ROOT/services}"
DEST="$DEST_PARENT/$NAME"
[[ ! -e "$DEST" ]] || { echo "$DEST already exists" >&2; exit 1; }

echo "creating $DEST (package lk.kade.$PKG, ${PASCAL}Application, gRPC $GRPC_PORT, HTTP $HTTP_PORT, db $LOGIN@$DATABASE)"
mkdir -p "$DEST_PARENT"
rsync -a --exclude build --exclude .gradle --exclude .idea --exclude '*.iml' --exclude new-service.sh \
  "$TEMPLATE_DIR/" "$DEST/"

# Move sources to the new package directory.
for set in main test integrationTest; do
  src="$DEST/src/$set/java/lk/kade/template"
  [[ -d "$src" ]] && mv "$src" "$DEST/src/$set/java/lk/kade/$PKG"
done
find "$DEST/src" -name 'TemplateApplication.java' -execdir mv {} "${PASCAL}Application.java" \;

# Text substitutions. Order matters: specific patterns before the generic ones.
# - lk.kade.template (our code) -> lk.kade.<pkg>, but NOT lk.kade.template.v1 (generated example contract)
# - DB URL, connector name and register command use login/database
# - the compose build context reaches proto/ two levels up instead of three
export NAME LOGIN DATABASE PKG PASCAL GRPC_PORT HTTP_PORT
find "$DEST" -type f \( -name '*.java' -o -name '*.kts' -o -name '*.yaml' -o -name '*.md' -o -name '*.sql' \
  -o -name 'Dockerfile' -o -name '.dockerignore' -o -name 'spring.factories' \) -print0 |
  xargs -0 perl -pi -e '
    s/\blk\.kade\.template(?!\.v1\b)\b/lk.kade.$ENV{PKG}/g;
    s#lk/kade/template(?!/v1)#lk/kade/$ENV{PKG}#g;
    s/\bTemplateApplication\b/$ENV{PASCAL}Application/g;
    s/template_java:template_java\@/$ENV{LOGIN}:$ENV{LOGIN}\@/g;
    s#:5432/template_java\b#:5432/$ENV{DATABASE}#g;
    s/register-outbox\.sh template_java template_java/register-outbox.sh $ENV{LOGIN} $ENV{DATABASE}/g;
    s/outbox-template_java/outbox-$ENV{LOGIN}/g;
    s/\btemplate_java\b/$ENV{DATABASE}/g;
    s/\btemplate-java\b/$ENV{NAME}/g;
    s/\b50193\b/$ENV{GRPC_PORT}/g;
    s/\b8193\b/$ENV{HTTP_PORT}/g;
    s#\.\./\.\./\.\./proto#../../proto#g;
    s#services/_templates/java#services/$ENV{NAME}#g;
  '

# Generate code for the service's own proto package too, if the lead has added it.
if [[ -d "$REPO_ROOT/proto/kade/$PKG/v1" ]]; then
  perl -pi -e 's#val protoPackages = listOf\("kade/common/v1", "kade/template/v1"\)#val protoPackages = listOf("kade/common/v1", "kade/template/v1", "kade/'"$PKG"'/v1")#' \
    "$DEST/build.gradle.kts"
  echo "added proto package kade/$PKG/v1"
fi
chmod +x "$DEST/gradlew"

cat <<EOF

Done. Next steps (README "Copy-the-template checklist"):
  1. scripts/java-build.sh services/$NAME test integrationTest
  2. Replace the Note example (package lk.kade.$PKG.note, V2__notes.sql) with your domain.
  3. Ask the lead to include services/$NAME/compose.yaml in deploy/compose/services.yaml (and set its profile),
     then register the outbox connector: deploy/compose/connect/register-outbox.sh $LOGIN $DATABASE
EOF
