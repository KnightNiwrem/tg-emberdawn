/**
 * Enemy catalog. Base stats scale from level via the mk() helper so the
 * difficulty curve stays coherent; bosses and specials are hand-tuned.
 */

import type { EnemyDef, EnemyMove } from './types.ts';

const mv = (
  name: string,
  power: number,
  kind: 'phys' | 'mag',
  weight: number,
  extra: Partial<EnemyMove> = {},
): EnemyMove => ({ name, power, kind, weight, ...extra });

interface EnemySpec {
  id: string;
  name: string;
  emoji: string;
  level: number;
  /** stat multipliers over the level curve (defaults 1). */
  mul?: {
    hp?: number;
    atk?: number;
    def?: number;
    mag?: number;
    res?: number;
    spd?: number;
    xp?: number;
    gold?: number;
  };
  boss?: boolean;
  special?: EnemyDef['special'];
  moves: EnemyMove[];
  drops?: Record<string, number>;
  desc?: string;
}

function mk(s: EnemySpec): EnemyDef {
  const L = s.level;
  const m = s.mul ?? {};
  const mul = (k: keyof NonNullable<EnemySpec['mul']>, base: number): number =>
    Math.round(base * (m[k] ?? 1));
  return {
    id: s.id,
    name: s.name,
    emoji: s.emoji,
    level: L,
    hp: mul('hp', Math.round(30 + 2.4 * Math.pow(L, 1.9))),
    atk: mul('atk', Math.round(6 + 2.0 * Math.pow(L, 1.22))),
    def: mul('def', Math.round(2 + 0.9 * Math.pow(L, 1.15))),
    mag: mul('mag', Math.round(5 + 1.8 * Math.pow(L, 1.2))),
    res: mul('res', Math.round(2 + 0.8 * Math.pow(L, 1.12))),
    spd: mul('spd', 5 + Math.round(L * 0.8)),
    xp: mul('xp', Math.round(16 * Math.pow(L, 1.75))),
    gold: mul('gold', Math.round(4 * Math.pow(L, 1.55))),
    boss: s.boss,
    special: s.special,
    moves: s.moves,
    drops: s.drops,
    desc: s.desc,
  };
}

const BITE = (n = 'Bite'): EnemyMove => mv(n, 1.0, 'phys', 3);
const CLAW = (n = 'Claw'): EnemyMove => mv(n, 1.15, 'phys', 2);

export const ENEMIES: readonly EnemyDef[] = [
  // ── Emberdawn Village / Whisperwood (ch1) ───────────────────────────────────
  mk({
    id: 'e_rat',
    name: 'Giant Rat',
    emoji: '🐀',
    level: 2,
    moves: [BITE()],
    drops: { m_ember_shard: 0.25 },
    desc: 'Big, bold, and everywhere.',
  }),
  mk({
    id: 'e_boar',
    name: 'Tusked Boar',
    emoji: '🐗',
    level: 3,
    moves: [BITE('Gore'), CLAW('Trample')],
    drops: { m_ember_shard: 0.3 },
  }),
  mk({
    id: 'e_bandit',
    name: 'Roadside Bandit',
    emoji: '🗡️',
    level: 4,
    moves: [mv('Shiv', 1.1, 'phys', 3), mv('Low Blow', 1.3, 'phys', 1)],
    drops: { c_minor_potion: 0.2 },
  }),
  mk({
    id: 'e_wolf',
    name: 'Grey Wolf',
    emoji: '🐺',
    level: 4,
    moves: [BITE(), mv('Howl', 0, 'phys', 1, { weakenPct: 0.15 })],
    drops: { m_ember_shard: 0.35 },
  }),
  mk({
    id: 'e_spider',
    name: 'Woodfang Spider',
    emoji: '🕷️',
    level: 5,
    moves: [BITE('Venom Bite'), mv('Web Snare', 0.6, 'phys', 1, { weakenPct: 0.2 })],
    drops: { m_ember_shard: 0.4 },
  }),
  mk({
    id: 'e_sprite',
    name: 'Thistle Sprite',
    emoji: '🧚',
    level: 5,
    mul: { hp: 0.7 },
    moves: [mv('Prick', 0.8, 'mag', 2), mv('Hex', 1.1, 'mag', 2)],
    drops: { m_ember_shard: 0.45, c_minor_ether: 0.15 },
  }),
  mk({
    id: 'e_mycelid',
    name: 'Mycelid Drone',
    emoji: '🍄',
    level: 6,
    moves: [mv('Spore Cloud', 0.9, 'mag', 2), BITE('Gnaw')],
    drops: { m_iron_chunk: 0.3 },
  }),
  mk({
    id: 'e_thornling',
    name: 'Thornling',
    emoji: '🌿',
    level: 7,
    moves: [mv('Thorn Lash', 1.1, 'phys', 3), mv('Root Snare', 0.7, 'phys', 1, { weakenPct: 0.2 })],
  }),
  mk({
    id: 'e_stag',
    name: 'Corrupted Stag',
    emoji: '🦌',
    level: 7,
    mul: { hp: 1.3, xp: 1.5, gold: 1.5 },
    moves: [mv('Antler Charge', 1.3, 'phys', 3), mv('Feral Kick', 1.1, 'phys', 2)],
    desc: "The Whisperwood's guardian, gone wrong.",
  }),
  mk({
    id: 'e_aranya',
    name: 'Matriarch Aranya',
    emoji: '🕸️',
    level: 9,
    boss: true,
    mul: { hp: 2.6, xp: 3, gold: 3.2, def: 1.25 },
    moves: [
      mv('Skittering Bite', 1.1, 'phys', 3),
      mv('Silk Prison', 0.8, 'phys', 2, { weakenPct: 0.3 }),
    ],
    special: { every: 4, move: mv('Brood Surge', 1.6, 'phys', 1, { selfHealPct: 0.08 }) },
    drops: { m_iron_chunk: 1.0, t_1: 0.5 },
    desc: 'She wove the Hollow. Now the Hollow weaves for her.',
  }),

  // ── Hollowmere (ch2) ────────────────────────────────────────────────
  mk({
    id: 'e_boglin',
    name: 'Boglin',
    emoji: '🫧',
    level: 10,
    moves: [BITE('Nibble'), mv('Mudball', 0.9, 'mag', 2)],
    drops: { m_iron_chunk: 0.35 },
  }),
  mk({
    id: 'e_leech',
    name: 'Marsh Leech',
    emoji: '🪱',
    level: 11,
    moves: [BITE('Leech'), mv('Drain', 0.9, 'mag', 2, { selfHealPct: 0.05 })],
    drops: { m_mystic_dust: 0.5, q_toxin_sample: 0.55 },
  }),
  mk({
    id: 'e_fenhag',
    name: 'Fen Hag',
    emoji: '🧙‍♀️',
    level: 12,
    moves: [
      mv('Cackle Bolt', 1.2, 'mag', 3),
      mv('Swamp Curse', 0.9, 'mag', 2, { weakenPct: 0.25 }),
    ],
    drops: { c_ether: 0.15 },
  }),
  mk({
    id: 'e_sludge',
    name: 'Oozing Sludge',
    emoji: '🫠',
    level: 12,
    mul: { hp: 1.4, spd: 0.6 },
    moves: [mv('Engulf', 1.2, 'phys', 3), mv('Acid Spray', 1.0, 'mag', 2)],
  }),
  mk({
    id: 'e_wisp',
    name: 'Marsh Wisp',
    emoji: '🌀',
    level: 13,
    mul: { hp: 0.75 },
    moves: [
      mv('Drowning Light', 1.2, 'mag', 3),
      mv('Fey Touch', 1.0, 'mag', 1, { weakenPct: 0.15 }),
    ],
  }),
  mk({
    id: 'e_mireclaw',
    name: 'Dread Mireclaw',
    emoji: '🐊',
    level: 13,
    moves: [mv('Death Roll', 1.35, 'phys', 3), BITE('Crush')],
    drops: { m_iron_chunk: 0.4 },
  }),
  mk({
    id: 'e_drowned',
    name: 'Drowned Acolyte',
    emoji: '🌊',
    level: 14,
    moves: [mv('Tidal Slam', 1.15, 'phys', 3), mv('Drowned Prayer', 1.1, 'mag', 2)],
    drops: { q_toxin_sample: 0.4 },
  }),
  mk({
    id: 'e_serpent',
    name: 'Shrine Serpent',
    emoji: '🐍',
    level: 15,
    moves: [
      mv('Coil Strike', 1.25, 'phys', 3),
      mv('Venom Spit', 1.1, 'mag', 2, { weakenPct: 0.2 }),
    ],
  }),
  mk({
    id: 'e_vosk',
    name: 'Bog Tyrant Vosk',
    emoji: '🐸',
    level: 16,
    boss: true,
    mul: { hp: 2.7, xp: 3, gold: 3.2, def: 1.3 },
    moves: [mv("Tyrant's Tongue", 1.3, 'phys', 3), mv('Miasma', 1.0, 'mag', 2, { weakenPct: 0.3 })],
    special: { every: 3, move: mv('Swallow Whole', 1.9, 'phys', 1) },
    drops: { m_mystic_dust: 1.0, t_2: 0.5 },
    desc: 'The swamp has a king. It is hungry.',
  }),

  // ── Sunspire (ch3) ──────────────────────────────────────────────────
  mk({
    id: 'e_scarab',
    name: 'Gilded Scarab',
    emoji: '🪲',
    level: 16,
    moves: [mv('Mandible', 1.0, 'phys', 3), mv('Sun Flash', 0.9, 'mag', 1, { weakenPct: 0.15 })],
    drops: { m_mystic_dust: 0.4 },
  }),
  mk({
    id: 'e_sentinel',
    name: 'Ruin Sentinel',
    emoji: '🗿',
    level: 17,
    mul: { hp: 1.35, spd: 0.6, def: 1.3 },
    moves: [mv('Stone Fist', 1.25, 'phys', 3), mv('Guard Stance', 0.4, 'phys', 1)],
  }),
  mk({
    id: 'e_vulture',
    name: 'Ash Vulture',
    emoji: '🦅',
    level: 17,
    mul: { hp: 0.85, spd: 1.3 },
    moves: [mv('Talon Dive', 1.2, 'phys', 3), BITE('Peck')],
    drops: { m_mystic_dust: 0.3 },
  }),
  mk({
    id: 'e_cultist',
    name: 'Sun Cultist',
    emoji: '☀️',
    level: 18,
    moves: [mv('Solar Dart', 1.2, 'mag', 3), mv('Fanatic Strike', 1.1, 'phys', 2)],
    drops: { c_ether: 0.2, q_sunspire_key: 0.06 },
  }),
  mk({
    id: 'e_spirelynx',
    name: 'Spire Lynx',
    emoji: '🐆',
    level: 18,
    mul: { spd: 1.4 },
    moves: [mv('Pounce', 1.3, 'phys', 3), CLAW('Rake')],
  }),
  mk({
    id: 'e_chronowisp',
    name: 'Chrono Wisp',
    emoji: '⏳',
    level: 19,
    mul: { hp: 0.8 },
    moves: [mv('Time Scar', 1.25, 'mag', 3), mv('Stutter', 0.8, 'mag', 2, { weakenPct: 0.25 })],
  }),
  mk({
    id: 'e_automaton',
    name: 'Brass Automaton',
    emoji: '⚙️',
    level: 20,
    mul: { def: 1.35, spd: 0.7 },
    moves: [mv('Piston Punch', 1.3, 'phys', 3), mv('Steam Vent', 1.1, 'mag', 2)],
    drops: { m_mystic_dust: 0.55, q_sunspire_key: 0.1 },
  }),
  mk({
    id: 'e_chronolich',
    name: 'The Chronolich',
    emoji: '💀',
    level: 22,
    boss: true,
    mul: { hp: 2.8, xp: 3, gold: 3.4, mag: 1.2, def: 1.3 },
    moves: [mv('Sandstream', 1.3, 'mag', 3), mv('Ageing Touch', 1.1, 'mag', 2, { weakenPct: 0.3 })],
    special: { every: 4, move: mv('Temporal Collapse', 2.1, 'mag', 1) },
    drops: { m_frost_core: 0.6, t_3: 0.5 },
    desc: 'It has counted every hour since the flame was lit. It wants the last one.',
  }),

  // ── Frostpeak (ch4) ─────────────────────────────────────────────────
  mk({
    id: 'e_icebat',
    name: 'Frost Bat',
    emoji: '🦇',
    level: 23,
    mul: { hp: 0.8, spd: 1.3 },
    moves: [BITE('Chill Bite'), mv('Screech', 0.8, 'mag', 1, { weakenPct: 0.15 })],
    drops: { m_frost_core: 0.3 },
  }),
  mk({
    id: 'e_bristlehorn',
    name: 'Bristlehorn',
    emoji: '🐐',
    level: 23,
    moves: [mv('Gore Charge', 1.3, 'phys', 3), CLAW('Hoof Stomp')],
  }),
  mk({
    id: 'e_marauder',
    name: 'Frost Marauder',
    emoji: '⚔️',
    level: 24,
    moves: [mv('Ice Axe', 1.25, 'phys', 3), mv('Shield Charge', 1.0, 'phys', 2)],
    drops: { c_greater_potion: 0.15 },
  }),
  mk({
    id: 'e_frostwraith',
    name: 'Frost Wraith',
    emoji: '❄️',
    level: 25,
    moves: [
      mv('Frozen Grasp', 1.25, 'mag', 3),
      mv('Chill Whisper', 1.0, 'mag', 2, { weakenPct: 0.25 }),
    ],
    drops: { m_frost_core: 0.5, q_frost_emblem: 0.4 },
  }),
  mk({
    id: 'e_iceling',
    name: 'Iceling',
    emoji: '🧊',
    level: 26,
    mul: { def: 1.3 },
    moves: [mv('Icicle Volley', 1.2, 'mag', 3), mv('Frost Shell', 0.4, 'phys', 1)],
  }),
  mk({
    id: 'e_yeti',
    name: 'Glacier Yeti',
    emoji: '🦣',
    level: 27,
    mul: { hp: 1.4, atk: 1.15 },
    moves: [mv('Avalanche Blow', 1.4, 'phys', 3), mv('Bellow', 0.8, 'phys', 1, { weakenPct: 0.2 })],
    drops: { m_frost_core: 0.6 },
  }),
  mk({
    id: 'e_jormunis',
    name: 'Jormunis, the Glacier Wyrm',
    emoji: '🐉',
    level: 30,
    boss: true,
    mul: { hp: 3.0, xp: 3, gold: 3.6, def: 1.35, res: 1.3 },
    moves: [mv('Frost Breath', 1.45, 'mag', 3), mv('Tail Sweep', 1.2, 'phys', 2)],
    special: { every: 3, move: mv('Absolute Zero', 2.0, 'mag', 1) },
    drops: { m_frost_core: 1.0, t_4: 0.6 },
    desc: "The mountain's heartbeat, coiled around the flame's twin.",
  }),

  // ── Cinder Wastes (ch5) ─────────────────────────────────────────────
  mk({
    id: 'e_magmaslime',
    name: 'Magma Slime',
    emoji: '🌋',
    level: 31,
    mul: { hp: 1.3, spd: 0.6 },
    moves: [mv('Lava Engulf', 1.3, 'mag', 3), mv('Cooled Crust', 0.4, 'phys', 1)],
    drops: { m_cinder_heart: 0.3 },
  }),
  mk({
    id: 'e_emberimp',
    name: 'Ember Imp',
    emoji: '👹',
    level: 31,
    mul: { hp: 0.8, spd: 1.3 },
    moves: [mv('Cinder Fling', 1.2, 'mag', 3), mv('Mischief', 0.9, 'mag', 2, { weakenPct: 0.2 })],
    drops: { m_cinder_heart: 0.35 },
  }),
  mk({
    id: 'e_cinderhound',
    name: 'Cinder Hound',
    emoji: '🔥',
    level: 32,
    moves: [mv('Blazing Bite', 1.3, 'phys', 3), mv('Ember Howl', 1.0, 'mag', 2)],
  }),
  mk({
    id: 'e_revenant',
    name: 'Ashen Revenant',
    emoji: '👻',
    level: 33,
    moves: [
      mv('Withering Touch', 1.3, 'mag', 3),
      mv('Sorrow Wail', 1.0, 'mag', 2, { weakenPct: 0.25 }),
    ],
    drops: { m_cinder_heart: 0.45, q_cinder_sigil: 0.35 },
  }),
  mk({
    id: 'e_salamander',
    name: 'Fire Salamander',
    emoji: '🦎',
    level: 34,
    moves: [mv('Flame Whip', 1.35, 'mag', 3), mv('Molten Tail', 1.2, 'phys', 2)],
  }),
  mk({
    id: 'e_forge_warden',
    name: 'Forge Warden',
    emoji: '⚒️',
    level: 35,
    mul: { def: 1.35, hp: 1.2 },
    moves: [mv('Hammer Fall', 1.4, 'phys', 3), mv('Molten Guard', 0.5, 'phys', 1)],
    drops: { m_cinder_heart: 0.5 },
  }),
  mk({
    id: 'e_ignivar',
    name: 'Ignivar, the Last Flame',
    emoji: '🔥',
    level: 38,
    boss: true,
    mul: { hp: 3.2, xp: 3, gold: 3.8, mag: 1.3, def: 1.35 },
    moves: [mv('Solar Flare', 1.5, 'mag', 3), mv('Cinder Storm', 1.3, 'mag', 2)],
    special: { every: 4, move: mv('Rekindling', 0, 'mag', 1, { selfHealPct: 0.12 }) },
    drops: { m_cinder_heart: 1.0, t_5: 0.6 },
    desc: 'The oldest fire still burning. Tired. Cornered. Dangerous.',
  }),

  // ── Umbral Spire (ch6) ──────────────────────────────────────────────
  mk({
    id: 'e_shade',
    name: 'Umbral Shade',
    emoji: '🌑',
    level: 39,
    moves: [mv('Null Grasp', 1.3, 'mag', 3), mv('Fade', 1.0, 'mag', 2, { weakenPct: 0.25 })],
    drops: { m_void_fragment: 0.3 },
  }),
  mk({
    id: 'e_watcher',
    name: 'Watcher Eye',
    emoji: '👁️',
    level: 39,
    moves: [mv('Petrify Gaze', 1.25, 'mag', 3), mv('Blink Strike', 1.2, 'phys', 2)],
  }),
  mk({
    id: 'e_shattered',
    name: 'Shattered Knight',
    emoji: '🛡️',
    level: 40,
    mul: { def: 1.4, hp: 1.25 },
    moves: [mv('Broken Blade', 1.35, 'phys', 3), mv("Oath's Remnant", 1.1, 'mag', 2)],
  }),
  mk({
    id: 'e_horror',
    name: 'Umbral Horror',
    emoji: '🦑',
    level: 41,
    moves: [
      mv('Crushing Tendril', 1.4, 'phys', 3),
      mv('Mind Static', 1.2, 'mag', 2, { weakenPct: 0.3 }),
    ],
    drops: { m_void_fragment: 0.4 },
  }),
  mk({
    id: 'e_nightgaunt',
    name: 'Nightgaunt',
    emoji: '👤',
    level: 41,
    mul: { spd: 1.4 },
    moves: [mv('Silent Talon', 1.35, 'phys', 3), mv('Cold Embrace', 1.15, 'mag', 2)],
  }),
  mk({
    id: 'e_crownsworn',
    name: 'Crownsworn Blade',
    emoji: '⚔️',
    level: 42,
    moves: [mv('Loyal Edge', 1.4, 'phys', 3), mv("King's Command", 1.2, 'mag', 2)],
    drops: { m_void_fragment: 0.45, q_umbra_key: 0.25 },
  }),
  mk({
    id: 'e_regalia',
    name: 'Regalia Guardian',
    emoji: '👑',
    level: 43,
    mul: { def: 1.45, hp: 1.3 },
    moves: [
      mv('Sovereign Strike', 1.45, 'phys', 3),
      mv('Royal Decree', 1.25, 'mag', 2, { weakenPct: 0.25 }),
    ],
  }),
  mk({
    id: 'e_aldric',
    name: 'King Aldric the Sundered',
    emoji: '👑',
    level: 45,
    boss: true,
    mul: { hp: 3.4, xp: 4, gold: 4, atk: 1.2, mag: 1.25, def: 1.4, res: 1.35 },
    moves: [
      mv('Sundering Blow', 1.55, 'phys', 3),
      mv('Crown of Night', 1.4, 'mag', 2, { weakenPct: 0.3 }),
    ],
    special: { every: 3, move: mv('Divide the Flame', 2.2, 'mag', 1) },
    drops: { m_void_fragment: 1.0, t_6: 0.7 },
    desc: 'He split the flame to rule both halves. He lost himself in the seam.',
  }),

  // ── The Abyss (postgame) ────────────────────────────────────────────
  mk({
    id: 'e_voidspawn',
    name: 'Voidspawn',
    emoji: '🕳️',
    level: 45,
    moves: [mv('Unmaking', 1.5, 'mag', 3), mv('Hunger', 1.3, 'phys', 2)],
    drops: { m_void_fragment: 0.5 },
  }),
  mk({
    id: 'e_nullhound',
    name: 'Null Hound',
    emoji: '🐕',
    level: 45,
    mul: { spd: 1.4 },
    moves: [mv('Phantom Bite', 1.45, 'phys', 3), mv('Chase', 1.25, 'phys', 2)],
  }),
  mk({
    id: 'e_echo',
    name: 'Echo of a Hero',
    emoji: '🗡️',
    level: 45,
    mul: { hp: 1.2 },
    moves: [mv('Remembered Strike', 1.5, 'phys', 3), mv('Forgotten Skill', 1.35, 'mag', 2)],
    desc: 'Everyone who sought the crown left an echo here.',
  }),
  mk({
    id: 'e_warden',
    name: 'Warden of the Void',
    emoji: '🌌',
    level: 45,
    boss: true,
    mul: { hp: 3.6, xp: 4, gold: 4.5, atk: 1.25, mag: 1.3, def: 1.45, res: 1.4 },
    moves: [
      mv('Void Lance', 1.6, 'mag', 3),
      mv('Entropy Field', 1.35, 'mag', 2, { weakenPct: 0.3 }),
    ],
    special: { every: 3, move: mv('Final Silence', 2.3, 'mag', 1) },
    drops: { m_void_fragment: 1.0, t_7: 0.5 },
    desc: 'It guards nothing now. It simply ends those who arrive.',
  }),
].filter((e) => e.id.length > 0 && e.name !== 'unused');

const ENEMY_INDEX = new Map(ENEMIES.map((e) => [e.id, e]));

export function enemy(id: string): EnemyDef | undefined {
  return ENEMY_INDEX.get(id);
}

export function enemyName(id: string): string {
  return ENEMY_INDEX.get(id)?.name ?? id;
}
