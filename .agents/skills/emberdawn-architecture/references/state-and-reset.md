# State coordination and reset

Authoritative code and tests: `src/persistence/store.ts`, `src/bot.ts`, `src/handlers/commands.ts`,
`src/handlers/callbacks.ts`, `src/handlers/session.ts`, `tests/bot_test.ts`,
`tests/memory_store_test.ts`, `tests/persistence_pg_test.ts`, `tests/repair2_test.ts`,
`tests/save_identity_test.ts`.

For changes to live-message delivery, callback revisions, or message adoption, also read
[Message lifecycle and callbacks](message-lifecycle.md). Use `emberdawn-persistence` when the task
also changes or reviews persisted shape, save compatibility, or persisted identities.

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

## Reset flow

`handleReset()` in `src/handlers/commands.ts` behaves differently depending on the save it finds:

1. **Supported current save:** `/reset` and the character menu's delete-hero control only stage an
   explicit Yes/No confirmation (the `reset` view). `resetYes` requires that active scene and
   deletes the save (`store.delete`) and delivers the stateless class picker in place (with a resend
   fallback). Delivery is attempted FIRST, so a failed delivery leaves the old save intact; nothing
   is persisted again until a class is picked through the normal no-player path (`pickClass`).
   No/cancel resumes the live scene — a pending fight stays a fight. A redelivered confirmation
   after deletion is a harmless no-op; once a new hero exists, the staleness guard rejects old reset
   callbacks. The delivery-before-delete guarantee applies only to this confirmed flow.
2. **Unsupported pre-launch save:** an old/unversioned save or a current-version save rejected by
   `assertResolvablePersistedIds()` cannot be loaded, so a confirmation scene cannot be staged or
   persisted. An explicit `/reset` deletes it immediately and presents the class picker — this is
   the documented escape hatch for disposable development saves.
3. **Newer-version save:** refused without mutation or deletion, with a reply telling the player
   their progress is safe.

Case 2 is regression-tested in `tests/repair2_test.ts` and `tests/save_identity_test.ts`.
