---
name: emberdawn-content-authoring
description: Use when adding or changing Emberdawn items, skills, enemies, zones, dungeons, drops, NPCs, dialogues, or quest definitions, or when tuning shop, forge, or reward economy.
---

# Emberdawn content authoring

Rules for adding or changing content in `src/content/`. Content modules are pure data — they never
import grammy or touch Telegram/Deno-specific APIs. Content refers only to real ids defined in other
content modules; the integrity tests in `tests/engine_test.ts` ("content integrity: …") enforce this
and must stay green.

## Adding content checklist

1. Define ids first, then reference them. Follow the conventions already used in each content module
   — for example `e_*` enemies, `w_`/`a_`/`t_`/`c_`/`m_` items, `sk_*` skills, `npc_*` NPCs, `dlg_*`
   dialogues, `d_*` dungeons, `m<n>_*` main quests, `sq_*` side quests, and bare-word zone ids. This
   list is not exhaustive: the content modules and the content-integrity tests are the authority on
   each catalog's real convention.
2. Enemy stats: use `mk()` with level and multipliers — never raw numbers.
3. Wire drops at sensible probabilities (bosses 0.4–1.0, field 0.1–0.6).
4. Quest rewards should cover roughly 2–3 shop tiers of gear at that level.
5. Run the content-integrity tests; they catch dangling ids.
6. Safe havens (`safeHaven: true`) never spawn battles: keep their explore tables battle-free (the
   engine also filters them). Battles belong in the wilds players travel to.
7. Every zone must be reachable: list it in `STARTING_ZONES` or grant it via a quest or dungeon
   `unlockZone` reward — the zone-reachability test enforces this.
8. `learnLevel: 1` skills are granted at creation. Save-schema questions after persisted-shape
   changes follow `emberdawn-persistence`.
9. Kill objectives must be satisfiable: the target enemy needs a wilds spawn (zone explore table) or
   enough dungeon floor slots. `tests/progression_test.ts` enforces encounter capacity, and the full
   m1→m25 simulation walks the entire quest graph through the pure engine.
10. Quest and dialogue content must also satisfy `emberdawn-story-and-quests`: lifecycle contacts,
    offer/turn-in dialogues, story-event objectives, and topic wiring are all content-integrity
    tested.

## Economy

- Selling returns 40% of price.
- Shop tier follows the player level clamped to the zone's band (`shopTierFor`) — that governs
  consumables and materials, which are always usable, so it is pure zone flavor.
- Equipment is filtered per shopper: only their class, only pieces they can actually equip
  (`def.level ≤ player level`). The old clamp-up baited low-level travelers with level-locked gear.
  The counter revalidates `isEquippable` before charging (defense in depth). Trinkets stock only
  what the player can currently equip (`item.level ≤ player level`).
- Forge tempers up to +5 are item-pattern mastery (`forge_i_<itemId>` flags — a documented design
  choice: every copy of that catalog id carries the temper, replacement loot inherits your
  forge-work, and the forge is a bounded per-pattern sink) and boost only that item's own base
  stats. The temper material is chosen by the item's tier, not the player's location.

## Endgame economy

- Postgame XP converts to gold (`ceil(xp / 8)`) instead of vanishing.
- Safe-haven forage recharges on a 6h real-time cooldown (`forageResetAt`, stamped the moment the
  last charge is spent; `explore()` takes an injected `now` for deterministic tests). Free travel
  never refreshes it.
- The Vault boss floor consumes the Sunspire Key on the first victorious entry; its sole source is
  the m11_toll reward.
- Boss first-clears award boss trinkets `t_12`–`t_18`: never stocked, `unique` (unsellable and
  un-droppable earned trophies).

## Chapter-one curve

The bridge to Aranya is authored, not an unexplained grind: m1_embers (4× Lv-1 ember-rats in the
Outskirts) → m2_letter (delivery) → m3_wolves (3× Lv-4 wolves, Whisperwood) → m4_floors
(silk-broods, Lv 5) → m5_arms (the tier-2 preparation beat: iron chunks + coin; the village band
runs [1,7] so Bram's rack stocks tier 2) → m3_roots (Aranya, level 7) → m4_blessing (shards, level
8, unlocks Hollowmere). Every dungeon authors `recommendedLevel`; see `emberdawn-combat` for how it
is surfaced.

## Skill cadence

Each class demonstrates its identity by level 2 — the Cleric heals from level 1 (Mend Wounds), not
level 4. Ladders stay distinct rather than uniform: warrior's second damage tier is 13 (Whirlwind)
with Iron Wall moved to 16; cleric's offensive upgrade is 11 (Radiant Burst) with Holy Ward at 16,
and Judgment strikes for 290% MAG so late-game cleric damage is not stranded. The class picker
states the starting kit, tradeoff, and complexity, and marks Warrior as the forgiving beginner pick.
Skill descriptions are machine-checked against their authored coefficients in the test suite.

## Story and theme

The game is about seeking hope for a future: the player is a Dawncaller, the Sundered King is
despair hoarding tomorrow, and each chapter recovers a piece of the dawn. Chapter flags are
`chapter1Done`…`chapter6Done`; the game-clear moment is defeating King Aldric (flag set via the
dungeon first-clear `crownRestored`). Keep new writing in this register: setbacks are real but
framed as "not yet", never "never". For prose style, load `emberdawn-narrative-writing`.
