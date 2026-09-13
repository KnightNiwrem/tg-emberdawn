# Progression and story context

Authoritative code and tests: `src/content/quests.ts`, `src/content/skills.ts`,
`src/content/facilities.ts`, `src/content/zones.ts`, `src/engine/classes.ts`,
`tests/progression_test.ts`, `tests/progression_graph_test.ts`, `tests/engine_test.ts`,
`tests/balance_test.ts`.

Read the section for the progression or story contract being changed. For numeric rewards, stock, or
required expenditures, also read [Economy and rewards](economy.md). For zone access, encounter
sources, or dungeon definitions, read [World content](world-content.md). Load
`emberdawn-story-and-quests` when the task changes quest lifecycle, dialogue flow, or story
authority.

## Chapter-one curve

The bridge to Aranya is authored, not an unexplained grind: m1_embers (4× Lv-1 ember-rats in the
Outskirts) → m2_letter (delivery) → m3_wolves (3× Lv-4 wolves, Whisperwood) → m4_floors
(silk-broods, Lv 5) → m5_arms (the tier-2 preparation beat: two Iron Chunks, no coin cost; Bram's
authored tier-2 stock group opens when the quest becomes active and remains open afterward, subject
to equipment eligibility) → m3_roots (Aranya, level 7) → m4_blessing (shards, level 8, unlocks
Hollowmere).

## Skill cadence

Each class demonstrates its identity by level 2 — the Cleric heals from level 1 (Mend Wounds), not
level 4. Ladders stay distinct rather than uniform: warrior's second damage tier is 13 (Whirlwind)
with Iron Wall moved to 16; cleric's offensive upgrade is 11 (Radiant Burst) with Holy Ward at 16,
and Judgment strikes for 290% MAG so late-game cleric damage is not stranded. The class picker
states the starting kit, tradeoff, and complexity, and marks Warrior as the forgiving beginner pick.

## Story and theme

The game is about seeking hope for a future: the player is a Dawncaller, the Sundered King is
despair hoarding tomorrow, and each chapter recovers a piece of the dawn. Chapter flags are
`chapter1Done`…`chapter6Done`; the game-clear moment is defeating King Aldric (flag set via the
dungeon first-clear `crownRestored`). Preserve an overall hopeful tone while stating permanent
consequences plainly: a closed quest branch or forfeited reward must not sound temporarily
unavailable. For prose style and consequence disclosure, load `emberdawn-narrative-writing`.
