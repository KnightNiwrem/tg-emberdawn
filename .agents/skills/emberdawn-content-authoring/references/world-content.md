# World content and acquisition

Authoritative code and tests: `src/content/zones.ts`, `src/content/enemies.ts`,
`src/content/loot.ts`, `src/content/quests.ts`, `src/engine/world.ts`, `tests/engine_test.ts`,
`tests/progression_test.ts`, `tests/progression_graph_test.ts`, `tests/dungeon_content_test.ts`,
`tests/dungeon_run_test.ts`, `tests/quest_encounters_test.ts`.

For dungeon definitions, read [docs/dungeon-runs.md](../../../../docs/dungeon-runs.md) for the
canonical run and discovery-floor contract. For changes to or reviews of `questBoosts` or
quest-dependent encounter weighting, read
[docs/quest-encounters.md](../../../../docs/quest-encounters.md).

For regional progression or quest-beat placement, read the applicable context in
[Progression and story](progression-and-story.md). For shop, gathering, or reward sources, including
dungeon keys and first-clear rewards, read [Economy and rewards](economy.md). Load
`emberdawn-combat` when encounter eligibility, boss classification, or run behavior is affected;
load `emberdawn-story-and-quests` when quest lifecycle, dialogue flow, or story authority is
affected.

## Drops and contextual loot

- Wire drops at sensible probabilities (bosses 0.4–1.0, field 0.1–0.6).
- Zone contextual loot (#158/#165): zones author a `lootTable` (stable id in `src/content/loot.ts`)
  rolled IN ADDITION to ordinary enemy rewards for explore/elite/travel battles resolved in that
  zone (dungeon battles grant their own caches instead). Quest-kind drops in any contextual table
  stay behind the central relevance filter.

## Zones and objective sources

- Safe havens (`safeHaven: true`) never spawn battles: keep their explore tables battle-free (the
  engine also filters them). Battles belong in the wilds players travel to. They also author no
  `rest` events (#211): arrival at a haven already restores both pools fully, so an in-haven rest
  could only roll against full pools — the engine filters those too.
- Every zone must be reachable: list it in `STARTING_ZONES` or grant it via a quest or dungeon
  `unlockZones` reward array — the zone-reachability test enforces this. Quests and dungeon
  first-clears list zones in authored order; existing unlocks are not granted or announced again.
- Kill objectives must be satisfiable: the target enemy needs a wilds spawn (zone explore table) or
  enough dungeon floor slots. `tests/progression_test.ts` enforces encounter capacity, and the full
  m1→m25 simulation walks the main questline through the pure engine.

## Dungeon recommendations

Every dungeon authors `recommendedLevel`; see `emberdawn-combat` for how it is surfaced.
