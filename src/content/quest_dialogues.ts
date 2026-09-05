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
        text: 'Maren sets a scorched seed sack on the hearthstone.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          'We have enough grain for supper or for sowing. We need both. Ember Rats are burning through the seed sacks in the Outskirts. Defeat the ones feeding there, then come back to me. Bram and I have a plan for the failing hearth, but first we must keep the village fed.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you protect the seed grain in the Outskirts?',
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
          'You have given the farmers room to repair their stores. I have a letter for Bram about the warmth beneath the Whisperwood. He knows the old channels that carried fire to our hearth. Will you give me your report?',
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
        text: 'She presses the letter into your hands. The seal bears a small rising sun.',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on the Ember Rats?',
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
          'Bram has told me about the blocked hearth channel. Warden Tom can guide you to its source, but Grey Wolves have taken the forest paths. Their usual prey is dying in the cold. Defeat the packs threatening travelers in the Whisperwood and report back before you go deeper.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you clear the Grey Wolves from the forest paths?',
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
          'The woodcutters have brought their first load home without an escort. Thank you. Warden Tom waits in the Whisperwood. Tell him you are looking for the blocked channel beneath the Rootbound Hollow.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Can I record the wolf patrol finished?',
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
          'The warm roots meet under the Rootbound Hollow. Aranya has webbed them shut. Her Woodfang Spiders and the Thistle Sprites drive us off the approach. Defeat them in the Whisperwood first. I lost two rangers down there. I will not send you in unprepared.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you clear the spiders and sprites from the approach?',
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
          'You have made a working gap in their patrols. Aranya still holds the chamber below. Go back to Bram in the village for supplies before you ask him about the descent.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on both patrols?',
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
        text: 'Bram tips an empty ore bin toward you with his boot.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          "The Hollow needs better equipment than most travelers bring. Its first chambers hold old iron caches, and Mycelid Drones carry ore in their husks. Please bring me two chunks. I'll pay for the iron and stock stronger work for you to buy. The ore is your contribution; there is no coin fee for this job.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you bring the iron for my next batch?',
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
        text: 'Bram holds out both scarred hands.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to hand over the iron for the new stock?',
        choices: [
          {
            id: 'handover',
            label: '⚒️ Hand over the iron',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm5_arms' }],
            next: 't2',
          },
        ],
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'Bram sets the forge roaring.',
        next: 't3',
      },
      {
        id: 't3',
        kind: 'line',
        speaker: 'npc',
        text:
          'There. Stronger equipment is on my rack, ready to buy. The payment for your iron will help with the cost. Choose what suits you, then ask me about Aranya and the Rootbound Hollow.',
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
        text: 'Bram unrolls a stained map beside the forge.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          'Aranya has wrapped the channel in silk and filled it with her brood. That is why the village hearth is cold while the buried roots still burn. Descend the Rootbound Hollow in the Whisperwood and defeat her in its deepest chamber. Come back to me when the channel is free.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you defeat Aranya and release the trapped warmth?',
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
          'Bram holds his palm above the forge vent. For the first time since you met him, he has to draw it back.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Is Aranya defeated and the root channel clear?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the Hollow cleansed',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm3_roots' }],
            next: 't2',
          },
        ],
      },
      {
        'id': 't2',
        'kind': 'line',
        'speaker': 'npc',
        'text':
          'The channel is flowing. Now we need to keep the village hearth steady while you travel. Ask me about Ember Shards; I can use them to finish the repair.',
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
          "The channel runs warm again. Now I need Ember Shards to keep our hearth lit while you are away. The creatures in the fields and Whisperwood carry them. Bring them here; I'll set some into the hearth and strike a Lucky Coin from the rest. Then we can look beyond our own doorstep.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you bring the shards to secure the village hearth?',
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
        text: 'Bram sets a shallow tray beside the hearth for your Ember Shards.',
        next: 'ta',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text:
          'Bram fits the shards around the hearth vent, then stamps the remaining metal into a Lucky Coin. He ties it on a cord and gives it to you.',
        next: 't3',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to give the shards to the hearth and forge?',
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
          "The hearth can hold while you travel. Our channel runs east into Hollowmere, where the shrine has gone silent. Ask me about the road into the fen. I'll mark Mirefoot Landing as well; you can rest there.",
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
          'Our channel continues east beneath Hollowmere. The Sunken Shrine once kept that water warm enough to feed the fields. Find the Ferryman in Hollowmere Swamp; he still knows the drowned roads. Go through the Whisperwood. Mirefoot Landing offers a dry place to rest on the way.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'narrator',
        text: 'Bram follows the eastward channel on his map with a blunt fingernail.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you find the Ferryman in Hollowmere?',
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
        text: 'The Ferryman draws his boat alongside the landing where you wait.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'Warmth in the village again? That is good news. Here it pools beneath a shrine nobody can use. Vosk holds the waterworks, and the fen is poisoning itself. Start with the water. I have a job that may tell us how to help.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: "You came from Bram's forge. Ready to tell me what happened there?",
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
          'The village channel empties into this fen. Its warmth has nowhere to go since Vosk took the shrine and stopped its sluices. Marsh Leeches carry the poison in their bodies. Bring me samples from them. I can compare the toxin with the water around the shrine and find the source.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you collect the leech samples for me?',
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
          'Keep those samples sealed until I have a tray ready. If they match the shrine water, we will know where the poison starts.',
        next: 'ta',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text:
          'He uncorks a sample beside a jar of shrine water. Both leave the same black stain on the tray. The Ferryman sets out clean bottles of antidote for you.',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to hand over the Toxin Samples?',
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
          'The samples match. Vosk has dammed the warm spring under the Sunken Shrine and sells the only clean water back to the people here. Go through the shrine and defeat him. The keepers can reopen the sluices once he is gone. Report to me when they have their chance.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you defeat Vosk in the Sunken Shrine?',
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
          'The Ferryman lowers a white cup into the current. A narrow stream of clear water runs through the brown.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: "Will you report Vosk's defeat to the shrine keepers?",
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
          "Ombra, the curator in Sunspire, sent a request with the last boat. The city's clocks are drawing light out of this same channel and storing it underground. Freeing our water will not stop that theft. Ombra needs someone who can reach the Vault of Hours. Will you hear the route?",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: "Will you take Ombra's request and discuss the east road?",
        choices: [
          {
            id: 'accept',
            label: '🤝 Hear the route to Sunspire',
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
          'Follow the road east from Hollowmere to the Sunspire Ruins. Find Curator Ombra among the broken sundials. I can mark the firm ground on your map. Once we finish here, ask me about the journey to the city.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready for me to mark the road to Sunspire?',
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
          'Ombra asked for help, and you know why. Follow the east road to the Sunspire Ruins and find the curator by the sundials. Tell Ombra the shrine water is flowing again. Then ask what those clocks are taking from it.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'narrator',
        text: 'The Ferryman points beyond the reeds toward a broken line of towers.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you carry our news to Curator Ombra?',
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
        text: 'Curator Ombra sets aside a broken clock as you approach.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'The water reaches us clearer now. Thank you. The old city once spread daylight through the hearth channels; its Vault now stores it for Aldric. The Chronolich keeps that machinery running, and the Sun Cult guards it. We must reach the machinery.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Will you tell me what you restored in Hollowmere?',
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
          'The Sun Cult promised its followers daylight when everyone else went dark. Its patrols now seize water and food from travelers to supply the Vault. Defeat the Sun Cultists in the ruins. Breaking those patrols gives the relief caravans a chance to reach us.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you break the cult patrols in the ruins?',
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
          'Ombra unrolls a list of caravans beside a map of the causeway. Several names have fresh arrival marks.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report the cult patrols defeated?',
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
          'I have the Sunspire Key. The Brass Automatons outside the Vault would sound the alarm before you could use it. Defeat their patrol in the ruins, then report here. I will issue the key once the approach is secure. You will not find it in their wreckage.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you disable the Brass Automaton patrol?',
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
        text: 'Ombra lays a small key case beside the patrol map. Its clasp remains shut.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Is the automaton patrol defeated?',
        choices: [
          {
            id: 'handover',
            label: '🗝️ Report the patrol and receive the key',
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
          "Ombra opens the case and gives you the Sunspire Key. Its teeth follow the pattern of a clock's escapement.",
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
        text: "Ombra points to the keeper's chamber on a plan of the Vault.",
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          "The Chronolich was Aldric's keeper of calendars. It stores daylight in its hourglass so the King can choose who gets another morning. Enter the Vault of Hours and defeat it. Breaking its hold will return the stored light to the hearth channels. The Sunspire Key opens the keeper's seal.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you face the Chronolich in the Vault of Hours?',
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
          "The hands of Ombra's clock move past the mark where they always stopped. Sunlight reaches a covered seed tray beside the desk.",
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'The light is returning to the channel. Yet the northern branch remains cold. It leads to Frostpeak, where the wardens tended the Frostfire. Speak with me about the mountain road when you are ready to go on.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report the stored hours released?',
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
          'The old maps show another branch of the Great Flame beneath Frostpeak. The wardens called it Frostfire: the warmth that lets roots survive winter and wake in spring. Daylight has returned, but the pass stays frozen. Go north to Ice-Outcast Rho. Rho sent the last warning before the road closed.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'narrator',
        text: 'Ombra lays the northern survey beside the Vault plan.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you investigate the Frostfire with Rho?',
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
        text: 'Rho brushes snow from a place beside the watch fire.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'So daylight is moving again. Up here, even sunlit snow stays frozen. Jormunis has coiled around the Frostfire and will not release it. I can help you reach the Glacier Maw, but first I need to recover the route marks my fellow wardens carried.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: "Will you tell me what happened to Sunspire's clocks?",
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
          'Those Frost Wraiths were my fellow wardens. They stayed on watch when Jormunis froze the pass. Their emblems bear the marks of the old route into the Glacier Maw. Release them in battle and bring me the emblems. I can read the route and give their families names to mourn.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: "Will you recover the lost wardens' Frost Emblems?",
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
        text: "Rho spreads a cloth beside the fire for the wardens' emblems.",
        next: 'ta',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'Rho reads the names on the emblems and lays them beside a worn route chart.',
        next: 't3',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to entrust the Frost Emblems to me?',
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
        text:
          'This marks the descent. I will send the names down to their families when a caravan comes. Ask me about Jormunis before you enter the deepest chamber. The wyrm was a guardian once; it still thinks it is protecting the fire.',
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
        speaker: 'npc',
        text:
          'Jormunis coils around the Frostfire in the deepest chamber of the Glacier Maw. The wyrm was meant to shelter it through winter. With the seasons failing, it never loosened its grip. You must defeat Jormunis to free the fire. Its fear has buried a whole valley in ice.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you face Jormunis and free the Frostfire?',
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
          "Water drips from Rho's shelter roof. Rho catches a drop on one finger and looks toward the glacier.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report the Frostfire released?',
        choices: [
          {
            id: 'handover',
            label: '🔥 Report the Frostfire freed',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm15_wyrm' }],
            next: 't2',
          },
        ],
      },
      {
        'id': 't2',
        'kind': 'line',
        'speaker': 'npc',
        'text':
          'The spring is running beneath the glacier again. It has uncovered the road into the Cinder Wastes. I need you to take word to Sorrel there; ask me about the journey when you are ready.',
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
          'The thaw has uncovered the road into the Cinder Wastes. Follow it to Ashen Monk Sorrel. Sorrel tends Ignivar, the guardian at the source of these channels. Tell him the Frostfire is moving again. If the source is still failing, he will know what is draining it.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you take news of the thaw to Sorrel?',
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
        text: 'Sorrel waves you toward the shelter of a ruined kiln.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          "A thaw at last. The fire in my kiln answered it this morning. Ignivar is still starving, though. The King's binding keeps drawing from the source. Before you prepare for the Caldera, hear what happened to its guardian.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Will you tell me what Rho saw at the glacier?',
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
          'Ignivar guarded the Great Flame long before Aldric was born. When the King split it, he bound its source to his crown. Ignivar has been trying to feed both the land and that endless drain. We blamed the guardian for the ruined harvests. I did too. I stayed to put that wrong right.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you hear how Ignivar can be freed?',
        choices: [
          {
            id: 'accept',
            label: '🕯️ Hear how to free Ignivar',
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
          "Ignivar's body has hardened around the royal binding. He attacks anyone who approaches it. You will have to break that shell in battle; his living ember can survive outside it. The binding will lead us to Aldric. I will stay here to tend what remains of the guardian.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Do you understand why Ignivar must be faced?',
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
          "Ashen Revenants carry the Cinder Sigils of our old order. They died trying to feed the Flame and still repeat the journey. Release them and bring me their sigils. I will name the dead at the kiln and prepare a fire for Ignivar's ember. He must have somewhere to return to.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you recover the Cinder Sigils for the vigil?',
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
        text: 'Sorrel places an empty bowl on the kiln ledge for the sigils.',
        next: 'ta',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'Sorrel sets the sigils around the kiln and speaks the names marked on them.',
        next: 't3',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to hand over the Cinder Sigils?',
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
          "Their vigil is finished. The kiln is ready to shelter Ignivar's ember when his shell breaks. Ask me about the descent before you go. I will keep this fire lit.",
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
        speaker: 'npc',
        text:
          'The vigil fire is ready. Descend the Pyre Caldera and face Ignivar at its bottom. Break the hardened shell around his ember. When the royal binding gives way, we should be able to see where it carries the stolen light. Return here afterward. You should not bear that sight alone.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you free Ignivar from the royal binding?',
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
          "A small ember burns in Sorrel's kiln. Above it, a fading thread of light points toward the dark tower beyond the ash.",
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'He is here. Small enough for this kiln, and no longer feeding the crown. The released binding points to the Umbral Spire. Ask me how to reach it. We have freed the source; now someone must open the vessel holding what was stolen.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to tell me how the binding broke?',
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
          "The broken binding has exposed the road to the Umbral Spire. Aldric waits at its summit. Seek the Archivist below the throne: a keeper of the old court who has been trying to warn us. Ask how to release the light still held in the crown. I will keep Ignivar's ember safe here.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you seek the Archivist in the Umbral Spire?',
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
        text: 'The Archivist places a court record beside an empty page headed with your name.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'The drain has stopped. The crown still holds what Aldric took. He divided the Great Flame to stop a world that had hurt him, and called its stillness peace. First we must break the Crownsworn patrols. Then I will tell you what the court records say of his decision.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Will you give your account of the broken binding?',
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
          "The Crownsworn swore to protect Aldric's people. His crown now compels them to protect his prison instead. Their patrols attack anyone approaching the throne. Defeat the Crownsworn Blades here in the Spire. I will record their names as servants released, not traitors punished.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you defeat the Crownsworn patrols?',
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
          'The Archivist opens a roll of the royal guard. Beside the names is a column headed Released.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report the Crownsworn patrols defeated?',
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
          "A century ago, Aldric's daughter died during the long famine. He ordered the Great Flame divided, believing he could stop all change before it took anyone else. He kept the power of renewal in his crown and left us dwindling warmth. His people still suffered. He called each loss a reason to tighten his grip.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you hear what must be done at the throne?',
        choices: [
          {
            id: 'accept',
            label: '📜 Hear how to release the crown',
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
        text:
          'Defeat Aldric to break his hold on the crown. The warmth you freed in root, water, daylight, and thaw can then rejoin its source. You need no royal key; the stair opens onto the Sundered Throne. I have supplies for your ascent. His grief explains the theft. It does not give him the right to keep it.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'The Archivist sets a sealed supply flask beside the plan of the throne ascent.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to take the supplies and prepare for Aldric?',
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
          'Aldric waits at the top of the Sundered Throne. He will try to keep the crown and the future bound to him. Defeat him. Let the released light return to the world, then come back to me. We must leave a record of what happened, so nobody calls this theft salvation again.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'narrator',
        text: 'The Archivist caps the ink and looks directly at you.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you face Aldric and end his hold on the Flame?',
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
        text:
          'The Archivist waits beneath a window that has never admitted sunlight before. A broken crown rests on the desk.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: "Will you give your account of Aldric's defeat?",
        choices: [
          {
            id: 'handover',
            label: "👑 Report Aldric's defeat",
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
          'The Archivist places the empty crown in your hands. Beyond the window, light runs through the channels you reopened. Far below, the village fields catch a full sunrise. The harvest still needs planting. For the first time in years, it has the warmth to grow.',
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
          'The Flame is free. The wound Aldric tore beneath it remains: the Seam, reached through the Abyss below this tower. It catches memories and draws loose light out of the channels. Maren crossed its edge in her youth and returned; an echo of her stayed behind. Find that echo. She knows the descent.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'narrator',
        text:
          'The Archivist turns the map over. A narrow stair runs from the tower foundations into the Abyss.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: "Will you meet Maren's echo in the Abyss?",
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
        text:
          "The woman at the edge of the path has Maren's face, without its years. Light passes through her sleeve.",
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'She got home, then. Good. I am the memory this place kept when she crossed its edge. She was young and tried to carry the whole task alone. You have brought half the world with you, by the sound of it. Let me help with the last stretch.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Will you tell me how Maren and the village are faring?',
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
          'The Warden formed around the wound to contain it. Now it strikes at every living thing that approaches. Descend the Endless Seam and overcome it at the bottom. The light you carry can settle the breach once its guard relents. A wandering reflection of the Warden cannot do that. Come back to me afterward.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you face the Warden at the bottom of the Endless Seam?',
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
          'The wind rising from the Seam grows quiet. The paths below remain, but loose sparks no longer fall into them.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report the breach contained?',
        choices: [
          {
            id: 'handover',
            label: '🌅 Report the breach contained',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'm25_silence' }],
            next: 't2',
          },
        ],
      },
      {
        'id': 't2',
        'kind': 'line',
        'speaker': 'npc',
        'text':
          'The breach is quiet. Its old chambers will still remember their battles, but they no longer feed on the world above. You can go home. Tell Maren that the road she could not finish alone has brought someone back.',
        'next': 't3',
      },
      {
        'id': 't3',
        'kind': 'line',
        'speaker': 'narrator',
        'text':
          'You turn toward the stair. Above you wait a village hearth, fields ready for planting, and people who have kept a place for you.',
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
        text: 'Lyra folds a clean bandage beside a bowl of thin porridge.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          "The Giant Rats foul what grain they do not eat. I have children with fevers and too little clean food for them. Defeat the rats in the Outskirts or at the Whisperwood edge, then report to me. Leave the Ember Rats to Maren's patrol; this job is for the ordinary, oversized kind.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you help protect our food from the Giant Rats?',
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
        text:
          'Fewer bites, fewer fouled sacks. That gives me a chance to treat the patients I already have. Tell me how the rat patrol went.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
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
        text:
          "The farmers need plough fittings and nails before the next planting. Bring Iron Chunks from the Rootbound Hollow. Its early chambers have old ore caches; the Mycelid Drones carry more. I'll pay you for this batch. Any iron promised for your descent equipment is a separate order.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: "Will you gather iron for the farmers' tools?",
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
        text: 'Bram sets an empty basket beside a pile of broken plough fittings.',
        next: 'ta',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'Good iron. That will put the broken ploughs back in the fields. Here is your payment.',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to hand over the requested goods?',
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
          'The sickroom lamps keep going out before the children fall asleep. Ember Shards hold a little steady warmth. Bring me a batch from the fields or Whisperwood. I can fit them into the lamp cups and stop waking patients to change the wicks.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you bring Ember Shards for the sickroom lamps?',
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
        text: 'Lyra sets the empty lamp cups in a row beside the beds.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to hand over the requested goods?',
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
        text:
          'Lyra fits the shards into the lamp cups. A child watches the steady light, then settles back against a pillow.',
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
        text: 'Pell searches the torn strap of a pack for a broken chain link.',
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          "Lost my mother's locket when the Woodfangs dragged off my pack. It has a pressed fern under the lid. Search the spiders in the Whisperwood. One of them still has it in the webbing it carries. Bring it back to me.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: "Will you find my mother's locket?",
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
        text: 'Pell waits with an open palm. A pale mark circles the place a chain once lay.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to hand over the requested goods?',
        choices: [
          {
            id: 'handover',
            label: "🧿 Hand over Pell's Locket",
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
          'Pell opens the locket. The pressed fern is still under its lid. Pell closes it carefully and gives you a Lucky Coin from a coat pocket.',
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
        text:
          'The Corrupted Stag still roams the Whisperwood. The rot reached it before we freed the Hollow, and now it charges anything alive. I knew it when it led lost children back to the paths. Find it in the forest. End its suffering, then tell me where it fell.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you put the Corrupted Stag to rest?',
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
        text: 'Tom rests a hand on the small cairn beside his shelter.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text: 'I will mark the place you found it. Thank you for going back for an old guardian.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
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
        text:
          "Boglins raid the baskets waiting for my ferry. Yesterday they took a family's whole supply of flour. Defeat the raiders around Hollowmere and come back to me. People should be able to set a basket down without standing guard over it.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you clear the Boglin raiders from Hollowmere?',
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
        speaker: 'narrator',
        text:
          'A basket of bread waits beside the mooring rope. The Ferryman keeps it within reach of his pole.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'He points out a new mooring post where the raiders tore the old rope loose.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
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
          'Fen Hags imitate the calls we use to find each other in the mist. Travelers follow them into deep water. Defeat the hags out in Hollowmere and report back. My passengers have enough trouble finding dry ground without false directions.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: "Will you stop the Fen Hags' false calls?",
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
        text:
          'The Ferryman answers a call from the far bank. An answering lantern rises through the reeds.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
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
          'Gilded Scarabs strip brass from the water pumps. We can mend the old channels only while enough machinery remains. Defeat the scarabs in the Sunspire Ruins, then report here. I would prefer to catalogue a working pump for once.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you protect the pumps from Gilded Scarabs?',
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
        speaker: 'narrator',
        text: 'Ombra tests a repaired pump handle. Water splashes into a waiting jar.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'narrator',
        text: 'Ombra notes the water level on the jar with visible satisfaction.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
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
          'The old astronomers kept lynxes to hunt vermin. Their descendants now hunt anyone carrying food through the ruins. Defeat the Spire Lynxes stalking those paths. The relief travelers need to reach the water pumps safely.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you clear the hunting lynxes from the paths?',
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
        text: "Ombra marks the places you indicate on the travelers' map.",
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'I will pass these sightings to the next caravan. They should know both where you cleared the way and where to keep watch.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
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
        text:
          'Frost Wraiths still walk the old watch circuit. They challenge travelers who cannot remember a password from a century ago. Defeat them in the pass. Breaking the frost around them releases the trapped memory. I will keep their names here.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you release the Frost Wraiths from their watch?',
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
        text: "Rho leaves a space for your report beside the wardens' memorial.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
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
        text:
          'Glacier Yetis have moved onto the supply paths. They attack the carriers and tear open their packs. Defeat the ones holding the pass or sheltering in the Glacier Maw. They are defending feeding ground, but we need those supplies too.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you drive the Glacier Yetis off the supply paths?',
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
        text: 'Rho counts the supply packs stacked beneath the shelter roof.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'The last carriers got through with everything they brought. I will keep watch for the yetis returning. Take your pay.',
        next: 't3',
      },
      {
        id: 't3',
        kind: 'line',
        speaker: 'narrator',
        text: "Rho hangs a dry pair of carrier's mittens beside the fire.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
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
        text:
          'Ember Imps break our oil jars to feed on the burning spills. That oil keeps the shelter lamps alight for travelers. Defeat the imps in the Cinder Wastes and come back to me. We can mend the jars if they leave us enough to put in them.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you protect the shelter stores from Ember Imps?',
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
        text: 'Sorrel sets an unbroken oil jar beside the shelter lamp.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
        choices: [
          {
            id: 'handover',
            label: '🔥 Report the oil stores protected',
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
          'Fire Salamanders drive prey toward the lava, where it has nowhere left to run. Travelers are caught in the same hunt. Defeat the salamanders along the paths through the Cinder Wastes and report here. We count the creatures you face, not whole herds.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: "Will you break the Fire Salamanders' hunt?",
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
        text:
          "The next travelers have reached shelter without abandoning their packs. Tell me where you broke the salamanders' hunt so I can warn those going out.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
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
        text:
          'Umbral Shades gather wherever the stolen light leaves a shadow. They attack the people recovering records from the Spire. Defeat them on the approaches. Those pages hold names of the displaced; their families have waited long enough for an answer.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you clear the Umbral Shades from the records?',
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
        text: 'The Archivist spreads recovered pages on the desk to dry.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the shades defeated',
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
          'Some Echoes of Heroes are caught in the last battle they remember. They see every visitor as the enemy they once faced. Meet them in battle out in the Abyss and defeat them. Then they can put it down. Come back and tell me; I can remember them without the fighting.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you release the Echoes of Heroes from their battles?',
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
        text:
          'The Echo listens as you describe the figures you met. She repeats each description carefully.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
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
        text:
          'Null Hounds tear through the echoes and scatter what little they remember. Defeat the hounds hunting out in the Abyss, then report to me. These memories are all that some families have left. They deserve time to be found.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you protect the echoes from the Null Hounds?',
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
        text: 'A distant figure walks past the path marker without looking over its shoulder.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
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
        text: "Maren points out Bram's forge across the village square.",
        next: 'o2',
      },
      {
        id: 'o2',
        kind: 'line',
        speaker: 'npc',
        text:
          "The letter describes what I found at the forest edge: cold soil above roots that still give off heat. Bram has his family's map of the old hearth channels. Take this to his forge here in the village. Listen to what he finds, then leave the letter with him.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you take the letter to Bram and hear his answer?',
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
        text: 'You hold the letter open while Bram traces its sketch with a soot-dark finger.',
        next: 'c2',
      },
      {
        id: 'c2',
        kind: 'line',
        speaker: 'npc',
        text:
          "Maren found living warmth under dead soil. This matches my grandfather's map: the village hearth is fed through the Whisperwood roots. Something is blocking the channel at the Rootbound Hollow. We can free it. Speak to Maren about reaching Warden Tom in the forest; he knows what has nested there.",
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
        text: 'Bram opens the drawer beside his anvil and holds out a hand for the letter.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: "Will you leave Maren's letter with me?",
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
          "I'll keep the letter with the map. Maren can arrange the forest patrol; go back to her next. We have a place to look now, and a reason to believe the hearth can recover.",
      },
    ],
  },
  // ══ The shrine-pledge branch (#132, #147) ═══════════════════════════
  // The pledge parent (sq_shrine_pledge) is the real shared progress: the
  // Ferryman asks it before any commitment exists, and both committing
  // responses in dlg_ferry_promise advance its pending storyEvent
  // objective. sq_shrine_pact and sq_ledger_debt start directly from that
  // ledger conversation — they are never offered as menu topics. These
  // offer dialogues exist as the lifecycle wiring every quest carries; the
  // turn-in dialogues are the real completion beats. sq_shrine_pact's
  // turn-in carries the game's authored alternate resolution: the player
  // may keep the wisp-light, resolving the quest with the named outcome
  // "kept" (no reward) instead of turning it in.
  {
    id: 'dlg_sq_shrine_pledge_offer',
    npcId: 'npc_ferryman',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          'The shrine keepers have two jobs: free the beacon from Marsh Wisps, or clear Marsh Leeches from their water intake. They can fund one assignment for you. Accept this invitation, then ask me to choose a shrine task. We will discuss both before you commit.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: "Will you discuss the shrine's two jobs with me?",
        choices: [
          {
            id: 'accept',
            label: '🤝 Accept',
            effects: [{ 'kind': 'acceptQuest', 'questId': 'sq_shrine_pledge' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_shrine_pledge_turnin',
    npcId: 'npc_ferryman',
    start: 't1',
    nodes: [
      {
        id: 't1',
        kind: 'line',
        speaker: 'npc',
        text:
          "You chose your assignment. I can give you the keepers' planning payment now; the work itself remains a separate job. Your choice stands whichever task you finish first.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
        choices: [
          {
            id: 'handover',
            label: '📜 Say the answer stands',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_shrine_pledge' }],
          },
        ],
      },
    ],
  },
  {
    id: 'dlg_sq_shrine_pact_offer',
    npcId: 'npc_ferryman',
    start: 'o1',
    nodes: [
      {
        id: 'o1',
        kind: 'line',
        speaker: 'npc',
        text:
          "The Marsh Wisps have drawn the beacon's light into the mist. Defeat them in Hollowmere and it will gather in my ferry lamp. Then return here. We can give it to the shrine for the crossing beacon, as we agreed.",
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you clear the Marsh Wisps for the beacon?',
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
        text: 'The Ferryman lifts a lamp whose wick burns pale blue.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          "The wisps' light has gathered in this lamp. I can use it to relight the shrine beacon and pay you as agreed. Or I can seal it in a lantern for you to keep. That leaves the beacon dark, and you give up the payment. The lantern is a keepsake; it will not help you in battle.",
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
        choices: [
          {
            id: 'handover',
            label: '🕯️ Return the light to the shrine',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_shrine_pact' }],
            next: 't3',
          },
          {
            id: 'keep',
            label: '🏮 Keep a lantern; forgo payment',
            irreversible: true,
            consequenceHint:
              'The beacon remains unlit. The lantern is a keepsake with no combat effect.',
            effects: [
              { kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'kept' },
              { kind: 'grantItem', itemId: 'q_wisp_lantern' },
            ],
            next: 't4',
          },
        ],
      },
      {
        id: 't3',
        kind: 'line',
        speaker: 'npc',
        text:
          'The keepers take the lamp to the beacon. A blue light rises over the crossing, high enough to see above the reeds. Here is the payment we agreed.',
      },
      {
        id: 't4',
        kind: 'line',
        speaker: 'narrator',
        text:
          'The Ferryman seals the blue light in a small lantern and gives it to you. The beacon remains dark. He closes the job in his ledger without taking out the payment.',
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
        text:
          'You chose the water intake. Marsh Leeches block its mouth and foul the baskets used to filter water. Defeat them in Hollowmere, then report to me. The keepers will pay for the work without asking you to make a promise at their shrine.',
        next: 'oa',
      },
      {
        id: 'oa',
        kind: 'choice',
        prompt: 'Will you clear the Marsh Leeches from the intake?',
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
        text: 'The Ferryman checks your report against a sketch of the intake.',
        next: 't2',
      },
      {
        id: 't2',
        kind: 'line',
        speaker: 'npc',
        text:
          'That gives the keepers room to clean the intake. Here is the payment for your patrol. You kept your name off their pledge book, and still helped their neighbors.',
        next: 'ta',
      },
      {
        id: 'ta',
        kind: 'choice',
        prompt: 'Ready to report on this work?',
        choices: [
          {
            id: 'handover',
            label: '📜 Report the intake patrol',
            effects: [{ 'kind': 'turnInQuest', 'questId': 'sq_ledger_debt' }],
          },
        ],
      },
    ],
  },
];
