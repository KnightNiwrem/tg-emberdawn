#!/bin/sh
# Runs the PgStore round-trip suite (tests/persistence_pg_test.ts) against a
# THROWAWAY Docker Postgres — no standing database or env wiring needed.
#
#   deno task test:pg:local
#
# Each invocation owns its container and loopback port, including during
# concurrent runs. TEST_PG_URL enables the suite against that database.
# Exit code is the suite's exit code.
set -e

container_id=''

cleanup() {
  if [ -n "$container_id" ]; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

container_id=$(docker run -d \
  -e POSTGRES_PASSWORD=postgres \
  -p 127.0.0.1::5432 \
  postgres:16)
binding=$(docker port "$container_id" 5432/tcp)
port=${binding##*:}
test_pg_url="postgresql://postgres:postgres@127.0.0.1:$port/postgres"

# Wait until the server accepts connections (container image cold starts).
readiness_attempt=0
while [ "$readiness_attempt" -lt 60 ]; do
  if docker exec "$container_id" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  readiness_attempt=$((readiness_attempt + 1))
  sleep 0.5
done
if ! docker exec "$container_id" pg_isready -U postgres >/dev/null 2>&1; then
  echo "pg-local: Postgres did not become ready in time" >&2
  exit 1
fi

TEST_PG_URL="$test_pg_url" deno task test:pg
