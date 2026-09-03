/**
 * Character lifecycle: creation, XP, level-ups, death and revival.
 * Pure functions over PlayerState + content lookups.
 */

import type { ClassId, DerivedStats, PlayerState } from './types.ts';
import { CLASSES, derivedStats, MAX_LEVEL, xpForNextLevel } from './classes.ts';
import { itemStats } from '../content/items.ts';
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
    currentZone: 'emberdawn',
    // Fresh heroes begin the guided prologue (#69): Elder Maren first.
    tutorial: 'maren',
    flags: {},
    decisions: {},
    storyEvents: [],
    questOutcomes: {},
    storyReceipts: [],
    skills: skillsForClass(classId, 1).map((sk) => sk.id),
    scene: { view: 'zone' },
    notices: [],
    uiRev: 0,
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

/** Current save-schema version. Pre-launch this is the ONLY supported shape:
 * bump it when the persisted PlayerState shape changes; older dev saves are
 * retired, not migrated. After launch, bump it per explicit migration step.
 * v9 (#125): decisions ledger, story events, and permanent quest outcomes.
 * v10 (#129): one-shot story-application receipts (storyReceipts). */
export const CURRENT_STATE_VERSION = 10;

/** Thrown when a save was written by a NEWER binary (stateVersion ahead of
 * what this build supports). Handlers must answer without mutating/saving. */
export class SaveTooNewError extends Error {
  constructor(from: number) {
    super(`Save version ${from} is newer than supported ${CURRENT_STATE_VERSION}`);
    this.name = 'SaveTooNewError';
  }
}

/** Thrown when a save predates the supported schema. Pre-launch development
 * saves are disposable: the player must /reset (#44, #116). */
export class SaveTooOldError extends Error {
  constructor(from: number | undefined) {
    super(
      from === undefined
        ? `Save carries no stateVersion (supported: ${CURRENT_STATE_VERSION})`
        : `Save version ${from} predates the supported schema ${CURRENT_STATE_VERSION}`,
    );
    this.name = 'SaveTooOldError';
  }
}

/** Non-mutating save-compatibility gate (#116): runs on every load and accepts
 * ONLY the current schema version. Pre-launch, older development saves have no
 * upgrade path — they are refused untouched and the player is directed to
 * /reset; never normalize, infer, repair, backfill or stamp a non-current save.
 * Saves from newer binaries are refused too: never downgrade. */
export function assertSupportedSaveVersion(p: PlayerState): void {
  const from = p.stateVersion;
  if (typeof from !== 'number' || from < CURRENT_STATE_VERSION) {
    throw new SaveTooOldError(typeof from === 'number' ? from : undefined);
  }
  if (from > CURRENT_STATE_VERSION) {
    throw new SaveTooNewError(from);
  }
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
  p.currentZone = ZONES.find((z) => z.safeHaven)?.id ?? 'emberdawn';
  return lost > 0
    ? `💀 You black out and wake at a safe haven. ${lost} gold slipped from your pockets.`
    : '💀 You black out and wake at a safe haven, somehow poorer in spirit only.';
}
