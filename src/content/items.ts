/**
 * Item catalog. Stats are formula-generated per tier so the curve stays
 * consistent; names/flavor are hand-authored. All lookups are pure.
 */

import type { ClassId } from '../engine/types.ts';
import type { EquipTrigger, ItemDef, ItemStats } from './types.ts';

const WEAPON_ATK = (tier: number): number => Math.round(3 * Math.pow(tier, 1.6) + 2 * tier + 1);
const ARMOR_DEF = (tier: number): number => Math.round(2.2 * Math.pow(tier, 1.5)) + tier;
const ARMOR_HP = (tier: number): number => Math.round(6 * Math.pow(tier, 1.7));
const ARMOR_RES = (tier: number): number => Math.round(1.8 * Math.pow(tier, 1.5));

const SELL_RATIO = 0.4;

interface TierNames {
  names: string[];
  /** Default flavor for tiers without a specific line (#128: high tiers
   * never inherit the starter line — they are named, progression-sensitive
   * pieces and carry their own). */
  desc: string;
  /** Per-tier flavor overrides, keyed 1..8. */
  descByTier?: Record<number, string>;
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
    descByTier: {
      1: 'Orange rust gathers where the old grip meets the blade.',
      2: "A smith's square stamp sits just above the plain crossguard.",
      3: 'A narrow fuller runs beneath a careful oil sheen.',
      4: "A knight's blade, kept the way oaths are kept.",
      5: 'Forged the night the Hollow burned clean, from the heat that cleanup left behind.',
      6: 'Sunspire work: balance like a held breath, edge like noon.',
      7: 'It does not chill the hand. It waits instead.',
      8: 'Made to finish a king. Nothing else fits the grip now.',
    },
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
    descByTier: {
      1: 'Waxed cord binds the split below its crooked head.',
      2: 'The grain curls around a knot polished smooth by a thumb.',
      3: 'Small runes follow the wood grain from grip to crown.',
      4: "A sorcerer's rod: a bad day to be on the far end of it.",
      5: 'Cut from the tree that survived the Hollow. It grew back angry.',
      6: 'The scepter keeps its own hours, and they are all high noon.',
      7: 'Winter, politely asked to live in a stick.',
      8: 'The last staff the Archmage ever lit. It never fully cooled.',
    },
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
    descByTier: {
      1: 'The handle is smooth where another hand wore it down.',
      2: 'Fresh whetstone marks brighten an otherwise battered blade.',
      3: 'Paired points curve inward above a dark leather grip.',
      4: "A fang you keep where light isn't.",
      5: "The kiss comes before the apology, and there's never one.",
      6: 'Sunspire steel, ground thin enough to argue with a lock.',
      7: 'Bites cold, heals never. The sheath smells of frost.',
      8: 'It makes no sound worth remembering. That is the point.',
    },
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
    descByTier: {
      1: 'Road dust has worked into the seams of its leather grip.',
      2: 'A faded prayer ribbon is knotted beneath the iron head.',
      3: 'Tiny flame marks circle the polished bronze collar.',
      4: "A warden's flail, swung with the patience of a psalm.",
      5: 'Its head holds a coal that has never once gone out.',
      6: 'Dawnbreaker: sunrise, condensed to a single struck note.',
      7: 'A crozier of blue ice that burns to holy light on contact.',
      8: 'Verdict first, appeal never.',
    },
  },
};

const WEAPON_GEAR: Record<ClassId, (tier: number) => ItemStats> = {
  warrior: (tier) => ({ atk: WEAPON_ATK(tier) }),
  mage: (tier) => ({ mag: WEAPON_ATK(tier) }),
  rogue: (tier) => ({ atk: Math.round(WEAPON_ATK(tier) * 0.85), spd: tier }),
  cleric: (tier) => ({
    mag: Math.round(WEAPON_ATK(tier) * 0.8),
    hp: Math.round(ARMOR_HP(tier) * 0.4),
  }),
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
    descByTier: {
      1: 'Linen patches cover old tears in the quilted chest.',
      2: 'Dark rings gather at the elbows, brightened by use.',
      3: 'The breastplate bears the faint guide marks of a patient hammer.',
      4: 'Plate the way knights meant it: boring to fight against.',
      5: "Tempered in the Hollow's own heat. It came out stubborn.",
      6: 'Sunspire alloy: dents take days and apologies to form.',
      7: 'Frost-set plates that shed both blades and weather.',
      8: 'Built to be the last wall between its bearer and the end — and, so far, it has been.',
    },
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
    descByTier: {
      1: 'The hem has been let out and stitched back by several hands.',
      2: 'Blue thread crosses the cuffs in a neat herringbone weave.',
      3: 'The collar sigils are sewn in a finer thread than the cloth.',
      4: 'A vestment stitched for people who shout in libraries.',
      5: "Woven from the Hollow's silk, out of spite for the Hollow.",
      6: 'Regalia that reads the sun and stands in it all day.',
      7: 'Sigils of frost, layered like slow deliberate breath.',
      8: 'The weave remembers every spell it has survived.',
    },
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
    descByTier: {
      1: 'Mismatched hides meet in thick, uneven seams.',
      2: 'The stiff panels hold the curve of the mold they dried around.',
      3: 'Brass studs have worn dull beneath the shoulder straps.',
      4: 'Shadow weave: it arrives a half-second before you do.',
      5: 'Cured over emberheat. Soft, warm, hard to catch.',
      6: 'Silks from the Sunspire vaults. They weigh nothing, cost plenty.',
      7: 'A veil of frost-fiber. Quiet as snowfall.',
      8: 'Worn by rogues who were done being seen.',
    },
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
    descByTier: {
      1: 'A small hearth is stitched over the heart in red thread.',
      2: 'The undyed cloth smells faintly of the cedar chest that held it.',
      3: 'A border of pale flames climbs from the hem to the cuffs.',
      4: 'A cassock built for ward duty and long stands.',
      5: 'Emberlight thread. It hums at the hem on cold mornings.',
      6: 'A sunspire alb: laundered in light, folded in light.',
      7: 'Glacier-wool, blessed twice. The cold respects it.',
      8: 'Dawn wore this first. It was returned in better condition.',
    },
  },
};

const ARMOR_GEAR: Record<ClassId, (tier: number) => ItemStats> = {
  warrior: (tier) => ({ def: ARMOR_DEF(tier), hp: ARMOR_HP(tier), res: ARMOR_RES(tier) }),
  mage: (tier) => ({
    def: Math.round(ARMOR_DEF(tier) * 0.4),
    res: Math.round(ARMOR_RES(tier) * 1.6),
    mp: 12 * tier,
  }),
  rogue: (tier) => ({
    def: Math.round(ARMOR_DEF(tier) * 0.7),
    spd: tier,
    res: Math.round(ARMOR_RES(tier) * 0.6),
  }),
  cleric: (tier) => ({
    def: Math.round(ARMOR_DEF(tier) * 0.7),
    res: Math.round(ARMOR_RES(tier) * 1.2),
    hp: Math.round(ARMOR_HP(tier) * 0.7),
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

/** Triggered equipment effects (#82): keyed by stocked trinket id. Boss
 * trophies carry theirs inline (below). Everything rides the shared #78
 * vocabulary — the engine never branches on item ids. */
const TRINKET_TRIGGERS: Record<string, EquipTrigger[]> = {
  // #82 class-relevance audit: Ember Sigil's MAG is offensively dead for
  // warrior/rogue — a retaliation burn makes it useful for every class.
  // Mechanical disclosure is GENERATED from `effects` (#120); only battle
  // narration (`line`) is authored here.
  t_3: [{
    name: 'Ember Backlash',
    trigger: 'onEnemyActionHpDamage',
    chance: 0.35,
    maxProcs: 3,
    effects: [{
      kind: 'periodic',
      target: 'opponent',
      perRound: -6,
      duration: 2,
      tickPhase: 'roundEnd',
      name: 'Ember Burn',
      tags: ['burn', 'harmful'],
      line: '🔥 The Ember Sigil flares — the attacker is burning!',
    }],
  }],
  // Glass Arrowhead's ATK is dead for mage/cleric — an opening Expose is
  // genuinely universal (everyone deals damage).
  t_7: [{
    name: 'Keen Fracture',
    trigger: 'battleStart',
    chance: 0.45,
    effects: [{
      kind: 'statmod',
      target: 'opponent',
      stat: 'incoming',
      pct: 0.25,
      duration: 3,
      timing: 'immediate',
      name: 'Exposed',
      tags: ['vulnerable', 'harmful'],
      line: '🎯 The Glass Arrowhead opens a fault line — the foe is Exposed.',
    }],
  }],
  // Thorn Ring: bounded retaliation (the issue's named example).
  t_9: [{
    name: 'Bramble Prick',
    trigger: 'onEnemyActionHpDamage',
    chance: 0.3,
    maxProcs: 3,
    effects: [{
      kind: 'periodic',
      target: 'opponent',
      perRound: -4,
      duration: 2,
      tickPhase: 'roundEnd',
      name: 'Bramble Bleed',
      tags: ['bleed', 'harmful'],
      line: '🌵 The Thorn Ring brambles bite back — the attacker bleeds!',
    }],
  }],
  // Ember Locket's MAG is bait for warrior/rogue — an opening smolder.
  t_11: [{
    name: 'Smoldering Wake',
    trigger: 'battleStart',
    chance: 0.4,
    effects: [{
      kind: 'periodic',
      target: 'opponent',
      perRound: -8,
      duration: 2,
      tickPhase: 'roundEnd',
      name: 'Smolder',
      tags: ['burn', 'harmful'],
      line: '🔥 The Ember Locket wakes — the foe is smoldering!',
    }],
  }],
};

interface ConsumableDef {
  id: string;
  name: string;
  lvl: number;
  price: number;
  effect: NonNullable<ItemDef['effect']>;
  /** Every consumable has flavor (#188); mechanics are generated from `effect`. */
  desc: string;
}

const CONSUMABLES: ConsumableDef[] = [
  {
    id: 'c_wild_berry',
    name: 'Wild Berries',
    lvl: 1,
    price: 6,
    effect: { healHp: 12 },
    desc: 'A handful of tart berries with the leaves picked out.',
  },
  {
    id: 'c_bitterleaf',
    name: 'Bitterleaf',
    lvl: 1,
    price: 8,
    effect: { healMp: 8 },
    desc: 'A sharp-scented leaf that stains your fingertips green.',
  },
  {
    id: 'c_grilled_trout',
    name: 'Grilled Trout',
    lvl: 1,
    price: 45,
    effect: { healHp: 100 },
    desc: 'Fresh fish wrapped in leaves after a turn over the coals.',
  },
  {
    id: 'c_eel_stew',
    name: 'Eel Stew',
    lvl: 8,
    price: 80,
    effect: { healHp: 140, healMp: 30 },
    desc: 'A thick marsh supper with soft herbs floating on the broth.',
  },

  {
    id: 'c_minor_potion',
    name: 'Minor Potion',
    lvl: 1,
    price: 30,
    effect: { healHp: 60 },
    desc: 'A small red bottle with a cork tied down for the road.',
  },
  {
    id: 'c_potion',
    name: 'Potion',
    lvl: 8,
    price: 90,
    effect: { healHp: 180 },
    desc: 'Bitter herbs settle beneath the glass. Shake before the long climb.',
  },
  {
    id: 'c_greater_potion',
    name: 'Greater Potion',
    lvl: 18,
    price: 220,
    effect: { healHp: 450 },
    desc: 'Thick crimson cordial that leaves the scent of crushed pine.',
  },
  {
    id: 'c_super_potion',
    name: 'Superior Potion',
    lvl: 28,
    price: 500,
    effect: { healHp: 1000 },
    desc: "The glass is padded in wool; the brewer's seal is still warm.",
  },
  {
    id: 'c_elixir',
    name: 'Elixir of Dawn',
    lvl: 36,
    price: 1200,
    effect: { healHp: 9999 },
    desc: 'Pale gold gathers at the bottom, even when you turn the vial.',
  },
  {
    id: 'c_minor_ether',
    name: 'Minor Ether',
    lvl: 1,
    price: 40,
    effect: { healMp: 40 },
    desc: 'A blue mouthful that smells of rain on warm stone.',
  },
  {
    id: 'c_ether',
    name: 'Ether',
    lvl: 10,
    price: 120,
    effect: { healMp: 120 },
    desc: 'Silver flecks drift through the blue, too slowly to settle.',
  },
  {
    id: 'c_greater_ether',
    name: 'Greater Ether',
    lvl: 22,
    price: 300,
    effect: { healMp: 300 },
    desc: 'The glass hums softly against its stopper.',
  },
  {
    id: 'c_antidote',
    name: 'Cleansing Tonic',
    lvl: 5,
    price: 60,
    effect: { cureStatus: true },
    desc: 'Sharp enough to smell through the cork.',
  },
  {
    id: 'c_smoke_bomb',
    name: 'Smoke Bomb',
    lvl: 3,
    price: 150,
    // #98: a PURE escape item — the Cleansing Tonic owns the cleanse role,
    // and an undisclosed status wipe would be a hidden power boost.
    effect: { flee: true },
    desc: 'A clay shell that leaves soot on everything it touches.',
  },
  {
    id: 'c_phoenix_feather',
    name: 'Phoenix Cinder',
    lvl: 16,
    price: 900,
    effect: { revivePct: 50 },
    desc: 'A warm cinder nestled in a fold of ash-grey silk.',
  },
];

const MATERIALS: { id: string; name: string; lvl: number; price: number; desc: string }[] = [
  {
    id: 'm_plant_fiber',
    name: 'Plant Fiber',
    lvl: 1,
    price: 6,
    desc: 'Pale strands stripped from tough meadow stems.',
  },
  {
    id: 'm_hardwood',
    name: 'Hardwood',
    lvl: 1,
    price: 12,
    desc: 'A straight length of close-grained fallen timber.',
  },
  {
    id: 'm_resin',
    name: 'Pine Resin',
    lvl: 3,
    price: 16,
    desc: 'Amber beads scraped from a split in the bark.',
  },
  {
    id: 'm_copper_ore',
    name: 'Copper Ore',
    lvl: 1,
    price: 15,
    desc: 'Green seams stain the broken stone.',
  },
  {
    id: 'm_coal',
    name: 'Coal',
    lvl: 4,
    price: 12,
    desc: 'Dense black fuel that leaves a thumbprint on the sack.',
  },
  {
    id: 'm_hide',
    name: 'Hide',
    lvl: 3,
    price: 18,
    desc: 'A rough hide, ready for scraping and stretching.',
  },
  {
    id: 'm_bone',
    name: 'Bone',
    lvl: 2,
    price: 8,
    desc: 'Clean bone with a hollow narrow enough for a needle.',
  },
  {
    id: 'm_spider_silk',
    name: 'Spider Silk',
    lvl: 5,
    price: 25,
    desc: 'Long strands wound around a twig to keep them from tangling.',
  },
  {
    id: 'm_glowcap',
    name: 'Glowcap',
    lvl: 6,
    price: 24,
    desc: 'A woodland mushroom with pale light beneath its cap.',
  },
  {
    id: 'm_reed',
    name: 'Marsh Reed',
    lvl: 8,
    price: 18,
    desc: 'Long wetland stalks with strong, flexible fibers.',
  },
  {
    id: 'm_bog_iron',
    name: 'Bog Iron',
    lvl: 8,
    price: 32,
    desc: 'Rust-brown nodules lifted from the marsh bed.',
  },
  {
    id: 'm_clay',
    name: 'River Clay',
    lvl: 8,
    price: 12,
    desc: 'Fine grey clay that keeps the shape of your fingers.',
  },
  {
    id: 'm_salt',
    name: 'Rock Salt',
    lvl: 15,
    price: 20,
    desc: 'White crystals crusted along an old dry watercourse.',
  },
  {
    id: 'm_sunstone',
    name: 'Sunstone',
    lvl: 15,
    price: 55,
    desc: 'Honey-colored stone from the exposed Sunspire beds.',
  },
  {
    id: 'm_quartz',
    name: 'Quartz',
    lvl: 15,
    price: 40,
    desc: 'A clear point broken along a mineral seam.',
  },
  {
    id: 'm_frost_lichen',
    name: 'Frost Lichen',
    lvl: 23,
    price: 48,
    desc: 'Silver-green curls cling to a flake of cold stone.',
  },
  {
    id: 'm_silver_ore',
    name: 'Silver Ore',
    lvl: 23,
    price: 85,
    desc: 'Pale metal glints through the dark mountain rock.',
  },
  {
    id: 'm_thick_fur',
    name: 'Thick Fur',
    lvl: 23,
    price: 65,
    desc: 'A dense winter pelt with soft wool beneath the guard hairs.',
  },
  {
    id: 'm_obsidian',
    name: 'Obsidian',
    lvl: 31,
    price: 110,
    desc: 'Black volcanic glass with a sharp shell-shaped fracture.',
  },
  {
    id: 'm_sulfur',
    name: 'Sulfur',
    lvl: 31,
    price: 65,
    desc: 'Yellow mineral crust gathered where the ground vents heat.',
  },
  {
    id: 'm_charred_wood',
    name: 'Charred Wood',
    lvl: 31,
    price: 32,
    desc: 'A fallen branch with sound grain beneath its blackened surface.',
  },
  {
    id: 'm_night_silk',
    name: 'Night Silk',
    lvl: 38,
    price: 170,
    desc: 'Dark fibers drawn from the nests along the Umbral walls.',
  },
  {
    id: 'm_black_iron',
    name: 'Black Iron',
    lvl: 38,
    price: 210,
    desc: 'Heavy ore veined through the stone beneath the Spire.',
  },
  {
    id: 'm_pickaxe',
    name: 'Pickaxe',
    lvl: 1,
    price: 45,
    desc: 'A short iron head wedged firmly onto an ash handle.',
  },
  {
    id: 'm_fishing_rod',
    name: 'Fishing Rod',
    lvl: 1,
    price: 45,
    desc: 'A supple rod with a cork float and a neatly wound line.',
  },
  {
    id: 'm_worm_bait',
    name: 'Worm Bait',
    lvl: 1,
    price: 3,
    desc: 'Earthworms kept cool in a small pot of damp soil.',
  },
  {
    id: 'm_grub_bait',
    name: 'Grub Bait',
    lvl: 1,
    price: 6,
    desc: 'Plump grubs tucked into a folded piece of bark.',
  },
  {
    id: 'm_river_trout',
    name: 'River Trout',
    lvl: 1,
    price: 16,
    desc: 'A silver-sided catch from running freshwater.',
  },
  {
    id: 'm_mire_eel',
    name: 'Mire Eel',
    lvl: 8,
    price: 28,
    desc: 'A dark freshwater eel with a slippery green sheen.',
  },
  {
    id: 'm_iron_ingot',
    name: 'Iron Ingot',
    lvl: 6,
    price: 90,
    desc: 'A squat bar of smelted iron bearing a shallow mold seam.',
  },
  {
    id: 'm_rat_tail',
    name: 'Rat Tail',
    lvl: 1,
    price: 3,
    desc: 'A thin scaly tail. A tanner might find a use for it.',
  },
  {
    id: 'm_cracked_shell',
    name: 'Cracked Shell',
    lvl: 8,
    price: 5,
    desc: 'A brittle shell too broken to shape into anything sturdy.',
  },
  {
    id: 'm_tangled_roots',
    name: 'Tangled Roots',
    lvl: 1,
    price: 3,
    desc: 'A knot of dry roots with the soil shaken out.',
  },
  {
    id: 'm_rusty_scrap',
    name: 'Rusty Scrap',
    lvl: 4,
    price: 7,
    desc: 'Flaking scraps of metal from a tool beyond repair.',
  },
  {
    id: 'm_broken_pottery',
    name: 'Broken Pottery',
    lvl: 8,
    price: 4,
    desc: 'The painted rim of a vessel whose maker is long gone.',
  },
  {
    id: 'm_silver_brooch',
    name: 'Silver Brooch',
    lvl: 8,
    price: 180,
    desc: 'A small silver clasp with its pin still straight.',
  },
  {
    id: 'm_sun_medallion',
    name: 'Sun Medallion',
    lvl: 18,
    price: 420,
    desc: 'A heavy gold disc stamped with the Sun Cult emblem.',
  },
  {
    id: 'm_royal_signet',
    name: 'Royal Signet',
    lvl: 40,
    price: 1400,
    desc: 'A court seal cut into a ring of weighty gold.',
  },

  {
    id: 'm_ember_shard',
    name: 'Ember Shard',
    lvl: 1,
    price: 25,
    desc: 'Hardened sparks carried out of the hearth channels by roots and wandering creatures.',
  },
  {
    id: 'm_iron_chunk',
    name: 'Iron Chunk',
    lvl: 6,
    price: 60,
    desc: "Ore from the old workings beneath the Whisperwood, often caught in a Mycelid's husk.",
  },
  { id: 'm_mystic_dust', name: 'Mystic Dust', lvl: 12, price: 140, desc: 'Ground sigil-stone.' },
  {
    id: 'm_frost_core',
    name: 'Frost Core',
    lvl: 20,
    price: 320,
    desc: 'A blue crystal formed where the Frostfire warmed the glacier from within.',
  },
  {
    id: 'm_cinder_heart',
    name: 'Cinder Heart',
    lvl: 30,
    price: 700,
    desc: 'Heat sealed into stone near the source of the Great Flame.',
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
  {
    id: 'q_pells_locket',
    name: "Pell's Locket",
    desc:
      'A small silver locket with a pressed fern beneath its lid. Spider silk clings to the broken chain.',
  },
  {
    id: 'q_wisp_lantern',
    name: 'Wisp Lantern',
    desc:
      'Blue light sealed in a ferry lantern. A keepsake from the beacon you chose to leave unlit.',
  },
  {
    id: 'q_sealed_letter',
    name: 'Sealed Letter',
    desc:
      "Maren's sketch of warm roots beneath cold soil, sealed with the village's rising-sun mark.",
  },
  {
    id: 'q_toxin_sample',
    name: 'Toxin Sample',
    desc:
      'A sealed vial of dark fluid taken from a creature in Hollowmere. The shrine water leaves the same black stain.',
  },
  {
    id: 'q_sunspire_key',
    name: 'Sunspire Key',
    desc: "A brass key kept by Ombra. Its teeth match the keeper's seal in the Vault of Hours.",
  },
  {
    id: 'q_frost_emblem',
    name: 'Frost Emblem',
    desc: "An enamel badge bearing a lost warden's name and a mark from the Glacier Maw route.",
  },
  {
    id: 'q_cinder_sigil',
    name: 'Cinder Sigil',
    desc: 'A clay disc stamped with the name of a keeper who died tending the Great Flame.',
  },
  {
    id: 'q_sundered_crown',
    name: 'The Sundered Crown',
    desc:
      'A broken crown, empty of the light Aldric hoarded. The fracture has cooled enough to touch.',
  },
];

function buildItems(): ItemDef[] {
  const out: ItemDef[] = [];
  const tiers = [1, 2, 3, 4, 5, 6, 7, 8];
  const tierLevel = (tier: number): number => 1 + (tier - 1) * 6;
  const price = (tier: number): number => Math.round(38 * Math.pow(tier, 2.2));
  for (const classId of ['warrior', 'mage', 'rogue', 'cleric'] as ClassId[]) {
    tiers.forEach((tier, tierIndex) => {
      const names = WEAPONS[classId].names;
      out.push({
        id: `w_${classId}_${tier}`,
        name: names[tierIndex] ?? names[0]!,
        kind: 'weapon',
        classes: [classId],
        level: tierLevel(tier),
        price: price(tier),
        tier,
        stats: WEAPON_GEAR[classId](tier),
        desc: WEAPONS[classId].descByTier?.[tier] ?? WEAPONS[classId].desc,
      });
    });
    tiers.forEach((tier, tierIndex) => {
      const names = ARMORS[classId].names;
      out.push({
        id: `a_${classId}_${tier}`,
        name: names[tierIndex] ?? names[0]!,
        kind: 'armor',
        classes: [classId],
        level: tierLevel(tier),
        price: price(tier),
        tier,
        stats: ARMOR_GEAR[classId](tier),
        desc: ARMORS[classId].descByTier?.[tier] ?? ARMORS[classId].desc,
      });
    });
  }
  TRINKET_TIERS.forEach((tk, trinketIndex) => {
    out.push({
      id: `t_${trinketIndex + 1}`,
      name: tk.name,
      kind: 'trinket',
      level: tk.lvl,
      price: Math.round(price(Math.max(1, tk.lvl / 6))),
      tier: trinketIndex + 1,
      stats: tk.stats,
      desc: tk.desc,
      // #82: declared triggers ride along; undefined stays absent.
      ...(TRINKET_TRIGGERS[`t_${trinketIndex + 1}`]
        ? { triggers: TRINKET_TRIGGERS[`t_${trinketIndex + 1}`] }
        : {}),
    });
  });
  // Standalone effect trinket (#80, migrated to the #82 trigger model):
  // explicit id — a new TRINKET_TIERS entry would mint t_12 and collide
  // with the boss trinkets' ids.
  out.push({
    id: 't_wardstone',
    name: 'Wardstone Pendant',
    kind: 'trinket',
    level: 20,
    price: Math.round(price(Math.max(1, 20 / 6))),
    tier: 5,
    stats: { def: 8 },
    triggers: [{
      name: 'Wardstone Ward',
      trigger: 'battleStart',
      effects: [{
        kind: 'shield',
        target: 'self',
        amount: 25,
        duration: 1,
        timing: 'immediate',
        lifetime: 'battle',
        name: 'Wardstone Ward',
        line: '🪨 The Wardstone hums awake — a ward settles over you, absorbing up to {n} damage.',
      }],
    }],
  });
  for (const consumable of CONSUMABLES) {
    out.push({
      id: consumable.id,
      name: consumable.name,
      kind: 'consumable',
      level: consumable.lvl,
      price: consumable.price,
      tier: 0,
      effect: consumable.effect,
      desc: consumable.desc,
    });
  }
  for (const material of MATERIALS) {
    out.push({
      id: material.id,
      name: material.name,
      kind: 'material',
      level: material.lvl,
      price: material.price,
      tier: 0,
      desc: material.desc,
    });
  }
  for (const questItem of QUEST_ITEMS) {
    out.push({
      id: questItem.id,
      name: questItem.name,
      kind: 'quest',
      level: 1,
      price: 0,
      tier: 0,
      unique: true,
      desc: questItem.desc,
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
    triggers?: EquipTrigger[];
  }[] = [
    {
      id: 't_12',
      name: 'Rootwoven Band',
      lvl: 8,
      stats: { def: 6, hp: 30 },
      price: 260,
      desc: 'Woven from living root; still faintly growing.',
      triggers: [{
        name: 'Living Ward',
        trigger: 'battleStart',
        effects: [{
          kind: 'shield',
          target: 'self',
          defPower: 0.8,
          duration: 2,
          timing: 'immediate',
          name: 'Living Ward',
          line: '🌿 Living root weaves a ward around you, absorbing up to {n} damage.',
        }],
      }],
    },
    {
      id: 't_13',
      name: "Tidecaller's Pearl",
      lvl: 15,
      stats: { mp: 45, res: 9 },
      price: 640,
      desc: "Hums with the drowned shrine's tide.",
      triggers: [{
        name: "Tide's Return",
        trigger: 'onGuard',
        maxProcs: 3,
        effects: [{
          kind: 'restore',
          target: 'self',
          mpPctOfMax: 0.08,
        }],
      }],
    },
    {
      id: 't_14',
      name: 'Hourglass Charm',
      lvl: 21,
      stats: { spd: 12, mag: 10 },
      price: 1150,
      desc: 'Sand falls upward when you act.',
      triggers: [{
        name: 'Stolen Seconds',
        trigger: 'battleStart',
        chance: 0.5,
        effects: [{
          kind: 'statmod',
          target: 'opponent',
          stat: 'spd',
          pct: -0.25,
          duration: 2,
          timing: 'immediate',
          name: 'Slowed',
          tags: ['slow', 'harmful'],
          line: '⏳ Sand falls upward — the foe is Slowed.',
        }],
      }],
    },
    {
      id: 't_15',
      name: 'Rimeheart Locket',
      lvl: 28,
      stats: { res: 16, hp: 80 },
      price: 1900,
      desc: 'Cold that protects, not consumes.',
      triggers: [{
        name: 'Rime Ward',
        trigger: 'battleStart',
        effects: [{
          kind: 'shield',
          target: 'self',
          amount: 35,
          duration: 2,
          timing: 'immediate',
          name: 'Rime Ward',
          line: '❄️ Rime crystals settle over you, absorbing up to {n} damage.',
        }],
      }],
    },
    {
      id: 't_16',
      name: 'Cinderheart Braid',
      lvl: 36,
      stats: { atk: 30, hp: 100 },
      price: 3100,
      desc: "Plaited from the caldera's own temper.",
      triggers: [{
        name: 'Caldera Wrath',
        trigger: 'onEnemyActionHpDamage',
        chance: 0.5,
        maxProcs: 3,
        cooldown: 2,
        effects: [{
          kind: 'periodic',
          target: 'opponent',
          perRound: -12,
          duration: 3,
          tickPhase: 'roundEnd',
          name: 'Caldera Burn',
          tags: ['burn', 'harmful'],
          line: '🌋 The caldera answers — the attacker is burning!',
        }],
      }],
    },
    {
      // #89: the broad HP-damage contract — ANY loss to the wearer
      // (periodic ticks, opening strikes, future reflect/environment
      // causes) answers, not just enemy actions. Low stats keep it out of
      // every 'best'-gear pick: this trinket exists to make the contract
      // real and testable.
      id: 't_19',
      name: 'Grudge Charm',
      lvl: 6,
      stats: { atk: 2, res: 2 },
      price: 450,
      desc: 'Every wound answers — even poison and opening strikes.',
      triggers: [{
        name: 'Grudge Prick',
        trigger: 'onHpDamage',
        maxProcs: 6,
        cooldown: 1,
        effects: [{
          kind: 'periodic',
          target: 'opponent',
          perRound: -3,
          duration: 2,
          tickPhase: 'roundEnd',
          name: 'Grudge Bleed',
          tags: ['bleed', 'harmful'],
          line: '🩹 The grudge answers — the striker is bleeding!',
        }],
      }],
    },
    {
      id: 't_17',
      name: 'Regalia of the Dawn',
      lvl: 44,
      stats: { atk: 24, mag: 24, def: 18, res: 18, spd: 12, luck: 14 },
      price: 5200,
      desc: "A king's worth of morning, reclaimed.",
      triggers: [{
        name: "Dawn's Blessing",
        trigger: 'battleStart',
        effects: [{
          kind: 'statmod',
          target: 'self',
          stat: 'atk',
          pct: 0.1,
          duration: 1,
          timing: 'immediate',
          lifetime: 'battle',
          name: "Dawn's Might",
          tags: ['beneficial'],
          line: "🌅 Dawn's Might settles into your arms.",
        }, {
          kind: 'statmod',
          target: 'self',
          stat: 'mag',
          pct: 0.1,
          duration: 1,
          timing: 'immediate',
          lifetime: 'battle',
          name: "Dawn's Insight",
          tags: ['beneficial'],
          line: "🌅 Dawn's Insight settles into your mind.",
        }],
      }],
    },
    {
      id: 't_18',
      name: "Voidseeker's Lens",
      lvl: 45,
      stats: { atk: 34, mag: 34, luck: 18 },
      price: 6600,
      desc: 'Through it, the dark looks away first.',
      triggers: [{
        name: 'Void Gaze',
        trigger: 'battleStart',
        chance: 0.6,
        effects: [{
          kind: 'statmod',
          target: 'opponent',
          stat: 'incoming',
          pct: 0.25,
          duration: 3,
          timing: 'immediate',
          name: 'Voidmarked',
          tags: ['vulnerable', 'mark', 'harmful'],
          line: '🕳️ The Lens finds the seam in reality — the foe is Voidmarked.',
        }],
      }],
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
      // #82: declared triggers ride along; undefined stays absent.
      ...(bt.triggers ? { triggers: bt.triggers } : {}),
    });
  }
  return out;
}

export const ITEMS: readonly ItemDef[] = buildItems();

const ITEM_INDEX = new Map(ITEMS.map((itemDef) => [itemDef.id, itemDef]));

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
