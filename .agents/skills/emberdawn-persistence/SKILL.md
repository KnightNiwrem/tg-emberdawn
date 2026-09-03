---
name: emberdawn-persistence
description: Use when changing Emberdawn PlayerState or BattleState shape, stores, stateVersion, save compatibility, or persisted content identities.
---

# Emberdawn persistence

Detailed rules for save shape, schema versioning, and stores. The active PRE-LAUNCH policy lives in
the root `AGENTS.md`; this skill carries the mechanics. Post-launch migration policy lives in
`emberdawn-release` and is inactive until launch is explicitly approved.

Authoritative code and tests: `src/engine/types.ts`, `src/persistence/store.ts`,
`src/persistence/migrate.ts`, `tests/persistence_pg_test.ts`. Run `deno task test:pg` (or
`deno task test:pg:local` for a throwaway Docker Postgres) whenever persistence or schema behavior
changes.

## Persisted shapes

- `PlayerState` (`src/engine/types.ts`) is plain JSON: no class instances, no Maps, no functions.
  Anything you add must survive `JSON.stringify`.
- Runtime-only state (for example battle buffs) lives on `BattleState`, not the player.
- Required battle fields (`phoenixUsed`, `effectInstances`, `effectSeq`, `shield`, `history`) are
  initialized by `startBattle()`.
- Narrative state on `PlayerState`: `decisions` (ledger with choice and provenance), `storyEvents`
  (ordered, deduped), `questOutcomes` (permanent resolutions), and `storyReceipts` (one-shot
  story-application receipts). All plain JSON; decision ids and choice ids are persisted content
  identities.
- Persistable content IDs include more than `currentZone`: inventory and equipment items, quest
  keys, learned skills, active-battle enemies and effect sources, battle origin zone/dungeon IDs,
  scene arguments, and IDs encoded into durable flags.

## stateVersion lifecycle

- `stateVersion` is required; fresh players are stamped `CURRENT_STATE_VERSION`.
- The load-time `assertSupportedSaveVersion()` gate is non-mutating. While PRE-LAUNCH: unversioned
  or older saves throw `SaveTooOldError` (refused with a pointer to /reset — never sniffed,
  rewritten, repaired, or stamped current; the stored JSON stays untouched). Saves from newer
  binaries (`stateVersion > CURRENT_STATE_VERSION`) throw `SaveTooNewError`, and handlers refuse to
  read-mutate-write rather than downgrade.
- Pre-launch schema policy: after a persisted-shape change, bump `CURRENT_STATE_VERSION`, update
  constructors and types to emit the new authoritative shape, and retire older dev formats rather
  than accumulating migrations. Playtesters /reset. Content-ID renames and removals are equally free
  pre-launch: no aliases, tombstones, or recovery shims.
- Which schema versions are accepted follows the authoritative release phase in the root
  `AGENTS.md`. While PRE-LAUNCH, only the current version is accepted.

## Unknown persisted IDs

Never silently guess a replacement for an unknown or corrupt persisted ID: do not rewrite ambiguous
saves, and do not invent fallback state for a deleted historical ID. Pre-launch, old development
saves may simply be refused through the existing explicit `/reset` path.

## Stores

`PlayerStore` has two implementations: `PgStore` (Postgres/JSONB) and `MemoryStore` (tests). The
whole per-player load → mutate → save flow runs inside `PlayerStore.withLock(user)`; see
`emberdawn-architecture` for the locking contract.
