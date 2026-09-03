# AGENTS.md — Emberdawn

Operating manual for any fresh agentic session working on this repository. Read this entry point
first; consult subsystem guides conditionally based on your task.

## What this is

**Emberdawn** is a turn-based RPG about seeking hope for a future, played entirely inside a single
Telegram message per player. It is built on **Telegram Bot API Rich Messages** where buttons live in
the message _body_, never in `reply_markup`.

- Runtime: **Deno** + **grammY**.
- Live gameplay edits one message per player in place on every action.
- The player is a **Dawncaller**, recovering pieces of a stolen dawn across a ruined realm.

## Release lifecycle — authoritative status

**Current phase: PRE-LAUNCH**

This section is the sole source of truth for whether public save-compatibility obligations are
active. Deployments, playtests, database contents, Git tags, and `stateVersion` numbers do NOT imply
launch. Change this phase to `LIVE` only through an explicit launch decision and the transition
checklist in `docs/agent-guides/release.md`.

### Active now: pre-launch rules

- **Disposable saves:** Development and playtest saves carry no compatibility promise. They are
  disposable; older saves are refused with `/reset`.
- **Schema changes:** Persisted-shape modifications advance `CURRENT_STATE_VERSION`. Outdated
  development saves are refused by the non-mutating `assertSupportedSaveVersion()` gate rather than
  migrated.
- **Content identifier churn:** Content IDs (items, quests, skills, enemies, zones, dungeons, NPCs)
  may be added, renamed, or removed freely without runtime shims, aliases, tombstones, or
  migrations.
- **No dangling references:** Every ID emitted by constructors or referenced in current content and
  engine paths must resolve. Catalog integrity and campaign progression tests remain strictly
  mandatory.
- **No silent recovery:** Never guess a replacement for an unknown or corrupt persisted ID. Never
  invent fallback state or silently rewrite save files.
- **Explicit launch gate:** Public launch must never be inferred or automated merely because a
  deployment or version tag exists.

_For deferred post-launch rules (durable IDs, versioned migrations) and the launch-transition
checklist, see `docs/agent-guides/release.md`._

## Non-negotiable architecture invariants

All contributions must respect these cross-cutting invariants:

1. **Engine purity.** `src/engine/` and `src/content/` must never import `grammy` or access network,
   database, or Telegram APIs. Handlers call pure engine functions; rendering is a pure function of
   `PlayerState`. Data flows strictly one way:
   $$\text{handler (I/O)} \longrightarrow \text{engine mutation (pure)} \longrightarrow \text{render (pure)} \longrightarrow \text{persist (I/O)}$$
2. **Ordered completion.** Telegram, network, and database operations are asynchronous I/O wrapped
   around a deterministic core. Every resolution flow must be synchronously complete before
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
     _before_ executing mutations. Replays and double-taps on the same live message are no-ops.
   - All gameplay callbacks must carry a stamped revision; rev-less callbacks are rejected as stale
     (sole exception: the pre-player class picker `m:pk:<class>`).
4. **Per-player locking & consistency.** Every player update must execute inside
   `PlayerStore.withLock(user)`:
   - In-process concurrency is serialized by a per-user promise chain.
   - In PostgreSQL, `PgStore.withLock` holds a transaction-scoped advisory lock on a dedicated
     connection across the entire load $\rightarrow$ mutate $\rightarrow$ save sequence.
   - Two bot instances cannot interleave read-modify-write cycles for the same player, preventing
     lost writes.
   - Never mutate player state outside the lock; never await user input or external events inside
     the lock.
5. **callback_data budget.** Telegram limits `callback_data` to 64 UTF-8 bytes. All callbacks are
   encoded and decoded exclusively through `src/codec.ts` (`encodeCb` / `decodeCb`). Never inline
   raw callback strings in renderers or handlers.
6. **Persistence shape.** `PlayerState` (`src/engine/types.ts`) is strictly plain JSON — strings,
   numbers, booleans, arrays, and plain objects. No class instances, `Map`, `Set`, or functions;
   state must survive `JSON.stringify`. Runtime-only combat state lives on `BattleState`, not on the
   player.
7. **Rich text, not HTML.** Telegram Bot API Rich Messages take typed entities
   (`{ type: 'bold', text }`, `{ type: 'italic', text }`). Raw HTML tags (like `<b>`) render
   literally. Buttons live in the message body via `src/render/rich.ts` helpers (`buttonsRow`,
   `cbBtn`, `disabledBtn`), never in `reply_markup`.
8. **Flavor vs mechanics.** A skill or item's name and flavor (`SkillDef.flavor`, `ItemDef.desc`)
   are creative and nonliteral, never a mechanical source. Player-facing rules summaries are
   generated programmatically from structured effect specifications via `src/engine/mechanics.ts`.
   Never hardcode numbers into authored prose. Canonical rules vocabulary: **Shield** (absorbable
   pool, never "ward"), **DEF/RES**, **round** (duration/tick unit), **action** (actor turn),
   **beneficial/harmful effect** (cleanse/dispel categories).
9. **Story and quest authority.** Story and quest mutations derive identity and authorization
   strictly from live `PlayerState` and content definitions, never callback data or caller
   assertions. Central engine operations revalidate scene view, dialogue ownership, NPC physical
   presence, and conditions; story bundles commit transactionally against a draft clone; retries are
   suppressed by stable one-shot receipts (`p.storyReceipts`); and terminal quest outcomes are
   monotonic.
10. **Secrets & environment.** Never commit `.env` files, bot tokens, or database credentials.
    Webhook authentication verifies `X-Telegram-Bot-Api-Secret-Token` in constant time before
    parsing updates.

## Task-to-guide routing

Do not load all guides every session. Read only the specific documentation relevant to your current
task:

| When the task touches...                                                  | Read first                               |
| :------------------------------------------------------------------------ | :--------------------------------------- |
| Engine boundaries, handlers, message lifecycle, callbacks, locking        | `docs/agent-guides/architecture.md`      |
| Quests, NPC topics, dialogue, choices, story effects, receipts/outcomes   | `docs/agent-guides/story-and-quests.md`  |
| Combat, effects, initiative, durations, death/revival, telemetry, balance | `docs/agent-guides/combat.md`            |
| `PlayerState` / `BattleState`, `stateVersion`, stores, persisted IDs      | `docs/agent-guides/persistence.md`       |
| Items, skills, enemies, zones, dungeons, drops, quest definitions         | `docs/agent-guides/content-authoring.md` |
| Authored player-facing prose, dialogue voices, motifs, style              | `docs/narrative-guide.md`                |
| Explicit public launch, durable IDs, save migrations                      | `docs/agent-guides/release.md`           |
| Intentional trade-offs, accepted linter findings, non-goals               | `docs/agent-guides/design-decisions.md`  |

## Repository layout

Directory-level routing across the codebase:

```text
src/
├─ engine/         # Pure game logic (combat, character, quests, world, rng, story)
├─ content/        # Pure game definitions (enemies, items, skills, quests, dialogues)
├─ render/         # Pure view renderers (Rich Message blocks, buttons, menus)
├─ handlers/       # Telegram/IO boundary (callback routing, session commit, commands)
└─ persistence/    # Storage implementations (PgStore, MemoryStore) and migrations
tests/             # Deterministic engine tests, progression simulation, integration tests
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

- `npx fallow`: Runs dead code, duplication, and complexity audits. Findings are advisory; its
  "unlisted dependencies" warnings for Deno packages (`grammy`, `grammy-testing`) are false
  positives and should be ignored.

### Session workflow

1. Inspect `git status` before making edits to ensure a clean working tree.
2. Run targeted tests frequently while implementing changes.
3. Run the full CI gate suite (`fmt:check`, `lint`, `check`, `test`) before submitting.
