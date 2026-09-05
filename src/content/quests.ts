/**
 * Quest catalog: the main storyline (28 quests, 6 chapters + epilogue) and
 * side quests. Availability is derived from prereqs, level and zone flags.
 */

import type { NpcDef, QuestDef } from './types.ts';

const Q = (q: QuestDef): QuestDef => q;

export const QUESTS: readonly QuestDef[] = [
  // ══ Chapter 1 — The Last Ember ══════════════════════════════════════
  Q({
    id: 'm1_embers',
    offerDialogue: 'dlg_m1_embers_offer',
    turnInDialogue: 'dlg_m1_embers_turnin',
    name: 'Sparks of Trouble',
    main: true,
    chapter: 1,
    level: 1,
    summary:
      'Protect the seed grain in the Emberdawn Outskirts so the village can plant again. Report to Elder Maren.',
    objectives: [{ kind: 'kill', target: 'e_ember_rat', count: 4 }],
    rewards: { xp: 120, gold: 80, items: { q_sealed_letter: 1 } },
    startNpc: 'npc_maren',
    finishNpc: 'npc_maren',
  }),
  Q({
    id: 'm2_letter',
    offerDialogue: 'dlg_m2_letter_offer',
    turnInDialogue: 'dlg_m2_letter_turnin',
    conversationDialogue: 'dlg_m2_letter_talk',
    name: 'The Sealed Letter',
    main: true,
    chapter: 1,
    level: 2,
    prereq: { questStatus: { questId: 'm1_embers', is: 'done' } },
    summary:
      "Take Maren's letter to Blacksmith Bram in Emberdawn Village. Hear him read it, then leave it with him.",
    objectives: [
      { kind: 'collect', target: 'q_sealed_letter', count: 1 },
      { kind: 'storyEvent', target: 'heard_bram_reading', label: 'Hear Bram read the letter' },
    ],
    rewards: { xp: 150, gold: 100, items: { c_potion: 1 } },
    // The canonical delivery flow (#63): Maren starts it, Bram finishes it.
    startNpc: 'npc_maren',
    finishNpc: 'npc_bram',
  }),
  Q({
    id: 'm3_wolves',
    offerDialogue: 'dlg_m3_wolves_offer',
    turnInDialogue: 'dlg_m3_wolves_turnin',
    name: 'Bold Wolves',
    main: true,
    chapter: 1,
    level: 3,
    prereq: { questStatus: { questId: 'm2_letter', is: 'done' } },
    summary:
      'Defeat the Grey Wolves hunting along the Whisperwood paths. Return to Maren, then seek Warden Tom in the forest.',
    objectives: [{ kind: 'kill', target: 'e_wolf', count: 3 }],
    rewards: { xp: 250, gold: 120 },
    startNpc: 'npc_maren',
    finishNpc: 'npc_maren',
  }),
  Q({
    id: 'm4_floors',
    offerDialogue: 'dlg_m4_floors_offer',
    turnInDialogue: 'dlg_m4_floors_turnin',
    name: "The Hollow's Threshold",
    main: true,
    chapter: 1,
    level: 5,
    prereq: { questStatus: { questId: 'm3_wolves', is: 'done' } },
    summary:
      'Clear Woodfang Spiders and Thistle Sprites from the Whisperwood approach to the Rootbound Hollow. Report to Warden Tom.',
    objectives: [
      { kind: 'kill', target: 'e_spider', count: 3 },
      { kind: 'kill', target: 'e_sprite', count: 2 },
    ],
    rewards: { xp: 300, gold: 200 },
    startNpc: 'npc_warden_tom',
    finishNpc: 'npc_warden_tom',
  }),
  Q({
    id: 'm5_arms',
    offerDialogue: 'dlg_m5_arms_offer',
    turnInDialogue: 'dlg_m5_arms_turnin',
    name: 'Steel for the Descent',
    main: true,
    chapter: 1,
    level: 6,
    prereq: { questStatus: { questId: 'm4_floors', is: 'done' } },
    summary:
      'Bring Iron Chunks to Bram in Emberdawn Village. He will stock better equipment for sale and pay you for the iron.',
    objectives: [{ kind: 'collect', target: 'm_iron_chunk', count: 2 }],
    rewards: { xp: 250, gold: 250, items: { c_potion: 2 } },
    startNpc: 'npc_bram',
    finishNpc: 'npc_bram',
  }),
  Q({
    id: 'm3_roots',
    offerDialogue: 'dlg_m3_roots_offer',
    turnInDialogue: 'dlg_m3_roots_turnin',
    startNpc: 'npc_bram',
    finishNpc: 'npc_bram',
    name: 'Root of the Rot',
    main: true,
    chapter: 1,
    level: 7,
    prereq: { questStatus: { questId: 'm5_arms', is: 'done' } },
    summary:
      'Defeat Matriarch Aranya in the Rootbound Hollow beneath the Whisperwood. Report to Bram so he can check the hearth channel.',
    objectives: [{ kind: 'kill', target: 'e_aranya', count: 1 }],
    rewards: { xp: 400, gold: 250, items: { m_iron_chunk: 1 } },
  }),
  Q({
    id: 'm4_blessing',
    offerDialogue: 'dlg_m4_blessing_offer',
    turnInDialogue: 'dlg_m4_blessing_turnin',
    startNpc: 'npc_bram',
    finishNpc: 'npc_bram',
    name: "Whisperwood's Blessing",
    main: true,
    chapter: 1,
    level: 8,
    prereq: { questStatus: { questId: 'm3_roots', is: 'done' } },
    summary:
      'Bring Ember Shards from the fields or Whisperwood to Bram. Help him steady the village hearth and prepare the road to Hollowmere.',
    objectives: [{ kind: 'collect', target: 'm_ember_shard', count: 6 }],
    rewards: {
      xp: 350,
      gold: 200,
      items: { t_1: 1 },
      flags: ['chapter1Done'],
      unlockZones: ['hollowmere', 'mirefoot'],
    },
  }),

  // ══ Chapter 2 — The Drowned Lowland ══════════════════════════════════
  Q({
    id: 'm5_fen',
    offerDialogue: 'dlg_m5_fen_offer',
    turnInDialogue: 'dlg_m5_fen_turnin',
    // Destination quest (#66): Bram sends you east; the Ferryman completes
    // the journey in Hollowmere. The road IS the quest.
    startNpc: 'npc_bram',
    finishNpc: 'npc_ferryman',
    name: 'Into the Fen',
    main: true,
    chapter: 2,
    level: 9,
    prereq: { questStatus: { questId: 'm4_blessing', is: 'done' } },
    summary:
      'Travel through the Whisperwood to Hollowmere Swamp and meet the Ferryman. Ask about the shrine on the old hearth channel.',
    objectives: [{ kind: 'reach', target: 'hollowmere' }],
    rewards: { xp: 300, gold: 150 },
  }),
  Q({
    id: 'm6_toxin',
    offerDialogue: 'dlg_m6_toxin_offer',
    turnInDialogue: 'dlg_m6_toxin_turnin',
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
    name: "The Water's Bane",
    main: true,
    chapter: 2,
    level: 10,
    prereq: { questStatus: { questId: 'm5_fen', is: 'done' } },
    summary:
      'Collect Toxin Samples from Marsh Leeches in Hollowmere and hand them to the Ferryman, who is tracing the poisoned water.',
    objectives: [{ kind: 'collect', target: 'q_toxin_sample', count: 4 }],
    rewards: { xp: 900, gold: 400, items: { c_antidote: 2 } },
  }),
  Q({
    id: 'm7_tyrant',
    offerDialogue: 'dlg_m7_tyrant_offer',
    turnInDialogue: 'dlg_m7_tyrant_turnin',
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
    name: 'The Bog Tyrant',
    main: true,
    chapter: 2,
    level: 12,
    prereq: { questStatus: { questId: 'm6_toxin', is: 'done' } },
    summary:
      "Defeat Bog Tyrant Vosk in the Sunken Shrine beneath Hollowmere. Return to the Ferryman after freeing the shrine's waterworks.",
    objectives: [{ kind: 'kill', target: 'e_vosk', count: 1 }],
    rewards: { xp: 1400, gold: 700, flags: ['chapter2Done'] },
  }),
  Q({
    id: 'm8_passage',
    offerDialogue: 'dlg_m8_passage_offer',
    turnInDialogue: 'dlg_m8_passage_turnin',
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
    name: "The Curator's Summons",
    main: true,
    chapter: 2,
    level: 13,
    prereq: { questStatus: { questId: 'm7_tyrant', is: 'done' } },
    summary:
      "Hear the Ferryman explain Ombra's request for help, then confirm your preparations with him to open the road to Sunspire.",
    objectives: [{
      kind: 'storyEvent',
      target: 'heard_ferrymans_word',
      label: "Hear the Ferryman's word",
    }],
    rewards: { xp: 500, gold: 250, unlockZones: ['sunspire'] },
  }),

  // ══ Chapter 3 — The City of Gears ════════════════════════════════════
  Q({
    id: 'm9_spire',
    offerDialogue: 'dlg_m9_spire_offer',
    turnInDialogue: 'dlg_m9_spire_turnin',
    // Destination quest (#66): the Ferryman's summons points east; Ombra
    // receives you in Sunspire.
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_curator',
    name: 'City of Gears',
    main: true,
    chapter: 3,
    level: 15,
    prereq: { questStatus: { questId: 'm8_passage', is: 'done' } },
    summary:
      'Follow the road from Hollowmere to the Sunspire Ruins. Meet Curator Ombra to investigate the stolen daylight.',
    objectives: [{ kind: 'reach', target: 'sunspire' }],
    rewards: { xp: 400, gold: 200 },
  }),
  Q({
    id: 'm10_cult',
    offerDialogue: 'dlg_m10_cult_offer',
    turnInDialogue: 'dlg_m10_cult_turnin',
    startNpc: 'npc_curator',
    finishNpc: 'npc_curator',
    name: 'The Hoarded Sun',
    main: true,
    chapter: 3,
    level: 16,
    prereq: { questStatus: { questId: 'm9_spire', is: 'done' } },
    summary:
      'Defeat Sun Cultists patrolling the Sunspire Ruins. Report to Ombra so relief travelers can use the causeway again.',
    objectives: [{ kind: 'kill', target: 'e_cultist', count: 8 }],
    rewards: { xp: 1200, gold: 600, items: { c_ether: 2 } },
  }),
  Q({
    id: 'm11_toll',
    offerDialogue: 'dlg_m11_toll_offer',
    turnInDialogue: 'dlg_m11_toll_turnin',
    startNpc: 'npc_curator',
    finishNpc: 'npc_curator',
    name: "The Vault's Toll",
    main: true,
    chapter: 3,
    level: 17,
    prereq: { questStatus: { questId: 'm10_cult', is: 'done' } },
    summary:
      "Defeat Brass Automatons in Sunspire and report to Ombra. Ombra will issue the Sunspire Key needed for the Vault's keeper.",
    objectives: [{ kind: 'kill', target: 'e_automaton', count: 4 }],
    rewards: { xp: 1500, gold: 700, items: { q_sunspire_key: 1 } },
  }),
  Q({
    id: 'm12_chronolich',
    offerDialogue: 'dlg_m12_chronolich_offer',
    turnInDialogue: 'dlg_m12_chronolich_turnin',
    startNpc: 'npc_curator',
    finishNpc: 'npc_curator',
    name: 'The Hour That Stole Itself',
    main: true,
    chapter: 3,
    level: 19,
    prereq: { questStatus: { questId: 'm11_toll', is: 'done' } },
    summary:
      'Defeat the Chronolich in the Vault of Hours beneath Sunspire. Bring the Sunspire Key, then report to Ombra.',
    objectives: [{ kind: 'kill', target: 'e_chronolich', count: 1 }],
    rewards: { xp: 3600, gold: 1600, flags: ['chapter3Done'], unlockZones: ['frostpeak'] },
  }),

  // ══ Chapter 4 — The Frozen Twin ══════════════════════════════════════
  Q({
    id: 'm13_pass',
    offerDialogue: 'dlg_m13_pass_offer',
    turnInDialogue: 'dlg_m13_pass_turnin',
    // Destination quest (#66): Ombra points north; Rho receives you at the
    // pass.
    startNpc: 'npc_curator',
    finishNpc: 'npc_outcast',
    name: 'The Frozen Road',
    main: true,
    chapter: 4,
    level: 22,
    prereq: { questStatus: { questId: 'm12_chronolich', is: 'done' } },
    summary:
      'Travel north from Sunspire to Frostpeak Pass and meet Ice-Outcast Rho. Find out why the returning daylight has not thawed the mountain.',
    objectives: [{ kind: 'reach', target: 'frostpeak' }],
    rewards: { xp: 600, gold: 300 },
  }),
  Q({
    id: 'm14_emblem',
    offerDialogue: 'dlg_m14_emblem_offer',
    turnInDialogue: 'dlg_m14_emblem_turnin',
    startNpc: 'npc_outcast',
    finishNpc: 'npc_outcast',
    name: "Warden's Marks",
    main: true,
    chapter: 4,
    level: 23,
    prereq: { questStatus: { questId: 'm13_pass', is: 'done' } },
    summary:
      'Recover Frost Emblems from Frost Wraiths in Frostpeak Pass. Give them to Rho to identify the lost wardens and prepare the descent.',
    objectives: [{ kind: 'collect', target: 'q_frost_emblem', count: 3 }],
    rewards: { xp: 2400, gold: 900, items: { c_greater_potion: 2 } },
  }),
  Q({
    id: 'm15_wyrm',
    offerDialogue: 'dlg_m15_wyrm_offer',
    turnInDialogue: 'dlg_m15_wyrm_turnin',
    startNpc: 'npc_outcast',
    finishNpc: 'npc_outcast',
    name: 'Heart of the Glacier',
    main: true,
    chapter: 4,
    level: 25,
    prereq: { questStatus: { questId: 'm14_emblem', is: 'done' } },
    summary:
      'Defeat Jormunis in the Glacier Maw at Frostpeak Pass. Free the Frostfire and report to Rho.',
    objectives: [{ kind: 'kill', target: 'e_jormunis', count: 1 }],
    rewards: { xp: 9000, gold: 3200, flags: ['chapter4Done'], unlockZones: ['cinder'] },
  }),

  // ══ Chapter 5 — The Starving Flame ══════════════════════════════════
  Q({
    id: 'm16_ashes',
    offerDialogue: 'dlg_m16_ashes_offer',
    turnInDialogue: 'dlg_m16_ashes_turnin',
    // Destination quest (#66): Rho sends you down from the pass; Sorrel
    // receives you in the Wastes.
    startNpc: 'npc_outcast',
    finishNpc: 'npc_ashen',
    name: 'Through the Ash',
    main: true,
    chapter: 5,
    level: 30,
    prereq: { questStatus: { questId: 'm15_wyrm', is: 'done' } },
    summary:
      "Travel from Frostpeak to the Cinder Wastes. Find Ashen Monk Sorrel and ask about the Great Flame's surviving guardian.",
    objectives: [{ kind: 'reach', target: 'cinder' }],
    rewards: { xp: 900, gold: 450 },
  }),
  Q({
    id: 'm17_plea',
    offerDialogue: 'dlg_m17_plea_offer',
    turnInDialogue: 'dlg_m17_plea_turnin',
    startNpc: 'npc_ashen',
    finishNpc: 'npc_ashen',
    name: "Sorrel's Plea",
    main: true,
    chapter: 5,
    level: 31,
    prereq: { questStatus: { questId: 'm16_ashes', is: 'done' } },
    summary:
      "Listen to Sorrel's account of Ignivar and the King's drain on the Great Flame. Confirm that you understand before preparing the descent.",
    objectives: [{ kind: 'storyEvent', target: 'heard_sorrels_plea', label: "Hear Sorrel's plea" }],
    rewards: { xp: 1500, gold: 700, items: { c_super_potion: 1 } },
  }),
  Q({
    id: 'm18_sigil',
    offerDialogue: 'dlg_m18_sigil_offer',
    turnInDialogue: 'dlg_m18_sigil_turnin',
    startNpc: 'npc_ashen',
    finishNpc: 'npc_ashen',
    name: 'Brand of the Betrayed',
    main: true,
    chapter: 5,
    level: 32,
    prereq: { questStatus: { questId: 'm17_plea', is: 'done' } },
    summary:
      'Collect Cinder Sigils from Ashen Revenants in the Cinder Wastes. Give them to Sorrel for the vigil before facing Ignivar.',
    objectives: [{ kind: 'collect', target: 'q_cinder_sigil', count: 3 }],
    rewards: { xp: 4000, gold: 1500, items: { c_phoenix_feather: 1 } },
  }),
  Q({
    id: 'm19_ignivar',
    offerDialogue: 'dlg_m19_ignivar_offer',
    turnInDialogue: 'dlg_m19_ignivar_turnin',
    startNpc: 'npc_ashen',
    finishNpc: 'npc_ashen',
    name: 'The Last Flame',
    main: true,
    chapter: 5,
    level: 34,
    prereq: { questStatus: { questId: 'm18_sigil', is: 'done' } },
    summary:
      'Defeat Ignivar in the Pyre Caldera beneath the Cinder Wastes. Break the royal binding around his ember and report to Sorrel.',
    objectives: [{ kind: 'kill', target: 'e_ignivar', count: 1 }],
    rewards: { xp: 20000, gold: 6500, flags: ['chapter5Done'], unlockZones: ['umbra'] },
  }),

  // ══ Chapter 6 — The Dawncaller ══════════════════════════════════
  Q({
    id: 'm20_seam',
    offerDialogue: 'dlg_m20_seam_offer',
    turnInDialogue: 'dlg_m20_seam_turnin',
    // Destination quest (#66): Sorrel sends you up from the Wastes; the
    // Archivist receives you at the Spire.
    startNpc: 'npc_ashen',
    finishNpc: 'npc_archivist',
    name: 'The Space Between',
    main: true,
    chapter: 6,
    level: 38,
    prereq: { questStatus: { questId: 'm19_ignivar', is: 'done' } },
    summary:
      'Follow the exposed road from the Cinder Wastes to the Umbral Spire. Meet the Archivist, who knows how Aldric bound the Flame.',
    objectives: [{ kind: 'reach', target: 'umbra' }],
    rewards: { xp: 1500, gold: 700 },
  }),
  Q({
    id: 'm21_loyalty',
    offerDialogue: 'dlg_m21_loyalty_offer',
    turnInDialogue: 'dlg_m21_loyalty_turnin',
    startNpc: 'npc_archivist',
    finishNpc: 'npc_archivist',
    name: 'Give Them Rest',
    main: true,
    chapter: 6,
    level: 39,
    prereq: { questStatus: { questId: 'm20_seam', is: 'done' } },
    summary:
      "Defeat Crownsworn Blades on the Umbral Spire's approaches. Report to the Archivist before preparing to face Aldric.",
    objectives: [{ kind: 'kill', target: 'e_crownsworn', count: 10 }],
    rewards: { xp: 9000, gold: 3000 },
  }),
  Q({
    id: 'm22_umbral_key',
    offerDialogue: 'dlg_m22_umbral_key_offer',
    turnInDialogue: 'dlg_m22_umbral_key_turnin',
    startNpc: 'npc_archivist',
    finishNpc: 'npc_archivist',
    name: 'The Unlocked Door',
    main: true,
    chapter: 6,
    level: 40,
    prereq: { questStatus: { questId: 'm21_loyalty', is: 'done' } },
    summary:
      "Hear the Archivist explain Aldric's decision and how to release the crown's light. Confirm your preparations before the throne ascent.",
    objectives: [{
      kind: 'storyEvent',
      target: 'heard_archivists_counsel',
      label: "Take the Archivist's counsel",
    }],
    rewards: { xp: 10000, gold: 3500, items: { c_elixir: 1 } },
  }),
  Q({
    id: 'm23_aldric',
    offerDialogue: 'dlg_m23_aldric_offer',
    turnInDialogue: 'dlg_m23_aldric_turnin',
    name: 'The Sundered Crown',
    main: true,
    chapter: 6,
    level: 41,
    prereq: { questStatus: { questId: 'm22_umbral_key', is: 'done' } },
    summary:
      'Defeat King Aldric in the Sundered Throne atop the Umbral Spire. Return to the Archivist to preserve the crown as a record of the freed dawn.',
    objectives: [{ kind: 'kill', target: 'e_aldric', count: 1 }],
    rewards: {
      xp: 45000,
      gold: 15000,
      items: { q_sundered_crown: 1 },
      flags: ['chapter6Done'],
      unlockZones: ['abyss'],
    },
    // The Archivist is the throne-room send-off and the completion contact:
    // Aldric himself is a boss encounter, not a dialogue NPC (#63).
    startNpc: 'npc_archivist',
    finishNpc: 'npc_archivist',
  }),

  // ══ Postgame — The Abyss ═════════════════════════════════════════════
  Q({
    id: 'm24_below',
    offerDialogue: 'dlg_m24_below_offer',
    turnInDialogue: 'dlg_m24_below_turnin',
    // Destination quest (#66): the Archivist sends you below; Echo of Maren
    // receives you in the Abyss.
    startNpc: 'npc_archivist',
    finishNpc: 'npc_echo',
    name: 'Below Everything',
    main: true,
    chapter: 7,
    level: 45,
    prereq: { questStatus: { questId: 'm23_aldric', is: 'done' } },
    summary:
      'Descend from the Umbral Spire into the Abyss and meet the Echo of Maren. Investigate the wound left by the sundering.',
    objectives: [{ kind: 'reach', target: 'abyss' }],
    rewards: { xp: 20000, gold: 5000 },
  }),
  Q({
    id: 'm25_silence',
    offerDialogue: 'dlg_m25_silence_offer',
    turnInDialogue: 'dlg_m25_silence_turnin',
    startNpc: 'npc_echo',
    finishNpc: 'npc_echo',
    name: 'Before the Dawn',
    main: true,
    chapter: 7,
    level: 45,
    prereq: { questStatus: { questId: 'm24_below', is: 'done' } },
    summary:
      'Clear the Endless Seam beneath the Abyss and defeat its Warden at the bottom. Return to the Echo after containing the breach.',
    objectives: [{ kind: 'dungeon', target: 'd_seam' }],
    rewards: {
      xp: 90000,
      gold: 30000,
      items: { c_elixir: 2, m_void_fragment: 3 },
      flags: ['seamConquered'],
    },
  }),

  // ══ Side quests ══════════════════════════════════════════════════════
  Q({
    id: 'sq_rats',
    offerDialogue: 'dlg_sq_rats_offer',
    turnInDialogue: 'dlg_sq_rats_turnin',
    name: 'Six Fewer Rats',
    main: false,
    chapter: 1,
    level: 1,
    summary:
      'Protect the village food stores by defeating Giant Rats in the Outskirts or Whisperwood. Report to Healer Lyra.',
    objectives: [{ kind: 'kill', target: 'e_rat', count: 6 }],
    rewards: { xp: 90, gold: 60, items: { c_minor_potion: 1 } },
    startNpc: 'npc_lyra',
    finishNpc: 'npc_lyra',
  }),
  Q({
    id: 'sq_ore',
    offerDialogue: 'dlg_sq_ore_offer',
    turnInDialogue: 'dlg_sq_ore_turnin',
    name: 'Ore for the Forge',
    main: false,
    chapter: 1,
    level: 2,
    prereq: { flag: { id: 'zone_whisperwood' } },
    summary:
      "Bring Iron Chunks from the Rootbound Hollow to Bram in Emberdawn Village for repairs to the farmers' tools.",
    objectives: [{ kind: 'collect', target: 'm_iron_chunk', count: 3 }],
    rewards: { xp: 200, gold: 150 },
    startNpc: 'npc_bram',
    finishNpc: 'npc_bram',
  }),
  Q({
    id: 'sq_charm',
    offerDialogue: 'dlg_sq_charm_offer',
    turnInDialogue: 'dlg_sq_charm_turnin',
    name: 'Light for the Sickroom',
    main: false,
    chapter: 1,
    level: 3,
    prereq: { flag: { id: 'zone_whisperwood' } },
    summary:
      'Bring Ember Shards from the fields or Whisperwood to Lyra for lamps in the village sickroom.',
    objectives: [{ kind: 'collect', target: 'm_ember_shard', count: 4 }],
    rewards: { xp: 220, gold: 120, items: { c_minor_potion: 2 } },
    startNpc: 'npc_lyra',
    finishNpc: 'npc_lyra',
  }),
  Q({
    id: 'sq_locket',
    offerDialogue: 'dlg_sq_locket_offer',
    turnInDialogue: 'dlg_sq_locket_turnin',
    name: 'The Lost Locket',
    main: false,
    chapter: 1,
    level: 4,
    prereq: { flag: { id: 'zone_whisperwood' } },
    summary:
      "Recover Pell's Locket from a Woodfang Spider in the Whisperwood and return it to Ranger Pell.",
    objectives: [{ kind: 'collect', target: 'q_pells_locket', count: 1 }],
    rewards: { xp: 400, gold: 250, items: { t_1: 1 } },
    // The anonymous ranger is now a real, placed contact (#63).
    startNpc: 'npc_pell',
    finishNpc: 'npc_pell',
  }),
  Q({
    id: 'sq_stag',
    offerDialogue: 'dlg_sq_stag_offer',
    turnInDialogue: 'dlg_sq_stag_turnin',
    startNpc: 'npc_warden_tom',
    finishNpc: 'npc_warden_tom',
    name: 'The Old Guardian',
    main: false,
    chapter: 1,
    level: 5,
    prereq: { questStatus: { questId: 'm3_roots', is: 'done' } },
    summary:
      'Find the Corrupted Stag while exploring the Whisperwood. Put it to rest and report to Warden Tom.',
    objectives: [{ kind: 'kill', target: 'e_stag', count: 1 }],
    rewards: { xp: 500, gold: 300, items: { c_potion: 2 } },
  }),
  Q({
    id: 'sq_boglins',
    offerDialogue: 'dlg_sq_boglins_offer',
    turnInDialogue: 'dlg_sq_boglins_turnin',
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
    name: 'Boglin Cull',
    main: false,
    chapter: 2,
    level: 9,
    prereq: { flag: { id: 'zone_hollowmere' } },
    summary: "Defeat Boglins raiding Hollowmere's ferry landings, then report to the Ferryman.",
    objectives: [{ kind: 'kill', target: 'e_boglin', count: 10 }],
    rewards: { xp: 800, gold: 350 },
  }),
  Q({
    id: 'sq_hags',
    offerDialogue: 'dlg_sq_hags_offer',
    turnInDialogue: 'dlg_sq_hags_turnin',
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
    name: 'Cackle Season',
    main: false,
    chapter: 2,
    level: 11,
    prereq: { flag: { id: 'zone_hollowmere' } },
    summary:
      'Defeat Fen Hags in Hollowmere Swamp so travelers can follow real ferry calls. Return to the Ferryman.',
    objectives: [{ kind: 'kill', target: 'e_fenhag', count: 5 }],
    rewards: { xp: 1100, gold: 450, items: { c_ether: 2 } },
  }),
  // The shrine-pledge branch (#132, #147): the Ferryman's ledger
  // conversation (dlg_ferry_promise) starts ONE of the two route quests and
  // permanently locks the other. The pledge parent below is the real shared
  // progress: it is accepted from the Ferryman BEFORE the pledge exists, and
  // both committing responses advance its pending storyEvent objective by
  // emitting the same shared event — the routes never carry a
  // retroactively filled duplicate objective to stand in for parent
  // progress. Availability of the route quests is gated by the recorded
  // decision itself — the decision ledger is the single source of truth,
  // not a mirrored flag.
  Q({
    id: 'sq_shrine_pledge',
    offerDialogue: 'dlg_sq_shrine_pledge_offer',
    turnInDialogue: 'dlg_sq_shrine_pledge_turnin',
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
    name: 'A Task for the Shrine',
    main: false,
    chapter: 2,
    level: 1,
    prereq: { flag: { id: 'zone_hollowmere' } },
    summary:
      "Discuss the shrine's two jobs with the Ferryman. Choose one permanent assignment, then return to him to confirm your answer.",
    objectives: [{
      kind: 'storyEvent',
      target: 'shrine_allegiance_chosen',
      label: 'Choose a shrine task with the Ferryman',
    }],
    rewards: { xp: 500, gold: 250 },
  }),
  Q({
    id: 'sq_shrine_pact',
    offerDialogue: 'dlg_sq_shrine_pact_offer',
    turnInDialogue: 'dlg_sq_shrine_pact_turnin',
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
    name: "The Shrine's Beacon",
    main: false,
    chapter: 2,
    level: 1,
    prereq: {
      any: [
        { decision: { id: 'ferry_shrine_pledge', choiceId: 'promise' } },
        { decision: { id: 'ferry_shrine_pledge', choiceId: 'vouch' } },
      ],
    },
    summary:
      "Defeat Marsh Wisps in Hollowmere to free the shrine beacon's light. Report to the Ferryman to decide where the recovered light goes.",
    objectives: [{ kind: 'kill', target: 'e_wisp', count: 4 }],
    rewards: { xp: 900, gold: 400, items: { c_antidote: 1 } },
    // The only quest with an authored alternate resolution (#132): at
    // turn-in the player may keep the wisp-light instead of handing it
    // over, resolving the quest with this named outcome (and forgoing the
    // reward) rather than completing it ordinarily.
    outcomes: ['kept'],
  }),
  Q({
    id: 'sq_ledger_debt',
    offerDialogue: 'dlg_sq_ledger_debt_offer',
    turnInDialogue: 'dlg_sq_ledger_debt_turnin',
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
    name: 'The Water Intake',
    main: false,
    chapter: 2,
    level: 1,
    prereq: { decision: { id: 'ferry_shrine_pledge', choiceId: 'decline' } },
    summary:
      "Defeat Marsh Leeches around Hollowmere's water intake, then report to the Ferryman for the shrine keepers' payment.",
    objectives: [{ kind: 'kill', target: 'e_leech', count: 4 }],
    rewards: { xp: 850, gold: 380 },
  }),
  Q({
    id: 'sq_scarabs',
    offerDialogue: 'dlg_sq_scarabs_offer',
    turnInDialogue: 'dlg_sq_scarabs_turnin',
    startNpc: 'npc_curator',
    finishNpc: 'npc_curator',
    name: 'Gilded Problem',
    main: false,
    chapter: 3,
    level: 16,
    prereq: { flag: { id: 'zone_sunspire' } },
    summary:
      'Defeat Gilded Scarabs in Sunspire to protect the remaining clockwork water pumps. Report to Ombra.',
    objectives: [{ kind: 'kill', target: 'e_scarab', count: 12 }],
    rewards: { xp: 1600, gold: 600 },
  }),
  Q({
    id: 'sq_lynx',
    offerDialogue: 'dlg_sq_lynx_offer',
    turnInDialogue: 'dlg_sq_lynx_turnin',
    startNpc: 'npc_curator',
    finishNpc: 'npc_curator',
    name: 'Spire Cats',
    main: false,
    chapter: 3,
    level: 18,
    prereq: { flag: { id: 'zone_sunspire' } },
    summary: 'Defeat Spire Lynxes hunting travelers in the Sunspire Ruins. Report to Ombra.',
    objectives: [{ kind: 'kill', target: 'e_spirelynx', count: 6 }],
    rewards: { xp: 2000, gold: 800, items: { t_2: 1 } },
  }),
  Q({
    id: 'sq_wraiths',
    offerDialogue: 'dlg_sq_wraiths_offer',
    turnInDialogue: 'dlg_sq_wraiths_turnin',
    startNpc: 'npc_outcast',
    finishNpc: 'npc_outcast',
    name: 'Laid to Rest',
    main: false,
    chapter: 4,
    level: 23,
    prereq: { flag: { id: 'zone_frostpeak' } },
    summary: 'Release Frost Wraiths in battle while exploring Frostpeak Pass, then report to Rho.',
    objectives: [{ kind: 'kill', target: 'e_frostwraith', count: 8 }],
    rewards: { xp: 4000, gold: 1400 },
  }),
  Q({
    id: 'sq_yetis',
    offerDialogue: 'dlg_sq_yetis_offer',
    turnInDialogue: 'dlg_sq_yetis_turnin',
    startNpc: 'npc_outcast',
    finishNpc: 'npc_outcast',
    name: 'Convincing the Yetis',
    main: false,
    chapter: 4,
    level: 25,
    prereq: { flag: { id: 'zone_frostpeak' } },
    summary:
      'Defeat Glacier Yetis in Frostpeak Pass or the Glacier Maw so supply carriers can pass. Return to Rho.',
    objectives: [{ kind: 'kill', target: 'e_yeti', count: 4 }],
    rewards: { xp: 5500, gold: 1800, items: { t_3: 1 } },
  }),
  Q({
    id: 'sq_imps',
    offerDialogue: 'dlg_sq_imps_offer',
    turnInDialogue: 'dlg_sq_imps_turnin',
    startNpc: 'npc_ashen',
    finishNpc: 'npc_ashen',
    name: 'Oil for the Shelter',
    main: false,
    chapter: 5,
    level: 31,
    prereq: { flag: { id: 'zone_cinder' } },
    summary:
      "Defeat Ember Imps in the Cinder Wastes to protect Sorrel's stores of lamp oil. Report to Sorrel.",
    objectives: [{ kind: 'kill', target: 'e_emberimp', count: 14 }],
    rewards: { xp: 8000, gold: 2500 },
  }),
  Q({
    id: 'sq_salamanders',
    offerDialogue: 'dlg_sq_salamanders_offer',
    turnInDialogue: 'dlg_sq_salamanders_turnin',
    startNpc: 'npc_ashen',
    finishNpc: 'npc_ashen',
    name: 'Breaking the Herds',
    main: false,
    chapter: 5,
    level: 33,
    prereq: { flag: { id: 'zone_cinder' } },
    summary:
      'Defeat Fire Salamanders in the Cinder Wastes to protect travelers from their hunting packs. Return to Sorrel.',
    objectives: [{ kind: 'kill', target: 'e_salamander', count: 8 }],
    rewards: { xp: 11000, gold: 3200, items: { t_4: 1 } },
  }),
  Q({
    id: 'sq_shades',
    offerDialogue: 'dlg_sq_shades_offer',
    turnInDialogue: 'dlg_sq_shades_turnin',
    startNpc: 'npc_archivist',
    finishNpc: 'npc_archivist',
    name: 'Names for the Missing',
    main: false,
    chapter: 6,
    level: 39,
    prereq: { flag: { id: 'zone_umbra' } },
    summary:
      'Defeat Umbral Shades in the Spire, then report to the Archivist so the scattered court records can be recovered.',
    objectives: [{ kind: 'kill', target: 'e_shade', count: 15 }],
    rewards: { xp: 18000, gold: 5000 },
  }),
  Q({
    id: 'sq_echoes',
    offerDialogue: 'dlg_sq_echoes_offer',
    turnInDialogue: 'dlg_sq_echoes_turnin',
    startNpc: 'npc_echo',
    finishNpc: 'npc_echo',
    name: 'Heroes, Honored',
    main: false,
    chapter: 7,
    level: 45,
    prereq: { flag: { id: 'zone_abyss' } },
    summary:
      'Defeat Echoes of Heroes while exploring the Abyss. Release their repeated battles and report to the Echo of Maren.',
    objectives: [{ kind: 'kill', target: 'e_echo', count: 10 }],
    rewards: { xp: 60000, gold: 15000, items: { t_7: 1 } },
  }),
  Q({
    id: 'sq_null',
    offerDialogue: 'dlg_sq_null_offer',
    turnInDialogue: 'dlg_sq_null_turnin',
    startNpc: 'npc_echo',
    finishNpc: 'npc_echo',
    name: 'Quiet the Hounds',
    main: false,
    chapter: 7,
    level: 45,
    prereq: { flag: { id: 'zone_abyss' } },
    summary:
      'Defeat Null Hounds in the Abyss to protect the wandering echoes. Report to the Echo of Maren.',
    objectives: [{ kind: 'kill', target: 'e_nullhound', count: 15 }],
    rewards: { xp: 70000, gold: 18000, items: { c_elixir: 2 } },
  }),
];

const QUEST_INDEX = new Map(QUESTS.map((q) => [q.id, q]));

export function quest(id: string): QuestDef | undefined {
  return QUEST_INDEX.get(id);
}

export function npc(id: string): NpcDef | undefined {
  return NPC_INDEX.get(id);
}

import { ZONES } from './zones.ts';
import type { ZoneDef } from './types.ts';
const NPC_INDEX = new Map<string, NpcDef>(
  ZONES.flatMap((z) => z.npcs.map((n) => [n.id, n] as const)),
);

// ── Quest contact resolution (#63) ──────────────────────────────────────
// Starter and finisher are independent, explicit contacts. Nothing here
// infers the finisher from a talk objective, and no quest-log-only fallback
// exists: every contact must resolve to a real NPC placed in a zone.

/** The zone where an NPC physically stands — resolution is unambiguous:
 * each NPC id is placed in exactly one zone (content-integrity tested). */
export function zoneOfNpc(npcId: string): ZoneDef | undefined {
  return ZONES.find((z) => z.npcs.some((n) => n.id === npcId));
}

export interface QuestContact {
  npc: NpcDef;
  zone: ZoneDef;
}

/** Resolve a quest's STARTING contact: the NPC that offers it, and the zone
 * where the player can physically meet them. */
export function questStarter(questId: string): QuestContact | undefined {
  const q = QUEST_INDEX.get(questId);
  if (!q) return undefined;
  const npcDef = NPC_INDEX.get(q.startNpc);
  const zone = zoneOfNpc(q.startNpc);
  return npcDef && zone ? { npc: npcDef, zone } : undefined;
}

/** Resolve a quest's FINISHING contact: the NPC that accepts the turn-in,
 * and the zone where the player can physically meet them. May differ from
 * the starter (delivery flows, e.g. m2_letter: Maren → Bram). */
export function questFinisher(questId: string): QuestContact | undefined {
  const q = QUEST_INDEX.get(questId);
  if (!q) return undefined;
  const npcDef = NPC_INDEX.get(q.finishNpc);
  const zone = zoneOfNpc(q.finishNpc);
  return npcDef && zone ? { npc: npcDef, zone } : undefined;
}

/** Look an NPC up by id WITHIN a specific zone — the physical-presence
 * check for on-site quest actions (#64). */
export function npcInZone(zoneId: string, npcId: string): NpcDef | undefined {
  return ZONES.find((z) => z.id === zoneId)?.npcs.find((n) => n.id === npcId);
}
