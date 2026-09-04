---
name: emberdawn-story-and-quests
description: Use when changing Emberdawn NPC topics, dialogues, dialogue choices, conditions, StoryEffects, story receipts, decisions, quest lifecycle, quest authority, or quest outcomes.
---

# Emberdawn story and quests

Detailed rules for dialogues, NPC topic menus, choices, story effects, and the quest state machine.
The umbrella invariant in the root `AGENTS.md` applies at all times; this skill carries the
implementation detail behind it.

Authoritative code and tests: `src/engine/story.ts`, `src/engine/quests.ts`, `src/engine/npc.ts`,
`src/engine/types.ts`, `src/engine/conditions.ts`, `src/content/dialogues.ts`,
`src/content/quests.ts`, `src/handlers/hub.ts`, `tests/story_tx_test.ts`,
`tests/choice_authority_test.ts`, `tests/choice_test.ts`, `tests/npc_topics_test.ts`,
`tests/dialogue_test.ts`, `tests/quest_copy_test.ts`.

## Quest state machine

- States: unavailable → available → active → turnIn → done. `syncAvailability` is idempotent; call
  it after xp gains, zone entry, and turn-ins.
- Objectives tick through engine hooks: `onKill`, `onZoneEnter`, `onDungeonClear`; collect
  objectives read the bag live. Conversation progression is explicit story events (see below).
- Every hook returns the quests its event just made turn-in-ready. `refreshProgress()` is the single
  active→turnIn transition authority: readiness is announced exactly once, by the surface that
  caused it. `resolveVictory` collects ready ids from drops, the kill, the availability refresh,
  dungeon bookkeeping, and first-clear rewards, and appends one deduped `questReadyLine`
  (`📜 "<name>" is ready to turn in!` — the one shared formatter) per quest after all of the
  victory's mutations. `travel()` puts it in the arrival lines; the talk interaction and
  `acceptQuest` (whose result carries `lines`, so an immediately-complete quest reports acceptance
  AND readiness) put it in the interaction notices. It is never re-derived at render time and never
  re-announced for an already-`turnIn` quest.
- Random quest-item drops are relevance-capped (`questDropAllowed`): they flow only while an open
  (available or active) quest still needs them, and stop permanently once it is done.

## Quest lifecycle contacts and physical authority

- Every quest carries explicit lifecycle contacts: `startNpc` offers it and `finishNpc` accepts the
  turn-in. Usually the same NPC, but delivery flows hand quests between people (m2_letter: Maren
  starts, Bram finishes). The finisher is never inferred from a talk objective.
- `acceptQuest`/`turnInQuest` take the acting NPC id and require it to be the quest's configured
  starter/finisher AND standing in the player's current zone (`contactRefusal` inside the engine).
  Quest status alone never authorizes, and no handler path can bypass this.
- Both contacts must resolve to real NPCs placed in exactly one zone, and those zones must be
  reachable at the quest's point in the progression (content-integrity tested). Resolve contacts
  through the canonical helpers in `src/content/quests.ts` (`questStarter`/`questFinisher`/
  `zoneOfNpc`/`npcInZone`). There is no quest-log-only fallback: m23_aldric starts and ends with the
  Archivist's throne-room send-off, and sq_locket belongs to Ranger Pell in the Whisperwood.
- Destination quests start in the preceding region and finish with the destination contact, so the
  journey stays the point instead of an arrive-then-accept loop: m5 Bram→Ferryman, m9
  Ferryman→Ombra, m13 Ombra→Rho, m16 Rho→Sorrel, m20 Sorrel→Archivist, m24 Archivist→Echo.
  Intro/outro text speaks as the contact who hands the quest over or receives it.
- Every quest start shares one objective-reconciliation policy: `beginQuest` in
  `src/engine/quests.ts`, the same core `acceptQuest` uses (ever-visited reach targets reconcile
  identically). `startQuest` honors the on-site starter authority: a dialogue can only start a quest
  whose own contact is standing right there, and readiness/rewards reuse the same central
  authorities as every other path.

## Dialogue scenes

- Authored conversations live in `src/content/dialogues.ts` (`DialogueDef`: stable id, owning NPC,
  start node, and a graph of `DialogueNode`s). A node is a `line` (explicit npc/player/narrator
  speaker and an optional `next` link), a `choice` (a prompt with branching `DialogueChoice`s), or
  an `end`.
- The scene persists `(arg: dialogueId, arg2: nodeId)` so rerenders and `/start` reproduce the exact
  current beat.
- Continue (`dlg:nx:<targetNodeId>`) advances exactly one node and edits the same live message —
  never a second message. Every tap revalidates the scene view, the dialogue identity, the current
  node's next link, and the NPC's physical presence.
- Back/End returns to the owning NPC's topic menu when they are still on-site. Reopening a dialogue
  resets scene navigation to its start node; already committed decisions, story effects, events, and
  receipts remain persisted. A final `line` node omits `next` and is the implicit end state.
- Content integrity (`tests/dialogue_test.ts`) covers id uniqueness, references, reachability,
  terminals, topic wiring, and the callback budget.

## Choice authority

- A choice node's responses resolve by stable dialogue/node/choice identity — never by consequence
  data on the wire. `dlg:ch:`/`dlg:cf:` carry the choice id only; effects resolve server-side.
- Application goes through the one central op, `applyDialogueChoice` in `src/engine/story.ts`, which
  derives its context from the player's live scene — never from caller assertions:
  - the scene must be the dialogue view;
  - the dialogue id and current node id come from `p.scene`;
  - the acting NPC is resolved from the dialogue definition (`dialogue.npcId`) and must be
    physically present in the player's current zone;
  - the choice must belong to that current choice node;
  - availability (`when`) re-evaluates at apply time — rendering is never authority;
  - an `irreversible: true` choice mutates only from its exact staged `confirm:<choiceId>` panel
    (scene `arg3`), and an ordinary choice refuses while any confirmation is staged.
- Then: the ledger conflict check (a recorded decision can never be overwritten) → the atomic
  StoryEffect bundle → next node or back to the topic menu.
- The handler layer (`dialogueAction` in `src/handlers/hub.ts`) keeps only transport and navigation
  checks — scene view, the rendered node/choice target, and confirmation staging, which mutates no
  story state. Confirm is the only mutating control; Go back/Not now/Leave never touch it. The
  handler passes the engine exactly the tapped choice id.
- Callback revision and message staleness are transport-level authority, enforced by the locked
  per-player router before any handler runs. The rev guard kills wire-level double taps and replays.
- Every committed application records a one-shot receipt in `p.storyReceipts`. Replaying a receipted
  choice (`choice:<dlg>:<node>:<id>`) or line-entry (`line:<dlg>:<node>`) application is a complete
  no-op: it can never double-grant, double-start, re-lock, or re-notify.
- Shipped irreversible choices are sparing and harmless by design; mutually exclusive content
  requires an explicit `lockQuest` effect.

## Narrative state and story effects

- One declarative condition language (`Condition` in `src/content/types.ts`, evaluated pure in
  `src/engine/conditions.ts`) is shared by NPC topic availability (`NpcTopicDef.when`), quest
  prereqs (`QuestDef.prereq`, ANDed with the legacy `prereqQuest`/`prereqFlags`), and dialogue
  choices. Content integrity validates condition references (`tests/quest_copy_test.ts`).
- Irreversible choices are recorded in `p.decisions` with choice and provenance — never reduced to
  unexplained booleans. A locked or failed quest (`p.questOutcomes`, `questExcluded`) is never
  resurrected by `syncAvailability`.
- Terminal quest outcomes are monotonic: a resolved/completed quest never becomes locked/failed, a
  locked/failed quest never starts or resolves, and one terminal kind never overwrites another.
- Story consequences use the bounded `StoryEffect` vocabulary (`src/engine/story.ts`). Bundles are
  transactional: validation and application are the same ordered run against a draft clone of the
  player (`validateStoryBundle` discards the draft, `applyStoryEffects` commits it once), so every
  effect's preconditions see the projected result of all earlier effects (grant → remove nets to
  zero; an impossible cumulative removal refuses the whole bundle), and any refusal leaves the live
  player byte-for-byte unchanged with no receipt recorded.
- Mutating helpers (`removeItem`, `acceptQuest`, `turnInQuest`) report failure, and a failure
  refuses the bundle — never silently ignored.

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
  (`dialogue.npcId === selected NPC`), and handlers re-resolve the exact row (kind + id) from a
  fresh `npcTopics(p, npcId)` at tap time, so stale, forged, or condition-hidden selections (a lore
  `when` is re-evaluated on selection) refuse without mutation.
- Active-business policy: the row is listed at both contacts as a pointer, but the quest's
  `conversationDialogue` opens only at the NPC who owns it while its event is pending; any other
  contact's row is a pure non-mutating progress reminder. m2_letter can emit `heard_bram_reading`
  only through Bram's own conversation, never from Maren's menu.
- Talking to an NPC surfaces quests they are ready to finish first, then quests they offer.

## Quest log

The quest log is a read-only journal: it renders no lifecycle buttons, the codec cannot even express
`q:a:`/`q:t:`, and it only names the physical contact ("Start with X — Zone." / "Return to Y —
Zone."). Log navigation can never act on a quest.

## Guided prologue

Fresh heroes run a directed prologue before the real hub opens: Elder Maren's ember brief → one
controlled battle vs `e_cinder_mite` (a `tutorial`-flagged level-1 fixture; the balance harness
proves no class can lose it) with contextual coaching inside the live battle (free action → starting
skill/MP → Guard → Items when hurt) → a deterministic ember reward that exits every hero at level 2
→ release into the real hub (Maren's board = m1, Whisperwood, flee/level advice).

- State is `p.tutorial` (`'maren' → 'outskirts' → 'fight' → 'done'`). `/start` resumes the current
  step, tutorial handlers revalidate the step so replays are refused, the uiRev guard kills
  double-taps, and the reward is flag-idempotent.
- During the prologue the zone view renders only the directed action (progressive disclosure —
  travel, explore, shop, and the NPC list are withheld).
