# Locking and webhook I/O

Implementation: `src/persistence/store.ts`, `src/bot.ts`, `src/webhook-server.ts`, and
`src/main.ts`. Local verification permissions live in the root `AGENTS.md`; a webhook procedure does
not authorize changing a live bot.

## Locking and cross-instance consistency

Every user-associated update runs inside `PlayerStore.withLock(userId)`:

- The bot's per-user promise chain serializes updates within one process.
- `PgStore.withLock` holds a Postgres transaction-scoped advisory lock on a dedicated connection
  around the whole load → mutate → render → save flow. State queries reuse that same connection, so
  two bot instances cannot interleave a read-modify-write for one player. Reuse prevents the pool
  deadlock caused by lock holders requesting a second connection. Failed sections roll back database
  writes; Telegram sends and edits already delivered are outside that transaction. The lock releases
  with the transaction, so there is no explicit unlock to leak.
- `MemoryStore.withLock` is a passthrough for single-process tests.
- Never mutate player state outside the lock. Never hold the lock across user input.

## Webhook boundary

- Webhook mode fails closed without `WEBHOOK_SECRET`. The `X-Telegram-Bot-Api-Secret-Token` header
  is verified constant-time in `src/webhook-server.ts` BEFORE grammY parses the update. Polling mode
  needs no secret.
- Rotation procedure: choose a new secret, update the app environment, run
  `deno task webhook set <url>` with the same value, restart.
- `src/main.ts` selects webhook mode by default or polling mode with `BOT_POLLING=1`.
