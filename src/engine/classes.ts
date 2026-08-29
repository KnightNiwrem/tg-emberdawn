/** Class definitions and level-curve math. Pure data + pure functions. */

import type { ClassId, DerivedStats } from './types.ts';

export interface ClassDef {
  id: ClassId;
  name: string;
  emoji: string;
  tagline: string;
  /** Base stats at level 1. */
  base: Omit<DerivedStats, 'maxHp' | 'maxMp'>;
  /** Per-level growth. */
  growth: Omit<DerivedStats, 'maxHp' | 'maxMp'>;
  /** Flat hp/mp growth per level. */
  hpPerLevel: number;
  mpPerLevel: number;
  /** Starting weapon/armor/trinket item ids. */
  startingGear: { weapon: string; armor: string };
  startingItems: Record<string, number>;
  desc: string;
}

export const MAX_LEVEL = 45;

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    emoji: '🗡️',
    tagline: 'Steel, sweat and stubbornness.',
    base: { atk: 14, def: 10, mag: 4, res: 6, spd: 8, luck: 6 },
    growth: { atk: 3.2, def: 2.6, mag: 0.6, res: 1.4, spd: 1.2, luck: 1.0 },
    hpPerLevel: 26,
    mpPerLevel: 5,
    startingGear: { weapon: 'w_warrior_1', armor: 'a_warrior_1' },
    startingItems: { c_minor_potion: 3 },
    desc: 'Frontline brawler. High HP and physical damage, shrugs off hits.',
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    emoji: '🔮',
    tagline: 'Knowledge burns brighter than fire.',
    base: { atk: 6, def: 5, mag: 15, res: 10, spd: 9, luck: 6 },
    growth: { atk: 0.8, def: 1.2, mag: 3.4, res: 2.4, spd: 1.2, luck: 1.0 },
    hpPerLevel: 15,
    mpPerLevel: 14,
    startingGear: { weapon: 'w_mage_1', armor: 'a_mage_1' },
    startingItems: { c_minor_potion: 2, c_minor_ether: 2 },
    desc: 'Devastating elemental magic. Fragile, but hits like a siege engine.',
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    emoji: '🏹',
    tagline: 'Fast, sharp, and gone before you notice.',
    base: { atk: 11, def: 7, mag: 6, res: 7, spd: 14, luck: 11 },
    growth: { atk: 2.6, def: 1.6, mag: 0.8, res: 1.6, spd: 2.6, luck: 2.0 },
    hpPerLevel: 19,
    mpPerLevel: 8,
    startingGear: { weapon: 'w_rogue_1', armor: 'a_rogue_1' },
    startingItems: { c_minor_potion: 2, c_smoke_bomb: 1 },
    desc: 'High speed and crits. Strikes first, dodges, flees like a professional.',
  },
  cleric: {
    id: 'cleric',
    name: 'Cleric',
    emoji: '✨',
    tagline: 'The flame keeps its own.',
    base: { atk: 8, def: 9, mag: 12, res: 12, spd: 7, luck: 8 },
    growth: { atk: 1.4, def: 2.0, mag: 2.6, res: 2.6, spd: 1.0, luck: 1.2 },
    hpPerLevel: 21,
    mpPerLevel: 12,
    startingGear: { weapon: 'w_cleric_1', armor: 'a_cleric_1' },
    startingItems: { c_minor_potion: 2, c_minor_ether: 1 },
    desc: 'Sustains through long fights with healing and holy magic.',
  },
};

/** Total XP needed to go from `level` to `level + 1`. Grindy by design. */
export function xpForNextLevel(level: number): number {
  if (level >= MAX_LEVEL) return Number.POSITIVE_INFINITY;
  return Math.floor(45 * Math.pow(level, 2.35) + 20 * level);
}

export function derivedStats(
  classId: ClassId,
  level: number,
  gearStats: {
    atk?: number;
    def?: number;
    mag?: number;
    res?: number;
    spd?: number;
    hp?: number;
    mp?: number;
    luck?: number;
  },
): DerivedStats {
  const c = CLASSES[classId];
  const lv = level - 1;
  const add = (base: number, growth: number, gear: number | undefined): number =>
    Math.floor(base + growth * lv + (gear ?? 0));
  return {
    maxHp: 60 + c.hpPerLevel * lv + (gearStats.hp ?? 0),
    maxMp: 30 + c.mpPerLevel * lv + (gearStats.mp ?? 0),
    atk: add(c.base.atk, c.growth.atk, gearStats.atk),
    def: add(c.base.def, c.growth.def, gearStats.def),
    mag: add(c.base.mag, c.growth.mag, gearStats.mag),
    res: add(c.base.res, c.growth.res, gearStats.res),
    spd: add(c.base.spd, c.growth.spd, gearStats.spd),
    luck: add(c.base.luck, c.growth.luck, gearStats.luck),
  };
}
