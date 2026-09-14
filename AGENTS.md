# AGENTS.md — Emberdawn

Read this operating manual before changing the repository.

## What this is

**Emberdawn** is a turn-based Telegram RPG about seeking hope for a future, built with **Deno** and
**grammY**. Bot API Rich Message buttons belong in the message body, never in `reply_markup`.

BotFather enforces private-chat-only operation. Group handling and custom-crafted callback payloads
are outside scope. Preserve stale-tap protection and engine/story authority; confirmation actions
require their active confirmation scene.

## Release lifecycle — current status: PRE-LAUNCH

This section alone determines the release phase and active save-compatibility obligations. Public
launch requires an explicit decision; never infer it from deployment, playtesting, database
contents, tags, or `stateVersion`.

- Releases move forward only: functional reverts ship as new changes, never older binaries or schema
  downgrades. Failed database operations still require transaction rollback for atomicity.
- Development and playtest saves are DISPOSABLE, with no compatibility promise.
- Persisted-shape changes advance `stateVersion`. Refuse older development saves; never add
  `PlayerState`/save-payload migrations for retired pre-launch saves. PostgreSQL schema migrations
  are separate.
- Content IDs may be added, renamed, or removed without aliases, tombstones, or recovery shims.
  Every ID referenced by current code or content must resolve.
- Refuse detected unknown or corrupt persisted IDs with a pointer to /reset; never repair them,
  guess replacements, or invent fallback state.

Mechanics: `emberdawn-persistence`. Explicit launch or post-launch policy: `emberdawn-release`.

## Cross-cutting architecture invariants

These apply to every change:

1. **Engine purity.** `src/engine/` and `src/content/` never import grammy or Telegram/Deno-specific
   APIs. Handlers call pure engine functions; rendering is pure from `PlayerState`. Flow: handler →
   engine mutation → render → persist.
2. **Ordered completion.** Deterministic, explicitly ordered gameplay resolution completes before
   rendering or persistence. No event bus, detached state mutation, or parallel mutation of one
   fight. Async I/O belongs only at the Telegram/database boundary. See
   `tests/architecture_test.ts`.
3. **Single live message.** Normal play edits one live message per player via `commit()` in
   `src/handlers/session.ts`; never send extra button-bearing messages. Explicit `/start` delivers a
   fresh live message and makes older copies stale.
4. **Staleness and revision guard.** Committed renders stamp buttons with `uiRev`. Validate message
   identity and revision BEFORE gameplay mutation; stale or revisionless gameplay callbacks are
   no-ops. Preserve tracked-revision matching and newer-copy adoption per the architecture skill's
   message-lifecycle reference.
5. **Cross-instance consistency.** Every user-associated update runs inside
   `PlayerStore.withLock(user)` around load → mutate → save. Never mutate player state outside the
   lock or hold it across user input.
6. **callback_data budget.** 64 bytes maximum, built and parsed only via `src/codec.ts`
   (`encodeCb`/`decodeCb`). Never inline raw callback strings in renderers or handlers.
7. **Persisted state is plain JSON.** `PlayerState`, including `BattleState`, must round-trip as
   plain JSON. Battle-scoped state belongs on `BattleState`; derived runtime context is never
   persisted. Detailed shape rules live in `emberdawn-persistence`.
8. **Rich text, not HTML.** Use typed entities and `src/render/rich.ts`; HTML tags render literally.
9. **Flavor is not rules.** Item/skill names and flavor are creative, never rules sources. Generate
   mechanical summaries from structured effect specs; never hand-write a second description.
   Canonical rules vocabulary: Shield, DEF/RES, round, action, beneficial/harmful effect.
10. **Secrets.** Never commit `.env`, tokens, or local database files.
11. **Descriptive naming.** Variable names reveal intent; no single-letter domain variables. Only
    compact `callback_data` keys/values and idiomatic short loop indices are exempt. Semantic
    counters need role names even in loops (#217).

## Story-authority invariant

Derive story/quest identity and authorization from live `PlayerState` and content, never callback
data or caller assertions. Central engine operations revalidate scene, ownership, location, and
conditions. Story bundles commit transactionally; stable receipts suppress retries; terminal quest
outcomes are monotonic. Behavior and authority details: `emberdawn-story-and-quests`.

## Conditional skills

Load only skills for contracts being changed, reviewed, or investigated. If the harness does not
auto-load them, read the listed `SKILL.md` files directly. Authored wording-only edits use
`emberdawn-narrative-writing`; load additional skills when IDs, structure, gameplay, or authority
are also affected. Reading existing `PlayerState` fields alone does not require persistence
guidance.

| When changing or reviewing...                                                                      | Read this skill                                                                       |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Engine/I/O boundaries, message lifecycle, callback handling, locking, reset, webhook behavior      | `emberdawn-architecture` (`.agents/skills/emberdawn-architecture/SKILL.md`)           |
| Dialogue flow, NPC topic behavior, quest lifecycle, story effects or authority                     | `emberdawn-story-and-quests` (`.agents/skills/emberdawn-story-and-quests/SKILL.md`)   |
| Combat rules, effects, encounter selection, dungeon behavior, telemetry, balance                   | `emberdawn-combat` (`.agents/skills/emberdawn-combat/SKILL.md`)                       |
| Persisted PlayerState/BattleState shape, stores, save versioning/compatibility, persisted IDs      | `emberdawn-persistence` (`.agents/skills/emberdawn-persistence/SKILL.md`)             |
| Content IDs, structure, gameplay data, economy                                                     | `emberdawn-content-authoring` (`.agents/skills/emberdawn-content-authoring/SKILL.md`) |
| Authored player-facing prose                                                                       | `emberdawn-narrative-writing` (`.agents/skills/emberdawn-narrative-writing/SKILL.md`) |
| An explicit public launch; post-launch save compatibility, migrations or durable content-ID policy | `emberdawn-release` (`.agents/skills/emberdawn-release/SKILL.md`)                     |
| Intentional trade-offs and non-goals                                                               | `emberdawn-design-decisions` (`.agents/skills/emberdawn-design-decisions/SKILL.md`)   |

## Verification

Use targeted checks during implementation. Before committing or reporting completion, code or mixed
changes must pass these gates; reuse valid results and rerun checks affected by later edits:

```bash
deno task fmt:check
deno task lint
deno task check
deno task test
```

Documentation-only eligibility, document checks, and failure reporting follow the
[verification policy](docs/verification.md). Full CI, including PostgreSQL, still runs for every PR.

Persistence or schema behavior changes also require `deno task test:pg`; `deno task test:pg:local`
provisions a throwaway Docker Postgres.

`deno task test` has environment/network access and runs PostgreSQL tests when `TEST_PG_URL` is set.
Keep it unset unless it targets a confirmed disposable test database. Before database tests, read
`emberdawn-persistence` for command targets and local-helper resource ownership.

`npx fallow` is advisory only — evaluate findings per
[the code-quality review guidance](docs/code-quality.md) and the settled calls in
`emberdawn-design-decisions`; never auto-apply removals (#185).

## Repository layout

- `src/engine/` — pure game logic
- `src/content/` — pure content definitions
- `src/render/` — pure rich-message rendering
- `src/handlers/` — Telegram/I/O boundary
- `src/persistence/` — stores and schema handling
- `tests/` — deterministic engine and integration tests

## Working on a change

Check `git status` before editing; preserve unrelated work and use an isolated worktree when needed.
Existing user changes do not by themselves block the task.

Complete the requested outcome through integration, repairs for change-caused failures, and the
verification above. Committed code is a deliverable: review correctness, readability, descriptive
naming, and consistency with the existing design. Finish when acceptance criteria and required
checks are satisfied; otherwise report the precise blocker, unfinished work, and reason.

Keep each PR focused on one requested outcome, including its necessary supporting changes. Propose
independent improvements as separate issues and sequential PRs. Continue autonomously within the
authorized scope; routine implementation and verification need no repeated approval.

## Operational boundaries

Run and rerun checks against confirmed disposable resources without asking at each step. Deployment,
starting a bot, webhook mutation, and live database changes need authorization covering the action
and target. Use authorization already provided in the request or conversation; configured
credentials alone do not establish it. If an action or target remains unresolved, continue
preparation and local verification, then ask only for the missing decision before that operation.

For bot startup or webhook operations, read the architecture skill's
[webhook reference](.agents/skills/emberdawn-architecture/references/webhooks.md). For database
command targets, read `emberdawn-persistence`. Public launch remains a separate explicit decision
under the release lifecycle above. These instructions do not override tool or environment
permissions.
