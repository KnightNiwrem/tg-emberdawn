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
 * - `strongest`: keep the stronger magnitude, compared per effect kind
 *   (#93): |pct| for statmods, capacity for shields, actions for controls.
 *   A weaker or equal recast never downgrades — it may only extend the
 *   lifetime. Not defined for periodics (flat and %-of-max ticks are
 *   different units) — content integrity rejects the combination. */
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
     * response, enemy guards their following rounds.
     *
     * #94 SPD exception: SPD's advertised rounds are INITIATIVE snapshots.
     * Mid-round SPD applications are forced to `defer` by the resolver (the
     * snapshot already happened, so the cast round cannot be spent on it) —
     * an N-turn SPD effect always covers N eligible snapshots. Opening SPD
     * applications keep `immediate` (round 1 counts, rounds 1..N). */
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
  /** When it fires (#89). `onEnemyActionHpDamage` — only direct
   * enemy-action HP damage. `onHpDamage` — any HP loss to the wearer
   * (enemy actions, periodic ticks, opening strikes, future
   * reflect/environment causes) EXCEPT proc-produced damage: procs never
   * re-trigger equipment, so recursion is structurally bounded. */
  trigger: 'battleStart' | 'onEnemyActionHpDamage' | 'onHpDamage' | 'onGuard';
  /** Proc chance (0..1); one injected-RNG draw per attempt. Unauthored =
   * always procs. */
  chance?: number;
  /** Successful procs allowed per battle (default: unlimited). */
  maxProcs?: number;
  /** Cooldown N (#89): N complete intervening rounds are unavailable — a
   * success on round R is eligible again on round R + N + 1 (0 = every
   * round). Default: none. */
  cooldown?: number;
  /** Ordered typed effects (#78 vocabulary), applied caster-relative —
   * the wearer is the caster, so `target: 'opponent'` specs hit the foe.
   * The player-facing mechanics are GENERATED from these specs by
   * engine/mechanics.ts (#120) — never authored prose here. */
  effects: EffectSpec[];
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
  /** Optional flavor prose (#120). May be nonliteral and in-world; it is
   * NEVER a rules source — effect-bearing items generate their mechanical
   * summary from structured data (engine/mechanics.ts). */
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
  /** Optional flavor prose (#120) — the skill's personality. Creative,
   * nonliteral, never a rules source: the player-facing mechanical
   * summary is GENERATED from `effects` by engine/mechanics.ts. */
  flavor?: string;
  /** Ordered combat effects executed by the generic resolver (#78) — the
   * SOLE mechanical contract (#120): structured effect data is the only
   * behavioral source of truth. */
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
  /** #83 status resistance (bosses/elites): harmful statuses applied BY THE
   * PLAYER to this enemy fail outright this fraction of the time, with
   * visible "resists" feedback — authored resistance, never blanket
   * immunity. */
  statusResist?: number;
  moves: EnemyMove[];
  /** Item id -> drop chance (0..1). */
  drops?: Record<string, number>;
  desc?: string;
}

export type ObjectiveKind = 'kill' | 'collect' | 'reach' | 'dungeon' | 'storyEvent';

export interface Objective {
  kind: ObjectiveKind;
  /** Enemy id, item id, zone id, dungeon id, or story-event name depending
   * on kind. (#127: the generic 'talk' kind is retired — conversations
   * advance quests by emitting stable story events, never by bare NPC
   * contact.) */
  target: string;
  /** Required count (kill/collect). */
  count?: number;
  /** Display label override (storyEvent objectives name their beat). */
  label?: string;
}

/** One authored player response on a choice node (#126). Conditionally
 * available, optionally consequential, optionally irreversible. Choice ids
 * are stable compact identities (callback budget); consequences are
 * declarative StoryEffects resolved server-side — never carried on the
 * wire. */
export interface DialogueChoice {
  id: string;
  label: string;
  /** Availability condition (#125), re-evaluated at tap time. */
  when?: Condition;
  /** Node to render after the effects apply; omit to end the conversation
   * and return to the NPC topic menu. */
  next?: string;
  /** Declarative consequences, applied atomically and exactly once. */
  effects?: StoryEffect[];
  /** Requires an explicit confirmation panel before any mutation (#126). */
  irreversible?: boolean;
  /** Concise non-spoiler hint of what confirming closes/commits. */
  consequenceHint?: string;
}

/** One beat of an authored conversation (#124): a single speech or
 * narration line with an explicit speaker, a branching prompt (#126), or
 * the end state. */
export type DialogueNode =
  | {
    id: string;
    kind: 'line';
    speaker: 'npc' | 'player' | 'narrator';
    /** The authored beat. Never empty. */
    text: string;
    /** Next node id; omit for the final line of a conversation. */
    next?: string;
    /** Declarative effects applied when this node is REACHED — i.e. on the
     * transition into it (#127), never on rerender (effects are
     * idempotent, so replays stay harmless). Conversation-driven quest
     * progress emits its story event here. */
    effects?: StoryEffect[];
  }
  | {
    id: string;
    kind: 'choice';
    /** The NPC-side prompt the player is responding to. */
    prompt: string;
    choices: DialogueChoice[];
    /** Deferral ("Not now") is offered unless explicitly disabled (#126):
     * it returns to the topic menu with NO mutation. */
    allowDeferral?: boolean;
  }
  | { id: string; kind: 'end' };

/** An authored multi-node conversation (#124): stable ids suitable for
 * persisted scene state and callbacks; one beat per node; explicit
 * speaker identity and next-node relationship. */
export interface DialogueDef {
  id: string;
  /** The NPC who owns this conversation (content-integrity checked). */
  npcId: string;
  start: string;
  nodes: DialogueNode[];
}

/** ── Declarative story effects (#125) ───────────────────────────────────
 *
 * The bounded serializable vocabulary for dialogue/story consequences.
 * Plain data — never content functions. Application lives in
 * engine/story.ts: bundles pre-flight atomically, run in authored order,
 * and are idempotent under replays; quest mutations reuse the central
 * authorities (#63/#64/#119).
 */
export type StoryEffect =
  | { kind: 'setFlag'; id: string; value?: FlagValue }
  | { kind: 'clearFlag'; id: string }
  | { kind: 'recordDecision'; id: string; choiceId: string }
  | { kind: 'storyEvent'; event: string }
  | { kind: 'startQuest'; questId: string }
  | { kind: 'resolveQuest'; questId: string; outcome: string }
  | { kind: 'failQuest'; questId: string; reason?: string }
  | { kind: 'lockQuest'; questId: string; reason?: string }
  | { kind: 'unlockZone'; zoneId: string }
  | { kind: 'grantItem'; itemId: string; qty?: number }
  | { kind: 'removeItem'; itemId: string; qty?: number }
  /** Quest lifecycle through the CENTRAL authorities (#127): acceptance
   * and turn-in with the acting NPC's on-site contact authority
   * revalidated inside the engine — dialogue never reimplements status,
   * rewards or readiness. */
  | { kind: 'acceptQuest'; questId: string }
  | { kind: 'turnInQuest'; questId: string };

/** ── Declarative story conditions (#125) ────────────────────────────────
 *
 * One serializable condition language shared by NPC topic availability,
 * dialogue choices/nodes (#126), quest eligibility, and later
 * consequences. Plain data — evaluation lives in engine/conditions.ts and
 * is pure. No content functions anywhere.
 */

/** JSON-safe flag values. */
export type FlagValue = number | string | boolean;

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { questStatus: { questId: string; is: string | string[] } }
  | { decision: { id: string; choiceId?: string } }
  | { flag: { id: string; equals?: FlagValue } }
  | { levelAtLeast: number }
  | { ownsItem: { itemId: string; count?: number } }
  | { inZone: string }
  /** A quest's permanent terminal resolution (#132): the entry in
   * `p.questOutcomes` — terminal kind, and/or a particular named resolved
   * outcome. Ordinary `turnInQuest` completion persists NO outcome entry
   * (query it with `questStatus: 'done'`); this condition matches only
   * explicit `resolveQuest`/`failQuest`/`lockQuest` resolutions. */
  | {
    questOutcome: {
      questId: string;
      kind?: 'resolved' | 'failed' | 'locked';
      outcome?: string;
    };
  };

/** An authored ordinary conversation/lore topic (#123): stable compact id,
 * player-facing label, and the authored text. Lives with the NPC — never
 * fabricated in handlers. Quest topics are derived from quest state by the
 * pure resolver in engine/npc.ts, not authored here. A topic may instead
 * open a multi-node dialogue (#124). */
export interface NpcTopicDef {
  id: string;
  label: string;
  /** Static single-beat text (when `dialogue` is not set). */
  text?: string;
  /** DialogueDef id to open instead of the static text (#124). */
  dialogue?: string;
  /** Optional availability condition (#125) — the shared declarative
   * language, evaluated pure against player state. Unauthored = always
   * available. */
  when?: Condition;
}

export interface NpcDef {
  id: string;
  name: string;
  /** Shown when talked to with no active business. */
  greeting: string;
  /** Authored lore/conversation topics (#123), offered alongside quest
   * business on the NPC topic menu. */
  topics?: NpcTopicDef[];
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
  /** Authored offer/acceptance conversation (#127): the offer topic opens
   * this dialogue; acceptance happens ONLY at its authored accept choice
   * (a central `acceptQuest` story effect with the #63/#64 on-site
   * authority). Mandatory for every quest — the legacy single-box
   * `intro`/`outro` strings were migrated into dialogue nodes and retired. */
  offerDialogue: string;
  /** Authored completion conversation (#127): the ready-turn-in topic
   * opens this dialogue; the hand-over happens ONLY at its authored turn-in
   * choice (a central `turnInQuest` story effect). Mandatory. */
  turnInDialogue: string;
  /** Authored mid-quest conversation (#127): while the quest is ACTIVE and
   * a storyEvent objective still awaits its event, the active-business
   * topic opens this dialogue; reaching its event node advances the quest. */
  conversationDialogue?: string;
  objectives: Objective[];
  rewards: {
    xp: number;
    gold: number;
    items?: Record<string, number>;
    /** Flags set on completion. */
    flags?: string[];
    /** Zone unlocked on completion. */
    unlockZone?: string;
    /** Additional zones unlocked on completion (#161: multi-zone rewards,
     * e.g. a settlement beside the main destination). */
    unlockZones?: string[];
  };
  /** NPC id whose dialogue offers (starts) this quest — the physical
   * contact a player must talk to in order to accept it (#63). */
  startNpc: string;
  /** NPC id whose dialogue accepts the turn-in — independent of the starter
   * so delivery flows (start with A, finish with B) are expressible (#63). */
  finishNpc: string;
  /** Optional declarative prereq (#125): the shared condition language,
   * ANDed with the legacy prereqQuest/prereqFlags fields. */
  prereq?: Condition;
  /** Legal NAMED completion outcomes (#132) this quest can be resolved
   * with (`resolveQuest` story effects and `questOutcome` conditions are
   * validated against this list). Ordinary `turnInQuest` completion records
   * NO outcome entry — completion is queried with `questStatus: 'done'`;
   * only an alternate `resolveQuest` resolution persists a named outcome
   * here. A named resolution is legal ONLY against this declaration
   * (#146): content integrity and the runtime both refuse a resolution
   * whose outcome this list does not declare, and a quest without a
   * declaration accepts no named resolution at all. */
  outcomes?: readonly string[];
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
  /** Authored local services (#161) — independent of `safeHaven`. */
  services?: ZoneServices;
  /** Contextual loot table id (#158) — the zone's own resource/drop
   * identity, rolled IN ADDITION to ordinary enemy rewards. Enemy-global
   * base drops stay authoritative; quest-kind drops remain subject to the
   * central relevance filter at every grant site. */
  lootTable?: string;
}

/** ── World-route graph (#158) ────────────────────────────────────────────
 *
 * Zones are real graph nodes; routes are authored DIRECTED edges between
 * adjacent zones. A route independently describes how many random travel
 * events occur (`eventCount`) and which weighted table supplies them
 * (`events`). Both together define a route's practical danger and reward —
 * an event count is a number of rolls, NEVER a guaranteed number of
 * battles. Travel-event tables and zone exploration tables are distinct
 * contexts: staying somewhere and crossing between places never share a
 * table by inheritance.
 */

/** One weighted entry of a route's travel-event table (#158). Every event
 * is structured data resolved by the pure journey engine — never a
 * callback. Battle events are ORDINARY fleeable fights; random
 * inescapable bosses or elites must never hide inside an ordinary route
 * table (content integrity rejects boss enemies and elite kinds here). */
export type TravelEvent =
  | { kind: 'flavor'; weight: number; text: string }
  | {
    kind: 'battle';
    enemy: string;
    weight: number;
    /** Authored encounter eligibility (#73 semantics): the event only
     * rolls for players at/above this level. Unauthored = always
     * eligible. */
    minPlayerLevel?: number;
    /** Symmetric ceiling — author sparingly. */
    maxPlayerLevel?: number;
  }
  | {
    kind: 'treasure';
    gold?: number;
    item?: string;
    /** Contextual loot table id (#158), rolled in ADDITION to gold/item —
     * route-specific resources without cloning enemies. */
    dropTable?: string;
    weight: number;
    text: string;
  }
  | { kind: 'rest'; healPct: number; weight: number; text: string };

/** A condition-dependent rewrite of a route's crossing plan (#158):
 * quests, flags, decisions or outcomes can secure, worsen, replace or
 * otherwise transform a road through the shared declarative condition
 * language — never a hard-coded route-ID branch in the engine. */
export interface RouteVariant {
  id: string;
  /** Selection condition. Unauthored = always selected. */
  when?: Condition;
  /** Replaces the base event count for the whole crossing. */
  eventCount: number;
  /** Replaces the base event table when authored. */
  events?: TravelEvent[];
  /** Optional player-facing override for the transformed road. */
  name?: string;
  desc?: string;
}

/** An authored DIRECTED travel edge (#158): one adjacency between two
 * zone nodes. Model directions explicitly — reciprocal roads may share
 * authoring helpers or tables, but asymmetric difficulty and one-way
 * travel are first-class. */
export interface RouteDef {
  id: string;
  /** Origin zone node. */
  from: string;
  /** Destination zone node. */
  to: string;
  /** Player-facing route identity (the road's name). */
  name?: string;
  /** What the crossing is like — creative flavor, never a rules source. */
  desc?: string;
  /** Availability gate for the whole edge. Unauthored = always usable. */
  when?: Condition;
  /** Exact number of forced random travel-event rolls. 0 = a safe,
   * immediate crossing (starter roads). Finite, non-negative. */
  eventCount: number;
  /** Weighted travel-event table; required when `eventCount` > 0. */
  events?: TravelEvent[];
  /** Condition-dependent variants (#158), selected in AUTHORED ORDER —
   * the first passing condition wins; the base plan is always the
   * fallback. A chosen journey snapshots the resolved plan (#159), so a
   * mid-crossing condition change never rewrites the crossing in
   * progress. */
  variants?: RouteVariant[];
}

/** A contextual loot table (#158): independent chance rolls granted in
 * ADDITION to ordinary enemy rewards. Gives zones and routes their own
 * resource identity without cloning complete enemy definitions. */
export interface DropTableDef {
  id: string;
  /** Independent rolls: each entry is granted with its own chance. */
  entries: { item: string; chance: number; qty?: number }[];
}

/** ── Location-scoped facilities (#161) ──────────────────────────────────
 *
 * Shops and forges are independent services attached ONLY to zones where
 * they exist, by stable facility identity. Safety is orthogonal: a safe
 * haven may lack either or both; a dangerous zone may exceptionally host
 * one. Nothing derives services from `safeHaven`, and neither facility
 * implies the other.
 */

/** A zone's authored local services (#161) — stable facility ids, never
 * inline catalogs. Absent fields mean the zone has no such facility. */
export interface ZoneServices {
  shop?: string;
  forge?: string;
}

/** One stock rule of a shop (#161): a group of item ids, optionally
 * gated by the declarative condition language (quest/flag/level/decision
 * upgrades) and optionally priced away from list price when the local
 * price behavior is clearly authored. */
export interface StockRule {
  items: string[];
  /** Availability condition. Unauthored = always on the shelf. */
  when?: Condition;
  /** Local price multiplier over the item's list price. 1 = list. */
  pricePct?: number;
}

export interface ShopDef {
  id: string;
  name: string;
  /** What kind of establishment this is — flavor, never mechanics. */
  desc?: string;
  /** Authored stock rules, evaluated in order; first sighting of an item
   * wins its price. Resolution re-filters gear to the SHOPPER's class and
   * level (#22) — authored stock lists the shelf, never a personal
   * guarantee. */
  stock: StockRule[];
}

/** What a forge can do, and how progression raises it (#161). Tempering
 * remains per-pattern mastery (`forge_i_<itemId>`): local capability
 * bounds WHERE the work can be done, never WHAT the work is worth. */
export interface ForgeCapabilities {
  /** Which equipped slots this forge can temper. */
  slots: ('weapon' | 'armor')[];
  /** Highest temper level this forge can reach (≤ MAX_TEMPER). */
  maxTemper: number;
  /** Condition-driven upgrades, evaluated in authored order: each passing
   * upgrade REPLACES the base limits with its own when present. */
  upgrades?: ForgeUpgrade[];
}

export interface ForgeUpgrade {
  name?: string;
  when: Condition;
  /** Raises the temper ceiling while the condition passes. */
  maxTemper?: number;
  /** Extends the temperable slots while the condition passes. */
  slots?: ('weapon' | 'armor')[];
}

export interface ForgeDef {
  id: string;
  name: string;
  desc?: string;
  capabilities: ForgeCapabilities;
}
