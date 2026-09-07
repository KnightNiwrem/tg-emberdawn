---
name: emberdawn-story-and-quests
description: Use when changing Emberdawn NPC topics, dialogues, dialogue choices, conditions, StoryEffects, story receipts, decisions, quest lifecycle, quest authority, or quest outcomes.
---

# Emberdawn story and quests

Detailed rules for dialogues, NPC topic menus, choices, story effects, and the quest state machine.
The umbrella invariant in the root `AGENTS.md` applies at all times; this skill carries the
implementation detail behind it.

Authoritative code and tests: `src/engine/story.ts`, `src/engine/quests.ts`, `src/engine/npc.ts`,
`src/engine/types.ts`, `src/engine/conditions.ts`, `src/content/types.ts`,
`src/content/dialogues.ts`, `src/content/quest_dialogues.ts`, `src/content/quests.ts`,
`src/engine/world.ts`, `src/handlers/hub.ts`, `tests/story_tx_test.ts`,
`tests/choice_authority_test.ts`, `tests/choice_test.ts`, `tests/npc_topics_test.ts`,
`tests/dialogue_test.ts`, `tests/quest_copy_test.ts`, `tests/tutorial_test.ts`.

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
  victory's mutations. `arriveAt()` puts it in the arrival lines; the dialogue interaction puts it
  in the interaction notices. It is never re-derived at render time and never re-announced for an
  already-`turnIn` quest.
- Random quest-kind item drops are relevance-capped (`questDropAllowed`) to the largest matching
  collect requirement among available, active, or turnIn quests. They stop when the bag reaches that
  cap or no open quest needs the item. Completing one quest does not block drops another open quest
  needs; materials and consumables are not capped.

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

## Choice authority

- A choice node's responses resolve by stable dialogue/node/choice identity — never by consequence
  data on the wire. `dlg:ch:`/`dlg:cf:` carry the choice id only; effects resolve server-side.
- Application goes through the one central op, `applyDialogueChoice` in `src/engine/story.ts`, which
  derives its context from the player's live scene — never from caller assertions:
  - the scene must be the dialogue view;
  - the dialogue id and current node id come from `player.scene`;
  - the acting NPC is resolved from the dialogue definition (`dialogue.npcId`) and must be
    physically present in the player's current zone;
  - the choice must belong to that current choice node;
  - availability (`when`) re-evaluates at apply time — rendering is never authority;
  - an `irreversible: true` choice mutates only from its exact staged panel
    (`scene.confirmation === choiceId`), and an ordinary choice refuses while any confirmation is
    staged.
- Then: the ledger conflict check (a recorded decision can never be overwritten) → the atomic
  StoryEffect bundle → next node or back to the topic menu.
- The handler layer (`dialogueAction` in `src/handlers/hub.ts`) keeps only transport and navigation
  checks — scene view, the rendered node/choice target, confirmation staging (a scene mutation,
  never story state), and the ch/cf wire-intent contract (#136): `ch` applies an ordinary choice but
  only stages the panel for an irreversible one, and `cf` is honored solely for an irreversible
  choice from its exact staged confirmation panel — a forged or mismatched `cf` is a non-mutating
  refusal. On an irreversible-choice confirmation panel, only Confirm commits story effects; Go
  back/Not now/Leave perform navigation only. Ordinary choices apply directly, and Continue can
  enter a line with authored effects. The handler passes the engine exactly the tapped choice id.
- Callback revision and message staleness are transport-level authority, enforced by the locked
  per-player router before any handler runs. The rev guard kills wire-level double taps and replays.
- Every committed application records a one-shot receipt in `player.storyReceipts`. Replaying a
  receipted choice (`choice:<dlg>:<node>:<id>`) or line-entry (`line:<dlg>:<node>`) application
  never repeats its story mutations or notices. A receipted choice may still return its authored
  next node for navigation; entering that node honors its own effect receipt. Journey/dungeon guards
  still run before receipt handling, independently of the router's revision and message guards.
- Use irreversible choices sparingly and disclose permanent consequences. Mutually exclusive quest
  branches use explicit `lockQuest` effects.

## Narrative state and story effects

- One declarative condition language (`Condition` in `src/content/types.ts`, evaluated pure in
  `src/engine/conditions.ts`) is shared by NPC topic availability (`NpcTopicDef.when`), quest
  prerequisites (`QuestDef.prereq`), and dialogue choices. Quest availability and level-locked
  guidance share story eligibility, including permanent exclusions; the numeric `level` requirement
  stays separate. A flag condition without `equals` tests existence, including false/0 values.
  Content integrity validates condition references (`tests/quest_copy_test.ts`).
- Quest terminal state is queryable (#132): the `questOutcome` condition matches a quest's permanent
  resolution in `player.questOutcomes` by terminal kind and/or named outcome. Semantics: ordinary
  `turnInQuest` completion persists NO outcome entry (query completion with `questStatus: 'done'`);
  only `resolveQuest` persists a named outcome, and the RUNTIME refuses any named resolution the
  target quest does not declare (#146): a quest with no `outcomes` list accepts no named resolution
  at all, a value outside the list is refused, and the persisted-identity gate refuses a
  same-version save whose resolved record names an outcome the quest does not declare. A named
  outcome exists ONLY on a `resolved` record (#150): failed/locked records never carry one, a save
  that does is refused, and an outcome condition matches resolved records even when it omits `kind`.
  The shipped exemplar is the Ferryman's shrine-pledge branch (#147): a pledge PARENT quest
  (`sq_shrine_pledge`) is accepted from the Ferryman BEFORE the pledge exists, and the committing
  responses in `dlg_ferry_promise` (each gated on that parent being active) record distinct
  decisions, emit the same shared event — advancing the already-active parent objective — start one
  route quest (`sq_shrine_pact`/`sq_ledger_debt`), and lock the other. Route quests never carry a
  retroactively filled duplicate objective to stand in for parent progress. `beginQuest` still
  credits an already-fired story event to a starting quest's storyEvent objective (the reach
  ever-visited policy's counterpart) for any content that relies on it.
- `irreversible: true` requires staged confirmation; it does not itself record a decision. Choices
  that need a queryable decision ledger entry author `recordDecision`, which stores choice identity
  and provenance in `player.decisions`. Provenance is validated EXACTLY (#150): the
  persisted-identity gate accepts a decision only when its `(dialogue, node, choice)` tuple is one
  that authored a matching `recordDecision` for that id — individually resolvable components are not
  enough — and `recordDecision` is authored only on choice nodes (content integrity rejects
  line-node authorship). A locked or failed quest (`player.questOutcomes`, `questExcluded`) is never
  resurrected by `syncAvailability`.
- Terminal quest outcomes are monotonic: a resolved/completed quest never becomes locked/failed, a
  locked/failed quest never starts or resolves, and one terminal kind never overwrites another.
- Story consequences use the bounded `StoryEffect` vocabulary defined in `src/content/types.ts` and
  applied in `src/engine/story.ts`. Bundles are transactional: validation and application are the
  same ordered run against a draft clone of the player (`validateStoryBundle` discards the draft,
  `applyStoryEffects` commits it once), so every effect's preconditions see the projected result of
  all earlier effects (grant → remove nets to zero; an impossible cumulative removal refuses the
  whole bundle), and any refusal leaves the live player byte-for-byte unchanged with no receipt
  recorded. Both entry points share the application receipt (#137): after journey/dungeon guards, an
  already-committed bundle validates successfully and applies without repeated story mutations or
  notices. The returned `StoryResult` describes the final committed draft: `readyQuests` is
  deduplicated and reconciled to quests still `turnIn` at commit, while `startedQuests` is a
  transition log (a later effect may have resolved or turned in a listed quest — read
  `player.quests` for final state).
- Lifecycle reconciliation priority (#145): this is a RESULT-reconciliation priority, not a pipeline
  of execution phases. Effects still run in authored order against the draft (#129), and the single
  `active → turnIn` authority (`refreshProgress`, #119) still flips quests the moment a causal
  effect completes them — a later `turnInQuest` in the same bundle depends on seeing that projected
  readiness. What the priority governs is what the COMMITTED RESULT may claim: exclusion beats
  readiness (an explicit lock/fail of an already-STARTED quest — active/turnIn at transaction entry
  — cancels it with exactly one canonical `questCancelledLine` notice and clears its stale progress;
  an unaccepted quest closes silently), availability promotion is silent, and readiness is announced
  only for quests still `turnIn` in the final draft. `acceptQuest`/`turnInQuest` report readiness as
  structured ids (`ready`), never sentences — "ready to turn in" is formatted only from the
  reconciled result. A bundle that starts/accepts AND locks/fails the same quest refuses atomically
  as contradictory content (in either order); starting route A while locking a different route B
  stays valid.
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

## Quest log

The quest log is a read-only journal: it renders no lifecycle buttons, the codec cannot even express
`q:a:`/`q:t:`, and it only names the physical contact ("Start with X — Zone." / "Return to Y —
Zone."). Log navigation can never act on a quest.

## Guided prologue

Fresh heroes run a directed prologue before the real hub opens: Elder Maren's ember brief → one
controlled battle vs `e_cinder_mite` (a `tutorial`-flagged level-1 fixture) → the ember reward →
release into the real hub. The engine enforces basic action → skill → Guard → item lesson beats in
order and prevents victory until they are complete. A scripted nonlethal hit after Guard makes the
item lesson reachable. Coaching explains the current beat inside the live battle;
`tests/tutorial_test.ts` checks the flow across classes. The balance harness checks sampled fights
under its configured policy, not every possible action sequence. The reward tops up heroes to at
least level 2 and replaces the lesson's potion. Release guidance points to Maren's Sparks of Trouble
quest, the Outskirts, and later Whisperwood travel, with level, flee, road-event, and safe-haven
advice.

- State is `player.tutorial` (`'maren' → 'outskirts' → 'fight' → 'done'`). `/start` resumes the
  current step, tutorial handlers revalidate the step so replays are refused, the uiRev guard kills
  double-taps, and the reward is flag-idempotent.
- During the prologue the zone view renders only the directed action (progressive disclosure —
  travel, explore, shop, and the NPC list are withheld).
