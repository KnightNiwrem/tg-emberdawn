/** Local gathering sites. Tools stay in the bag; bait is spent per cast. */
export type GatheringActivity = 'forage' | 'mine' | 'fish';

export interface GatheringYield {
  item: string;
  weight: number;
  min: number;
  max: number;
}

export interface GatheringSite {
  zoneId: string;
  activity: GatheringActivity;
  label: string;
  text: string;
  tool?: string;
  /** Each bait has its own explicit catch table; no implicit upgrades. */
  baitTables?: Readonly<Record<string, readonly GatheringYield[]>>;
  yields: readonly GatheringYield[];
}

const yieldOf = (item: string, weight = 3, min = 1, max = 2): GatheringYield => ({
  item,
  weight,
  min,
  max,
});
const forage = (zoneId: string, text: string, ids: string[]): GatheringSite => ({
  zoneId,
  activity: 'forage',
  label: '🧺 Forage',
  text,
  yields: ids.map((id) => yieldOf(id)),
});
const mine = (zoneId: string, text: string, ids: string[]): GatheringSite => ({
  zoneId,
  activity: 'mine',
  label: '⛏️ Mine',
  text,
  tool: 'm_pickaxe',
  yields: ids.map((id) => yieldOf(id)),
});
const fish = (zoneId: string, text: string, fishId: string): GatheringSite => ({
  zoneId,
  activity: 'fish',
  label: '🎣 Fish',
  text,
  tool: 'm_fishing_rod',
  yields: [],
  baitTables: {
    m_worm_bait: [
      yieldOf(fishId, 7, 1, 1),
      yieldOf('m_reed', 2),
      yieldOf('m_tangled_roots', 1, 1, 1),
    ],
    m_grub_bait: [yieldOf(fishId, 9), yieldOf('m_tangled_roots', 1, 1, 1)],
  },
});

export const GATHERING_SITES: readonly GatheringSite[] = [
  forage('emberdawn', 'You gather from the hedges beside the village gardens.', [
    'm_plant_fiber',
    'c_wild_berry',
    'c_bitterleaf',
    'm_worm_bait',
  ]),
  forage('outskirts', 'You search the field margins and lift fallen branches.', [
    'm_plant_fiber',
    'c_wild_berry',
    'm_grub_bait',
    'm_tangled_roots',
  ]),
  mine('outskirts', 'You work a shallow seam exposed beside the old quarry path.', [
    'm_copper_ore',
    'm_ember_shard',
    'm_iron_chunk',
    'm_clay',
    'm_coal',
  ]),
  forage('whisperwood', 'You collect fallen wood and resin along the ranger paths.', [
    'm_hardwood',
    'm_resin',
    'm_glowcap',
    'c_bitterleaf',
  ]),
  fish('whisperwood', 'You cast into a clear stream between the roots.', 'm_river_trout'),
  forage('mirefoot', 'You cut reeds and turn damp earth beside the landing.', [
    'm_reed',
    'm_clay',
    'm_worm_bait',
    'c_bitterleaf',
  ]),
  fish('mirefoot', 'You cast from the landing into the slow water.', 'm_mire_eel'),
  forage('hollowmere', 'You gather reeds and pale caps from the raised banks.', [
    'm_reed',
    'm_glowcap',
    'm_clay',
    'm_grub_bait',
  ]),
  mine('hollowmere', 'You break iron-rich nodules from an exposed bank.', [
    'm_bog_iron',
    'm_iron_chunk',
    'm_clay',
  ]),
  fish('hollowmere', 'You lower your line into a sheltered backwater.', 'm_mire_eel'),
  mine('sunspire', 'You work mineral seams beneath the broken outer walls.', [
    'm_sunstone',
    'm_quartz',
    'm_salt',
    'm_mystic_dust',
  ]),
  forage('frostpeak', 'You gather lichen from the sheltered side of the rocks.', [
    'm_frost_lichen',
    'c_bitterleaf',
  ]),
  mine('frostpeak', 'You chip at the exposed seam beneath the watch shelter.', [
    'm_silver_ore',
    'm_quartz',
    'm_frost_core',
    'm_coal',
  ]),
  forage('cinder', 'You collect charred timber from the cold edge of a ruined kiln.', [
    'm_charred_wood',
    'm_coal',
  ]),
  mine('cinder', 'You work the cooled rock along the old quarry face.', [
    'm_obsidian',
    'm_sulfur',
    'm_cinder_heart',
  ]),
  mine('umbra', 'You loosen dark ore from a fractured foundation seam.', [
    'm_black_iron',
    'm_quartz',
  ]),
  mine('abyss', 'You chip loose fragments from the mineral crust beside the stairs.', [
    'm_void_fragment',
    'm_black_iron',
  ]),
];

export function gatheringSites(zoneId: string): readonly GatheringSite[] {
  return GATHERING_SITES.filter((site) => site.zoneId === zoneId);
}
