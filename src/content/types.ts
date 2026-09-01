/**
 * Content data contracts. Content modules export plain data shaped by these
 * types; the engine reads them through the lookup helpers in each module.
 * Keeping the contracts strict lets bulk content be authored/validated
 * independently of gameplay code.
 */

import type { ClassId } from '../engine/types.ts';

/** ── Shared combat-effect vocabulary (#78) ──────────────────────────────
 *
 * One typed effect language for skills, enemy moves, equipment and
 * encounter openings. Content is plain data — never callbacks — and the
 * generic engine resolver executes specs in order without branching on
 * content ids. Equipment/encounter authoring wires in via #80/#82.
 */

/** Stats a `statmod` effect can target. `outgoing` scales ALL damage the
 * combatant deals (the old weaken slots reduced both ATK and MAG legs);
 * `incoming` amplifies damage taken; `mitigation` multiplies the combatant's
 * DEF/RES mitigation (the old enemy guard stances). */
export type StatKey =
  | 'atk'
  | 'mag'
  | 'def'
  | 'res'
  | 'spd'
  | 'luck'
  | 'outgoing'
  | 'incoming'
  | 'mitigation';

/** Same-source reapplication policy (#78). Different sources always
 * coexist as independent instances and fold additively.
 * - `replace`: retire the prior same-source instance, apply a fresh one.
 * - `refresh`: keep the existing magnitude, renew expiry.
 * - `stack`: add an independent contribution.
 * - `strongest`: keep the stronger magnitude (renewing expiry on ties). */
export type StackingPolicy = 'replace' | 'refresh' | 'stack' | 'strongest';

/** Effect tags drive cleanse/dispel targeting and UI colouring. */
export type EffectTag =
  | 'beneficial'
  | 'harmful'
  | 'control'
  | 'periodic'
  | 'weaken'
  | 'poison'
  | 'burn'
  | 'bleed'
  | 'regen'
  | 'mark'
  | 'vulnerable'
  | 'slow'
  | 'armor-break'
  | 'ward-break';

/** Common spec fields. */
interface EffectSpecBase {
  /** Application chance (0..1) — one seeded draw per attempt, in spec
   * order. Unauthored = always applies. */
  chance?: number;
  tags?: EffectTag[];
  /** Cleanse/dispel-removable (default true; encounter conditions opt
   * out). */
  removable?: boolean;
  /** Same-source reapplication policy (default `replace`). */
  stacking?: StackingPolicy;
  /** Overrides the effect's default success log line; `{n}` interpolates
   * the effect's primary amount. Authored copy, honored generically. */
  line?: string;
  /** Suppresses the default success log line. */
  quiet?: true;
  /** Skips this effect when the preceding damage effect in the same list
   * felled its target (riders never land on a corpse). Checked BEFORE the
   * chance draw, so dead targets never consume a roll. */
  requireSurvivor?: true;
  /** Skips this effect unless the preceding damage effect in the same
   * list actually reduced the target's HP (#79) — a fully-shielded hit
   * never triggered the on-flesh rider. Checked BEFORE the chance draw. */
  requireHpDamage?: true;
  /** Battle-lifetime duration (#80): the instance lasts the whole battle
   * instead of a fixed round count (`duration` is then ignored). Never
   * ticks down and never expires; the UI renders it as "lasts the whole
   * battle". */
  lifetime?: 'battle';
}

export type EffectSpec =
  | (EffectSpecBase & {
    kind: 'damage';
    /** Caster-relative target. Default: opponent. */
    target?: 'self' | 'opponent';
    attack: 'phys' | 'mag';
    /** Multiplier on the attacker's effective ATK (phys) / MAG (mag). */
    power: number;
    /** Critical suffix when the line template's `{crit}` placeholder is
     * used (default ' — critical!'). */
    critText?: string;
    /** HP takes the full damage; the target's shield is untouched (#79). */
    bypassShield?: true;
    /** Execute window (#81): when the target's HP fraction is already
     * below `belowPct`, the strike deals `bonusPct` extra damage. */
    execute?: { belowPct: number; bonusPct: number };
  })
  | (EffectSpecBase & {
    kind: 'restore';
    target?: 'self' | 'opponent';
    /** MAG-scaled HP restoration: effectiveMag * hpPower * 2 + hpFlat. */
    hpPower?: number;
    hpFlat?: number;
    /** Fraction of the TARGET's max HP. */
    hpPctOfMax?: number;
    hpFull?: true;
    /** Fraction of the target's max MP. */
    mpPctOfMax?: number;
  })
  | (EffectSpecBase & {
    kind: 'lifesteal';
    /** Heals the CASTER for pct of the damage dealt by the most recent
     * damage effect in the same spec list. */
    pct: number;
  })
  | (EffectSpecBase & {
    kind: 'statmod';
    target?: 'self' | 'opponent';
    stat: StatKey;
    /** Signed magnitude: 0.3 = +30%, −0.25 = −25%. */
    pct: number;
    /** Rounds the effect stays active. */
    duration: number;
    /** `defer`: the cast round cannot use the stat (offensive self-buffs) —
     * the first end-of-round tick is skipped, so the effect is active for
     * `duration` rounds starting with the NEXT round. `immediate`: active
     * the round it is cast — defensive stats count the cast round's enemy
     * response, enemy guards their following rounds. */
    timing: 'defer' | 'immediate';
    /** Display name (defaults to the casting skill/move name). */
    name?: string;
  })
  | (EffectSpecBase & {
    kind: 'control';
    target?: 'self' | 'opponent';
    control: 'stun';
    /** How many of the target's actions are consumed. */
    actions: number;
  })
  | (EffectSpecBase & {
    kind: 'periodic';
    target?: 'self' | 'opponent';
    /** Signed per-tick amount: negative damages, positive heals. Exactly
     * one of `perRound` (flat) / `pctOfMaxPerRound` (of target max HP —
     * author boss caps carefully, #83) must be set. */
    perRound?: number;
    pctOfMaxPerRound?: number;
    duration: number;
    tickPhase: 'roundEnd' | 'playerTurnStart';
    /** Periodic damage normally routes through the target's shield first
     * (#79); set this to bite HP directly. */
    bypassShield?: true;
    /** Display name (Poison, Regeneration…). */
    name: string;
  })
  | (EffectSpecBase & {
    kind: 'cleanse';
    target?: 'self' | 'opponent';
    /** Removes removable instances carrying ANY of these tags. */
    tags: EffectTag[];
    /** Cap on removed instances. */
    max?: number;
  })
  | (EffectSpecBase & {
    kind: 'dispel';
    target?: 'self' | 'opponent';
    tags: EffectTag[];
    max?: number;
  })
  | (EffectSpecBase & {
    kind: 'resource';
    target?: 'self' | 'opponent';
    mpPctOfMax?: number;
  })
  | (EffectSpecBase & {
    kind: 'shield';
    target?: 'self' | 'opponent';
    /** Flat capacity, or MAG-scaled when `magPower` is set (heal-formula
     * parity: MAG * magPower * 2 + amount). The pool itself is ONE shared
     * per-side value over live contributions (#79). */
    amount?: number;
    magPower?: number;
    /** DEF-scaled capacity (#81): DEF * defPower * 2 + amount — warrior
     * wards scale off the stat the class actually has. */
    defPower?: number;
    duration: number;
    timing: 'defer' | 'immediate';
    name?: string;
  });

/** Declarative equipment triggers (#82). Plain data executed by the shared
 * resolver — no callbacks, no item-id branches in combat. `battleStart`
 * resolves exactly once inside the #80 opening (one injected-RNG draw per
 * authored chance, success AND failure recorded in the opening log);
 * reactive kinds fire during rounds with battle-local proc bookkeeping.
 * `maxProcs`/`cooldown` measure SUCCESSFUL procs — a missed chance roll
 * consumes neither budget nor cooldown. Proc-produced effects never
 * re-scan equipment: the scanner is invoked only from the base
 * enemy-action and guard paths, so recursion is structurally impossible. */
export interface EquipTrigger {
  /** Display name (log lines + UI disclosure). */
  name: string;
  /** When it fires. */
  trigger: 'battleStart' | 'onHpDamage' | 'onGuard';
  /** Proc chance (0..1); one injected-RNG draw per attempt. Unauthored =
   * always procs. */
  chance?: number;
  /** Ordered typed effects (#78 vocabulary), applied caster-relative —
   * the wearer is the caster, so `target: 'opponent'` specs hit the foe. */
  effects: EffectSpec[];
  /** Successful procs allowed per battle (default: unlimited). */
  maxProcs?: number;
  /** Rounds required between procs (default: none). */
  cooldown?: number;
  /** Exact player-facing mechanics (item detail/shop/equipment disclosure
   * — numbers here are derived in the UI from the fields above, never
   * re-typed). */
  desc: string;
}

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
  /** Typed combat triggers (#82) — declarative plain data, executed by
   * the shared resolver through the #80 opening and the reactive hooks. */
  triggers?: EquipTrigger[];
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
  desc: string;
  /** Ordered combat effects executed by the generic resolver (#78) — the
   * sole mechanical contract. Flavor lives in `desc`; the catalog test
   * validates that desc and effects agree. */
  effects: EffectSpec[];
  /** UI classification (menu icons, balance reporting). Derived at author
   * time from effects; mechanics never read it. */
  type: SkillType;
  /** Pre-emptive skill (#80): fires automatically in the battle-opening
   * phase. Never castable as a normal action — the engine rejects the tap
   * and the battle skill menu hides it. */
  preEmptive?: true;
}

export interface EnemyMove {
  name: string;
  /** Weight in the AI pick table. */
  weight: number;
  /** Ordered combat effects (#78) — same vocabulary as skills. Damage
   * specs multiply the ENEMY's atk/mag vs the player's DEF/RES; moves
   * without a damage spec never roll dodge and never deal chip damage
   * (#25). */
  effects: EffectSpec[];
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
  /** Pre-emptive ward for boss-provenance encounters (#79): granted at
   * battle start ONLY when the origin marks the boss fight — the same
   * enemy id faced outside the boss floor never opens with it. One-time
   * capacity (no regeneration), not dispellable. */
  openingShield?: { amount: number; duration: number; name?: string };
  /** Enemy-global opening move (#80): resolved in the battle-opening
   * phase in EVERY provenance — unlike openingShield, which needs boss
   * provenance. One-shot, consumes no round, never rerolled. */
  opening?: { name: string; effects: EffectSpec[] };
  /** Tutorial fixture (#69/#74): flagged encounters must never fell a
   * correctly acting full-health hero — enforced by the balance harness
   * (tests/balance_test.ts). Ordinary content must not set this. */
  tutorial?: true;
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
  | {
    kind: 'battle';
    enemy: string;
    weight: number;
    /** Authored encounter eligibility (#73): the event only rolls for
     * players at/above this level. Unauthored = always eligible. Keeps
     * low-level protection in CONTENT, not ad-hoc engine checks. */
    minPlayerLevel?: number;
    /** Symmetric ceiling — author sparingly: returning to earlier areas
     * should still work (old enemies stay spawnable end-game). */
    maxPlayerLevel?: number;
  }
  | { kind: 'treasure'; gold?: number; item?: string; weight: number; text: string }
  | { kind: 'rest'; healPct: number; weight: number; text: string }
  | { kind: 'flavor'; weight: number; text: string }
  | {
    kind: 'elite';
    enemy: string;
    weight: number;
    text: string;
    /** Elites are opt-in: locked until the player is this level (#73). */
    minPlayerLevel?: number;
    maxPlayerLevel?: number;
  };

export interface DungeonFloor {
  /** Cache granted ONCE, on first clearing the floor (#73) — deterministic,
   * never rerolled (cleared floors cannot be refought). */
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
  /** Authored readiness (#73): the level the boss fight is tuned for. The
   * zone view surfaces it, and an under-level dive into the boss floor
   * (inescapable) demands an explicit confirmation before it starts. */
  recommendedLevel?: number;
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
