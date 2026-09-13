---
name: emberdawn-combat
description: Use when changing or reviewing Emberdawn combat rules, effects, encounter selection, dungeon behavior, combat telemetry, or balance.
---

# Emberdawn combat

Rules for the turn engine, effects, encounters, dungeons, and balance harness. Combat resolves in
one synchronous, ordered flow, with terminal checks after potentially lethal transitions and
caller-owned plain-data traces. The shared ordered-completion boundary lives in the root
`AGENTS.md`, `emberdawn-architecture`, and `tests/architecture_test.ts`.

Source and test paths in this skill and its references are relative to the repository root.

## Read for the task

Load the relevant reference or named section; combine routes when the task crosses contracts.

| When changing or reviewing...                                                        | Read                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turn resolution, initiative, durations, avoidance, enemy moves, or immediate revival | [Resolution and effects](references/resolution-and-effects.md)                                                                                                                                                 |
| Combat telemetry, HP-moved metrics, or generic battle output                         | [Resolution order and telemetry](references/resolution-and-effects.md#resolution-order-and-telemetry) and [Balance harness](references/balance-harness.md#balance-harness) for trace metrics and line parsers. |
| Encounter eligibility/provenance, bosses, dungeon entry/runs, death, or respawn      | [Encounters and dungeons](references/encounters-and-dungeons.md)                                                                                                                                               |
| Seeded simulations, balance snapshots, or campaign planning/accounting               | [Balance harness](references/balance-harness.md)                                                                                                                                                               |

## Progression and enemy stats

- 45 levels. The XP curve is deliberately grindy; `xpForNextLevel()` in `src/engine/classes.ts` is
  the authority (it floors the curve and returns infinity at the level cap).
- Enemy stats derive from level in `mk()` (`src/content/enemies.ts`). Bosses multiply HP/xp/gold and
  have scripted specials.
