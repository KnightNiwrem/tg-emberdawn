# AGENTS.md — Emberdawn

Operating manual for any fresh agentic session working on this repo. Read this before changing
anything.

## What this is

**Emberdawn** — a turn-based RPG about seeking hope for a future, played entirely inside a single
Telegram message per player, built on **Bot API Rich Messages** (buttons live in the message _body_,
never `reply_markup`). Runtime is **Deno** + **grammY**. One game message per player is edited in
place on every action.

## Non-negotiable architecture rules

1. **Engine purity.** `src/engine/` and `src/content/` must never import `grammy` or touch
   Telegram/Deno-specific APIs. Handlers call pure engine functions; rendering is a pure function of
   `PlayerState`. This is what keeps the game testable and the engine reusable.
   - Data flows one way: handler → engine mutation → render → persist.
2. **Single live message.** Each player has exactly one live game message (`p.messageId`). Every
   view change edits that message in place (`commit()` in `src/handlers/session.ts`); on edit
   failure it resends and re-points. Never send extra button-bearing messages during normal play
   (the class picker and post-reset message are the only exceptions).
3. **Staleness guard.** Taps on older message copies are answered with a toast and ignored
   (`isLiveMessage`). Newer-than-tracked ids are adopted. Do not weaken this into "always process" —
   stale taps corrupt pacing.
4. **Persistence shape.** `PlayerState` (`src/engine/types.ts`) is plain JSON — no class instances,
   no Maps, no functions. Anything you add must survive `JSON.stringify`. Runtime-only state (e.g.
   battle buffs) lives on `BattleState`, not the player.
5. **callback_data budget.** 64 bytes max, built/parsed only via `src/codec.ts`
   (`encodeCb`/`decodeCb`). Add new controls there, never inline raw strings in renderers/handlers.
6. **Content refers only to real ids.** Quests/zones/enemies/drops reference ids defined in other
   content modules. The integrity tests in `tests/engine_test.ts` ("content integrity: …") enforce
   this — keep them green when adding content.
7. **Rich text, not HTML.** Rich message paragraphs take typed entities (`{ type: 'bold', text }`,
   `{ type: 'italic', text }`). HTML tags like `<b>` render literally. Rows of `RichMessageButton`
   go through `src/render/rich.ts` helpers (`buttonsRow`, `cbBtn`, `disabledBtn`).

## Commands

```bash
deno task check   # typecheck everything (must pass before commit)
deno task test    # engine + bot integration tests (must pass)
deno task test:pg # Postgres round-trip (real DB; skipped unless TEST_PG_URL set)
deno task fmt     # deno fmt (run before commit)
deno task lint    # deno lint (must pass)
npx fallow        # dead code / duplication / complexity audit (advisory)
```

CI discipline: `check + test + lint` green is the commit gate. `fallow` findings are advisory —
evaluate, don't auto-apply (its "unlisted dependencies" warnings are false positives here: this is a
Deno project; dependencies live in `deno.json`, not `package.json`).

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
└─ persistence/store.ts # PlayerStore: PgStore (Postgres/JSONB) | MemoryStore (tests)
tests/                 # deno test; engine tests are seeded/deterministic
scripts/webhook.ts     # deno task webhook <set|info|delete>
```

## Game-design facts (don't break casually)

- **Progression:** 45 levels; `xpForNextLevel(l) = 45·l^2.35 + 20l` — deliberately grindy. Enemy
  stats derive from level in `mk()` (`content/enemies.ts`); bosses multiply HP/xp/gold and have
  scripted specials every N turns.
- **Story & theme:** the game is about _seeking hope for a future_ — the player is a **Dawncaller**,
  the Sundered King is despair hoarding tomorrow, and each chapter recovers a piece of the dawn. 25
  main quests across 6 chapters + postgame Abyss. Chapter flags: `chapter1Done`…`chapter6Done`;
  game-clear moment = defeating King Aldric (flag set via dungeon first-clear `crownRestored`). Keep
  new writing in this register: setbacks are real but framed as "not yet", never "never".
- **Quest state machine:** unavailable → available → active → turnIn → done. `syncAvailability` is
  idempotent; call it after xp gains, zone entry and turn-ins. Kill/reach/talk objectives tick via
  engine hooks (`onKill`, `onZoneEnter`, `onTalk`); collect objectives read the bag live.
- **Economy:** sell = 40% of price. Shop stock tier derives from PLAYER level, clamped to the zone's
  level band (`shopTierFor()`), so the Abyss stocks tier-8 gear. Forge tempers up to +5 are bound to
  the ITEM (`forge_i_<itemId>` flags) and boost only that item's own base stats; the temper material
  is chosen by the item's tier, not the player's location.
- **Save schema:** `stateVersion` (default 0) gates one-time migrations; v2 migrated slot-bound
  tempers + old battle shape (string origin, missing buff fields → neutral defaults, so combat can
  never see NaN). Unversioned saves are GRANDFATHERED, never gear-destructive: the old v0→v1
  bag-duplicate dedup was retired — it could not tell a real legacy duplicate from a legitimate
  re-purchase, and missed the post-swap shape (old starter duplicated) anyway. Legacy slot-bound
  tempers adopt losslessly onto the next UNTempered item equipped in their slot (every-load step; an
  item's own temper always wins; nothing is ever deleted). Saves from NEWER binaries
  (`stateVersion > CURRENT_STATE_VERSION`) throw `SaveTooNewError`; handlers refuse to
  read-mutate-write rather than downgrade.
- **Endgame economy:** postgame XP converts to gold (`ceil(xp / 4)`) instead of vanishing;
  safe-haven forage recharges on a 6h real-time cooldown (`forageResetAt`) — free travel never
  refreshes it; the Vault boss floor consumes the Sunspire Key on the first VICTORIOUS entry; boss
  first-clears award unique boss trinkets `t_12`–`t_18` (never stocked).
- **Death:** −10% gold, revive at 50% HP at the first safe haven (never where you fell). Phoenix
  Cinder auto-revives ONCE per battle (`phoenixUsed`), only from the auto trigger — never by hand.
- **Battles carry structured provenance** (`BattleOrigin`): `explore`/`elite`/`dungeon` with floor +
  boss flags. Dungeon floors advance on VICTORY only; boss floors are story-gated via `bossGate`
  (kill-quest bosses use `requireDone: false`). Victory bookkeeping routes through
  `resolveVictory()` in world.ts — overworld kills never touch dungeon state.

## Adding content (checklist)

1. Define ids first (`e_*`, `w_/a_/t_/c_/m_/q_*`, `sq_*`), then reference.
2. Enemy stats: use `mk()` with level + multipliers — never raw numbers.
3. Wire drops ≤ sensible probabilities (bosses 0.4–1.0, field 0.1–0.6).
4. Quest rewards should cover ~2–3 shop tiers of gear at that level.
5. Run the content-integrity tests; they catch dangling ids.
6. Safe havens (`safeHaven: true`) never spawn battles: keep their explore tables battle-free (the
   engine also filters them); battles belong in the wilds players travel to.
7. Every zone must be reachable: list it in `STARTING_ZONES` or grant it via a quest/dungeon
   `unlockZone` reward — the zone-reachability test enforces this.
8. `learnLevel: 1` skills are granted at creation; `migratePlayer` (called on every load) migrates
   older saves. DESTRUCTIVE legacy cleanups must be gated by `stateVersion` — bump
   `CURRENT_STATE_VERSION` and add a `< N` step; never sniff "state looks old". Non-destructive
   backfills (starting kit, starting zones) run every load.
9. Kill objectives must be satisfiable: the target enemy needs a wilds spawn (zone explore table) or
   enough dungeon floor slots — `tests/progression_test.ts` enforces encounter capacity, and the
   full m1→m25 simulation walks the entire quest graph through the pure engine.

## Known trade-offs (evaluated fallow findings)

- Internal zone id `'emberfall'` predates the Emberdawn rename (display name is "Emberdawn
  Village"). Do NOT rename the id casually: persisted player state (`currentZone`, `unlockedZones`)
  references it.
- `deno.json` is the dependency manifest; fallow's "unlisted dependencies" (grammy, grammy-testing)
  is a Node-only heuristic — ignore.
- One residual ~12-line clone pair in `render/views.ts` (shop buy vs sell rows). The two rows differ
  in label/action/semantics; a shared abstraction would be more indirect than the duplication.
  Accepted.
- Large dispatch switches (`callbacks.ts`, view renderers) are flat and exhaustive by design;
  complexity lives in data, not control flow.

## Session-start checklist

1. `deno task check && deno task test && deno task lint` — all green?
2. `git status` — clean tree expected; work on branches/commits per change.
3. Never commit `.env`, tokens, or local database files (see `.gitignore`).
4. BOT_TOKEN comes from the environment; never write it into the repo.
