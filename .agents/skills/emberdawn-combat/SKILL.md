---
name: emberdawn-combat
description: Use when changing Emberdawn combat order, initiative, effects, durations, death and revival, combat telemetry, encounters, dungeons, or balance.
---

# Emberdawn combat

Detailed rules for the turn engine, effects, encounters, and dungeons. The ordered-completion
invariant lives in the root `AGENTS.md` and `emberdawn-architecture`; this skill carries the combat
semantics.

Authoritative code and tests: `src/engine/combat.ts`, `src/engine/world.ts`,
`src/engine/character.ts`, `src/engine/balance.ts`, `src/content/enemies.ts`,
`tests/architecture_test.ts`, `tests/applied_hp_test.ts`, `tests/roundflow_test.ts`,
`tests/balance_test.ts`, `scripts/balance.ts`.

## Progression and enemy stats

- 45 levels. The XP curve is deliberately grindy; `xpForNextLevel()` in `src/engine/classes.ts` is
  the authority (it floors the curve and returns infinity at the level cap).
- Enemy stats derive from level in `mk()` (`src/content/enemies.ts`). Bosses multiply HP/xp/gold and
  have scripted specials.

## Resolution order and telemetry

- One authoritative coordinator owns combat phases and nested sub-resolution; SPD determines the
  first actor; each action and effect fully resolves before the next begins; terminal state is
  checked immediately after every potentially lethal transition. When HP reaches 0 and no immediate
  revival succeeds, no later action, rider, reaction, or end-of-round effect runs; regeneration
  never revives a terminal combatant, and DoT never creates a post-victory mutual KO.
- Combat trace entries are plain records appended by and returned from the active synchronous
  resolution (`recordCombatEvent`): state changes first, then a plain-data push.
- Applied-HP contract: `hpDamaged` carries `resolved` (post-mitigation, post-shield, pre-floor —
  overkill included) and `hpLost` (the actual capped HP delta every damage family reports);
  `hpRestored`/`revived` carry `attempted` + `applied`. HP-moved metrics (balance dealt/taken) sum
  `hpLost`, never `resolved`; lifesteal telemetry and battle text report the applied heal.

## Initiative and durations

- Initiative is snapshotted from effective SPD before either actor's slot. An advertised N-turn SPD
  effect covers exactly N eligible snapshots: a mid-round SPD application (any slot after the
  snapshot) defers its first decay — the cast round spent no unit on a snapshot that already decided
  — while opening SPD applications (enemy openings like the Chrono Anchor, pre-emptive skills)
  precede round 1's snapshot and count it (`timing: immediate`, rounds 1..N). Dodge and Flee simply
  follow liveness while the instance is up, so a faster caster still gets same-round value on top of
  its N snapshots. Refresh re-banks the full count from the recast round.
- ATK/MAG self-buffs currently author `timing: 'defer'`; DEF/RES self-buffs author
  `timing: 'immediate'`. These determine whether the application round consumes duration, not a
  guaranteed number of attacks or mitigated hits: the enemy may already have acted, and later slots
  may be spent healing or lost to stun. SPD follows the snapshot rule above.

## SPD avoidance

SPD's in-fight payoff is capped avoidance — enemy damaging moves can be slipped entirely:
`dodgeChance = clamp(0.02 + (spd − enemySpd) × 0.002, 0.02, 0.20)`. Self-heals, enemy guard stances,
and pure status moves are never dodged. `executeSpecs` rolls once before resolving an enemy move
containing positive-power damage targeting the player; a dodge skips the whole move, including its
riders (test-enforced). Dodges are a visible 💨 round line. Smoke Step (+45% SPD) is a
stay-and-fight defensive tool; Flee still uses SPD separately.

## Enemy moves

- Boss specials: `special.every = N` makes a special due on every Nth enemy action slot (3, 6, 9…
  for `every: 3`). Stunned slots advance the counter but choose no move. A due special rejected as
  wasted falls back to ordinary move selection and is reconsidered at the next cadence window.
- Enemy moves author ordered `EffectSpec[]`. Guard stances use a `statmod` with
  `stat: 'mitigation'`, `duration`, and `timing: 'defer'`; the cast round does not consume duration.
- Pure status moves (Howl) omit damage specs. They apply their authored effects without implicit
  chip damage or dodge rolls.

## Death and revival

- Death: −10% gold, revive FULLY restored at the LAST safe haven the hero actually reached
  (`player.respawnHaven`, never where you fell, never merely the catalog's first haven). The full
  revive is deliberate (#212): the haven's arrival authority full-heals anyway, so a partial revive
  is bypassed by one free walk out and back — the real penalties are the gold loss, the lost
  position, and the abandoned dungeon run. The pointer moves ONLY through the one arrival authority
  (`arriveAt` in `src/engine/world.ts`) when a crossing finally reaches a safe-haven zone — a
  journey that has merely begun or a crossing still mid-road never relocates it. A corrupt pointer
  refuses the load (identity gate). `applyDeath()` currently contains an `emberdawn` fallback for an
  invalid in-memory pointer; that existing fallback must not be used to recover or legitimize a
  refused save. Unknown or corrupt persisted haven identities require /reset. Retreat from a
  crossing returns to the edge ORIGIN, not the haven.
- Phoenix Cinder auto-revives once per battle (`phoenixUsed`), only from the auto trigger — never by
  hand.

## Encounters, bosses, and dungeons

- Battles carry structured provenance (`BattleOrigin`): `explore`, `elite`, `dungeon`, or `travel`.
  Dungeon origins carry the dungeon id, floor, and boss flag. Travel origins identify the edge and
  pending event; their `zoneId` is the crossing's origin zone, which determines contextual loot.
- Boss semantics (no flee, Smoke Bomb refused, `bossesSlain`) come from the encounter — only a
  dungeon boss floor (`origin.boss`) is boss-classified. The Abyss overworld Warden is a farmable
  elite: fleeable, smokeable, not counted.
- Dungeon battle floors advance on victory; discovery floors advance through their explicit
  continuation. Boss floors are story-gated via `bossGate` (kill-quest bosses use
  `requireDone: false`). Victory bookkeeping routes through `resolveVictory()` in
  `src/engine/world.ts` — overworld kills never touch dungeon state.
- Dungeons are consecutive runs from floor 1 through the boss. Leaving, fleeing, or defeat abandons
  temporary floor progress; re-entry starts over. No hub facilities or rest are available inside a
  run. Discovery rooms never restore HP/MP. Collected floor caches and first-clear rewards remain
  consumed across retries, while ordinary earned loot and quest progress remain earned. See
  `docs/dungeon-runs.md` and `emberdawn-design-decisions`.
- Encounter eligibility: battle/elite explore events carry authored `minPlayerLevel` /
  `maxPlayerLevel`; `explore()` filters them before weighting, so low-level protection lives in
  content (authorable, testable), not ad-hoc engine checks. Ordinary enemies have no ceiling —
  returning to earlier areas must keep working end-game. Whisperwood hostiles start at level 3 and
  its elite (e_stag) at 5; the Emberdawn Outskirts (Lv 1–3) are the repeatable low-level wilds, and
  Emberdawn Village stays a battle-free safe haven.
- Every dungeon authors `recommendedLevel`; the dedicated entry panel surfaces it. Every run
  requires explicit entry confirmation (`z:dgb`), with an additional warning below the recommended
  level. Bosses cannot be fled, so entry must disclose that commitment before the run starts.

## Balance harness

`scripts/balance.ts` (run via `deno task balance`) simulates seeded fights per class against the
content catalog and snapshots results in `tests/balance_snapshot.json` (`deno task balance:update`
refreshes it). Shield grants/waste and equipment procs come from structured trace entries (#176):
`shieldGranted` sums applied + wasted grant capacity on both sides; `equipProcs` counts successful
reactive triggers, including during openings, while `procHits` also includes battle-start
activations. The trace's `triggerKind` distinguishes the authored trigger from its display name. One
remaining line scanner measures crit/dodge markers, Shield absorption and expiry/loss — keep those
markers and the SHIELD_ABSORB/SHIELD_FADE regexes in sync if their generic effect copy changes.

Campaign orchestration stays in `driveQuests` in `src/engine/balance.ts`. Read-only shop planning
lives in `src/engine/campaign_policy.ts`; equal-distance counters retain catalog order. Planning
never buys or travels. `src/engine/campaign_metrics.ts` owns the travel accumulator and its derived
means; arrival HP/MP samples precede the haven heal, and accounting never feeds gameplay decisions.
Refactors must preserve RNG order, the actual retry bounds, and seeded campaign reports (including
stalls), without refreshing balance snapshots to conceal changes.
