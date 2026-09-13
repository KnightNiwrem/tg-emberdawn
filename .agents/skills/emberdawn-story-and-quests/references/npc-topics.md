# NPC topic resolution

Implementation: `src/engine/npc.ts` and `src/handlers/hub.ts`; checks: `tests/npc_topics_test.ts`.
For contact/lifecycle changes, use [quest lifecycle](quests.md); for dialogue navigation, use
[dialogue](dialogue.md).

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
