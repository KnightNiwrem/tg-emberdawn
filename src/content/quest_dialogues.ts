/**
 * Per-quest offer, conversation and turn-in dialogues (#127): every quest's
 * acceptance and completion beats are authored dialogue nodes. Acceptance
 * happens ONLY at the offer's accept choice (a central `acceptQuest` story
 * effect with the #63/#64 on-site authority); the hand-over happens ONLY at
 * the turn-in dialogue's hand-over choice (a central `turnInQuest` story
 * effect).
 *
 * Dialogue copy contract (#133): the renderer owns speech presentation —
 * prompts, labels and lines are stored WITHOUT surrounding quotation
 * marks; every choice node exposes at most one non-mutating exit (the
 * renderer's "Not now" deferral — no authored duplicates); one node carries
 * one complete speech or stage-direction beat (no "X says." attribution
 * fragments); and no line before a committing choice asserts that choice's
 * effects — post-commit narration hangs off `choice.next`.
 *
 * m2's conversation advances its delivery by emitting the stable story
 * event `heard_bram_reading` at the authored reading node; the three
 * counsel quests (m8/m17/m22) emit their events at the authored accept
 * choice — acceptance IS the conversation. The legacy single-box
 * `intro`/`outro` strings were migrated into these nodes beat by beat and
 * retired from QuestDef.
 */

import type { DialogueDef } from './types.ts';

export const QUEST_DIALOGUES: readonly DialogueDef[] = [
  {
    id: 'dlg_m1_embers_offer',
    npcId: 'npc_maren',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Maren looks to the fields.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          'Ember-rats have come down from the ash to gnaw at the hearth-roads. Thin them out, so the village keeps heart enough to hope. The Outskirts, just past the fields — and mind the boar.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you carry this for us?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm1_embers' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m1_embers_turnin',
    npcId: 'npc_maren',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'npc',
        text:
          "You've bought us quiet nights. This goes to Bram. The road you'll walk starts at his forge.",
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'She holds out a wax-sealed letter.',
        next: 'ta',
      },
      {
        id: 't3',
        kind: 'line',
        speaker: 'narrator',
        text: 'She presses the letter into your hands.',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Is the work done, then?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the quiet roads',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm1_embers' }],
            next: 't3',
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m3_wolves_offer',
    npcId: 'npc_maren',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'The wolves grow bold as the Flame dims. They were the first to feel the rot, out under the Whisperwood. Thin the packs, so the wood keeps heart enough to hope.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you carry this for us?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm3_wolves' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m3_wolves_turnin',
    npcId: 'npc_maren',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'npc',
        text:
          'Quiet returns to the treeline. The wood remembers kindness slowly — but it does remember.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Is the work done, then?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the thinned packs',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm3_wolves' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m4_floors_offer',
    npcId: 'npc_warden_tom',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'Keep to the paths. The silk-broods and their sprite-kin are feeding the Hollow. Cut them down at the threshold, before you think of going deeper.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Can I count on you?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm4_floors' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m4_floors_turnin',
    npcId: 'npc_warden_tom',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'npc',
        text:
          "Threshold's holding. Deeper's worse. The Hollow's heart has a keeper now — and it isn't kind. Ready yourself.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Report: is it done?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the threshold held',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm4_floors' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m5_arms_offer',
    npcId: 'npc_bram',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Bram weighs the chunks in his palm.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          "The Hollow's heart will not fall to a rusty edge. Mycelids carry good iron in their husks — bring me two chunks, and I'll see you descend armed like a Dawncaller, not a dawdler.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Do we have a bargain?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm5_arms' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m5_arms_turnin',
    npcId: 'npc_bram',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Bram sets the forge roaring.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'There. Steel worth the name, priced fair, on my rack — take your pick before you descend. You will not get a kinder offer closer to the dark.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Done, then?',
        choices: [
          {
            id: 'handover',
            label: '⚒️ Hand over the iron',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm5_arms' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m3_roots_offer',
    npcId: 'npc_bram',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Bram arms you properly.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          "Follow the warm roots into the Hollow. Cut loose what's choking them, and the wood will remember how to grow.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Do we have a bargain?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm3_roots' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m3_roots_turnin',
    npcId: 'npc_bram',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text:
          "The Hollow's silk slackens and greys. Warmth seeps back into the roots like blood into a numb limb — the wood exhales, and somewhere above, a bud opens out of season.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Done, then?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the Hollow cleansed',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm3_roots' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m4_blessing_offer',
    npcId: 'npc_bram',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          "The wood bleeds ember-shards where the rot was cut. Bring me enough, and I'll hammer them into a keepsake that carries a promise: the light isn't gone, only scattered.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Do we have a bargain?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm4_blessing' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m4_blessing_turnin',
    npcId: 'npc_bram',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Bram holds out his hands for the shards.',
        next: 'ta',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text:
          'Bram quenches the shard-steel with a hiss that sounds like relief, and presses the finished keepsake into your hand.',
        next: 't3',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Done, then?',
        choices: [
          {
            id: 'handover',
            label: '🔥 Hand over the ember shards',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm4_blessing' }],
            next: 't2',
          },
        ],
      },
      {
        id: 't3',
        kind: 'line',
        speaker: 'npc',
        text:
          "The swamp east carries the same rot — and maybe another piece of the dawn. Go when you're ready.",
      },
    ],
  },
  {
    id: 'dlg_m5_fen_offer',
    npcId: 'npc_bram',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'East of the wood the water turns dark and thoughtful. A man still poles a ferry through the Hollowmere fen. Roads that drowned still lead somewhere — go find the piece of tomorrow the swamp kept warm.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'narrator',
        text: 'He nods at the keepsake cooling on its cord.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Do we have a bargain?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm5_fen' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m5_fen_turnin',
    npcId: 'npc_ferryman',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'The Ferryman poles you across black water.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          "You're for the Shrine, then. Everybody who still believes in morning is, eventually.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall we call it square?',
        choices: [
          {
            id: 'handover',
            label: '🛶 Say the crossing is made',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm5_fen' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m6_toxin_offer',
    npcId: 'npc_ferryman',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          "Leeches carry the toxin whole. Fetch samples. What can be named can be countered — and what's countered makes room for something better.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Do we cross together?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm6_toxin' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m6_toxin_turnin',
    npcId: 'npc_ferryman',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'npc',
        text:
          "That's the brew. Drained from the Flame's runoff. The Tyrant didn't poison the swamp — he claimed its despair. Take that claim back.",
        next: 'ta',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'He uncorks one vial and holds it to the light.',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall we call it square?',
        choices: [
          {
            id: 'handover',
            label: '🧪 Hand over the samples',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm6_toxin' }],
            next: 't2',
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m7_tyrant_offer',
    npcId: 'npc_ferryman',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'The Shrine drowns slowly. Hope drowns faster. Go down and raise something before the water finishes the job.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Do we cross together?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm7_tyrant' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m7_tyrant_turnin',
    npcId: 'npc_ferryman',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text:
          "Vosk deflates with a sound like a dying bell. The water around the Shrine clears a hand's breadth — the first clean light in years, and the frogs sing like it's spring.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall we call it square?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the Tyrant fallen',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm7_tyrant' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m8_passage_offer',
    npcId: 'npc_ferryman',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          "Word travels faster than boats. There's a city of gears east — Sunspire. A cult there is bottling hours. Whoever holds the hours holds the future.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Do we cross together?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm8_passage' }, {
              'kind': 'storyEvent',
              'event': 'heard_ferrymans_word',
            }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m8_passage_turnin',
    npcId: 'npc_ferryman',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'npc',
        text:
          'Take the east road. And mind the sentinels. They only remember half their orders — the half worth keeping, with luck.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall we call it square?',
        choices: [
          {
            id: 'handover',
            label: '🤝 Say the word is heard',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm8_passage' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m9_spire_offer',
    npcId: 'npc_ferryman',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'You heard my word about the gears — now go stand under them. A Curator keeps honest ledgers in a dishonest city. Show him the swamp still sends believers east.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'narrator',
        text: 'He poles for the far shore.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Do we cross together?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm9_spire' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m9_spire_turnin',
    npcId: 'npc_curator',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Curator Ombra looks you over like an acquisition.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'Good. The Vault steals time from the Flame — tomorrow, measured in hours. Its keeper must be taught that futures belong to the living.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall I close the ledger?',
        choices: [
          {
            id: 'handover',
            label: '🏛️ Report the spire reached',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm9_spire' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m10_cult_offer',
    npcId: 'npc_curator',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          "They call it devotion. It's despair wearing hymns — kneeling to a sun they've decided never rises for anyone else. Thin their ranks until the singing stops.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Shall I enter you in the ledger?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm10_cult' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m10_cult_turnin',
    npcId: 'npc_curator',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text:
          'The hymns have stopped. The desert wind sounds almost like rest — and real pilgrims, the hopeful kind, begin drifting back toward the ruins.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall I close the ledger?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the hymns stopped',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm10_cult' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m11_toll_offer',
    npcId: 'npc_curator',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          "The Vault only opens for its own key. The automatons carry it. Break them, and we wind tomorrow's door open.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Shall I enter you in the ledger?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm11_toll' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m11_toll_turnin',
    npcId: 'npc_curator',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'The last automaton folds with a sound like a struck hour.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall I close the ledger?',
        choices: [
          {
            id: 'handover',
            label: '🗝️ Report the toll paid',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm11_toll' }],
            next: 't2',
          },
        ],
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text:
          'A key of cold gold light sits in the wreckage — the Sunspire Key, and it is warm on one side only. The side that faces morning.',
      },
    ],
  },
  {
    id: 'dlg_m12_chronolich_offer',
    npcId: 'npc_curator',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Ombra turns the Sunspire Key over once and hands it back.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          'The Vault keeps its own ledger, and the door collects its due from a fight that is WON — not from one merely begun. Go down. End the hour that stole itself, and give the stolen hours back.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Shall I enter you in the ledger?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm12_chronolich' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m12_chronolich_turnin',
    npcId: 'npc_curator',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text:
          "The Chronolich's hourglass shatters, and stolen time pours out — hours return to the Flame in a ribbon of light. Ombra nods once.",
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          "North. The flame's twin sleeps in Frostpeak. Wake it, and winter gets an ending too.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall I close the ledger?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the hour returned',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm12_chronolich' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m13_pass_offer',
    npcId: 'npc_curator',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          "North. Frostpeak keeps the flame's twin under blue ice, and an outcast named Rho keeps watch over the pass — the mountain froze everyone else's promises but his. Wake what winter only pretended to bury.",
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'narrator',
        text: 'Ombra closes the Vault’s ledger behind you.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Shall I enter you in the ledger?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm13_pass' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m13_pass_turnin',
    npcId: 'npc_outcast',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Rho eyes your weapons.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          "You'll want more than iron where you're going. But hear me: the Maw doesn't guard the Frostfire. It guards its dreaming — and dreams are worth waking carefully.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Finished?',
        choices: [
          {
            id: 'handover',
            label: '🏔️ Report the pass crossed',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm13_pass' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m14_emblem_offer',
    npcId: 'npc_outcast',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'The wraiths were wardens once. They froze mid-oath, still believing. Their marks still open old roads. Three, and the way to the Maw is yours.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'You up for it?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm14_emblem' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m14_emblem_turnin',
    npcId: 'npc_outcast',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Rho holds out his hands for the emblems.',
        next: 'ta',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'Rho aligns the emblems, and the ice remembers a door.',
        next: 't3',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Finished?',
        choices: [
          {
            id: 'handover',
            label: '❄️ Hand over the emblems',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm14_emblem' }],
            next: 't2',
          },
        ],
      },
      {
        id: 't3',
        kind: 'line',
        speaker: 'npc',
        text: 'The Maw is open. What sleeps inside — wake it gently. Some futures start as dreams.',
      },
    ],
  },
  {
    id: 'dlg_m15_wyrm_offer',
    npcId: 'npc_outcast',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'narrator',
        text:
          'The Maw breathes around you. Deep in the blue, a heartbeat made of ice — and coiled around it, the wyrm.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'You up for it?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm15_wyrm' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m15_wyrm_turnin',
    npcId: 'npc_outcast',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text:
          'Jormunis uncoils one last time, and the Frostfire rises free — streaming through the mountain toward the Cinder Wastes. Winter, it turns out, was never the enemy. It was a promise waiting to thaw.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Finished?',
        choices: [
          {
            id: 'handover',
            label: '🔥 Report the Frostfire freed',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm15_wyrm' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m16_ashes_offer',
    npcId: 'npc_outcast',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'South of the glacier the world burned and stubbornly kept going. The Cinder Wastes hide a monk named Sorrel, tending a starving flame nobody else would feed. Tell him the Frostfire lives — proof travels better than hope alone.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'You up for it?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm16_ashes' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m16_ashes_turnin',
    npcId: 'npc_ashen',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Sorrel finds you before the imps do.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          "You came with the Frostfire's wake. Then you're the one Ignivar's been burning to meet. Follow me — hope travels light, but you'll want company anyway.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'May we call this mercy done?',
        choices: [
          {
            id: 'handover',
            label: '🌋 Report the Wastes crossed',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm16_ashes' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m17_plea_offer',
    npcId: 'npc_ashen',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'Listen before you swing. Ignivar guarded the Flame for a thousand years. Then the Sundered King began drinking it, and everyone blamed the hunger on the guardian. Despair is easy. Listen harder.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you walk this road with me?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm17_plea' }, {
              'kind': 'storyEvent',
              'event': 'heard_sorrels_plea',
            }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m17_plea_turnin',
    npcId: 'npc_ashen',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'npc',
        text:
          "He'll fight you anyway. Pride burns hotter than starvation. But when he falls — and he will — know that the true thief is above the sky, in a tower that isn't entirely real. And that endings here have always been doorways.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'May we call this mercy done?',
        choices: [
          {
            id: 'handover',
            label: '🕯️ Say the plea is heard',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm17_plea' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m18_sigil_offer',
    npcId: 'npc_ashen',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          "The revenants are the Flame's old faithful. Their sorrow brands the ash with sigils. Bring me three — grief, honored, becomes a lamp. That's how we calm the Caldera.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you walk this road with me?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm18_sigil' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m18_sigil_turnin',
    npcId: 'npc_ashen',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Sorrel holds out her hands for the sigils.',
        next: 'ta',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'The sigils cool in Sorrel’s hands.',
        next: 't3',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'May we call this mercy done?',
        choices: [
          {
            id: 'handover',
            label: '🔥 Hand over the sigils',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm18_sigil' }],
            next: 't2',
          },
        ],
      },
      {
        id: 't3',
        kind: 'line',
        speaker: 'npc',
        text:
          "The Caldera's throat is open. Go down gently. He's been waiting to be understood for a very long time — and being understood is its own dawn.",
      },
    ],
  },
  {
    id: 'dlg_m19_ignivar_offer',
    npcId: 'npc_ashen',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'narrator',
        text:
          "At the caldera's bottom, the Last Flame gutters in a cage of its own cinders. It looks up. It is so tired — and still, stubbornly, burning.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you walk this road with me?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm19_ignivar' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m19_ignivar_turnin',
    npcId: 'npc_ashen',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text:
          "Ignivar's last ember drifts free — and instead of dying, it funnels upward, toward a spire that stands where the sky has a seam.",
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text: 'The thief. The Umbral Spire. Go finish this — not for vengeance. For morning.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'May we call this mercy done?',
        choices: [
          {
            id: 'handover',
            label: '🕯️ Report the flame freed',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm19_ignivar' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m20_seam_offer',
    npcId: 'npc_ashen',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'The thief keeps a tower in the seam of the sky. An Archivist stacks his yesterdays up there and calls the pile a future. Climb, Dawncaller — make the man remember what hours are FOR.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you walk this road with me?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm20_seam' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m20_seam_turnin',
    npcId: 'npc_archivist',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: "The Archivist's pen never stops moving.",
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'The King split the Flame because he stopped believing in morning. Despair, hoarded, becomes a crown. Mend the crown, and belief comes home.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall the record show it complete?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the climb done',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm20_seam' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m21_loyalty_offer',
    npcId: 'npc_archivist',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          "They were knights once. Now they're the King's habit, still fighting his wars. Give them rest — even loyalty deserves a future.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will the record show you willing?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm21_loyalty' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m21_loyalty_turnin',
    npcId: 'npc_archivist',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text:
          'The last of the Crownsworn kneels as it falls — not to you, but to some old, remembered king, finally let go. The stair to the throne is clear.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall the record show it complete?',
        choices: [
          {
            id: 'handover',
            label: '⚔️ Say the Crownsworn rest',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm21_loyalty' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m22_umbral_key_offer',
    npcId: 'npc_archivist',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'The Crownsworn carried a key out of habit, but grief was the only lock. Before you climb — let me tell you what the last king chose to forget.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will the record show you willing?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm22_umbral_key' }, {
              'kind': 'storyEvent',
              'event': 'heard_archivists_counsel',
            }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m22_umbral_key_turnin',
    npcId: 'npc_archivist',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'npc',
        text: 'The door was never locked, only mourned shut.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text:
          'The throne room doors swing inward on a room split down the middle — half ember, half ash, and one thin line of light running down the seam.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall the record show it complete?',
        choices: [
          {
            id: 'handover',
            label: '📜 Say the counsel is taken',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm22_umbral_key' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m23_aldric_offer',
    npcId: 'npc_archivist',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'The stair is clear and the hour is yours. Up there sits a man who decided a hundred years ago that morning was a rumor. Do not hate him — out-wait him. Crowns break where patience will not.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'narrator',
        text: 'The Archivist’s pen is motionless for the first time.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will the record show you willing?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm23_aldric' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m23_aldric_turnin',
    npcId: 'npc_archivist',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'The Archivist waits among the settling light, pen still.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall the record show it complete?',
        choices: [
          {
            id: 'handover',
            label: '👑 Report the crown whole',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm23_aldric' }],
            next: 't2',
          },
        ],
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text:
          "The crown halves meet in your hands with a sound like a held breath released. Light runs down the Spire, through the Seam, into every ember in the world — and the Flame roars back to life not as it was, but as it could be. Somewhere far below, the village of Emberdawn lights its lamps without knowing why, and children sleep dreaming of mornings they've never seen. But the Seam below the world is still open, and the future is worth guarding.",
      },
    ],
  },
  {
    id: 'dlg_m24_below_offer',
    npcId: 'npc_archivist',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          "The sundering opened a seam beneath the world. Echoes drift down it — everyone who ever sought the crown, still climbing, still believing. One of them wears Maren's face. Go down and bear witness: the future is worth guarding, even from below.",
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'narrator',
        text: 'The Archivist’s pen is still, at last.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will the record show you willing?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm24_below' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m24_below_turnin',
    npcId: 'npc_echo',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Echo of Maren smiles like sunrise through water.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'Even I end up an echo here, it seems. Go on then, Dawncaller — the dark down there has never once met anyone like you.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Can we call it done, hero?',
        choices: [
          {
            id: 'handover',
            label: '🌅 Say the Abyss is witnessed',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm24_below' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m25_silence_offer',
    npcId: 'npc_echo',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          "The Warden doesn't threaten. It doesn't need to. The dark at the Seam's bottom arranges itself, patient as arithmetic. Rest, sharpen, and go down when you can carry the morning back up.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you go where I cannot?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm25_silence' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m25_silence_turnin',
    npcId: 'npc_echo',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text:
          "The silence, when it comes, is gentle. The Seam closes like a book finishing itself — not an ending; a period before the next sentence. Above, the world's flame burns steady, and this time, nobody is drinking it. You came looking for tomorrow. You're standing in it.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Can we call it done, hero?',
        choices: [
          {
            id: 'handover',
            label: '🌙 Report the silence kept',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm25_silence' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_rats_offer',
    npcId: 'npc_lyra',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Lyra sighs.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text: "Rats in the grain, rats at the wood's edge. Six fewer would be medicinal.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you help me mend this?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_rats' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_rats_turnin',
    npcId: 'npc_lyra',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'npc',
        text: 'Cleaner streets and calmer granaries. The village thanks you.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Are the granaries quiet?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the granaries quiet',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_rats' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_ore_offer',
    npcId: 'npc_bram',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text: 'Iron runs under the Whisperwood. Three chunks and I can keep your edge honest.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Do we have a bargain?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_ore' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_ore_turnin',
    npcId: 'npc_bram',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Bram holds out a scarred palm.',
        next: 'ta',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text: "Good stock. Now we're cooking.",
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Done, then?',
        choices: [
          {
            id: 'handover',
            label: '⚒️ Hand over the ore',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_ore' }],
            next: 't2',
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_charm_offer',
    npcId: 'npc_lyra',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'The dimming frightens the children. Ember shards make good luck-charms. Four would do.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you help me mend this?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_charm' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_charm_turnin',
    npcId: 'npc_lyra',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Lyra holds out her hands for the shards.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'All handed over?',
        choices: [
          {
            id: 'handover',
            label: '🔥 Hand over the shards',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_charm' }],
            next: 't2',
          },
        ],
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'The charms go up over doorways one by one. The village glows a little prouder.',
      },
    ],
  },
  {
    id: 'dlg_sq_locket_offer',
    npcId: 'npc_pell',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Ranger Pell sharpens a knife that has seen this argument before.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          "A spider took more than my blood. Took my mother's locket. Eight spiders' worth of persuasion should get it back.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Coming, or not?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_locket' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_locket_turnin',
    npcId: 'npc_pell',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Pell waits at the wood’s edge, saying nothing.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Done?',
        choices: [
          {
            id: 'handover',
            label: '🧿 Say it is recovered',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_locket' }],
            next: 't2',
          },
        ],
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text:
          "The locket, scratched but whole. Pell doesn't say thank you. Rangers never do. But the nod lasts longer than words.",
      },
    ],
  },
  {
    id: 'dlg_sq_stag_offer',
    npcId: 'npc_warden_tom',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Warden Tom builds a small cairn.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text: "That stag guarded the wood before I did. Whatever's riding it now — end it kindly.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Can I count on you?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_stag' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_stag_turnin',
    npcId: 'npc_warden_tom',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'The stag falls like a laid-down burden. Tom adds a second cairn stone.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text: 'Rest now, old friend.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Report: is it done?',
        choices: [
          {
            id: 'handover',
            label: '⚰️ Report the stag at rest',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_stag' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_boglins_offer',
    npcId: 'npc_ferryman',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text: 'Boglins travel in numbers and opinions. Reduce both.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Do we cross together?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_boglins' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_boglins_turnin',
    npcId: 'npc_ferryman',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'npc',
        text: 'Quieter water already. Should hold a week. Maybe two.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'He poles past, eyes already downriver.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall we call it square?',
        choices: [
          {
            id: 'handover',
            label: '🌊 Report the water quieter',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_boglins' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_hags_offer',
    npcId: 'npc_ferryman',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'The hags sing at night. Their songs stick to your ribs. Five silences, and the swamp sleeps.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Do we cross together?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_hags' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_hags_turnin',
    npcId: 'npc_ferryman',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'The night goes quiet. Even the frogs seem grateful.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall we call it square?',
        choices: [
          {
            id: 'handover',
            label: '🌙 Report the night silent',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_hags' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_scarabs_offer',
    npcId: 'npc_curator',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          "Scarabs strip the clockwork for gold. A dozen fewer, and the city's heart can beat again.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Shall I enter you in the ledger?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_scarabs' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_scarabs_turnin',
    npcId: 'npc_curator',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'npc',
        text: 'The gears turn easier.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'Ombra sounds almost pleased.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall I close the ledger?',
        choices: [
          {
            id: 'handover',
            label: '⚙️ Report the swarm broken',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_scarabs' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_lynx_offer',
    npcId: 'npc_curator',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'The lynx were pets of the old astronomers. Their children hunt pilgrims now. Six of them, and the roads open.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Shall I enter you in the ledger?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_lynx' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_lynx_turnin',
    npcId: 'npc_curator',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Ombra records six strokes in a ledger that has seen everything.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text: 'The roads thank you, in their way.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall I close the ledger?',
        choices: [
          {
            id: 'handover',
            label: '🐾 Report the roads open',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_lynx' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_wraiths_offer',
    npcId: 'npc_outcast',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text: 'They froze mid-oath, all of them. Eight unkept promises, wandering. Unstick them.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'You up for it?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_wraiths' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_wraiths_turnin',
    npcId: 'npc_outcast',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Eight oaths, released. The pass feels lighter, like a held breath let go.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Finished?',
        choices: [
          {
            id: 'handover',
            label: '🕯️ Report the oaths released',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_wraiths' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_yetis_offer',
    npcId: 'npc_outcast',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text: "Yetis respect two things. Size and consequences. You're not big. Be convincing.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'You up for it?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_yetis' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_yetis_turnin',
    npcId: 'npc_outcast',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text:
          'The last yeti goes down — and the rest of the snowbank decides, loudly, to be elsewhere.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text: 'Four arguments. Yours carried more weight.',
        next: 't3',
      },
      {
        id: 't3',
        kind: 'line',
        speaker: 'narrator',
        text: 'Rho watches the snow settle.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Finished?',
        choices: [
          {
            id: 'handover',
            label: '🏔️ Report the yetis convinced',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_yetis' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_imps_offer',
    npcId: 'npc_ashen',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text: "Imps are the Flame's hiccups. Fourteen fewer hiccups, and the Wastes breathe.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you walk this road with me?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_imps' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_imps_turnin',
    npcId: 'npc_ashen',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'The ash falls a little softer. Sorrel takes it as a good omen.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'May we call this mercy done?',
        choices: [
          {
            id: 'handover',
            label: '🔥 Report the hiccups cured',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_imps' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_salamanders_offer',
    npcId: 'npc_ashen',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'Salamanders herd travelers into lava. Old instinct, no malice in it. Break eight of the herds and the paths stay open.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you walk this road with me?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_salamanders' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_salamanders_turnin',
    npcId: 'npc_ashen',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'npc',
        text: 'The lava stays hungry, but it dines alone now.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'May we call this mercy done?',
        choices: [
          {
            id: 'handover',
            label: '🌋 Report the herds broken',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_salamanders' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_shades_offer',
    npcId: 'npc_archivist',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text: 'Shades fear names. Yours is spoken by whatever you wield. Same thing, down here.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will the record show you willing?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_shades' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_shades_turnin',
    npcId: 'npc_archivist',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: "Fifteen names, given by force. The Spire's dark recedes a polite distance.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Shall the record show it complete?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the shades named',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_shades' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_echoes_offer',
    npcId: 'npc_echo',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'Every echo was somebody. Ten honors, hero. Give them what they never got: an ending.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you go where I cannot?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_echoes' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_echoes_turnin',
    npcId: 'npc_echo',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Ten echoes, honored. The Abyss feels almost like a place where stories end well.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Can we call it done, hero?',
        choices: [
          {
            id: 'handover',
            label: '⚰️ Report the honors given',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_echoes' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_null_offer',
    npcId: 'npc_echo',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text: 'The hounds hunt echoes. Unfair, even down here. Quiet fifteen of them.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you go where I cannot?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_null' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_null_turnin',
    npcId: 'npc_echo',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'The hounds fall silent. The echoes get to keep their memories a while longer.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Can we call it done, hero?',
        choices: [
          {
            id: 'handover',
            label: '🐾 Report the hounds quiet',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_null' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m2_letter_offer',
    npcId: 'npc_maren',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'narrator',
        text: 'The sealed letter sits warm where Maren pressed it.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          "Everything the letter says, I trust to your hands alone. Bram's forge was the last to touch the Great Flame. If tomorrow can be found, his fire knows where to look.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you carry this for us?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'm2_letter' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_m2_letter_talk',
    npcId: 'npc_bram',
    start: 'c1',
    nodes: [
      {
        id: 'c1',
        kind: 'line',
        speaker: 'narrator',
        text:
          'Bram takes the sealed letter, cracks the wax with his thumb, and reads. Hope flickers across his face like a struck flint.',
        next: 'c2',
      },
      {
        id: 'c2',
        kind: 'line',
        speaker: 'npc',
        text:
          "The Flame isn't just dying — its tomorrow was stolen and scattered. The Whisperwood roots still carry warmth. Follow it. Find where the light went.",
        effects: [{ 'kind': 'storyEvent', 'event': 'heard_bram_reading' }],
      },
    ],
  },
  {
    id: 'dlg_m2_letter_turnin',
    npcId: 'npc_bram',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'Bram holds out his hand for the letter.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Do we have a bargain?',
        choices: [
          {
            id: 'handover',
            label: '✉️ Hand over the letter',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm2_letter' }],
            next: 't2',
          },
        ],
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          "The letter goes in the drawer of things that matter — the one I open on hard days. What Maren sealed, we've both read now, and the road is the same road.",
      },
    ],
  },
  // ══ The shrine-pledge routes (#132) ═════════════════════════════════
  // sq_shrine_pact and sq_ledger_debt start directly from the Ferryman's
  // ledger conversation (dlg_ferry_promise) — they are never offered as
  // menu topics. These offer dialogues exist as the lifecycle wiring every
  // quest carries; the turn-in dialogues are the real completion beats.
  // sq_shrine_pact's turn-in carries the game's authored alternate
  // resolution: the player may keep the wisp-light, resolving the quest
  // with the named outcome "kept" (no reward) instead of turning it in.
  {
    id: 'dlg_sq_shrine_pact_offer',
    npcId: 'npc_ferryman',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text: "The pact is in the ledger — the drowned beacon's light is yours to return.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you take up the beacon?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_shrine_pact' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_shrine_pact_turnin',
    npcId: 'npc_ferryman',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'The Ferryman reads the clean air around you and nods slowly.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          "The wisps are quiet, and their light rides with you — the shrine felt every one go out. Given, it becomes the beacon's first breath. Kept, it stays yours on the road. The ledger writes either name.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'So which is it?',
        choices: [
          {
            id: 'handover',
            label: '🕯️ Return the light to the shrine',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_shrine_pact' }],
            next: 't3',
          },
          {
            id: 'keep',
            label: '🔥 Keep the light for the road',
            irreversible: true,
            consequenceHint:
              'The shrine\'s reward stays behind — the light is yours, and the ledger writes "kept" permanently.',
            effects: [{ 'kind': 'resolveQuest', 'questId': 'sq_shrine_pact', 'outcome': 'kept' }],
            next: 't4',
          },
        ],
      },
      {
        id: 't3',
        kind: 'line',
        speaker: 'npc',
        text:
          'Given, then. Watch the drowned flame catch it — the beacon breathes, and the shrine pays what it owes.',
      },
      {
        id: 't4',
        kind: 'line',
        speaker: 'npc',
        text:
          'Kept, then. The ledger writes: light retained. The beacon waits for another hand — no refund, and no resentment. Walk warm.',
      },
    ],
  },
  {
    id: 'dlg_sq_ledger_debt_offer',
    npcId: 'npc_ferryman',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text: 'The unwritten name is on the books all the same — the shrine expects its due.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you settle the debt?',
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_ledger_debt' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_ledger_debt_turnin',
    npcId: 'npc_ferryman',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'narrator',
        text: 'The Ferryman counts your tally against a knot in his line.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          "Fat on the shrine's seep, every one. The books read even again — and a shrine out of debt can afford to be generous with its own.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Is the debt settled, then?',
        choices: [
          {
            id: 'handover',
            label: '📜 Settle the debt with the shrine',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_ledger_debt' }],
          },
        ],
      },
    ],
  },
];
