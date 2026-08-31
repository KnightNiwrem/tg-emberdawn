/**
 * Content data contracts. Content modules export plain data shaped by these
 * types; the engine reads them through the lookup helpers in each module.
 * Keeping the contracts strict lets bulk content be authored/validated
 * independently of gameplay code.
 */

import type { ClassId } from '../engine/types.ts';

export type ItemKind = 'weapon' | 'armor' | 'trinket' | 'consumable' | 'material' | 'quest';

export interface ItemStats {
  atk?: number;
  def?: number;
  mag?: number;
  res?: number;
  spd?: number;
  hp?: number;
  mp?: number;
  luck?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  /** Restricts who may equip; consumables/materials ignore this. */
  classes?: ClassId[];
  /** Minimum level to equip. */
  level: number;
  price: number;
  /** Sell price is derived as floor(price * SELL_RATIO). */
  stats?: ItemStats;
  /** Consumable effect. */
  effect?: {
    healHp?: number;
    healMp?: number;
    cureStatus?: true;
    revivePct?: number;
    /** Battle-only: guaranteed escape from non-boss fights. */
    flee?: true;
  };
  /** short flavor / description line */
  desc?: string;
  /** Tier for shop/loot organization (1..8). 0 = special. */
  tier: number;
  /** Never sold in shops (drop/quest rewards only). */
  unique?: boolean;
}

export type SkillType = 'phys' | 'mag' | 'heal' | 'buff' | 'debuff';

export interface SkillDef {
  id: string;
  name: string;
  classId: ClassId;
  /** Learned automatically at this level. */
  learnLevel: number;
  mpCost: number;
  cooldown: number;
  /** Damage/heal multiplier applied to atk/mag (phys vs mag) — 1.0 = basic attack. */
  power: number;
  type: SkillType;
  desc: string;
  /** Buff/debuff magnitude (e.g. 0.5 = +50% def for buff). */
  potency?: number;
  /** Duration of buffs/debuffs in enemy turns. */
  duration?: number;
  /** Flat chance-based stun (0..1) applied on hit. */
  stunChance?: number;
}

export interface EnemyMove {
  name: string;
  /** Multiplier vs player def (phys) or res (mag). */
  power: number;
  kind: 'phys' | 'mag';
  /** Weight in the AI pick table. */
  weight: number;
  /** Heals self instead of damaging (pct of maxHp). */
  selfHealPct?: number;
  /** Applies a temporary debuff to the player (pct atk/mag reduction). */
  weakenPct?: number;
  /** Defensive move (#25): raises the enemy's own mitigation for the next
   * `guardTurns` rounds instead of dealing damage. */
  guardPct?: number;
  guardTurns?: number;
}

export interface EnemyDef {
  id: string;
  name: string;
  emoji: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  mag: number;
  res: number;
  spd: number;
  xp: number;
  gold: number;
  boss?: boolean;
  /** Staged special move: used every `every` turns (turn counts from 1). */
  special?: { every: number; move: EnemyMove };
  moves: EnemyMove[];
  /** Item id -> drop chance (0..1). */
  drops?: Record<string, number>;
  desc?: string;
}

export type ObjectiveKind = 'kill' | 'collect' | 'reach' | 'dungeon' | 'talk';

export interface Objective {
  kind: ObjectiveKind;
  /** Enemy id, item id, zone id, or npc id depending on kind. */
  target: string;
  /** Required count (kill/collect). */
  count?: number;
}

export interface NpcDef {
  id: string;
  name: string;
  /** Shown when talked to with no active business. */
  greeting: string;
}

export interface QuestDef {
  id: string;
  name: string;
  main: boolean;
  chapter: number;
  /** Auto-granted when this flag set contains any of these flags. */
  prereqFlags?: string[];
  /** Quest id that must be done first. */
  prereqQuest?: string;
  /** Level requirement to pick up. */
  level: number;
  summary: string;
  /** Intro text when accepting. */
  intro: string;
  /** Turn-in dialog. */
  outro: string;
  objectives: Objective[];
  rewards: {
    xp: number;
    gold: number;
    items?: Record<string, number>;
    /** Flags set on completion. */
    flags?: string[];
    /** Zone unlocked on completion. */
    unlockZone?: string;
  };
  /** NPC id whose dialogue offers (starts) this quest — the physical
   * contact a player must talk to in order to accept it (#63). */
  startNpc: string;
  /** NPC id whose dialogue accepts the turn-in — independent of the starter
   * so delivery flows (start with A, finish with B) are expressible (#63). */
  finishNpc: string;
}

export type ExploreEvent =
  | { kind: 'battle'; enemy: string; weight: number }
  | { kind: 'treasure'; gold?: number; item?: string; weight: number; text: string }
  | { kind: 'rest'; healPct: number; weight: number; text: string }
  | { kind: 'flavor'; weight: number; text: string }
  | { kind: 'elite'; enemy: string; weight: number; text: string };

export interface DungeonFloor {
  /** Chance the floor holds a treasure cache. */
  treasure?: { gold?: number; item?: string };
  enemies: string[];
}

export interface DungeonDef {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  /** Final floor boss. */
  boss: string;
  floors: DungeonFloor[];
  /** Story gate for the BOSS floor: named quest must be done (or, without
   * requireDone, at least active) before the boss can be faced. Normal
   * floors stay open as soon as the zone is unlocked. */
  bossGate?: { quest: string; requireDone?: boolean; item?: string };
  /** First-clear rewards, granted when the boss falls. */
  firstClear?: { xp: number; gold: number; item?: string; flags?: string[]; unlockZone?: string };
}

export interface ZoneDef {
  id: string;
  name: string;
  emoji: string;
  chapter: number;
  /** Recommended level range [min, max]. */
  levels: [number, number];
  desc: string;
  explore: ExploreEvent[];
  dungeon?: DungeonDef;
  /** Friendly rest point: full heal on entering zone. */
  safeHaven: boolean;
  npcs: NpcDef[];
}
