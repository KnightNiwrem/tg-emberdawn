/**
 * Quest catalog: the main storyline (24 quests, 6 chapters + postgame) and
 * side quests. Availability is derived from prereqs, level and zone flags.
 */

import type { NpcDef, QuestDef } from './types.ts';

const Q = (q: QuestDef): QuestDef => q;

export const QUESTS: readonly QuestDef[] = [
  // ══ Chapter 1 — The Last Ember ══════════════════════════════════════
  Q({
    id: 'm1_embers',
    name: 'Sparks of Trouble',
    main: true,
    chapter: 1,
    level: 1,
    summary: 'Elder Maren asks you to thin the wolf packs — the first steps on a longer road.',
    intro:
      'Maren looks to the horizon. "The wolves grow bold as the Flame dims. Thin them, so the village keeps heart enough to hope."',
    outro:
      '"You\'ve bought us quiet nights," Maren says. "Take this — and speak to Bram. The road you\'ll walk starts at his forge."',
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
    summary: "Deliver Maren's sealed letter to Blacksmith Bram — the first clue toward the dawn.",
    intro:
      '"Take this to Bram," Maren says, pressing a wax-sealed letter into your hands. "His forge was the last to touch the Great Flame. If tomorrow can be found, his fire knows where to look."',
    outro:
      'Bram breaks the seal, reads, and hope flickers across his face. "The Flame isn\'t just dying — its tomorrow was stolen and scattered. The Whisperwood roots still carry warmth. Follow it. Find where the light went."',
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
    summary: "Cleanse the Rootbound Hollow — reclaim the wood's warmth for what comes next.",
    intro:
      'Bram arms you properly. "Follow the warm roots into the Hollow. Cut loose what\'s choking them, and the wood will remember how to grow."',
    outro:
      "The Hollow's silk slackens and greys. Warmth seeps back into the roots like blood into a numb limb — the wood exhales, and somewhere above, a bud opens out of season.",
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
    summary: "Gather ember shards — seed-stock of the dawn — for Bram's forge.",
    intro:
      'Bram says, "The wood bleeds ember-shards where the rot was cut. Bring me enough, and I\'ll forge you a blade that carries a promise: the light isn\'t gone, only scattered."',
    outro:
      'Bram quenches the shard-steel with a hiss that sounds like relief. "Chapter one closed. The swamp east carries the same rot — and maybe another piece of the dawn. Go when you\'re ready."',
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
    summary: 'Travel to Hollowmere — beyond it, word of stolen light.',
    intro:
      'The swamp swallows sound. You are meant to be here — the road to tomorrow runs straight through the dark.',
    outro:
      'The Ferryman poles you across black water. "You\'re for the Shrine, then. Everybody who still believes in morning is, eventually."',
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
    summary: 'Collect toxin samples — proof that the poisoning can be undone.',
    intro:
      '"Leeches carry the toxin whole," the Ferryman says. "Fetch samples. What can be named can be countered — and what\'s countered makes room for something better."',
    outro:
      '"That\'s the brew," the Ferryman mutters over the vials. "Drained from the Flame\'s runoff. The Tyrant didn\'t poison the swamp — he claimed its despair. Take that claim back."',
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
    summary:
      'Descend into the Sunken Shrine and end Bog Tyrant Vosk — and the despair he feeds on.',
    intro:
      '"The Shrine drowns slowly," the Ferryman says. "Hope drowns faster. Go down and raise something before the water finishes the job."',
    outro:
      "Vosk deflates with a sound like a dying bell. The water around the Shrine clears a hand's breadth — the first clean light in years, and the frogs sing like it's spring.",
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
    summary: "Hear the Ferryman's word about the ruins beyond — another piece of tomorrow waits.",
    intro:
      '"Word travels faster than boats," the Ferryman says. "There\'s a city of gears east — Sunspire. A cult there is bottling hours. Whoever holds the hours holds the future."',
    outro:
      '"Take the east road," the Ferryman says. "And mind the sentinels. They only remember half their orders — the half worth keeping, with luck."',
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
    summary: 'Reach the Sunspire Ruins, where stolen time is hoarded.',
    intro:
      'Gears the size of houses grind beneath the sand, patient as erosion. Somewhere in the desert, futures wait to be wound back into the world.',
    outro:
      'Curator Ombra looks you over like an acquisition. "Good. The Vault steals time from the Flame — tomorrow, measured in hours. Its keeper must be taught that futures belong to the living."',
    objectives: [{ kind: 'reach', target: 'sunspire' }],
    rewards: { xp: 400, gold: 200 },
  }),
  Q({
    id: 'm10_cult',
    name: 'The Hoarded Sun',
    main: true,
    chapter: 3,
    level: 16,
    prereqQuest: 'm9_spire',
    summary: "Break the Sun Cult's hold on the ruins — they worship a sun they never share.",
    intro:
      '"They call it devotion," Ombra says. "It\'s despair wearing hymns — kneeling to a sun they\'ve decided never rises for anyone else. Thin their ranks until the singing stops."',
    outro:
      'The hymns have stopped. The desert wind sounds almost like rest — and real pilgrims, the hopeful kind, begin drifting back toward the ruins.',
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
      '"The Vault only opens for its own key," Ombra says. "The automatons carry it. Break them, and we wind tomorrow\'s door open."',
    outro:
      'The last automaton folds with a sound like a struck hour. A key of cold gold light sits in the wreckage — the Sunspire Key, and it is warm on one side only. The side that faces morning.',
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
    summary: 'Enter the Vault of Hours and end the Chronolich — give the stolen hours back.',
    intro:
      "The Vault door drinks the key's light. Inside, every stolen hour ticks in the dark — futures, filed and abandoned.",
    outro:
      'The Chronolich\'s hourglass shatters, and stolen time pours out — hours return to the Flame in a ribbon of light. Ombra nods once. "North. The flame\'s twin sleeps in Frostpeak. Wake it, and winter gets an ending too."',
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
    summary: 'Cross into Frostpeak Pass, where even the cold keeps a promise.',
    intro:
      "Cold that doesn't bite so much as consider you. Above, the pass glitters blue — and under the blue, something warm is sleeping.",
    outro:
      "Rho eyes your weapons. \"You'll want more than iron where you're going. But hear me: the Maw doesn't guard the Frostfire. It guards its dreaming — and dreams are worth waking carefully.\"",
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
    summary: 'Collect Frost Emblems from the wraiths — oaths that still believe in something.',
    intro:
      '"The wraiths were wardens once," Rho says. "They froze mid-oath, still believing. Their marks still open old roads. Three, and the way to the Maw is yours."',
    outro:
      'Rho aligns the emblems, and the ice remembers a door. "The Maw is open. What sleeps inside — wake it gently. Some futures start as dreams."',
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
    summary:
      "Face Jormunis and free the Frostfire — the flame's twin, and winter's promise of spring.",
    intro:
      'The Maw breathes around you. Deep in the blue, a heartbeat made of ice — and coiled around it, the wyrm.',
    outro:
      'Jormunis uncoils one last time, and the Frostfire rises free — streaming through the mountain toward the Cinder Wastes. Winter, it turns out, was never the enemy. It was a promise waiting to thaw.',
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
    summary: 'Cross the Cinder Wastes, where a starving guardian still keeps faith.',
    intro:
      "Ash falls like snow that gave up on being cold. Somewhere under it, a heart of fire is starving — but a heart that starves is a heart that hasn't stopped.",
    outro:
      "Sorrel finds you before the imps do. \"You came with the Frostfire's wake. Then you're the one Ignivar's been burning to meet. Follow me — hope travels light, but you'll want company anyway.\"",
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
    summary: "Hear Ashen Monk Sorrel's plea — the truth behind the hunger.",
    intro:
      '"Listen before you swing," Sorrel says. "Ignivar guarded the Flame for a thousand years. Then the Sundered King began drinking it, and everyone blamed the hunger on the guardian. Despair is easy. Listen harder."',
    outro:
      '"He\'ll fight you anyway," Sorrel says quietly. "Pride burns hotter than starvation. But when he falls — and he will — know that the true thief is above the sky, in a tower that isn\'t entirely real. And that endings here have always been doorways."',
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
    summary: 'Collect Cinder Sigils — the sorrow of the faithful, honored into a lamp.',
    intro:
      '"The revenants are the Flame\'s old faithful," Sorrel says. "Their sorrow brands the ash with sigils. Bring me three — grief, honored, becomes a lamp. That\'s how we calm the Caldera."',
    outro:
      "The sigils cool in Sorrel's hands. \"The Caldera's throat is open. Go down gently. He's been waiting to be understood for a very long time — and being understood is its own dawn.\"",
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
    summary:
      "Descend the Pyre Caldera and face Ignivar — free the flame, don't just end the fight.",
    intro:
      "At the caldera's bottom, the Last Flame gutters in a cage of its own cinders. It looks up. It is so tired — and still, stubbornly, burning.",
    outro:
      'Ignivar\'s last ember drifts free — and instead of dying, it funnels upward, toward a spire that stands where the sky has a seam. "The thief," Sorrel whispers. "The Umbral Spire. Go finish this — not for vengeance. For morning."',
    objectives: [{ kind: 'kill', target: 'e_ignivar', count: 1 }],
    rewards: { xp: 20000, gold: 6500, flags: ['chapter5Done'], unlockZone: 'umbra' },
  }),

  // ══ Chapter 6 — The Dawncaller ══════════════════════════════════
  Q({
    id: 'm20_seam',
    name: 'The Space Between',
    main: true,
    chapter: 6,
    level: 38,
    prereqQuest: 'm19_ignivar',
    summary: 'Reach the Umbral Spire, raised by a man who decided tomorrow was over.',
    intro:
      'The Spire stands in the seam between light and dark — real from one angle, absence from the next. Even here, your shadow keeps pace. Hold onto that.',
    outro:
      'The Archivist\'s pen never stops moving. "The King split the Flame because he stopped believing in morning. Despair, hoarded, becomes a crown. Mend the crown, and belief comes home."',
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
    summary: 'Cut down the Crownsworn — knights still fighting a war of despair.',
    intro:
      '"They were knights once," the Archivist says. "Now they\'re the King\'s habit, still fighting his wars. Give them rest — even loyalty deserves a future."',
    outro:
      'The last of the Crownsworn kneels as it falls — not to you, but to some old, remembered king, finally let go. The stair to the throne is clear.',
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
      '"The throne room opens for the Umbral Key," the Archivist says. "The Crownsworn carry it in pieces of duty. Relieve them of it — gently, if you can manage."',
    outro:
      'The key is cold, and it opens what should stay locked. The throne room doors swing inward on a room split down the middle — half ember, half ash, and one thin line of light running down the seam.',
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
    summary: 'Face King Aldric the Sundered — despair with a crown on it.',
    intro:
      'Aldric rises from a throne split down the middle, wearing half a crown. "Another flame-licker," he says. "Kneel. I stopped waiting for dawn a hundred years ago, and I have never once regretted it."',
    outro:
      "The crown halves meet in your hands with a sound like a held breath released. Light runs down the Spire, through the Seam, into every ember in the world — and the Flame roars back to life not as it was, but as it could be. Somewhere far below, the village of Emberdawn lights its lamps without knowing why, and children sleep dreaming of mornings they've never seen. You have cleared the story — but the Seam below the world is still open, and the future is worth guarding.",
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
    summary: 'Descend into the Abyss — the future needs a witness.',
    intro:
      'The Seam, exposed by the sundering, leads beneath the world. Echoes of everyone who ever sought the crown drift down here, still climbing — still believing.',
    outro:
      'Echo-of-Maren smiles like sunrise through water. "Even I end up an echo here, it seems. Go on then, Dawncaller — the dark down there has never once met anyone like you."',
    objectives: [{ kind: 'reach', target: 'abyss' }],
    rewards: { xp: 20000, gold: 5000 },
  }),
  Q({
    id: 'm25_silence',
    name: 'Before the Dawn',
    main: true,
    chapter: 7,
    level: 45,
    prereqQuest: 'm24_below',
    summary:
      'Face the Warden of the Void at the bottom of the Seam — and come back with the morning.',
    intro:
      "The Warden doesn't threaten. It doesn't need to. The dark arranges itself, patient as arithmetic. Above you, faint but stubborn, the memory of dawn holds the rope you climbed down.",
    outro:
      "The silence, when it comes, is gentle. The Seam closes like a book finishing itself — not an ending; a period before the next sentence. Above, the world's flame burns steady, and this time, nobody is drinking it. You came looking for tomorrow. You're standing in it.",
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
    summary: 'Cull the rats haunting field and wood.',
    intro:
      'Lyra sighs. "Rats in the grain, rats at the wood\'s edge. Six fewer would be medicinal."',
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
