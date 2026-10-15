#!/bin/sh
# Downloads every module the gates import into Deno's cache, retrying while
# the emulator's CDN fails.
#
#   deno task cache:deps
#
# jsDelivr serves the emulator from its GitHub mirror. For files it has not
# cached yet, it intermittently answers 503 ("No healthy backends") or a
# false 404. Deno fails the whole module graph on either, and it caches a 404
# as "not found", so a plain retry repeats it. Each retry therefore reloads
# the module the previous attempt reported missing. Exit code is the last
# attempt's.
set -u

MAX_ATTEMPTS=20
RETRY_DELAY_SECONDS=5
ENTRYPOINTS="src/main.ts src/persistence/migrate.ts scripts/webhook.ts scripts/balance.ts tests/"

attempt=1
reload_specifiers=""
while :; do
  if [ -n "$reload_specifiers" ]; then
    reload_flag="--reload=$reload_specifiers"
  else
    reload_flag=""
  fi
  # shellcheck disable=SC2086 # entrypoints and the optional flag split on purpose
  if output=$(NO_COLOR=1 deno cache --frozen --allow-import $reload_flag $ENTRYPOINTS 2>&1); then
    echo "Deno dependencies cached (attempt $attempt)."
    exit 0
  else
    status=$?
  fi
  failure=$(printf '%s\n' "$output" | grep -v 'Download' | grep -m 1 -E 'error' || true)
  echo "Attempt $attempt of $MAX_ATTEMPTS failed: $failure"
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    printf '%s\n' "$output" | grep -v 'Download'
    exit "$status"
  fi
  reload_specifiers=$(printf '%s\n' "$output" | sed -n 's/.*Module not found "\([^"]*\)".*/\1/p' | head -n 1)
  attempt=$((attempt + 1))
  sleep "$RETRY_DELAY_SECONDS"
done
