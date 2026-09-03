/**
 * Core state types. Everything here is plain JSON-serializable data: no
 * class instances, no functions, no grammY imports. Persistence depends on it.
 */

import type { EffectTag, StackingPolicy, StatKey } from '../content/types.ts';

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

/** A recorded narrative decision (#125): WHO chose WHAT, WHERE, and WHEN.
 * An irreversible player decision is never reduced to an unexplained
 * boolean — the ledger carries provenance for later reactions and the
 * future journal. Decision ids and choice ids are persisted content
 * identities: freely renameable pre-launch; durable at the live-save
 * baseline. */
export interface DecisionRecord {
  choiceId: string;
  dialogueId: string;
  nodeId: string;
  chosenAt: number;
}

/** A quest's permanent resolution (#125): named completion outcomes,
 * failures, and permanent lockouts live HERE — never inferred from the
 * absence of flags. A locked/failed quest is excluded from availability
 * resurrection (questExcluded). */
export interface QuestOutcome {
  kind: 'resolved' | 'failed' | 'locked';
  /** Named completion outcome (resolved only). */
  outcome?: string;
  /** Why the quest is gone (reason/decision reference). */
  reason?: string;
  /** What caused it (decision/dialogue id). */
  by?: string;
  at: number;
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
 * Fresh heroes start at 'maren'; 'done' marks a hero past the prologue. */
export type TutorialStep = 'maren' | 'outskirts' | 'fight' | 'done';

/** One completed combat round (#67): the round in which the player acted,
 * plus the engine-produced lines for it (player action + enemy response).
 * History is a list of COMPLETE rounds — never truncated mid-round. */
export interface BattleRound {
  round: number;
  lines: string[];
}

/** Provenance of a live effect instance (#78): what applied it, for logs,
 * UI and cleanse/dispel source policy. */
export interface EffectSource {
  kind: 'skill' | 'enemyMove' | 'item' | 'encounter';
  id: string;
  name: string;
}

/** A live mechanical effect instance (#78) — the single authoritative
 * battle-effect state. Mechanics READ these (stats fold from live
 * instances, control consumes actions, periodic ticks damage/heal) and the
 * battle UI DERIVES its rows from them; there is no second presentational
 * collection to drift. Plain JSON, deterministic. */
export interface EffectInstance {
  /** Unique within the battle (allocated from `effectSeq`). */
  iid: string;
  /** Authored effect identity: skill id, move name, item id — reapplication
   * policies key on this. */
  defId: string;
  /** Display name ('Blessing', 'Sapped', 'Guard Stance'). */
  name: string;
  /** Which combatant the effect applies to. */
  side: 'player' | 'enemy';
  source: EffectSource;
  kind: 'statmod' | 'control' | 'periodic' | 'shield';
  // ── statmod / shield payloads ──
  stat?: StatKey;
  pct?: number;
  // ── control payloads ──
  control?: 'stun';
  /** Remaining target actions this control effect consumes. */
  actions?: number;
  // ── periodic payloads ──
  perRound?: number;
  pctOfMaxPerRound?: number;
  tickPhase?: 'roundEnd' | 'playerTurnStart';
  /** Periodic damage skips the target's shield and bites HP directly
   * (#79) — carried from the authored spec so ticks route correctly. */
  bypassShield?: boolean;
  // ── shield payloads (#79 wires absorption) ──
  shieldAmount?: number;
  tags: EffectTag[];
  stacking: StackingPolicy;
  /** Round the effect was applied (UI/history provenance). */
  appliedRound: number;
  /** Rounds left; decremented at end of round (deferred effects skip their
   * first tick). Removed when <= 0. */
  remaining: number;
  /** Set for deferred timing: the cast round cannot use the stat, so the
   * first end-of-round tick is skipped (#27/#38/#77). */
  deferFirstTick?: boolean;
  /** Cleanse/dispel-removable (encounter conditions may opt out). */
  removable: boolean;
  /** Last round the effect is active in — engine-computed so display turns
   * derived from it always match the mechanical countdown. */
  expiresRound: number;
  /** Battle-lifetime (#80): never ticks down, never expires. */
  battleLifetime?: boolean;
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
  /** Live mechanical effect instances (#78) — the authoritative combat
   * state. Derived stats, cleanse/dispel, UI rows and the balance metrics
   * all read from here. */
  effectInstances: EffectInstance[];
  /** Monotonic allocator for effect instance ids (persisted for
   * determinism across save/load). */
  effectSeq: number;
  /** Equipment proc bookkeeping (#82): key `${itemId}:${triggerIndex}` ->
   * { count, round }. Battle-local and JSON-serializable; lazily created on
   * the first reactive proc. `count` = successful procs, `round` = round of
   * the last success (a cooldown-N trigger re-arms on that round + N + 1,
   * #89); missed chance rolls update neither. */
  procs?: Record<string, { count: number; round: number }>;
  /** Resolved battle opening (#80): collected ONCE at construction —
   * never rerolled on save/load/rerender. Absent when no opening content
   * fired. The renderer shows it on the untouched round-1 screen and keeps
   * it available (collapsed) thereafter. */
  opening?: { lines: string[] };
  /** Current shield pool per side (#79): the absorbable value that
   * post-mitigation damage drains before HP. The maximum is DERIVED from
   * live shield contributions (maxShield), never stored. */
  shield: { player: number; enemy: number };
  /** Completed rounds, oldest first (#67) — each a full player action +
   * enemy response. The renderer expands only the newest round and collapses
   * the rest; truncation (if ever needed) must keep rounds whole. */
  history: BattleRound[];
  /** Rewards staged on victory. `xpConvertedGold` is the amount actually
   * granted by post-cap conversion (stamped by `resolveVictory` BEFORE the
   * XP grant, #40) — renderers must never re-infer it from the player's
   * current level, or a 44→45 victory advertises unawarded gold. */
  rewards?: { xp: number; gold: number; drops: string[]; xpConvertedGold?: number };
  /** Phoenix Cinder already spent this battle (revive is once per battle).
   * Required in the current battle shape; initialized by startBattle (#44). */
  phoenixUsed: boolean;
  /** Structured provenance: for return-after-battle and victory hooks. */
  origin: BattleOrigin;
  /** Guided-prologue marker (#69 rework): only the prologue battle carries
   * this, set by the tutorial flow at creation. The engine phase-gates the
   * encounter — the enemy cannot die before every lesson beat has been
   * performed, and the beat after Guard delivers one scripted, nonlethal
   * teaching hit that lands the hero clearly below the item-lesson
   * threshold. Ordinary battles never set it. */
  tutorial?: boolean;
  /** The current lesson beat while `tutorial` is set. Advanced by the
   * engine, only on the intended action kinds, in order. */
  tutorialStep?: TutorialBeat;
}

/** The guided prologue's lesson beats, in order (#69 rework). */
export type TutorialBeat = 'basic' | 'skill' | 'guard' | 'item' | 'cleared';

export type ViewId =
  | 'tutorial'
  | 'travel'
  | 'zone'
  | 'npc'
  | 'dialogue'
  | 'battle'
  | 'battleSkills'
  | 'battleItems'
  | 'inventory'
  | 'item'
  | 'equipment'
  | 'equippedItem'
  | 'skills'
  | 'quests'
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
  /** Secondary parameter (e.g. page while in sell mode). For item details
   * (#112): the origin context — the inventory page it came from, or 'eq'
   * when opened from the Equipment screen, so Back returns to the origin.
   * For dialogue scenes (#124/#126): the current NODE id. */
  arg2?: string;
  /** Third parameter (#126): the dialogue's staged sub-state —
   * `confirm:<choiceId>` while an irreversible confirmation panel is up.
   * Absent on every other view. */
  arg3?: string;
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
  /** Guided prologue step (#69). Required on every save; see TutorialStep. */
  tutorial: TutorialStep;
  /** Generic story/flag storage (key -> numeric or string value). */
  flags: Record<string, number | string | boolean>;
  /** Irreversible narrative decisions (#125), keyed by stable decision id. */
  decisions: Record<string, DecisionRecord>;
  /** Ordered, deduped story events (#125) — the durable record dialogue
   * and future objective hooks consume (#127). */
  storyEvents: string[];
  /** Permanent quest resolutions (#125): outcomes, failures, lockouts. */
  questOutcomes: Record<string, QuestOutcome>;
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
  /** Save-schema version; gates compatibility at load time. Required — fresh
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
