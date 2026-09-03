---
name: emberdawn-persistence
description: Use when changing Emberdawn PlayerState or BattleState JSON shape, stores, stateVersion, save compatibility, or persisted identities.
---

# Persistence & Schema — Emberdawn

Operating guide for player state serializability, `stateVersion` rules, stores, and persisted
identities.

## 1. Persistence Shape

All persistent game state is modeled by `PlayerState` (`src/engine/types.ts`):

- Plain JSON only: state consists exclusively of strings, numbers, booleans, arrays, and plain
  objects.
- No class instances, `Map`, `Set`, or function closures. Everything must survive `JSON.stringify`
  and `JSON.parse` round-trips without loss.
- Active combat state (e.g. enemy status, buffs, effect instances, turn history) is grouped under
  the nested `battle?: BattleState` field on `PlayerState`, which round-trips through JSON
  persistence while a fight is active.
- Narrative state fields:
  - `p.decisions`: Ledger recording choice identifiers and timestamp provenance.
  - `p.storyEvents`: Ordered, deduplicated log of recorded story events.
  - `p.questOutcomes`: Permanent resolution map (`'resolved' | 'failed' | 'locked'`).
  - `p.storyReceipts`: Set of one-shot keys (`choice:...` and `line:...`) suppressing replayed story
    mutations.

## 2. Save Versioning (`stateVersion`)

`PlayerState.stateVersion` tracks the schema version of the save file. Fresh players are stamped
with `CURRENT_STATE_VERSION`.

The load-time validation gate `assertSupportedSaveVersion()` is strictly non-mutating:

- It verifies that the stored version matches supported requirements.
- Older saves throw `SaveTooOldError`.
- Saves produced by newer application binaries throw `SaveTooNewError`.

### Pre-Launch Policy (Currently Active)

While the authoritative lifecycle phase in `AGENTS.md` is `PRE-LAUNCH`:

- Development and playtest saves are strictly disposable.
- Schema changes advance `CURRENT_STATE_VERSION`.
- Outdated saves are rejected by `assertSupportedSaveVersion()` and must be reset via `/reset`.
- No historical migration ladders (e.g. v3–v7 shims) are maintained during pre-launch.

### Live Release Policy (Deferred)

Once the project transitions to `LIVE`:

- Saves represent a durable player contract.
- Any breaking schema modification requires an explicit, sequentially ordered migration step
  (`stateVersion` increment).
- Live players must never be directed to `/reset`.
- Migrations must never use heuristics or "state looks old" sniffing.

## 3. Persisted Content Identities

Identities stored in save records include:

- `currentZone`;
- Inventory and equipment item IDs;
- Quest keys and tracking state;
- Learned skill IDs;
- Active battle enemy IDs and effect source IDs;
- Battle origin zone and dungeon IDs;
- Scene arguments (`arg`, `arg2`, `arg3`);
- Flags encoding IDs (e.g., `forge_i_<itemId>`);
- Decision IDs and choice IDs;
- Story receipt keys (`choice:...`, `line:...`).

**Integrity Rules:**

- In pre-launch, IDs may be restructured to fit current content needs, but every ID referenced or
  emitted in code must resolve (no dangling references).
- Never guess a replacement for an unknown or corrupt persisted ID; fail explicitly rather than
  silently altering player state.

## 4. Storage Adapters & Verification

`PlayerStore` (`src/persistence/store.ts`) provides two implementations:

- **`PgStore`:** PostgreSQL JSONB storage with transaction-scoped advisory locks on dedicated
  connections.
- **`MemoryStore`:** Fast in-memory implementation for automated tests.

Database schema migrations reside in `src/persistence/migrate.ts`.

### Verification Gate for Persistence Changes

Any change modifying `PlayerState`, `BattleState`, database queries, or `src/persistence/` **must**
be verified against a real PostgreSQL instance:

```bash
deno task test:pg          # Run against PostgreSQL specified in TEST_PG_URL
deno task test:pg:local    # Automatically spin up Docker Postgres, test, and tear down
```
