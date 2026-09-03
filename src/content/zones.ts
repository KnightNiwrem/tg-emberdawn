/**
 * World map: 8 zones across 6 chapters plus the postgame Abyss.
 * Explore tables weight battles vs treasure/rest/flavor/elite events.
 */

import type { ZoneDef } from './types.ts';

/** Zones a fresh character can already reach. Everything else must be
 * unlocked by quest rewards or dungeon first-clears (reachability is
 * test-guarded). */
export const STARTING_ZONES: readonly string[] = ['emberdawn', 'outskirts', 'whisperwood'];

export const ZONES: readonly ZoneDef[] = [
  {
    id: 'emberdawn',
    name: 'Emberdawn Village',
    emoji: '🏮',
    chapter: 1,
    // Band runs to 7 (#73): the village is home through the whole Aranya
    // preparation — Bram's rack stocks tier-2 steel exactly at the m5_arms
    // beat, instead of hiding it one zone deeper.
    levels: [1, 7],
    desc:
      'A village huddled around the last lit ember of the Great Flame — small, stubborn, and still planning for spring.',
    safeHaven: true,
    explore: [
      {
        kind: 'treasure',
        gold: 30,
        weight: 1,
        text: 'You find a pouch of coins dropped by a fleeing trader.',
      },
      {
        kind: 'treasure',
        item: 'c_minor_potion',
        weight: 1,
        text: 'A forgotten supply cache — a potion still sealed.',
      },
      {
        kind: 'rest',
        healPct: 0.3,
        weight: 1,
        text: 'You rest beneath a warm hearth-vent. Some HP and MP return.',
      },
      {
        kind: 'flavor',
        weight: 2,
        text: 'Ember-light flickers over the fields. The village hums, uneasily.',
      },
    ],
    npcs: [
      {
        id: 'npc_maren',
        name: 'Elder Maren',
        greeting:
          "The Flame dims a little more each season, traveler — but dim is not dark, and we are not done. If you've come to help, the Warden's board has work.",
      },
      {
        id: 'npc_bram',
        name: 'Blacksmith Bram',
        greeting:
          "Bring me ore and coin, and I'll keep your edge true. A forge is a promise that tomorrow needs tools.",
      },
      {
        id: 'npc_lyra',
        name: 'Healer Lyra',
        greeting: 'Drink, rest, mend. The Flame keeps its own — I just handle the paperwork.',
      },
    ],
  },
  {
    id: 'outskirts',
    name: 'Emberdawn Outskirts',
    emoji: '🌾',
    chapter: 1,
    levels: [1, 3],
    desc:
      'Hearth-roads and stubble fields where ember-rats and rootlings gnaw. Farmers speak of a tusked boar that took the bridge path.',
    safeHaven: false,
    explore: [
      { kind: 'battle', enemy: 'e_ember_rat', weight: 3, minPlayerLevel: 1 },
      { kind: 'battle', enemy: 'e_rootling', weight: 2, minPlayerLevel: 1 },
      { kind: 'battle', enemy: 'e_rat', weight: 2, minPlayerLevel: 1 },
      // The signposted tough one: rare, level 3, never an elite.
      { kind: 'battle', enemy: 'e_boar', weight: 1, minPlayerLevel: 2 },
      {
        kind: 'treasure',
        gold: 25,
        weight: 1,
        text: 'A dropped coin-purse swings under a fence post.',
      },
      { kind: 'rest', healPct: 0.25, weight: 1, text: 'You rest in the shade of a hay-rick.' },
      { kind: 'flavor', weight: 2, text: 'Woodsmoke drifts from the village behind you.' },
    ],
    npcs: [],
  },
  {
    id: 'whisperwood',
    name: 'Whisperwood',
    emoji: '🌲',
    chapter: 1,
    levels: [3, 9],
    desc:
      "An ancient forest whose roots still carry the Flame's warmth. The whispers have turned sour — but roots remember.",
    safeHaven: false,
    explore: [
      // Authored eligibility (#73): Whisperwood runs Lv 3–9 — a level-1 or
      // 2 player finds no hostiles here at all, and the elite is locked
      // until Lv 5 (opt-in preparation, never a random level-7 spike).
      { kind: 'battle', enemy: 'e_wolf', weight: 3, minPlayerLevel: 3 },
      { kind: 'battle', enemy: 'e_spider', weight: 3, minPlayerLevel: 3 },
      { kind: 'battle', enemy: 'e_sprite', weight: 2, minPlayerLevel: 3 },
      { kind: 'battle', enemy: 'e_boar', weight: 2, minPlayerLevel: 3 },
      { kind: 'battle', enemy: 'e_rat', weight: 2, minPlayerLevel: 3 },
      { kind: 'battle', enemy: 'e_bandit', weight: 1, minPlayerLevel: 3 },
      {
        kind: 'elite',
        enemy: 'e_stag',
        weight: 1,
        minPlayerLevel: 5,
        text: 'A massive stag with emberless eyes crashes through the brush!',
      },
      {
        kind: 'treasure',
        gold: 55,
        weight: 1,
        text: 'You spot a sprite-hoard glinting under bark.',
      },
      {
        kind: 'treasure',
        item: 'c_minor_ether',
        weight: 1,
        text: "A hollow tree hides an old caster's satchel.",
      },
      {
        kind: 'rest',
        healPct: 0.25,
        weight: 1,
        text: 'You rest beneath a warm root — one of the few still so kind.',
      },
      { kind: 'flavor', weight: 2, text: 'The leaves whisper. It sounds like counting.' },
    ],
    dungeon: {
      id: 'd_rootbound',
      name: 'Rootbound Hollow',
      emoji: '🕸️',
      desc: "The forest's root-cathedral, now strangled in silk.",
      boss: 'e_aranya',
      bossGate: { quest: 'm3_roots', requireDone: false },
      recommendedLevel: 7,
      floors: [
        // #73: the first two normal floors GUARANTEE the two Iron Chunks
        // m5_arms asks for — the quest's taught route (Mycelid iron in the
        // Hollow) must be reliable, not a 4.8% dice roll. Mycelids keep
        // their ordinary 30% bonus drop on top.
        { enemies: ['e_spider', 'e_mycelid'], treasure: { gold: 60, item: 'm_iron_chunk' } },
        { enemies: ['e_mycelid', 'e_thornling'], treasure: { item: 'm_iron_chunk' } },
        { enemies: ['e_thornling', 'e_spider', 'e_mycelid'], treasure: { item: 'c_potion' } },
      ],
      firstClear: { xp: 400, gold: 250, item: 't_12', flags: ['rootboundCleared'] },
    },
    npcs: [
      {
        id: 'npc_warden_tom',
        name: 'Warden Tom',
        greeting: 'Keep to the paths. The Hollow ate two rangers this moon.',
      },
      {
        id: 'npc_pell',
        name: 'Ranger Pell',
        greeting: 'You walk loud. The wood forgives it — spiders don’t. Speak, or move on.',
      },
    ],
  },
  {
    id: 'hollowmere',
    name: 'Hollowmere Swamp',
    emoji: '🌫️',
    chapter: 2,
    levels: [9, 16],
    desc:
      'A drowned lowland where the water burns cold with toxin. Something crowned itself here — but crowns come off.',
    safeHaven: false,
    explore: [
      { kind: 'battle', enemy: 'e_boglin', weight: 3 },
      { kind: 'battle', enemy: 'e_leech', weight: 3 },
      { kind: 'battle', enemy: 'e_fenhag', weight: 2 },
      { kind: 'battle', enemy: 'e_sludge', weight: 2 },
      { kind: 'battle', enemy: 'e_wisp', weight: 2 },
      {
        kind: 'elite',
        enemy: 'e_mireclaw',
        weight: 1,
        text: 'The mire erupts — a Mireclaw the size of a longboat!',
      },
      {
        kind: 'treasure',
        gold: 110,
        weight: 1,
        text: "A sunken trader's strongbox, half-buried in peat.",
      },
      {
        kind: 'treasure',
        item: 'c_antidote',
        weight: 1,
        text: "A hedgewitch's abandoned kit still holds a tonic.",
      },
      {
        kind: 'rest',
        healPct: 0.2,
        weight: 1,
        text: 'You boil swamp water and rest. Barely restful.',
      },
      {
        kind: 'flavor',
        weight: 2,
        text: 'Bubbles rise and pop in a rhythm. Almost like breathing.',
      },
    ],
    dungeon: {
      id: 'd_sunken',
      name: 'Sunken Shrine',
      emoji: '🌊',
      desc: 'A temple to the Flame, drowned when the swamp crept in.',
      boss: 'e_vosk',
      bossGate: { quest: 'm7_tyrant', requireDone: false },
      recommendedLevel: 14,
      floors: [
        { enemies: ['e_drowned', 'e_boglin'], treasure: { gold: 140 } },
        { enemies: ['e_drowned', 'e_serpent'], treasure: { item: 'c_ether' } },
        { enemies: ['e_serpent', 'e_drowned', 'e_leech'] },
      ],
      firstClear: { xp: 1400, gold: 700, item: 't_13', flags: ['sunkenCleared'] },
    },
    npcs: [
      {
        id: 'npc_ferryman',
        name: 'The Ferryman',
        greeting:
          "Coin for crossing, truth for free: don't drink the water, don't kneel to the Tyrant.",
      },
    ],
  },
  {
    id: 'sunspire',
    name: 'Sunspire Ruins',
    emoji: '🏛️',
    chapter: 3,
    levels: [16, 23],
    desc:
      'A desert city of solar clockwork, abandoned by its people and inherited by a cult. The gears still turn. So will tomorrow.',
    safeHaven: false,
    explore: [
      { kind: 'battle', enemy: 'e_scarab', weight: 3 },
      { kind: 'battle', enemy: 'e_sentinel', weight: 2 },
      { kind: 'battle', enemy: 'e_vulture', weight: 2 },
      { kind: 'battle', enemy: 'e_cultist', weight: 3 },
      { kind: 'battle', enemy: 'e_spirelynx', weight: 2 },
      { kind: 'battle', enemy: 'e_automaton', weight: 2 },
      {
        kind: 'treasure',
        gold: 220,
        weight: 1,
        text: 'A tribute chest the cultists never came back for.',
      },
      {
        kind: 'treasure',
        item: 'c_potion',
        weight: 1,
        text: "A pilgrim's pack, neatly packed and long abandoned.",
      },
      {
        kind: 'rest',
        healPct: 0.25,
        weight: 1,
        text: "The sundial's shadow is cool. You rest within it.",
      },
      { kind: 'flavor', weight: 2, text: 'Gears turn somewhere underground, patient as erosion.' },
    ],
    dungeon: {
      id: 'd_vault',
      name: 'Vault of Hours',
      emoji: '⏳',
      desc: "The city's time-vault. Every hour stolen from the Flame is kept here.",
      boss: 'e_chronolich',
      bossGate: { quest: 'm12_chronolich', requireDone: false, item: 'q_sunspire_key' },
      recommendedLevel: 21,
      floors: [
        { enemies: ['e_chronowisp', 'e_automaton'], treasure: { gold: 260 } },
        { enemies: ['e_automaton', 'e_chronowisp', 'e_sentinel'] },
        { enemies: ['e_automaton', 'e_chronowisp'], treasure: { item: 'c_greater_potion' } },
      ],
      firstClear: { xp: 3600, gold: 1600, item: 't_14', flags: ['vaultCleared'] },
    },
    npcs: [
      {
        id: 'npc_curator',
        name: 'Curator Ombra',
        greeting: 'Every relic here once told the time. Now they just tell the end of it.',
      },
    ],
  },
  {
    id: 'frostpeak',
    name: 'Frostpeak Pass',
    emoji: '🏔️',
    chapter: 4,
    levels: [23, 31],
    desc: "A frozen mountain pass where the Flame's twin — the Frostfire — sleeps in the ice.",
    safeHaven: false,
    explore: [
      { kind: 'battle', enemy: 'e_icebat', weight: 3 },
      { kind: 'battle', enemy: 'e_bristlehorn', weight: 2 },
      { kind: 'battle', enemy: 'e_marauder', weight: 3 },
      { kind: 'battle', enemy: 'e_frostwraith', weight: 2 },
      { kind: 'battle', enemy: 'e_iceling', weight: 2 },
      {
        kind: 'elite',
        enemy: 'e_yeti',
        weight: 1,
        text: 'The snowbank stands up. It has opinions about visitors.',
      },
      { kind: 'treasure', gold: 380, weight: 1, text: 'A frozen caravan, its strongbox intact.' },
      {
        kind: 'treasure',
        item: 'c_greater_potion',
        weight: 1,
        text: 'Supplies left by a doomed expedition, still good.',
      },
      {
        kind: 'rest',
        healPct: 0.2,
        weight: 1,
        text: 'You huddle by a fire that burns blue and low. Frostfire keeps you.',
      },
      { kind: 'flavor', weight: 2, text: 'The wind carries a lullaby older than the village.' },
    ],
    dungeon: {
      id: 'd_glacier',
      name: 'The Glacier Maw',
      emoji: '🧊',
      desc: 'A blue cave that breathes. Deep inside, a heartbeat made of ice.',
      boss: 'e_jormunis',
      bossGate: { quest: 'm15_wyrm', requireDone: false },
      recommendedLevel: 29,
      floors: [
        { enemies: ['e_iceling', 'e_frostwraith'], treasure: { gold: 420 } },
        {
          enemies: ['e_yeti', 'e_frostwraith', 'e_iceling'],
          treasure: { item: 'c_greater_ether' },
        },
        { enemies: ['e_yeti', 'e_marauder', 'e_iceling'] },
      ],
      firstClear: { xp: 9000, gold: 3200, item: 't_15', flags: ['glacierCleared'] },
    },
    npcs: [
      {
        id: 'npc_outcast',
        name: 'Ice-Outcast Rho',
        greeting:
          "The wyrm isn't cruel. It's cold in the way mountains are cold. Don't take it personal.",
      },
    ],
  },
  {
    id: 'cinder',
    name: 'Cinder Wastes',
    emoji: '🌋',
    chapter: 5,
    levels: [31, 39],
    desc:
      "Ash dunes around a dying caldera. The Flame's greatest child hides here, starving — and a heart that starves is a heart that hasn't stopped.",
    safeHaven: false,
    explore: [
      { kind: 'battle', enemy: 'e_magmaslime', weight: 3 },
      { kind: 'battle', enemy: 'e_emberimp', weight: 3 },
      { kind: 'battle', enemy: 'e_cinderhound', weight: 3 },
      { kind: 'battle', enemy: 'e_revenant', weight: 2 },
      { kind: 'battle', enemy: 'e_salamander', weight: 2 },
      {
        kind: 'elite',
        enemy: 'e_forge_warden',
        weight: 1,
        text: 'A Forge Warden, still guarding a smithy that burned down centuries ago.',
      },
      {
        kind: 'treasure',
        gold: 650,
        weight: 1,
        text: 'Ash settles to reveal a vein of gold leaf.',
      },
      {
        kind: 'treasure',
        item: 'c_super_potion',
        weight: 1,
        text: "A sealed alchemist's case, warded against the heat.",
      },
      {
        kind: 'rest',
        healPct: 0.25,
        weight: 1,
        text: 'You shelter behind a magma vein and let its warmth knit you.',
      },
      { kind: 'flavor', weight: 2, text: 'The ash falls softly, like the sky is apologizing.' },
    ],
    dungeon: {
      id: 'd_pyre',
      name: 'Pyre Caldera',
      emoji: '🔥',
      desc:
        "The caldera's throat. At the bottom, the Last Flame gutters in a cage of its own making.",
      boss: 'e_ignivar',
      bossGate: { quest: 'm19_ignivar', requireDone: false },
      recommendedLevel: 37,
      floors: [
        { enemies: ['e_cinderhound', 'e_salamander'], treasure: { gold: 700 } },
        {
          enemies: ['e_forge_warden', 'e_revenant', 'e_salamander'],
          treasure: { item: 'c_phoenix_feather' },
        },
        { enemies: ['e_magmaslime', 'e_forge_warden', 'e_revenant'] },
      ],
      firstClear: { xp: 20000, gold: 6500, item: 't_16', flags: ['pyreCleared'] },
    },
    npcs: [
      {
        id: 'npc_ashen',
        name: 'Ashen Monk Sorrel',
        greeting:
          'Ignivar does not want to fight you. But he will, because everything here wants him dead.',
      },
    ],
  },
  {
    id: 'umbra',
    name: 'Umbral Spire',
    emoji: '🌑',
    chapter: 6,
    levels: [39, 45],
    desc:
      'A tower standing in the space between flame and shadow, where the Sundered King waits — and where the seam lets in one thin, stubborn light.',
    safeHaven: false,
    explore: [
      { kind: 'battle', enemy: 'e_shade', weight: 3 },
      { kind: 'battle', enemy: 'e_watcher', weight: 2 },
      { kind: 'battle', enemy: 'e_shattered', weight: 3 },
      { kind: 'battle', enemy: 'e_horror', weight: 2 },
      { kind: 'battle', enemy: 'e_nightgaunt', weight: 2 },
      { kind: 'battle', enemy: 'e_crownsworn', weight: 2 },
      {
        kind: 'elite',
        enemy: 'e_regalia',
        weight: 1,
        text: 'A Regalia Guardian, still perfect, still loyal, still wrong.',
      },
      {
        kind: 'treasure',
        gold: 1100,
        weight: 1,
        text: "Tribute stacked by the King's unseen servants.",
      },
      {
        kind: 'treasure',
        item: 'c_elixir',
        weight: 1,
        text: 'A vial of dawnlight, hoarded against the dark.',
      },
      {
        kind: 'rest',
        healPct: 0.2,
        weight: 1,
        text: 'You rest where a torch once stood. Even the memory of fire helps.',
      },
      { kind: 'flavor', weight: 2, text: 'Your shadow moves a half-second late here.' },
    ],
    dungeon: {
      id: 'd_throne',
      name: 'The Sundered Throne',
      emoji: '👑',
      desc: 'The throne room at the top of everything, split down the middle like its king.',
      boss: 'e_aldric',
      bossGate: { quest: 'm23_aldric', requireDone: false },
      recommendedLevel: 43,
      floors: [
        { enemies: ['e_crownsworn', 'e_shattered'], treasure: { gold: 1200 } },
        { enemies: ['e_nightgaunt', 'e_horror', 'e_regalia'], treasure: { item: 'c_elixir' } },
        { enemies: ['e_crownsworn', 'e_regalia', 'e_watcher'] },
      ],
      firstClear: { xp: 45000, gold: 15000, item: 't_17', flags: ['crownRestored'] },
    },
    npcs: [
      {
        id: 'npc_archivist',
        name: 'The Archivist',
        greeting:
          'I record what the flame remembers. It remembers you, a little. Keep making it worth remembering.',
      },
    ],
  },
  {
    id: 'abyss',
    name: 'The Abyss',
    emoji: '🌌',
    chapter: 7,
    levels: [45, 45],
    desc:
      'The seam beneath the world, exposed when the crown was sundered. What fell through still climbs, and someone has to guard the morning.',
    safeHaven: false,
    explore: [
      { kind: 'battle', enemy: 'e_voidspawn', weight: 3 },
      { kind: 'battle', enemy: 'e_nullhound', weight: 3 },
      { kind: 'battle', enemy: 'e_echo', weight: 2 },
      {
        kind: 'elite',
        enemy: 'e_warden',
        weight: 1,
        text: 'The dark organizes itself into a Warden. This will hurt.',
      },
      {
        kind: 'treasure',
        gold: 1600,
        weight: 1,
        text: 'Value is a habit. The void indulges it, sometimes.',
      },
      {
        kind: 'treasure',
        item: 'm_void_fragment',
        weight: 1,
        text: 'A fragment of the space between, cold in your palm.',
      },
      {
        kind: 'rest',
        healPct: 0.15,
        weight: 1,
        text: "You dream by a fire that isn't there, and wake partly restored.",
      },
      {
        kind: 'flavor',
        weight: 2,
        text: "Somewhere, an echo of a hero draws a sword you'll never see.",
      },
    ],
    dungeon: {
      id: 'd_seam',
      name: 'The Endless Seam',
      emoji: '🕳️',
      desc: "The void's own wound, crawling with what fell through. Cleared trials repeat.",
      boss: 'e_warden',
      bossGate: { quest: 'm25_silence', requireDone: false },
      recommendedLevel: 43,
      floors: [
        { enemies: ['e_voidspawn', 'e_nullhound'], treasure: { gold: 1800 } },
        { enemies: ['e_echo', 'e_voidspawn', 'e_nullhound'], treasure: { item: 'c_elixir' } },
        { enemies: ['e_echo', 'e_nullhound', 'e_voidspawn'] },
      ],
      firstClear: { xp: 90000, gold: 30000, item: 't_18', flags: ['seamCleared'] },
    },
    npcs: [
      {
        id: 'npc_echo',
        name: 'Echo of Maren',
        greeting:
          'Even I end up as an echo here, it seems. Go on then, hero — the seam likes you better than most.',
      },
    ],
  },
];

const ZONE_INDEX = new Map(ZONES.map((z) => [z.id, z]));

export function zone(id: string): ZoneDef | undefined {
  return ZONE_INDEX.get(id);
}
