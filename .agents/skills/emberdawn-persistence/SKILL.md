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

- `PlayerState` (`src/engine/types.ts`) is plain JSON: no Dates, Maps, Sets, class instances, or
  functions. Anything you add must survive `JSON.stringify`.
- `PlayerState` — including its nested `battle?: BattleState` — is persisted as plain JSON:
  `PgStore.set()` serializes the whole `PlayerState` into JSONB. Battle-scoped state (for example
  battle buffs) belongs on `BattleState`; it is saved and restored with the player.
  `BattleState.effectSeq` is persisted deliberately for deterministic save/load behavior. Genuinely
  derived, runtime-only context — such as `DerivedStats` — is never persisted.
- Required battle fields (`phoenixUsed`, `effectInstances`, `effectSeq`, `shield`, `history`) are
  initialized by `startBattle()`.
- Narrative state on `PlayerState`: `decisions` (ledger with choice and provenance), `storyEvents`
  (ordered, deduped), `questOutcomes` (permanent resolutions), and `storyReceipts` (one-shot
  story-application receipts). All plain JSON; decision ids and choice ids are persisted content
  identities. `QuestOutcome` is a discriminated union (#150): `outcome` is a resolved-only field,
  and the identity gate also refuses a persisted decision whose `(dialogue, node, choice)` tuple no
  authored `recordDecision` produced.
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
saves, and do not invent fallback state for a deleted historical ID.

The version gate alone cannot catch ID renames or removals, because they do not change the
TypeScript shape. So every gameplay load also runs the central identity gate,
`assertResolvablePersistedIds()` in `src/engine/validate.ts` — pure, non-mutating, and run after
`assertSupportedSaveVersion()` and before any mutation or render. It checks the persisted identity
locations listed in its module doc (zones, items, skills, quests, flags, receipts, decisions, story
events, scene args, and the active battle) against the current content catalogs and throws
`SaveUnresolvableError` listing every unresolved identity it finds. The list covers the high-risk
persisted identity locations; the validator is not an exhaustive runtime schema validator and is not
a substitute for the post-launch durable-ID policy (IDs that can occur in supported live saves must
stay resolvable). When you add a new ID-bearing persisted field, consider extending the validator.

Refusal policy while PRE-LAUNCH: handlers answer with the /reset pointer and leave the stored JSON
untouched; explicit `/reset` deletes the unloadable save and offers the class picker (a
newer-version save is still refused without deletion). The error classification (`SaveTooOldError` /
`SaveTooNewError` / `SaveUnresolvableError`) stays distinct so that after launch an unresolved live
ID can be treated as corruption, a broken migration, or a contract-violating release rather than a
resettable save.

Covered by `tests/save_identity_test.ts`.

## Stores

`PlayerStore` has two implementations: `PgStore` (Postgres/JSONB) and `MemoryStore` (tests). The
whole per-player load → mutate → save flow runs inside `PlayerStore.withLock(user)`; see
`emberdawn-architecture` for the locking contract.
