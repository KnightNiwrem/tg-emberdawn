# Economy and rewards

Authoritative code and tests: `src/content/items.ts`, `src/content/facilities.ts`,
`src/content/gathering.ts`, `src/content/crafting.ts`, `src/content/quests.ts`,
`tests/engine_test.ts`, `tests/shop_ui_test.ts`, `tests/crafting_test.ts`,
`tests/progression_test.ts`, `tests/balance_test.ts`.

For drop tables or contextual loot, read [World content](world-content.md). For reward placement or
stock changes that affect a chapter's progression, read the relevant section of
[Progression and story](progression-and-story.md). Load `emberdawn-story-and-quests` when lifecycle,
dialogue flow, or story effects change. For changes to balance simulations or their reports, load
`emberdawn-combat`.

## Quest reward checks

Evaluate quest rewards against eligible local shop stock and prices at that quest beat, including
item rewards and required expenditures. Check the relevant progression and balance tests.

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
- Forge tempers up to +5 are item-pattern mastery (`forge_i_<itemId>` flags — a documented design
  choice: every copy of that catalog id carries the temper, replacement loot inherits your
  forge-work, and the forge is a bounded per-pattern sink) and boost only that item's own base
  stats. The two temper materials are chosen by the item's tier and slot, not the player's location.
- Gathering and processing (#203/#204) use explicit local catalogs in `src/content/gathering.ts` and
  `src/content/crafting.ts`. Gathering requires tools/bait only where specified by the authored site
  and shares three charges per zone across activities. Spending the final charge starts a six-hour
  timer; all three replenish when it expires. Partially spent allowances do not recharge. Refusals
  never spend ingredients, bait, gold or charges. Tools remain ordinary inventory materials. Recipe
  inputs and material uses are derived for the UI; do not promise future facilities in flavor text.
  See [docs/resources-and-crafting.md](../../../../docs/resources-and-crafting.md) for sources, the
  early supply chain, tempering costs, and current extension boundaries.

## Endgame economy

- Postgame XP converts to gold (`ceil(xp / 8)`) instead of vanishing.
- Safe-haven forage recharges on a 6h real-time cooldown (`forageResetAt`, stamped the moment the
  last charge is spent; `explore()` takes an injected `now` for deterministic tests). Free travel
  never refreshes it.
- The Vault consumes the Sunspire Key on the first boss victory; its sole source is the m11_toll
  reward.
- Boss first-clears award boss trinkets `t_12`–`t_18`: never stocked, `unique` (unsellable and
  un-droppable earned trophies).
