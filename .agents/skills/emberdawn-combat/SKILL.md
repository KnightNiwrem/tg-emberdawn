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
- A fresh battle buff defers its first decay when the cast round cannot use it: ATK/MAG (future
  damage) and SPD (future Flee rolls only) deliver exactly their advertised turns of useful actions;
  DEF/RES still tick on the cast round because they mitigate that round's enemy response.

## SPD avoidance

SPD's in-fight payoff is capped avoidance — enemy damaging moves can be slipped entirely:
`dodgeChance = clamp(0.02 + (spd − enemySpd) × 0.002, 0.02, 0.20)`. Self-heals, enemy guard stances,
and zero-power status moves are never dodged (the roll lives only in the damaging branch of
`enemyAct`; test-enforced). Dodges are a visible 💨 round line. Smoke Step (+45% SPD) is a
stay-and-fight defensive tool; Flee still uses SPD separately.

## Enemy moves

- Boss specials: `special.every = N` fires the special on the Nth actual enemy action (3, 6, 9… for
  `every: 3`). Stunned turns advance the counter — time passes — but choose no move, so a stun never
  fires a special.
- Defensive moves: `guardPct`/`guardTurns` on an `EnemyMove` raise the enemy's own mitigation for
  the next `guardTurns` rounds (the cast round does not consume one).
- Power-0 status moves (Howl) deal no implicit chip damage — they carry only their rider effect.

## Death and revival

- Death: −10% gold, revive at 50% HP at the first safe haven (never where you fell).
- Phoenix Cinder auto-revives once per battle (`phoenixUsed`), only from the auto trigger — never by
  hand.

## Encounters, bosses, and dungeons

- Battles carry structured provenance (`BattleOrigin`): `explore`/`elite`/`dungeon` with floor and
  boss flags.
- Boss semantics (no flee, Smoke Bomb refused, `bossesSlain`) come from the encounter — only a
  dungeon boss floor (`origin.boss`) is boss-classified. The Abyss overworld Warden is a farmable
  elite: fleeable, smokeable, not counted.
- Dungeon floors advance on victory only; boss floors are story-gated via `bossGate` (kill-quest
  bosses use `requireDone: false`). Victory bookkeeping routes through `resolveVictory()` in
  `src/engine/world.ts` — overworld kills never touch dungeon state.
- Dungeon floors are independent dives: leaving to heal at a safe haven between floors is intended
  play, not an exploit. Tune encounters assuming the player can realistically arrive at full HP. See
  `emberdawn-design-decisions` for the attrition non-goal.
- Encounter eligibility: battle/elite explore events carry authored `minPlayerLevel` /
  `maxPlayerLevel`; `explore()` filters them before weighting, so low-level protection lives in
  content (authorable, testable), not ad-hoc engine checks. Ordinary enemies have no ceiling —
  returning to earlier areas must keep working end-game. Whisperwood hostiles start at level 3 and
  its elite (e_stag) at 5; the Emberdawn Outskirts (Lv 1–3) are the repeatable low-level wilds, and
  Emberdawn Village stays a battle-free safe haven.
- Every dungeon authors `recommendedLevel`; the zone view surfaces it, and diving into the boss
  floor under it demands an explicit confirmation (`z:dgb`) — bosses cannot be fled, so entry must
  be informed.

## Balance harness

`scripts/balance.ts` (run via `deno task balance`) simulates seeded fights per class against the
content catalog and snapshots results in `tests/balance_snapshot.json` (`deno task balance:update`
refreshes it). It parses some generic battle-text lines (the SHIELD_FADE and SHIELD_WASTE regexes in
`src/engine/balance.ts`) — keep those regexes in sync if the generic effect copy changes.
