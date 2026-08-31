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
   (`isLiveMessage`, via `tapIsCurrent`). Newer-than-tracked ids are adopted — together with the
   render revision that copy was stamped with. Do not weaken this into "always process" — stale taps
   corrupt pacing. Additionally, every committed render stamps its buttons with the player's `uiRev`
   (`commit()`, cycled 1..9999, embedded as `<view>:<rev>:<action>` in callback data) and the router
   rejects revision mismatches BEFORE any mutation (#16): replays and double-taps on the same live
   message are no-ops. Every gameplay callback MUST carry its stamped revision (#43) — rev-less
   callbacks are rejected as stale. The ONLY exception is the class picker (`m:pk:<class>`), which
   renders before a player exists and bypasses the staleness guard.
4. **Persistence shape.** `PlayerState` (`src/engine/types.ts`) is plain JSON — no class instances,
   no Maps, no functions. Anything you add must survive `JSON.stringify`. Runtime-only state (e.g.
   battle buffs) lives on `BattleState`, not the player.
5. **Cross-instance consistency (#18).** Every update runs inside `PlayerStore.withLock(user)`: the
   bot's per-user promise chain serializes within a process, and `PgStore.withLock` holds a Postgres
   TRANSACTION-scoped advisory lock on a dedicated connection around the WHOLE load→mutate→save —
   which runs entirely on that same connection (#37): two bot instances can never interleave
   read-modify-write for one player (no lost writes), concurrent distinct-user updates can never
   starve the connection pool, and a failed section rolls back atomically (the lock releases with
   the transaction — no explicit unlock to leak). `MemoryStore.withLock` is a passthrough (single
   process). Never mutate player state outside the lock; never hold the lock across user input.
6. **callback_data budget.** 64 bytes max, built/parsed only via `src/codec.ts`
   (`encodeCb`/`decodeCb`). Add new controls there, never inline raw strings in renderers/handlers.
7. **Content refers only to real ids.** Quests/zones/enemies/drops reference ids defined in other
   content modules. The integrity tests in `tests/engine_test.ts` ("content integrity: …") enforce
   this — keep them green when adding content.
8. **Rich text, not HTML.** Rich message paragraphs take typed entities (`{ type: 'bold', text }`,
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
  engine hooks (`onKill`, `onZoneEnter`, `onTalk`); collect objectives read the bag live. Random
  quest-item drops are relevance-capped (`questDropAllowed`): they flow only while an open
  (available/active) quest still needs them, and stop permanently once it's done. Every quest
  carries explicit lifecycle contacts (#63): `startNpc` offers it and `finishNpc` accepts the
  turn-in — usually the same NPC, but delivery flows hand them to different people (m2_letter: Maren
  starts, Bram finishes; the finisher is NEVER inferred from a talk objective). Talking to an NPC
  surfaces quests they are ready to finish first, then quests they offer (talk discovery, #31). Both
  contacts must resolve to real NPCs placed in exactly one zone — resolve them via the canonical
  helpers in content/quests.ts (`questStarter`/`questFinisher`/`zoneOfNpc`/`npcInZone`;
  content-integrity tested). There is no quest-log-only fallback: m23_aldric starts and ends with
  the Archivist's throne-room send-off, and sq_locket belongs to Ranger Pell in the Whisperwood.
- **Economy:** sell = 40% of price. Shop tier follows the PLAYER level clamped to the zone's band
  (`shopTierFor`) — that governs consumables/materials, which are always usable, so it's pure zone
  flavor. EQUIPMENT is filtered per shopper: only their class, only pieces they can actually equip
  (`def.level ≤ player level`) — the old clamp-up baited low-level travelers with level-locked gear
  (#22). The counter revalidates `isEquippable` before charging (defense in depth). Trinkets stock
  only what the player can currently equip (`item.level ≤ player level`, #6). Forge tempers up to +5
  are ITEM-PATTERN MASTERY (`forge_i_<itemId>` flags, #24 — documented design choice: every copy of
  that catalog id carries the temper, replacement loot inherits your forge-work, and the forge is a
  bounded per-pattern sink) and boost only that item's own base stats; the temper material is chosen
  by the item's tier, not the player's location.
- **Save schema:** `stateVersion` is REQUIRED — fresh players are stamped `CURRENT_STATE_VERSION`.
  Only the current development schema is supported (#44): unversioned or older saves throw
  `SaveTooOldError` (refused with a pointer to /reset — never sniffed, rewritten or stamped
  current); saves from NEWER binaries (`stateVersion > CURRENT_STATE_VERSION`) throw
  `SaveTooNewError` and handlers refuse to read-mutate-write rather than downgrade. The
  `migratePlayer()` entrypoint and its load-time call sites are retained so post-launch migrations
  can be added as explicit `stateVersion` steps. Required battle fields (`phoenixUsed`,
  `enemyGuardPct`, `enemyGuardTurns`) are initialized by `startBattle()`.
- **Endgame economy:** postgame XP converts to gold (`ceil(xp / 8)`) instead of vanishing;
  safe-haven forage recharges on a 6h real-time cooldown (`forageResetAt`, stamped the moment the
  last charge is spent; `explore()` takes an injected `now` for deterministic tests) — free travel
  never refreshes it; the Vault boss floor consumes the Sunspire Key on the first VICTORIOUS entry
  (its SOLE source is the m11_toll reward — the enemy key-drop entries were unreachable dead code
  and are retired, #20); boss first-clears award boss trinkets `t_12`–`t_18` (never stocked;
  `unique` — unsellable and un-droppable: earned trophies, #5).
- **Death:** −10% gold, revive at 50% HP at the first safe haven (never where you fell). Phoenix
  Cinder auto-revives ONCE per battle (`phoenixUsed`), only from the auto trigger — never by hand.
- **Boss specials (#26):** `special.every = N` fires the special on the Nth ACTUAL enemy action (3,
  6, 9… for every:3). Stunned turns advance the counter — time passes — but choose no move, so a
  stun never fires a special.
- **Enemy defensive moves (#25):** `guardPct`/`guardTurns` on an EnemyMove raise the enemy's own
  mitigation for the next `guardTurns` rounds (the cast round doesn't consume one). Power-0 status
  moves (Howl) deal NO implicit chip damage — they carry only their rider effect.
- **Buff cast-round semantics (#27/#38):** a fresh battle buff defers its first decay when the cast
  round cannot use it — ATK/MAG (future damage) and SPD (future Flee rolls only) deliver exactly
  their advertised turns of useful actions; DEF/RES still tick on the cast round because they
  mitigate that round's enemy response.
- **Reset (#19, #62):** `/reset` and the character menu's 🗑️ Delete hero only STAGE an explicit
  Yes/No confirmation (`reset` view). The confirmed `resetYes` DELETES the save (`store.delete`) and
  delivers the STATELESS class picker in place (resend fallback) — delivery is attempted FIRST, so a
  failed delivery leaves the old save intact; nothing is persisted again until a class is picked
  through the normal no-player path (`pickClass`, `syncAvailability` included). No/✋ resumes the
  live scene (a pending fight stays a fight). A redelivered confirmation after deletion is a
  harmless no-op; once a new hero exists, the staleness guard rejects old reset callbacks.
- **Webhook auth (#29):** webhook mode FAILS CLOSED without `WEBHOOK_SECRET`; the
  `X-Telegram-Bot-Api-Secret-Token` header is verified constant-time in `src/webhook-server.ts`
  BEFORE grammY parses the update. Polling mode needs no secret. Rotate: new secret → update app env
  → `deno task webhook set <url>` with the same value → restart.
- **Dungeon design (#13):** floors are INDEPENDENT dives — leaving to heal at a safe haven between
  floors is intended play, not an exploit. Attrition mechanics (run-reset on leaving, travel locks,
  between-floor heal limits) are a deliberate non-goal; if future tuning wants endurance runs, make
  that an explicit design change — and tune encounters assuming the player can realistically arrive
  at full HP.
- **Battles carry structured provenance** (`BattleOrigin`): `explore`/`elite`/`dungeon` with floor +
  boss flags. Dungeon floors advance on VICTORY only; boss floors are story-gated via `bossGate`
  (kill-quest bosses use `requireDone: false`). Victory bookkeeping routes through
  `resolveVictory()` in world.ts — overworld kills never touch dungeon state.
- **Encounter classification (#28):** boss semantics (no flee, Smoke Bomb refused, `bossesSlain`)
  come from the ENCOUNTER — only a dungeon boss floor (`origin.boss`) is boss-classified. The Abyss
  overworld Warden is a farmable ELITE: fleeable, smokeable, not counted.

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
8. `learnLevel: 1` skills are granted at creation; `migratePlayer` (called on every load) gates the
   save schema. Pre-launch saves older than the current schema are DISPOSABLE — they fail with
   `SaveTooOldError` and require /reset (#44). Once the game has live saves: bump
   `CURRENT_STATE_VERSION` and add an explicit `< N` migration step; never sniff "state looks old".
9. Kill objectives must be satisfiable: the target enemy needs a wilds spawn (zone explore table) or
   enough dungeon floor slots — `tests/progression_test.ts` enforces encounter capacity, and the
   full m1→m25 simulation walks the entire quest graph through the pure engine.

## Known trade-offs (evaluated fallow findings)

- `deno.json` is the dependency manifest; fallow's "unlisted dependencies" (grammy, grammy-testing)
  is a Node-only heuristic — ignore.
- Boss first-clear trinkets (`t_12`–`t_18`) are EARNED TROPHIES, deliberately protected: they cannot
  be sold or dropped (#5, one-time rewards), though `unique` here means "unrecoverable if lost" —
  not a full collectible model.
- Dungeon attrition is OPTIONAL by design: dungeon progress persists, travel is free and safe havens
  fully heal, so clearing-floor-then-healing is legal play. Do not balance dungeon difficulty around
  resource attrition unless a run-enforcement mechanic is added.
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
