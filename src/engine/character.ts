/**
 * Character lifecycle: creation, XP, level-ups, death and revival.
 * Pure functions over PlayerState + content lookups.
 */

import type { ClassId, DerivedStats, PlayerState } from './types.ts';
import { CLASSES, derivedStats, MAX_LEVEL, xpForNextLevel } from './classes.ts';
import { itemStats } from '../content/items.ts';
import { skillsLearnedAt } from '../content/skills.ts';
import { forgeBonus } from './forge.ts';

export function createPlayer(userId: number, name: string, classId: ClassId): PlayerState {
  const c = CLASSES[classId];
  const gear = { ...itemStats(c.startingGear.weapon), ...itemStats(c.startingGear.armor) };
  const stats = derivedStats(classId, 1, gear);
  const inv = Object.entries(c.startingItems).map(([id, qty]) => ({ id, qty }));
  inv.push({ id: c.startingGear.weapon, qty: 1 });
  inv.push({ id: c.startingGear.armor, qty: 1 });
  const now = Date.now();
  return {
    userId,
    name,
    classId,
    level: 1,
    xp: 0,
    gold: 50,
    hp: stats.maxHp,
    mp: stats.maxMp,
    inventory: inv,
    equipment: { weapon: c.startingGear.weapon, armor: c.startingGear.armor },
    quests: {},
    unlockedZones: ['emberfall'],
    currentZone: 'emberfall',
    flags: {},
    skills: [],
    scene: { view: 'home' },
    notices: [],
    stats: { kills: 0, deaths: 0, bossesSlain: 0, battlesWon: 0, createdAt: now, lastPlayed: now },
  };
}

function equippedGearStats(p: PlayerState): {
  atk?: number;
  def?: number;
  mag?: number;
  res?: number;
  spd?: number;
  hp?: number;
  mp?: number;
  luck?: number;
} {
  const acc: Record<string, number> = {};
  const add = (itemId: string | undefined): void => {
    if (!itemId) return;
    const s = itemStats(itemId);
    if (!s) return;
    for (const [k, v] of Object.entries(s)) acc[k] = (acc[k] ?? 0) + (v ?? 0);
  };
  add(p.equipment.weapon);
  add(p.equipment.armor);
  add(p.equipment.trinket);
  // Forge temper bonuses: +8% of the slot's relevant base stats per level.
  const wb = forgeBonus(p, 'weapon');
  if (wb > 0) {
    acc.atk = Math.round((acc.atk ?? 0) * (1 + wb));
    acc.mag = Math.round((acc.mag ?? 0) * (1 + wb));
  }
  const ab = forgeBonus(p, 'armor');
  if (ab > 0) {
    acc.def = Math.round((acc.def ?? 0) * (1 + ab));
    acc.res = Math.round((acc.res ?? 0) * (1 + ab));
    acc.hp = Math.round((acc.hp ?? 0) * (1 + ab));
  }
  return acc;
}

export function statsOf(p: PlayerState): DerivedStats {
  return derivedStats(p.classId, p.level, equippedGearStats(p));
}

/** Grants XP and applies any level-ups. Returns messages describing what happened. */
export function grantXp(p: PlayerState, xp: number): string[] {
  const msgs: string[] = [];
  if (p.level >= MAX_LEVEL) return msgs;
  p.xp += xp;
  while (p.level < MAX_LEVEL && p.xp >= xpForNextLevel(p.level)) {
    p.xp -= xpForNextLevel(p.level);
    p.level++;
    const s = statsOf(p);
    p.hp = s.maxHp;
    p.mp = s.maxMp;
    msgs.push(`⬆️ Level up! You are now level ${p.level}.`);
    const learned = skillsLearnedAt(p.classId, p.level);
    for (const sk of learned) {
      p.skills.push(sk.id);
      msgs.push(`📖 New skill learned: ${sk.name}.`);
    }
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
  return msgs;
}

export function xpProgress(p: PlayerState): { current: number; needed: number } {
  return { current: p.xp, needed: xpForNextLevel(p.level) };
}

/** Applies death penalties; player revives at their zone with 50% HP. */
export function applyDeath(p: PlayerState): string {
  p.stats.deaths++;
  const lost = Math.floor(p.gold * 0.1);
  p.gold -= lost;
  const s = statsOf(p);
  p.hp = Math.max(1, Math.floor(s.maxHp * 0.5));
  p.mp = Math.floor(s.maxMp * 0.5);
  return lost > 0
    ? `💀 You black out and wake at a safe haven. ${lost} gold slipped from your pockets.`
    : '💀 You black out and wake at a safe haven, somehow poorer in spirit only.';
}
