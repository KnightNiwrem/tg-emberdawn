# Structured content requirements

Content definitions are declarative data; pure construction and lookup helpers are allowed. The
content modules and content-integrity tests are authoritative for ID conventions. Common families
include `e_*` enemies, `w_`/`a_`/`t_`/`c_`/`m_` items, `sk_*` skills, `npc_*` NPCs, `dlg_*`
dialogues, `d_*` dungeons, `m<n>_*` main quests, `sq_*` side quests, and bare-word zone IDs. Every
current reference must resolve. Apply the requirements for the catalog being changed.

## Enemies, items, and skills

- Enemy stats use `mk()` with level and multipliers, rather than raw stat blocks.
- Drop probabilities follow the existing encounter role: bosses typically 0.4–1.0, field 0.1–0.6.
- `learnLevel: 1` skills are granted at creation. Cadence, equipment, and rewards follow the
  relevant sections of [economy and progression](economy.md).
- New effect shapes require generated-summary support in `src/engine/mechanics.ts` and tests for
  their disclosure; names and flavor are not a second rules source.

## Zones and dungeons

- Safe havens (`safeHaven: true`) have battle-free explore tables and no `rest` events. Arrival
  already restores HP/MP fully; the engine filters battles and rests there too.
- Every zone is reachable through `STARTING_ZONES` or quest/dungeon `unlockZones` rewards. Unlocks
  preserve authored order; existing unlocks are neither granted nor announced again.
- Dungeon content follows [dungeon runs](../../../../docs/dungeon-runs.md), including recommended
  entry levels, consecutive floors, finite caches, boss gates, and recovery restrictions.
- Road, facility, and reachability changes use [world topology](../../../../docs/world-topology.md).
- Quest-conditioned encounter weighting uses
  [quest encounter assistance](../../../../docs/quest-encounters.md).

## Quests and dialogue definitions

- Kill targets need wilds spawns or enough dungeon encounter slots. `tests/progression_test.ts`
  checks capacity and walks the main questline through the pure engine.
- Evaluate rewards and required expenditure against eligible local shop stock and prices at that
  quest beat, including item rewards. Use the relevant progression and balance checks.
- Contacts, lifecycle actions, topic wiring, choice graphs, and story effects follow the relevant
  routes in [story and quests](../../emberdawn-story-and-quests/SKILL.md). A prose-only edit needs
  the narrative skill, not this catalog guidance.

The content-integrity checks in `tests/engine_test.ts` and the relevant subsystem tests cover
references, reachability, and authoring constraints. Persisted-shape or identity changes
additionally use `emberdawn-persistence`.
