---
name: emberdawn-story-and-quests
description: Use when changing or reviewing Emberdawn dialogue flow, NPC topic behavior, quest lifecycle, or story authority and effects. For wording-only edits, use emberdawn-narrative-writing.
---

# Emberdawn story and quests

Rules for dialogue flow, NPC topics, choices, story effects, and the quest lifecycle. The root
`AGENTS.md` story-authority invariant applies throughout. Source and test paths in this skill and
its references are relative to the repository root.

## Shared story-authority contract

- Derive story identity and authorization from live `PlayerState` and content definitions. Central
  engine operations revalidate scene, ownership, location, and conditions; callback data and caller
  assertions never grant authority.
- Irreversible choices mutate only from their exact staged confirmation. Keep handler wire intent
  and engine authority consistent.
- StoryEffect bundles run in authored order against projected state and commit atomically. Stable
  receipts prevent repeated mutations and notices; terminal quest outcomes are monotonic.
- `refreshProgress` is the single active-to-turn-in authority. Announce readiness once from the
  reconciled result of the operation that caused it, never by deriving it again during rendering.

## Read for the task

Load the relevant reference or named section; combine routes when the task crosses contracts.

| When changing or reviewing...                                                                                                   | Read                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Quest availability, objectives, readiness notices, drops, acceptance/turn-in, or lifecycle contacts                             | [Quest lifecycle and contacts](references/quests.md)                                                                                |
| Quest-log layout or contact disclosure                                                                                          | [Quest log](references/quests.md#quest-log); use the lifecycle sections when contact resolution or quest behavior is also affected. |
| Dialogue scenes, NPC topic resolution, ownership, active business, or conversation objectives                                   | [Dialogue and NPC navigation](references/dialogue-and-npcs.md)                                                                      |
| Choices, irreversible confirmation, decision provenance, receipts, terminal outcomes, or StoryEffect application/reconciliation | [Choices and story transactions](references/choices-and-transactions.md)                                                            |
| Shared conditions for topics, prerequisites, or choices                                                                         | [Conditions](references/choices-and-transactions.md#conditions); include the affected quest or dialogue route above.                |
| Tutorial lesson order, resume behavior, rewards, or release into the hub                                                        | [Guided prologue](references/tutorial.md)                                                                                           |

For authored prose, load `emberdawn-narrative-writing`. Use the root `AGENTS.md` routes when the
change also affects content definitions, transport/locking, combat, or persisted-state contracts.
