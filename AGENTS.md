# AGENTS.md — Emberfall

Operating manual for any fresh agentic session working on this repo. Read this
before changing anything.

## What this is

**Emberfall** — a turn-based RPG played entirely inside a single Telegram
message per player, built on **Bot API Rich Messages** (buttons live in the
message *body*, never `reply_markup`). Runtime is **Deno** + **grammY**.
One game message per player is edited in place on every action.

## Non-negotiable architecture rules

1. **Engine purity.** `src/engine/` and `src/content/` must never import
   `grammy` or touch Telegram/Deno-specific APIs. Handlers call pure engine
   functions; rendering is a pure function of `PlayerState`. This is what
   keeps the game testable and the engine reusable.
   - Data flows one way: handler → engine mutation → render → persist.
2. **Single live message.** Each player has exactly one live game message
   (`p.messageId`). Every view change edits that message in place
   (`commit()` in `src/handlers/session.ts`); on edit failure it resends and
   re-points. Never send extra button-bearing messages during normal play
   (the class picker and post-reset message are the only exceptions).
3. **Staleness guard.** Taps on older message copies are answered with a
   toast and ignored (`isLiveMessage`). Newer-than-tracked ids are adopted.
   Do not weaken this into "always process" — stale taps corrupt pacing.
4. **Persistence shape.** `PlayerState` (`src/engine/types.ts`) is plain
   JSON — no class instances, no Maps, no functions. Anything you add must
   survive `JSON.stringify`. Runtime-only state (e.g. battle buffs) lives on
   `BattleState`, not the player.
5. **callback_data budget.** 64 bytes max, built/parsed only via
   `src/codec.ts` (`encodeCb`/`decodeCb`). Add new controls there, never
   inline raw strings in renderers/handlers.
6. **Content refers only to real ids.** Quests/zones/enemies/drops reference
   ids defined in other content modules. The integrity tests in
   `tests/engine_test.ts` ("content integrity: …") enforce this — keep them
   green when adding content.
7. **Rich text, not HTML.** Rich message paragraphs take typed entities
   (`{ type: 'bold', text }`, `{ type: 'italic', text }`). HTML tags like
   `<b>` render literally. Rows of `RichMessageButton` go through
   `src/render/rich.ts` helpers (`buttonsRow`, `cbBtn`, `disabledBtn`).

## Commands

```bash
deno task check   # typecheck everything (must pass before commit)
deno task test    # engine + bot integration tests (must pass)
deno task fmt     # deno fmt (run before commit)
deno task lint    # deno lint (must pass)
npx fallow        # dead code / duplication / complexity audit (advisory)
```

CI discipline: `check + test + lint` green is the commit gate. `fallow`
findings are advisory — evaluate, don't auto-apply (its "unlisted
dependencies" warnings are false positives here: this is a Deno project;
dependencies live in `deno.json`, not `package.json`).

## Where things live

```
src/
├─ codec.ts            # callback_data encode/parse (64-byte budget)
├─ bot.ts              # createBot(): per-user serialization + wiring
├─ main.ts             # webhook (default) or polling (BOT_POLLING=1)
├─ engine/             # PURE game logic — no grammy imports
│  ├─ types.ts         #   PlayerState, BattleState (persisted shapes)
│  ├─ classes.ts       #   class defs + XP curve (MAX_LEVEL = 45)
│  ├─ character.ts     #   creation, xp/level, death
│  ├─ combat.ts        #   turn engine, buffs, rewards
│  ├─ quests.ts        #   quest state machine + objective hooks
│  ├─ world.ts         #   travel, explore, dungeons
│  ├─ shops.ts / forge.ts / inventory.ts / rng.ts
├─ content/            # PURE data — the game's "database"
│  ├─ types.ts         #   content contracts (strict shapes)
│  ├─ items.ts enemies.ts skills.ts zones.ts quests.ts
├─ render/             # PURE (PlayerState) → InputRichMessage
│  ├─ rich.ts parts.ts views.ts battle.ts menus.ts
├─ handlers/           # I/O boundary: ctx + store
│  ├─ session.ts       #   load → mutate → render → commit → save
│  ├─ callbacks.ts     #   central router (staleness guard here)
│  ├─ hub.ts battle.ts commands.ts
└─ persistence/store.ts # PlayerStore: KvStore (Deno KV) | MemoryStore (tests)
tests/                 # deno test; engine tests are seeded/deterministic
scripts/webhook.ts     # deno task webhook <set|info|delete>
```

## Game-design facts (don't break casually)

- **Progression:** 45 levels; `xpForNextLevel(l) = 45·l^2.35 + 20l` —
  deliberately grindy. Enemy stats derive from level in `mk()`
  (`content/enemies.ts`); bosses multiply HP/xp/gold and have scripted
  specials every N turns.
- **Story:** 25 main quests across 6 chapters + postgame Abyss. Chapter
  flags: `chapter1Done`…`chapter6Done`; game-clear moment = defeating
  King Aldric (flag set via dungeon first-clear `crownRestored`).
- **Quest state machine:** unavailable → available → active → turnIn → done.
  `syncAvailability` is idempotent; call it after xp gains, zone entry and
  turn-ins. Kill/reach/talk objectives tick via engine hooks (`onKill`,
  `onZoneEnter`, `onTalk`); collect objectives read the bag live.
- **Economy:** sell = 40% of price. Shop stock derives from zone chapter via
  `shopStock()`. Forge tempers up to +5 (+8%/level of item base stats),
  costs gold + the tier-appropriate material.
- **Death:** −10% gold, revive at 50% HP at the current zone. Phoenix Cinder
  auto-revives once per battle at 50%.

## Adding content (checklist)

1. Define ids first (`e_*`, `w_/a_/t_/c_/m_/q_*`, `sq_*`), then reference.
2. Enemy stats: use `mk()` with level + multipliers — never raw numbers.
3. Wire drops ≤ sensible probabilities (bosses 0.4–1.0, field 0.1–0.6).
4. Quest rewards should cover ~2–3 shop tiers of gear at that level.
5. Run the content-integrity tests; they catch dangling ids.

## Known trade-offs (evaluated fallow findings)

- `deno.json` is the dependency manifest; fallow's "unlisted dependencies"
  (grammy, grammy-testing) is a Node-only heuristic — ignore.
- One residual ~12-line clone pair in `render/views.ts` (shop buy vs sell
  rows). The two rows differ in label/action/semantics; a shared abstraction
  would be more indirect than the duplication. Accepted.
- Large dispatch switches (`callbacks.ts`, view renderers) are flat and
  exhaustive by design; complexity lives in data, not control flow.

## Session-start checklist

1. `deno task check && deno task test && deno task lint` — all green?
2. `git status` — clean tree expected; work on branches/commits per change.
3. Never commit `.env`, tokens, or local KV files (see `.gitignore`).
4. BOT_TOKEN comes from the environment; never write it into the repo.
