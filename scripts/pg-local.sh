#!/bin/sh
# Runs the PgStore round-trip suite (tests/persistence_pg_test.ts) against a
# THROWAWAY Docker Postgres — no standing database or env wiring needed.
#
#   deno task test:pg:local
#
# The container is always removed afterwards; the suite's own gate
# (TEST_PG_URL) is set here, so the four tests run instead of being
# ignored. Exit code is the suite's exit code.
set -e

NAME=emberdawn-pg-local
PORT=55432
URL="postgresql://postgres:postgres@localhost:$PORT/postgres"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
docker run -d --name "$NAME" \
  -e POSTGRES_PASSWORD=postgres \
  -p "$PORT:5432" \
  postgres:16 >/dev/null

# Wait until the server accepts connections (container image cold starts).
i=0
while [ $i -lt 60 ]; do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 0.5
done
if ! docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then
  echo "pg-local: Postgres did not become ready in time" >&2
  exit 1
fi

TEST_PG_URL="$URL" deno task test:pg
