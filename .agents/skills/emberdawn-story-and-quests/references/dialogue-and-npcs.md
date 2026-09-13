# Dialogue and NPC navigation

Authoritative code and tests: `src/engine/npc.ts`, `src/engine/story.ts`, `src/engine/types.ts`,
`src/content/types.ts`, `src/content/dialogues.ts`, `src/content/quest_dialogues.ts`,
`src/handlers/hub.ts`, `tests/npc_topics_test.ts`, `tests/dialogue_test.ts`,
`tests/dialogue_copy_test.ts`, `tests/quest_copy_test.ts`.

For choices, confirmation, line-entry effects, or story-event emission, also read
[Choices and story transactions](choices-and-transactions.md). When changing topic predicates, read
its [Conditions](choices-and-transactions.md#conditions) section. For acceptance/turn-in contacts or
objective reconciliation, also read [Quest lifecycle and contacts](quests.md).

## Dialogue scenes

- Quest offers, conversations, and turn-ins live in `src/content/quest_dialogues.ts`; ambient
  conversations and the combined registry live in `src/content/dialogues.ts`. A `DialogueDef` has a
  stable id, owning NPC, start node, and a graph of `DialogueNode`s. A node is a `line` (explicit
  npc/player/narrator speaker and an optional `next` link), a `choice` (a prompt with branching
  `DialogueChoice`s), or an `end`.
- The scene persists `dialogueId` and `nodeId` so rerenders and `/start` reproduce the exact current
  beat.
- Dialogue copy follows the #133 contract (machine-checked in `tests/dialogue_copy_test.ts`, prose
  guide in `docs/narrative-guide.md` §3a): the renderer owns speech presentation, so prompts, labels
  and speech are stored unquoted; every choice node defers at most once (the renderer's "Not now" —
  never an authored duplicate); one node is one complete beat (no "X says." attribution fragments);
  and nothing before a committing choice narrates that choice's effects — post-commit beats hang off
  `choice.next`.
- Continue (`dlg:nx:<targetNodeId>`) advances exactly one node and edits the same live message —
  never a second message. Every tap revalidates the scene view, the dialogue identity, the current
  node's next link, and the NPC's physical presence.
- Back/End returns to the owning NPC's topic menu when they are still on-site. Reopening a dialogue
  resets scene navigation to its start node; already committed decisions, story effects, events, and
  receipts remain persisted. A final `line` node omits `next` and is the implicit end state.
- Content integrity (`tests/dialogue_test.ts`) covers id uniqueness, references, reachability,
  terminals, topic wiring, and the callback budget.

## NPC topic menus

- Talking to an NPC opens the topic menu — pure navigation that performs no story mutation. Every
  valid topic (ready turn-ins, offers, active business, authored lore) is enumerated by the pure
  resolver `src/engine/npc.ts` and revalidated at tap time.
- Quest lifecycle flows live in authored dialogue: every quest carries an `offerDialogue` and a
  `turnInDialogue` (content-integrity mandatory) whose accept/hand-over choices invoke the central
  `acceptQuest`/`turnInQuest` authorities as story effects, with the dialogue's NPC as the acting
  contact, revalidated on-site inside the engine.
- Conversation objectives are stable story events (`Objective kind: 'storyEvent'`): reaching the
  authored node (or confirming the authored choice) emits the event through `onStoryEvent`. Opening
  menus, selecting topics, and generic NPC contact never advance anything. The legacy `talk`
  objective kind and same-NPC acceptance auto-completion are retired; no dialogue quest ever demands
  a second identical interaction.
- Topics are bound to their owning NPC: the resolver row is the single authority for both rendering
  and selection. Each row carries the dialogue it opens only when the selected NPC owns it
  (`dialogue.npcId === selected NPC`). At tap time, handlers re-resolve a fresh
  `npcTopics(player, npcId)` by non-lore + quest id or lore + topic id; quest callbacks do not
  encode the offer/active/turn-in subtype. Missing or condition-hidden selections refuse without
  story mutation, and the router independently rejects stale rendered buttons before the handler
  runs.
- Active-business policy: the row is listed at both contacts as a pointer, but the quest's
  `conversationDialogue` opens only at the NPC who owns it while its event is pending; any other
  contact's row is a pure non-mutating progress reminder. m2_letter can emit `heard_bram_reading`
  only through Bram's own conversation, never from Maren's menu.
- Talking to an NPC surfaces quests they are ready to finish first, then quests they offer.
