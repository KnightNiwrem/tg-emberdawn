/**
 * Character lifecycle: creation, XP, level-ups, death and revival.
 * Pure functions over PlayerState + content lookups.
 */

import type { ClassId, DerivedStats, PlayerState } from './types.ts';
import { CLASSES, derivedStats, MAX_LEVEL, xpForNextLevel } from './classes.ts';
import { item, itemStats } from '../content/items.ts';
import { skillsForClass, skillsLearnedAt } from '../content/skills.ts';
import { STARTING_ZONES, ZONES } from '../content/zones.ts';
import { temperBonusOf } from './forge.ts';

export function createPlayer(userId: number, name: string, classId: ClassId): PlayerState {
  const c = CLASSES[classId];
  // Equipped gear lives ONLY in equipment slots — bag copies would double
  // it in derived stats and let players sell their own shirt twice.
  const inv = Object.entries(c.startingItems).map(([id, qty]) => ({ id, qty }));
  const now = Date.now();
  const p: PlayerState = {
    userId,
    name,
    classId,
    level: 1,
    xp: 0,
    gold: 50,
    hp: 0,
    mp: 0,
    inventory: inv,
    equipment: { weapon: c.startingGear.weapon, armor: c.startingGear.armor },
    quests: {},
    unlockedZones: [...STARTING_ZONES],
    currentZone: 'emberfall',
    flags: {},
    skills: skillsForClass(classId, 1).map((sk) => sk.id),
    scene: { view: 'home' },
    notices: [],
    stateVersion: CURRENT_STATE_VERSION,
    stats: { kills: 0, deaths: 0, bossesSlain: 0, battlesWon: 0, createdAt: now, lastPlayed: now },
  };
  // Starting pools come from the SAME canonical aggregation gameplay uses —
  // never a hand-rolled stat merge (that once under-counted Cleric HP).
  const s = statsOf(p);
  p.hp = s.maxHp;
  p.mp = s.maxMp;
  return p;
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

/** Keeps current pools within derived maximums — call after any equipment
 * change, so swapping away +HP/+MP gear can't leave you over-capped. */
export function clampPools(p: PlayerState): void {
  const s = statsOf(p);
  p.hp = Math.min(p.hp, s.maxHp);
  p.mp = Math.min(p.mp, s.maxMp);
}

/** Current save-schema version. Bump when a destructive migration is added. */
export const CURRENT_STATE_VERSION = 3;

/**
 * Save migration. Destructive legacy cleanups run ONCE, gated by an explicit
 * `stateVersion` on the save — never by "state looks old" sniffing, which
 * used to delete legitimately re-purchased gear on every single load.
 *   v0 → 1: pre-dedup saves carried equipped gear twice (slots + bag).
 *   v0 → 2: slot-bound temper flags → item-bound; legacy battle shape
 *           (string origin, missing buff fields) normalized.
 */
/** Thrown when a save was written by a NEWER binary (stateVersion ahead of
 * what this build supports). Handlers must answer without mutating/saving. */
export class SaveTooNewError extends Error {
  constructor(from: number) {
    super(`Save version ${from} is newer than supported ${CURRENT_STATE_VERSION}`);
    this.name = 'SaveTooNewError';
  }
}

export function migratePlayer(p: PlayerState): void {
  const from = typeof p.stateVersion === 'number' ? p.stateVersion : 0;
  if (from > CURRENT_STATE_VERSION) {
    // Never downgrade: an older binary must not rewrite a newer save — it
    // would drop fields it cannot understand on the next write.
    throw new SaveTooNewError(from);
  }
  // The v0→v1 gear dedup was RETIRED. `stateVersion === undefined` spans at
  // least two cohorts: genuinely old saves with the starter-duplication bug,
  // AND intermediate saves that may legitimately own a re-purchased copy of
  // what they wear. The old heuristic (delete a bag copy of the currently
  // equipped item) destroyed legitimate property and missed the real legacy
  // shape anyway (the OLD starter duplicated after a swap). A grandfathered
  // duplicate is harmless; deletion was not.
  if (from < 2) {
    for (const slot of ['weapon', 'armor'] as const) {
      const legacy = p.flags[`forge_${slot}`];
      const eq = p.equipment[slot];
      if (typeof legacy === 'number' && legacy > 0 && eq) {
        const key = `forge_i_${eq}`;
        p.flags[key] = Math.max(typeof p.flags[key] === 'number' ? p.flags[key]! : 0, legacy);
        delete p.flags[`forge_${slot}`];
      }
      // else: slot empty → DEFER. The legacy flag survives (see the
      // every-load adoption step below) so the investment is never lost.
    }
    const b = p.battle;
    if (b) {
      const o = b.origin as unknown;
      if (typeof o === 'string') b.origin = { kind: 'explore', zoneId: o };
      // Buff fields added after a battle was persisted default to neutral,
      // so old saves can never produce NaN combat math.
      for (const k of ['atkPct', 'defPct', 'resPct', 'magPct', 'spdPct'] as const) {
        b.buffs[k] ??= 0;
      }
      b.buffs.durations ??= {};
      b.buffs.weakenedPct ??= 0;
      b.buffs.weakenTurns ??= 0;
      b.buffs.enemyWeakenedPct ??= 0;
      b.buffs.enemyWeakenTurns ??= 0;
      b.buffs.stunnedTurns ??= 0;
      b.buffs.stunnedEnemy ??= false;
      b.phoenixUsed ??= false;
    }
  }
  if (from < 3) {
    // Catalog pruning (v3): retired items (e.g. q_umbra_key after the m22
    // rework) are unusable dead weight in legacy bags — purge anything the
    // current catalog no longer defines. Known items are never touched.
    p.inventory = p.inventory.filter((e) => item(e.id));
  }
  // Legacy slot-bound temper adoption (every-load, non-destructive): a
  // deferred temper follows the next UNTempered item equipped in its slot,
  // matching old slot-global semantics. Items that already carry their own
  // (newer) temper are left alone; the flag keeps waiting. Nothing here is
  // ever deleted.
  for (const slot of ['weapon', 'armor'] as const) {
    const legacy = p.flags[`forge_${slot}`];
    const eq = p.equipment[slot];
    if (
      typeof legacy === 'number' && legacy > 0 && eq &&
      typeof p.flags[`forge_i_${eq}`] !== 'number'
    ) {
      p.flags[`forge_i_${eq}`] = legacy;
      delete p.flags[`forge_${slot}`];
    }
  }
  // Non-destructive backfills stay every-load (cheap, self-healing):
  // level-1 skills predate the creation fix; starting zones were once
  // never unlockable.
  const known = new Set(p.skills);
  for (const sk of skillsForClass(p.classId, p.level)) {
    if (!known.has(sk.id)) p.skills.push(sk.id);
  }
  for (const zid of STARTING_ZONES) {
    if (!p.unlockedZones.includes(zid)) p.unlockedZones.push(zid);
  }
  p.stateVersion = CURRENT_STATE_VERSION;
}

/** Grants XP and applies any level-ups. Returns messages describing what happened. */
/** Post-cap conversion rate (#14; display-shared since #36): at the summit
 * XP means nothing — valor converts to gold at ceil(xp / 8). */
export function xpToGoldAtCap(xp: number): number {
  return Math.max(1, Math.ceil(xp / 8));
}

/** Shared reward-line XP segment (#42): the XP portion of ANY reward
 * preview or headline — battle spoils, quest previews/turn-ins and dungeon
 * first clears all render the same economy. At the summit the conversion is
 * shown inline; pre-cap stays nominal. Callers must evaluate `level`
 * BEFORE the grant (#40): a reward that itself reaches the cap is a pre-cap
 * grant and must not claim unawarded conversion gold. */
export function xpRewardLabel(level: number, xp: number): string {
  return level >= MAX_LEVEL ? `✨ ${xp} XP → +${xpToGoldAtCap(xp)} gold` : `✨ +${xp} XP`;
}

export function grantXp(p: PlayerState, xp: number): string[] {
  const msgs: string[] = [];
  if (p.level >= MAX_LEVEL) {
    // Postgame: XP has nowhere to go, so the Flame converts valor to gold —
    // endgame kills and quests keep paying instead of silently vanishing.
    // Rate pinned at ceil(xp / 8): the conversion ≈ the kill's own direct
    // gold, so postgame income runs ~2x design gold — pays without
    // tripling (inflation review, #14).
    if (xp <= 0) return msgs;
    const gold = xpToGoldAtCap(xp);
    p.gold += gold;
    return [`✨ The Flame converts your valor: +${gold} gold (XP means nothing at the summit).`];
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
