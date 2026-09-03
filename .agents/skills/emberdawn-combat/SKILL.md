---
name: emberdawn-combat
description: Use when changing Emberdawn combat order, initiative, effects, durations, death/revival, telemetry, encounters, or balance.
---

# Combat & Mechanics — Emberdawn

Operating guide for turn ordering, initiative, effect timing, encounter semantics, telemetry, and
canonical rules vocabulary.

## 1. Ordered Resolution in Combat

Combat execution is strictly deterministic and ordered:

- A single authoritative coordinator (`performAction` in `src/engine/combat.ts`) coordinates turn
  phases.
- SPD determines the first actor; initiative is snapshotted from effective SPD before either
  combatant acts.
- Each action, skill, item, and reactive effect resolves completely before the next begins.
- Terminal checks execute immediately following every potentially lethal state transition.
- When an actor's HP reaches 0 and no immediate revival trigger succeeds (e.g. Phoenix Cinder),
  resolution halts immediately: no subsequent attacks, effect riders, reactions, or end-of-round
  ticks execute.
- Regeneration never revives a defeated actor.
- Damage over time (DoT) cannot trigger a post-victory mutual knockout.

## 2. Initiative & SPD Semantics

### Initiative Snapshots

Initiative is snapshotted from effective SPD before either actor acts in a round:

- **SPD duration = initiative snapshots:** An effect granting SPD for N rounds covers exactly N
  eligible initiative snapshots.
- A mid-round SPD buff (applied after initiative was already decided) defers its first decay so it
  delivers N future decision rounds.
- Opening SPD applications (e.g. pre-emptive abilities or enemy encounter openers) precede round 1's
  snapshot and consume their first tick on round 1.
- Recasting an SPD buff refreshes the count to full duration from the round of recasting.
- Flee checks and Dodge calculations use live effective SPD while the buff remains active.

### Avoidance (Dodge)

Higher SPD grants a chance to slip damaging enemy attacks:

```text
dodgeChance = clamp(0.02 + (spd - enemySpd) * 0.002, 0.02, 0.20)
```

- Only enemy damaging moves can be dodged.
- Self-heals, enemy guard stances, and status-only moves are never dodged.
- Successful dodges are narrated with a visible 💨 combat line.
- Flee uses SPD independently through its own escape calculation.

## 3. Buff & Effect Timing

### Cast-Round Decay Semantics

Fresh combat buffs defer their first decay when the round of casting cannot benefit from them:

- **ATK / MAG:** Defer decay on the cast round because damage actions for that turn have already
  completed.
- **SPD:** Defers decay on mid-round application because the current round's initiative has already
  resolved.
- **DEF / RES:** Tick immediately on the cast round because they provide immediate mitigation
  against the opposing combatant's retaliation during that same turn.

### Duration Unit

All buff, debuff, DoT, and guard durations are measured in discrete **rounds** (never real-world
seconds or ticks).

## 4. Enemy Moves & Boss Mechanics

- **Scripted Specials:** An enemy move with `special.every = N` triggers on the enemy's N-th turn
  slot (e.g., slots N, 2N, 3N...). `runEnemySlot` increments `battle.enemy.turn` before the stun
  check; stunned slots advance the turn counter without firing the special. If slot N is stunned,
  the special is skipped and the next trigger is slot 2N.
- **Defensive Moves:** Moves with `guardPct` and `guardTurns` elevate the enemy's mitigation for the
  subsequent N rounds; the cast round does not consume a duration turn.
- **Status Moves:** Power-0 status moves (e.g. Howl) inflict no baseline chip damage; they apply
  only their explicit status riders.

## 5. Encounter Classification & Provenance

Every fight tracks structured provenance via `BattleOrigin`:

- `explore`: Standard overworld exploration encounter.
- `elite`: Dangerous overworld foe; fleeable and farmable (e.g., Warden of the Void).
- `dungeon`: Dungeon floor encounter; tracks `floor` and `boss` flags.

Boss semantics (fleeing disabled, Smoke Bomb unusable, increments `bossesSlain`) derive strictly
from the encounter origin (`origin.boss === true`). Overworld elites retain standard escape rules.

Dungeon floors advance only on victory; boss floors are gated by story flags (`bossGate`). Victory
rewards route through `resolveVictory()` in `src/engine/world.ts`.

## 6. Telemetry & Applied-HP Contract

Combat events are tracked purely via `src/engine/telemetry.ts` using `recordCombatEvent`. The trace
is plain data returned by resolution:

- **`hpDamaged`:** Carries `resolved` (post-mitigation, post-shield, pre-floor damage, including
  overkill) and `hpLost` (actual clamped HP loss).
- **`hpRestored` / `revived`:** Carries `attempted` and `applied` values.
- **Metrics Calculation:** Aggregated HP-moved metrics (e.g., balance dealt/taken) sum `hpLost`,
  never `resolved`.
- Lifesteal narration and combat logs report actual applied healing.

## 7. Rules Vocabulary & Mechanics Generation

### Generated Mechanics vs Creative Flavor

- A skill or item's name and flavor text (`SkillDef.flavor`, `ItemDef.desc`) are creative prose and
  may be nonliteral or atmospheric; they never dictate mechanics.
- The player-facing rules summary is generated programmatically from structured effect
  specifications via `src/engine/mechanics.ts` (`mechanicsText`, `mechanicsLines`,
  `consumableEffectLines`).
- Hand-written rules numbers in authored prose are forbidden.

### Canonical Rules Vocabulary

All player-facing rules output uses standard terms:

- **Shield:** The damage absorption pool (never "ward").
- **DEF / RES:** Physical defense and magical resistance.
- **round:** Duration and periodic tick interval.
- **action:** An actor's turn to act.
- **beneficial / harmful effect:** Cleanse and dispel target categories.

Generic battle feedback (shield grants, capacity fades, dispels) strictly adheres to this canonical
terminology. The balance harness parses some of those generic lines (`SHIELD_FADE`, `SHIELD_WASTE`
regexes in `src/engine/balance.ts`) — keep them in sync if copy changes.

## 8. Defeat & Revival

- **Standard Defeat:** Results in a 10% gold penalty; the hero revives at 50% maximum HP at the
  first safe haven (Emberdawn Village).
- **Phoenix Cinder:** Automatically revives the hero once per fight at 50% maximum HP upon fatal
  damage (`battle.phoenixUsed`); it cannot be triggered manually from inventory.
