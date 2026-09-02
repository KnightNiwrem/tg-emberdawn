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
import { buy, currentStock, shopTierForZone } from './shops.ts';
import { countOf, removeItem } from './inventory.ts';
import { acceptQuest, onTalk, syncAvailability, turnInQuest } from './quests.ts';
import { clampPools } from './character.ts';
import {
  diveDungeon,
  dungeonOf,
  encounterEligible,
  explore,
  nextDungeonFloor,
  travel,
} from './world.ts';
import { createPostTutorialPlayer } from './tutorial.ts';
import { ENEMIES } from '../content/enemies.ts';
import { isEquippable, item as itemDef, ITEMS, shopStock } from '../content/items.ts';
import { quest, QUESTS, zoneOfNpc } from '../content/quests.ts';
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

// ── Heroes ──────────────────────────────────────────────────────────────

/** Gear the simulation hero wears: `starting` = the level-1 class kit
 * (doubles as the deliberately under-geared case at higher levels);
 * `best` = the best normally obtainable, equippable catalog pieces. */
export type GearProfile = 'starting' | 'best';

/** A hero leveled through the REAL grantXp curve (skills/pools canonical),
 * then equipped per profile. Never used in production play. */
export function makeHero(classId: ClassId, level: number, gear: GearProfile): PlayerState {
  const p = createPlayer(0, 'Sim', classId);
  let xp = 0;
  for (let l = 1; l < level; l++) xp += xpForNextLevel(l);
  grantXp(p, xp);
  if (gear === 'best') equipBest(p);
  const s = statsOf(p);
  p.hp = s.maxHp;
  p.mp = s.maxMp;
  return p;
}

function statWeight(id: string): number {
  const s = itemDef(id)?.stats ?? {};
  return (s.atk ?? 0) + (s.def ?? 0) + (s.mag ?? 0) + (s.res ?? 0) + (s.spd ?? 0) +
    (s.luck ?? 0) + (s.hp ?? 0) / 4 + (s.mp ?? 0) / 2;
}

/** Equips the best equippable catalog gear (class + level legal, never
 * unique trophies) — approximates "current best normally obtainable gear". */
function equipBest(p: PlayerState): void {
  for (const kind of ['weapon', 'armor', 'trinket'] as const) {
    const candidates = ITEMS.filter((it) =>
      it.kind === kind && !it.unique && isEquippable(it.id, p.classId, p.level).ok
    );
    const best = candidates.sort((a, b) =>
      statWeight(b.id) - statWeight(a.id) || b.level - a.level
    )[0];
    if (best && statWeight(best.id) > statWeight(p.equipment[kind] ?? '')) {
      p.equipment[kind] = best.id;
    }
  }
  clampPools(p);
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
function isBuffSkill(sk: SkillDef): boolean {
  return sk.effects.some((e) =>
    e.kind === 'statmod' && e.target !== 'opponent' && (e.pct ?? 0) > 0
  );
}

/** A shield-granting skill (Aegis of Dawn…). */
function isShieldSkill(sk: SkillDef): boolean {
  return sk.effects.some((e) => e.kind === 'shield');
}

/** Enemy-side damage-over-time (Poison…): negative periodic on the foe. */
function isDotSkill(sk: SkillDef): boolean {
  return sk.effects.some((e) =>
    e.kind === 'periodic' && e.target === 'opponent' &&
    ((e.perRound ?? 0) < 0 || (e.pctOfMaxPerRound ?? 0) < 0)
  );
}

/** Pure enemy debuff — a negative opponent statmod with NO damage rider
 * (damage+debuff hybrids stay in the offense family, #84 ordering). */
/** A debuff-only utility skill (no damage, no heal): the tactical policy
 * casts these for value, and the harness counts them (#84). */
export function isPureDebuffSkill(sk: SkillDef): boolean {
  if (isDamageSkill(sk)) return false;
  return sk.effects.some((e) =>
    e.kind === 'statmod' && e.target === 'opponent' && (e.pct ?? 0) < 0
  );
}

function isCleanseSkill(sk: SkillDef): boolean {
  return sk.effects.some((e) => e.kind === 'cleanse');
}

function isDispelSkill(sk: SkillDef): boolean {
  return sk.effects.some((e) => e.kind === 'dispel');
}

/** Self-targeted healing-over-time (#81): positive periodic on the caster
 * (Renew). Direct heals own the emergency lanes; regen owns the long grind. */
function isRegenSkill(sk: SkillDef): boolean {
  return sk.effects.some((e) =>
    e.kind === 'periodic' && e.target !== 'opponent' &&
    ((e.perRound ?? 0) > 0 || (e.pctOfMaxPerRound ?? 0) > 0)
  );
}

/** Expected total DoT damage over its full authored duration, against this
 * fight's enemy (mirrors the periodic formulas; folded sap ignored — the
 * policy wants an order-of-magnitude payoff check, not a prediction). */
function expectedDotTotal(sk: SkillDef, enemyMaxHp: number): number {
  let total = 0;
  for (const e of sk.effects) {
    if (e.kind !== 'periodic') continue;
    const flat = e.perRound ?? 0;
    const pctMax = e.pctOfMaxPerRound ?? 0;
    if (flat >= 0 && pctMax >= 0) continue;
    total += (Math.abs(flat) + Math.abs(pctMax) * enemyMaxHp) * e.duration;
  }
  return total;
}

const HEAL_ITEMS = ['c_super_potion', 'c_greater_potion', 'c_potion', 'c_minor_potion'];
const MP_ITEMS = ['c_greater_ether', 'c_ether', 'c_minor_ether'];

/** The harness's action chooser — exported so tests can pin tactical
 * decisions directly (#87 polarity coverage). */
export function chooseAction(
  p: PlayerState,
  b: BattleState,
  policy: Policy,
  lastWasGuard: boolean,
): PlayerAction {
  if (policy.name === 'free') return { kind: 'attack' };
  const s = statsOf(p);
  const learned = p.skills
    .map((id) => skillDef(id))
    .filter((sk): sk is SkillDef => Boolean(sk));
  // #84: pre-emptive skills are NOT castable (they fire in the battle
  // opening, #80) — no policy may ever select one, or the engine refuses
  // the action and the hero burns its turn.
  const usable = (sk: SkillDef): boolean =>
    !sk.preEmptive && (b.cooldowns[sk.id] ?? 0) === 0 && p.mp >= sk.mpCost;
  // #78: policies read public effect shapes, never legacy scalar fields.
  const offense = learned
    .filter(isDamageSkill)
    .sort((a, z) => skillMaxDamagePower(z) - skillMaxDamagePower(a));
  const heals = learned
    .filter(isHealSkill)
    .sort((a, z) => skillHealPower(z) - skillHealPower(a));

  if (policy.name === 'skill') {
    const sk = offense.find(usable);
    return sk ? { kind: 'skill', skillId: sk.id } : { kind: 'attack' };
  }

  if (policy.name === 'tactical') {
    return tacticalAction(p, b, policy, lastWasGuard, learned, usable, offense, heals);
  }

  // rotation — a sensibly played hero.
  const hurting = p.hp < s.maxHp * 0.5;
  if (hurting && policy.items && p.hp < s.maxHp * 0.35) {
    const potion = HEAL_ITEMS.find((id) => countOf(p, id) > 0);
    if (potion) return { kind: 'item', itemId: potion };
  }
  if (hurting) {
    const heal = heals.find(usable);
    if (heal) return { kind: 'skill', skillId: heal.id };
  }
  const sk = offense.find(usable);
  if (sk) return { kind: 'skill', skillId: sk.id };
  const cheapest = offense.map((x) => x.mpCost).sort((a, z) => a - z)[0] ?? 0;
  if (policy.items && p.mp < cheapest) {
    const ether = MP_ITEMS.find((id) => countOf(p, id) > 0);
    if (ether) return { kind: 'item', itemId: ether };
  }
  // Starved and hurting: alternate guard (mitigate + recover MP) with the
  // free action so a stalled rotation still deals damage.
  if (p.hp < s.maxHp * 0.4 && p.mp < cheapest && !lastWasGuard) return { kind: 'guard' };
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
  p: PlayerState,
  b: BattleState,
  policy: Policy,
  lastWasGuard: boolean,
  learned: SkillDef[],
  usable: (sk: SkillDef) => boolean,
  offense: SkillDef[],
  heals: SkillDef[],
): PlayerAction {
  const s = statsOf(p);
  // #90: liveness is source-scoped — any live instance whose stacking
  // identity derives from the skill's id (any of its effects/triggers).
  const liveOn = (side: 'player' | 'enemy', sourceId: string): boolean =>
    hasLiveFromSource(b, side, sourceId);
  const firstUsable = (skills: SkillDef[]): SkillDef | undefined => skills.find(usable);

  // 1. Cleanse MEANINGFUL harm: a live control effect, or several harmful
  //    instances at once. A single mild debuff is not worth the action.
  const harmful = b.effectInstances.filter(
    (i) => i.side === 'player' && i.tags.includes('harmful') && i.removable,
  );
  const cleanser = firstUsable(learned.filter(isCleanseSkill));
  if (cleanser && (harmful.some((i) => i.kind === 'control') || harmful.length >= 2)) {
    return { kind: 'skill', skillId: cleanser.id };
  }
  // 2. Dispel a live, removable enemy benefit (boss wards, enemy buffs).
  const dispeller = firstUsable(learned.filter(isDispelSkill));
  if (
    dispeller &&
    b.effectInstances.some((i) =>
      i.side === 'enemy' && i.tags.includes('beneficial') && i.removable
    )
  ) {
    return { kind: 'skill', skillId: dispeller.id };
  }
  // 3. Heal under the same hurt gate as the plain rotation.
  if (p.hp < s.maxHp * 0.5) {
    const heal = firstUsable(heals);
    if (heal) return { kind: 'skill', skillId: heal.id };
  }
  // 3b. Regen (#81): sustained healing while not critical — one cast, then
  // the ticks work for free. Never refreshed while live.
  const regen = learned.filter(isRegenSkill).find((sk) => usable(sk) && !liveOn('player', sk.id));
  if (regen && p.hp < s.maxHp * 0.75) {
    return { kind: 'skill', skillId: regen.id };
  }
  // 4. Shield an empty pool — never re-grant over a live same-source ward
  //    (over-shield waste is a structural failure, #84).
  const shield = firstUsable(learned.filter(isShieldSkill));
  if (shield && b.shield.player === 0 && !liveOn('player', shield.id)) {
    return { kind: 'skill', skillId: shield.id };
  }
  // 5. Buff once per live window; setup only pays while the fight lasts.
  const buff = learned.filter(isBuffSkill).find((sk) => usable(sk) && !liveOn('player', sk.id));
  if (buff && b.enemy.hp > b.enemy.maxHp * 0.3) {
    return { kind: 'skill', skillId: buff.id };
  }
  // 5b. Shatter a live ward (#88): ordinary damage pools INTO the ward —
  //     a ward-ignoring strike pays through it instead of feeding it.
  if (b.shield.enemy > 0) {
    const piercer = offense.find((sk) =>
      usable(sk) && sk.effects.some((e) => e.kind === 'damage' && e.bypassShield === true)
    );
    if (piercer) return { kind: 'skill', skillId: piercer.id };
  }
  // 5c. Execute window (#88): inside a finisher's threshold its bonus
  //     strike is the expected-value pick, ahead of raw-power sorting.
  const foeHpPct = b.enemy.hp / b.enemy.maxHp;
  const finisher = offense.find((sk) =>
    usable(sk) &&
    sk.effects.some((e) => e.kind === 'damage' && e.execute && foeHpPct < e.execute.belowPct)
  );
  if (finisher) return { kind: 'skill', skillId: finisher.id };
  // 6. DoT when the remaining fight is long enough for the ticks to pay.
  const dot = learned.filter(isDotSkill).find((sk) => usable(sk) && !liveOn('enemy', sk.id));
  if (dot && b.enemy.hp > expectedDotTotal(dot, b.enemy.maxHp)) {
    return { kind: 'skill', skillId: dot.id };
  }
  // 7. Pure debuff (sap / weaken) while it has time. Damage-carrying
  //    breaks are NOT here — they stay in the offense family (#84).
  const debuff = learned.filter(isPureDebuffSkill).find((sk) =>
    usable(sk) && !liveOn('enemy', sk.id)
  );
  if (debuff && b.enemy.hp > b.enemy.maxHp * 0.35) {
    return { kind: 'skill', skillId: debuff.id };
  }
  // 8. Damage rotation, then the shared fallbacks. While the fight still
  //    has length, prefer the break rider that matches the hero's OWN
  //    damage type (#88): a phys hero sundering DEF buys real strikes;
  //    the same hero shattering RES would buy nothing.
  const prefStat = CLASSES[p.classId].basicAction.kind === 'phys' ? 'def' : 'res';
  const breakPick = b.enemy.hp > b.enemy.maxHp * 0.5
    ? offense.find((cand) =>
      usable(cand) && !liveOn('enemy', cand.id) &&
      cand.effects.some((e) => e.kind === 'statmod' && e.stat === prefStat)
    )
    : undefined;
  const sk = breakPick ?? offense.find(usable);
  if (sk) return { kind: 'skill', skillId: sk.id };
  const cheapest = offense.map((x) => x.mpCost).sort((a, z) => a - z)[0] ?? 0;
  if (policy.items && p.hp < s.maxHp * 0.35) {
    const potion = HEAL_ITEMS.find((id) => countOf(p, id) > 0);
    if (potion) return { kind: 'item', itemId: potion };
  }
  if (policy.items && p.mp < cheapest) {
    const ether = MP_ITEMS.find((id) => countOf(p, id) > 0);
    if (ether) return { kind: 'item', itemId: ether };
  }
  if (p.hp < s.maxHp * 0.4 && p.mp < cheapest && !lastWasGuard) return { kind: 'guard' };
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
  shieldGranted: number;
  shieldAbsorbed: number;
  shieldWasted: number;
  shieldExpiryLost: number;
  /** Reactive equipment procs that fired this fight (#82). */
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
  const p = structuredClone(hero) as PlayerState;
  // #101: the harness collects ONLY its own fight's trace — startBattle
  // and every performAction return their entries explicitly, so nested or
  // concurrent fights cannot cross-contaminate, no collector can leak on
  // a throw, and no finally exists merely to detach telemetry.
  const events: CombatTraceEntry[] = [];
  let rounds = 0;
  let lastWasGuard = false;
  const seenIids = new Set<string>();
  const result: FightResult = {
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
  {
    // #80: the harness constructs battles through the SAME opening pipeline
    // as live play — full hero context, seeded rng.
    const started = startBattle(enemyId, origin, { player: p, rng });
    if (!started) throw new Error(`balance harness: unknown enemy ${enemyId}`);
    const b = started.battle;
    p.battle = b;
    events.push(...started.trace);
    // Line metric regexes (#84): only presentation the events cannot express
    // — crit/dodge markers and the shield grant/absorb/waste/fade
    // decomposition. #95: dealt/taken/heals come ONLY from typed events.
    const CRIT = '— critical';
    const DODGE = 'slip aside';
    const SHIELD_GRANT = /absorbing up to (\d+)/;
    const SHIELD_ABSORB = /🛡️ (\d+) absorbed/;
    const SHIELD_WASTE = /(\d+) over capacity/;
    const SHIELD_FADE = /(\d+) shield capacity fades/;
    /** Line-metric scan (#74 regexes) — now also fed the resolved opening
     * log ONCE per fight (#84): opening shields are outcomes of the fight
     * and must count toward grant/absorb metrics. #95: dealt/taken/heals
     * come ONLY from typed events — never from presentation text. */
    const scanLines = (lines: readonly string[]): void => {
      for (const line of lines) {
        if (line.includes(CRIT)) result.crits++;
        if (line.includes(DODGE)) result.dodges++;
        const granted = SHIELD_GRANT.exec(line);
        if (granted) result.shieldGranted += Number(granted[1]);
        const absorbed = SHIELD_ABSORB.exec(line);
        if (absorbed) result.shieldAbsorbed += Number(absorbed[1]);
        const wasted = SHIELD_WASTE.exec(line);
        if (wasted) result.shieldWasted += Number(wasted[1]);
        const faded = SHIELD_FADE.exec(line);
        if (faded) result.shieldExpiryLost += Number(faded[1]);
        // ⚡-prefixed lines are reactive equipment procs (#82).
        if (line.startsWith('⚡ ')) result.equipProcs++;
      }
    };
    /** Round-line scan (#88): only per-event regexes remain — dealt/taken/
     * heals now come from per-round HP deltas, so strike/DoT/heal text can
     * never double-count or miss (DoT lines never matched the strike
     * regexes). Shield grant/absorb/waste/fade stay line-parsed: that
     * decomposition isn't recoverable from HP deltas. */
    const scanRoundLines = (lines: readonly string[]): void => {
      for (const line of lines) {
        if (line.includes(CRIT)) result.crits++;
        if (line.includes(DODGE)) result.dodges++;
        const granted = SHIELD_GRANT.exec(line);
        if (granted) result.shieldGranted += Number(granted[1]);
        const absorbed = SHIELD_ABSORB.exec(line);
        if (absorbed) result.shieldAbsorbed += Number(absorbed[1]);
        const wasted = SHIELD_WASTE.exec(line);
        if (wasted) result.shieldWasted += Number(wasted[1]);
        const faded = SHIELD_FADE.exec(line);
        if (faded) result.shieldExpiryLost += Number(faded[1]);
        // ⚡-prefixed lines are reactive equipment procs (#82).
        if (line.startsWith('⚡ ')) result.equipProcs++;
      }
    };
    if (b.opening?.lines.length) scanLines(b.opening.lines);
    // #96: the opening's explicit adjudication — a terminal opening ends the
    // fight before round 1; victory still routes through resolveVictory.
    if (started.outcome === 'victory') {
      resolveVictory(p, b, rng);
      result.outcome = 'win';
    } else if (started.outcome === 'defeat') {
      result.outcome = 'lose';
    }
    while (result.outcome === 'timeout' && b.phase === 'active' && rounds < 200) {
      // #84: sample live instances BEFORE acting — opening effects surface on
      // round 1, uptime counts observed rounds, applications count new iids.
      for (const i of b.effectInstances) {
        const key = `${i.side}:${i.defId}`;
        result.effectRounds[key] = (result.effectRounds[key] ?? 0) + 1;
        if (!seenIids.has(i.iid)) {
          seenIids.add(i.iid);
          result.effectApplications[key] = (result.effectApplications[key] ?? 0) + 1;
          result.effectSources[key] = `${i.source.kind}:${i.source.name}`;
        }
      }
      const action = chooseAction(p, b, policy, lastWasGuard);
      lastWasGuard = action.kind === 'guard';
      const mpBefore = p.mp;
      const res = performAction(p, b, action, rng);
      rounds++;
      events.push(...res.trace);
      if (res.skipped) result.skippedRounds++;
      if (!res.consumedTurn) result.invalidActions++;
      result.mpSpent += Math.max(0, mpBefore - p.mp);
      if (action.kind === 'skill' && res.consumedTurn) {
        result.skillCasts[action.skillId] = (result.skillCasts[action.skillId] ?? 0) + 1;
        const cast = skillDef(action.skillId);
        if (cast) {
          if (isBuffSkill(cast)) result.buffCasts++;
          if (isShieldSkill(cast)) result.shieldCasts++;
          if (isDotSkill(cast)) result.dotCasts++;
          if (isPureDebuffSkill(cast)) result.debuffCasts++;
          if (isCleanseSkill(cast)) result.cleanseCasts++;
          if (isDispelSkill(cast)) result.dispelCasts++;
        }
      }
      scanRoundLines(res.lines);
      if (action.kind === 'guard') {
        result.guardRounds++;
        result.mpFromGuard += Math.max(0, p.mp - mpBefore);
      }
      if (action.kind === 'item') result.itemsUsed++;
      // #86: the engine's explicit terminal adjudication — shared with the
      // live handler and the tutorial (one outcome authority).
      if (res.outcome === 'victory') {
        resolveVictory(p, b, rng);
        result.outcome = 'win';
        break;
      }
      if (res.outcome === 'defeat') {
        result.outcome = 'lose';
        break;
      }
    }
    // #88/#95/#101: typed-entry aggregation — replacement-free sums from
    // structured engine events (never parsed back out of presentation text).
    // dealt/taken are GROSS per-event HP damage: enemy heals and lifesteal
    // no longer subtract from damage dealt, and a same-round heal can never
    // erase or invert damage taken. #106: they sum `hpLost` — the actual
    // HP delta every damage family reports — so overkill (a 157 resolved
    // blow onto a 1-HP target) contributes exactly 1, never the formula.
    for (const e of events) {
      switch (e.kind) {
        case 'hpDamaged':
          if (e.target === 'enemy') result.dealt += e.hpLost;
          else result.taken += e.hpLost;
          break;
        case 'hpRestored':
          // Healing done / overheal for the hero (side player). applied is
          // the post-clamp delta; attempted − applied is the overflow the
          // target's full HP trimmed.
          if (e.side === 'player') {
            result.healDone += e.applied;
            result.overheal += Math.max(0, e.attempted - e.applied);
          }
          break;
        case 'periodicTick':
          if (e.applied < 0) {
            if (e.side === 'enemy') result.dotDealt += -e.applied;
            else result.dotTaken += -e.applied;
          } else if (e.side === 'player') {
            result.hotHealing += e.applied;
            result.wastedPeriodicHealing += Math.max(0, e.amount - e.applied);
          }
          break;
        case 'effectRemoved':
          if (e.cause === 'expired') result.expiredRemovals++;
          else if (e.cause === 'cleansed') result.cleanseRemovals++;
          else if (e.cause === 'dispelled') result.dispelRemovals++;
          else result.consumedRemovals++;
          break;
        case 'shieldBreak':
          result.shieldBreaks++;
          break;
        case 'procAttempt':
          result.procAttempts++;
          if (e.success) result.procHits++;
          break;
        case 'effectApplied':
          // #93: only outcomes that activate a payload count as applications
          // — extended/ignored recasts report the RETAINED instance.
          if (e.outcome === 'created' || e.outcome === 'replaced' || e.outcome === 'refreshed') {
            if (e.duration === 1) result.duration1Applied++;
          }
          break;
        default:
          break;
      }
    }
  }
  if (result.outcome === 'timeout') result.outcome = 'timeout';
  const s = statsOf(p);
  result.rounds = rounds;
  result.hpPct = s.maxHp > 0 ? p.hp / s.maxHp : 0;
  result.mpPct = s.maxMp > 0 ? p.mp / s.maxMp : 0;
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
  const z = zoneDef(zoneId);
  if (!z) return [];
  return z.explore
    .filter((e) => e.kind === 'battle')
    .filter((e) => encounterEligible(e, level))
    .map((e) => ({ enemyId: e.enemy, weight: e.weight, origin: { kind: 'explore', zoneId } }));
}

/** Battle + elite table, exactly as explore() rolls it at `level`. */
export function zoneHostilePool(zoneId: string, level: number): EncounterSource[] {
  const z = zoneDef(zoneId);
  if (!z) return [];
  return z.explore
    .filter((e) => e.kind === 'battle' || e.kind === 'elite')
    .filter((e) => encounterEligible(e, level))
    .map((e) => ({
      enemyId: e.enemy,
      weight: e.weight,
      origin: { kind: e.kind === 'elite' ? 'elite' : 'explore', zoneId } as BattleOrigin,
    }));
}

/** Elite exposure AT `level` (#74): the elite's share of the hostile weight
 * the hero can actually roll there — 0 while the elite is band-locked out
 * or when the level has no live hostiles. */
export function eliteShare(zoneId: string, level: number): number {
  const pool = zoneHostilePool(zoneId, level);
  const total = pool.reduce((a, s) => a + s.weight, 0);
  if (total === 0) return 0;
  const elite = pool.filter((s) => s.origin.kind === 'elite').reduce((a, s) => a + s.weight, 0);
  return elite / total;
}

/** Pure collection planner (#74): unlocked zones whose ELIGIBLE explore
 * tables actually drop `target` at `level`, best rate first. */
export function exploreDropZonesFor(target: string, unlocked: string[], level: number): string[] {
  const zones: { id: string; rate: number }[] = [];
  for (const z of ZONES) {
    if (!unlocked.includes(z.id)) continue;
    let rate = 0;
    for (const ev of z.explore) {
      if (ev.kind !== 'battle' && ev.kind !== 'elite') continue;
      if (!encounterEligible(ev, level)) continue;
      const drops = ENEMIES.find((e) => e.id === ev.enemy)?.drops ?? {};
      rate = Math.max(rate, drops[target] ?? 0);
    }
    if (rate > 0) zones.push({ id: z.id, rate });
  }
  return zones.sort((a, b) => b.rate - a.rate).map((z) => z.id);
}

/** Pure collection planner (#74): do the dungeon's REMAINING normal floors
 * (fromFloor = the next uncleared floor, 1-based) still yield `target`,
 * through an authored cache or an enemy drop? */
export function dungeonFloorsYield(target: string, d: DungeonDef, fromFloor: number): boolean {
  for (let f = Math.max(1, fromFloor); f <= d.floors.length; f++) {
    const floor = d.floors[f - 1]!;
    if (floor.treasure?.item === target) return true;
    if (floor.enemies.some((id) => ENEMIES.find((e) => e.id === id)?.drops?.[target])) return true;
  }
  return false;
}

export function dungeonBossSource(zoneId: string): EncounterSource | undefined {
  const z = zoneDef(zoneId);
  if (!z?.dungeon) return undefined;
  const d = z.dungeon;
  return {
    enemyId: d.boss,
    weight: 1,
    origin: {
      kind: 'dungeon',
      zoneId: z.id,
      dungeonId: d.id,
      floor: d.floors.length + 1,
      boss: true,
    },
  };
}

export function dungeonFloorSources(zoneId: string): EncounterSource[] {
  const z = zoneDef(zoneId);
  if (!z?.dungeon) return [];
  return z.dungeon.floors.flatMap((f) =>
    f.enemies.map((enemyId) => ({
      enemyId,
      weight: 1,
      origin: {
        kind: 'dungeon',
        zoneId: z.id,
        dungeonId: z.dungeon!.id,
        floor: z.dungeon!.floors.indexOf(f) + 1,
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

const r4 = (n: number): number => Math.round(n * 10000) / 10000;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Nearest-rank percentile (#88): q=0.5 → median, q=0.9 → p90. */
function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1));
  return r3(sorted[idx]!);
}

/** Sums per-fight observation maps into a cell accumulator (#84). */
function addInto(dst: Record<string, number>, src: Record<string, number>): void {
  for (const [k, v] of Object.entries(src)) dst[k] = (dst[k] ?? 0) + v;
}

/** Per-fight average of an observation map, rounded (#84). */
function avgMap(m: Record<string, number>, f: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) out[k] = r3(v / f);
  return out;
}

export function runCell(spec: CellSpec): CellStat {
  const hero = makeHero(spec.classId, spec.level, spec.gear);
  const total = spec.sources.reduce((a, s) => a + s.weight, 0);
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
  const rng = (() => {
    let a = spec.seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  for (let i = 0; i < spec.fights; i++) {
    const roll = rng() * total;
    let acc2 = 0;
    let src = spec.sources[0]!;
    for (const s of spec.sources) {
      acc2 += s.weight;
      if (roll < acc2) {
        src = s;
        break;
      }
    }
    const res = runFight(hero, src.enemyId, spec.policy, rng, src.origin);
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
    for (const [k, v] of Object.entries(res.effectSources)) acc.effectSources[k] = v;
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
  const f = spec.fights;
  const wins = acc.wins;
  return {
    classId: spec.classId,
    level: spec.level,
    gear: spec.gear,
    policy: spec.policy.name,
    items: spec.policy.items,
    pool: spec.pool,
    fights: f,
    winRate: r4(wins / f),
    lossRate: r4(acc.losses / f),
    timeoutRate: r4(acc.timeouts / f),
    avgRoundsWin: wins > 0 ? r2(acc.roundsWin / wins) : 0,
    avgHpPctEnd: r4(acc.hpPct / f),
    avgMpPctEnd: r4(acc.mpPct / f),
    avgDealt: r2(acc.dealt / f),
    avgTaken: r2(acc.taken / f),
    avgItems: r3(acc.items / f),
    guardFreq: r3(acc.guard / f),
    critsPerFight: r3(acc.crits / f),
    dodgesPerFight: r3(acc.dodges / f),
    healPerFight: r2(acc.heals / f),
    overhealPerFight: r2(acc.overheal / f),
    avgShieldGranted: r2(acc.shieldGranted / f),
    avgShieldAbsorbed: r2(acc.shieldAbsorbed / f),
    avgShieldWasted: r3(acc.shieldWasted / f),
    avgShieldExpiryLost: r3(acc.shieldExpiryLost / f),
    avgEquipProcs: r3(acc.equipProcs / f),
    avgSkippedRounds: r3(acc.skipped / f),
    invalidActions: acc.invalid,
    avgMpSpent: r2(acc.mpSpent / f),
    avgBuffCasts: r3(acc.buffCasts / f),
    avgShieldCasts: r3(acc.shieldCasts / f),
    avgDotCasts: r3(acc.dotCasts / f),
    avgDebuffCasts: r3(acc.debuffCasts / f),
    avgCleanseCasts: r3(acc.cleanseCasts / f),
    avgDispelCasts: r3(acc.dispelCasts / f),
    avgDotDealt: r2(acc.dotDealt / f),
    avgDotTaken: r2(acc.dotTaken / f),
    avgHotHealing: r2(acc.hotHealing / f),
    avgWastedPeriodicHealing: r3(acc.wastedPeriodicHealing / f),
    avgExpiredRemovals: r3(acc.expiredRemovals / f),
    avgCleanseRemovals: r3(acc.cleanseRemovals / f),
    avgDispelRemovals: r3(acc.dispelRemovals / f),
    avgConsumedRemovals: r3(acc.consumedRemovals / f),
    avgShieldBreaks: r3(acc.shieldBreaks / f),
    avgProcAttempts: r3(acc.procAttempts / f),
    avgProcHits: r3(acc.procHits / f),
    avgDuration1Applied: r3(acc.duration1Applied / f),
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
    skillCasts: avgMap(acc.skillCasts, f),
    effectRounds: avgMap(acc.effectRounds, f),
    effectApplications: avgMap(acc.effectApplications, f),
    effectSources: acc.effectSources,
  };
}

// ── Standard matrices ───────────────────────────────────────────────────

/** #88: derived from content — EVERY authored skill-unlock level plus the
 * non-unlock breakpoints (2: the canonical post-prologue state,
 * MAX_LEVEL: the endgame cap). A new skill's learnLevel lands in the
 * matrix without hand-editing this list; the matrix-coverage test pins
 * the derivation so the stale-list regression can never recur. */
const AUTHORED_UNLOCK_LEVELS = [...new Set(SKILLS.map((s) => s.learnLevel))].sort(
  (a, b) => a - b,
);
export const MATRIX_LEVELS: readonly number[] = [
  ...new Set([
    ...AUTHORED_UNLOCK_LEVELS,
    2,
    MAX_LEVEL,
  ]),
].sort((a, b) => a - b);
export const MATRIX_FIGHTS = 120;

/** Zones whose authored bands admit at least one ordinary battle (#74 —
 * checked across the zone's own level range, the levels its hostiles
 * target). */
export function hostileZones(): ZoneDef[] {
  return ZONES.filter((z) => {
    if (z.safeHaven) return false;
    for (let level = z.levels[0]; level <= z.levels[1]; level++) {
      if (zoneNormalPool(z.id, level).length > 0) return true;
    }
    return false;
  });
}

/** The full class/level/zone matrix (script report). */
export function runMatrix(fights = MATRIX_FIGHTS, seedBase = 9100): CellStat[] {
  const cells: CellStat[] = [];
  let i = 0;
  for (const cid of CLASS_IDS) {
    for (const z of hostileZones()) {
      const [lo, hi] = z.levels;
      for (const level of MATRIX_LEVELS) {
        if (level < lo - 2 || level > hi + 2) continue;
        // #74: pools follow the live eligibility rule — a level whose band
        // blocks every hostile simply has no cell (never simulate an
        // impossible state).
        const hostile = zoneHostilePool(z.id, level);
        if (hostile.length === 0) continue;
        cells.push(
          runCell({
            classId: cid,
            level,
            gear: 'best',
            policy: POLICIES.rotation,
            pool: z.id,
            sources: hostile,
            fights,
            seed: seedBase + i++,
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
            pool: `${z.id}:tactical`,
            sources: hostile,
            fights,
            seed: seedBase + i++,
          }),
        );
        if (level <= 9) {
          const normals = zoneNormalPool(z.id, level);
          if (normals.length === 0) continue;
          cells.push(
            runCell({
              classId: cid,
              level,
              gear: 'best',
              policy: POLICIES.free,
              pool: `${z.id}:normal`,
              sources: normals,
              fights,
              seed: seedBase + i++,
            }),
          );
        }
      }
    }
    // Bosses at their band top and one gear tier later (the +6 cliff).
    for (const z of ZONES) {
      const boss = dungeonBossSource(z.id);
      if (!boss) continue;
      for (const level of [z.levels[1], Math.min(MAX_LEVEL_SIM, z.levels[1] + 6)]) {
        cells.push(
          runCell({
            classId: cid,
            level,
            gear: 'best',
            policy: POLICIES.rotation,
            pool: `boss:${boss.enemyId}`,
            sources: [boss],
            fights,
            seed: seedBase + i++,
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
            seed: seedBase + i++,
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
  let i = 0;
  const nextSeed = (): number => 7100 + i++;
  const push = (c: Omit<CellSpec, 'seed' | 'fights'> & { fights?: number }): void => {
    cells.push(runCell({ ...c, fights: c.fights ?? SNAPSHOT_FIGHTS, seed: nextSeed() }));
  };
  // 1. Opening band: rotation (no items) across each level's LIVE hostile
  //    table (#74) — the Outskirts for the 1–2 band, the Whisperwood after.
  const bandZoneFor = (level: number): string => {
    for (const z of hostileZones()) {
      // #74: the authored band must CONTAIN the level — ordinary encounters
      // keep no max level, so eligibility alone always matched the
      // Outskirts and the reviewed snapshot never left it.
      if (level < z.levels[0] || level > z.levels[1]) continue;
      if (zoneHostilePool(z.id, level).length > 0) return z.id;
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
  for (const z of ZONES) {
    const boss = dungeonBossSource(z.id);
    if (!boss) continue;
    const intended = z.levels[1];
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

function weaponTier(p: PlayerState): number {
  return p.equipment.weapon ? itemDef(p.equipment.weapon)?.tier ?? 0 : 0;
}

/** Chapter 1 from a hero fresh OUT of the prologue (canonical tutorial
 * outcome: level 2+, #74) with REAL combat, rewards, shops and deaths.
 * Reveals when story beats unlock, how much grinding the curve demands,\ * and what gear the boss actually needed. */
export function simulateChapterOne(classId: ClassId, seed: number): ProgressionReport {
  return driveQuests(classId, seed, CH1, 'm4_blessing');
}

const ALL_MAINS = QUESTS.filter((q) => q.main).map((q) => q.id);

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
  const active = stall.quests.find((q) => q.status === 'active');
  const detail = active?.objectives
    ? ` active=${active.id}[${
      active.objectives.map((o) => `${o.kind}:${o.target}:${o.have}/${o.need}`).join(', ')
    }]`
    : ' no-active';
  const pending = stall.quests.filter((q) => q.status !== 'done').slice(0, 8)
    .map((q) => `${q.id}:${q.status}`).join(' ');
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
    `consumables=[${stall.consumables.map((c) => `${c.id}x${c.qty}`).join(',')}]` +
    `${last} failures={${Object.entries(stall.failures).map(([k, v]) => `${k}:${v}`).join(',')}}`;
}

/** Drives a quest list from a fresh post-prologue hero to `stopQuest`
 * completion (#88: generalized from the chapter-one driver). Exported for
 * diagnostics testing (#111): a list whose stop quest is unreachable
 * forces a deterministic stall whose report can be asserted field by
 * field. */
export function driveQuests(
  classId: ClassId,
  seed: number,
  quests: readonly string[],
  stopQuest: string,
): ProgressionReport {
  const rng: Rng = seededRng(seed);
  // #74: ONE canonical post-tutorial constructor — the fresh class kit at
  // level 2. The live item lesson spends a potion and the reward replaces
  // it (net zero), so the canonical inventory is the untouched kit; the
  // full-flow tutorial test pins real play to this exact state.
  const p = createPostTutorialPlayer(0, 'Sim', classId);
  p.tutorial = 'done'; // the sim models a player past the prologue (#69)
  syncAvailability(p);
  let deaths = 0;
  let fights = 0;
  let grind = 0;
  let objective = 0;
  let explores = 0;
  let itemsUsed = 0;
  const beats: ProgressionBeat[] = [];
  const report: ProgressionReport = {
    classId,
    seed,
    startLevel: p.level,
    beats,
    endLevel: 1,
    endGold: 0,
    totalDeaths: 0,
    totalFights: 0,
    totalObjectiveFights: 0,
    totalGrindFights: 0,
    totalEncounterAttempts: 0,
    totalItemsUsed: 0,
    chapter1Done: false,
    campaignDone: false,
    aranyaLevel: 0,
    aranyaGearTier: 0,
    aranyaDeathsBefore: 0,
  };
  /** One real fight. 'death' applies the real death flow (revive at the
   * safe haven, −10% gold); 'retreat' is a timeout — heal up, no death.
   * `kind` separates quest-driven fights from pure level grinding (#74):
   * the report names both, because conflating them hid a 300-fight
   * collection jump behind a small "grind" number. */
  const originLabel = (b: BattleState): string => {
    const o = b.origin;
    if (o.kind === 'dungeon') {
      return `dungeon@${o.zoneId}:floor${o.floor}${o.boss ? ':boss' : ''}`;
    }
    return `${o.kind}@${o.zoneId}`;
  };
  // #111: observation-only stall context — written after each fight, never
  // read by policy, never touching RNG or combat state.
  let lastAttempt: StallAttempt | undefined;
  let lastFoughtEnemy = '';
  let failureStreak = 0;
  const failures: Record<string, number> = {};
  const fight = (b: BattleState, kind: 'objective' | 'grind'): 'win' | 'death' | 'retreat' => {
    fights++;
    if (kind === 'objective') objective++;
    else grind++;
    let rounds = 0;
    let lastWasGuard = false;
    let result: 'win' | 'death' | 'retreat' = 'retreat';
    while (b.phase === 'active' && rounds < 200) {
      const action = chooseAction(p, b, POLICIES.rotationWithItems, lastWasGuard);
      lastWasGuard = action.kind === 'guard';
      const res = performAction(p, b, action, rng);
      // #74: count consumables when an item action is ACTUALLY consumed —
      // never from inventory deltas, which drops and purchases drive
      // negative.
      if (action.kind === 'item' && res.consumedTurn) itemsUsed++;
      rounds++;
      // #86: the engine's explicit terminal adjudication.
      if (res.outcome === 'victory') {
        resolveVictory(p, b, rng);
        result = 'win';
        break;
      }
      if (res.outcome === 'defeat') {
        applyDeath(p);
        deaths++;
        result = 'death';
        break;
      }
    }
    // #111: record the attempt AFTER resolution — the diagnostic observes
    // the completed fight only.
    lastAttempt = {
      enemy: b.enemy.id,
      origin: originLabel(b),
      outcome: result,
      rounds,
    };
    if (result === 'win') {
      failureStreak = 0;
    } else {
      failureStreak = b.enemy.id === lastFoughtEnemy ? failureStreak + 1 : 1;
      failures[b.enemy.id] = (failures[b.enemy.id] ?? 0) + 1;
    }
    lastFoughtEnemy = b.enemy.id;
    return result;
  };

  const goto = (zoneId: string): void => {
    if (p.currentZone !== zoneId) travel(p, zoneId);
  };

  /** Death recovery: re-entering the safe haven fully heals (free travel,
   * by design); then shop while there. */
  const restock = (): void => {
    if (p.currentZone !== 'emberdawn') {
      travel(p, 'emberdawn');
    } else {
      travel(p, 'whisperwood');
      travel(p, 'emberdawn');
    }
    shop();
  };

  const equipFromBag = (id: string): void => {
    const kind = itemDef(id)?.kind;
    if (kind !== 'weapon' && kind !== 'armor' && kind !== 'trinket') return;
    if (!removeItem(p, id, 1)) return;
    p.equipment[kind] = id;
    clampPools(p);
  };

  function shopHere(): void {
    const stock = currentStock(p);
    for (const kind of ['weapon', 'armor'] as const) {
      const cur = p.equipment[kind] ?? '';
      const curW = statWeight(cur);
      const better = stock
        .filter((id) =>
          (kind === 'weapon' ? id.startsWith('w_') : id.startsWith('a_')) &&
          isEquippable(id, p.classId, p.level).ok &&
          statWeight(id) > curW &&
          (itemDef(id)?.price ?? 0) <= p.gold - 30 // keep a potion buffer
        )
        .sort((a, b) => statWeight(b) - statWeight(a))[0];
      if (better && buy(p, better).ok) {
        equipFromBag(better);
      }
    }
    // Best trinket already in the bag.
    const trinket = p.inventory
      .map((e) => e.id)
      .filter((id) => itemDef(id)?.kind === 'trinket' && isEquippable(id, p.classId, p.level).ok)
      .sort((a, b) => statWeight(b) - statWeight(a))[0];
    if (trinket && statWeight(trinket) > statWeight(p.equipment.trinket ?? '')) {
      equipFromBag(trinket);
    }
    const potion = 'c_minor_potion';
    while (countOf(p, potion) < 3) {
      if (!buy(p, potion).ok) break;
    }
  }

  /** Shops every unlocked rack (#73): the village band stocks tier-2 steel
   * at the m5_arms beat, and the Whisperwood's band carries it too — a real
   * shopper compares both. Ends wherever the better rack was. */
  function shop(): void {
    // #88: the full campaign shops EVERY unlocked rack — the chapter-one
    // pair starved late chapters of tier-appropriate steel, and a level-45
    // hero in chapter-one gear cannot survive its own story fights.
    shopHere();
    for (const z of ZONES) {
      if (!p.unlockedZones.includes(z.id) || p.currentZone === z.id) continue;
      if (
        shopStock(z.id, shopTierForZone(z, p.level), { level: p.level, classId: p.classId })
          .length === 0
      ) {
        continue;
      }
      travel(p, z.id);
      shopHere();
    }
  }

  /** Explore-farm until the level rises; returns fights spent. */
  const grindOneLevel = (): number => {
    // #88: at the level cap a grind can never pay — bail before burning
    // 300 explores that cannot gain a level.
    if (p.level >= MAX_LEVEL) return 0;
    const start = p.level;
    // Farm where the hero's band is LIVE (#73, #88): the highest unlocked
    // zone whose hostile table still spawns at this level — the Outskirts
    // for levels 1–2, the Whisperwood from 3, later wilds as they unlock.
    const farmZone =
      [...hostileZones()].reverse().find((z) =>
        p.unlockedZones.includes(z.id) && zoneHostilePool(z.id, p.level).length > 0
      )?.id ?? 'outskirts';
    let n = 0;
    while (p.level === start && n < 300) {
      n++;
      explores++;
      goto(farmZone);
      const out = explore(p, rng, 0);
      if (out.kind === 'battle' && fight(out.battle, 'grind') !== 'win') restock();
    }
    if (p.level > start) shop(); // #74: gear beats land right after level-ups
    return n;
  };

  const questCount = (qid: string, idx: number): number => p.quests[qid]?.counts[idx] ?? 0;

  /** First unlocked zone whose hostile table spawns the enemy AT THE
   * HERO'S LEVEL (#73 + the shared eligibility rule, #74) — the Outskirts
   * come before the Whisperwood for shared early spawns. */
  const zoneOfEnemy = (enemyId: string): string | undefined => {
    for (const z of ZONES) {
      if (!p.unlockedZones.includes(z.id)) continue;
      if (
        z.explore.some((e) =>
          (e.kind === 'battle' || e.kind === 'elite') && e.enemy === enemyId &&
          encounterEligible(e, p.level)
        )
      ) {
        return z.id;
      }
    }
    return undefined;
  };

  const farmKills = (qid: string, objIdx: number, enemyId: string, need: number): boolean => {
    const zid = zoneOfEnemy(enemyId);
    if (!zid) return false;
    let local = 0;
    while (questCount(qid, objIdx) < need) {
      if (++local > 400) return false;
      explores++;
      goto(zid);
      const out = explore(p, rng, 0);
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
    exploreDropZonesFor(target, p.unlockedZones, p.level);

  /** Reachable dungeon whose remaining normal floors can still yield the
   * target (#74) — the sim dives REAL floors instead of pretending wilds
   * or shops are the only sources. */
  const dungeonSourceFor = (target: string): { zoneId: string; d: DungeonDef } | undefined => {
    for (const z of ZONES) {
      if (!p.unlockedZones.includes(z.id) || !z.dungeon) continue;
      if (dungeonFloorsYield(target, z.dungeon, nextDungeonFloor(p, z.dungeon))) {
        return { zoneId: z.id, d: z.dungeon };
      }
    }
    return undefined;
  };

  /** Unlocked zones whose shop GENUINELY stocks the target at the hero's
   * current level (#74) — hops go where the shelf actually carries it. */
  const stockedZones = (target: string): string[] => {
    const out: string[] = [];
    for (const z of ZONES) {
      if (!p.unlockedZones.includes(z.id)) continue;
      const tier = shopTierForZone(z, p.level);
      if (shopStock(z.id, tier, { level: p.level, classId: p.classId }).includes(target)) {
        out.push(z.id);
      }
    }
    return out;
  };

  const farmCollect = (target: string, need: number): boolean => {
    const price = itemDef(target)?.price ?? 0;
    let local = 0;
    while (countOf(p, target) < need) {
      if (++local > 60) return false; // safety net, never the plan (#74)
      // 1. Buy when THIS shelf genuinely stocks it and it's affordable (#73).
      if (currentStock(p).includes(target) && p.gold >= price + 20 && buy(p, target).ok) continue;
      // 2. Farm the best eligible wild drop source.
      const zones = dropZonesFor(target);
      if (zones.length > 0) {
        goto(zones[0]!);
        explores++;
        const out = explore(p, rng, 0);
        if (out.kind === 'battle' && fight(out.battle, 'objective') !== 'win') restock();
        continue;
      }
      // 3. Dive REAL dungeon floors that still yield it (#73: the taught
      //    route — caches + Mycelids in the Rootbound Hollow).
      const ds = dungeonSourceFor(target);
      if (ds) {
        goto(ds.zoneId);
        const res = diveDungeonLocal(p, ds.d, rng);
        if (res.ok && res.battle) {
          if (fight(res.battle, 'objective') !== 'win') restock();
        } else {
          restock();
        }
        continue;
      }
      // 4. Hop to a zone whose shelf GENUINELY stocks it — next loop buys.
      const stocking = stockedZones(target);
      if (stocking.length > 0 && p.gold >= price) {
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
      const d = dungeonOf(zoneDef(zoneId)!);
      if (!d) return false;
      goto(zoneId);
      const res = diveDungeonLocal(p, d, rng);
      if (!res.ok || !res.battle) {
        restock();
        continue;
      }
      const isBoss = res.battle.origin.kind === 'dungeon' && res.battle.origin.boss;
      if (isBoss && report.aranyaLevel === 0 && zoneId === 'whisperwood') {
        report.aranyaLevel = p.level;
        report.aranyaGearTier = weaponTier(p);
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
    syncAvailability(p);
    for (const qid of quests) {
      if (p.quests[qid]?.status !== 'turnIn') continue;
      const q = quest(qid);
      if (!q) continue;
      const zid = zoneOfNpc(q.finishNpc)?.id;
      if (!zid) continue;
      goto(zid);
      onTalk(p, q.finishNpc);
      if (p.quests[qid]?.status === 'turnIn' && turnInQuest(p, qid, q.finishNpc).ok) {
        beats.push({
          questId: qid,
          level: p.level,
          gold: p.gold,
          deaths,
          fights,
          grindFights: grind,
          itemsUsed,
        });
        shop(); // #74: gear beats land right after quest rewards
      }
    }
  };

  const acceptAvailable = (): void => {
    syncAvailability(p);
    for (const qid of quests) {
      if (p.quests[qid]?.status !== 'available') continue;
      const q = quest(qid);
      if (!q) continue;
      const zid = zoneOfNpc(q.startNpc)?.id;
      if (!zid) continue;
      goto(zid);
      onTalk(p, q.startNpc);
      if (p.quests[qid]?.status === 'available') acceptQuest(p, qid, q.startNpc);
    }
  };

  let guard = 0;
  const statusOf = (qid: string): string | undefined => p.quests[qid]?.status;
  const guardLimit = 300 + quests.length * 40;
  while (statusOf(stopQuest) !== 'done' && ++guard < guardLimit) {
    turnInReady();
    if (statusOf(stopQuest) === 'done') break;
    acceptAvailable();
    const active = quests.find((id) => p.quests[id]?.status === 'active');
    if (!active) {
      grindOneLevel();
      continue;
    }
    const q = quest(active)!;
    let progressed = false;
    for (let i = 0; i < q.objectives.length; i++) {
      const obj = q.objectives[i]!;
      const need = obj.count ?? 1;
      const have = obj.kind === 'collect' ? countOf(p, obj.target) : questCount(active, i);
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
          : ZONES.find((z) => z.dungeon && dungeonBossSource(z.id)?.enemyId === obj.target)?.id ??
            ZONES.find((z) => z.dungeon && dungeonFloorsYield(obj.target, z.dungeon, 1))?.id;
        progressed = diveZone ? clearBoss(diveZone) : farmKills(active, i, obj.target, need);
      } else if (obj.kind === 'collect') {
        progressed = farmCollect(obj.target, need);
      } else if (obj.kind === 'talk') {
        const zid = zoneOfNpc(obj.target)?.id;
        if (zid) {
          goto(zid);
          onTalk(p, obj.target);
        }
        progressed = questCount(active, i) >= need;
      } else if (obj.kind === 'reach') {
        travel(p, obj.target);
        progressed = true;
      } else if (obj.kind === 'dungeon') {
        // #88: later chapters gate story beats behind dungeon dives —
        // clear the named dungeon's boss with real fights.
        const dz = ZONES.find((z) => z.dungeon?.id === obj.target);
        progressed = dz ? clearBoss(dz.id) : false;
      }
      if (!progressed) break;
    }
    if (!progressed) grindOneLevel();
  }
  if (p.quests[stopQuest]?.status !== 'done') {
    // #111: the stall is reported as STRUCTURED data first — the string is
    // formatted from it, so the report and the message can never drift.
    const equipped = (slot: 'weapon' | 'armor' | 'trinket'): string => p.equipment[slot] ?? '';
    const tierOf = (id: string): number => id ? itemDef(id)?.tier ?? 0 : 0;
    const stallQuests: StallQuest[] = quests.map((id) => {
      const status = p.quests[id]?.status ?? 'none';
      if (status !== 'active') return { id, status };
      const q = quest(id);
      return {
        id,
        status,
        objectives: q?.objectives.map((o, i) => ({
          kind: o.kind,
          target: o.target,
          have: o.kind === 'collect' ? countOf(p, o.target) : questCount(id, i),
          need: o.count ?? 1,
        })) ?? [],
      };
    });
    const stall: StallDiagnostic = {
      level: p.level,
      zone: p.currentZone,
      unlockedZones: [...p.unlockedZones],
      hp: p.hp,
      maxHp: statsOf(p).maxHp,
      mp: p.mp,
      maxMp: statsOf(p).maxMp,
      gold: p.gold,
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
        itemDef(equipped(slot))?.triggers?.map((t) => t.name) ?? []
      ),
      consumables: p.inventory
        .filter((e) => itemDef(e.id)?.kind === 'consumable' && e.qty > 0)
        .map((e) => ({ id: e.id, qty: e.qty })),
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
  report.chapter1Done = p.quests['m4_blessing']?.status === 'done';
  // #88: full-campaign completion — every main quest m1→m25 done.
  report.campaignDone = ALL_MAINS.every((id) => p.quests[id]?.status === 'done');
  report.endLevel = p.level;
  report.endGold = p.gold;
  report.totalDeaths = deaths;
  report.totalFights = fights;
  report.totalObjectiveFights = objective;
  report.totalGrindFights = grind;
  report.totalEncounterAttempts = explores;
  report.totalItemsUsed = itemsUsed;
  return report;
}

// Local shims so the progression sim never imports handler code. These
// re-export the pure engine entry points under stable local names.
function diveDungeonLocal(
  p: PlayerState,
  d: NonNullable<ZoneDef['dungeon']>,
  rng: Rng,
): { ok: boolean; battle?: BattleState; lines: string[] } {
  return diveDungeon(p, d, rng);
}

function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export { seededRng };

/** Enemies explicitly flagged as tutorial fixtures (#69). */
export function tutorialEnemies(): EnemyDef[] {
  return ENEMIES.filter((e) => e.tutorial === true);
}
