---
name: emberdawn-design-decisions
description: Use when reconsidering Emberdawn accepted trade-offs, intentional non-goals, dead-code findings, or architectural rationale that the project has already decided.
---

# Emberdawn design decisions

Accepted trade-offs and intentional non-goals. These are settled decisions; re-opening one requires
an explicit design change, not a drive-by refactor. Each entry states the current decision, not its
history.

## Dungeons are consecutive runs

Each dungeon entry starts at floor 1. Combat and authored discovery floors lead consecutively to the
boss; leaving or fleeing abandons the current run. Players cannot visit hub facilities or rest
between floors. Discovery rooms supply atmosphere and occasional finite caches, never free recovery.
An interrupted session resumes the active run; disconnecting is not abandoning it.

Durable first clears and collected floor caches are separate from temporary run progress. Retries
retain earned quest progress and loot but cannot regenerate first-clear rewards or cache contents.
Boss story gates remain in force, so preparation quests can use the earlier encounters and a player
can abandon a run to report back. The next entry still begins at floor 1. See `docs/dungeon-runs.md`
for the full policy and content authoring boundaries.

## Overland travel is not free (#157/#162)

- Some overland edges intentionally impose a sequence of random travel events (`RouteDef.eventCount`
  rolled from `RouteDef.events`). Crossing a road is real play, not a free teleport.
- This creates inter-region expedition attrition and makes local facilities geographically
  meaningful: a shop or forge is worth what the road to it is worth.
- Starter travel remains free: the roads out of Emberdawn (and equivalent first-region edges) have
  `eventCount: 0`.
- Local access to a regional haven can remain zero/low risk or become SECURED through a route
  variant (e.g. a story outcome replacing a hostile road with a safe one), so dungeon difficulty is
  never balanced as one continuous endurance run across the world.
- Travel-event tables may produce hostile, quiet, or beneficial outcomes; an event count is a number
  of rolls, never a guaranteed number of battles.

## Boss first-clear trinkets are earned trophies

`t_12`–`t_18` are deliberately protected one-time rewards: they cannot be sold or dropped. Here
`unique` means "unrecoverable if lost", not a full collectible model.

## Forge temper is per-pattern mastery

Forge tempers are recorded as item-pattern flags (`forge_i_<itemId>`): every copy of that catalog id
carries the temper, replacement loot inherits the forge-work, and the forge is a bounded per-pattern
sink. This is a documented design choice, not a bug.

## Evaluated dead-code findings

`npx fallow` output is advisory — evaluate findings, do not auto-apply them:

- "Unlisted dependencies" (grammy, grammy-testing) is a Node-only heuristic and a false positive
  here: this is a Deno project; dependencies live in `deno.json`, not `package.json`.
- One residual ~12-line clone pair in `render/views.ts` (shop buy vs sell rows) is accepted: the two
  rows differ in label, action, and semantics, and a shared abstraction would be more indirect than
  the duplication.
- Large dispatch switches (`callbacks.ts`, view renderers) are flat and exhaustive by design;
  complexity lives in data, not control flow.

## Large dispatch switches

Flat, exhaustive switch dispatch (the callback router, view renderers) is intentional. Prefer adding
a case over introducing routing abstractions.
