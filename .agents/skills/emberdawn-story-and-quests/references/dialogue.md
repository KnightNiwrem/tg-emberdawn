# Dialogue navigation and choice authority

Implementation: `src/engine/story.ts`, `src/handlers/hub.ts`, and `src/content/dialogues.ts`. For
prose-only changes, use `emberdawn-narrative-writing`. Changes to effect application/receipts also
use [story transactions](transactions.md).

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
