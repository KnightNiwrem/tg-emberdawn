---
name: emberdawn-content-authoring
description: Use when adding, changing, or reviewing Emberdawn content IDs, structure, gameplay data, or economy. For wording-only edits, use emberdawn-narrative-writing.
---

# Emberdawn content authoring

Rules for adding or changing content in `src/content/`. Content definitions are declarative data;
pure construction and lookup helpers are allowed. Content modules never import grammy or touch
Telegram/Deno-specific APIs. Content refers only to real ids defined in other content modules; the
integrity tests in `tests/engine_test.ts` ("content integrity: …") enforce this and must stay green.

Source and test paths in this skill and its references are relative to the repository root.

## Common content checks

- Define ids first, then reference them. Follow the conventions already used in each content module
  — for example `e_*` enemies, `w_`/`a_`/`t_`/`c_`/`m_` items, `sk_*` skills, `npc_*` NPCs, `dlg_*`
  dialogues, `d_*` dungeons, `m<n>_*` main quests, `sq_*` side quests, and bare-word zone ids. This
  list is not exhaustive: the content modules and the content-integrity tests are the authority on
  each catalog's real convention.
- Run the content-integrity tests; they catch dangling ids.

Save-schema questions after persisted-shape changes follow `emberdawn-persistence`. For content-ID
changes, follow the root `AGENTS.md` release-phase and persisted-identity rules.

## Read for the task

Use the applicable definition checks below and load references for the content being changed or
reviewed. These are conditional domain checks, not one execution sequence. For an item addition,
follow its intended acquisition route: drops and contextual loot use world guidance; shop stock,
gathering/crafting, and quest rewards use economy guidance.

| When changing or reviewing...                                                                                   | Read                                                                 |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Zones, drops, contextual loot, encounter eligibility or weighting, dungeons, reachability, or objective sources | [World content](references/world-content.md)                         |
| Prices, stock, selling, forge, gathering/crafting, forage, or quest rewards                                     | [Economy and rewards](references/economy.md)                         |
| Chapter progression, class cadence, chapter flags, or story/theme continuity                                    | [Progression and story context](references/progression-and-story.md) |

For quest lifecycle, dialogue flow, story effects, or NPC topic wiring, also load
`emberdawn-story-and-quests`: lifecycle contacts, offer/turn-in dialogues, story-event objectives,
and topic wiring are all content-integrity tested.

For authored player-facing prose, load `emberdawn-narrative-writing`.

## Item, skill, and enemy definitions

Authoritative definitions: `src/content/items.ts`, `src/content/skills.ts`,
`src/content/enemies.ts`. Mechanical disclosure is checked in `tests/mechanics_test.ts` and the
content-integrity tests above; acquisition references are covered by `tests/item_sources_test.ts`.

- Enemy stats: use `mk()` with level and multipliers — never raw numbers.
- `learnLevel: 1` skills are granted at creation.

Mechanical summaries are generated from `effects` by `src/engine/mechanics.ts`; authors provide
structured effects and nonmechanical flavor. New effect shapes require summary-renderer support and
relevant tests.
