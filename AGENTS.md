# AGENTS.md — Emberdawn

Operating manual for any fresh agentic session working on this repo. Read this before changing
anything.

## What this is

**Emberdawn** — a turn-based RPG about seeking hope for a future, played entirely inside a single
Telegram message per player, built on **Bot API Rich Messages** (buttons live in the message _body_,
never `reply_markup`). Runtime is **Deno** + **grammY**. One game message per player is edited in
place on every action.

## Release lifecycle — authoritative status

Current phase: PRE-LAUNCH

This section is the sole source of truth for whether public save-compatibility obligations are
active. Deployment, playtesting, database contents, tags, and `stateVersion` numbers do NOT imply
launch. Change the phase to LIVE only through an explicit launch decision (see the checklist below).
Every other lifecycle-dependent rule in this document refers back here instead of maintaining its
own status declaration.

- First live commit: not established
- First live stateVersion: not established
- Persisted-content ID baseline: not established

### Active now: pre-launch rules

- Development and playtest saves carry no permanent compatibility promise — they are DISPOSABLE
  (#44, #116; e.g. #46 renamed `emberfall` → `emberdawn` without preserving old saves).
- Content IDs may be added, renamed, or removed whenever the current content model requires it. A
  deleted pre-launch zone, item, quest, skill, enemy, dungeon, or NPC ID requires NO runtime
  recovery, alias, tombstone, or migration for an old development save — those saves may simply be
  refused with the existing explicit `/reset` path.
- Persisted-shape changes advance `stateVersion`; older development saves are refused by
  `assertSupportedSaveVersion()` rather than migrated.
- This does NOT authorize dangling references in current code: every ID emitted by constructors or
  referenced by current content/engine paths must resolve. The current-catalog content-integrity and
  progression tests remain mandatory. What is not frozen is history: no historical-ID baseline or
  additive-only catalog test exists pre-launch, and none may be added — it would recreate the
  strictness this distinction exists to avoid.
- No runtime "guess a replacement" recovery for unknown persisted IDs: do not silently rewrite
  corrupted or ambiguous saves, and do not invent fallback state for a deleted historical ID.

### Deferred/KIV: activate at public release

The rules below are recorded now so they are not forgotten, but they are NOT ACTIVE while the
authoritative phase above is PRE-LAUNCH:

- Once an ID can be persisted by a live release, it is part of the durable save contract. Persisted
  content IDs must remain resolvable and must not be renamed, deleted, or reused casually.
- Persistable IDs include more than `currentZone`: inventory/equipment items, quest keys, learned
  skills, active-battle enemies and effect sources, battle origin zone/dungeon IDs, scene arguments,
  and IDs encoded into durable flags.
- Display names and other non-identity presentation may change freely.
- Retiring content may stop future acquisition while retaining lookup compatibility.
- Any intentional incompatible change requires an explicit versioned save migration (ordered
  `stateVersion` steps, never "state looks old" sniffing) or another deliberate compatibility
  design.
- Live users must never be directed to `/reset` as a substitute for supported compatibility.
- If an unknown ID nevertheless appears once these guarantees are active, it indicates corruption,
  tampering, a broken migration, or a contract-violating release — let it be observable rather than
  silently relocating the player or substituting unrelated content.

### Launch-transition checklist

When public launch is explicitly approved:

1. Change the authoritative phase above from `PRE-LAUNCH` to `LIVE`.
2. Record the first live commit and the `CURRENT_STATE_VERSION` live saves are born with.
3. Capture a baseline manifest of every content-ID family that can appear in a supported save.
4. Add a CI test proving future catalogs remain a superset of that live baseline, unless the same
   change supplies and tests an explicit compatible migration. (Introduce this test at launch, not
   before.)
5. Activate the deferred post-release migration and durable-save rules above.
6. Audit player-facing incompatible-save wording so it no longer describes live saves as disposable.
7. Do not infer or automate this transition merely because a deployment or version tag exists.

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
8. **Flavor vs mechanics (#120).** A skill/item's NAME and FLAVOR (`SkillDef.flavor`,
   `ItemDef.desc`) are creative and may be nonliteral — never a rules source. The player-facing
   mechanical summary is GENERATED from the structured effect specs by `src/engine/mechanics.ts`
   (`mechanicsText`/`mechanicsLines`/`consumableEffectLines`); equipment triggers disclose their
   mechanics the same way (`triggerDisclosure` in `render/menus.ts`). Canonical rules vocabulary:
   **Shield** (the absorbable pool), **DEF/RES**, **round** (duration/tick unit), **action** (one
   actor's opportunity to act), **beneficial/harmful effect** (cleanse/dispel categories). Never
   re-type numbers in authored prose, and never replace the generated summary with a second
   hand-written description. Validation is STRUCTURAL: tests assert the renderer discloses every
   field of an effect spec; they must not lexically scan names or flavor for words like "ward" or
   "stun". Battle narration (`spec.line`, `defaultInstanceLine`) is distinct from the static rules
   summary and may use in-world wording — but generic effect output (shield grants, capacity fades,
   dispels) still uses the canonical terms (#121): the pool is always "Shield" (never "ward"),
   durations are rounds, and removals name beneficial/harmful effects. The balance harness parses
   some of those generic lines (SHIELD_FADE/SHIELD_WASTE regexes in `src/engine/balance.ts`) — keep
   them in sync if the copy changes.
9. **Rich text, not HTML.** Rich message paragraphs take typed entities (`{ type: 'bold', text }`,
   `{ type: 'italic', text }`). HTML tags like `<b>` render literally. Rows of `RichMessageButton`
   go through `src/render/rich.ts` helpers (`buttonsRow`, `cbBtn`, `disabledBtn`).
10. **Dialogue scenes (#124).** Authored conversations live in `src/content/dialogues.ts`
    (`DialogueDef`: stable id, owning NPC, start node, linear nodes with explicit
    npc/player/narrator speakers and `next` links). The scene persists
    `(arg: dialogueId,
   arg2: nodeId)` so rerenders and `/start` reproduce the exact current beat.
    Continue (`dlg:nx:<targetNodeId>`) advances EXACTLY ONE node and edits the same live message —
    never a second message; every tap revalidates scene view, dialogue identity, the current node's
    next link, and the NPC's physical presence. Back/End returns to the owning NPC's topic menu when
    they are still on-site. Reopening a dialogue always restarts it from the start node (linear
    conversations carry no partial state); the final line omits `next` and is the implicit end
    state. Content integrity (tests/dialogue_test.ts) covers id uniqueness, references,
    reachability, terminals, topic wiring, and the callback budget.

## Commands

```bash
deno task check   # typecheck everything (must pass before commit)
deno task test    # engine + bot integration tests (must pass)
deno task test:pg # Postgres round-trip (real DB; skipped unless TEST_PG_URL set)
deno task test:pg:local # test:pg against a throwaway Docker Postgres (provisions + cleans up)
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
  the Sundered King is despair hoarding tomorrow, and each chapter recovers a piece of the dawn. 28
  main quests across 6 chapters + postgame Abyss. Chapter flags: `chapter1Done`…`chapter6Done`;
  game-clear moment = defeating King Aldric (flag set via dungeon first-clear `crownRestored`). Keep
  new writing in this register: setbacks are real but framed as "not yet", never "never".
- **Quest state machine:** unavailable → available → active → turnIn → done. `syncAvailability` is
  idempotent; call it after xp gains, zone entry and turn-ins. Kill/reach/talk/dungeon objectives
  tick via engine hooks (`onKill`, `onZoneEnter`, `onTalk`, `onDungeonClear`); collect objectives
  read the bag live. Every hook RETURNS the quests its event just made turn-in-ready, and
  `refreshProgress()` is the single active→turnIn transition authority (#119): readiness is
  announced exactly once, by the surface that caused it — `resolveVictory` collects ready ids from
  drops, the kill, the availability refresh, dungeon bookkeeping and first-clear rewards and appends
  one deduped `questReadyLine` (`📜 "<name>" is ready to turn in!`, the ONE shared formatter) per
  quest after all of the victory's mutations; `travel()` puts it in the arrival lines; the talk
  interaction and `acceptQuest` (whose result carries `lines`, so an immediately-complete quest
  reports acceptance AND readiness) put it in the interaction notices. It is never re-derived at
  render time and never re-announced for an already-`turnIn` quest. Random quest-item drops are
  relevance-capped (`questDropAllowed`): they flow only while an open (available/active) quest still
  needs them, and stop permanently once it's done. Every quest carries explicit lifecycle contacts
  (#63): `startNpc` offers it and `finishNpc` accepts the turn-in — usually the same NPC, but
  delivery flows hand them to different people (m2_letter: Maren starts, Bram finishes; the finisher
  is NEVER inferred from a talk objective). Talking to an NPC surfaces quests they are ready to
  finish first, then quests they offer (talk discovery, #31). Both contacts must resolve to real
  NPCs placed in exactly one zone — resolve them via the canonical helpers in content/quests.ts
  (`questStarter`/`questFinisher`/`zoneOfNpc`/`npcInZone`; content-integrity tested). There is no
  quest-log-only fallback: m23_aldric starts and ends with the Archivist's throne-room send-off, and
  sq_locket belongs to Ranger Pell in the Whisperwood. Destination quests (#66) START in the
  preceding region and FINISH with the destination contact — m5 Bram→Ferryman, m9 Ferryman→Ombra,
  m13 Ombra→Rho, m16 Rho→Sorrel, m20 Sorrel→Archivist, m24 Archivist→Echo — so the journey stays the
  point instead of an arrive-then-accept loop; intro/outro speak as the contact who hands the quest
  over or receives it. A quest accepted AT the NPC its talk objective names counts the acceptance
  conversation as the talk (m8/m17/m22) — dialogue quests never demand a second identical
  interaction. Contact zones must be reachable at the quest's point in the progression
  (content-integrity tested).
- **Quest actions are physical (#64):** `acceptQuest`/`turnInQuest` take the acting NPC id and
  REQUIRE it to be the quest's configured starter/finisher AND standing in the player's current zone
  (`contactRefusal` inside the engine — quest status alone never authorizes, and no handler path can
  bypass it). Talking to an NPC opens the #123 TOPIC MENU — pure navigation that performs NO story
  mutation (never `onTalk`, never accept/turn-in); every valid topic (ready turn-ins, offers, active
  business, authored lore) is enumerated by the pure resolver `src/engine/npc.ts` and revalidated at
  tap time. Selecting an active quest's topic is the legacy conversation beat that ticks its talk
  objective (until #127 replaces it with authored dialogue events). The ONLY quest mutation surface
  remains the `npcq` interaction view, opened from a topic; its handler revalidates the live scene
  context (quest + npc match), and the engine revalidates contact + location. The Quest Log is a
  READ-ONLY journal (#65): it renders NO lifecycle buttons, the codec cannot even express
  `q:a:`/`q:t:`, and it only NAMES the physical contact ("Start with X — Zone." / "Return to Y —
  Zone.") — log navigation can never act on a quest. Backing out or traveling leaves the interaction
  (scene resets, uiRev bumps), and the revision guard kills replays and duplicate rewards.
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
  Which schema versions are supported depends on the authoritative release phase (see _Release
  lifecycle — authoritative status_ above). While PRE-LAUNCH (#44, #116): the load-time
  `assertSupportedSaveVersion()` gate is NON-MUTATING — unversioned or older saves throw
  `SaveTooOldError` (refused with a pointer to /reset — never sniffed, rewritten, repaired or
  stamped current; the stored JSON stays untouched); saves from NEWER binaries
  (`stateVersion > CURRENT_STATE_VERSION`) throw `SaveTooNewError` and handlers refuse to
  read-mutate-write rather than downgrade. There is no v3–v7 transformation path — the old migration
  ladder was retired pre-launch (#116). Required battle fields (`phoenixUsed`, `effectInstances`,
  `effectSeq`, `shield`, `history`) are initialized by `startBattle()`. Schema lifecycle policy:
  - **Before launch (active now):** after a persisted-shape change, advance the version as needed,
    update constructors/types to emit the new authoritative shape, and RETIRE older dev formats
    rather than accumulating migrations — playtesters /reset.
  - **At launch:** record the first live schema baseline (the version live saves are born with) in
    the lifecycle section above.
  - **After launch (deferred):** real saves are durable — add explicit ordered migrations from every
    supported live version (`stateVersion` steps, never "state looks old" sniffing); never tell live
    players to reset as a substitute for compatibility.
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
- **Guided prologue (#69):** fresh heroes run a directed prologue before the real hub opens: Elder
  Maren's ember brief → ONE controlled battle vs `e_cinder_mite` (a `tutorial`-flagged level-1
  fixture; the balance harness proves NO class can lose it) with contextual coaching inside the live
  battle (free action → starting skill/MP → Guard → Items when hurt) → a deterministic ember reward
  that exits every hero at level 2 → release into the real hub (Maren's board = m1, Whisperwood,
  flee/level advice). State is `p.tutorial` (`'maren'→'outskirts'→'fight'→'done'`): /start resumes
  the current step, tutorial handlers revalidate the step so replays are refused, the uiRev guard
  kills double-taps, and the reward is flag-idempotent. During the prologue the zone view renders
  ONLY the directed action (progressive disclosure — travel/explore/shop/NPC list withheld).
- **Encounter eligibility (#73):** battle/elite explore events carry authored `minPlayerLevel` /
  `maxPlayerLevel`; explore() filters them before weighting, so low-level protection lives in
  CONTENT (authorable, testable), not ad-hoc engine checks. Ordinary enemies have no ceiling —
  returning to earlier areas must keep working end-game. Whisperwood hostiles start at 3 and its
  elite (e_stag) at 5; the Emberdawn Outskirts (Lv 1–3) are the repeatable low-level wilds, and
  Emberdawn Village stays a battle-free safe haven.
- **Chapter-one curve (#73):** the bridge to Aranya is authored, not an unexplained grind: m1_embers
  (4× Lv-1 ember-rats in the Outskirts) → m2_letter (delivery) → m3_wolves (3× Lv-4 wolves,
  Whisperwood) → m4_floors (silk-broods, Lv 5) → m5_arms (the tier-2 preparation beat: iron chunks +
  coin; the village band runs [1,7] so Bram's rack stocks tier 2) → m3_roots (Aranya, level 7) →
  m4_blessing (shards, level 8, unlocks Hollowmere). Every dungeon authors `recommendedLevel`; the
  zone view surfaces it, and diving into the BOSS floor under it demands an explicit confirmation
  (`z:dgb`) — bosses cannot be fled, so entry must be informed.
- **Skill cadence (#71):** each class demonstrates its identity by level 2 — the Cleric heals from
  level 1 (Mend Wounds), not level 4. Ladders stay distinct rather than uniform: warrior's second
  damage tier is 13 (Whirlwind) with Iron Wall moved to 16; cleric's offensive upgrade is 11
  (Radiant Burst) with Holy Ward at 16, and Judgment strikes for 290% MAG so late-game cleric damage
  isn't stranded. The class picker states the starting kit, tradeoff, and complexity, and marks
  Warrior as the forgiving beginner pick. Skill descriptions are machine-checked against their
  authored coefficients in the test suite.
- **SPD avoidance (#72):** SPD's in-fight payoff is capped avoidance — enemy DAMAGING moves can be
  slipped entirely: `dodgeChance = clamp(0.02 + (spd − enemySpd) × 0.002, 0.02, 0.20)`. Self-heals,
  enemy guard stances, and zero-power status moves are NEVER dodged (the roll lives only in the
  damaging branch of enemyAct; test-enforced). Dodges are a visible 💨 round line. Smoke Step (+45%
  SPD) is a stay-and-fight defensive tool; Flee still uses SPD separately.
- **SPD duration = initiative snapshots (#94):** initiative is snapshotted from effective SPD before
  either actor's slot (#86), and an advertised N-turn SPD effect covers exactly N eligible
  snapshots: a mid-round SPD application (any slot after the snapshot) defers its first decay — the
  cast round spent no unit on a snapshot that already decided — while OPENING SPD applications
  (enemy openings like the Chrono Anchor, pre-emptive skills) precede round 1's snapshot and count
  it (`timing: immediate`, rounds 1..N). Dodge and Flee simply follow liveness while the instance is
  up, so a faster caster still gets same-round value on top of its N snapshots. Refresh re-banks the
  full count from the recast round.
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

## The ordered-completion gameplay boundary (#102, corrected by #114)

Telegram/network/database code is asynchronous I/O around a deterministic game core. The
architectural invariant is **ordered completion** — one deterministic, explicitly ordered resolution
flow that is COMPLETE before rendering/persistence proceeds — not a lexical ban on async vocabulary.
It is regression-pinned by `tests/architecture_test.ts` (sync API signature contracts,
no-pending-work-at-return, observable ordering, a compiler dependency-graph import check). Do not
reinterpret "event", "reactive", "hook", "trace" or "emit" as a request for event-driven mechanics.

Three concepts stay separate (#114):

1. **Ordered resolution (required).** One authoritative coordinator owns combat phases and nested
   sub-resolution; SPD determines the first actor; each action/effect fully resolves before the next
   begins; terminal state is checked immediately after every potentially lethal transition; when HP
   reaches 0 and no immediate revival succeeds, no later action, rider, reaction, or end-of-round
   effect runs; regeneration never revives a terminal combatant and DoT never creates a post-victory
   mutual KO.
2. **Async syntax (neutral).** A Promise-returning function whose every step is awaited is still a
   single ordered flow — async syntax is neither proof of order nor proof of disorder. Never scan
   source for `async`/`await`/`Promise` tokens as an architecture test, and never hand-roll a
   TypeScript lexer to do it. Today's engine entry points are synchronous and stay that way (the
   test-suite signature pins are a compile-time contract for the CURRENT API shape, not proof
   against event-driven design); converting them is out of scope.
3. **Event-driven orchestration (unwanted for combat).** No listener-registration order, event bus,
   timer, microtask queue, or detached/background callback drives combat resolution; no unawaited
   state-mutating work; no `Promise.all` over mutations of the same fight. Traces stay caller-owned
   plain data returned by the active resolution, never asynchronously published events.

- **Async I/O sandwich.** Async code belongs ONLY at the boundary: receiving Telegram updates and
  grammY middleware; serializing concurrent updates for the same user; Postgres/network I/O;
  sending/editing Telegram messages; webhook lifecycle and scripts. The boundary LOADS state,
  invokes the engine's ordered resolution, RENDERS/PERSISTS the completed result, and returns. It
  never interleaves with resolution.
- **Import boundary.** Gameplay modules (`src/engine`, `src/content`) depend only on local gameplay
  code — never grammy, node:/npm:/jsr: packages, handlers, or persistence. This is enforced via the
  Deno compiler's own dependency graph (`deno info --json`) in `tests/architecture_test.ts` — never
  by regex over arbitrary source text.
- **Terminology (all direct and ordered — none of these authorize a bus):**
  - "reactive trigger" (equipment) = an immediate nested synchronous call (`runReactiveTriggers`);
  - "quest hook" (`onKill`/`onTalk`/`onZoneEnter`) = an ordinary directly invoked function;
  - "exploration event" = a data VARIANT selected from content and resolved by a switch;
  - "combat trace" (#101) = plain record entries appended by and returned from the active
    synchronous resolution (`recordCombatEvent` — state changes first, then a plain-data push); no
    listener registration, no dispatch, no async delivery exists anywhere in the engine. Applied-HP
    contract (#106): `hpDamaged` carries `resolved` (post-mitigation, post-shield, pre-floor —
    overkill included) and `hpLost` (the actual capped HP delta every damage family reports);
    `hpRestored`/`revived` carry `attempted` + `applied`. HP-moved metrics (balance dealt/taken) sum
    `hpLost`, never `resolved`; lifesteal telemetry and battle text report the applied heal.

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
8. `learnLevel: 1` skills are granted at creation; `assertSupportedSaveVersion` (called on every
   load) gates the save schema — it is non-mutating. Which versions are accepted follows the
   authoritative release phase (see _Release lifecycle — authoritative status_). While PRE-LAUNCH:
   only the current version is accepted; after a persisted-shape change, bump
   `CURRENT_STATE_VERSION`, update constructors/types to emit the new authoritative shape, and
   retire older dev formats rather than adding migrations — pre-launch saves are DISPOSABLE (#44,
   #116), they fail with `SaveTooOldError` and require /reset. Content-ID rename/removal is equally
   free pre-launch (no aliases, tombstones, or recovery shims). At launch, record the first live
   schema baseline in the lifecycle section. After launch, real saves are durable: bump
   `CURRENT_STATE_VERSION` and add an explicit ordered migration from every supported live version;
   never sniff "state looks old", and never tell live players to reset as a substitute for
   compatibility.
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
