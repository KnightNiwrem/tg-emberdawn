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

run_directory=''
container_name=''
owner_token=''

cleanup() {
  if [ -n "$container_name" ]; then
    container_identity=$(docker container inspect \
      --format '{{.Id}} {{index .Config.Labels "emberdawn.pg-local.owner"}}' \
      "$container_name" 2>/dev/null) || container_identity=''
    if [ "${container_identity#* }" = "$owner_token" ]; then
      # Remove the verified ID so a name reassignment cannot redirect cleanup.
      docker rm -f "${container_identity%% *}" >/dev/null 2>&1 || true
    fi
  fi
  if [ -n "$run_directory" ]; then
    rmdir "$run_directory" || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Establish ownership before docker run can create a container or be interrupted.
run_directory=$(mktemp -d "${TMPDIR:-/tmp}/emberdawn-pg.XXXXXXXXXX")
# Ownership is independent of the name: a failed run may have collided with another container.
owner_token=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
[ "${#owner_token}" -eq 32 ]
container_name="${run_directory##*/}"
docker run -d --name "$container_name" \
  --label "emberdawn.pg-local.owner=$owner_token" \
  -e POSTGRES_PASSWORD=postgres \
  -p 127.0.0.1::5432 \
  postgres:16 >/dev/null
binding=$(docker port "$container_name" 5432/tcp)
port=${binding##*:}
test_pg_url="postgresql://postgres:postgres@127.0.0.1:$port/postgres"

# Wait for TCP; the image first starts a temporary server that only accepts Unix sockets.
readiness_attempt=0
while [ "$readiness_attempt" -lt 60 ]; do
  if docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    break
  fi
  readiness_attempt=$((readiness_attempt + 1))
  sleep 0.5
done
if [ "$readiness_attempt" -eq 60 ]; then
  echo "pg-local: Postgres did not become ready in time" >&2
  exit 1
fi

TEST_PG_URL="$test_pg_url" deno task test:pg
