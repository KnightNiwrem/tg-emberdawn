# Choices and story transactions

Authoritative code and tests: `src/engine/story.ts`, `src/engine/quests.ts`,
`src/engine/conditions.ts`, `src/engine/types.ts`, `src/content/types.ts`,
`src/content/quest_dialogues.ts`, `src/handlers/hub.ts`, `tests/story_tx_test.ts`,
`tests/choice_authority_test.ts`, `tests/choice_test.ts`, `tests/quest_copy_test.ts`.

Choice confirmation below includes both handler wire intent and engine authority. For changes to
scene or topic navigation, also read [Dialogue and NPC navigation](dialogue-and-npcs.md). For quest
lifecycle, contact resolution, or objective hooks, also read
[Quest lifecycle and contacts](quests.md).

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

### Conditions

- One declarative condition language (`Condition` in `src/content/types.ts`, evaluated pure in
  `src/engine/conditions.ts`) is shared by NPC topic availability (`NpcTopicDef.when`), quest
  prerequisites (`QuestDef.prereq`), and dialogue choices. Quest availability and level-locked
  guidance share story eligibility, including permanent exclusions; the numeric `level` requirement
  stays separate. A flag condition without `equals` tests existence, including false/0 values.
  Content integrity validates condition references (`tests/quest_copy_test.ts`).

### Quest outcomes and decisions

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

### StoryEffect transactions and result reconciliation

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
