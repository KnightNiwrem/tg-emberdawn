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
          'The Great Flame is the first fire. Its warmth travels through roots, springs, and the hearths our grandparents built above them. It also carries the power to renew things: seed becoming wheat, winter giving way to spring. That is what people mean when they call it the source of dawn.',
        next: 'n2',
      },
      {
        id: 'n2',
        kind: 'line',
        speaker: 'narrator',
        text:
          'Maren turns the ember on its hearthstone. Its light reaches a bowl of seed grain and the maps pinned behind it.',
        next: 'n3',
      },
      {
        id: 'n3',
        kind: 'line',
        speaker: 'npc',
        text:
          'Aldric divided it a century ago. Our hearths kept some warmth, but he took the renewing light into his crown. Day still follows night. Each season gives us less time to grow food, though, and each new fire is harder to light. That is the tomorrow he stole.',
        next: 'n4',
      },
      {
        id: 'n4',
        kind: 'line',
        speaker: 'player',
        text: 'Why ask me to carry the ember?',
        next: 'n5',
      },
      {
        id: 'n5',
        kind: 'line',
        speaker: 'npc',
        text:
          'Because you came to help, and you can still make the journey. Dawncaller is what we call someone who carries hearth-light out to restore its source. No bloodline and no prophecy. Bram will equip you, Lyra will tend you, and I will keep people working here. You do not have to mend the world alone.',
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
          'Six generations of my family kept this forge. My grandfather drew the map of the channels under the village. I used to think keeping the anvil hot was enough. Hard to believe that when a farmer brings in a sound plough and has nothing growing behind it.',
        next: 'n2',
      },
      {
        id: 'n2',
        kind: 'line',
        speaker: 'narrator',
        text:
          'Bram rests a scarred hand on the anvil. Beside it lie a plough fitting, a cooking pot, and an unfinished piece of armor.',
        next: 'n3',
      },
      {
        id: 'n3',
        kind: 'line',
        speaker: 'npc',
        text:
          'The same fire makes all of these. Equipment for your road, tools for the fields, pots for what comes up. Bring me something I can work with and I can do my part. That is how this village has lasted.',
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
          'The keepers can sponsor one task. You can pledge to restore their beacon by defeating Marsh Wisps, or clear Marsh Leeches from the water intake without making a pledge. Either helps the people here. Choose the work you mean to do; I will put that in the book.',
        next: 'n2',
      },
      {
        id: 'n2',
        kind: 'line',
        speaker: 'narrator',
        text:
          'The Ferryman opens the job ledger to two sketches: a lantern above the reeds and a basket sunk at a water intake.',
        next: 'n3',
      },
      {
        id: 'n3',
        kind: 'choice',
        prompt: 'Which job will you take: the beacon or the water intake?',
        choices: [
          {
            id: 'promise',
            label: 'Pledge to restore the beacon',
            when: { questStatus: { questId: 'sq_shrine_pledge', is: 'active' } },
            irreversible: true,
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
            label: 'Clear the intake without a pledge',
            when: { questStatus: { questId: 'sq_shrine_pledge', is: 'active' } },
            irreversible: true,
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
            label: 'Offer my proven help with the beacon',
            when: {
              all: [
                { questStatus: { questId: 'm6_toxin', is: 'done' } },
                { questStatus: { questId: 'sq_shrine_pledge', is: 'active' } },
              ],
            },
            irreversible: true,
            consequenceHint: "Your toxin work earns the keepers' trust.",
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
          'I have written your pledge beside the beacon. Defeat the Marsh Wisps in Hollowmere and report to me. The keepers will give the intake job to someone else. You can collect the planning payment by finishing our first conversation whenever you wish.',
      },
      {
        id: 'n5',
        kind: 'line',
        speaker: 'npc',
        text:
          'The intake, then. Defeat Marsh Leeches in Hollowmere and report to me. No oath required. The keepers will find someone else for the beacon. Our first conversation is also ready to finish; its planning payment is yours.',
      },
      {
        id: 'n6',
        kind: 'line',
        speaker: 'npc',
        text:
          'Your sample work gives them good reason to trust you. I have put you down for the beacon. Defeat the Marsh Wisps in Hollowmere and return here. The intake job goes to someone else; the payment for choosing your assignment is ready as well.',
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
        prompt: 'Would you like directions, or news of the work you finished?',
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
            label: 'Remind me about the intake patrol',
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
            label: 'How is the water intake now?',
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
          'Defeat Marsh Wisps while exploring Hollowmere Swamp. Their light will gather in my lamp. Return to me when the patrol is done and we can decide whether to give it to the crossing beacon.',
      },
      {
        id: 'a3',
        kind: 'line',
        speaker: 'npc',
        text:
          'Defeat Marsh Leeches while exploring Hollowmere Swamp, then report to me. The keepers need the water intake clear enough to clean its filter baskets.',
      },
      {
        id: 'a4',
        kind: 'line',
        speaker: 'npc',
        text:
          'The book says kept. You took the lantern and left the payment; the beacon remains unlit. The keepers will seek another source of light. Their work will take longer, but it is still work they mean to finish.',
      },
      {
        id: 'a5',
        kind: 'line',
        speaker: 'npc',
        text:
          'The beacon is lit. My passengers can find the crossing through the reeds again. The keepers check its wick every evening. You gave them something they can keep tending.',
      },
      {
        id: 'a6',
        kind: 'line',
        speaker: 'npc',
        text:
          'The intake baskets are being cleaned. You did the job and received the pay, with no pledge attached. The people who drink that water care more about the work than the ceremony.',
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
