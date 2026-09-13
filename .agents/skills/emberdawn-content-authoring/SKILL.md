---
name: emberdawn-content-authoring
description: Add or change Emberdawn structured content definitions, progression, acquisition, or economy. Excludes prose-only edits.
---

# Emberdawn content authoring

Content is pure declarative data with construction/lookup helpers. Preserve the root `AGENTS.md`
contracts for imports, current ID resolution, release phase, and generated mechanical summaries. Use
the references for the affected content family:

| Task                                                                  | Reference                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Catalog IDs, enemies/items/skills, zones/dungeons, quest wiring       | Relevant section of [catalog requirements](references/catalogs.md)   |
| Shops, drops, forge, gathering, rewards, progression or skill cadence | Relevant section of [economy and progression](references/economy.md) |
| Roads, facilities, geographic progression                             | [World topology](../../../docs/world-topology.md)                    |
| Quest-conditioned encounter selection                                 | [Quest encounter assistance](../../../docs/quest-encounters.md)      |

The story is about seeking hope for a future. The player is a Dawncaller; the Sundered King hoards
tomorrow, and each chapter recovers dawn. Chapter flags are `chapter1Done`…`chapter6Done`; Aldric's
dungeon first-clear sets `crownRestored`. For authored prose, use `emberdawn-narrative-writing`.
Permanent exclusions and forfeited rewards must be stated plainly.
