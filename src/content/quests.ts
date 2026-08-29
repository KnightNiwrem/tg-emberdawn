/**
 * Quest catalog: the main storyline (24 quests, 6 chapters + postgame) and
 * side quests. Availability is derived from prereqs, level and zone flags.
 */

import type { NpcDef, QuestDef } from './types.ts';

const Q = (q: QuestDef): QuestDef => q;

export const QUESTS: readonly QuestDef[] = [
  // ══ Chapter 1 — The Dying Flame ══════════════════════════════════════
  Q({
    id: 'm1_embers',
    name: 'Sparks of Trouble',
    main: true,
    chapter: 1,
    level: 1,
    summary: 'Elder Maren asks you to thin the wolf packs circling Emberfall.',
    intro:
      'Maren grips her staff. "Wolves circle the fields every night now. Thin them, and the village breathes."',
    outro:
      '"You\'ve bought us quiet nights," Maren says. "Take this — and speak to Bram. He has work for capable hands."',
    objectives: [{ kind: 'kill', target: 'e_wolf', count: 4 }],
    rewards: { xp: 120, gold: 80 },
    giver: 'npc_maren',
  }),
  Q({
    id: 'm2_letter',
    name: 'The Sealed Letter',
    main: true,
    chapter: 1,
    level: 2,
    prereqQuest: 'm1_embers',
    summary: "Deliver Maren's sealed letter to Blacksmith Bram.",
    intro:
      '"Take this to Bram," Maren says, pressing a wax-sealed letter into your hands. "His forge was the last to touch the Great Flame. He should hear what I\'ve read."',
    outro:
      'Bram breaks the seal, reads, and goes very still. "The Flame isn\'t just dying. Something is drinking it. Say nothing yet — but the Whisperwood roots still carry warmth. Find out what\'s souring them."',
    objectives: [{ kind: 'talk', target: 'npc_bram' }],
    rewards: { xp: 150, gold: 100, items: { c_potion: 1 } },
    giver: 'npc_maren',
  }),
  Q({
    id: 'm3_roots',
    name: 'Root of the Rot',
    main: true,
    chapter: 1,
    level: 3,
    prereqQuest: 'm2_letter',
    summary: 'Cleanse the Rootbound Hollow and its broodmother.',
    intro:
      'Bram arms you properly. "Follow the warm roots into the Hollow. What you find at the bottom of that silk — end it."',
    outro:
      "The Hollow's silk slackens and greys. Warmth seeps back into the roots like blood into a numb limb. The wood exhales.",
    objectives: [{ kind: 'kill', target: 'e_aranya', count: 1 }],
    rewards: { xp: 400, gold: 250, items: { m_iron_chunk: 1 } },
  }),
  Q({
    id: 'm4_blessing',
    name: "Whisperwood's Blessing",
    main: true,
    chapter: 1,
    level: 4,
    prereqQuest: 'm3_roots',
    summary: "Gather ember shards from the recovering wood for Bram's forge.",
    intro:
      '"The wood bleeds ember-shards where the rot was cut," Bram says. "Bring me enough, and I\'ll forge you a blade worthy of what\'s coming."',
    outro:
      "Bram quenches the shard-steel with a hiss that sounds like relief. \"That's chapter one closed. The swamp is next — Hollowmere's water carries the same rot. Head east when you're ready.\"",
    objectives: [{ kind: 'collect', target: 'm_ember_shard', count: 6 }],
    rewards: {
      xp: 350,
      gold: 200,
      items: { t_1: 1 },
      flags: ['chapter1Done'],
      unlockZone: 'hollowmere',
    },
  }),

  // ══ Chapter 2 — The Drowned Lowland ══════════════════════════════════
  Q({
    id: 'm5_fen',
    name: 'Into the Fen',
    main: true,
    chapter: 2,
    level: 9,
    prereqQuest: 'm4_blessing',
    summary: 'Travel to Hollowmere and take its measure.',
    intro: 'The swamp swallows sound. You are meant to be here — the rot wants witnesses.',
    outro:
      'The Ferryman poles you across black water. "You\'re for the Shrine, then. Everybody is, eventually."',
    objectives: [{ kind: 'reach', target: 'hollowmere' }],
    rewards: { xp: 300, gold: 150 },
  }),
  Q({
    id: 'm6_toxin',
    name: "The Water's Bane",
    main: true,
    chapter: 2,
    level: 10,
    prereqQuest: 'm5_fen',
    summary: "Collect toxin samples from the marsh's leeches.",
    intro:
      '"Leeches carry the toxin whole," the Ferryman says. "Fetch samples. I know a counter-craft, if there\'s anything left worth saving."',
    outro:
      '"That\'s the brew," the Ferryman mutters over the vials. "Drained from the Flame\'s runoff. The Tyrant didn\'t poison the swamp — he claimed the poisoning."',
    objectives: [{ kind: 'collect', target: 'q_toxin_sample', count: 4 }],
    rewards: { xp: 900, gold: 400, items: { c_antidote: 2 } },
  }),
  Q({
    id: 'm7_tyrant',
    name: 'The Bog Tyrant',
    main: true,
    chapter: 2,
    level: 12,
    prereqQuest: 'm6_toxin',
    summary: 'Descend into the Sunken Shrine and end Bog Tyrant Vosk.',
    intro:
      '"The Shrine drowns slowly," the Ferryman says. "The Tyrant drowns faster things. Go down before the water finishes the job."',
    outro:
      "Vosk deflates with a sound like a dying bell. The water around the Shrine clears a hand's breadth — the first clean light in years.",
    objectives: [{ kind: 'kill', target: 'e_vosk', count: 1 }],
    rewards: { xp: 1400, gold: 700, flags: ['chapter2Done'], unlockZone: 'sunspire' },
  }),
  Q({
    id: 'm8_passage',
    name: "The Curator's Summons",
    main: true,
    chapter: 2,
    level: 13,
    prereqQuest: 'm7_tyrant',
    summary: "Hear the Ferryman's word about the ruins beyond.",
    intro:
      '"Word travels faster than boats," the Ferryman says. "There\'s a city of gears east — Sunspire. A cult there is bottling hours. Their curator sent for anyone who fights well."',
    outro:
      '"Take the east road," the Ferryman says. "And mind the sentinels. They only remember half their orders."',
    objectives: [{ kind: 'talk', target: 'npc_ferryman' }],
    rewards: { xp: 500, gold: 250 },
  }),

  // ══ Chapter 3 — The City of Gears ════════════════════════════════════
  Q({
    id: 'm9_spire',
    name: 'City of Gears',
    main: true,
    chapter: 3,
    level: 15,
    prereqQuest: 'm8_passage',
    summary: 'Reach the Sunspire Ruins.',
    intro: 'Gears the size of houses grind beneath the sand. The sun here comes in measured doses.',
    outro:
      'Curator Ombra looks you over like an acquisition. "Good. The Vault steals time from the Flame. Its keeper must be taught theft has costs."',
    objectives: [{ kind: 'reach', target: 'sunspire' }],
    rewards: { xp: 400, gold: 200 },
  }),
  Q({
    id: 'm10_cult',
    name: 'Burn the Fanaticism',
    main: true,
    chapter: 3,
    level: 16,
    prereqQuest: 'm9_spire',
    summary: "Break the Sun Cult's hold on the ruins.",
    intro:
      '"They call it devotion," Ombra says. "It\'s theft with hymns. Thin their ranks until the singing stops."',
    outro: 'The hymns have stopped. The desert wind sounds almost like rest.',
    objectives: [{ kind: 'kill', target: 'e_cultist', count: 8 }],
    rewards: { xp: 1200, gold: 600, items: { c_ether: 2 } },
  }),
  Q({
    id: 'm11_toll',
    name: "The Vault's Toll",
    main: true,
    chapter: 3,
    level: 17,
    prereqQuest: 'm10_cult',
    summary: 'Break the automatons guarding the Vault of Hours and claim its key.',
    intro:
      '"The Vault only opens for its own key," Ombra says. "The automatons carry it. They also carry enough brass to matter. Break them."',
    outro:
      'The last automaton folds with a sound like a struck hour. A key of cold gold light sits in the wreckage — the Sunspire Key.',
    objectives: [{ kind: 'kill', target: 'e_automaton', count: 4 }],
    rewards: { xp: 1500, gold: 700, items: { q_sunspire_key: 1 } },
  }),
  Q({
    id: 'm12_chronolich',
    name: 'The Hour That Stole Itself',
    main: true,
    chapter: 3,
    level: 19,
    prereqQuest: 'm11_toll',
    summary: 'Enter the Vault of Hours and end the Chronolich.',
    intro:
      "The Vault door drinks the key's light. Inside, every stolen hour ticks in the dark, and something old keeps the ledgers.",
    outro:
      'The Chronolich\'s hourglass shatters, and stolen time pours out — hours return to the Flame in a ribbon of light. Ombra nods once. "North. The flame\'s twin sleeps in Frostpeak. Something is coiled around it."',
    objectives: [{ kind: 'kill', target: 'e_chronolich', count: 1 }],
    rewards: { xp: 3600, gold: 1600, flags: ['chapter3Done'], unlockZone: 'frostpeak' },
  }),

  // ══ Chapter 4 — The Frozen Twin ══════════════════════════════════════
  Q({
    id: 'm13_pass',
    name: 'The Frozen Road',
    main: true,
    chapter: 4,
    level: 22,
    prereqQuest: 'm12_chronolich',
    summary: 'Cross into Frostpeak Pass.',
    intro: "Cold that doesn't bite so much as consider you. Above, the pass glitters blue.",
    outro:
      'Rho eyes your weapons. "You\'ll want more than iron where you\'re going. The Maw breathes cold that eats courage first."',
    objectives: [{ kind: 'reach', target: 'frostpeak' }],
    rewards: { xp: 600, gold: 300 },
  }),
  Q({
    id: 'm14_emblem',
    name: "Warden's Marks",
    main: true,
    chapter: 4,
    level: 23,
    prereqQuest: 'm13_pass',
    summary: 'Collect Frost Emblems from the wraiths haunting the pass.',
    intro:
      '"The wraiths were wardens once," Rho says. "They still carry their marks. Bring me three, and I\'ll open the Maw\'s old road for you."',
    outro:
      'Rho aligns the emblems, and the ice remembers a door. "The Maw is open. What sleeps inside — wake it gently, or not at all."',
    objectives: [{ kind: 'collect', target: 'q_frost_emblem', count: 3 }],
    rewards: { xp: 2400, gold: 900, items: { c_greater_potion: 2 } },
  }),
  Q({
    id: 'm15_wyrm',
    name: 'Heart of the Glacier',
    main: true,
    chapter: 4,
    level: 25,
    prereqQuest: 'm14_emblem',
    summary: 'Face Jormunis in the Glacier Maw.',
    intro:
      'The Maw breathes around you. Deep in the blue, a heartbeat made of ice — and coiled around it, the wyrm.',
    outro:
      "Jormunis uncoils one last time, and the Frostfire rises free — streaming north-to-south through the mountain toward the Cinder Wastes. The flame's twin goes home.",
    objectives: [{ kind: 'kill', target: 'e_jormunis', count: 1 }],
    rewards: { xp: 9000, gold: 3200, flags: ['chapter4Done'], unlockZone: 'cinder' },
  }),

  // ══ Chapter 5 — The Starving Flame ══════════════════════════════════
  Q({
    id: 'm16_ashes',
    name: 'Through the Ash',
    main: true,
    chapter: 5,
    level: 30,
    prereqQuest: 'm15_wyrm',
    summary: 'Cross the Cinder Wastes.',
    intro:
      'Ash falls like snow that gave up on being cold. Somewhere under it, a heart of fire is starving.',
    outro:
      "Sorrel finds you before the imps do. \"You came with the Frostfire's wake. Then you're the one Ignivar's been burning to meet. Follow me.\"",
    objectives: [{ kind: 'reach', target: 'cinder' }],
    rewards: { xp: 900, gold: 450 },
  }),
  Q({
    id: 'm17_plea',
    name: "Sorrel's Plea",
    main: true,
    chapter: 5,
    level: 31,
    prereqQuest: 'm16_ashes',
    summary: "Hear Ashen Monk Sorrel's plea.",
    intro:
      '"Listen before you swing," Sorrel says. "Ignivar guarded the Flame for a thousand years. Then the Sundered King began drinking it, and everyone blamed the hunger on the guardian."',
    outro:
      '"He\'ll fight you anyway," Sorrel says quietly. "Pride burns hotter than starvation. But when he falls — and he will — know that the true thief is above the sky, in a tower that isn\'t entirely real."',
    objectives: [{ kind: 'talk', target: 'npc_ashen' }],
    rewards: { xp: 1500, gold: 700, items: { c_super_potion: 1 } },
  }),
  Q({
    id: 'm18_sigil',
    name: 'Brand of the Betrayed',
    main: true,
    chapter: 5,
    level: 32,
    prereqQuest: 'm17_plea',
    summary: "Collect Cinder Sigils branded by the Revenants' sorrow.",
    intro:
      '"The revenants are the Flame\'s old faithful," Sorrel says. "Their sorrow brands the ash with sigils. Bring me three — they\'ll calm the Caldera\'s rage enough for you to descend."',
    outro:
      "The sigils cool in Sorrel's hands. \"The Caldera's throat is open. Go down gently. He's been waiting to be understood for a very long time.\"",
    objectives: [{ kind: 'collect', target: 'q_cinder_sigil', count: 3 }],
    rewards: { xp: 4000, gold: 1500, items: { c_phoenix_feather: 1 } },
  }),
  Q({
    id: 'm19_ignivar',
    name: 'The Last Flame',
    main: true,
    chapter: 5,
    level: 34,
    prereqQuest: 'm18_sigil',
    summary: 'Descend the Pyre Caldera and face Ignivar.',
    intro:
      "At the caldera's bottom, the Last Flame gutters in a cage of its own cinders. It looks up. It is so tired.",
    outro:
      'Ignivar\'s last ember drifts free — and instead of dying, it funnels upward, toward a spire that stands where the sky has a seam. "The thief," Sorrel whispers. "The Umbral Spire. Go finish this."',
    objectives: [{ kind: 'kill', target: 'e_ignivar', count: 1 }],
    rewards: { xp: 20000, gold: 6500, flags: ['chapter5Done'], unlockZone: 'umbra' },
  }),

  // ══ Chapter 6 — The Sundered Crown ══════════════════════════════════
  Q({
    id: 'm20_seam',
    name: 'The Space Between',
    main: true,
    chapter: 6,
    level: 38,
    prereqQuest: 'm19_ignivar',
    summary: 'Reach the Umbral Spire.',
    intro:
      'The Spire stands in the seam between light and dark — real from one angle, absence from the next.',
    outro:
      'The Archivist\'s pen never stops moving. "The King split the Flame to hold both halves of the sky. The split is what\'s killing it. Mend the crown, mend the Flame."',
    objectives: [{ kind: 'reach', target: 'umbra' }],
    rewards: { xp: 1500, gold: 700 },
  }),
  Q({
    id: 'm21_loyalty',
    name: 'Loyalty, Corrected',
    main: true,
    chapter: 6,
    level: 39,
    prereqQuest: 'm20_seam',
    summary: "Cut down the Crownsworn guarding the Spire's ascent.",
    intro:
      '"They were knights once," the Archivist says. "Now they\'re the King\'s habit, still fighting his wars. Give them rest."',
    outro:
      'The last of the Crownsworn kneels as it falls — not to you, but to some old, remembered king. The stair to the throne is clear.',
    objectives: [{ kind: 'kill', target: 'e_crownsworn', count: 10 }],
    rewards: { xp: 9000, gold: 3000 },
  }),
  Q({
    id: 'm22_umbral_key',
    name: 'The Umbral Key',
    main: true,
    chapter: 6,
    level: 40,
    prereqQuest: 'm21_loyalty',
    summary: 'Claim the Umbral Key from the Crownsworn elite.',
    intro:
      '"The throne room opens for the Umbral Key," the Archivist says. "The Crownsworn carry it in pieces of duty. Relieve them of it."',
    outro:
      'The key is cold, and it opens what should stay locked. The throne room doors swing inward on a room split down the middle — half ember, half ash.',
    objectives: [{ kind: 'collect', target: 'q_umbra_key', count: 1 }],
    rewards: { xp: 10000, gold: 3500, items: { c_elixir: 1 } },
  }),
  Q({
    id: 'm23_aldric',
    name: 'The Sundered Crown',
    main: true,
    chapter: 6,
    level: 41,
    prereqQuest: 'm22_umbral_key',
    summary: 'Face King Aldric the Sundered at the top of everything.',
    intro:
      'Aldric rises from a throne split down the middle, wearing half a crown. "Another flame-licker," he says. "Kneel, or be divided."',
    outro:
      'The crown halves meet in your hands with a sound like a held breath released. Light runs down the Spire, through the Seam, into every ember in the world. The Flame roars back to life. Somewhere far below, the village of Emberfall lights its lamps without knowing why. You have cleared the story — but the Seam below the world is still open, and it is hungry.',
    objectives: [{ kind: 'kill', target: 'e_aldric', count: 1 }],
    rewards: {
      xp: 45000,
      gold: 15000,
      items: { q_sundered_crown: 1 },
      flags: ['chapter6Done'],
      unlockZone: 'abyss',
    },
  }),

  // ══ Postgame — The Abyss ═════════════════════════════════════════════
  Q({
    id: 'm24_below',
    name: 'Below Everything',
    main: true,
    chapter: 7,
    level: 45,
    prereqQuest: 'm23_aldric',
    summary: 'Descend into the Abyss.',
    intro:
      'The Seam, exposed by the sundering, leads beneath the world. Echoes of everyone who ever sought the crown drift down here, still climbing.',
    outro:
      'Echo-of-Maren smiles like sunrise through water. "The Warden guards nothing now. But endings need witnesses. Be a kind one."',
    objectives: [{ kind: 'reach', target: 'abyss' }],
    rewards: { xp: 20000, gold: 5000 },
  }),
  Q({
    id: 'm25_silence',
    name: 'The Final Silence',
    main: true,
    chapter: 7,
    level: 45,
    prereqQuest: 'm24_below',
    summary: 'Face the Warden of the Void at the bottom of the Seam.',
    intro:
      "The Warden doesn't threaten. It doesn't need to. The dark arranges itself, patient as arithmetic.",
    outro:
      "The silence, when it comes, is gentle. The Seam closes like a book finishing itself. Above, the world's flame burns steady — and this time, nobody is drinking it. You are the hero the Flame remembers.",
    objectives: [{ kind: 'kill', target: 'e_warden', count: 1 }],
    rewards: { xp: 90000, gold: 30000, items: { t_7: 1 }, flags: ['seamConquered'] },
  }),

  // ══ Side quests ══════════════════════════════════════════════════════
  Q({
    id: 'sq_rats',
    name: 'Six Less Rats',
    main: false,
    chapter: 1,
    level: 1,
    summary: 'Cull the village rats.',
    intro: 'Lyra sighs. "Rats in the grain again. Six fewer would be medicinal."',
    outro: '"Cleaner streets and calmer granaries," Lyra says. "The village thanks you."',
    objectives: [{ kind: 'kill', target: 'e_rat', count: 6 }],
    rewards: { xp: 90, gold: 60, items: { c_minor_potion: 1 } },
    giver: 'npc_lyra',
  }),
  Q({
    id: 'sq_ore',
    name: 'Ore for the Forge',
    main: false,
    chapter: 1,
    level: 2,
    prereqFlags: ['zone_whisperwood'],
    summary: "Bring Bram iron from the wood's old diggings.",
    intro:
      '"Iron runs under the Whisperwood," Bram says. "Three chunks and I can keep your edge honest."',
    outro: '"Good stock," Bram says, weighing the ore. "Now we\'re cooking."',
    objectives: [{ kind: 'collect', target: 'm_iron_chunk', count: 3 }],
    rewards: { xp: 200, gold: 150 },
    giver: 'npc_bram',
  }),
  Q({
    id: 'sq_charm',
    name: 'Charms Against Dimming',
    main: false,
    chapter: 1,
    level: 3,
    prereqFlags: ['zone_whisperwood'],
    summary: "Gather ember shards for Lyra's warding charms.",
    intro:
      '"The dimming frightens the children," Lyra says. "Ember shards make good luck-charms. Four would do."',
    outro: 'The charms go up over doorways one by one. The village glows a little prouder.',
    objectives: [{ kind: 'collect', target: 'm_ember_shard', count: 4 }],
    rewards: { xp: 220, gold: 120, items: { c_minor_potion: 2 } },
    giver: 'npc_lyra',
  }),
  Q({
    id: 'sq_locket',
    name: 'The Lost Locket',
    main: false,
    chapter: 1,
    level: 4,
    prereqFlags: ['zone_whisperwood'],
    summary: 'Recover a locket from the Woodfang spiders.',
    intro:
      '"A spider took more than my blood," a ranger mutters. "Took my mother\'s locket. Eight spiders\' worth of persuasion should get it back."',
    outro:
      "The locket, scratched but whole. The ranger doesn't say thank you. Rangers never do. But the nod lasts longer than words.",
    objectives: [{ kind: 'kill', target: 'e_spider', count: 8 }],
    rewards: { xp: 400, gold: 250, items: { t_1: 1 } },
  }),
  Q({
    id: 'sq_stag',
    name: 'The Old Guardian',
    main: false,
    chapter: 1,
    level: 5,
    prereqQuest: 'm3_roots',
    summary: 'Put the corrupted stag to rest.',
    intro:
      'Warden Tom builds a small cairn. "That stag guarded the wood before I did. Whatever\'s riding it now — end it kindly."',
    outro:
      'The stag falls like a laid-down burden. Tom adds a second cairn stone. "Rest now, old friend."',
    objectives: [{ kind: 'kill', target: 'e_stag', count: 1 }],
    rewards: { xp: 500, gold: 300, items: { c_potion: 2 } },
  }),
  Q({
    id: 'sq_boglins',
    name: 'Boglin Cull',
    main: false,
    chapter: 2,
    level: 9,
    prereqFlags: ['zone_hollowmere'],
    summary: 'Reduce the boglin swarms.',
    intro: '"Boglins travel in numbers and opinions," the Ferryman says. "Reduce both."',
    outro:
      '"Quieter water already," the Ferryman says, poling past. "Should hold a week. Maybe two."',
    objectives: [{ kind: 'kill', target: 'e_boglin', count: 10 }],
    rewards: { xp: 800, gold: 350 },
  }),
  Q({
    id: 'sq_hags',
    name: 'Cackle Season',
    main: false,
    chapter: 2,
    level: 11,
    prereqFlags: ['zone_hollowmere'],
    summary: 'Silence the Fen Hags.',
    intro:
      '"The hags sing at night," the Ferryman says. "Their songs stick to your ribs. Five silences, and the swamp sleeps."',
    outro: 'The night goes quiet. Even the frogs seem grateful.',
    objectives: [{ kind: 'kill', target: 'e_fenhag', count: 5 }],
    rewards: { xp: 1100, gold: 450, items: { c_ether: 2 } },
  }),
  Q({
    id: 'sq_scarabs',
    name: 'Gilded Problem',
    main: false,
    chapter: 3,
    level: 16,
    prereqFlags: ['zone_sunspire'],
    summary: 'Clear the gilded scarab swarms.',
    intro:
      '"Scarabs strip the clockwork for gold," Curator Ombra says. "A dozen fewer, and the city\'s heart can beat again."',
    outro: '"The gears turn easier," Ombra notes, sounding almost pleased.',
    objectives: [{ kind: 'kill', target: 'e_scarab', count: 12 }],
    rewards: { xp: 1600, gold: 600 },
  }),
  Q({
    id: 'sq_lynx',
    name: 'Spire Cats',
    main: false,
    chapter: 3,
    level: 18,
    prereqFlags: ['zone_sunspire'],
    summary: 'Deal with the Spire Lynx pack.',
    intro:
      '"The lynx were pets of the old astronomers," Ombra says. "Their children hunt pilgrims now. Six of them, and the roads open."',
    outro:
      'Ombra records six strokes in a ledger that has seen everything. "The roads thank you, in their way."',
    objectives: [{ kind: 'kill', target: 'e_spirelynx', count: 6 }],
    rewards: { xp: 2000, gold: 800, items: { t_2: 1 } },
  }),
  Q({
    id: 'sq_wraiths',
    name: 'Laid to Rest',
    main: false,
    chapter: 4,
    level: 23,
    prereqFlags: ['zone_frostpeak'],
    summary: 'Release the Frost Wraiths from their vigil.',
    intro:
      '"They froze mid-oath, all of them," Rho says. "Eight unkept promises, wandering. Unstick them."',
    outro: 'Eight oaths, released. The pass feels lighter, like a held breath let go.',
    objectives: [{ kind: 'kill', target: 'e_frostwraith', count: 8 }],
    rewards: { xp: 4000, gold: 1400 },
  }),
  Q({
    id: 'sq_yetis',
    name: 'Snowbank Diplomacy',
    main: false,
    chapter: 4,
    level: 25,
    prereqFlags: ['zone_frostpeak'],
    summary: 'Persuade the glacier yetis with extreme finality.',
    intro:
      '"Yetis respect two things," Rho says. "Size and consequences. You\'re not big. Be convincing."',
    outro:
      'Rho watches the last yeti lumber off. "Diplomacy concluded," he says. "The paperwork was your fists."',
    objectives: [{ kind: 'kill', target: 'e_yeti', count: 4 }],
    rewards: { xp: 5500, gold: 1800, items: { t_3: 1 } },
  }),
  Q({
    id: 'sq_imps',
    name: 'Ember Management',
    main: false,
    chapter: 5,
    level: 31,
    prereqFlags: ['zone_cinder'],
    summary: 'Thin the ember imp flocks.',
    intro:
      '"Imps are the Flame\'s hiccups," Sorrel says. "Fourteen fewer hiccups, and the Wastes breathe."',
    outro: 'The ash falls a little softer. Sorrel takes it as a good omen.',
    objectives: [{ kind: 'kill', target: 'e_emberimp', count: 14 }],
    rewards: { xp: 8000, gold: 2500 },
  }),
  Q({
    id: 'sq_salamanders',
    name: 'Fire Whips, Broken',
    main: false,
    chapter: 5,
    level: 33,
    prereqFlags: ['zone_cinder'],
    summary: 'Break the salamander packs.',
    intro:
      '"Salamanders herd travelers into lava," Sorrel says. "Old instinct. Eight corrections should do."',
    outro: '"The lava stays hungry," Sorrel says, "but it dines alone now."',
    objectives: [{ kind: 'kill', target: 'e_salamander', count: 8 }],
    rewards: { xp: 11000, gold: 3200, items: { t_4: 1 } },
  }),
  Q({
    id: 'sq_shades',
    name: 'Naming the Nameless',
    main: false,
    chapter: 6,
    level: 39,
    prereqFlags: ['zone_umbra'],
    summary: 'Dissolve the Umbral Shades.',
    intro: '"Shades fear names," the Archivist says. "You have a sword. Same thing, down here."',
    outro: "Fifteen names, given by force. The Spire's dark recedes a polite distance.",
    objectives: [{ kind: 'kill', target: 'e_shade', count: 15 }],
    rewards: { xp: 18000, gold: 5000 },
  }),
  Q({
    id: 'sq_echoes',
    name: 'Heroes, Honored',
    main: false,
    chapter: 7,
    level: 45,
    prereqFlags: ['zone_abyss'],
    summary: 'Lay the Echoes of Heroes to rest.',
    intro:
      '"Every echo was somebody," Echo-of-Maren says. "Ten honors, hero. Give them what they never got: an ending."',
    outro: 'Ten echoes, honored. The Abyss feels almost like a place where stories end well.',
    objectives: [{ kind: 'kill', target: 'e_echo', count: 10 }],
    rewards: { xp: 60000, gold: 15000, items: { t_7: 1 } },
  }),
  Q({
    id: 'sq_null',
    name: 'Quiet the Hounds',
    main: false,
    chapter: 7,
    level: 45,
    prereqFlags: ['zone_abyss'],
    summary: 'Hunt the Null Hounds.',
    intro:
      '"The hounds hunt echoes," Echo-of-Maren says. "Unfair, even down here. Quiet fifteen of them."',
    outro: 'The hounds fall silent. The echoes get to keep their memories a while longer.',
    objectives: [{ kind: 'kill', target: 'e_nullhound', count: 15 }],
    rewards: { xp: 70000, gold: 18000, items: { c_elixir: 2 } },
  }),
];

const QUEST_INDEX = new Map(QUESTS.map((q) => [q.id, q]));

export function quest(id: string): QuestDef | undefined {
  return QUEST_INDEX.get(id);
}

export function npc(id: string): NpcDef | undefined {
  for (
    const z of [
      'emberfall',
      'whisperwood',
      'hollowmere',
      'sunspire',
      'frostpeak',
      'cinder',
      'umbra',
      'abyss',
    ]
  ) {
    // NPCs are looked up via zones to keep a single source of truth.
    void z;
  }
  return NPC_INDEX.get(id);
}

import { ZONES } from './zones.ts';
const NPC_INDEX = new Map<string, NpcDef>(
  ZONES.flatMap((z) => z.npcs.map((n) => [n.id, n] as const)),
);
