#!/usr/bin/env bash
# Runs a Gradle command for one Java service inside Docker, one Java build at a time across the repo.
# Several agents build Java services in parallel; on a 16 GB laptop two Gradle JVMs plus the stack is
# too much, so builds queue on a lock directory (mkdir is atomic; works on macOS without flock).
#
#   scripts/java-build.sh <service-dir> <gradle args...>
#   scripts/java-build.sh services/payment test
#   scripts/java-build.sh services/payment integrationTest
set -euo pipefail
[[ $# -ge 2 ]] || { echo "usage: $0 <service-dir> <gradle args...>" >&2; exit 64; }
DIR="$1"; shift
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK=/tmp/kade-java-build.lock

waited=0
until mkdir "$LOCK" 2>/dev/null; do
  # A lock older than 30 minutes is a crashed build: take it over.
  if [[ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]]; then rm -rf "$LOCK"; continue; fi
  (( waited % 30 == 0 )) && echo "java-build: waiting for another Java build ($(cat "$LOCK/owner" 2>/dev/null || echo unknown))..." >&2
  sleep 5; waited=$((waited + 5))
done
echo "$DIR $*" > "$LOCK/owner"
trap 'rm -rf "$LOCK"' EXIT

GRADLE=gradle
[[ -x "$ROOT/$DIR/gradlew" ]] && GRADLE=./gradlew
docker run --rm -m 1800m \
  -v "$ROOT:/repo" -w "/repo/$DIR" \
  -v kade-gradle:/home/gradle/.gradle \
  --network kade \
  gradle:8.14-jdk21 "$GRADLE" --no-daemon "$@"
