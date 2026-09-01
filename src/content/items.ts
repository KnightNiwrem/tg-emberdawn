/**
 * Item catalog. Stats are formula-generated per tier so the curve stays
 * consistent; names/flavor are hand-authored. All lookups are pure.
 */

import type { ClassId } from '../engine/types.ts';
import type { ItemDef, ItemStats } from './types.ts';

const WEAPON_ATK = (tier: number): number => Math.round(3 * Math.pow(tier, 1.6) + 2 * tier + 1);
const ARMOR_DEF = (tier: number): number => Math.round(2.2 * Math.pow(tier, 1.5)) + tier;
const ARMOR_HP = (tier: number): number => Math.round(6 * Math.pow(tier, 1.7));
const ARMOR_RES = (tier: number): number => Math.round(1.8 * Math.pow(tier, 1.5));

const SELL_RATIO = 0.4;

interface TierNames {
  names: string[];
  desc: string;
}

const WEAPONS: Record<ClassId, TierNames> = {
  warrior: {
    names: [
      'Rusty Blade',
      'Iron Sword',
      'Steel Longsword',
      "Knight's Blade",
      'Emberforged Greatsword',
      'Sunspire Claymore',
      'Frostbrand',
      'Crownslayer',
    ],
    desc: "A warrior's answer to most questions.",
  },
  mage: {
    names: [
      'Cracked Staff',
      'Oak Staff',
      'Runed Staff',
      "Sorcerer's Rod",
      'Emberwood Staff',
      'Sunspire Scepter',
      'Glacial Staff',
      "Archmage's Cinderrod",
    ],
    desc: 'Channels raw magic better than bare hands.',
  },
  rogue: {
    names: [
      'Worn Dagger',
      'Sharpened Dagger',
      'Twin Fang',
      'Shadow Fang',
      "Viper's Kiss",
      'Sunspire Kris',
      'Winterfang',
      'Whisper of Ends',
    ],
    desc: 'Small blade, big problems — for someone else.',
  },
  cleric: {
    names: [
      'Travel Mace',
      'Blessed Mace',
      'Sanctified Mace',
      "Warden's Flail",
      'Emberlight Mace',
      'Dawnbreaker',
      'Frostlight Crozier',
      'Radiant Judgment',
    ],
    desc: 'Faith, with a blunt instrument attached.',
  },
};

const WEAPON_GEAR: Record<ClassId, (tier: number) => ItemStats> = {
  warrior: (t) => ({ atk: WEAPON_ATK(t) }),
  mage: (t) => ({ mag: WEAPON_ATK(t) }),
  rogue: (t) => ({ atk: Math.round(WEAPON_ATK(t) * 0.85), spd: t }),
  cleric: (t) => ({ mag: Math.round(WEAPON_ATK(t) * 0.8), hp: Math.round(ARMOR_HP(t) * 0.4) }),
};

const ARMORS: Record<ClassId, TierNames> = {
  warrior: {
    names: [
      'Padded Vest',
      'Iron Mail',
      'Steel Plate',
      "Knight's Plate",
      'Emberforged Plate',
      'Sunspire Bulwark',
      'Glacial Aegis',
      'Bastion of Ends',
    ],
    desc: 'Heavy, dependable, unglamorous.',
  },
  mage: {
    names: [
      'Thread Robe',
      'Woven Robe',
      'Runed Robe',
      "Sorcerer's Vestment",
      'Emberwood Robe',
      'Sunspire Regalia',
      'Glacial Mantle',
      "Archmage's Weave",
    ],
    desc: 'Woven with protective sigils.',
  },
  rogue: {
    names: [
      'Scrap Leather',
      'Boiled Leather',
      'Studded Leather',
      'Shadow Weave',
      'Emberhide',
      'Sunspire Silks',
      'Glacial Veil',
      "Night's Finale",
    ],
    desc: 'Light enough to run in.',
  },
  cleric: {
    names: [
      'Initiate Vest',
      'Woven Vestment',
      'Sanctified Vestment',
      "Warden's Cassock",
      'Emberlight Vestment',
      'Sunspire Alb',
      'Glacial Cassock',
      'Vesture of Dawn',
    ],
    desc: 'Blessed cloth that refuses to tear.',
  },
};

const ARMOR_GEAR: Record<ClassId, (tier: number) => ItemStats> = {
  warrior: (t) => ({ def: ARMOR_DEF(t), hp: ARMOR_HP(t), res: ARMOR_RES(t) }),
  mage: (t) => ({
    def: Math.round(ARMOR_DEF(t) * 0.4),
    res: Math.round(ARMOR_RES(t) * 1.6),
    mp: 12 * t,
  }),
  rogue: (t) => ({
    def: Math.round(ARMOR_DEF(t) * 0.7),
    spd: t,
    res: Math.round(ARMOR_RES(t) * 0.6),
  }),
  cleric: (t) => ({
    def: Math.round(ARMOR_DEF(t) * 0.7),
    res: Math.round(ARMOR_RES(t) * 1.2),
    hp: Math.round(ARMOR_HP(t) * 0.7),
  }),
};

const TRINKET_TIERS: { name: string; lvl: number; stats: ItemStats; desc: string }[] = [
  { name: 'Lucky Coin', lvl: 3, stats: { luck: 4 }, desc: "Someone's forgotten fortune." },
  { name: 'Feather Charm', lvl: 7, stats: { spd: 4 }, desc: 'Light as a thought.' },
  { name: 'Ember Sigil', lvl: 11, stats: { mag: 8 }, desc: 'Warm to the touch, always.' },
  { name: 'Iron Band', lvl: 15, stats: { def: 10, hp: 40 }, desc: 'Simple and stubborn.' },
  { name: 'Phoenix Feather', lvl: 20, stats: { hp: 90, luck: 6 }, desc: 'It remembers burning.' },
  { name: "Sage's Bead", lvl: 26, stats: { mp: 70, res: 12 }, desc: 'Hums with quiet knowing.' },
  {
    name: 'Glass Arrowhead',
    lvl: 32,
    stats: { atk: 26, luck: 10 },
    desc: 'Fragile things cut deepest.',
  },
  {
    name: 'Crown Sigil',
    lvl: 40,
    stats: { atk: 18, mag: 18, def: 14, res: 14, spd: 10, luck: 12 },
    desc: "A king's worth of presence.",
  },
  {
    name: 'Thorn Ring',
    lvl: 5,
    stats: { atk: 3, def: 3 },
    desc: 'Wears a groove into the finger. Worth it.',
  },
  { name: 'Moon Pendant', lvl: 13, stats: { mp: 30, res: 6 }, desc: 'Cool light for cold nights.' },
  {
    name: 'Ember Locket',
    lvl: 29,
    stats: { hp: 70, mag: 10 },
    desc: 'Holds a spark that never quite goes out.',
  },
];

interface ConsumableDef {
  id: string;
  name: string;
  lvl: number;
  price: number;
  effect: NonNullable<ItemDef['effect']>;
  desc: string;
}

const CONSUMABLES: ConsumableDef[] = [
  {
    id: 'c_minor_potion',
    name: 'Minor Potion',
    lvl: 1,
    price: 30,
    effect: { healHp: 60 },
    desc: 'Restores 60 HP.',
  },
  {
    id: 'c_potion',
    name: 'Potion',
    lvl: 8,
    price: 90,
    effect: { healHp: 180 },
    desc: 'Restores 180 HP.',
  },
  {
    id: 'c_greater_potion',
    name: 'Greater Potion',
    lvl: 18,
    price: 220,
    effect: { healHp: 450 },
    desc: 'Restores 450 HP.',
  },
  {
    id: 'c_super_potion',
    name: 'Superior Potion',
    lvl: 28,
    price: 500,
    effect: { healHp: 1000 },
    desc: 'Restores 1000 HP.',
  },
  {
    id: 'c_elixir',
    name: 'Elixir of Dawn',
    lvl: 36,
    price: 1200,
    effect: { healHp: 9999 },
    desc: 'Fully restores HP.',
  },
  {
    id: 'c_minor_ether',
    name: 'Minor Ether',
    lvl: 1,
    price: 40,
    effect: { healMp: 40 },
    desc: 'Restores 40 MP.',
  },
  {
    id: 'c_ether',
    name: 'Ether',
    lvl: 10,
    price: 120,
    effect: { healMp: 120 },
    desc: 'Restores 120 MP.',
  },
  {
    id: 'c_greater_ether',
    name: 'Greater Ether',
    lvl: 22,
    price: 300,
    effect: { healMp: 300 },
    desc: 'Restores 300 MP.',
  },
  {
    id: 'c_antidote',
    name: 'Cleansing Tonic',
    lvl: 5,
    price: 60,
    effect: { cureStatus: true },
    desc: 'Lifts sapped strength.',
  },
  {
    id: 'c_smoke_bomb',
    name: 'Smoke Bomb',
    lvl: 3,
    price: 150,
    effect: { cureStatus: true, flee: true },
    desc: 'Guaranteed escape from normal fights.',
  },
  {
    id: 'c_phoenix_feather',
    name: 'Phoenix Cinder',
    lvl: 16,
    price: 900,
    effect: { revivePct: 50 },
    desc: 'Auto-revives you at 50% HP when felled.',
  },
];

const MATERIALS: { id: string; name: string; lvl: number; price: number; desc: string }[] = [
  {
    id: 'm_ember_shard',
    name: 'Ember Shard',
    lvl: 1,
    price: 25,
    desc: "A splinter of the world's dying flame.",
  },
  { id: 'm_iron_chunk', name: 'Iron Chunk', lvl: 6, price: 60, desc: 'Raw, heavy, honest.' },
  { id: 'm_mystic_dust', name: 'Mystic Dust', lvl: 12, price: 140, desc: 'Ground sigil-stone.' },
  {
    id: 'm_frost_core',
    name: 'Frost Core',
    lvl: 20,
    price: 320,
    desc: 'Cold enough to hurt time.',
  },
  {
    id: 'm_cinder_heart',
    name: 'Cinder Heart',
    lvl: 30,
    price: 700,
    desc: 'Still beating with heat.',
  },
  {
    id: 'm_void_fragment',
    name: 'Void Fragment',
    lvl: 38,
    price: 1600,
    desc: 'A piece of the space between.',
  },
];

const QUEST_ITEMS: { id: string; name: string; desc: string }[] = [
  { id: 'q_sealed_letter', name: 'Sealed Letter', desc: "Wax stamp bearing the Warden's crest." },
  { id: 'q_toxin_sample', name: 'Toxin Sample', desc: "Swamp water that fizzes when it's angry." },
  { id: 'q_sunspire_key', name: 'Sunspire Key', desc: 'A key of solid gold light, somehow cold.' },
  { id: 'q_frost_emblem', name: 'Frost Emblem', desc: 'The mark of the Frostpeak wardens.' },
  {
    id: 'q_cinder_sigil',
    name: 'Cinder Sigil',
    desc: 'Branded into the air more than any object.',
  },
  {
    id: 'q_sundered_crown',
    name: 'The Sundered Crown',
    desc: 'Half of a crown that once ruled the flame.',
  },
];

function buildItems(): ItemDef[] {
  const out: ItemDef[] = [];
  const tiers = [1, 2, 3, 4, 5, 6, 7, 8];
  const tierLevel = (t: number): number => 1 + (t - 1) * 6;
  const price = (t: number): number => Math.round(38 * Math.pow(t, 2.2));
  for (const cls of ['warrior', 'mage', 'rogue', 'cleric'] as ClassId[]) {
    tiers.forEach((t, i) => {
      const names = WEAPONS[cls].names;
      out.push({
        id: `w_${cls}_${t}`,
        name: names[i] ?? names[0]!,
        kind: 'weapon',
        classes: [cls],
        level: tierLevel(t),
        price: price(t),
        tier: t,
        stats: WEAPON_GEAR[cls](t),
        desc: WEAPONS[cls].desc,
      });
    });
    tiers.forEach((t, i) => {
      const names = ARMORS[cls].names;
      out.push({
        id: `a_${cls}_${t}`,
        name: names[i] ?? names[0]!,
        kind: 'armor',
        classes: [cls],
        level: tierLevel(t),
        price: price(t),
        tier: t,
        stats: ARMOR_GEAR[cls](t),
        desc: ARMORS[cls].desc,
      });
    });
  }
  TRINKET_TIERS.forEach((tk, i) => {
    out.push({
      id: `t_${i + 1}`,
      name: tk.name,
      kind: 'trinket',
      level: tk.lvl,
      price: Math.round(price(Math.max(1, tk.lvl / 6))),
      tier: i + 1,
      stats: tk.stats,
      desc: tk.desc,
    });
  });
  for (const c of CONSUMABLES) {
    out.push({
      id: c.id,
      name: c.name,
      kind: 'consumable',
      level: c.lvl,
      price: c.price,
      tier: 0,
      effect: c.effect,
      desc: c.desc,
    });
  }
  for (const m of MATERIALS) {
    out.push({
      id: m.id,
      name: m.name,
      kind: 'material',
      level: m.lvl,
      price: m.price,
      tier: 0,
      desc: m.desc,
    });
  }
  for (const q of QUEST_ITEMS) {
    out.push({
      id: q.id,
      name: q.name,
      kind: 'quest',
      level: 1,
      price: 0,
      tier: 0,
      unique: true,
      desc: q.desc,
    });
  }
  // Boss first-clear trinkets: unique victory loot, never stocked (they are
  // not in TRINKET_TIERS), level-tuned to the dungeon that awards them.
  const BOSS_TRINKETS: {
    id: string;
    name: string;
    lvl: number;
    stats: ItemStats;
    price: number;
    desc: string;
  }[] = [
    {
      id: 't_12',
      name: 'Rootwoven Band',
      lvl: 8,
      stats: { def: 6, hp: 30 },
      price: 260,
      desc: 'Woven from living root; still faintly growing.',
    },
    {
      id: 't_13',
      name: "Tidecaller's Pearl",
      lvl: 15,
      stats: { mp: 45, res: 9 },
      price: 640,
      desc: "Hums with the drowned shrine's tide.",
    },
    {
      id: 't_14',
      name: 'Hourglass Charm',
      lvl: 21,
      stats: { spd: 12, mag: 10 },
      price: 1150,
      desc: 'Sand falls upward when you act.',
    },
    {
      id: 't_15',
      name: 'Rimeheart Locket',
      lvl: 28,
      stats: { res: 16, hp: 80 },
      price: 1900,
      desc: 'Cold that protects, not consumes.',
    },
    {
      id: 't_16',
      name: 'Cinderheart Braid',
      lvl: 36,
      stats: { atk: 30, hp: 100 },
      price: 3100,
      desc: "Plaited from the caldera's own temper.",
    },
    {
      id: 't_17',
      name: 'Regalia of the Dawn',
      lvl: 44,
      stats: { atk: 24, mag: 24, def: 18, res: 18, spd: 12, luck: 14 },
      price: 5200,
      desc: "A king's worth of morning, reclaimed.",
    },
    {
      id: 't_18',
      name: "Voidseeker's Lens",
      lvl: 45,
      stats: { atk: 34, mag: 34, luck: 18 },
      price: 6600,
      desc: 'Through it, the dark looks away first.',
    },
  ];
  for (const bt of BOSS_TRINKETS) {
    out.push({
      id: bt.id,
      name: bt.name,
      kind: 'trinket',
      level: bt.lvl,
      price: bt.price,
      tier: 0,
      unique: true, // earned trophies (#5): unsellable and un-droppable
      stats: bt.stats,
      desc: bt.desc,
    });
  }
  return out;
}

export const ITEMS: readonly ItemDef[] = buildItems();

const ITEM_INDEX = new Map(ITEMS.map((i) => [i.id, i]));

export function item(id: string): ItemDef | undefined {
  return ITEM_INDEX.get(id);
}

export function itemName(id: string): string {
  return ITEM_INDEX.get(id)?.name ?? id;
}

export function itemStats(id: string): ItemStats | undefined {
  return ITEM_INDEX.get(id)?.stats;
}

export function sellPrice(id: string): number {
  const def = ITEM_INDEX.get(id);
  return def ? Math.floor(def.price * SELL_RATIO) : 0;
}

export function isEquippable(
  id: string,
  classId: ClassId,
  level: number,
): { ok: boolean; reason?: string } {
  const def = ITEM_INDEX.get(id);
  if (!def) return { ok: false, reason: 'Unknown item.' };
  if (def.kind !== 'weapon' && def.kind !== 'armor' && def.kind !== 'trinket') {
    return { ok: false, reason: 'That cannot be equipped.' };
  }
  if (def.classes && !def.classes.includes(classId)) {
    return { ok: false, reason: `Your class cannot use the ${def.name}.` };
  }
  if (level < def.level) return { ok: false, reason: `Requires level ${def.level}.` };
  return { ok: true };
}

export function shopStock(
  zoneId: string,
  zoneTier: number,
  player?: { level: number; classId: ClassId },
): string[] {
  const stock: string[] = [];
  const t = zoneTier;
  // Gear stocks ONLY for the shopping player's class (#22): class is
  // immutable and there is no trading, so the other three quarters of the
  // rack were dead gold sinks. Static callers (integrity sweeps) still get
  // the full catalog.
  const classes: ClassId[] = player ? [player.classId] : ['warrior', 'mage', 'rogue', 'cleric'];
  const gear: string[] = [];
  for (const cls of classes) {
    gear.push(`w_${cls}_${t}`, `a_${cls}_${t}`);
    if (t >= 2) gear.push(`w_${cls}_${t - 1}`, `a_${cls}_${t - 1}`);
  }
  for (const id of gear) {
    const def = ITEM_INDEX.get(id);
    // Every shelved purchase is immediately usable (#22): nothing above
    // the player's level, whatever the tier math says.
    if (player && def && def.level > player.level) continue;
    stock.push(id);
  }
  // Trinkets stock by their ACTUAL level, not array position — the table
  // isn't sorted by level, so index math once sold a level-5 ring only in
  // endgame shops. Cap = highest equippable level for this tier.
  // Trinkets stock by what the player can actually EQUIP (#6): the zone
  // tier band governs gear tiers, but offering items the counter knows you
  // cannot wear yet is bait. Without a player (static callers) the
  // tier-band ceiling applies as before.
  const trinketCap = player?.level ?? t * 6;
  TRINKET_TIERS.forEach((tk, i) => {
    if (tk.lvl <= trinketCap) stock.push(`t_${i + 1}`);
  });
  stock.push('c_minor_potion', 'c_minor_ether');
  if (t >= 2) stock.push('c_potion', 'c_ether', 'c_antidote');
  if (t >= 3) stock.push('c_greater_potion', 'c_smoke_bomb');
  if (t >= 5) stock.push('c_super_potion', 'c_greater_ether', 'c_phoenix_feather');
  if (t >= 7) stock.push('c_elixir');
  if (zoneId !== 'emberdawn') stock.push('m_ember_shard');
  if (t >= 2) stock.push('m_iron_chunk');
  if (t >= 4) stock.push('m_mystic_dust');
  if (t >= 6) stock.push('m_frost_core', 'm_cinder_heart');
  return stock;
}
