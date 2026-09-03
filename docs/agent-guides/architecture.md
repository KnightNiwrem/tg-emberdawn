# Architecture Guide — Emberdawn

Operating guide for engine boundaries, Telegram I/O, locking, session lifecycle, and message
coordination.

## 1. Engine Purity & Data Flow

`src/engine/` and `src/content/` are pure TypeScript libraries. They must never import `grammy` or
platform-specific I/O APIs. Handlers call pure engine functions; rendering is a pure function of
`PlayerState`.

Data flows strictly in one direction:

```text
handler (I/O) → engine mutation (pure) → render (pure) → persist (I/O)
```

- **Handlers** (`src/handlers/`) manage Telegram updates, callbacks, and store coordination.
- **Engine** (`src/engine/`) mutates state deterministically and returns completion results.
- **Render** (`src/render/`) transforms `PlayerState` into `InputRichMessage` structures.
- **Persistence** (`src/persistence/`) reads and writes serialized state.

### Import Boundary

Gameplay modules (`src/engine`, `src/content`) depend only on local gameplay code — never `grammy`,
external packages (`npm:`, `jsr:`), handlers, or persistence. This boundary is enforced via the Deno
compiler dependency graph (`deno info --json`) in `tests/architecture_test.ts`.

## 2. Ordered-Completion Gameplay Boundary

Telegram, network, and database operations are asynchronous I/O surrounding a deterministic game
core. The core architectural invariant is **ordered completion**: one deterministic, explicitly
ordered resolution flow that is fully complete before rendering or persistence begins.

Three concepts remain distinct:

1. **Ordered resolution (required):** A single authoritative coordinator owns combat phases and
   nested sub-resolution. SPD selects the first actor; each action or effect resolves completely
   before the next begins; terminal state is checked immediately after every potentially lethal
   transition. When HP reaches 0 and no revival succeeds, no later action, rider, reaction, or
   end-of-round effect runs. Regeneration never revives a terminal combatant, and DoTs never produce
   a post-victory mutual KO.
2. **Async syntax (neutral):** An async function whose operations are sequentially awaited is still
   an ordered flow. Async syntax is neither proof of order nor proof of disorder. The test suite
   does not use lexical scanners for `async`/`await`/`Promise` tokens. Engine entry points are
   currently synchronous by contract.
3. **Event-driven orchestration (unwanted for combat):** No listener queues, event bus, timer,
   microtask scheduling, detached callbacks, unawaited mutations, or `Promise.all` over mutations of
   the same battle are permitted.

### The Async I/O Sandwich

Asynchronous operations belong strictly at the outer boundary:

- Receiving Telegram updates and grammY middleware;
- Serializing concurrent updates per user;
- Loading and persisting state via Postgres or memory;
- Editing or sending Telegram messages;
- Webhook lifecycle and operational scripts.

The boundary loads state, invokes the engine's ordered resolution, renders and persists the
completed result, and returns. It never interleaves with engine resolution.

### Architectural Vocabulary

Direct synchronous invocations are standard function calls, not decoupled events:

- **"Reactive trigger"** (`runReactiveTriggers`): an immediate nested synchronous call for equipment
  triggers.
- **"Quest hook"** (`onKill`, `onZoneEnter`, `onDungeonClear`): a direct synchronous
  state-advancement call.
- **"Exploration event"**: a data variant returned from content tables and resolved by a synchronous
  switch.
- **"Combat trace"**: plain data records appended synchronously to an array returned by resolution
  (`recordCombatEvent`); no dispatch or async emission.

## 3. Concurrency & Per-Player Locking

Every player update runs inside `PlayerStore.withLock(user)`:

- In-process concurrency is serialized by a per-user promise chain.
- `PgStore.withLock` holds a PostgreSQL transaction-scoped advisory lock on a dedicated connection
  around the entire load → mutate → save sequence.
- Two bot instances cannot interleave read-modify-write cycles for the same player (preventing lost
  writes).
- Concurrent distinct-user updates do not starve the connection pool.
- Any failure in the locked section rolls back atomically (the advisory lock releases automatically
  when the transaction terminates).
- `MemoryStore.withLock` is a passthrough for single-process testing.

**Rules:**

- Never mutate player state outside the lock.
- Never await user input or external webhook responses while holding the lock.

## 4. Single Live Message & Staleness Guard

Each player has exactly one active game message (`p.messageId`). Normal gameplay never sends
additional button-bearing messages (exceptions: initial class picker and post-reset message).

### Message Lifecycle

1. Every view transition edits the live message in place via `commit()` in
   `src/handlers/session.ts`.
2. If an edit fails (e.g., message deleted or uneditable), the session resends a fresh message and
   updates `p.messageId`.
3. Taps on older message copies are detected via `isLiveMessage` / `tapIsCurrent`, answered with a
   toast notification, and ignored. Newer-than-tracked message IDs are adopted alongside their
   stamped render revision.

### Revision Stamping (`uiRev`)

1. Every committed view stamps its interactive buttons with the player's current render revision
   (`p.uiRev`, cycled 1..9999).
2. Callback payloads embed this revision in the format `<view>:<rev>:<action>`.
3. The central router (`src/handlers/callbacks.ts`) verifies the callback revision against `p.uiRev`
   before executing any mutations.
4. Mismatched revisions (stale taps, double-taps, replayed network requests) are rejected as no-ops.
5. All gameplay callbacks must carry their stamped revision. The only exception is the initial class
   picker (`m:pk:<class>`), which renders before a player record exists.

## 5. Wire Contracts: callback_data & Rich Messages

### callback_data Budget

Telegram limits `callback_data` to 64 UTF-8 bytes.

- All callback payloads are encoded and decoded exclusively through `src/codec.ts` (`encodeCb` /
  `decodeCb`).
- Never format or concatenate raw callback strings in view renderers or handlers.
- New controls must be allocated within `src/codec.ts` while respecting the 64-byte limit.

### Bot API Rich Messages

Emberdawn uses Telegram Bot API Rich Messages:

- Interactive buttons live inside the message body via rich blocks, never in `reply_markup`.
- Formatting uses typed entity objects (`{ type: 'bold', text }`, `{ type: 'italic', text }`), not
  raw HTML tags (`<b>`, `<i>`), which render literally.
- Button rows and grids are constructed via helpers in `src/render/rich.ts` (`buttonsRow`, `cbBtn`,
  `disabledBtn`).

## 6. System Workflows

### Reset Flow

`/reset` and the character menu's delete action stage an explicit confirmation screen (`reset`
view):

1. Confirming reset (`resetYes`) calls `store.delete(user)` to remove the save record.
2. It immediately delivers the stateless class picker in place (with resend fallback).
3. Delivery is attempted before deleting local state; if delivery fails, the existing save remains
   intact.
4. Once reset completes, nothing is persisted until the user picks a class.
5. Replayed confirmation callbacks after deletion are harmless no-ops; once a new hero exists, the
   revision guard rejects old callbacks.

### Webhook Security & Secret Rotation

- In webhook mode, the server fails closed if `WEBHOOK_SECRET` is unset.
- The `X-Telegram-Bot-Api-Secret-Token` header is verified using constant-time comparison in
  `src/webhook-server.ts` before passing the update to grammY.
- Polling mode requires no secret.
- **Rotation procedure:**
  1. Generate a new secret.
  2. Update the application environment configuration.
  3. Run `deno task webhook set <url>` with the new secret.
  4. Restart the bot process.

## 7. Directory Routing

```text
src/
├─ engine/         # Pure game logic (combat, character, quests, world, rng)
├─ content/        # Pure game definitions (enemies, items, skills, quests, zones)
├─ render/         # Pure view renderers (Rich Message blocks, buttons, menus)
├─ handlers/       # Telegram boundary, callback routing, session commit
└─ persistence/    # Player stores (PgStore, MemoryStore) and migration runners
tests/             # Deterministic engine tests, balance harnesses, integration suites
scripts/           # Operational tooling (webhook setup, balance simulation)
```
