# Content economy and progression

## Economy

- Selling returns 40% of price.
- Shops are AUTHORED local catalogs (`ShopDef`, referenced by a zone's `services.shop`): each shop
  owns its stock rules in authored order, with condition-gated groups (`when` — e.g. Bram's tier-2
  steel opens exactly at the m5_arms beat) and authored local price rules (`pricePct`). There is no
  computed universal stock and no `shopTierFor` — what a counter carries is what the author wrote
  for that counter (#161).
- Equipment is filtered per shopper: only their class, only pieces they can actually equip
  (`def.level ≤ player level`). The counter revalidates `isEquippable` before charging (defense in
  depth). Trinkets stock only what the player can currently equip (`item.level ≤ player level`).
- Zone contextual loot (#158/#165): zones author a `lootTable` (stable id in `content/loot.ts`)
  rolled IN ADDITION to ordinary enemy rewards for explore/elite/travel battles resolved in that
  zone (dungeon battles grant their own caches instead). Quest-kind drops in any contextual table
  stay behind the central relevance filter.
- Forge tempers up to +5 are item-pattern mastery (`forge_i_<itemId>` flags — a documented design
  choice: every copy of that catalog id carries the temper, replacement loot inherits your
  forge-work, and the forge is a bounded per-pattern sink) and boost only that item's own base
  stats. The two temper materials are chosen by the item's tier and slot, not the player's location.
- Gathering and processing (#203/#204) use explicit local catalogs in `content/gathering.ts` and
  `content/crafting.ts`. Forage needs no tool or bait; mining requires a reusable pickaxe; fishing
  requires a reusable fishing rod and consumes one bait per cast. Activities share three charges per
  zone. Spending the final charge starts a six-hour timer; all three replenish when it expires.
  Partially spent allowances do not recharge. Refusals never spend ingredients, bait, gold or
  charges. Tools remain ordinary inventory materials. Recipe inputs and material uses are derived
  for the UI; do not promise future facilities in flavor text. See
  [resources and crafting](../../../../docs/resources-and-crafting.md) for sources, the early supply
  chain, tempering costs, and current extension boundaries.

## Endgame economy

- Postgame XP converts to gold (`ceil(xp / 8)`) instead of vanishing.
- Safe-haven forage recharges on a 6h real-time cooldown (`forageResetAt`, stamped the moment the
  last charge is spent; `explore()` takes an injected `now` for deterministic tests). Free travel
  never refreshes it.
- The Vault consumes the Sunspire Key on the first boss victory; its sole source is the m11_toll
  reward.
- Boss first-clear trinkets follow the
  [earned-trophy decision](../../emberdawn-design-decisions/SKILL.md#boss-first-clear-trinkets-are-earned-trophies).

## Chapter-one curve

The bridge to Aranya is authored, not an unexplained grind: m1_embers (4× Lv-1 ember-rats in the
Outskirts) → m2_letter (delivery) → m3_wolves (3× Lv-4 wolves, Whisperwood) → m4_floors
(silk-broods, Lv 5) → m5_arms (the tier-2 preparation beat: two Iron Chunks, no coin cost; Bram's
authored tier-2 stock group opens when the quest becomes active and remains open afterward, subject
to equipment eligibility) → m3_roots (Aranya, level 7) → m4_blessing (shards, level 8, unlocks
Hollowmere). Every dungeon authors `recommendedLevel`; see `emberdawn-combat` for how it is
surfaced.

## Skill cadence

Each class demonstrates its identity by level 2 — the Cleric heals from level 1 (Mend Wounds), not
level 4. Ladders stay distinct rather than uniform: warrior's second damage tier is 13 (Whirlwind)
with Iron Wall moved to 16; cleric's offensive upgrade is 11 (Radiant Burst) with Holy Ward at 16,
and Judgment strikes for 290% MAG so late-game cleric damage is not stranded. The class picker
states the starting kit, tradeoff, and complexity, and marks Warrior as the forgiving beginner pick.
Mechanical summaries are generated from `effects` by `src/engine/mechanics.ts`; authors provide
structured effects and nonmechanical flavor. New effect shapes require summary-renderer support and
relevant tests.
