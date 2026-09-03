/**
 * Authored multi-node conversations (#124). Linear primitives only: one
 * beat per node, explicit speaker, explicit `next`, an end state. Choice
 * nodes and consequences arrive with #125/#126. The scene persists
 * (dialogueId, nodeId) and Continue advances exactly one node in the
 * existing live message — no extra Telegram messages, ever.
 */

import type { DialogueDef, DialogueNode } from './types.ts';

export const DIALOGUES: readonly DialogueDef[] = [
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
];

const DIALOGUE_INDEX = new Map(DIALOGUES.map((d) => [d.id, d]));

export function dialogue(id: string): DialogueDef | undefined {
  return DIALOGUE_INDEX.get(id);
}

export function dialogueNode(d: DialogueDef, nodeId: string): DialogueNode | undefined {
  return d.nodes.find((n) => n.id === nodeId);
}
