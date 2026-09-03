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
    // The representative branching conversation (#126): two conditionally
    // presented responses, both emitting the same shared story event while
    // recording distinct durable decisions; one is irreversible and stages
    // an explicit confirmation; deferral ("Not now") is always available.
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
            label: '“Put me down as a believer.”',
            irreversible: true,
            consequenceHint: 'The shrine will count on you from now on.',
            effects: [
              { kind: 'recordDecision', id: 'ferry_shrine_pledge', choiceId: 'promise' },
              { kind: 'storyEvent', event: 'shrine_allegiance_chosen' },
              { kind: 'setFlag', id: 'shrine_pledge' },
            ],
            next: 'n4',
          },
          {
            id: 'decline',
            label: '“Keep my name off the ledger.”',
            effects: [
              { kind: 'recordDecision', id: 'ferry_shrine_pledge', choiceId: 'decline' },
              { kind: 'storyEvent', event: 'shrine_allegiance_chosen' },
            ],
            next: 'n5',
          },
          {
            // Conditionally available response (#126): earned trust changes
            // what the shrine will hear. Re-evaluated at tap time.
            id: 'vouch',
            label: '“Tell them the swamp already vouches for me.”',
            when: { questStatus: { questId: 'm6_toxin', is: 'done' } },
            effects: [
              { kind: 'recordDecision', id: 'ferry_shrine_pledge', choiceId: 'vouch' },
              { kind: 'storyEvent', event: 'shrine_allegiance_chosen' },
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
          'Then the ledger says so. Belief written down outlives belief merely felt — that is the whole trick of records. Hold yourself to it.',
      },
      {
        id: 'n5',
        kind: 'line',
        speaker: 'npc',
        text:
          'Fair enough. The water keeps no ledger either. The offer stands — the swamp is patient with believers and unbelievers alike.',
      },
      {
        id: 'n6',
        kind: 'line',
        speaker: 'npc',
        text:
          'That they do — you cleaned the runoff the Tyrant left. Names I write for folk like you are the ones the shrine trusts to stay written.',
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
