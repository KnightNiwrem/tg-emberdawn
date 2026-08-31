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

/** Guided prologue state (#69): 'maren' → 'outskirts' → 'fight' → 'done'.
 * Fresh heroes start at 'maren'; migrated pre-launch saves are stamped
 * 'done' by an explicit migration step (they skip the prologue — completion
 * is never inferred from unrelated progress). */
export type TutorialStep = 'maren' | 'outskirts' | 'fight' | 'done';

/** One completed combat round (#67): the round in which the player acted,
 * plus the engine-produced lines for it (player action + enemy response).
 * History is a list of COMPLETE rounds — never truncated mid-round. */
export interface BattleRound {
  round: number;
  lines: string[];
}

/** Structured active-effect metadata (#67): identity and presentation for
 * what CombatBuffs tracks mechanically. Purely presentational — mechanics
 * never read it — but persisted with the battle so the UI can name
 * `Blessing`, show magnitude and remaining duration, instead of surfacing
 * only aggregate percentages keyed by stat. */
export interface ActiveEffect {
  /** Mechanical slot mirrored: a stat key (atk|def|res|mag|spd), 'weaken'
   * (player offense sapped), 'enemyWeaken' (enemy offense sapped), 'guard'
   * (enemy guard stance) or 'enemyStun' (enemy loses next action). */
  key: string;
  /** Stable id (skill id, or slot-prefixed move name for enemy effects). */
  id: string;
  /** Display name, e.g. 'Blessing'. */
  name: string;
  /** Which combatant the effect applies to. */
  side: 'player' | 'enemy';
  /** Human-readable magnitude, e.g. '+30% ATK'. */
  magnitude: string;
  /** What applied it (skill or move name). */
  source: string;
  /** The round at whose END the effect stops applying — engine-computed
   * with the cast-round decay semantics (#27/#38), so display turns derived
   * from it always match the mechanical durations. */
  expiresRound: number;
}

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
  /** Completed rounds, oldest first (#67) — each a full player action +
   * enemy response. The renderer expands only the newest round and collapses
   * the rest; truncation (if ever needed) must keep rounds whole. */
  history: BattleRound[];
  /** Structured effect metadata for the battle screen (#67). Pruned each
   * round; mechanics never read it. */
  effects: ActiveEffect[];
  /** Rewards staged on victory. `xpConvertedGold` is the amount actually
   * granted by post-cap conversion (stamped by `resolveVictory` BEFORE the
   * XP grant, #40) — renderers must never re-infer it from the player's
   * current level, or a 44→45 victory advertises unawarded gold. */
  rewards?: { xp: number; gold: number; drops: string[]; xpConvertedGold?: number };
  /** Phoenix Cinder already spent this battle (revive is once per battle).
   * Required in the current battle shape; initialized by startBattle (#44). */
  phoenixUsed: boolean;
  /** Enemy-side guard (Guard Stance et al., #25): mitigation multiplier and
   * rounds left. Required in the current battle shape; initialized by
   * startBattle (#44). */
  enemyGuardPct: number;
  enemyGuardTurns: number;
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
  | 'tutorial'
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
  | 'npcq'
  | 'shop'
  | 'forge'
  | 'death'
  | 'character'
  | 'help'
  | 'reset';

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
  /** Guided prologue step (#69). Required since schema v5; see TutorialStep. */
  tutorial: TutorialStep;
  /** Generic story/flag storage (key -> numeric or string value). */
  flags: Record<string, number | string | boolean>;
  skills: string[];
  scene: SceneState;
  battle?: BattleState;
  /** Message id of the live game message (staleness guard). */
  messageId?: number;
  /** Render revision of the live message's buttons (#16). Bumped on every
   * committed render and stamped into the callback data it renders; taps
   * carrying an older revision are rejected before any mutation, so a
   * double-tap or replayed button can never execute twice. Fresh players
   * start at 0; every committed render advances it (#43). Only the class
   * picker — rendered before a player exists — sends rev-less callbacks. */
  uiRev: number;
  /** Save-schema version; drives migrations at load time. Required — fresh
   * players receive CURRENT_STATE_VERSION; anything else fails clearly (#44). */
  stateVersion: number;
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
