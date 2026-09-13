---
name: emberdawn-design-decisions
description: Evaluate Emberdawn code-quality refactors, cleanup findings, or proposed changes to documented design trade-offs.
---

# Emberdawn design decisions

Accepted trade-offs and intentional non-goals. Preserve these during ordinary fixes and refactors.
An explicit user request to revisit a decision authorizes that design work; do not request the same
decision again. Keep unrelated decisions intact.

## Dungeons are consecutive runs

The canonical [dungeon-run policy](../../../docs/dungeon-runs.md) defines consecutive progression,
abandonment versus disconnected-session resumption, recovery restrictions, durable rewards, and boss
preparation. Preserve that contract when changing dungeon design.

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

The [economy contract](../emberdawn-content-authoring/references/economy.md#economy) defines
tempering as catalog-pattern mastery shared by every copy, including later replacement loot.
Preserve that bounded per-pattern sink when evaluating item-instance alternatives.

## Evaluated dead-code findings

`npx fallow` output is advisory. Follow the review boundaries in
[docs/code-quality.md](../../../docs/code-quality.md#accepted-boundaries):

- Unused functions, re-exports, and export-visibility cleanup remain deferred under #185. Preserve
  them unless the owner explicitly revisits that scope. Do not remove unused APIs or narrow export
  visibility solely to clear findings, whether manually or automatically.
- "Unlisted dependencies" (grammy, grammy-testing, pg) is a Node-only heuristic and a false positive
  here: this is a Deno project; dependencies live in `deno.json`, not `package.json`.
- Shop buy/sell row duplication in `src/render/views.ts` is accepted: the two rows differ in label,
  action, and semantics, and a shared abstraction would be more indirect than the duplication.

## Large dispatch switches

Flat, exhaustive switch dispatch (the callback router, view renderers) is intentional. Prefer adding
a case over introducing routing abstractions.
