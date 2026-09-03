---
name: emberdawn-story-and-quests
description: Use when changing Emberdawn NPC topics, dialogue, choices, conditions, StoryEffects, receipts, decisions, quest authority, or quest outcomes.
---

# Story, Dialogue, Topics, and Quests — Emberdawn

Operating guide for narrative progression, dialogue scenes, choice authority, transactional story
effects, NPC topic menus, and the physical quest lifecycle.

## 1. Story and Quest Authority Invariant

Story and quest mutations derive identity and authorization strictly from live `PlayerState` and
content definitions, never callback data or caller assertions. Central engine operations revalidate
scene view, dialogue ownership, NPC physical presence, and conditions; story bundles commit
transactionally against a draft clone; retries are suppressed by stable one-shot receipts
(`p.storyReceipts`); and terminal quest outcomes are monotonic.

## 2. Dialogue Scenes & Node Navigation

Authored conversations reside in `src/content/dialogues.ts` (`DialogueDef`):

- Each dialogue defines a stable ID, an owning NPC (`npcId`), a `startNodeId`, and a collection of
  nodes (`kind: 'line' | 'choice'`).
- Lines specify speaker (`npc`, `player`, `narrator`), text, optional sound cue, and an optional
  `next` node pointer. The final line omits `next` and serves as the implicit terminal beat.
- **Scene representation:** The live player scene records
  `p.scene = { view: 'dialogue', arg: dialogueId, arg2: nodeId }`. This allows view rerenders and
  `/start` to reconstruct the exact beat.
- **Node advance:** The `dlg:nx:<targetNodeId>` callback advances exactly one node and edits the
  live message in place. Every tap revalidates:
  1. The player's active scene view is `'dialogue'`.
  2. The active dialogue matches `p.scene.arg`.
  3. The target node matches the current node's authored `next` pointer.
  4. The owning NPC is physically present in `p.currentZone`.
- Returning or exiting navigates back to the owning NPC's topic menu when the NPC is present
  on-site.
- Reopening a dialogue always restarts from `startNodeId`; conversations hold no partial progress.
- Canonical sources & tests: `src/content/dialogues.ts`, `src/engine/story.ts`,
  `tests/dialogue_test.ts`.

## 3. Choice Authority & Confirmation Staging

Interactive choices inside dialogues must be strictly authorized by the engine:

- Wire callbacks (`dlg:<rev>:ch:<choiceId>` and `dlg:<rev>:cf:<choiceId>`) convey only the stamped
  revision and the stable choice ID. Consequence data is never sent over the wire; effects resolve
  purely server-side.
- The central engine operation `applyDialogueChoice` (`src/engine/story.ts`) derives execution
  context from `p.scene`:
  - The active view must be `'dialogue'` (`p.scene.view === 'dialogue'`).
  - The dialogue ID and node ID are extracted directly from `p.scene.arg` and `p.scene.arg2`.
  - The acting NPC is resolved from the dialogue definition (`dialogue.npcId`) and must be
    physically present in `p.currentZone` (`npcInZone`).
  - The tapped choice must belong to the current choice node.
  - Choice availability conditions (`when`) are re-evaluated at application time; rendering
    availability does not grant authority.
- **Irreversible choices** (`irreversible: true`):
  - Require explicit staging via a confirmation panel (`confirm:<choiceId>` stored in
    `p.scene.arg3`).
  - An irreversible choice mutates state only when confirmed from its exact staged state.
  - Ordinary choices refuse execution if any confirmation panel is currently staged.
- **Layer responsibility:**
  - Handlers (`src/handlers/hub.ts`: `dialogueAction`) handle only transport, navigation validation,
    and confirmation staging. Non-confirming actions ("Go back", "Not now", "Leave") clear staging
    without mutating story state.
  - The engine (`src/engine/story.ts`) owns all story mutations and ledger conflict checks.
- Canonical sources & tests: `src/engine/story.ts`, `src/handlers/hub.ts`,
  `tests/choice_authority_test.ts`, `tests/choice_test.ts`.

## 4. Transactional StoryEffect Bundles & Receipts

Consequences of dialogue choices and line entries execute via structured `StoryEffect` bundles
(`src/engine/story.ts`).

### Transactional Bundles

- Bundles execute transactionally against a draft clone of `PlayerState`.
- `validateStoryBundle` validates preconditions against the projected state across all sequential
  operations (for instance, granting an item and subsequently removing it nets to zero; an
  impossible removal refuses the entire bundle).
- `applyStoryEffects` applies the verified bundle atomically.
- Mutating helpers (`removeItem`, `acceptQuest`, `turnInQuest`) report success or failure. Any
  failure rolls back the entire bundle, leaving the live player state byte-for-byte unchanged with
  no receipt recorded.
- Dialogue `startQuest` effects verify on-site starter authority: a dialogue can only start a quest
  whose configured starter NPC is physically present on-site in `p.currentZone`.

### One-Shot Receipts (`p.storyReceipts`)

- Every successfully committed choice or line entry records a stable receipt key:
  - `choice:<dialogueId>:<nodeId>:<choiceId>`
  - `line:<dialogueId>:<nodeId>`
- Replaying a receipted action is a no-op: it cannot duplicate item grants, re-start quests,
  overwrite decisions, or re-trigger notifications. Replaying a choice still routes smoothly to the
  authored next beat.

### Monotonic Terminal Outcomes

Terminal quest outcomes in `p.questOutcomes` are monotonic:

- Outcome kinds: `'resolved' | 'failed' | 'locked'` (`QuestOutcome.kind`).
- A resolved or completed quest cannot transition to locked or failed.
- A locked or failed quest cannot be accepted, started, or resolved.
- One terminal outcome kind never overwrites another.
- Shared objective reconciliation: `beginQuest` in `src/engine/quests.ts` enforces uniform
  reconciliation across all acceptance paths.
- Canonical sources & tests: `src/engine/story.ts`, `src/engine/quests.ts`, `src/engine/types.ts`,
  `tests/story_tx_test.ts`.

## 5. NPC Topic Menus & Routing

Interacting with an NPC opens their topic menu — a pure navigation screen that executes no story
mutations:

- `npcTopics(p, npcId)` in `src/engine/npc.ts` is the single shared resolver for both rendering
  topic menus and authorizing selections.
- Handlers re-resolve the exact topic row (kind and ID) from a fresh call to `npcTopics(p, npcId)`
  at callback tap time. Stale, forged, or condition-hidden selections are rejected without state
  mutation.
- A topic row opens a dialogue only if the selected NPC owns that dialogue
  (`dialogue.npcId === selected NPC`).
- **Active-business policy:** An active quest topic is listed at both contact NPCs as a reminder
  pointer, but the quest's `conversationDialogue` opens only at the NPC who owns that dialogue while
  its story event is pending. At the other contact NPC, the row acts as a pure non-mutating progress
  reminder.
- Canonical sources & tests: `src/engine/npc.ts`, `src/handlers/hub.ts`, `tests/npc_topics_test.ts`.

## 6. Quest State Machine & Physical Contacts

### State Machine Lifecycle

```text
unavailable → available → active → turnIn → done
```

- `syncAvailability(p)` is idempotent; run it after XP gains, zone entries, and quest completions.
  Quests excluded by narrative outcomes (`p.questOutcomes`, `questExcluded`) are never made
  available.
- Kill, zone-reach, and dungeon objectives advance via engine hooks (`onKill`, `onZoneEnter`,
  `onDungeonClear`).
- Conversation objectives advance exclusively through explicit story events (`kind: 'storyEvent'`)
  via `onStoryEvent`. Generic NPC contact, opening topic menus, or accepting quests never
  auto-completes conversation objectives.
- Collection objectives read the player's inventory live.

### Physical Lifecycle Contacts

Every quest defines explicit physical contacts:

- `startNpc`: Offers the quest.
- `finishNpc`: Accepts turn-in and awards completion rewards.
- Both contacts must resolve to real NPCs placed in specific zones (`questStarter`, `questFinisher`,
  `zoneOfNpc`, `npcInZone`).
- Destination quests start in the preceding zone/region and finish with the destination contact.

### Physical Quest Actions

`acceptQuest` and `turnInQuest` require the acting NPC ID and verify:

1. The NPC matches the configured `startNpc` (for acceptance) or `finishNpc` (for turn-in).
2. The NPC is physically present in the player's current zone (`p.currentZone`).
3. Mismatched contacts trigger `contactRefusal` inside the engine; handlers cannot bypass this
   check.

Quest lifecycle flows operate through authored dialogue:

- Every quest defines an `offerDialogue` and a `turnInDialogue`.
- Acceptance and completion choices invoke `acceptQuest` and `turnInQuest` as story effects within
  these dialogues.

### Single Turn-In Announcements

- `refreshQuestProgress()` (`src/engine/quests.ts`) is the sole transition authority from `active`
  to `turnIn`.
- Quest readiness is announced exactly once by the system event that triggered it:
  - Combat victories collect readiness notices via `resolveVictory()`.
  - Zone transitions announce ready quests via arrival notices in `travel()`.
  - Acceptance of immediately completed quests announces readiness through `acceptQuest()` result
    lines.
- Readiness is never re-derived during view rendering and never re-announced for already ready
  quests.

### Read-Only Quest Log

The Quest Log is strictly a read-only journal:

- It renders no acceptance or turn-in buttons.
- The callback codec (`src/codec.ts`) cannot express quest action buttons from the log.
- It displays only the physical contact instructions (e.g., "Start with X — Zone", "Return to Y —
  Zone").

### Quest Drops

Random quest-item drops are capped by relevance (`questDropAllowed`): items drop only while an
active or available quest requires them, and cease dropping permanently once that quest is
completed.

## 7. Narrative Conditions & Decisions

- A unified declarative condition language (`Condition` in `src/content/types.ts`, evaluated by
  `src/engine/conditions.ts`) powers NPC topic availability (`NpcTopicDef.when`), quest
  prerequisites (`QuestDef.prereq`), and dialogue choice availability.
- Decisions made through irreversible choices are permanently recorded in `p.decisions` with choice
  identifiers and timestamp provenance.
