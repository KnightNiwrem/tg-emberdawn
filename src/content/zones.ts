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
    aftermath: [{
      'when': { 'flag': { 'id': 'crownRestored' } },
      'text':
        'Sunlight reaches the village hearth. Farmers carry the saved grain out to the fields, and Lyra opens the sickroom shutters.',
    }, {
      'when': { 'flag': { 'id': 'chapter1Done' } },
      'text':
        'The hearth burns steadily above the repaired channel. Bram has set the spare tools outside his forge; the farmers are preparing the next planting.',
    }],
    name: 'Emberdawn Village',
    emoji: '🏮',
    chapter: 1,
    // Band runs to 7 (#73): the village is home through the whole Aranya
    // preparation — Bram's rack stocks tier-2 steel exactly at the m5_arms
    // beat, instead of hiding it one zone deeper.
    levels: [1, 7],
    desc:
      'A shared hearth stands in the village square. Seed sacks wait under patched roofs; beyond them lie fields the farmers still intend to plant.',
    safeHaven: true,
    services: { shop: 'shop_bram', forge: 'forge_bram' },
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
        text: 'You rest beside the shared hearth while someone hangs wet gloves above the vent.',
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
        greeting: 'Come warm your hands. The village has work for us both. Tell me what you need.',
        topics: [
          {
            'id': 'maren_dawn',
            'label': 'Ask about the first full sunrise',
            'when': { 'flag': { 'id': 'crownRestored' } },
            'text':
              '“We opened the grain sacks this morning. For sowing, this time. Lyra says the children want to see what grows first. I will tell them about everyone who helped you reach the crown. Come sit awhile. You have brought the light home.”',
          },
          {
            id: 'maren_flame',
            label: 'Ask about the Great Flame',
            text: '',
            dialogue: 'dlg_maren_flame',
            when: { not: { flag: { id: 'crownRestored' } } },
          },
        ],
      },
      {
        id: 'npc_bram',
        name: 'Blacksmith Bram',
        greeting: 'Tools for the fields, equipment for the road. Tell me what needs doing.',
        topics: [{
          id: 'bram_forge',
          label: 'Ask about the forge',
          text: '',
          dialogue: 'dlg_bram_forge',
        }],
      },
      {
        id: 'npc_lyra',
        name: 'Healer Lyra',
        greeting: 'Clean water first. Then sit down and tell me where it hurts.',
        topics: [{
          id: 'lyra_work',
          label: 'Ask about her work',
          text:
            '“The cold brings fevers, and hunger makes them linger. I can mend a scrape. Keeping a child well takes clean food, a warm bed, and someone who comes back to check. That is why I ask travelers for help with ordinary things.”',
        }],
      },
    ],
  },
  {
    id: 'outskirts',
    aftermath: [{
      'when': { 'flag': { 'id': 'crownRestored' } },
      'text':
        'New furrows cross the fields around the repaired seed sheds. Rats still shelter in the hedges, but the farmers have begun planting again.',
    }],
    name: 'Emberdawn Outskirts',
    emoji: '🌾',
    chapter: 1,
    levels: [1, 3],
    desc:
      'Scorched fence posts divide the stubble fields. Rats shelter beneath grain sheds, and a tusked boar has churned the bridge path into mud.',
    safeHaven: false,
    lootTable: 'dt_ember_fields',
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
    aftermath: [{
      'when': { 'flag': { 'id': 'rootboundCleared' } },
      'text':
        'Fresh buds push through the loosened silk near the Hollow. Its root channel runs warm again. Surviving broods still haunt the forest paths.',
    }],
    name: 'Whisperwood',
    emoji: '🌲',
    chapter: 1,
    levels: [3, 9],
    desc:
      'Old roots break through the forest paths, warm beneath their bark. Dense silk covers the entrance to the Rootbound Hollow below the trees.',
    safeHaven: false,
    lootTable: 'dt_whisper_roots',
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
      {
        kind: 'flavor',
        weight: 2,
        text: 'Old path marks show through the bark where the rangers have cleared away moss.',
      },
    ],
    dungeon: {
      id: 'd_rootbound',
      name: 'Rootbound Hollow',
      emoji: '🕸️',
      desc:
        'A buried meeting of the hearth roots. Spider silk seals the warm channels beneath the forest.',
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
        greeting: 'Stay where I can see you until we have talked. The paths need watching.',
        topics: [{
          id: 'tom_wood',
          label: 'Ask about the wood',
          text:
            "“The roots carried hearth warmth long before we built our shelters here. Aranya's brood found that warmth and nested around it. The King's theft weakened the forest; the brood made a local wound worse. Clearing one does not excuse the other.”",
        }],
      },
      {
        id: 'npc_pell',
        name: 'Ranger Pell',
        greeting: 'Stop there. Web across the next branch. Tell me what you saw.',
        topics: [{
          id: 'pell_spiders',
          label: 'Ask about the spiders',
          text:
            "“Woodfangs wrap what they cannot eat. Packs. Buckles. My mother's locket. Look at the webbing they carry, not just the holes they leave. I have spent too long tracking them alone.”",
        }],
      },
    ],
  },
  {
    id: 'mirefoot',
    aftermath: [{
      'when': { 'flag': { 'id': 'chapter2Done' } },
      'text':
        'Clean current moves beneath the landing. Odo sorts a new shipment of tools while the ferry crews repair the downstream moorings.',
    }],
    name: 'Mirefoot Landing',
    emoji: '⛺',
    chapter: 2,
    levels: [9, 16],
    desc:
      "Dry planks and raised shelters mark the swamp's edge. Odo repairs boat fittings beside a ropewalk; beyond the landing, painted poles mark the road into the fen.",
    safeHaven: true,
    services: { forge: 'forge_ropewalk' },
    explore: [
      {
        kind: 'treasure',
        gold: 45,
        weight: 1,
        text: 'A boatman\u2019s tithe-jar under the boards holds a few honest coins.',
      },
      {
        kind: 'treasure',
        item: 'c_antidote',
        weight: 1,
        text: 'The landing\u2019s shared kit-box still holds a sealed tonic.',
      },
      {
        kind: 'rest',
        healPct: 0.3,
        weight: 1,
        text: 'You rest on dry planks over clean water. The fen keeps its distance.',
      },
      {
        kind: 'flavor',
        weight: 2,
        text: 'Frogs sing off-beat. Odo\u2019s hammer keeps better time.',
      },
    ],
    npcs: [
      {
        id: 'npc_odo',
        name: 'Odo the Slowsmith',
        greeting:
          'Set it down. I would rather spend time on the rivet than send you out with a leaking boat.',
        topics: [{
          id: 'odo_craft',
          label: 'Ask about the ropewalk forge',
          text:
            '“I came here to repair one ferry. Then the road drowned and everyone needed a boat. So I built the ropewalk forge. Once the shrine keepers can send tools downriver again, I can take on heavier work. Until then, a sound crossing is enough to be proud of.”',
        }],
      },
    ],
  },
  {
    id: 'hollowmere',
    aftermath: [{
      'when': { 'flag': { 'id': 'sunkenCleared' } },
      'text':
        'The shrine sluices are running. Clear water cuts a narrow course through the fen; the drowned houses and the creatures sheltering in them remain.',
    }],
    name: 'Hollowmere Swamp',
    emoji: '🌫️',
    chapter: 2,
    levels: [9, 16],
    desc:
      'Roof ridges rise from brown water. Ferry poles lead between the drowned houses toward the Sunken Shrine and its blocked waterworks.',
    safeHaven: false,
    lootTable: 'dt_mire_roads',
    services: { shop: 'shop_ferry' },
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
      desc:
        'The drowned shrine was built above a warm spring. Its sluices once carried clean water across the lowland.',
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
        greeting: 'Watch the loose board. I have room for your news as well as your baggage.',
        topics: [{
          id: 'ferry_water',
          label: 'Ask about the water',
          text:
            '“This was farmland. When the hearth channels failed, the spring lost its current and the low ground flooded. Vosk dammed the warm water left beneath the shrine. His claim made a bad season into a business. The keepers are trying to put water back where people can use it.”',
        }, {
          id: 'ferry_promise',
          label: 'Choose a shrine task',
          dialogue: 'dlg_ferry_promise',
          // The pledge exists only while it is carried and unanswered
          // (#132, #147): the topic requires the pledge parent quest ACTIVE
          // (the shared question the player accepted from the Ferryman)
          // and hides the moment the decision is in the ledger — the
          // aftermath topic below takes over.
          when: {
            all: [
              { not: { decision: { id: 'ferry_shrine_pledge' } } },
              { questStatus: { questId: 'sq_shrine_pledge', is: 'active' } },
            ],
          },
        }, {
          id: 'ferry_ledger',
          label: 'Ask about my shrine work',
          dialogue: 'dlg_ferry_aftermath',
          // The ledger's aftermath (#132): reacts to the recorded decision
          // and to the beacon route's named resolution.
          when: { decision: { id: 'ferry_shrine_pledge' } },
        }],
      },
    ],
  },
  {
    id: 'sunspire',
    aftermath: [{
      'when': { 'flag': { 'id': 'vaultCleared' } },
      'text':
        'The clocks advance through the afternoon. Ombra has set seed trays in the returning light, while caravans pick their way through the damaged streets.',
    }],
    name: 'Sunspire Ruins',
    emoji: '🏛️',
    chapter: 3,
    levels: [16, 23],
    desc:
      'Brass channels cross the streets of a ruined clockwork city. Water jars stand beside broken sundials; below the paving lies the Vault of Hours.',
    safeHaven: false,
    lootTable: 'dt_sun_flats',
    services: { shop: 'shop_bazaar' },
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
      desc:
        "The old city's daylight store, turned into a hoard for the crown. The keeper's hourglass stands in its deepest chamber.",
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
        greeting: 'Set anything fragile on the cloth. News can go straight into the record.',
        topics: [{
          id: 'ombra_records',
          label: 'Ask about the ledgers',
          text:
            "“I keep names beside the stolen things. A clock without its owner is a curiosity; a clock taken from a family tells us who needs it back. Aldric's collectors preferred numbers. It made the theft easier to overlook.”",
        }],
      },
    ],
  },
  {
    id: 'frostpeak',
    aftermath: [{
      'when': { 'flag': { 'id': 'glacierCleared' } },
      'text':
        'Meltwater runs beneath the watch shelters. Blue light travels freely under the glacier again. Snow still covers the higher paths.',
    }],
    name: 'Frostpeak Pass',
    emoji: '🏔️',
    chapter: 4,
    levels: [23, 31],
    desc:
      'Watch shelters cling to a steep mountain pass. Blue light glows beneath the glacier where the wardens once tended the Frostfire.',
    safeHaven: false,
    lootTable: 'dt_high_pass',
    services: { shop: 'shop_outcast' },
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
        text: 'A Glacier Yeti rises from the snow beside the supply path.',
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
      desc:
        'A passage through blue ice to the sheltered Frostfire. The old wardens marked the turns with their emblems.',
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
        greeting: 'Come to the sheltered side of the fire. You can tell me about the climb there.',
        topics: [{
          id: 'rho_pass',
          label: 'Ask about the pass',
          text:
            '“I left my watch to bring a fevered child down the mountain. The wardens named me oathbreaker. When the freeze came, I was below it. They were not. I keep the shelter because someone should be here when their families come looking.”',
        }],
      },
    ],
  },
  {
    id: 'cinder',
    aftermath: [{
      'when': { 'flag': { 'id': 'pyreCleared' } },
      'text':
        'Sorrel tends a small living ember in the shelter kiln. Above the Caldera, the broken royal binding no longer draws light from the earth.',
    }],
    name: 'Cinder Wastes',
    emoji: '🌋',
    chapter: 5,
    levels: [31, 39],
    desc:
      "Ash covers the roads between ruined kilns. The Pyre Caldera rises beyond Sorrel's shelter, at the source of the Great Flame's buried channels.",
    safeHaven: false,
    lootTable: 'dt_ash_road',
    services: { shop: 'shop_ashcaravan', forge: 'forge_warden' },
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
      {
        kind: 'flavor',
        weight: 2,
        text: 'Under a layer of ash, a kiln door still bears the handprint of its maker.',
      },
    ],
    dungeon: {
      id: 'd_pyre',
      name: 'Pyre Caldera',
      emoji: '🔥',
      desc:
        'A descent through ash and hardened lava to the source chamber where Ignivar guarded the Great Flame.',
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
        greeting: 'There is a place beside the kiln. Rest while we talk.',
        topics: [{
          id: 'sorrel_flame',
          label: 'Ask about the starving flame',
          text:
            '“I used to lead prayers blaming Ignivar for our hunger. Then I saw the royal binding drawing light from him while he tried to feed the land. I cannot unsay those prayers. I can tend this fire and make sure the next person hears the truth.”',
        }],
      },
    ],
  },
  {
    id: 'umbra',
    aftermath: [{
      'when': { 'flag': { 'id': 'crownRestored' } },
      'text':
        "Daylight enters the Spire through the fractured throne room. The crown's hoard is empty; scattered servants and old shadows still occupy the lower rooms.",
    }],
    name: 'Umbral Spire',
    emoji: '🌑',
    chapter: 6,
    levels: [39, 45],
    desc:
      "A dark tower rises above the broken hearth channels. The old court's records lie below the stair to the Sundered Throne.",
    safeHaven: false,
    lootTable: 'dt_night_roads',
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
      desc:
        'The royal stair climbs through rooms split by the sundering. At its summit stands the vessel that held the stolen dawn.',
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
        greeting: 'You have come far. Let us keep an accurate account of what it cost.',
        topics: [{
          id: 'archivist_record',
          label: 'Ask about the record',
          text:
            '“I copied the order that divided the Flame. Its title promised the preservation of the realm. I recorded the first losses as exceptions, then kept recording exceptions for years. These pages are evidence of my part in it. They must survive me.”',
        }],
      },
    ],
  },
  {
    id: 'abyss',
    aftermath: [{
      'when': { 'flag': { 'id': 'seamCleared' } },
      'text':
        "The breach has settled. The paths of the Seam remain, holding echoes of old battles, but the world's light no longer drains into them.",
    }],
    name: 'The Abyss',
    emoji: '🌌',
    chapter: 7,
    levels: [45, 45],
    desc:
      'Stairs descend beneath the Spire into a wound left by the sundering. Memories take visible shape here, repeating journeys the living have already left behind.',
    safeHaven: false,
    lootTable: 'dt_night_roads',
    explore: [
      { kind: 'battle', enemy: 'e_voidspawn', weight: 3 },
      { kind: 'battle', enemy: 'e_nullhound', weight: 3 },
      { kind: 'battle', enemy: 'e_echo', weight: 2 },
      {
        kind: 'elite',
        enemy: 'e_warden',
        weight: 1,
        text: 'A reflection of the Warden forms across the path. The true breach lies deeper.',
      },
      {
        kind: 'treasure',
        gold: 1600,
        weight: 1,
        text: "A fallen traveler's coin pouch lies caught between the stair stones.",
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
      desc:
        'The deepest part of the wound beneath the world. Its chambers retain echoes of every trial endured here.',
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
          'There you are. Stay near the path marker; the echoes wander when they remember too much.',
        topics: [{
          id: 'echo_self',
          label: 'Ask how she is here',
          text:
            '“Maren crossed the edge of the Seam in her youth. She found the wound, could not mend it alone, and went home. I am the memory she left here. She is living her life above. I keep this path, and remember why she wanted to return.”',
        }],
      },
    ],
  },
];

const ZONE_INDEX = new Map(ZONES.map((z) => [z.id, z]));

export function zone(id: string): ZoneDef | undefined {
  return ZONE_INDEX.get(id);
}
