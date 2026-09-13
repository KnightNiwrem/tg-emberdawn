---
name: emberdawn-story-and-quests
description: Implement or review Emberdawn quest progression, dialogue navigation, choice authority, or transactional story effects. Excludes prose-only edits.
---

# Emberdawn story and quests

Live PlayerState and content definitions authorize mutations. Preserve scene/contact checks,
transactional story bundles, one-shot receipts, and monotonic terminal outcomes. Read the reference
for the behavior being changed, following its additional links only when that contract is affected:

| Task                                                                                       | Reference                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Quest status, objectives, readiness, acceptance/turn-in contacts, quest log                | [Quest lifecycle](references/quests.md)                 |
| Dialogue graph/navigation, choices, irreversible confirmation, callback intent             | [Dialogue and choice authority](references/dialogue.md) |
| Conditions, decisions/outcomes, effect bundles, draft application, receipts/reconciliation | [Story transactions](references/transactions.md)        |
| NPC offers, turn-ins, active-business and lore topic selection                             | [NPC topics](references/npc-topics.md)                  |
| Fresh-player lesson order, tutorial state/resumption, prologue reward                      | [Guided prologue](references/tutorial.md)               |

For authored wording, use `emberdawn-narrative-writing`. For new structured definitions, use the
relevant content-authoring guidance. Copy changes alone do not require the engine transaction
contract; changes to consequences, staging, or progression do.
