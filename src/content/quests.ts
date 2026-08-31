/**
 * Quest catalog: the main storyline (25 quests, 6 chapters + postgame) and
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
    rewards: { xp: 120, gold: 80, items: { q_sealed_letter: 1 } },
    startNpc: 'npc_maren',
    finishNpc: 'npc_maren',
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
    objectives: [
      { kind: 'collect', target: 'q_sealed_letter', count: 1 },
      { kind: 'talk', target: 'npc_bram' },
    ],
    rewards: { xp: 150, gold: 100, items: { c_potion: 1 } },
    // The canonical delivery flow (#63): Maren starts it, Bram finishes it.
    startNpc: 'npc_maren',
    finishNpc: 'npc_bram',
  }),
  Q({
    id: 'm3_roots',
    startNpc: 'npc_bram',
    finishNpc: 'npc_bram',
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
    startNpc: 'npc_bram',
    finishNpc: 'npc_bram',
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
    // Destination quest (#66): Bram sends you east; the Ferryman completes
    // the journey in Hollowmere. The road IS the quest.
    startNpc: 'npc_bram',
    finishNpc: 'npc_ferryman',
    name: 'Into the Fen',
    main: true,
    chapter: 2,
    level: 9,
    prereqQuest: 'm4_blessing',
    summary: 'Travel to Hollowmere — beyond it, word of stolen light.',
    intro:
      '"East of the wood the water turns dark and thoughtful," Bram says, handing over the blade he promised. "A man still poles a ferry through the Hollowmere fen. Roads that drowned still lead somewhere — go find the piece of tomorrow the swamp kept warm."',
    outro:
      'The Ferryman poles you across black water. "You\'re for the Shrine, then. Everybody who still believes in morning is, eventually."',
    objectives: [{ kind: 'reach', target: 'hollowmere' }],
    rewards: { xp: 300, gold: 150 },
  }),
  Q({
    id: 'm6_toxin',
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
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
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
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
    rewards: { xp: 1400, gold: 700, flags: ['chapter2Done'] },
  }),
  Q({
    id: 'm8_passage',
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
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
    rewards: { xp: 500, gold: 250, unlockZone: 'sunspire' },
  }),

  // ══ Chapter 3 — The City of Gears ════════════════════════════════════
  Q({
    id: 'm9_spire',
    // Destination quest (#66): the Ferryman's summons points east; Ombra
    // receives you in Sunspire.
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_curator',
    name: 'City of Gears',
    main: true,
    chapter: 3,
    level: 15,
    prereqQuest: 'm8_passage',
    summary: 'Reach the Sunspire Ruins, where stolen time is hoarded.',
    intro:
      '"You heard my word about the gears — now go stand under them," the Ferryman says, poling for the far shore. "A Curator keeps honest ledgers in a dishonest city. Show him the swamp still sends believers east."',
    outro:
      'Curator Ombra looks you over like an acquisition. "Good. The Vault steals time from the Flame — tomorrow, measured in hours. Its keeper must be taught that futures belong to the living."',
    objectives: [{ kind: 'reach', target: 'sunspire' }],
    rewards: { xp: 400, gold: 200 },
  }),
  Q({
    id: 'm10_cult',
    startNpc: 'npc_curator',
    finishNpc: 'npc_curator',
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
    startNpc: 'npc_curator',
    finishNpc: 'npc_curator',
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
    startNpc: 'npc_curator',
    finishNpc: 'npc_curator',
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
    // Destination quest (#66): Ombra points north; Rho receives you at the
    // pass.
    startNpc: 'npc_curator',
    finishNpc: 'npc_outcast',
    name: 'The Frozen Road',
    main: true,
    chapter: 4,
    level: 22,
    prereqQuest: 'm12_chronolich',
    summary: 'Cross into Frostpeak Pass, where even the cold keeps a promise.',
    intro:
      '"North," Ombra says, closing the Vault\'s ledger behind you. "Frostpeak keeps the flame\'s twin under blue ice, and an outcast named Rho keeps watch over the pass — the mountain froze everyone else\'s promises but his. Wake what winter only pretended to bury."',
    outro:
      "Rho eyes your weapons. \"You'll want more than iron where you're going. But hear me: the Maw doesn't guard the Frostfire. It guards its dreaming — and dreams are worth waking carefully.\"",
    objectives: [{ kind: 'reach', target: 'frostpeak' }],
    rewards: { xp: 600, gold: 300 },
  }),
  Q({
    id: 'm14_emblem',
    startNpc: 'npc_outcast',
    finishNpc: 'npc_outcast',
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
    startNpc: 'npc_outcast',
    finishNpc: 'npc_outcast',
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
    // Destination quest (#66): Rho sends you down from the pass; Sorrel
    // receives you in the Wastes.
    startNpc: 'npc_outcast',
    finishNpc: 'npc_ashen',
    name: 'Through the Ash',
    main: true,
    chapter: 5,
    level: 30,
    prereqQuest: 'm15_wyrm',
    summary: 'Cross the Cinder Wastes, where a starving guardian still keeps faith.',
    intro:
      '"South of the glacier the world burned and stubbornly kept going," Rho says. "The Cinder Wastes hide a monk named Sorrel, tending a starving flame nobody else would feed. Tell him the Frostfire lives — proof travels better than hope alone."',
    outro:
      "Sorrel finds you before the imps do. \"You came with the Frostfire's wake. Then you're the one Ignivar's been burning to meet. Follow me — hope travels light, but you'll want company anyway.\"",
    objectives: [{ kind: 'reach', target: 'cinder' }],
    rewards: { xp: 900, gold: 450 },
  }),
  Q({
    id: 'm17_plea',
    startNpc: 'npc_ashen',
    finishNpc: 'npc_ashen',
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
    startNpc: 'npc_ashen',
    finishNpc: 'npc_ashen',
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
    startNpc: 'npc_ashen',
    finishNpc: 'npc_ashen',
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
    // Destination quest (#66): Sorrel sends you up from the Wastes; the
    // Archivist receives you at the Spire.
    startNpc: 'npc_ashen',
    finishNpc: 'npc_archivist',
    name: 'The Space Between',
    main: true,
    chapter: 6,
    level: 38,
    prereqQuest: 'm19_ignivar',
    summary: 'Reach the Umbral Spire, raised by a man who decided tomorrow was over.',
    intro:
      '"The thief keeps a tower in the seam of the sky," Sorrel says. "An Archivist stacks his yesterdays up there and calls the pile a future. Climb, Dawncaller — make the man remember what hours are FOR."',
    outro:
      'The Archivist\'s pen never stops moving. "The King split the Flame because he stopped believing in morning. Despair, hoarded, becomes a crown. Mend the crown, and belief comes home."',
    objectives: [{ kind: 'reach', target: 'umbra' }],
    rewards: { xp: 1500, gold: 700 },
  }),
  Q({
    id: 'm21_loyalty',
    startNpc: 'npc_archivist',
    finishNpc: 'npc_archivist',
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
    startNpc: 'npc_archivist',
    finishNpc: 'npc_archivist',
    name: 'The Unlocked Door',
    main: true,
    chapter: 6,
    level: 40,
    prereqQuest: 'm21_loyalty',
    summary: 'Take counsel with the Archivist before climbing to the throne.',
    intro:
      '"The Crownsworn carried a key out of habit," the Archivist says, "but grief was the only lock. Before you climb — let me tell you what the last king chose to forget."',
    outro:
      '"The door was never locked," the Archivist says, "only mourned shut." The throne room doors swing inward on a room split down the middle — half ember, half ash, and one thin line of light running down the seam.',
    objectives: [{ kind: 'talk', target: 'npc_archivist' }],
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
      '"The stair is clear and the hour is yours," the Archivist says, pen motionless for the first time. "Up there sits a man who decided a hundred years ago that morning was a rumor. Do not hate him — out-wait him. Crowns break where patience will not."',
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
    // The Archivist is the throne-room send-off and the completion contact:
    // Aldric himself is a boss encounter, not a dialogue NPC (#63).
    startNpc: 'npc_archivist',
    finishNpc: 'npc_archivist',
  }),

  // ══ Postgame — The Abyss ═════════════════════════════════════════════
  Q({
    id: 'm24_below',
    // Destination quest (#66): the Archivist sends you below; Echo-of-Maren
    // receives you in the Abyss.
    startNpc: 'npc_archivist',
    finishNpc: 'npc_echo',
    name: 'Below Everything',
    main: true,
    chapter: 7,
    level: 45,
    prereqQuest: 'm23_aldric',
    summary: 'Descend into the Abyss — the future needs a witness.',
    intro:
      '"The sundering opened a seam beneath the world," the Archivist says, pen still at last. "Echoes drift down it — everyone who ever sought the crown, still climbing, still believing. One of them wears Maren\'s face. Go down and bear witness: the future is worth guarding, even from below."',
    outro:
      'Echo-of-Maren smiles like sunrise through water. "Even I end up an echo here, it seems. Go on then, Dawncaller — the dark down there has never once met anyone like you."',
    objectives: [{ kind: 'reach', target: 'abyss' }],
    rewards: { xp: 20000, gold: 5000 },
  }),
  Q({
    id: 'm25_silence',
    startNpc: 'npc_echo',
    finishNpc: 'npc_echo',
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
    startNpc: 'npc_lyra',
    finishNpc: 'npc_lyra',
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
    startNpc: 'npc_bram',
    finishNpc: 'npc_bram',
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
    startNpc: 'npc_lyra',
    finishNpc: 'npc_lyra',
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
      '"A spider took more than my blood," Ranger Pell mutters, sharpening a knife that has seen this argument before. "Took my mother\'s locket. Eight spiders\' worth of persuasion should get it back."',
    outro:
      "The locket, scratched but whole. Pell doesn't say thank you. Rangers never do. But the nod lasts longer than words.",
    objectives: [{ kind: 'kill', target: 'e_spider', count: 8 }],
    rewards: { xp: 400, gold: 250, items: { t_1: 1 } },
    // The anonymous ranger is now a real, placed contact (#63).
    startNpc: 'npc_pell',
    finishNpc: 'npc_pell',
  }),
  Q({
    id: 'sq_stag',
    startNpc: 'npc_warden_tom',
    finishNpc: 'npc_warden_tom',
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
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
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
    startNpc: 'npc_ferryman',
    finishNpc: 'npc_ferryman',
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
    startNpc: 'npc_curator',
    finishNpc: 'npc_curator',
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
    startNpc: 'npc_curator',
    finishNpc: 'npc_curator',
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
    startNpc: 'npc_outcast',
    finishNpc: 'npc_outcast',
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
    startNpc: 'npc_outcast',
    finishNpc: 'npc_outcast',
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
    startNpc: 'npc_ashen',
    finishNpc: 'npc_ashen',
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
    startNpc: 'npc_ashen',
    finishNpc: 'npc_ashen',
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
    startNpc: 'npc_archivist',
    finishNpc: 'npc_archivist',
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
    startNpc: 'npc_echo',
    finishNpc: 'npc_echo',
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
    startNpc: 'npc_echo',
    finishNpc: 'npc_echo',
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
