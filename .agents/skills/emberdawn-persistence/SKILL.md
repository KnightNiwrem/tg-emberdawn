---
name: emberdawn-persistence
description: Use when changing or reviewing Emberdawn PlayerState/BattleState shape, stores, save versioning, compatibility, or persisted content IDs.
---

# Emberdawn persistence

Detailed rules for save shape, schema versioning, and stores. The active PRE-LAUNCH policy lives in
the root `AGENTS.md`; this skill carries the mechanics. Post-launch migration policy lives in
`emberdawn-release` and is inactive until launch is explicitly approved.

Authoritative code and tests: `src/engine/types.ts`, `src/engine/character.ts` (save-version
constant and gate), `src/engine/validate.ts` (persisted identity gate), `src/persistence/store.ts`,
and `tests/persistence_pg_test.ts`. `src/persistence/migrate.ts` handles PostgreSQL schema setup,
not `PlayerState` migrations. Run `deno task test:pg` (or `deno task test:pg:local` for a throwaway
Docker Postgres) whenever persistence or schema behavior changes.

## Database command targets

- Both `deno task test` and `deno task test:pg` run `tests/persistence_pg_test.ts` when
  `TEST_PG_URL` is set. The tests create schema and overwrite/delete fixed test-player IDs in that
  database. Use a confirmed disposable test database; an inherited `TEST_PG_URL` alone does not
  establish that. With it unset, these tests are skipped, which does not satisfy a required
  PostgreSQL check.
- `deno task test:pg:local` uses the current Docker context, removes the container named
  `emberdawn-pg-local` before and after the run, and publishes host port `55432`. Before reuse,
  establish that any existing container with that name is disposable and safe to replace and that
  the port is available for this run. The helper has no concurrent isolation; do not run it
  concurrently. If those resources belong to other work, use a separate disposable database via
  `TEST_PG_URL` instead.
- Once the test target and helper resources are established as disposable and available to the task,
  run and rerun the required checks without repeated approval. An unresolved target does not block
  implementation or checks that do not use it.
- `deno task migrate:pg` runs schema setup against `DATABASE_URL`, or the PostgreSQL `PG*`
  environment defaults when that URL is absent. `deno task start` requires `DATABASE_URL` and opens
  the store with schema setup before serving updates. Apply the root action/target authorization
  boundary before using a live database; these are separate from the `TEST_PG_URL` test target.

## Scene state

`SceneState` is a discriminated union. Views use named fields: dialogueId/nodeId/confirmation,
npcId/topic, questId/page, itemId/returnTo/reference, equipped slot, shop mode/page/itemId, zone
panel, and travel confirmEdgeId. Item references and return destinations are structured JSON, not
encoded strings. `validateScene` checks the content identities these variants persist.

## Persisted shapes

- `PlayerState` (`src/engine/types.ts`), including its nested `battle?: BattleState`, is plain JSON:
  no Dates, Maps, Sets, class instances, or functions. `PgStore.set()` serializes the whole player
  into JSONB; added state must preserve its meaning through that round trip. Battle-scoped state
  (for example battle buffs) belongs on `BattleState`; it is saved and restored with the player.
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
- Persistable content IDs include nested and encoded identities, not just top-level catalog keys.
  Use the identity-location inventory in `src/engine/validate.ts` when auditing persisted fields.

## Deployment direction

Releases move forward only, as recorded in AGENTS.md. Functional reverts are new forward changes,
not old binary deployments or schema downgrades. The newer-save refusal remains a consistency check,
not a supported rollback workflow. Pre-launch older saves are still refused, not migrated.

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
locations listed in its module doc against the current content catalogs and throws
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

`MemoryStore` clones on read and write so a loaded mutation requires an explicit save, like JSONB.
Its lock remains a single-process passthrough, not a transaction emulator.

`PlayerStore` has two implementations: `PgStore` (Postgres/JSONB) and `MemoryStore` (tests). The
whole per-player load → mutate → save flow runs inside `PlayerStore.withLock(userId)`; see
`emberdawn-architecture` for the locking contract.
