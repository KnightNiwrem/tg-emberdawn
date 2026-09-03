# AGENTS.md — Emberdawn

Operating manual for any agentic session working on this repository. Read this before changing
anything.

## What this is

**Emberdawn** is a turn-based RPG about seeking hope for a future, played entirely inside a single
Telegram message per player, built on **Bot API Rich Messages** (buttons live in the message body,
never in `reply_markup`). Runtime is **Deno** + **grammY**. One game message per player is edited in
place on every action.

## Release lifecycle — authoritative status

### Current phase: PRE-LAUNCH

This section is the sole source of truth for whether public save-compatibility obligations are
active. Deployment, playtesting, database contents, tags, and `stateVersion` numbers do not imply
launch. Transition to `LIVE` occurs only through an explicit launch decision.

- First live commit: not established
- First live stateVersion: not established
- Persisted-content ID baseline: not established

### Active now: pre-launch rules

- **Disposable saves:** Development and playtest saves carry no permanent compatibility promise —
  they are disposable.
- **Save version gating:** Persisted-shape changes advance `stateVersion`. The load-time
  `assertSupportedSaveVersion()` gate is strictly non-mutating: older development saves fail with
  `SaveTooOldError` and are refused with an explicit pointer to `/reset` rather than migrated. Saves
  from newer binaries throw `SaveTooNewError`.
- **Content ID flexibility:** Content IDs may be added, renamed, or removed whenever required by the
  current content model. Deleted pre-launch IDs require no aliases, tombstones, or recovery
  migrations.
- **No dangling references:** Every ID emitted by constructors or referenced by current
  content/engine paths must resolve. Catalog content-integrity and progression tests remain
  mandatory.
- **No guessing:** Never guess a replacement for an unknown or corrupt persisted ID; fail observably
  rather than silently altering player state.
- **Launch gate:** Public launch must never be inferred from deployment or version tags.

_For deferred post-launch rules (durable IDs, versioned migrations) and the launch-transition
checklist, see the `emberdawn-release` skill (`.agents/skills/emberdawn-release/SKILL.md`)._

## Non-negotiable architecture invariants

All contributions must respect these cross-cutting invariants:

1. **Engine purity.** `src/engine/` and `src/content/` must never import `grammy`, call Deno runtime
   APIs (`Deno.*`), or access network, database, filesystem, environment, or Telegram APIs. Handlers
   call pure engine functions; rendering is a pure function of `PlayerState`. Data flows strictly
   one way: `handler (I/O) → engine mutation (pure) → render (pure) → persist (I/O)`.
2. **Ordered completion.** Telegram, network, and database operations are asynchronous I/O wrapped
   around a deterministic game core. Every resolution flow must be synchronously complete before
   rendering or persistence begins. Combat uses no event bus, listener queues, timers, microtask
   queues, detached callbacks, unawaited mutations, or `Promise.all` over mutations of the same
   battle.
3. **Single live message & staleness guard.** Each player has exactly one active game message
   (`p.messageId`). Every view change edits that message in place (`commit()` in
   `src/handlers/session.ts`), falling back to resending and re-pointing on edit failure. Never send
   extra button-bearing messages during normal play.
   - Taps on older message copies are answered with a toast notification and ignored.
   - Every committed view stamps its interactive buttons with the player's current render revision
     (`p.uiRev`, cycled 1..9999).
   - Callback data embeds `<view>:<rev>:<action>`; the central router rejects revision mismatches
     before executing mutations. Replays and double-taps on the same live message are no-ops.
   - All gameplay callbacks must carry a stamped revision; rev-less callbacks are rejected as stale
     (sole exception: the pre-player class picker `m:pk:<class>`).
4. **Per-player locking & consistency.** Every player update must execute inside
   `PlayerStore.withLock(user)`:
   - In-process concurrency is serialized by a per-user promise chain.
   - In PostgreSQL, `PgStore.withLock` holds a transaction-scoped advisory lock on a dedicated
     connection across the entire load → mutate → save sequence.
   - Two bot instances cannot interleave read-modify-write cycles for the same player, preventing
     lost writes.
   - Never mutate player state outside the lock; never await user input or external events inside
     the lock.
5. **callback_data budget.** Telegram limits `callback_data` to 64 UTF-8 bytes. All callbacks are
   encoded and decoded exclusively through `src/codec.ts` (`encodeCb` / `decodeCb`). Never inline
   raw callback strings in renderers or handlers.
6. **Persistence shape.** `PlayerState` (`src/engine/types.ts`) is strictly plain JSON — strings,
   numbers, booleans, arrays, and plain objects. No class instances, `Map`, `Set`, or functions;
   state must survive `JSON.stringify`. Active combat state is grouped under the nested
   `battle?: BattleState` field on `PlayerState`.
7. **Rich text, not HTML.** Telegram Bot API Rich Messages take typed entities
   (`{ type: 'bold', text }`, `{ type: 'italic', text }`). Raw HTML tags (like `<b>`) render
   literally. Buttons live in the message body via `src/render/rich.ts` helpers (`buttonsRow`,
   `cbBtn`, `disabledBtn`), never in `reply_markup`.
8. **Flavor vs mechanics.** A skill or item's name and flavor (`SkillDef.flavor`, `ItemDef.desc`)
   are creative and nonliteral, never a mechanical rules source. Player-facing rules summaries are
   generated programmatically from structured effect specifications via `src/engine/mechanics.ts`.
   Never hardcode numbers into authored prose. Canonical rules vocabulary: **Shield** (absorbable
   pool, never "ward"), **DEF/RES**, **round** (duration/tick unit), **action** (actor turn),
   **beneficial/harmful effect** (cleanse/dispel categories).
9. **Story and quest authority.** Story and quest mutations derive identity and authorization
   strictly from live `PlayerState` and content definitions, never callback data or caller
   assertions. Central engine operations revalidate scene view, dialogue ownership, NPC physical
   presence, and conditions; story bundles commit transactionally against a draft clone; retries are
   suppressed by stable one-shot receipts (`p.storyReceipts`); and terminal quest outcomes are
   monotonic. Use `emberdawn-story-and-quests` before changing this subsystem.
10. **Secrets & environment.** Never commit `.env` files, bot tokens, or database credentials.
    Webhook authentication verifies `X-Telegram-Bot-Api-Secret-Token` in constant time before
    parsing updates.

## Task-to-skill routing

Load only the specific standard Agent Skill(s) relevant to your current task. If your agentic
harness does not automatically discover or load a skill, read its listed `SKILL.md` path directly:

| When the task touches...                                                       | Use this standard Agent Skill                                                         |
| :----------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| Engine boundaries, handlers, message lifecycle, callbacks, locking             | `emberdawn-architecture` (`.agents/skills/emberdawn-architecture/SKILL.md`)           |
| Quests, NPC topics, dialogue, choices, StoryEffects, receipts/outcomes         | `emberdawn-story-and-quests` (`.agents/skills/emberdawn-story-and-quests/SKILL.md`)   |
| Combat, effects, initiative, durations, death/revival, telemetry, balance      | `emberdawn-combat` (`.agents/skills/emberdawn-combat/SKILL.md`)                       |
| PlayerState/BattleState, stateVersion, stores, persisted IDs                   | `emberdawn-persistence` (`.agents/skills/emberdawn-persistence/SKILL.md`)             |
| Items, skills, enemies, zones, dungeons, drops, NPCs, quest definitions        | `emberdawn-content-authoring` (`.agents/skills/emberdawn-content-authoring/SKILL.md`) |
| Authored player-facing prose, dialogue voices, motifs, editorial style         | `emberdawn-narrative-writing` (`.agents/skills/emberdawn-narrative-writing/SKILL.md`) |
| Explicit public launch, durable IDs, save migrations                           | `emberdawn-release` (`.agents/skills/emberdawn-release/SKILL.md`)                     |
| Forge, equipment shops, dungeon flow, trophies, prologue disclosure, non-goals | `emberdawn-design-decisions` (`.agents/skills/emberdawn-design-decisions/SKILL.md`)   |

## Repository layout

Directory-level routing across the codebase:

```text
src/
├─ engine/         # Pure game logic (combat, character, quests, world, rng, story)
├─ content/        # Pure game definitions (enemies, items, skills, quests, dialogues)
├─ render/         # Pure view renderers (Rich Message blocks, buttons, menus)
├─ handlers/       # Telegram boundary, callback routing, session commit, commands
└─ persistence/    # Player stores (PgStore, MemoryStore) and migration runners
tests/             # Deterministic engine tests, balance harnesses, integration suites
scripts/           # Operational tooling (webhook configuration, balance simulations)
```

## Verification & CI discipline

Automated CI gates run on every pull request and push to `main` (`.github/workflows/ci.yml`).

### Commit gates

Before committing or opening a pull request, verify that all standard gates pass cleanly:

```bash
deno task fmt:check   # Formatting check (run `deno task fmt` to fix)
deno task lint        # Deno linter
deno task check       # TypeScript typecheck
deno task test        # Deterministic engine and integration tests
```

### Persistence changes

When modifying `PlayerState`, `BattleState`, database queries, or `src/persistence/`, testing
against a real PostgreSQL instance is mandatory:

```bash
deno task test:pg:local   # Automatically spins up a temporary Docker Postgres, tests, and cleans up
# or: TEST_PG_URL=postgresql://... deno task test:pg
```

### Advisory tools

- `npx --yes fallow@~3.20`: Runs dead code, duplication, and complexity audits. Findings are
  advisory; its "unlisted dependencies" warnings for Deno packages (`grammy`, `grammy-testing`) are
  false positives and should be ignored.

### Session workflow

1. Inspect `git status` before making edits to ensure a clean working tree.
2. Run targeted tests frequently while implementing changes.
3. Run the full CI gate suite (`fmt:check`, `lint`, `check`, `test`) before submitting.
