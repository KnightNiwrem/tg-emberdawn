/**
 * Authored conversations (#124/#126/#127). Linear primitives plus choice
 * nodes: one beat per node, explicit speaker, explicit `next`, an end
 * state. The scene persists (dialogueId, nodeId) and Continue advances
 * exactly one node in the existing live message — no extra Telegram
 * messages, ever.
 *
 * Ambient (non-quest) conversations live here; the per-quest offer,
 * conversation and turn-in dialogues live in quest_dialogues.ts. The
 * combined registry is `DIALOGUES` below.
 */

import type { DialogueDef, DialogueNode } from './types.ts';
import { QUEST_DIALOGUES } from './quest_dialogues.ts';

export const DIALOGUES: readonly DialogueDef[] = [
  ...QUEST_DIALOGUES,
  {
    // The representative conversation (#124): NPC speech, narration, and
    // player speech across multiple Continue steps.
    id: 'dlg_maren_flame',
    npcId: 'npc_maren',
    start: 'n1',
    nodes: [
      {
        id: 'n1',
        kind: 'line',
        speaker: 'npc',
        text:
          'You want to know what the Great Flame is, and not the hearth-verse they teach children. Sit, then. It is the oldest fire — every ember in this valley was lit from it, directly or not.',
        next: 'n2',
      },
      {
        id: 'n2',
        kind: 'line',
        speaker: 'narrator',
        text:
          'Maren turns the last ember on its hearthstone so the light falls across the maps on her wall — the village, the wood, the drowned east.',
        next: 'n3',
      },
      {
        id: 'n3',
        kind: 'line',
        speaker: 'npc',
        text:
          'What the Sundered King took was not wood and not oil. You cannot stack what he stole in a vault. He took the mornings we were owed — and folk can live a long time on less and less morning before they forget what it looked like.',
        next: 'n4',
      },
      {
        id: 'n4',
        kind: 'line',
        speaker: 'player',
        text: 'And you think it can be taken back.',
        next: 'n5',
      },
      {
        id: 'n5',
        kind: 'line',
        speaker: 'npc',
        text:
          'I think it was taken, which means someone can carry it back. That is the whole of my arithmetic, Dawncaller. Dim is not dark. Not yet.',
      },
    ],
  },
  {
    id: 'dlg_bram_forge',
    npcId: 'npc_bram',
    start: 'n1',
    nodes: [
      {
        id: 'n1',
        kind: 'line',
        speaker: 'npc',
        text:
          'Six generations of my family have kept this fire, and every edge that ever held a line out there was hammered on this anvil.',
        next: 'n2',
      },
      {
        id: 'n2',
        kind: 'line',
        speaker: 'narrator',
        text: 'He lays one scarred hand flat on the anvil, the way other men touch shrines.',
        next: 'n3',
      },
      {
        id: 'n3',
        kind: 'line',
        speaker: 'npc',
        text:
          'A forge is a promise that tomorrow needs tools. Whatever the dawn turns out to be, someone will have to cut a path to it. That part, I can still do.',
      },
    ],
  },
  {
    // The consequential branch (#132, #147): both committing responses
    // record distinct durable decisions, emit the SAME shared parent event
    // — advancing the pledge parent quest the player already carries —
    // start a different follow-up quest, and permanently lock the
    // incompatible route. Each response is gated on that parent being
    // ACTIVE (#147): the pledge question exists only while the player
    // carries it, re-evaluated at tap time. Both responses are irreversible
    // (each stages an explicit confirmation panel whose hint names the
    // permanent exclusion); deferral ("Not now") stays non-mutating and
    // leaves the parent pending with both routes open. Availability of the
    // route quests is gated by the recorded decision itself (their prereq
    // conditions) — the ledger is the single source of truth, with the
    // explicit locks as the permanent exclusion record.
    id: 'dlg_ferry_promise',
    npcId: 'npc_ferryman',
    start: 'n1',
    nodes: [
      {
        id: 'n1',
        kind: 'line',
        speaker: 'npc',
        text:
          'The shrine folk keep a ledger of who believes in the morning. Names, written down. Want yours in it?',
        next: 'n2',
      },
      {
        id: 'n2',
        kind: 'line',
        speaker: 'narrator',
        text: 'He backs water and lets the ferry drift, waiting on your answer.',
        next: 'n3',
      },
      {
        id: 'n3',
        kind: 'choice',
        prompt: 'So — what do I tell them?',
        choices: [
          {
            id: 'promise',
            label: 'Put me down as a believer',
            when: { questStatus: { questId: 'sq_shrine_pledge', is: 'active' } },
            irreversible: true,
            consequenceHint:
              'The shrine counts on you from now on — and the road of the unwritten name closes for good.',
            effects: [
              { kind: 'recordDecision', id: 'ferry_shrine_pledge', choiceId: 'promise' },
              { kind: 'storyEvent', event: 'shrine_allegiance_chosen' },
              { kind: 'startQuest', questId: 'sq_shrine_pact' },
              { kind: 'lockQuest', questId: 'sq_ledger_debt', reason: 'shrine_route' },
            ],
            next: 'n4',
          },
          {
            id: 'decline',
            label: 'Keep my name off the ledger',
            when: { questStatus: { questId: 'sq_shrine_pledge', is: 'active' } },
            irreversible: true,
            consequenceHint:
              'The debt goes on the books all the same — and the road of the beacon closes for good.',
            effects: [
              { kind: 'recordDecision', id: 'ferry_shrine_pledge', choiceId: 'decline' },
              { kind: 'storyEvent', event: 'shrine_allegiance_chosen' },
              { kind: 'startQuest', questId: 'sq_ledger_debt' },
              { kind: 'lockQuest', questId: 'sq_shrine_pact', reason: 'shrine_route' },
            ],
            next: 'n5',
          },
          {
            // Conditionally available response (#126): earned trust changes
            // what the shrine will hear. Re-evaluated at tap time.
            id: 'vouch',
            label: 'Tell them the swamp already vouches for me',
            when: {
              all: [
                { questStatus: { questId: 'm6_toxin', is: 'done' } },
                { questStatus: { questId: 'sq_shrine_pledge', is: 'active' } },
              ],
            },
            irreversible: true,
            consequenceHint:
              'The shrine counts on you from now on — and the road of the unwritten name closes for good.',
            effects: [
              { kind: 'recordDecision', id: 'ferry_shrine_pledge', choiceId: 'vouch' },
              { kind: 'storyEvent', event: 'shrine_allegiance_chosen' },
              { kind: 'startQuest', questId: 'sq_shrine_pact' },
              { kind: 'lockQuest', questId: 'sq_ledger_debt', reason: 'shrine_route' },
            ],
            next: 'n6',
          },
        ],
      },
      {
        id: 'n4',
        kind: 'line',
        speaker: 'npc',
        text:
          "Then the ledger says so — and it says what comes with it. The shrine's drowned beacon is yours to relight; the unwritten road closed behind you the moment the ink dried. Hold yourself to it.",
      },
      {
        id: 'n5',
        kind: 'line',
        speaker: 'npc',
        text:
          'Fair enough. The water keeps no ledger, but the shrine does — and it writes debts for unwritten names too. Yours is on the books now, and the beacon road closed behind you the moment you turned away.',
      },
      {
        id: 'n6',
        kind: 'line',
        speaker: 'npc',
        text:
          'That they do — you cleaned the runoff the Tyrant left. I will write the strongest line the ledger holds. The beacon is yours to relight, and the unwritten road closed behind you with the ink still wet.',
      },
    ],
  },
  {
    // The ledger's aftermath (#132, #147): opened only once the pledge
    // decision exists, it reacts to the recorded decision AND to each
    // route's current or terminal state — active routes get their guidance,
    // ordinarily completed routes get acknowledgment instead of stale
    // instructions, and the beacon's named "kept" resolution gets the
    // kept-light response without contradictory relighting guidance. Every
    // response is conditionally gated; "Not now" defers, mutates nothing.
    id: 'dlg_ferry_aftermath',
    npcId: 'npc_ferryman',
    start: 'a1',
    nodes: [
      {
        id: 'a1',
        kind: 'choice',
        prompt: "The ledger's open. What do you want of it?",
        choices: [
          {
            id: 'beacon',
            label: 'How do I relight the beacon?',
            when: {
              all: [
                {
                  any: [
                    { decision: { id: 'ferry_shrine_pledge', choiceId: 'promise' } },
                    { decision: { id: 'ferry_shrine_pledge', choiceId: 'vouch' } },
                  ],
                },
                { questStatus: { questId: 'sq_shrine_pact', is: ['active', 'turnIn'] } },
              ],
            },
            next: 'a2',
          },
          {
            id: 'lit',
            label: 'How stands the beacon now?',
            when: {
              all: [
                {
                  any: [
                    { decision: { id: 'ferry_shrine_pledge', choiceId: 'promise' } },
                    { decision: { id: 'ferry_shrine_pledge', choiceId: 'vouch' } },
                  ],
                },
                { questStatus: { questId: 'sq_shrine_pact', is: 'done' } },
                { not: { questOutcome: { questId: 'sq_shrine_pact', kind: 'resolved' } } },
              ],
            },
            next: 'a5',
          },
          {
            id: 'keptlight',
            label: 'What does the ledger say of the light I kept?',
            when: {
              questOutcome: { questId: 'sq_shrine_pact', kind: 'resolved', outcome: 'kept' },
            },
            next: 'a4',
          },
          {
            id: 'debt',
            label: 'What does the shrine expect of me?',
            when: {
              all: [
                { decision: { id: 'ferry_shrine_pledge', choiceId: 'decline' } },
                { questStatus: { questId: 'sq_ledger_debt', is: ['active', 'turnIn'] } },
              ],
            },
            next: 'a3',
          },
          {
            id: 'paid',
            label: 'How do the books read now?',
            when: {
              all: [
                { decision: { id: 'ferry_shrine_pledge', choiceId: 'decline' } },
                { questStatus: { questId: 'sq_ledger_debt', is: 'done' } },
              ],
            },
            next: 'a6',
          },
        ],
      },
      {
        id: 'a2',
        kind: 'line',
        speaker: 'npc',
        text:
          'The drowned shrine holds the beacon, and the marsh wisps smother its flame. Lay them to rest and carry their light back. The shrine will know its own again.',
      },
      {
        id: 'a3',
        kind: 'line',
        speaker: 'npc',
        text:
          "Nothing holy — only what is owed. Leeches have grown fat on the shrine's seep. Cull them, and the books balance.",
      },
      {
        id: 'a4',
        kind: 'line',
        speaker: 'npc',
        text:
          'It writes: light retained, debt forgiven. The beacon waits for a kinder hand. Walk warm, Dawncaller — the ledger does not begrudge you the glow.',
      },
      {
        id: 'a5',
        kind: 'line',
        speaker: 'npc',
        text:
          'It reads clean. The beacon took the wisp-light for its first breath, and the shrine writes you as the one who fed it. That page dries warm.',
      },
      {
        id: 'a6',
        kind: 'line',
        speaker: 'npc',
        text:
          'Even. The leeches are out of the seep and the books read even. No name was ever written, but the shrine marks the debt paid all the same.',
      },
    ],
  },
];

const DIALOGUE_INDEX = new Map(DIALOGUES.map((d) => [d.id, d]));

export function dialogue(id: string): DialogueDef | undefined {
  return DIALOGUE_INDEX.get(id);
}

export function dialogueNode(d: DialogueDef, nodeId: string): DialogueNode | undefined {
  return d.nodes.find((n) => n.id === nodeId);
}
