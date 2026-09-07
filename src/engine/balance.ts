/**
 * Deterministic balance harness (#74): drives the REAL combat engine
 * (startBattle → performAction → resolveVictory) over seeded fights, so
 * pacing decisions rest on distributions instead of one lucky battle.
 *
 * Pure: engine + content only — no grammy, no wall clock (explore's `now`
 * is injected), no Math.random, and no production-content mutation. The
 * printed report lives in scripts/balance.ts (`deno task balance`); the CI
 * invariants and the reviewed snapshot live in tests/balance_test.ts +
 * tests/balance_snapshot.json. Balance changes must refresh the snapshot
 * with an explanation in the commit message.
 */

import type { BattleOrigin, BattleState, ClassId, PlayerState } from './types.ts';
import { CLASS_IDS } from './types.ts';
import type { DungeonDef, EnemyDef, SkillDef, ZoneDef } from '../content/types.ts';
import { CLASSES, MAX_LEVEL, xpForNextLevel } from './classes.ts';
import { applyDeath, createPlayer, grantXp, statsOf } from './character.ts';
import { performAction, type PlayerAction, startBattle } from './combat.ts';
import { resolveVictory } from './world.ts';
import { buy, resolveStock } from './shops.ts';
import { countOf, removeItem } from './inventory.ts';
import { useRecoveryItem } from './supplies.ts';
import { acceptQuest, onStoryEvent, syncAvailability, turnInQuest } from './quests.ts';
import { clampPools } from './character.ts';
import {
  abandonDungeon,
  diveDungeon,
  dungeonOf,
  encounterEligible,
  explore,
  nextDungeonFloor,
} from './world.ts';
import {
  advanceJourney,
  type JourneyTelemetry,
  retreatFromJourney,
  startJourney,
} from './journey.ts';
import { completeTravelBattleEvent } from './journey.ts';
import { resolveRouteById as resolveRouteForSim } from './routes.ts';
import { findRoutePath } from './pathfinding.ts';
import { createPostTutorialPlayer } from './tutorial.ts';
import { ENEMIES } from '../content/enemies.ts';
import { isEquippable, item as itemDef, ITEMS } from '../content/items.ts';
import { shopInZone } from '../content/facilities.ts';
import { quest, QUESTS, zoneOfNpc } from '../content/quests.ts';
import { route as routeDef } from '../content/routes.ts';
import { skill as skillDef, SKILLS } from '../content/skills.ts';
import {
  isDamageSkill,
  isHealSkill,
  skillHealPower,
  skillMaxDamagePower,
} from '../content/skills.ts';
import { hasLiveFromSource } from './effects.ts';
import { zone as zoneDef, ZONES } from '../content/zones.ts';
import { type Rng } from './rng.ts';
import { type CombatTraceEntry } from './telemetry.ts';

import { nearestSupplyShop, nearestUpgradeShop, statWeight } from './campaign_policy.ts';
import {
  createTravelMetrics,
  finalizeTravelMetrics,
  recordJourneyEvent,
  recordTravelArrival,
  type TravelMetrics,
} from './campaign_metrics.ts';
export type { TravelMetrics } from './campaign_metrics.ts';

// ── Heroes ──────────────────────────────────────────────────────────────

/** Gear the simulation hero wears: `starting` = the level-1 class kit
 * (doubles as the deliberately under-geared case at higher levels);
 * `best` = the best normally obtainable, equippable catalog pieces. */
export type GearProfile = 'starting' | 'best';

/** A hero leveled through the REAL grantXp curve (skills/pools canonical),
 * then equipped per profile. Never used in production play. */
export function makeHero(classId: ClassId, level: number, gear: GearProfile): PlayerState {
  const player = createPlayer(0, 'Sim', classId);
  let xp = 0;
  for (let currentLevel = 1; currentLevel < level; currentLevel++) {
    xp += xpForNextLevel(currentLevel);
  }
  grantXp(player, xp);
  if (gear === 'best') equipBest(player);
  const derived = statsOf(player);
  player.hp = derived.maxHp;
  player.mp = derived.maxMp;
  return player;
}

/** Equips the best equippable catalog gear (class + level legal, never
 * unique trophies) — approximates "current best normally obtainable gear". */
function equipBest(player: PlayerState): void {
  for (const kind of ['weapon', 'armor', 'trinket'] as const) {
    const candidates = ITEMS.filter((it) =>
      it.kind === kind && !it.unique && isEquippable(it.id, player.classId, player.level).ok
    );
    const best = candidates.sort((leftItemDef, rightItemDef) =>
      statWeight(rightItemDef.id) - statWeight(leftItemDef.id) ||
      rightItemDef.level - leftItemDef.level
    )[0];
    if (best && statWeight(best.id) > statWeight(player.equipment[kind] ?? '')) {
      player.equipment[kind] = best.id;
    }
  }
  clampPools(player);
}

// ── Policies ────────────────────────────────────────────────────────────

export interface Policy {
  /** `free` — only the class free action. `skill` — best damage skill when
   * it pays MP, else free. `rotation` — heal when hurt, best skill when
   * affordable, guard to recover MP when starved, else free. `tactical`
   * (#84) — effect-aware: cleanses meaningful harm, dispels live enemy
   * benefits, shields an empty pool, buffs once, applies DoTs/debuffs when
   * the remaining fight is long enough to pay, then plays the damage
   * rotation. Same transparent family as `rotation` — a scripted policy,
   * never an optimizer. */
  name: 'free' | 'skill' | 'rotation' | 'tactical';
  items: boolean;
}

export const POLICIES = {
  free: { name: 'free', items: false } as Policy,
  skill: { name: 'skill', items: false } as Policy,
  rotation: { name: 'rotation', items: false } as Policy,
  rotationWithItems: { name: 'rotation', items: true } as Policy,
  tactical: { name: 'tactical', items: false } as Policy,
  tacticalWithItems: { name: 'tactical', items: true } as Policy,
};

// ── Effect-shape classifiers (#84) — public spec shapes only ────────────

/** Self-targeted beneficial statmod (War Cry, Iron Wall, Time Warp…). */
function isBuffSkill(skill: SkillDef): boolean {
  return skill.effects.some((effect) =>
    effect.kind === 'statmod' && effect.target !== 'opponent' && (effect.pct ?? 0) > 0
  );
}

/** A shield-granting skill (Aegis of Dawn…). */
function isShieldSkill(skill: SkillDef): boolean {
  return skill.effects.some((effect) => effect.kind === 'shield');
}

/** Enemy-side damage-over-time (Poison…): negative periodic on the foe. */
function isDotSkill(skill: SkillDef): boolean {
  return skill.effects.some((effect) =>
    effect.kind === 'periodic' && effect.target === 'opponent' &&
    ((effect.perRound ?? 0) < 0 || (effect.pctOfMaxPerRound ?? 0) < 0)
  );
}

/** Pure enemy debuff — a negative opponent statmod with NO damage rider
 * (damage+debuff hybrids stay in the offense family, #84 ordering). */
/** A debuff-only utility skill (no damage, no heal): the tactical policy
 * casts these for value, and the harness counts them (#84). */
export function isPureDebuffSkill(skill: SkillDef): boolean {
  if (isDamageSkill(skill)) return false;
  return skill.effects.some((effect) =>
    effect.kind === 'statmod' && effect.target === 'opponent' && (effect.pct ?? 0) < 0
  );
}

function isCleanseSkill(skill: SkillDef): boolean {
  return skill.effects.some((effect) => effect.kind === 'cleanse');
}

function isDispelSkill(skill: SkillDef): boolean {
  return skill.effects.some((effect) => effect.kind === 'dispel');
}

/** Self-targeted healing-over-time (#81): positive periodic on the caster
 * (Renew). Direct heals own the emergency lanes; regen owns the long grind. */
function isRegenSkill(skill: SkillDef): boolean {
  return skill.effects.some((effect) =>
    effect.kind === 'periodic' && effect.target !== 'opponent' &&
    ((effect.perRound ?? 0) > 0 || (effect.pctOfMaxPerRound ?? 0) > 0)
  );
}

/** Expected total DoT damage over its full authored duration, against this
 * fight's enemy (mirrors the periodic formulas; folded sap ignored — the
 * policy wants an order-of-magnitude payoff check, not a prediction). */
function expectedDotTotal(skill: SkillDef, enemyMaxHp: number): number {
  let total = 0;
  for (const effect of skill.effects) {
    if (effect.kind !== 'periodic') continue;
    const flat = effect.perRound ?? 0;
    const pctMax = effect.pctOfMaxPerRound ?? 0;
    if (flat >= 0 && pctMax >= 0) continue;
    total += (Math.abs(flat) + Math.abs(pctMax) * enemyMaxHp) * effect.duration;
  }
  return total;
}

const HEAL_ITEMS = ['c_super_potion', 'c_greater_potion', 'c_potion', 'c_minor_potion'];
const MP_ITEMS = ['c_greater_ether', 'c_ether', 'c_minor_ether'];

/** The harness's action chooser — exported so tests can pin tactical
 * decisions directly (#87 polarity coverage). */
export function chooseAction(
  player: PlayerState,
  battle: BattleState,
  policy: Policy,
  lastWasGuard: boolean,
): PlayerAction {
  if (policy.name === 'free') return { kind: 'attack' };
  const derived = statsOf(player);
  const learned = player.skills
    .map((id) => skillDef(id))
    .filter((skill): skill is SkillDef => Boolean(skill));
  // #84: pre-emptive skills are NOT castable (they fire in the battle
  // opening, #80) — no policy may ever select one, or the engine refuses
  // the action and the hero burns its turn.
  const usable = (skill: SkillDef): boolean =>
    !skill.preEmptive && (battle.cooldowns[skill.id] ?? 0) === 0 && player.mp >= skill.mpCost;
  // #78: policies read public effect shapes, never legacy scalar fields.
  const offense = learned
    .filter(isDamageSkill)
    .sort((leftSkillDef, rightSkillDef) =>
      skillMaxDamagePower(rightSkillDef) - skillMaxDamagePower(leftSkillDef)
    );
  const heals = learned
    .filter(isHealSkill)
    .sort((leftSkillDef, rightSkillDef) =>
      skillHealPower(rightSkillDef) - skillHealPower(leftSkillDef)
    );

  if (policy.name === 'skill') {
    const skill = offense.find(usable);
    return skill ? { kind: 'skill', skillId: skill.id } : { kind: 'attack' };
  }

  if (policy.name === 'tactical') {
    return tacticalAction(player, battle, policy, lastWasGuard, learned, usable, offense, heals);
  }

  // rotation — a sensibly played hero.
  const hurting = player.hp < derived.maxHp * 0.5;
  if (hurting && policy.items && player.hp < derived.maxHp * 0.35) {
    const potion = HEAL_ITEMS.find((id) => countOf(player, id) > 0);
    if (potion) return { kind: 'item', itemId: potion };
  }
  if (hurting) {
    const heal = heals.find(usable);
    if (heal) return { kind: 'skill', skillId: heal.id };
  }
  const skill = offense.find(usable);
  if (skill) return { kind: 'skill', skillId: skill.id };
  const cheapest =
    offense.map((skillDef) => skillDef.mpCost).sort((leftValue, rightValue) =>
      leftValue - rightValue
    )[0] ?? 0;
  if (policy.items && player.mp < cheapest) {
    const ether = MP_ITEMS.find((id) => countOf(player, id) > 0);
    if (ether) return { kind: 'item', itemId: ether };
  }
  // Starved and hurting: alternate guard (mitigate + recover MP) with the
  // free action so a stalled rotation still deals damage.
  if (player.hp < derived.maxHp * 0.4 && player.mp < cheapest && !lastWasGuard) {
    return { kind: 'guard' };
  }
  return { kind: 'attack' };
}

/** The effect-aware policy brain (#84): transparent, ordered, driven by
 * PUBLIC effect shapes and live battle state. It never selects an unusable
 * skill (`usable` already excludes pre-emptive, cooldown and MP gates) and
 * never refreshes a live same-source effect — setup is cast once, then the
 * hero plays damage. Order: cleanse real harm → dispel live enemy benefit
 * → heal under the hurt gate → shield an empty pool → buff once → DoT when
 * the remaining fight pays → pure debuff while it has time → damage
 * rotation → item/guard/attack fallbacks (shared with the plain rotation). */
function tacticalAction(
  player: PlayerState,
  battle: BattleState,
  policy: Policy,
  lastWasGuard: boolean,
  learned: SkillDef[],
  usable: (skill: SkillDef) => boolean,
  offense: SkillDef[],
  heals: SkillDef[],
): PlayerAction {
  const derived = statsOf(player);
  // #90: liveness is source-scoped — any live instance whose stacking
  // identity derives from the skill's id (any of its effects/triggers).
  const liveOn = (side: 'player' | 'enemy', sourceId: string): boolean =>
    hasLiveFromSource(battle, side, sourceId);
  const firstUsable = (skills: SkillDef[]): SkillDef | undefined => skills.find(usable);

  // 1. Cleanse MEANINGFUL harm: a live control effect, or several harmful
  //    instances at once. A single mild debuff is not worth the action.
  const harmful = battle.effectInstances.filter(
    (inst) => inst.side === 'player' && inst.tags.includes('harmful') && inst.removable,
  );
  const cleanser = firstUsable(learned.filter(isCleanseSkill));
  if (cleanser && (harmful.some((inst) => inst.kind === 'control') || harmful.length >= 2)) {
    return { kind: 'skill', skillId: cleanser.id };
  }
  // 2. Dispel a live, removable enemy benefit (boss wards, enemy buffs).
  const dispeller = firstUsable(learned.filter(isDispelSkill));
  if (
    dispeller &&
    battle.effectInstances.some((inst) =>
      inst.side === 'enemy' && inst.tags.includes('beneficial') && inst.removable
    )
  ) {
    return { kind: 'skill', skillId: dispeller.id };
  }
  // 3. Heal under the same hurt gate as the plain rotation.
  if (player.hp < derived.maxHp * 0.5) {
    const heal = firstUsable(heals);
    if (heal) return { kind: 'skill', skillId: heal.id };
  }
  // 3b. Regen (#81): sustained healing while not critical — one cast, then
  // the ticks work for free. Never refreshed while live.
  const regen = learned.filter(isRegenSkill).find((skill) =>
    usable(skill) && !liveOn('player', skill.id)
  );
  if (regen && player.hp < derived.maxHp * 0.75) {
    return { kind: 'skill', skillId: regen.id };
  }
  // 4. Shield an empty pool — never re-grant over a live same-source ward
  //    (over-shield waste is a structural failure, #84).
  const shield = firstUsable(learned.filter(isShieldSkill));
  if (shield && battle.shield.player === 0 && !liveOn('player', shield.id)) {
    return { kind: 'skill', skillId: shield.id };
  }
  // 5. Buff once per live window; setup only pays while the fight lasts.
  const buff = learned.filter(isBuffSkill).find((skill) =>
    usable(skill) && !liveOn('player', skill.id)
  );
  if (buff && battle.enemy.hp > battle.enemy.maxHp * 0.3) {
    return { kind: 'skill', skillId: buff.id };
  }
  // 5b. Shatter a live ward (#88): ordinary damage pools INTO the ward —
  //     a ward-ignoring strike pays through it instead of feeding it.
  if (battle.shield.enemy > 0) {
    const piercer = offense.find((skill) =>
      usable(skill) &&
      skill.effects.some((effect) => effect.kind === 'damage' && effect.bypassShield === true)
    );
    if (piercer) return { kind: 'skill', skillId: piercer.id };
  }
  // 5c. Execute window (#88): inside a finisher's threshold its bonus
  //     strike is the expected-value pick, ahead of raw-power sorting.
  const foeHpPct = battle.enemy.hp / battle.enemy.maxHp;
  const finisher = offense.find((skill) =>
    usable(skill) &&
    skill.effects.some((effect) =>
      effect.kind === 'damage' && effect.execute && foeHpPct < effect.execute.belowPct
    )
  );
  if (finisher) return { kind: 'skill', skillId: finisher.id };
  // 6. DoT when the remaining fight is long enough for the ticks to pay.
  const dot = learned.filter(isDotSkill).find((skill) =>
    usable(skill) && !liveOn('enemy', skill.id)
  );
  if (dot && battle.enemy.hp > expectedDotTotal(dot, battle.enemy.maxHp)) {
    return { kind: 'skill', skillId: dot.id };
  }
  // 7. Pure debuff (sap / weaken) while it has time. Damage-carrying
  //    breaks are NOT here — they stay in the offense family (#84).
  const debuff = learned.filter(isPureDebuffSkill).find((skill) =>
    usable(skill) && !liveOn('enemy', skill.id)
  );
  if (debuff && battle.enemy.hp > battle.enemy.maxHp * 0.35) {
    return { kind: 'skill', skillId: debuff.id };
  }
  // 8. Damage rotation, then the shared fallbacks. While the fight still
  //    has length, prefer the break rider that matches the hero's OWN
  //    damage type (#88): a phys hero sundering DEF buys real strikes;
  //    the same hero shattering RES would buy nothing.
  const prefStat = CLASSES[player.classId].basicAction.kind === 'phys' ? 'def' : 'res';
  const breakPick = battle.enemy.hp > battle.enemy.maxHp * 0.5
    ? offense.find((candidate) =>
      usable(candidate) && !liveOn('enemy', candidate.id) &&
      candidate.effects.some((effect) => effect.kind === 'statmod' && effect.stat === prefStat)
    )
    : undefined;
  const skill = breakPick ?? offense.find(usable);
  if (skill) return { kind: 'skill', skillId: skill.id };
  const cheapest =
    offense.map((skillDef) => skillDef.mpCost).sort((leftValue, rightValue) =>
      leftValue - rightValue
    )[0] ?? 0;
  if (policy.items && player.hp < derived.maxHp * 0.35) {
    const potion = HEAL_ITEMS.find((id) => countOf(player, id) > 0);
    if (potion) return { kind: 'item', itemId: potion };
  }
  if (policy.items && player.mp < cheapest) {
    const ether = MP_ITEMS.find((id) => countOf(player, id) > 0);
    if (ether) return { kind: 'item', itemId: ether };
  }
  if (player.hp < derived.maxHp * 0.4 && player.mp < cheapest && !lastWasGuard) {
    return { kind: 'guard' };
  }
  return { kind: 'attack' };
}

// ── Fights ──────────────────────────────────────────────────────────────

export interface FightResult {
  outcome: 'win' | 'lose' | 'timeout';
  rounds: number;
  hpPct: number;
  mpPct: number;
  dealt: number;
  taken: number;
  itemsUsed: number;
  guardRounds: number;
  mpFromGuard: number;
  crits: number;
  dodges: number;
  healDone: number;
  overheal: number;
  /** New grant capacity on both sides: applied pool growth + wasted
   * capacity. Reapplications adding no capacity contribute zero. */
  shieldGranted: number;
  shieldAbsorbed: number;
  shieldWasted: number;
  shieldExpiryLost: number;
  /** Successful reactive equipment triggers, including reactions during
   * openings. Excludes battleStart activations (included in procHits). */
  equipProcs: number;
  /** Rounds lost to control (the hero was stunned out of acting) (#84). */
  skippedRounds: number;
  /** Policy selections the engine REFUSED — must stay 0 for every sane
   * policy (#84 invariant: never select an unusable skill). */
  invalidActions: number;
  /** MP spent on skills (guard/item MP gains excluded) (#84). */
  mpSpent: number;
  /** Action frequency by skill id (#84 selection evidence). */
  skillCasts: Record<string, number>;
  /** Utility-cast counters by effect family (#84). */
  buffCasts: number;
  shieldCasts: number;
  dotCasts: number;
  debuffCasts: number;
  cleanseCasts: number;
  dispelCasts: number;
  /** Live-instance observation, attributed by `side:defId` (#84): the
   * rounds each effect was live, the applications (new iids) and the
   * applying source — sampled at the top of every round. */
  effectRounds: Record<string, number>;
  effectApplications: Record<string, number>;
  effectSources: Record<string, string>;
  /** ── Structured-telemetry metrics (#88) ── sums from the engine's
   * typed event stream (opt-in sink), never parsed from log text. */
  /** Periodic (DoT) damage that actually reached HP, by direction. */
  dotDealt: number;
  dotTaken: number;
  /** Periodic healing that actually landed (regen, HoTs). */
  hotHealing: number;
  /** Periodic heal magnitude trimmed by full HP — the gap the tick
   * never banked (#88). */
  wastedPeriodicHealing: number;
  /** Effect removals by cause (#88). */
  expiredRemovals: number;
  cleanseRemovals: number;
  dispelRemovals: number;
  consumedRemovals: number;
  /** Times a live ward pool was driven to zero by damage (#88). */
  shieldBreaks: number;
  /** Equipment proc attempts and hits (#88): a missed chance roll is
   * still an attempt. */
  procAttempts: number;
  procHits: number;
  /** Applications whose authored duration is 1 round — transient
   * effects invisible to top-of-round sampling (#88). */
  duration1Applied: number;
}

// Metrics observe a completed engine operation; they never choose actions (#182).
function emptyFightResult(): FightResult {
  return {
    outcome: 'timeout',
    rounds: 0,
    hpPct: 0,
    mpPct: 0,
    dealt: 0,
    taken: 0,
    itemsUsed: 0,
    guardRounds: 0,
    mpFromGuard: 0,
    crits: 0,
    dodges: 0,
    healDone: 0,
    overheal: 0,
    shieldGranted: 0,
    shieldAbsorbed: 0,
    shieldWasted: 0,
    shieldExpiryLost: 0,
    equipProcs: 0,
    skippedRounds: 0,
    invalidActions: 0,
    mpSpent: 0,
    skillCasts: {},
    buffCasts: 0,
    shieldCasts: 0,
    dotCasts: 0,
    debuffCasts: 0,
    cleanseCasts: 0,
    dispelCasts: 0,
    effectRounds: {},
    effectApplications: {},
    effectSources: {},
    dotDealt: 0,
    dotTaken: 0,
    hotHealing: 0,
    wastedPeriodicHealing: 0,
    expiredRemovals: 0,
    cleanseRemovals: 0,
    dispelRemovals: 0,
    consumedRemovals: 0,
    shieldBreaks: 0,
    procAttempts: 0,
    procHits: 0,
    duration1Applied: 0,
  };
}

function aggregateFightTrace(result: FightResult, events: readonly CombatTraceEntry[]): void {
  // #88/#95/#101: typed-entry aggregation — replacement-free sums from
  // structured engine events (never parsed back out of presentation text).
  // dealt/taken are GROSS per-event HP damage: enemy heals and lifesteal
  // no longer subtract from damage dealt, and a same-round heal can never
  // erase or invert damage taken. #106: they sum `hpLost` — the actual
  // HP delta every damage family reports — so overkill (a 157 resolved
  // blow onto a 1-HP target) contributes exactly 1, never the formula.
  for (const event of events) {
    switch (event.kind) {
      case 'hpDamaged':
        if (event.target === 'enemy') result.dealt += event.hpLost;
        else result.taken += event.hpLost;
        break;
      case 'hpRestored':
        // Healing done / overheal for the hero (side player). applied is
        // the post-clamp delta; attempted − applied is the overflow the
        // target's full HP trimmed.
        if (event.side === 'player') {
          result.healDone += event.applied;
          result.overheal += Math.max(0, event.attempted - event.applied);
        }
        break;
      case 'periodicTick':
        if (event.applied < 0) {
          if (event.side === 'enemy') result.dotDealt += -event.applied;
          else result.dotTaken += -event.applied;
        } else if (event.side === 'player') {
          result.hotHealing += event.applied;
          result.wastedPeriodicHealing += Math.max(0, event.amount - event.applied);
        }
        break;
      case 'effectRemoved':
        if (event.cause === 'expired') result.expiredRemovals++;
        else if (event.cause === 'cleansed') result.cleanseRemovals++;
        else if (event.cause === 'dispelled') result.dispelRemovals++;
        else result.consumedRemovals++;
        break;
      case 'shieldBreak':
        result.shieldBreaks++;
        break;
      case 'shieldGrant':
        result.shieldGranted += event.applied + event.wasted;
        result.shieldWasted += event.wasted;
        break;
      case 'procAttempt':
        result.procAttempts++;
        if (event.success) {
          result.procHits++;
          if (event.triggerKind !== 'battleStart') result.equipProcs++;
        }
        break;
      case 'effectApplied':
        // #93: only outcomes that activate a payload count as applications
        // — extended/ignored recasts report the RETAINED instance.
        if (
          event.outcome === 'created' || event.outcome === 'replaced' ||
          event.outcome === 'refreshed'
        ) {
          if (event.duration === 1) result.duration1Applied++;
        }
        break;
      default:
        break;
    }
  }
}

function scanFightLines(result: FightResult, lines: readonly string[]): void {
  // Only metrics the current trace does not express remain line-based:
  // crit/dodge markers, Shield absorption and expired/lost capacity.
  const CRIT = '— critical';
  const DODGE = 'slip aside';
  const SHIELD_ABSORB = /🛡️ (\d+) absorbed/;
  // #121 canonical wording: the pool is always "Shield".
  const SHIELD_FADE = /(\d+) Shield capacity fades/;
  for (const line of lines) {
    if (line.includes(CRIT)) result.crits++;
    if (line.includes(DODGE)) result.dodges++;
    const absorbed = SHIELD_ABSORB.exec(line);
    if (absorbed) result.shieldAbsorbed += Number(absorbed[1]);
    const faded = SHIELD_FADE.exec(line);
    if (faded) result.shieldExpiryLost += Number(faded[1]);
  }
}

function sampleFightEffects(result: FightResult, battle: BattleState, seenIids: Set<string>): void {
  // #84: sample live instances BEFORE acting — opening effects surface on
  // round 1, uptime counts observed rounds, applications count new iids.
  for (const instance of battle.effectInstances) {
    const key = `${instance.side}:${instance.defId}`;
    result.effectRounds[key] = (result.effectRounds[key] ?? 0) + 1;
    if (!seenIids.has(instance.iid)) {
      seenIids.add(instance.iid);
      result.effectApplications[key] = (result.effectApplications[key] ?? 0) + 1;
      result.effectSources[key] = `${instance.source.kind}:${instance.source.name}`;
    }
  }
}

function recordSkillCast(result: FightResult, skillId: string): void {
  result.skillCasts[skillId] = (result.skillCasts[skillId] ?? 0) + 1;
  const cast = skillDef(skillId);
  if (cast) {
    if (isBuffSkill(cast)) result.buffCasts++;
    if (isShieldSkill(cast)) result.shieldCasts++;
    if (isDotSkill(cast)) result.dotCasts++;
    if (isPureDebuffSkill(cast)) result.debuffCasts++;
    if (isCleanseSkill(cast)) result.cleanseCasts++;
    if (isDispelSkill(cast)) result.dispelCasts++;
  }
}

/** Runs ONE real fight on a cloned hero. Never mutates the passed hero and
 * never bypasses combat: victory routes through resolveVictory, defeat
 * through the lethal-hit path. */
export function runFight(
  hero: PlayerState,
  enemyId: string,
  policy: Policy,
  rng: Rng,
  origin: BattleOrigin = { kind: 'explore', zoneId: 'whisperwood' },
): FightResult {
  const player = structuredClone(hero) as PlayerState;
  // #101: the harness collects ONLY its own fight's trace — startBattle
  // and every performAction return their entries explicitly, so nested or
  // concurrent fights cannot cross-contaminate, no collector can leak on
  // a throw, and no finally exists merely to detach telemetry.
  const events: CombatTraceEntry[] = [];
  let rounds = 0;
  let lastWasGuard = false;
  const seenIids = new Set<string>();
  const result = emptyFightResult();
  // #80: the harness constructs battles through the SAME opening pipeline
  // as live play — full hero context, seeded rng.
  const started = startBattle(enemyId, origin, { player, rng });
  if (!started) throw new Error(`balance harness: unknown enemy ${enemyId}`);
  const battle = started.battle;
  player.battle = battle;
  events.push(...started.trace);
  if (battle.opening?.lines.length) scanFightLines(result, battle.opening.lines);
  // #96: the opening's explicit adjudication — a terminal opening ends the
  // fight before round 1; victory still routes through resolveVictory.
  if (started.outcome === 'victory') {
    resolveVictory(player, battle, rng);
    result.outcome = 'win';
  } else if (started.outcome === 'defeat') {
    result.outcome = 'lose';
  }
  while (result.outcome === 'timeout' && battle.phase === 'active' && rounds < 200) {
    sampleFightEffects(result, battle, seenIids);
    const action = chooseAction(player, battle, policy, lastWasGuard);
    lastWasGuard = action.kind === 'guard';
    const mpBefore = player.mp;
    const res = performAction(player, battle, action, rng);
    rounds++;
    events.push(...res.trace);
    if (res.skipped) result.skippedRounds++;
    if (!res.consumedTurn) result.invalidActions++;
    result.mpSpent += Math.max(0, mpBefore - player.mp);
    if (action.kind === 'skill' && res.consumedTurn) {
      recordSkillCast(result, action.skillId);
    }
    scanFightLines(result, res.lines);
    if (action.kind === 'guard') {
      result.guardRounds++;
      result.mpFromGuard += Math.max(0, player.mp - mpBefore);
    }
    if (action.kind === 'item') result.itemsUsed++;
    // #86: the engine's explicit terminal adjudication — shared with the
    // live handler and the tutorial (one outcome authority).
    if (res.outcome === 'victory') {
      resolveVictory(player, battle, rng);
      result.outcome = 'win';
      break;
    }
    if (res.outcome === 'defeat') {
      result.outcome = 'lose';
      break;
    }
  }
  aggregateFightTrace(result, events);
  const derived = statsOf(player);
  result.rounds = rounds;
  result.hpPct = derived.maxHp > 0 ? player.hp / derived.maxHp : 0;
  result.mpPct = derived.maxMp > 0 ? player.mp / derived.maxMp : 0;
  return result;
}

// ── Encounter pools ─────────────────────────────────────────────────────

export interface EncounterSource {
  enemyId: string;
  weight: number;
  origin: BattleOrigin;
}

/** A zone's ordinary battle table (no elites), filtered to encounters the
 * live explore() could actually roll at `level` (#74: one shared
 * eligibility rule — the harness must never simulate an impossible state). */
export function zoneNormalPool(zoneId: string, level: number): EncounterSource[] {
  const zone = zoneDef(zoneId);
  if (!zone) return [];
  return zone.explore
    .filter((event) => event.kind === 'battle')
    .filter((event) => encounterEligible(event, level))
    .map((event) => ({
      enemyId: event.enemy,
      weight: event.weight,
      origin: { kind: 'explore', zoneId },
    }));
}

/** Battle + elite table, exactly as explore() rolls it at `level`. */
export function zoneHostilePool(zoneId: string, level: number): EncounterSource[] {
  const zone = zoneDef(zoneId);
  if (!zone) return [];
  return zone.explore
    .filter((event) => event.kind === 'battle' || event.kind === 'elite')
    .filter((event) => encounterEligible(event, level))
    .map((event) => ({
      enemyId: event.enemy,
      weight: event.weight,
      origin: { kind: event.kind === 'elite' ? 'elite' : 'explore', zoneId } as BattleOrigin,
    }));
}

/** Elite exposure AT `level` (#74): the elite's share of the hostile weight
 * the hero can actually roll there — 0 while the elite is band-locked out
 * or when the level has no live hostiles. */
export function eliteShare(zoneId: string, level: number): number {
  const pool = zoneHostilePool(zoneId, level);
  const total = pool.reduce((sum, source) => sum + source.weight, 0);
  if (total === 0) return 0;
  const elite = pool.filter((source) => source.origin.kind === 'elite').reduce(
    (sum, source) => sum + source.weight,
    0,
  );
  return elite / total;
}

/** Pure collection planner (#74): unlocked zones whose ELIGIBLE explore
 * tables actually drop `target` at `level`, best rate first. */
export function exploreDropZonesFor(target: string, unlocked: string[], level: number): string[] {
  const zones: { id: string; rate: number }[] = [];
  for (const zone of ZONES) {
    if (!unlocked.includes(zone.id)) continue;
    let rate = 0;
    for (const event of zone.explore) {
      if (event.kind !== 'battle' && event.kind !== 'elite') continue;
      if (!encounterEligible(event, level)) continue;
      const drops = ENEMIES.find((enemyDef) => enemyDef.id === event.enemy)?.drops ?? {};
      rate = Math.max(rate, drops[target] ?? 0);
    }
    if (rate > 0) zones.push({ id: zone.id, rate });
  }
  return zones.sort((leftValue, rightValue) => rightValue.rate - leftValue.rate).map((zone) =>
    zone.id
  );
}

/** Pure collection planner (#74): do the dungeon's REMAINING normal floors
 * (fromFloor = the next uncleared floor, 1-based) still yield `target`,
 * through an authored cache or an enemy drop? */
export function dungeonFloorsYield(
  target: string,
  dungeon: DungeonDef,
  fromFloor: number,
): boolean {
  for (
    let floorNumber = Math.max(1, fromFloor);
    floorNumber <= dungeon.floors.length;
    floorNumber++
  ) {
    const floor = dungeon.floors[floorNumber - 1]!;
    if (floor.treasure?.item === target) return true;
    if (
      floor.enemies.some((id) => ENEMIES.find((enemyDef) => enemyDef.id === id)?.drops?.[target])
    ) return true;
  }
  return false;
}

export function dungeonBossSource(zoneId: string): EncounterSource | undefined {
  const zone = zoneDef(zoneId);
  if (!zone?.dungeon) return undefined;
  const dungeon = zone.dungeon;
  return {
    enemyId: dungeon.boss,
    weight: 1,
    origin: {
      kind: 'dungeon',
      zoneId: zone.id,
      dungeonId: dungeon.id,
      floor: dungeon.floors.length + 1,
      boss: true,
    },
  };
}

export function dungeonFloorSources(zoneId: string): EncounterSource[] {
  const zone = zoneDef(zoneId);
  if (!zone?.dungeon) return [];
  return zone.dungeon.floors.flatMap((floor) =>
    floor.enemies.map((enemyId) => ({
      enemyId,
      weight: 1,
      origin: {
        kind: 'dungeon',
        zoneId: zone.id,
        dungeonId: zone.dungeon!.id,
        floor: zone.dungeon!.floors.indexOf(floor) + 1,
        boss: false,
      } as BattleOrigin,
    }))
  );
}

// ── Cells (aggregate many seeded fights) ────────────────────────────────

export interface CellSpec {
  classId: ClassId;
  level: number;
  gear: GearProfile;
  policy: Policy;
  /** Zone id the sources came from (labels + seeds), or a synthetic pool id. */
  pool: string;
  sources: EncounterSource[];
  fights: number;
  seed: number;
}

export interface CellStat {
  classId: ClassId;
  level: number;
  gear: GearProfile;
  policy: string;
  items: boolean;
  pool: string;
  fights: number;
  winRate: number;
  lossRate: number;
  timeoutRate: number;
  avgRoundsWin: number;
  avgHpPctEnd: number;
  avgMpPctEnd: number;
  avgDealt: number;
  avgTaken: number;
  avgItems: number;
  guardFreq: number;
  critsPerFight: number;
  dodgesPerFight: number;
  healPerFight: number;
  overhealPerFight: number;
  /** Mean new Shield grant capacity (applied + wasted), both sides. */
  avgShieldGranted: number;
  avgShieldAbsorbed: number;
  avgShieldWasted: number;
  avgShieldExpiryLost: number;
  /** Reactive equipment procs per fight (#82). */
  avgEquipProcs: number;
  /** #84 effect-aware aggregates: per-fight averages of control losses,
   * MP spent and utility casts; the TOTAL refused selections (must be 0);
   * and source-attributed live-effect observation maps. */
  avgSkippedRounds: number;
  invalidActions: number;
  avgMpSpent: number;
  avgBuffCasts: number;
  avgShieldCasts: number;
  avgDotCasts: number;
  avgDebuffCasts: number;
  avgCleanseCasts: number;
  avgDispelCasts: number;
  skillCasts: Record<string, number>;
  effectRounds: Record<string, number>;
  effectApplications: Record<string, number>;
  effectSources: Record<string, string>;
  /** ── Structured-telemetry averages (#88) ── */
  avgDotDealt: number;
  avgDotTaken: number;
  avgHotHealing: number;
  avgWastedPeriodicHealing: number;
  avgExpiredRemovals: number;
  avgCleanseRemovals: number;
  avgDispelRemovals: number;
  avgConsumedRemovals: number;
  avgShieldBreaks: number;
  avgProcAttempts: number;
  avgProcHits: number;
  avgDuration1Applied: number;
  /** Nearest-rank percentiles across fights (#88): averages hide the
   * tail — a thin catastrophic-loss band is invisible in avgHpPctEnd. */
  roundsP50: number;
  roundsP90: number;
  hpPctP50: number;
  hpPctP90: number;
  mpPctP50: number;
  mpPctP90: number;
  dodgesP50: number;
  dodgesP90: number;
  equipProcsP50: number;
  equipProcsP90: number;
}

const r4 = (value: number): number => Math.round(value * 10000) / 10000;
const r2 = (value: number): number => Math.round(value * 100) / 100;
const r3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Nearest-rank percentile (#88): quantile=0.5 → median, quantile=0.9 → p90. */
function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((leftValue, rightValue) => leftValue - rightValue);
  const percentileIndex = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1),
  );
  return r3(sorted[percentileIndex]!);
}

/** Sums per-fight observation maps into a cell accumulator (#84). */
function addInto(dst: Record<string, number>, src: Record<string, number>): void {
  for (const [key, value] of Object.entries(src)) dst[key] = (dst[key] ?? 0) + value;
}

/** Per-fight average of an observation map, rounded (#84). */
function avgMap(counts: Record<string, number>, fightCount: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) out[key] = r3(value / fightCount);
  return out;
}

export function runCell(spec: CellSpec): CellStat {
  const hero = makeHero(spec.classId, spec.level, spec.gear);
  const total = spec.sources.reduce((sum, source) => sum + source.weight, 0);
  const acc = {
    wins: 0,
    losses: 0,
    timeouts: 0,
    roundsWin: 0,
    hpPct: 0,
    mpPct: 0,
    dealt: 0,
    taken: 0,
    items: 0,
    guard: 0,
    crits: 0,
    dodges: 0,
    heals: 0,
    overheal: 0,
    shieldGranted: 0,
    shieldAbsorbed: 0,
    shieldWasted: 0,
    shieldExpiryLost: 0,
    equipProcs: 0,
    skipped: 0,
    invalid: 0,
    mpSpent: 0,
    buffCasts: 0,
    shieldCasts: 0,
    dotCasts: 0,
    debuffCasts: 0,
    cleanseCasts: 0,
    dispelCasts: 0,
    skillCasts: {} as Record<string, number>,
    effectRounds: {} as Record<string, number>,
    effectApplications: {} as Record<string, number>,
    effectSources: {} as Record<string, string>,
    // #88: telemetry sums + per-fight value arrays for percentiles.
    dotDealt: 0,
    dotTaken: 0,
    hotHealing: 0,
    wastedPeriodicHealing: 0,
    expiredRemovals: 0,
    cleanseRemovals: 0,
    dispelRemovals: 0,
    consumedRemovals: 0,
    shieldBreaks: 0,
    procAttempts: 0,
    procHits: 0,
    duration1Applied: 0,
    roundsArr: [] as number[],
    hpPctArr: [] as number[],
    mpPctArr: [] as number[],
    dodgesArr: [] as number[],
    procsArr: [] as number[],
  };
  // Benchmark samples are paired across classes: opponent selection must not
  // depend on fight length or how many loot rolls a victory consumes. Each
  // fight gets its own stream so reward catalog edits cannot perturb the next
  // sampled opponent or its combat rolls. Production randomness is unchanged.
  const sampleRng = seededRng(spec.seed);
  for (let fightIndex = 0; fightIndex < spec.fights; fightIndex++) {
    const roll = sampleRng() * total;
    let acc2 = 0;
    let src = spec.sources[0]!;
    for (const source of spec.sources) {
      acc2 += source.weight;
      if (roll < acc2) {
        src = source;
        break;
      }
    }
    const fightRng = seededRng(spec.seed + Math.imul(fightIndex + 1, 0x9e3779b9));
    const res = runFight(hero, src.enemyId, spec.policy, fightRng, src.origin);
    if (res.outcome === 'win') acc.wins++;
    else if (res.outcome === 'lose') acc.losses++;
    else acc.timeouts++;
    if (res.outcome === 'win') acc.roundsWin += res.rounds;
    acc.hpPct += res.hpPct;
    acc.mpPct += res.mpPct;
    acc.dealt += res.dealt;
    acc.taken += res.taken;
    acc.items += res.itemsUsed;
    acc.guard += res.guardRounds;
    acc.crits += res.crits;
    acc.dodges += res.dodges;
    acc.heals += res.healDone;
    acc.overheal += res.overheal;
    acc.shieldGranted += res.shieldGranted;
    acc.shieldAbsorbed += res.shieldAbsorbed;
    acc.shieldWasted += res.shieldWasted;
    acc.shieldExpiryLost += res.shieldExpiryLost;
    acc.equipProcs += res.equipProcs;
    acc.skipped += res.skippedRounds;
    acc.invalid += res.invalidActions;
    acc.mpSpent += res.mpSpent;
    acc.buffCasts += res.buffCasts;
    acc.shieldCasts += res.shieldCasts;
    acc.dotCasts += res.dotCasts;
    acc.debuffCasts += res.debuffCasts;
    acc.cleanseCasts += res.cleanseCasts;
    acc.dispelCasts += res.dispelCasts;
    addInto(acc.skillCasts, res.skillCasts);
    addInto(acc.effectRounds, res.effectRounds);
    addInto(acc.effectApplications, res.effectApplications);
    for (const [effectKey, effectSource] of Object.entries(res.effectSources)) {
      acc.effectSources[effectKey] = effectSource;
    }
    // #88: structured-telemetry sums + percentile samples.
    acc.dotDealt += res.dotDealt;
    acc.dotTaken += res.dotTaken;
    acc.hotHealing += res.hotHealing;
    acc.wastedPeriodicHealing += res.wastedPeriodicHealing;
    acc.expiredRemovals += res.expiredRemovals;
    acc.cleanseRemovals += res.cleanseRemovals;
    acc.dispelRemovals += res.dispelRemovals;
    acc.consumedRemovals += res.consumedRemovals;
    acc.shieldBreaks += res.shieldBreaks;
    acc.procAttempts += res.procAttempts;
    acc.procHits += res.procHits;
    acc.duration1Applied += res.duration1Applied;
    acc.roundsArr.push(res.rounds);
    acc.hpPctArr.push(res.hpPct);
    acc.mpPctArr.push(res.mpPct);
    acc.dodgesArr.push(res.dodges);
    acc.procsArr.push(res.equipProcs);
  }
  const fightCount = spec.fights;
  const wins = acc.wins;
  return {
    classId: spec.classId,
    level: spec.level,
    gear: spec.gear,
    policy: spec.policy.name,
    items: spec.policy.items,
    pool: spec.pool,
    fights: fightCount,
    winRate: r4(wins / fightCount),
    lossRate: r4(acc.losses / fightCount),
    timeoutRate: r4(acc.timeouts / fightCount),
    avgRoundsWin: wins > 0 ? r2(acc.roundsWin / wins) : 0,
    avgHpPctEnd: r4(acc.hpPct / fightCount),
    avgMpPctEnd: r4(acc.mpPct / fightCount),
    avgDealt: r2(acc.dealt / fightCount),
    avgTaken: r2(acc.taken / fightCount),
    avgItems: r3(acc.items / fightCount),
    guardFreq: r3(acc.guard / fightCount),
    critsPerFight: r3(acc.crits / fightCount),
    dodgesPerFight: r3(acc.dodges / fightCount),
    healPerFight: r2(acc.heals / fightCount),
    overhealPerFight: r2(acc.overheal / fightCount),
    avgShieldGranted: r2(acc.shieldGranted / fightCount),
    avgShieldAbsorbed: r2(acc.shieldAbsorbed / fightCount),
    avgShieldWasted: r3(acc.shieldWasted / fightCount),
    avgShieldExpiryLost: r3(acc.shieldExpiryLost / fightCount),
    avgEquipProcs: r3(acc.equipProcs / fightCount),
    avgSkippedRounds: r3(acc.skipped / fightCount),
    invalidActions: acc.invalid,
    avgMpSpent: r2(acc.mpSpent / fightCount),
    avgBuffCasts: r3(acc.buffCasts / fightCount),
    avgShieldCasts: r3(acc.shieldCasts / fightCount),
    avgDotCasts: r3(acc.dotCasts / fightCount),
    avgDebuffCasts: r3(acc.debuffCasts / fightCount),
    avgCleanseCasts: r3(acc.cleanseCasts / fightCount),
    avgDispelCasts: r3(acc.dispelCasts / fightCount),
    avgDotDealt: r2(acc.dotDealt / fightCount),
    avgDotTaken: r2(acc.dotTaken / fightCount),
    avgHotHealing: r2(acc.hotHealing / fightCount),
    avgWastedPeriodicHealing: r3(acc.wastedPeriodicHealing / fightCount),
    avgExpiredRemovals: r3(acc.expiredRemovals / fightCount),
    avgCleanseRemovals: r3(acc.cleanseRemovals / fightCount),
    avgDispelRemovals: r3(acc.dispelRemovals / fightCount),
    avgConsumedRemovals: r3(acc.consumedRemovals / fightCount),
    avgShieldBreaks: r3(acc.shieldBreaks / fightCount),
    avgProcAttempts: r3(acc.procAttempts / fightCount),
    avgProcHits: r3(acc.procHits / fightCount),
    avgDuration1Applied: r3(acc.duration1Applied / fightCount),
    roundsP50: percentile(acc.roundsArr, 0.5),
    roundsP90: percentile(acc.roundsArr, 0.9),
    hpPctP50: percentile(acc.hpPctArr, 0.5),
    hpPctP90: percentile(acc.hpPctArr, 0.9),
    mpPctP50: percentile(acc.mpPctArr, 0.5),
    mpPctP90: percentile(acc.mpPctArr, 0.9),
    dodgesP50: percentile(acc.dodgesArr, 0.5),
    dodgesP90: percentile(acc.dodgesArr, 0.9),
    equipProcsP50: percentile(acc.procsArr, 0.5),
    equipProcsP90: percentile(acc.procsArr, 0.9),
    skillCasts: avgMap(acc.skillCasts, fightCount),
    effectRounds: avgMap(acc.effectRounds, fightCount),
    effectApplications: avgMap(acc.effectApplications, fightCount),
    effectSources: acc.effectSources,
  };
}

// ── Standard matrices ───────────────────────────────────────────────────

/** #88: derived from content — EVERY authored skill-unlock level plus the
 * non-unlock breakpoints (2: the canonical post-prologue state,
 * MAX_LEVEL: the endgame cap). A new skill's learnLevel lands in the
 * matrix without hand-editing this list; the matrix-coverage test pins
 * the derivation so the stale-list regression can never recur. */
const AUTHORED_UNLOCK_LEVELS = [...new Set(SKILLS.map((skillDef) => skillDef.learnLevel))].sort(
  (leftLevel, rightLevel) => leftLevel - rightLevel,
);
export const MATRIX_LEVELS: readonly number[] = [
  ...new Set([
    ...AUTHORED_UNLOCK_LEVELS,
    2,
    MAX_LEVEL,
  ]),
].sort((leftValue, rightValue) => leftValue - rightValue);
export const MATRIX_FIGHTS = 120;

/** Zones whose authored bands admit at least one ordinary battle (#74 —
 * checked across the zone's own level range, the levels its hostiles
 * target). */
export function hostileZones(): ZoneDef[] {
  return ZONES.filter((zoneDef) => {
    if (zoneDef.safeHaven) return false;
    for (let level = zoneDef.levels[0]; level <= zoneDef.levels[1]; level++) {
      if (zoneNormalPool(zoneDef.id, level).length > 0) return true;
    }
    return false;
  });
}

/** The full class/level/zone matrix (script report). */
export function runMatrix(fights = MATRIX_FIGHTS, seedBase = 9100): CellStat[] {
  const cells: CellStat[] = [];
  let seedOffset = 0;
  for (const cid of CLASS_IDS) {
    for (const zoneDef of hostileZones()) {
      const [minimumLevel, maximumLevel] = zoneDef.levels;
      for (const level of MATRIX_LEVELS) {
        if (level < minimumLevel - 2 || level > maximumLevel + 2) continue;
        // #74: pools follow the live eligibility rule — a level whose band
        // blocks every hostile simply has no cell (never simulate an
        // impossible state).
        const hostile = zoneHostilePool(zoneDef.id, level);
        if (hostile.length === 0) continue;
        cells.push(
          runCell({
            classId: cid,
            level,
            gear: 'best',
            policy: POLICIES.rotation,
            pool: zoneDef.id,
            sources: hostile,
            fights,
            seed: seedBase + seedOffset++,
          }),
        );
        // #84: the effect-aware policy runs the SAME cells beside the
        // plain rotation — before/after comparisons for #81–#83 cite these.
        cells.push(
          runCell({
            classId: cid,
            level,
            gear: 'best',
            policy: POLICIES.tactical,
            pool: `${zoneDef.id}:tactical`,
            sources: hostile,
            fights,
            seed: seedBase + seedOffset++,
          }),
        );
        if (level <= 9) {
          const normals = zoneNormalPool(zoneDef.id, level);
          if (normals.length === 0) continue;
          cells.push(
            runCell({
              classId: cid,
              level,
              gear: 'best',
              policy: POLICIES.free,
              pool: `${zoneDef.id}:normal`,
              sources: normals,
              fights,
              seed: seedBase + seedOffset++,
            }),
          );
        }
      }
    }
    // Bosses at their band top and one gear tier later (the +6 cliff).
    for (const zoneDef of ZONES) {
      const boss = dungeonBossSource(zoneDef.id);
      if (!boss) continue;
      for (const level of [zoneDef.levels[1], Math.min(MAX_LEVEL_SIM, zoneDef.levels[1] + 6)]) {
        cells.push(
          runCell({
            classId: cid,
            level,
            gear: 'best',
            policy: POLICIES.rotation,
            pool: `boss:${boss.enemyId}`,
            sources: [boss],
            fights,
            seed: seedBase + seedOffset++,
          }),
        );
        cells.push(
          runCell({
            classId: cid,
            level,
            gear: 'best',
            policy: POLICIES.tactical,
            pool: `boss:${boss.enemyId}:tactical`,
            sources: [boss],
            fights,
            seed: seedBase + seedOffset++,
          }),
        );
      }
    }
  }
  return cells;
}

const MAX_LEVEL_SIM = 45;

// ── Snapshot (reviewed balance envelopes) ───────────────────────────────

export const SNAPSHOT_FIGHTS = 200;

export interface BalanceSnapshot {
  fightsPerCell: number;
  note: string;
  eliteShare: Record<string, number>;
  cells: CellStat[];
}

/** The reviewed snapshot: opening band, per-enemy table at the Whisperwood's
 * band start, free-action viability, the Aranya gear cliff, and elite
 * exposure. Regenerate with `deno task balance:update`; a deliberate balance
 * change must refresh it with an explanation. */
export function buildSnapshot(): BalanceSnapshot {
  const cells: CellStat[] = [];
  let seedOffset = 0;
  const nextSeed = (): number => 7100 + seedOffset++;
  const push = (cellSpec: Omit<CellSpec, 'seed' | 'fights'> & { fights?: number }): void => {
    cells.push(
      runCell({ ...cellSpec, fights: cellSpec.fights ?? SNAPSHOT_FIGHTS, seed: nextSeed() }),
    );
  };
  // 1. Opening band: rotation (no items) across each level's LIVE hostile
  //    table (#74) — the Outskirts for the 1–2 band, the Whisperwood after.
  const bandZoneFor = (level: number): string => {
    for (const zoneDef of hostileZones()) {
      // #74: the authored band must CONTAIN the level — ordinary encounters
      // keep no max level, so eligibility alone always matched the
      // Outskirts and the reviewed snapshot never left it.
      if (level < zoneDef.levels[0] || level > zoneDef.levels[1]) continue;
      if (zoneHostilePool(zoneDef.id, level).length > 0) return zoneDef.id;
    }
    return 'outskirts';
  };
  const eliteShareRecord: Record<string, number> = {};
  // #74: exposure recorded AT the levels the snapshot reviews — the live
  // share is 0 while the elite is band-locked out, 7.14% after.
  for (const level of [1, 2, 4, 7, 9]) {
    const zid = bandZoneFor(level);
    eliteShareRecord[`${zid}@${level}`] = r4(eliteShare(zid, level));
  }
  eliteShareRecord['whisperwood@3'] = r4(eliteShare('whisperwood', 3));
  for (const cid of CLASS_IDS) {
    for (const level of [1, 2, 4, 7, 9]) {
      const zid = bandZoneFor(level);
      push({
        classId: cid,
        level,
        gear: 'best',
        policy: POLICIES.rotation,
        pool: zid,
        sources: zoneHostilePool(zid, level),
      });
    }
    // 2. Free-action viability at level 1 (weakest enemy + normal pool).
    push({
      classId: cid,
      level: 1,
      gear: 'starting',
      policy: POLICIES.free,
      pool: 'solo:e_rat',
      sources: [{
        enemyId: 'e_rat',
        weight: 1,
        origin: { kind: 'explore', zoneId: 'outskirts' },
      }],
    });
    push({
      classId: cid,
      level: 1,
      gear: 'starting',
      policy: POLICIES.free,
      pool: 'outskirts:normal',
      sources: zoneNormalPool('outskirts', 1),
    });
  }
  // 3. Per-enemy table at the Whisperwood's band start (level 3) — every
  //    enemy a hero can actually roll there (#74 live pools); the
  //    class-mechanics table behind the onboarding redesign.
  for (const src of zoneHostilePool('whisperwood', 3)) {
    for (const cid of CLASS_IDS) {
      push({
        classId: cid,
        level: 3,
        gear: 'starting',
        policy: POLICIES.rotation,
        pool: `solo:${src.enemyId}`,
        sources: [src],
      });
    }
  }
  // 4. The Aranya gear cliff: tier-1 vs tier-2 breakpoint.
  const aranya = dungeonBossSource('whisperwood')!;
  for (const cid of CLASS_IDS) {
    for (const [level, gear] of [[6, 'starting'], [7, 'best'], [9, 'best']] as const) {
      push({
        classId: cid,
        level,
        gear,
        policy: POLICIES.rotation,
        pool: `boss:${aranya.enemyId}@${gear === 'best' ? 't2' : 't1'}`,
        sources: [aranya],
      });
    }
  }
  // 5. Effect-aware policy evidence (#84): rotation vs tactical at the
  //    mid-band breakpoint, plus an opening-heavy solo (the Chrono Wisp's
  //    Chrono Anchor) — the reviewed cells that #81–#83 evidence cites.
  for (const cid of CLASS_IDS) {
    for (const level of [7, 9]) {
      const zid = bandZoneFor(level);
      push({
        classId: cid,
        level,
        gear: 'best',
        policy: POLICIES.tactical,
        pool: `${zid}:tactical`,
        sources: zoneHostilePool(zid, level),
      });
    }
    push({
      classId: cid,
      level: 19,
      gear: 'best',
      policy: POLICIES.tactical,
      pool: 'solo:e_chronowisp',
      sources: [{
        enemyId: 'e_chronowisp',
        weight: 1,
        origin: { kind: 'explore', zoneId: 'sunspire' },
      }],
    });
  }
  // 6. Every dungeon boss at its intended level (#88, #100): a reviewed
  //    intended-gear lane for EVERY class — late bosses are no longer
  //    covered through one warrior lane — plus an under-geared
  //    (starting-kit) mage variant. The gear lanes stay conceptually
  //    separate: the intended cells answer "can a correctly-progressed
  //    hero of this class win?", the undergeared cell answers "how brutal
  //    is the gear cliff?".
  for (const zoneDef of ZONES) {
    const boss = dungeonBossSource(zoneDef.id);
    if (!boss) continue;
    const intended = zoneDef.levels[1];
    for (const cid of CLASS_IDS) {
      push({
        classId: cid,
        level: intended,
        gear: 'best',
        policy: cid === 'mage' ? POLICIES.tactical : POLICIES.rotation,
        pool: `boss:${boss.enemyId}:intended`,
        sources: [boss],
      });
    }
    push({
      classId: 'mage',
      level: Math.max(1, intended - 1),
      gear: 'starting',
      policy: POLICIES.rotation,
      pool: `boss:${boss.enemyId}:undergeared`,
      sources: [boss],
    });
  }
  return {
    fightsPerCell: SNAPSHOT_FIGHTS,
    note:
      'Reviewed balance envelopes (#74: live-eligible pools, post-tutorial sim start; #84: effect-aware tactical cells + source-attributed effect metrics; #85: enemy-side DEF/RES/SPD/incoming folds through the symmetric effective-stat helpers). Regenerate with deno task balance:update; a deliberate balance change must refresh this file with an explanation in its commit message.',
    eliteShare: eliteShareRecord,
    cells,
  };
}

// ── Chapter-one progression simulation ──────────────────────────────────

export interface ProgressionBeat {
  questId: string;
  level: number;
  gold: number;
  deaths: number;
  fights: number;
  grindFights: number;
  itemsUsed: number;
}

/** #111: the FINAL attempted fight, bounded to one record — never a
 * combat log. */
export interface StallAttempt {
  enemy: string;
  /** `explore@zone`, `elite@zone`, `dungeon@zone:floorN[:boss]` — the
   * encounter provenance that produced the fight. */
  origin: string;
  outcome: 'win' | 'death' | 'retreat';
  rounds: number;
}

/** #111: one tracked quest's gate context at stall time — the active quest
 * additionally carries its objective progress (have/need per objective). */
export interface StallQuest {
  id: string;
  status: string;
  objectives?: { kind: string; target: string; have: number; need: number }[];
}

/** #111: a compact, structured picture of WHERE and HOW a run stalled —
 * the loadout, resources, last attempted fight and failure context an
 * implementor needs to distinguish a tuning problem from a policy bug,
 * a quest-gate bug or resource starvation. Purely observational: collected
 * alongside the run, never read back by policy, and never altering RNG
 * draws, combat state or persistence. Bounded: the final attempt plus
 * aggregate failure counts, never a combat log. */
export interface StallDiagnostic {
  level: number;
  zone: string;
  unlockedZones: string[];
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  gold: number;
  /** Equipped item ids — '' when the slot is empty. */
  equipment: { weapon: string; armor: string; trinket: string };
  /** Tier of each equipped piece (0 = empty/special). */
  gearTiers: { weapon: number; armor: number; trinket: number };
  /** Reactive trigger names on the equipped pieces (#82) — the equipment
   * effects that shape combat outcomes. */
  gearTriggers: string[];
  consumables: { id: string; qty: number }[];
  /** Every tracked quest with its gate status; the active quest carries
   * objective progress. */
  quests: StallQuest[];
  lastAttempt?: StallAttempt;
  /** Consecutive non-win outcomes against the same enemy (0 after a win). */
  failureStreak: number;
  /** Aggregate non-win outcomes per enemy id — the whole-run retry map. */
  failures: Record<string, number>;
}

export interface ProgressionReport {
  classId: ClassId;
  seed: number;
  /** The level after the canonical tutorial outcome — always ≥ 2 (#74). */
  startLevel: number;
  beats: ProgressionBeat[];
  endLevel: number;
  endGold: number;
  totalDeaths: number;
  totalFights: number;
  /** Fights driven by quest objectives (kills, collections, boss dives). */
  totalObjectiveFights: number;
  /** Fights whose only purpose was levelling up. */
  totalGrindFights: number;
  /** Every explore roll, including the non-battle outcomes. */
  totalEncounterAttempts: number;
  totalItemsUsed: number;
  /** #162: the journey the hero actually walked. */
  travel: TravelMetrics;
  chapter1Done: boolean;
  /** #88: the FULL main questline (m1→m25) completed — only the campaign
   * driver can set this; chapter-one runs report false. */
  campaignDone: boolean;
  aranyaLevel: number;
  aranyaGearTier: number;
  aranyaDeathsBefore: number;
  stuck?: string;
  /** #111: the structured stall diagnostic — present exactly when `stuck`
   * is; the string below is formatted FROM this object. */
  stall?: StallDiagnostic;
}

const CH1 = [
  'm1_embers',
  'm2_letter',
  'm3_wolves',
  'm4_floors',
  'm5_arms',
  'm3_roots',
  'm4_blessing',
] as const;

function weaponTier(player: PlayerState): number {
  return player.equipment.weapon ? itemDef(player.equipment.weapon)?.tier ?? 0 : 0;
}

/** Chapter 1 from a hero fresh OUT of the prologue (canonical tutorial
 * outcome: level 2+, #74) with REAL combat, rewards, shops and deaths.
 * Reveals when story beats unlock, how much grinding the curve demands,\ * and what gear the boss actually needed. */
export function simulateChapterOne(classId: ClassId, seed: number): ProgressionReport {
  return driveQuests(classId, seed, CH1, 'm4_blessing');
}

const ALL_MAINS = QUESTS.filter((questDef) => questDef.main).map((questDef) => questDef.id);

/** #88: the FULL main questline m1→m25 with the same real-combat
 * machinery — the balance evidence that every chapter (not just the
 * opening) is traversable with real fights, deaths, shops and grinding. */
export function simulateCampaign(classId: ClassId, seed: number): ProgressionReport {
  return driveQuests(classId, seed, ALL_MAINS, ALL_MAINS[ALL_MAINS.length - 1]!);
}

/** #111: the human-readable stall line, formatted FROM the structured
 * diagnostic — the report string and the data can never drift, and future
 * fields stay testable through the object. Bounded: the tracked quests and
 * the aggregate failure map are finite by construction. */
function formatStallReport(stall: StallDiagnostic): string {
  const active = stall.quests.find((questStatus) => questStatus.status === 'active');
  const detail = active?.objectives
    ? ` active=${active.id}[${
      active.objectives.map((obj) => `${obj.kind}:${obj.target}:${obj.have}/${obj.need}`).join(', ')
    }]`
    : ' no-active';
  const pending = stall.quests.filter((questStatus) => questStatus.status !== 'done').slice(0, 8)
    .map((questStatus) => `${questStatus.id}:${questStatus.status}`).join(' ');
  const gear =
    `weapon=${stall.equipment.weapon}(t${stall.gearTiers.weapon}) armor=${stall.equipment.armor}(t${stall.gearTiers.armor}) trinket=${stall.equipment.trinket}(t${stall.gearTiers.trinket})`;
  const last = stall.lastAttempt
    ? ` last=${stall.lastAttempt.enemy}(${stall.lastAttempt.origin} ${stall.lastAttempt.outcome} ${stall.lastAttempt.rounds}r) streak=${stall.failureStreak}`
    : ' last=none streak=0';
  return `guard limit reached level=${stall.level} ` +
    `hp=${stall.hp}/${stall.maxHp} mp=${stall.mp}/${stall.maxMp} gold=${stall.gold} ` +
    `zone=${stall.zone} zones=[${stall.unlockedZones.join(',')}] ` +
    `pending=[${pending}]${detail} ` +
    `gear[${gear}] triggers=[${stall.gearTriggers.join(',')}] ` +
    `consumables=[${
      stall.consumables.map((consumable) => `${consumable.id}x${consumable.qty}`).join(',')
    }]` +
    `${last} failures={${
      Object.entries(stall.failures).map(([key, count]) => `${key}:${count}`).join(',')
    }}`;
}

/** One campaign fight's completed result; counters observe real engine actions. */
export interface CampaignFightResult {
  outcome: 'win' | 'death' | 'retreat' | 'fled';
  rounds: number;
  itemsUsed: number;
  contextualDrops: number;
}

/** The campaign's fight runner (#178). Flee is an action selected by the
 * road policy; its terminal outcome uses the same bookkeeping as any
 * other action. Operates on the live simulation hero, never a clone. */
export function runCampaignFight(
  player: PlayerState,
  battle: BattleState,
  kind: 'objective' | 'grind' | 'road',
  rng: Rng,
): CampaignFightResult {
  player.battle = battle;
  const result: CampaignFightResult = {
    outcome: 'retreat',
    rounds: 0,
    itemsUsed: 0,
    contextualDrops: 0,
  };
  let lastWasGuard = false;
  // Bound attempts too: a refused policy action must not hang the harness.
  for (let attempts = 0; battle.phase === 'active' && attempts < 200; attempts++) {
    const escaping = kind === 'road' && result.rounds > 1 &&
      player.hp < statsOf(player).maxHp * 0.2 && HEAL_ITEMS.every((id) =>
        countOf(player, id) === 0
      );
    const action: PlayerAction = escaping
      ? { kind: 'flee' }
      : chooseAction(player, battle, POLICIES.rotationWithItems, lastWasGuard);
    if (!escaping) lastWasGuard = action.kind === 'guard';
    const res = performAction(player, battle, action, rng);
    if (res.consumedTurn) {
      result.rounds++;
      if (action.kind === 'item') result.itemsUsed++;
    }
    if (res.outcome === 'victory') {
      resolveVictory(player, battle, rng);
      if (battle.origin.kind === 'travel') completeTravelBattleEvent(player);
      result.contextualDrops = battle.rewards?.contextual?.length ?? 0;
      result.outcome = 'win';
      break;
    }
    if (res.outcome === 'defeat') {
      applyDeath(player);
      player.battle = undefined;
      player.journey = undefined;
      result.outcome = 'death';
      break;
    }
    if (res.outcome === 'fled') {
      player.battle = undefined;
      player.journey = undefined;
      result.outcome = 'fled';
      break;
    }
  }
  // Live Continue dismisses a terminal battle before any next floor or world action.
  if (result.outcome !== 'retreat') player.battle = undefined;
  if (result.outcome === 'retreat' && battle.origin.kind === 'dungeon') {
    player.battle = undefined;
    abandonDungeon(player);
  }
  if (kind === 'road') {
    player.battle = undefined;
    // A timeout abandons the crossing through the live retreat authority.
    if (result.outcome !== 'win' && player.journey) retreatFromJourney(player);
  }
  return result;
}

/** Use only carried supplies between rooms; thresholds leave some missing
 * resources rather than spending a whole potion on trivial damage. */
function prepareDungeonFloor(player: PlayerState): number {
  if (!player.dungeonRun || player.battle) return 0;
  let used = 0;
  for (
    const [pool, maximum, shelf] of [
      ['hp', 'maxHp', HEAL_ITEMS],
      ['mp', 'maxMp', MP_ITEMS],
    ] as const
  ) {
    while (player[pool] < statsOf(player)[maximum] * 0.75) {
      const id = shelf.find((candidate) => countOf(player, candidate) > 0);
      if (!id || !useRecoveryItem(player, id).ok) break;
      used++;
    }
  }
  return used;
}

/** One uninterrupted, real dungeon run. Callers prepare gear, quest access and
 * a finite inventory before entry. Every floor shares one hero: no pool refill,
 * remote shop, or cloned per-fight state conceals attrition. */
export function runDungeon(
  hero: PlayerState,
  dungeon: DungeonDef,
  rng: Rng,
): {
  outcome: 'win' | 'death' | 'retreat' | 'fled' | 'blocked';
  itemsUsed: number;
  rounds: number;
  floors: { floor: number; hp: number; mp: number; battle: boolean }[];
} {
  const player = structuredClone(hero);
  const result: ReturnType<typeof runDungeon> = {
    outcome: 'blocked',
    itemsUsed: 0,
    rounds: 0,
    floors: [],
  };
  for (let step = 0; step <= dungeon.floors.length; step++) {
    result.itemsUsed += prepareDungeonFloor(player);
    const floor = nextDungeonFloor(player, dungeon);
    const entered = diveDungeon(player, dungeon, rng);
    if (!entered.ok) return result;
    result.floors.push({ floor, hp: player.hp, mp: player.mp, battle: !!entered.battle });
    if (entered.kind === 'discovery') continue;
    const fought = runCampaignFight(player, entered.battle, 'objective', rng);
    result.rounds += fought.rounds;
    result.itemsUsed += fought.itemsUsed;
    if (fought.outcome !== 'win') {
      result.outcome = fought.outcome;
      return result;
    }
    if (entered.battle.origin.kind === 'dungeon' && entered.battle.origin.boss) {
      result.outcome = 'win';
      return result;
    }
  }
  return result;
}

/** Drives a quest list from a fresh post-prologue hero to `stopQuest`
 * completion (#88: generalized from the chapter-one driver). Exported for
 * diagnostics testing (#111): a list whose stop quest is unreachable
 * forces a deterministic stall whose report can be asserted field by
 * field. `onTurnIn` (#162) observes the real player state the moment a
 * tracked quest turns in — the progression-aware graph validation rides
 * these snapshots; it must not mutate the state it receives. */
export function driveQuests(
  classId: ClassId,
  seed: number,
  quests: readonly string[],
  stopQuest: string,
  onTurnIn?: (player: PlayerState, questId: string) => void,
): ProgressionReport {
  const rng: Rng = seededRng(seed);
  // #74: ONE canonical post-tutorial constructor — the fresh class kit at
  // level 2. The live item lesson spends a potion and the reward replaces
  // it (net zero), so the canonical inventory is the untouched kit; the
  // full-flow tutorial test pins real play to this exact state.
  const player = createPostTutorialPlayer(0, 'Sim', classId);
  player.tutorial = 'done'; // the sim models a player past the prologue (#69)
  syncAvailability(player);
  let deaths = 0;
  let fights = 0;
  let grind = 0;
  let objective = 0;
  let explores = 0;
  let itemsUsed = 0;
  const beats: ProgressionBeat[] = [];
  const travel = createTravelMetrics();
  const report: ProgressionReport = {
    classId,
    seed,
    startLevel: player.level,
    beats,
    endLevel: 1,
    endGold: 0,
    totalDeaths: 0,
    totalFights: 0,
    totalObjectiveFights: 0,
    totalGrindFights: 0,
    totalEncounterAttempts: 0,
    totalItemsUsed: 0,
    travel,
    chapter1Done: false,
    campaignDone: false,
    aranyaLevel: 0,
    aranyaGearTier: 0,
    aranyaDeathsBefore: 0,
  };
  const onJourneyEvent: JourneyTelemetry = (event) => recordJourneyEvent(travel, event);
  /** BFS over currently usable edges — adjacency, unlocks and conditions
   * all honored. Returns the edge-id path, or undefined when disconnected. */
  const findPath = (toZone: string): string[] | undefined =>
    findRoutePath(player, (id) => id === toZone);
  /** #162: a determined traveler walks RESTED and STOCKED. Before roads
   * that roll events, the hero heals at the nearest safe haven (arrival
   * is the one authority — walking there IS the rest), tops up potions at
   * the nearest counter, and walks BACK to the departure point. The whole
   * prep runs under the inPrep flag: its own roads never re-prep. */
  const prepForRoad = (): void => {
    const stats = statsOf(player);
    const origin = player.currentZone;
    const needsPrep = player.hp < stats.maxHp * 0.9 || countOf(player, 'c_minor_potion') < 2;
    if (!needsPrep) return;
    // The old search checked targets before its >8 expansion guard,
    // so a haven exactly nine hops away remains eligible (#182).
    const path = findRoutePath(player, (id) => zoneDef(id)?.safeHaven === true, {
      includeStart: false,
      maxHops: 9,
    });
    if (path) walkPath(path);
    if (shopInZone(player.currentZone)) shopHere();
    // Supplies: a haven without a counter sends the hero to the nearest
    // one that stocks heal potions (still under inPrep — no nested prep).
    if (HEAL_ITEMS.reduce((sum, id) => sum + countOf(player, id), 0) < 3) restock();
    // Return to the departure point — still under inPrep (no nested prep).
    const back = findPath(origin);
    if (back) walkPath(back);
  };
  /** Prep never preps its own walk: the flag keeps haven-bound roads from
   * recursing (the walk IS synchronous, single-threaded). */
  let inPrep = false;
  /** Crosses ONE authored edge through the REAL journey engine: every
   * event roll resolves through the live coordinator, road fights run the
   * combat policy (with the flee policy), and arrival is the one
   * authority. False = the crossing aborted (death/flee); the caller
   * recovers through the same flow a player would. */
  const crossEdge = (edgeId: string): boolean => {
    travel.edgeAttempts[edgeId] = (travel.edgeAttempts[edgeId] ?? 0) + 1;
    // Pre-arrival condition sampling (#169): HP/MP captured BEFORE every
    // coordinator call; on arrival, the last sample is the road's own
    // condition — never the safe-haven full heal that masks it.
    let preHp = player.hp;
    let preMp = player.mp;
    const start = startJourney(player, edgeId, rng, onJourneyEvent);
    if (!start.ok) return false;
    let step = start.step;
    let guard = 0;
    while (guard++ < 60) {
      if (step.kind === 'arrived') {
        recordTravelArrival(travel, edgeId, { hp: preHp, mp: preMp, ...statsOf(player) });
        return true;
      }
      if (step.kind === 'progress') {
        preHp = player.hp;
        preMp = player.mp;
        step = advanceJourney(player, rng, onJourneyEvent);
        continue;
      }
      const outcome = fight(step.battle, 'road');
      if (outcome === 'win') {
        preHp = player.hp;
        preMp = player.mp;
        step = advanceJourney(player, rng, onJourneyEvent);
        continue;
      }
      return false;
    }
    return false;
  };
  /** Walks a path of edges in order. False = aborted (death/flee); the
   * death flow has already relocated the hero to the respawn haven. */
  const walkPath = (path: readonly string[]): boolean => {
    // A careful traveler does not barrel edge after edge at low HP: after
    // each crossing, a spent hero turns back to the nearest haven, rests,
    // re-arms, and returns to this exact spot before the next road
    // (#162 — bounded, so a hot stretch aborts instead of thrashing).
    let rePreps = 0;
    for (let edgeIndex = 0; edgeIndex < path.length; edgeIndex++) {
      const edgeId = path[edgeIndex]!;
      if (!crossEdge(edgeId)) return false;
      const here = routeDef(edgeId)?.to;
      if (
        !inPrep && rePreps < 3 && here !== undefined && player.currentZone === here &&
        player.hp < statsOf(player).maxHp * 0.55
      ) {
        rePreps++;
        inPrep = true;
        try {
          prepForRoad();
        } finally {
          inPrep = false;
        }
        // Prep may have relocated the hero (death on the way back): the
        // remaining edges no longer start here — abort; the caller's next
        // walkTo re-plans from wherever the hero now stands.
        if (player.currentZone !== here) return false;
      }
    }
    return true;
  };
  /** One bounded attempt to walk the real graph to `zoneId` through
   * usable edges — no retries, no recursion. Eventful paths prep first
   * (heal + restock at a haven, then back to the departure point). */
  const walkTo = (zoneId: string): boolean => {
    if (player.currentZone === zoneId) return true;
    const path = findPath(zoneId);
    if (!path || path.length === 0) return false; // disconnected: never pretend
    const eventful = path.some((id) => {
      const plan = resolveRouteForSim(player, id);
      return plan !== undefined && plan.eventCount > 0;
    });
    if (eventful && !inPrep) {
      inPrep = true;
      try {
        prepForRoad();
      } finally {
        inPrep = false;
      }
      // Re-plan: prep may have relocated the hero (death on the way back).
      if (player.currentZone === zoneId) return true;
      const replanned = findPath(zoneId);
      if (!replanned) return false;
      return walkPath(replanned);
    }
    return walkPath(path);
  };
  /** The sim's movement primitive: walk to `zoneId`, recovering from
   * deaths and aborted crossings by resting at the nearest shop — the
   * same loop a determined player runs. The sim can no longer teleport. */
  const goto = (zoneId: string): void => {
    if (player.dungeonRun && player.currentZone !== zoneId) abandonDungeon(player);
    let guard = 0;
    while (player.currentZone !== zoneId && guard++ < 25) {
      if (walkTo(zoneId)) return;
      restock();
    }
  };
  /** Death recovery, graph-aware and NON-recursive: walk (bounded) to the
   * NEAREST unlocked shop — havens passed on the way heal on arrival —
   * then shop at the physical counter. */
  const restock = (): void => {
    if (player.dungeonRun) abandonDungeon(player);
    let guard = 0;
    // Recovery targets a counter that actually stocks HEAL potions — an
    // antidote-only shelf cannot sustain a road walk.
    const short = (): boolean => HEAL_ITEMS.reduce((sum, id) => sum + countOf(player, id), 0) < 3;
    while (short() && guard++ < 12) {
      if (shopInZone(player.currentZone)) {
        shop(); // a counter right here may already stock the shelf
        if (!short()) break;
      }
      const path = findRoutePath(player, (id) => {
        const stock = resolveStock({ ...player, currentZone: id });
        return stock.some((offering) =>
          (HEAL_ITEMS as readonly string[]).includes(offering.itemId)
        );
      }, { includeStart: false });
      const walked = path !== undefined && walkPath(path);
      if (!walked) return; // nowhere to recover — keep playing honestly
    }
    if (shopInZone(player.currentZone)) shop();
  };
  /** One real fight. 'death' applies the real death flow (revive at the
   * safe haven, −10% gold); 'retreat' is a timeout — heal up, no death.
   * `kind` separates quest-driven fights from pure level grinding (#74)
   * and from ROAD fights (#162): a road fight runs a flee policy when the
   * hero is nearly spent, and its victory completes the pending journey
   * event at the one owned point. */
  const originLabel = (battle: BattleState): string => {
    const origin = battle.origin;
    if (origin.kind === 'dungeon') {
      return `dungeon@${origin.zoneId}:floor${origin.floor}${origin.boss ? ':boss' : ''}`;
    }
    if (origin.kind === 'travel') {
      // Route origin diagnostics (#160): the report identifies the edge a
      // travel fight came from, not just its origin zone.
      return `travel@${origin.zoneId}:${origin.edgeId}#${origin.eventIndex}`;
    }
    return `${origin.kind}@${origin.zoneId}`;
  };
  // #111: observation-only stall context — written after each fight, never
  // read by policy, never touching RNG or combat state.
  let lastAttempt: StallAttempt | undefined;
  let lastFoughtEnemy = '';
  let failureStreak = 0;
  const failures: Record<string, number> = {};
  const fight = (
    battle: BattleState,
    kind: 'objective' | 'grind' | 'road',
  ): 'win' | 'death' | 'retreat' | 'fled' => {
    fights++;
    if (kind === 'objective') objective++;
    else if (kind === 'grind') grind++;
    else travel.travelBattles++;
    const resolved = runCampaignFight(player, battle, kind, rng);
    const { outcome: result, rounds } = resolved;
    itemsUsed += resolved.itemsUsed;
    travel.contextualDrops += resolved.contextualDrops;
    if (result === 'death') deaths++;
    if (kind === 'road') {
      travel.travelRounds += rounds;
      if (result === 'death') travel.roadDeaths++;
      if (result === 'fled') travel.roadFlees++;
    }
    // #111: record the attempt AFTER resolution — the diagnostic observes
    // the completed fight only.
    lastAttempt = {
      enemy: battle.enemy.id,
      origin: originLabel(battle),
      outcome: result === 'fled' ? 'retreat' : result,
      rounds,
    };
    if (result === 'win') {
      failureStreak = 0;
    } else {
      failureStreak = battle.enemy.id === lastFoughtEnemy ? failureStreak + 1 : 1;
      failures[battle.enemy.id] = (failures[battle.enemy.id] ?? 0) + 1;
    }
    lastFoughtEnemy = battle.enemy.id;
    return result;
  };

  const equipFromBag = (id: string): void => {
    const kind = itemDef(id)?.kind;
    if (kind !== 'weapon' && kind !== 'armor' && kind !== 'trinket') return;
    if (!removeItem(player, id, 1)) return;
    player.equipment[kind] = id;
    clampPools(player);
  };

  function shopHere(): void {
    // #161: the hero shops only where a shop actually stands — resolveStock
    // returns an empty shelf anywhere else, and buy() revalidates.
    const stock = resolveStock(player).map((offering) => offering.itemId);
    for (const kind of ['weapon', 'armor'] as const) {
      const cur = player.equipment[kind] ?? '';
      const curW = statWeight(cur);
      const better = stock
        .filter((id) =>
          (kind === 'weapon' ? id.startsWith('w_') : id.startsWith('a_')) &&
          isEquippable(id, player.classId, player.level).ok &&
          statWeight(id) > curW &&
          (itemDef(id)?.price ?? 0) <= player.gold - 30 // keep a potion buffer
        )
        .sort((leftValue, rightValue) => statWeight(rightValue) - statWeight(leftValue))[0];
      if (better && buy(player, better).ok) {
        equipFromBag(better);
      }
    }
    // Best trinket already in the bag.
    const trinket = player.inventory
      .map((entry) => entry.id)
      .filter((id) =>
        itemDef(id)?.kind === 'trinket' && isEquippable(id, player.classId, player.level).ok
      )
      .sort((leftValue, rightValue) => statWeight(rightValue) - statWeight(leftValue))[0];
    if (trinket && statWeight(trinket) > statWeight(player.equipment.trinket ?? '')) {
      equipFromBag(trinket);
    }
    // Pack for an uninterrupted descent: prefer the strongest local
    // healing supply, and carry MP supplies for classes with costly rotations.
    const stocked = (): number => HEAL_ITEMS.reduce((sum, id) => sum + countOf(player, id), 0);
    for (const id of HEAL_ITEMS) {
      while (stocked() < 10 && buy(player, id).ok) { /* the shelf carries it */ }
    }
    for (const id of MP_ITEMS) {
      while (
        MP_ITEMS.reduce((sum, itemId) => sum + countOf(player, itemId), 0) < 4 && buy(player, id).ok
      ) {
        /* Finite supplies paid for at this counter. */
      }
    }
  }

  /** #162: the shop trip is a REAL trip — the hero walks to the closest
   * counter that genuinely stocks an affordable upgrade (regional steel
   * lives at regional counters), shops there, and never accesses a remote
   * shelf. */
  function shop(): void {
    if (shopInZone(player.currentZone)) shopHere();
    /** Trip to the nearest counter stocking heal potions when the shelf
     * runs low — supplies are survival, independent of gear upgrades. */
    const potionTrip = (): void => {
      if (HEAL_ITEMS.reduce((sum, id) => sum + countOf(player, id), 0) >= 6) return;
      const supplyZone = nearestSupplyShop(player, HEAL_ITEMS);
      if (!supplyZone) return;
      // One attempt; an aborted crossing is retried on the next shop() call.
      if (player.currentZone !== supplyZone && !walkTo(supplyZone)) return;
      if (player.currentZone === supplyZone) shopHere();
    };
    potionTrip();
    const upgradeZone = nearestUpgradeShop(player);
    if (!upgradeZone) return;
    if (player.currentZone !== upgradeZone && !walkTo(upgradeZone)) return;
    if (player.currentZone === upgradeZone) shopHere();
  }

  /** Explore-farm until the level rises; returns fights spent. */
  const grindOneLevel = (): number => {
    // #88: at the level cap a grind can never pay — bail before burning
    // 300 explores that cannot gain a level.
    if (player.level >= MAX_LEVEL) return 0;
    const start = player.level;
    // Farm where the hero's band is LIVE (#73, #88): the highest unlocked
    // zone whose hostile table still spawns at this level — the Outskirts
    // for levels 1–2, the Whisperwood from 3, later wilds as they unlock.
    const farmZone =
      [...hostileZones()].reverse().find((zone) =>
        player.unlockedZones.includes(zone.id) && zoneHostilePool(zone.id, player.level).length > 0
      )?.id ?? 'outskirts';
    let fightsCount = 0;
    let sinceWalk = 0;
    while (player.level === start && fightsCount < 300) {
      fightsCount++;
      explores++;
      if (player.currentZone !== farmZone) {
        // Farm the live pool right here a bounded number of fights between
        // walk attempts — the hero grows into a fair crossing instead of
        // re-walking the same hot road every iteration. At the cap XP
        // buys no levels, so the walk re-attempts on variance alone.
        const poolLive = zoneHostilePool(player.currentZone, player.level).length > 0;
        if (!poolLive || sinceWalk >= 12) {
          sinceWalk = 0;
          walkTo(farmZone);
          continue;
        }
        sinceWalk++;
      }
      if (zoneHostilePool(player.currentZone, player.level).length === 0) {
        restock(); // heal and re-arm at the nearest counter, then retry
        continue;
      }
      const out = explore(player, rng, 0);
      if (out.kind === 'battle' && fight(out.battle, 'grind') !== 'win') restock();
    }
    if (player.level > start) shop(); // #74: gear beats land right after level-ups
    return fightsCount;
  };

  const questCount = (questId: string, objectiveIndex: number): number =>
    player.quests[questId]?.counts[objectiveIndex] ?? 0;

  /** First unlocked zone whose hostile table spawns the enemy AT THE
   * HERO'S LEVEL (#73 + the shared eligibility rule, #74) — the Outskirts
   * come before the Whisperwood for shared early spawns. */
  const zoneOfEnemy = (enemyId: string): string | undefined => {
    for (const zone of ZONES) {
      if (!player.unlockedZones.includes(zone.id)) continue;
      if (
        zone.explore.some((encounter) =>
          (encounter.kind === 'battle' || encounter.kind === 'elite') &&
          encounter.enemy === enemyId &&
          encounterEligible(encounter, player.level)
        )
      ) {
        return zone.id;
      }
    }
    return undefined;
  };

  const farmKills = (
    questId: string,
    objectiveIndex: number,
    enemyId: string,
    need: number,
  ): boolean => {
    const zoneId = zoneOfEnemy(enemyId);
    if (!zoneId) return false;
    let local = 0;
    let sinceWalk = 0;
    while (questCount(questId, objectiveIndex) < need) {
      if (++local > 400) return false;
      if (player.currentZone === zoneId) {
        explores++;
        const out = explore(player, rng, 0);
        if (out.kind === 'battle') {
          if (fight(out.battle, 'objective') !== 'win') restock();
        }
        continue;
      }
      // The enemy spawns only in its own zone: progress REQUIRES the walk.
      // Between attempts, a live local pool farms bounded fights — the
      // hero grows into a fair crossing instead of face-planting into the
      // same road forever.
      const poolLive = zoneHostilePool(player.currentZone, player.level).length > 0;
      if (!poolLive || sinceWalk >= 12) {
        sinceWalk = 0;
        walkTo(zoneId);
        continue;
      }
      sinceWalk++;
      explores++;
      const out = explore(player, rng, 0);
      if (out.kind === 'battle') {
        if (fight(out.battle, 'objective') !== 'win') restock();
      }
    }
    return true;
  };

  /** Unlocked zones whose eligible explore tables actually drop the target
   * (#74) — collection farming follows REAL sources instead of grinding a
   * pool that can never pay out. */
  const dropZonesFor = (target: string): string[] =>
    exploreDropZonesFor(target, player.unlockedZones, player.level);

  /** Reachable dungeon whose remaining normal floors can still yield the
   * target (#74) — the sim dives REAL floors instead of pretending wilds
   * or shops are the only sources. */
  const dungeonSourceFor = (
    target: string,
  ): { zoneId: string; dungeon: DungeonDef } | undefined => {
    for (const zone of ZONES) {
      if (!player.unlockedZones.includes(zone.id) || !zone.dungeon) continue;
      if (dungeonFloorsYield(target, zone.dungeon, nextDungeonFloor(player, zone.dungeon))) {
        return { zoneId: zone.id, dungeon: zone.dungeon };
      }
    }
    return undefined;
  };

  /** Unlocked zones whose LOCAL shop genuinely stocks the target for this
   * hero (#161) — hops go where the shelf actually carries it. */
  const stockedZones = (target: string): string[] => {
    const out: string[] = [];
    for (const zone of ZONES) {
      if (!player.unlockedZones.includes(zone.id)) continue;
      if (!shopInZone(zone.id)) continue;
      const probe = { ...player, currentZone: zone.id } as PlayerState;
      if (resolveStock(probe).some((offering) => offering.itemId === target)) out.push(zone.id);
    }
    return out;
  };

  const farmCollect = (target: string, need: number): boolean => {
    const price = itemDef(target)?.price ?? 0;
    let local = 0;
    while (countOf(player, target) < need) {
      if (++local > 60) return false; // safety net, never the plan (#74)
      // 1. Buy when THIS counter genuinely stocks it and it's affordable (#73).
      if (
        resolveStock(player).some((offering) => offering.itemId === target) &&
        player.gold >= price + 20 &&
        buy(player, target).ok
      ) continue;
      // 2. Farm the best eligible wild drop source.
      const zones = dropZonesFor(target);
      if (zones.length > 0) {
        goto(zones[0]!);
        explores++;
        const out = explore(player, rng, 0);
        if (out.kind === 'battle' && fight(out.battle, 'objective') !== 'win') restock();
        continue;
      }
      // 3. Dive REAL dungeon floors that still yield it (#73: the taught
      //    route — caches + Mycelids in the Rootbound Hollow).
      const dungeonSource = dungeonSourceFor(target);
      if (dungeonSource) {
        goto(dungeonSource.zoneId);
        const res = diveDungeon(player, dungeonSource.dungeon, rng);
        if (res.ok && res.kind === 'battle') {
          if (fight(res.battle, 'objective') !== 'win') restock();
        } else if (!res.ok) {
          restock();
        }
        continue;
      }
      // 4. Hop to a zone whose shelf GENUINELY stocks it — next loop buys.
      const stocking = stockedZones(target);
      if (stocking.length > 0 && player.gold >= price) {
        goto(stocking[0]!);
        continue;
      }
      // No source at this level at all — say so immediately (#74); the
      // outer loop may level (unlocking sources) and retry.
      return false;
    }
    return true;
  };

  /** Dive with real fights until the dungeon boss falls. */
  const clearBoss = (zoneId: string): boolean => {
    let attempts = 0;
    let bossDeaths = 0;
    while (attempts++ < 80) {
      const dungeon = dungeonOf(zoneDef(zoneId)!);
      if (!dungeon) return false;
      goto(zoneId);
      itemsUsed += prepareDungeonFloor(player);
      const res = diveDungeon(player, dungeon, rng);
      if (!res.ok) {
        restock();
        continue;
      }
      if (res.kind === 'discovery') continue; // Authored discovery; retain the same run and resources.
      const isBoss = res.battle.origin.kind === 'dungeon' && res.battle.origin.boss;
      if (isBoss && report.aranyaLevel === 0 && zoneId === 'whisperwood') {
        report.aranyaLevel = player.level;
        report.aranyaGearTier = weaponTier(player);
        report.aranyaDeathsBefore = deaths;
      }
      const out = fight(res.battle, 'objective');
      if (out === 'win') {
        if (isBoss) {
          report.aranyaDeathsBefore = deaths - report.aranyaDeathsBefore;
          return true;
        }
        continue;
      }
      restock();
      if (isBoss) {
        bossDeaths++;
        // A repeated boss wall demands real growth — grind a level.
        if (bossDeaths % 2 === 0) grindOneLevel();
      }
    }
    return false;
  };

  const turnInReady = (): void => {
    syncAvailability(player);
    for (const questId of quests) {
      if (player.quests[questId]?.status !== 'turnIn') continue;
      const questDef = quest(questId);
      if (!questDef) continue;
      const zoneId = zoneOfNpc(questDef.finishNpc)?.id;
      if (!zoneId) continue;
      goto(zoneId);
      // #127: conversation-driven objectives advance through story events
      // — emit every event the quest's objectives await.
      for (const obj of questDef.objectives) {
        if (obj.kind === 'storyEvent') onStoryEvent(player, obj.target);
      }
      if (
        player.quests[questId]?.status === 'turnIn' &&
        turnInQuest(player, questId, questDef.finishNpc).ok
      ) {
        beats.push({
          questId,
          level: player.level,
          gold: player.gold,
          deaths,
          fights,
          grindFights: grind,
          itemsUsed,
        });
        onTurnIn?.(player, questId);
        shop(); // #74: gear beats land right after quest rewards
      }
    }
  };

  const acceptAvailable = (): void => {
    syncAvailability(player);
    for (const questId of quests) {
      if (player.quests[questId]?.status !== 'available') continue;
      const questDef = quest(questId);
      if (!questDef) continue;
      const zoneId = zoneOfNpc(questDef.startNpc)?.id;
      if (!zoneId) continue;
      goto(zoneId);
      if (player.quests[questId]?.status === 'available') {
        acceptQuest(player, questId, questDef.startNpc);
      }
    }
  };

  let guard = 0;
  const statusOf = (questId: string): string | undefined => player.quests[questId]?.status;
  const guardLimit = 300 + quests.length * 40;
  while (statusOf(stopQuest) !== 'done' && ++guard < guardLimit) {
    turnInReady();
    if (statusOf(stopQuest) === 'done') break;
    acceptAvailable();
    const active = quests.find((id) => player.quests[id]?.status === 'active');
    if (!active) {
      grindOneLevel();
      continue;
    }
    const questDef = quest(active)!;
    let progressed = false;
    for (let objectiveIndex = 0; objectiveIndex < questDef.objectives.length; objectiveIndex++) {
      const obj = questDef.objectives[objectiveIndex]!;
      const need = obj.count ?? 1;
      const have = obj.kind === 'collect'
        ? countOf(player, obj.target)
        : questCount(active, objectiveIndex);
      if (have >= need) continue;
      if (obj.kind === 'kill') {
        // #88: dungeon-sourced kills (chapter bosses, floor mobs) route
        // through a real dive — farmKills only reaches explore tables.
        // m3_roots keeps its authored route; later chapters resolve the
        // owning dungeon from the boss map, then from floor yields.
        const diveZone = active === 'm3_roots'
          ? 'whisperwood'
          : zoneOfEnemy(obj.target)
          ? undefined
          : ZONES.find((zone) => zone.dungeon && dungeonBossSource(zone.id)?.enemyId === obj.target)
            ?.id ??
            ZONES.find((zone) => zone.dungeon && dungeonFloorsYield(obj.target, zone.dungeon, 1))
              ?.id;
        progressed = diveZone
          ? clearBoss(diveZone)
          : farmKills(active, objectiveIndex, obj.target, need);
      } else if (obj.kind === 'collect') {
        progressed = farmCollect(obj.target, need);
      } else if (obj.kind === 'storyEvent') {
        onStoryEvent(player, obj.target);
        progressed = questCount(active, objectiveIndex) >= need;
      } else if (obj.kind === 'reach') {
        // #162: the reach objective is a REAL journey — the road IS the
        // objective, rolled and fought through the live engine.
        goto(obj.target);
        progressed = player.currentZone === obj.target;
      } else if (obj.kind === 'dungeon') {
        // #88: later chapters gate story beats behind dungeon dives —
        // clear the named dungeon's boss with real fights.
        const dungeonZone = ZONES.find((zone) => zone.dungeon?.id === obj.target);
        progressed = dungeonZone ? clearBoss(dungeonZone.id) : false;
      }
      if (!progressed) break;
    }
    if (!progressed) grindOneLevel();
  }
  if (player.quests[stopQuest]?.status !== 'done') {
    // #111: the stall is reported as STRUCTURED data first — the string is
    // formatted from it, so the report and the message can never drift.
    const equipped = (slot: 'weapon' | 'armor' | 'trinket'): string => player.equipment[slot] ?? '';
    const tierOf = (id: string): number => id ? itemDef(id)?.tier ?? 0 : 0;
    const stallQuests: StallQuest[] = quests.map((id) => {
      const status = player.quests[id]?.status ?? 'none';
      if (status !== 'active') return { id, status };
      const questDef = quest(id);
      return {
        id,
        status,
        objectives: questDef?.objectives.map((obj, objectiveIndex) => ({
          kind: obj.kind,
          target: obj.target,
          have: obj.kind === 'collect'
            ? countOf(player, obj.target)
            : questCount(id, objectiveIndex),
          need: obj.count ?? 1,
        })) ?? [],
      };
    });
    const stall: StallDiagnostic = {
      level: player.level,
      zone: player.currentZone,
      unlockedZones: [...player.unlockedZones],
      hp: player.hp,
      maxHp: statsOf(player).maxHp,
      mp: player.mp,
      maxMp: statsOf(player).maxMp,
      gold: player.gold,
      equipment: {
        weapon: equipped('weapon'),
        armor: equipped('armor'),
        trinket: equipped('trinket'),
      },
      gearTiers: {
        weapon: tierOf(equipped('weapon')),
        armor: tierOf(equipped('armor')),
        trinket: tierOf(equipped('trinket')),
      },
      gearTriggers: (['weapon', 'armor', 'trinket'] as const).flatMap((slot) =>
        itemDef(equipped(slot))?.triggers?.map((trigger) => trigger.name) ?? []
      ),
      consumables: player.inventory
        .filter((entry) => itemDef(entry.id)?.kind === 'consumable' && entry.qty > 0)
        .map((entry) => ({ id: entry.id, qty: entry.qty })),
      quests: stallQuests,
      lastAttempt,
      failureStreak,
      failures,
    };
    report.stall = stall;
    // #88: diagnosable stalls — name the active quest and its objective
    // progress so a harness regression is readable from the report alone.
    report.stuck = formatStallReport(stall);
  }
  report.chapter1Done = player.quests['m4_blessing']?.status === 'done';
  // #88: full-campaign completion — every main quest m1→m25 done.
  report.campaignDone = ALL_MAINS.every((id) => player.quests[id]?.status === 'done');
  report.endLevel = player.level;
  report.endGold = player.gold;
  report.totalDeaths = deaths;
  report.totalFights = fights;
  report.totalObjectiveFights = objective;
  report.totalGrindFights = grind;
  report.totalEncounterAttempts = explores;
  report.totalItemsUsed = itemsUsed;
  finalizeTravelMetrics(travel);
  return report;
}

function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let temp = Math.imul(state ^ (state >>> 15), 1 | state);
    temp = (temp + Math.imul(temp ^ (temp >>> 7), 61 | temp)) ^ temp;
    return ((temp ^ (temp >>> 14)) >>> 0) / 4294967296;
  };
}
export { seededRng };

/** Enemies explicitly flagged as tutorial fixtures (#69). */
export function tutorialEnemies(): EnemyDef[] {
  return ENEMIES.filter((enemy) => enemy.tutorial === true);
}
