# Resources, gathering, and workshops

Emberdawn's resource economy connects local gathering and creature salvage to provisions, tools, and
item-pattern tempering. The live catalogs are `src/content/gathering.ts`, `crafting.ts`, `loot.ts`,
`items.ts`, and `enemies.ts`. Requirements and item effects in the UI come from those catalogs.

## Activity and geography

| Location            | Gathering activities | Characteristic resources                                      |
| ------------------- | -------------------- | ------------------------------------------------------------- |
| Emberdawn Village   | Forage               | Fiber, berries, bitterleaf, worms                             |
| Emberdawn Outskirts | Forage, mine         | Fiber, berries, grubs, copper, iron, clay, coal, ember shards |
| Whisperwood         | Forage, fish         | Hardwood, resin, glowcaps, bitterleaf, trout                  |
| Mirefoot Landing    | Forage, fish         | Reeds, clay, worms, bitterleaf, eels                          |
| Hollowmere          | Forage, mine, fish   | Reeds, glowcaps, clay, bog iron, eels                         |
| Sunspire            | Mine                 | Sunstone, quartz, salt, mystic dust                           |
| Frostpeak           | Forage, mine         | Lichen, silver ore, quartz, frost cores, coal                 |
| Cinder Wastes       | Forage, mine         | Charred wood, coal, obsidian, sulfur, cinder hearts           |
| Umbral Spire        | Mine                 | Black iron, quartz                                            |
| Abyss               | Mine                 | Void fragments, black iron                                    |

Each location has three shared gathering charges, regardless of which activity spends them. The last
successful gather starts a six-hour recharge. Changing activities, bait, tools, or locations does
not reset that location's supply. Gathering itself does not start battles; travel and exploration
retain their hazards. The gathering screen shows available results, probabilities, yield ranges,
requirements, and the stored recharge time. An action checks elapsed recharge before spending
anything.

Mining requires a reusable Pickaxe in the bag. Fishing requires a reusable Fishing Rod and one bait
per cast. Worm Bait costs 3 gold and catches one fish with 70% probability; its other results are
reeds and tangled roots. Grub Bait costs 6 gold and catches one or two fish with 90% probability;
its other result is tangled roots. Catch tables are explicit per site, so better bait trades coins
for more fish per limited gathering charge. Tools have no durability or equipment slot. Both tools
can be bought or made at a forge bench. Worms and grubs also have gathering sources.

The separate Search surroundings action at safe havens retains its existing three-search/six-hour
allowance. Wild exploration remains repeatable and supplies resources alongside encounters and rest.
Routine exploration finds are now raw local goods. Dungeon supply caches and authored roadside
valuables remain plausible places for prepared supplies and coin.

## Uses and acquisition

Raw berries restore 12 HP and bitterleaf restores 8 MP. Brewing concentrates these into the existing
60-HP Minor Potion and 40-MP Minor Ether, using additional ingredients and a fee. Fish are
materials; cooking produces stronger consumable meals. Other recipes cover later potions and ethers,
cleansing tonics, smoke bombs, charcoal, iron ingots, and tool manufacture. Every recipe displays
its local station, level, fee, inputs, bag quantities, output, and generated output mechanics.
Missing inputs have source directions; item details list current uses and sell value. A Sources
button opens a paginated catalog reference, with Back returning to the same item and its original
bag, equipment, or shop context.

The early supply chain is deliberately accessible:

- Coal is available in the Outskirts through mining and ordinary exploration.
- Iron comes from the quarry, forest enemies and caches, and Bram's progression-gated shelf.
- Hardwood comes from Whisperwood. Fiber and bones come from early gathering and creatures.
- The Ferryman sells salt, so eel stew and cleansing tonic do not require reaching Sunspire first.
- Tools can be made from gathered resources; acquiring coal and iron does not require already owning
  a pickaxe. Purchasing a tool remains the convenient alternative.
- Smoke Bomb production requires level 29 and sulfur from the Wastes. Earlier Smoke Bombs remain
  purchasable where shops already stock them.

The ordinary animals yield hide, bone, silk, fur, shells, or other anatomical salvage. Spirits and
constructs yield their plausible magical or mineral components. People can carry manufactured
supplies or personal valuables. Regional battle finds contain materials rather than bottled
medicine. Quest items still use the central relevance gate and preserve their authored quest
sources.

Rat tails, cracked shells, tangled roots, broken pottery, rusty scrap, and copper ore currently
serve as trade goods. Silver brooches, sun medallions, and royal signets are more valuable enemy
salvage; they do not appear in gathering or ordinary exploration. Selling still returns 40% of
catalog price. Item inspection explicitly distinguishes goods with no current workshop or tempering
use. A material name or description does not promise an unimplemented recipe.

## Tempering

Tempering remains mastery of an item pattern: every copy of that catalog item shares its temper.
Existing local forge capabilities, progression upgrades, +5 ceiling, and +8% base-stat contribution
per temper remain unchanged. Two materials now accompany a smaller fee; requirements derive from the
equipment tier, even when the player returns to an earlier forge.

| Equipment tier | Primary material | Secondary material: weapon / armor |
| -------------- | ---------------- | ---------------------------------- |
| 1              | Ember Shard      | Hardwood / Plant Fiber             |
| 2              | Iron Ingot       | Hide                               |
| 3              | Mystic Dust      | Reed / Spider Silk                 |
| 4              | Mystic Dust      | Sunstone / Quartz                  |
| 5              | Frost Core       | Silver Ore / Thick Fur             |
| 6              | Cinder Heart     | Obsidian                           |
| 7              | Cinder Heart     | Night Silk                         |
| 8              | Void Fragment    | Black Iron                         |

For the next temper rank N, the cost is N primary materials, N+1 secondary materials, and 15 × tier
× N gold. Completing +1 through +5 costs 15 primary materials, 20 secondary materials, and 225 ×
tier gold. Previously the fee alone was 11,000 gold at every tier. This shifts the sink toward
regional acquisition while preserving a bounded per-pattern investment. Iron ingots require two iron
chunks or two bog iron plus coal, making smelting a real intermediate step.

## Extension boundaries

The current scope includes gathering, processing, and tempering, without crop timers, land
ownership, food satiety, fishing minigames, or per-tool durability. Future facilities can use the
same material identities and recipe pattern. Farming would additionally need an explicit persisted
plot lifecycle and version change; more elaborate cooking needs a decision about whether food
remains ordinary consumables or introduces new mechanics. Neither exists implicitly in the current
item descriptions.

Content and runtime tests cover source integrity, habitat restrictions, raw versus processed
strength, atomic spending, recharge behavior, quest readiness, local authority, callback replay, and
purchased input resale bounds. The economy is an authored initial balance; observed gathering
participation, material shortages, and forge adoption during playtesting should guide subsequent
tuning.
