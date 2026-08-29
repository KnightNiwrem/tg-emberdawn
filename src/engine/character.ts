/**
 * Character lifecycle: creation, XP, level-ups, death and revival.
 * Pure functions over PlayerState + content lookups.
 */

import type { ClassId, DerivedStats, PlayerState } from './types.ts';
import { CLASSES, derivedStats, MAX_LEVEL, xpForNextLevel } from './classes.ts';
import { itemStats } from '../content/items.ts';
import { countOf, removeItem } from './inventory.ts';
import { skillsForClass, skillsLearnedAt } from '../content/skills.ts';
import { STARTING_ZONES, ZONES } from '../content/zones.ts';
import { temperBonusOf } from './forge.ts';

export function createPlayer(userId: number, name: string, classId: ClassId): PlayerState {
  const c = CLASSES[classId];
  const gear = { ...itemStats(c.startingGear.weapon), ...itemStats(c.startingGear.armor) };
  const stats = derivedStats(classId, 1, gear);
  // Equipped gear lives ONLY in equipment slots — bag copies would double
  // it in derived stats and let players sell their own shirt twice.
  const inv = Object.entries(c.startingItems).map(([id, qty]) => ({ id, qty }));
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
    unlockedZones: [...STARTING_ZONES],
    currentZone: 'emberfall',
    flags: {},
    skills: skillsForClass(classId, 1).map((sk) => sk.id),
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
  // Temper is bound to the ITEM and multiplies THAT item's own base stats
  // before aggregation — a trinket's stats are never scaled, and one
  // slot's temper can no longer bleed into other gear.
  const addTempered = (itemId: string | undefined): void => {
    if (!itemId) return;
    const s = itemStats(itemId);
    if (!s) return;
    const tb = temperBonusOf(p, itemId);
    for (const [k, v] of Object.entries(s)) {
      let val = v ?? 0;
      if (tb > 0 && val > 0) val = Math.round(val * (1 + tb));
      acc[k] = (acc[k] ?? 0) + val;
    }
  };
  addTempered(p.equipment.weapon);
  addTempered(p.equipment.armor);
  addTempered(p.equipment.trinket);
  return acc;
}

export function statsOf(p: PlayerState): DerivedStats {
  return derivedStats(p.classId, p.level, equippedGearStats(p));
}

/**
 * Idempotent save migration: grants any skills the player should know at
 * their current level (level-1 skills predate the creation fix) and ensures
 * starting-zone access (Whisperwood was never unlockable before).
 */
export function backfillPlayer(p: PlayerState): void {
  // Pre-dedup saves carried equipped gear twice (slots + bag). Idempotent:
  // once the bag copy is gone this becomes a no-op.
  for (const slot of ['weapon', 'armor'] as const) {
    const eq = p.equipment[slot];
    if (eq && countOf(p, eq) > 0) removeItem(p, eq, 1);
  }
  // Legacy slot-bound temper flags move onto the currently equipped items
  // (temper is item-bound now). Idempotent: legacy keys are consumed once.
  for (const slot of ['weapon', 'armor'] as const) {
    const legacy = p.flags[`forge_${slot}`];
    const eq = p.equipment[slot];
    if (typeof legacy === 'number' && legacy > 0 && eq) {
      const key = `forge_i_${eq}`;
      p.flags[key] = Math.max(typeof p.flags[key] === 'number' ? p.flags[key]! : 0, legacy);
    }
    delete p.flags[`forge_${slot}`];
  }
  const known = new Set(p.skills);
  for (const sk of skillsForClass(p.classId, p.level)) {
    if (!known.has(sk.id)) p.skills.push(sk.id);
  }
  for (const zid of STARTING_ZONES) {
    if (!p.unlockedZones.includes(zid)) p.unlockedZones.push(zid);
  }
  // Legacy battles carried a plain zone string as origin; normalize so
  // structured-origin victory bookkeeping never crashes on old saves.
  const b = p.battle;
  if (b) {
    const o = b.origin as unknown;
    if (typeof o === 'string') b.origin = { kind: 'explore', zoneId: o };
  }
}

/** Grants XP and applies any level-ups. Returns messages describing what happened. */
export function grantXp(p: PlayerState, xp: number): string[] {
  const msgs: string[] = [];
  if (p.level >= MAX_LEVEL) {
    // Honest no-op: postgame XP was silently vanishing; say so instead.
    return xp > 0 ? ["✨ You stand at the Flame's summit — XP means nothing now."] : msgs;
  }
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

/** Applies death penalties; the player wakes at a safe haven with 50% HP. */
export function applyDeath(p: PlayerState): string {
  p.stats.deaths++;
  const lost = Math.floor(p.gold * 0.1);
  p.gold -= lost;
  const s = statsOf(p);
  p.hp = Math.max(1, Math.floor(s.maxHp * 0.5));
  p.mp = Math.floor(s.maxMp * 0.5);
  p.currentZone = ZONES.find((z) => z.safeHaven)?.id ?? 'emberfall';
  return lost > 0
    ? `💀 You black out and wake at a safe haven. ${lost} gold slipped from your pockets.`
    : '💀 You black out and wake at a safe haven, somehow poorer in spirit only.';
}
