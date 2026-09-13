---
name: emberdawn-combat
description: Implement or review Emberdawn combat resolution, combat effects, encounter behavior, or combat balance.
---

# Emberdawn combat

Preserve deterministic, ordered resolution and immediate terminal-state checks. Read only the
reference needed for the changed behavior:

| Task                                                                              | Reference                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------ |
| Action order, initiative, effect duration, enemy moves, HP events, death/revival  | [Resolution contracts](references/resolution.md) |
| Encounter provenance, boss classification, eligibility, dungeon progression/entry | [Encounter behavior](references/encounters.md)   |
| Balance metrics, seeded fights/campaigns, snapshots, generic battle-line parsers  | [Balance harness](references/balance.md)         |

Structured catalog edits use `emberdawn-content-authoring`; authored prose uses
`emberdawn-narrative-writing`. Load combat guidance for those tasks only when they change combat
semantics or the generic battle lines consumed by balance metrics. A dungeon description or shop
price change alone does not require combat-resolution guidance.
