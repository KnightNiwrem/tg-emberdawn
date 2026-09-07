# AGENTS.md — Emberdawn

Operating manual for agents working on this repository. Read this before changing anything.

## What this is

**Emberdawn** is a turn-based RPG about seeking hope for a future, played entirely inside Telegram.
Runtime: **Deno** + **grammY**, built on Bot API Rich Messages — buttons live in the message body,
never in `reply_markup`. Normal play happens in one live game message per player, edited in place on
every action.

## Release lifecycle — current status: PRE-LAUNCH

This section is the only source of truth for whether save-compatibility obligations are active.
Deployment, playtesting, database contents, tags, and `stateVersion` numbers do NOT imply launch.

- Development and playtest saves are DISPOSABLE; they carry no compatibility promise.
- Persisted-shape changes advance `stateVersion`; older development saves are refused rather than
  migrated. Do not add `PlayerState`/save-payload migrations for retired pre-launch development
  saves; PostgreSQL schema migrations are a separate concern.
- Content IDs may be added, renamed, or removed freely — with no aliases, tombstones, or recovery
  shims — but every ID referenced by current code and content must resolve.
- Never silently guess a replacement for an unknown or corrupt persisted ID, and never invent
  fallback state for one: a detected unresolved ID is refused with a pointer to /reset — never
  repaired or substituted.
- Public launch is an explicit decision only; never infer it from a deployment or version tag.

For the mechanics behind this policy, load the `emberdawn-persistence` skill; for an explicit launch
decision or post-launch compatibility policy, load the `emberdawn-release` skill.

## Cross-cutting architecture invariants

These apply to every change:

1. **Engine purity.** `src/engine/` and `src/content/` never import grammy or Telegram/Deno-specific
   APIs. Handlers call pure engine functions; rendering is a pure function of `PlayerState`. Data
   flows one way: handler → engine mutation → render → persist.
2. **Ordered completion.** Gameplay resolution is one deterministic, explicitly ordered flow that is
   complete before rendering or persistence proceeds. No event bus, no detached state mutation, no
   parallel mutation of the same fight. Async I/O belongs only at the Telegram/database boundary.
   Pinned by `tests/architecture_test.ts`.
3. **Single live message.** Each player has exactly one live game message. Normal gameplay view
   changes edit it in place via `commit()` in `src/handlers/session.ts`. Explicit `/start` delivers
   a fresh live message; older copies become stale. Never send extra button-bearing messages during
   normal play.
4. **Staleness and revision guard.** Every committed render stamps its buttons with the player's
   `uiRev`; the router validates message identity and revision BEFORE gameplay mutation. Tracked
   messages require a matching revision; a newer copy may become authoritative by adopting its
   stamped revision. Stale taps and revisionless gameplay callbacks are no-ops. Do not weaken this
   into "always process".
5. **Cross-instance consistency.** Every user-associated update runs inside
   `PlayerStore.withLock(user)` around the whole load → mutate → save flow. Never mutate player
   state outside the lock; never hold the lock across user input.
6. **callback_data budget.** 64 bytes maximum, built and parsed only via `src/codec.ts`
   (`encodeCb`/`decodeCb`). Never inline raw callback strings in renderers or handlers.
7. **Persisted state is plain JSON.** `PlayerState` — including its nested `BattleState` — is
   persisted as plain JSON: no Dates, Maps, Sets, class instances, or functions. Battle-scoped state
   belongs on `BattleState`; genuinely derived, runtime-only context such as `DerivedStats` is never
   persisted.
8. **Rich text, not HTML.** Rich messages use typed entities (`{ type: 'bold', text }`) and the
   helpers in `src/render/rich.ts`. HTML tags render literally.
9. **Flavor is not rules.** Item and skill names and flavor text are creative, never a rules source.
   Player-facing mechanical summaries are generated from structured effect specs; never hand-write a
   second description. Canonical rules vocabulary: Shield, DEF/RES, round, action,
   beneficial/harmful effect.
10. **Secrets.** Never commit `.env`, tokens, or local database files.
11. **Descriptive naming.** Variable names must be descriptive and reveal intent; avoid
    single-letter domain variables (e.g. use `player`, `battle`, `questDef`, `itemDef`, `stats`).
    Compact `callback_data` keys and values and idiomatic short loop indices (`i`, `j`) are the only
    exceptions. Name semantic counters for their role (e.g. `candidateSeed`, `floorNumber`,
    `tierIndex`), even in loops (#217).

## Story-authority invariant

Story and quest mutations derive identity and authorization from live `PlayerState` and content
definitions, never from callback data or caller assertions. Central engine operations revalidate
scene, ownership, location, and conditions; story bundles commit transactionally; retries are
suppressed by stable receipts; terminal quest outcomes are monotonic. Load
`emberdawn-story-and-quests` before changing this subsystem.

## Conditional skills

Detailed, conditionally loaded guidance lives in standard Agent Skills under `.agents/skills/`. Load
only the skill or skills relevant to the task — not every skill each session. If your harness does
not auto-load a matching skill, read its `SKILL.md` file directly at the listed path.

| When the task touches...                                                            | Read this skill                                                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Engine boundaries, handlers, message lifecycle, callbacks, locking, reset, webhook  | `emberdawn-architecture` (`.agents/skills/emberdawn-architecture/SKILL.md`)           |
| Quests, NPC topics, dialogue, choices, StoryEffects, receipts, outcomes             | `emberdawn-story-and-quests` (`.agents/skills/emberdawn-story-and-quests/SKILL.md`)   |
| Combat, effects, initiative, durations, death/revival, telemetry, dungeons, balance | `emberdawn-combat` (`.agents/skills/emberdawn-combat/SKILL.md`)                       |
| PlayerState/BattleState, stateVersion, stores, persisted IDs                        | `emberdawn-persistence` (`.agents/skills/emberdawn-persistence/SKILL.md`)             |
| Items, skills, enemies, zones, dungeons, drops, NPCs, quest definitions, economy    | `emberdawn-content-authoring` (`.agents/skills/emberdawn-content-authoring/SKILL.md`) |
| Authored player-facing prose                                                        | `emberdawn-narrative-writing` (`.agents/skills/emberdawn-narrative-writing/SKILL.md`) |
| An explicit public launch                                                           | `emberdawn-release` (`.agents/skills/emberdawn-release/SKILL.md`)                     |
| Intentional trade-offs and non-goals                                                | `emberdawn-design-decisions` (`.agents/skills/emberdawn-design-decisions/SKILL.md`)   |

## Verification

CI (`.github/workflows/ci.yml`) runs these gates; all must pass before committing:

```bash
deno task fmt:check
deno task lint
deno task check
deno task test
```

Also run `deno task test:pg` (the Postgres round-trip) whenever persistence or schema behavior
changes; `deno task test:pg:local` provisions a throwaway Docker Postgres.

`npx fallow` is advisory only — evaluate findings per
[the code-quality review guidance](docs/code-quality.md) and the settled calls in
`emberdawn-design-decisions`; never auto-apply removals (#185).

## Repository layout

- `src/engine/` — pure game logic
- `src/content/` — pure content definitions
- `src/render/` — pure rendering (`PlayerState` → rich message)
- `src/handlers/` — Telegram/I/O boundary
- `src/persistence/` — stores and schema handling
- `tests/` — deterministic engine and integration tests

## Working on a change

1. Check `git status` before editing; start from a clean tree.
2. Load the skill or skills that match your task from the table above.
3. Run the relevant targeted tests while you work; run all CI gates before finishing.
