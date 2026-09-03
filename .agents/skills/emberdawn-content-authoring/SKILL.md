---
name: emberdawn-content-authoring
description: Use when adding or changing Emberdawn items, skills, enemies, zones, dungeons, drops, NPCs, dialogues, or quests.
---

# Content Authoring — Emberdawn

Checklist and integrity requirements for adding or modifying items, skills, enemies, zones,
dungeons, and quests.

## 1. Identifier Conventions

Always define IDs in their home content module before referencing them elsewhere:

- **`e_*`**: Enemies (`src/content/enemies.ts`)
- **`w_*`, `a_*`, `t_*`, `c_*`, `m_*`**: Items — weapon, armor, trinket, consumable, material
  (`src/content/items.ts`)
- **`q_*`, `sq_*`**: Quests — main campaign, side quests (`src/content/quests.ts`)
- **`z_*`**: Zones (`src/content/zones.ts`)
- **`d_*`**: Dungeons (`src/content/zones.ts`)
- **`sk_*`**: Skills (`src/content/skills.ts`)
- **`npc_*`**: Non-player characters (`src/content/quests.ts` / `src/content/dialogues.ts`)
- **`dlg_*`**: Dialogues (`src/content/dialogues.ts`, `src/content/quest_dialogues.ts`)

## 2. Enemy Definitions & Scaling

- Always derive enemy stats using `mk({ id, name, emoji, level, mul: { hp, atk, ... } })` in
  `src/content/enemies.ts` with appropriate multipliers — never hard-code raw base numbers.
- Bosses multiply HP, XP, and gold rewards, and define periodic special moves (`special.every = N`).
- Damaging moves and power-0 status moves must be configured cleanly without unintended chip damage.

## 3. Drop Rates & Quest Rewards

- Field drop rates should generally sit between 0.1 and 0.6; boss drops between 0.4 and 1.0.
- Random quest items are automatically gated by `questDropAllowed` so they cease dropping once the
  quest completes.
- Quest gear rewards should match approximately 2–3 shop tiers of gear appropriate for that level
  band.
- Boss first-clear trinkets (`t_12`–`t_18`) are designated `unique` (earned trophies: un-droppable
  and unsellable).

## 4. World & Encounter Rules

- **Safe Havens:** Zones marked `safeHaven: true` (e.g. Emberdawn Village) must keep explore tables
  completely battle-free. Combat belongs only in the wilds.
- **Zone Reachability:** Every zone must be reachable either by being included in `STARTING_ZONES`
  or granted as an `unlockZone` reward on a quest or dungeon completion.
- **Encounter Eligibility:** Overworld battle events define `minPlayerLevel`. Keep `maxPlayerLevel`
  optional for ordinary encounters; only specify `maxPlayerLevel` as an exception for intentionally
  bounded content (e.g. starter/tutorial zones), ensuring high-level players can still encounter
  hostiles when revisiting earlier regions.
- **Dungeon Recommended Level:** Every dungeon definition (`DungeonDef`) must provide
  `recommendedLevel`. Under-level boss warnings in the UI depend on this field, so omitting it lets
  under-level players bypass the intended confirmation dialog.

## 5. Skills & Class Design

- Starting skills configured with `learnLevel: 1` are granted automatically upon character creation.
- Skills must express their mechanics exclusively through structured effect specifications.
  Descriptions are generated automatically by `src/engine/mechanics.ts`.
- Authors provide creative flavor text (`SkillDef.flavor`), which must never contain hard-coded
  rules numbers or conflicting mechanical claims.

## 6. Quest Authoring Checklist

When creating or modifying a quest:

1. Specify explicit physical contacts: `startNpc` and `finishNpc`. Both must exist and be placed in
   a valid zone.
2. Provide both `offerDialogue` and `turnInDialogue`.
3. If conversation objectives are used, use `kind: 'storyEvent'` driven by explicit dialogue steps.
4. Verify kill objectives can be satisfied: enemies must appear in wild explore tables or have
   sufficient dungeon floor capacity.
5. Ensure destination quests start in the preceding region and end with the destination contact.

## 7. Mandatory Integrity Tests

Before committing any content additions, ensure all content-integrity test suites pass:

- `tests/engine_test.ts`: Verifies cross-module ID references, drop tables, shops, and zones.
- `tests/progression_test.ts`: Runs the full campaign progression simulation across all classes to
  prove reachability and completion.
- `tests/quest_copy_test.ts`: Machine-checks prose conventions, system vocabulary restrictions, and
  declarative condition references.
- `tests/dialogue_test.ts`: Verifies dialogue node connectivity, terminal nodes, speaker formats,
  and topic wiring.
