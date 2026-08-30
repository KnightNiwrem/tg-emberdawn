/**
 * Core state types. Everything here is plain JSON-serializable data: no
 * class instances, no functions, no grammY imports. Persistence depends on it.
 */

export type ClassId = 'warrior' | 'mage' | 'rogue' | 'cleric';

export const CLASS_IDS: readonly ClassId[] = ['warrior', 'mage', 'rogue', 'cleric'] as const;

/** Equipment slots. Each slot holds at most one item. */
export type EquipSlot = 'weapon' | 'armor' | 'trinket';

export interface Equipment {
  weapon?: string;
  armor?: string;
  trinket?: string;
}

export interface InventoryEntry {
  id: string;
  qty: number;
}

export type QuestStatus = 'unavailable' | 'available' | 'active' | 'turnIn' | 'done';

export interface QuestProgress {
  status: QuestStatus;
  /** Progress counters per objective index (kill/collect objectives). */
  counts: number[];
}

export interface EnemyInstance {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  isBoss: boolean;
  /** Turn counter within this battle, used for scripted special moves. */
  turn: number;
}

export type BattlePhase = 'active' | 'won' | 'lost' | 'fled';

/** Where a battle came from — decides what victory bookkeeping applies. */
export type BattleOrigin =
  | { kind: 'explore'; zoneId: string }
  | { kind: 'elite'; zoneId: string }
  | { kind: 'dungeon'; zoneId: string; dungeonId: string; floor: number; boss: boolean };

export interface BattleState {
  enemy: EnemyInstance;
  phase: BattlePhase;
  round: number;
  /** Skill id -> turns remaining on cooldown. */
  cooldowns: Record<string, number>;
  guarding: boolean;
  /** Combat buffs/debuffs (runtime, persisted with the battle). */
  buffs: CombatBuffs;
  /** Rolling log lines, newest last. Rendered inside the battle screen. */
  log: string[];
  /** Rewards staged on victory. */
  rewards?: { xp: number; gold: number; drops: string[] };
  /** Phoenix Cinder already spent this battle (revive is once per battle). */
  phoenixUsed?: boolean;
  /** Structured provenance: for return-after-battle and victory hooks. */
  origin: BattleOrigin;
}

export interface CombatBuffs {
  atkPct: number;
  defPct: number;
  resPct: number;
  magPct: number;
  spdPct: number;
  /** Turns remaining per buff key (atk|def|res|mag|spd). */
  durations: Record<string, number>;
  /** Player-side weaken (from enemy debuffs), with turns left. */
  weakenedPct: number;
  weakenTurns: number;
  /** Enemy-side weaken (player debuffs like Venom Cut), with turns left. */
  enemyWeakenedPct: number;
  enemyWeakenTurns: number;
  /** Player skips next action. */
  stunnedTurns: number;
  /** Enemy skips its next action. */
  stunnedEnemy: boolean;
}

export type ViewId =
  | 'home'
  | 'travel'
  | 'zone'
  | 'battle'
  | 'battleSkills'
  | 'battleItems'
  | 'inventory'
  | 'item'
  | 'equipment'
  | 'skills'
  | 'quests'
  | 'shop'
  | 'forge'
  | 'death'
  | 'character'
  | 'help';

export interface SceneState {
  view: ViewId;
  /** Pagination / selection parameter for the current view (e.g. page, shop slot). */
  arg?: string;
  /** Secondary parameter (e.g. page while in sell mode). */
  arg2?: string;
}

export interface PlayerStats {
  kills: number;
  deaths: number;
  bossesSlain: number;
  battlesWon: number;
  createdAt: number;
  lastPlayed: number;
}

export interface PlayerState {
  userId: number;
  name: string;
  classId: ClassId;
  level: number;
  xp: number;
  gold: number;
  /** Current / max resource pools. */
  hp: number;
  mp: number;
  inventory: InventoryEntry[];
  equipment: Equipment;
  /** Quest id -> progress. */
  quests: Record<string, QuestProgress>;
  /** Ordered ids of zones the player may travel to. */
  unlockedZones: string[];
  currentZone: string;
  /** Generic story/flag storage (key -> numeric or string value). */
  flags: Record<string, number | string | boolean>;
  skills: string[];
  scene: SceneState;
  battle?: BattleState;
  /** Message id of the live game message (staleness guard). */
  messageId?: number;
  /** Save-schema version; drives one-time destructive migrations. */
  stateVersion?: number;
  /** Transient result lines rendered as a banner on the current view. */
  notices: string[];
  stats: PlayerStats;
}

/** Runtime-only context derived from PlayerState; never persisted. */
export interface DerivedStats {
  maxHp: number;
  maxMp: number;
  atk: number;
  def: number;
  mag: number;
  res: number;
  spd: number;
  luck: number;
}
