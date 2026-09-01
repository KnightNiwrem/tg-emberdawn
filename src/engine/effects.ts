/** Live combat-effect instances (#78): the authoritative mechanical battle
 * state. Pure, deterministic, plain-JSON. Combat mechanics read the folds
 * here; the battle UI derives its rows from the same instances — there is
 * no second presentational collection to drift. No grammY imports. */

import type { EffectSpec, EffectTag, StackingPolicy, StatKey } from '../content/types.ts';
import type { BattleState, EffectInstance, EffectSource } from './types.ts';

/** The last round index an effect applied at `appliedRound` stays active
 * in, given its timing (#27/#38/#77 semantics, now data-driven):
 * - `immediate`: the cast round counts (DEF/RES/SPD defend the cast round's
 *   enemy response; enemy guards cover the rounds AFTER their cast), so the
 *   first end-of-round tick is not skipped.
 * - `defer`: the cast round cannot use the stat (ATK/MAG empower only
 *   future actions), so the first tick is skipped. */
function expiresRoundFor(
  appliedRound: number,
  duration: number,
  timing: 'defer' | 'immediate',
): number {
  return appliedRound + duration - (timing === 'immediate' ? 1 : 0);
}

export interface InstanceSeed {
  defId: string;
  name: string;
  kind: EffectInstance['kind'];
  side: 'player' | 'enemy';
  source: EffectSource;
  stat?: StatKey;
  pct?: number;
  control?: 'stun';
  actions?: number;
  perRound?: number;
  pctOfMaxPerRound?: number;
  tickPhase?: 'roundEnd' | 'playerTurnStart';
  bypassShield?: boolean;
  shieldAmount?: number;
  tags: EffectTag[];
  stacking: StackingPolicy;
  duration: number;
  timing: 'defer' | 'immediate';
  removable: boolean;
  /** Lasts the whole battle (#80): remaining/expiresRound are inert. */
  battleLifetime?: boolean;
}

/** Instances of the same identity (defId + side + kind, and stat for
 * statmods) interact via the authored stacking policy; different sources
 * always coexist as independent contributions. */
function sameIdentity(a: EffectInstance, seed: InstanceSeed): boolean {
  if (a.defId !== seed.defId || a.side !== seed.side || a.kind !== seed.kind) return false;
  if (a.kind === 'statmod') return a.stat === seed.stat;
  return true;
}

/** Applies an effect instance with its authored stacking policy. Returns
 * the instance now backing the effect (the new one, or the retained prior
 * one for refresh/strongest-loss cases). */
export function applyInstance(b: BattleState, seed: InstanceSeed): EffectInstance {
  const existing = b.effectInstances.find((i) => sameIdentity(i, seed));
  const battleLife = seed.battleLifetime === true;
  const make = (): EffectInstance => {
    b.effectSeq++;
    return {
      iid: `ef${b.effectSeq}`,
      defId: seed.defId,
      name: seed.name,
      side: seed.side,
      source: seed.source,
      kind: seed.kind,
      stat: seed.stat,
      pct: seed.pct,
      control: seed.control,
      actions: seed.actions,
      perRound: seed.perRound,
      pctOfMaxPerRound: seed.pctOfMaxPerRound,
      tickPhase: seed.tickPhase,
      bypassShield: seed.bypassShield,
      shieldAmount: seed.shieldAmount,
      tags: [...seed.tags],
      stacking: seed.stacking,
      appliedRound: b.round,
      remaining: battleLife ? 1 : seed.duration,
      deferFirstTick: seed.timing === 'defer',
      removable: seed.removable,
      expiresRound: battleLife
        ? Number.MAX_SAFE_INTEGER
        : expiresRoundFor(b.round, seed.duration, seed.timing),
      ...(battleLife ? { battleLifetime: true as const } : {}),
    };
  };
  if (!existing) {
    const inst = make();
    b.effectInstances.push(inst);
    return inst;
  }
  switch (seed.stacking) {
    case 'stack': {
      const inst = make();
      b.effectInstances.push(inst);
      return inst;
    }
    case 'refresh': {
      existing.remaining = battleLife ? 1 : seed.duration;
      existing.deferFirstTick = seed.timing === 'defer';
      existing.expiresRound = battleLife
        ? Number.MAX_SAFE_INTEGER
        : expiresRoundFor(b.round, seed.duration, seed.timing);
      return existing;
    }
    case 'strongest': {
      const incoming = seed.pct ?? 0;
      const current = existing.pct ?? 0;
      // Magnitudes, not signed pcts: saps are stored negative, so the
      // STRONGER sap has the MORE negative pct and must still win (#78).
      if (Math.abs(incoming) > Math.abs(current)) {
        // Retire the weaker instance and apply the fresh one.
        b.effectInstances = b.effectInstances.filter((i) => i !== existing);
        const inst = make();
        b.effectInstances.push(inst);
        return inst;
      }
      // Keep the stronger magnitude; a recast still renews its clock.
      existing.remaining = Math.max(existing.remaining, battleLife ? 1 : seed.duration);
      existing.deferFirstTick = seed.timing === 'defer';
      existing.expiresRound = battleLife
        ? Number.MAX_SAFE_INTEGER
        : expiresRoundFor(b.round, seed.duration, seed.timing);
      return existing;
    }
    case 'replace':
    default: {
      b.effectInstances = b.effectInstances.filter((i) => i !== existing);
      const inst = make();
      b.effectInstances.push(inst);
      return inst;
    }
  }
}

// ── Folds: mechanics read aggregate magnitudes from live instances ──────

/** Sum of live statmod magnitudes for one stat on one side. Different
 * sources coexist and add; each keeps its own magnitude and expiry (#78). */
export function statPct(b: BattleState, side: 'player' | 'enemy', stat: StatKey): number {
  let total = 0;
  for (const i of b.effectInstances) {
    if (i.side === side && i.kind === 'statmod' && i.stat === stat) total += i.pct ?? 0;
  }
  return total;
}

/** Total outgoing-damage sap (the old weaken slots): saps store negative
 * outgoing magnitudes, so this fold negates the sum to the positive sap
 * amount, clamped so stacked saps can never invert an offense stat. */
export function sapPct(b: BattleState, side: 'player' | 'enemy'): number {
  return Math.min(0.95, Math.max(0, -statPct(b, side, 'outgoing')));
}

/** Incoming-damage amplification (Vulnerable et al.): negative values
 * mitigate; never below a 5% floor so damage math stays sane. */
export function incomingAmpPct(b: BattleState, side: 'player' | 'enemy'): number {
  return Math.max(-0.95, statPct(b, side, 'incoming'));
}

/** Mitigation multiplier bonus (the old enemy guard stances; negative
 * values will be armor/ward break in #83). */
export function mitigationPct(b: BattleState, side: 'player' | 'enemy'): number {
  return statPct(b, side, 'mitigation');
}

/** Live stun control on a side, if any. */
export function stunInstance(b: BattleState, side: 'player' | 'enemy'): EffectInstance | undefined {
  return b.effectInstances.find((i) =>
    i.side === side && i.kind === 'control' && i.control === 'stun'
  );
}

/** Consumes one stunned action at the side's phase: returns true when the
 * action is lost, removing the instance when its actions run out. */
export function consumeStun(b: BattleState, side: 'player' | 'enemy'): boolean {
  const inst = stunInstance(b, side);
  if (!inst) return false;
  inst.actions = (inst.actions ?? 1) - 1;
  if (inst.actions <= 0) {
    b.effectInstances = b.effectInstances.filter((i) => i !== inst);
  }
  return true;
}

/** Any removable instance on a side carrying one of `tags` — used by
 * cleanse/dispel targeting and by UI applicability checks. */
export function hasRemovableTagged(
  b: BattleState,
  side: 'player' | 'enemy',
  tags: EffectTag[],
): boolean {
  return b.effectInstances.some((i) =>
    i.side === side && i.removable && i.tags.some((t) => tags.includes(t))
  );
}

/** Removes up to `max` removable tagged instances from a side; returns the
 * removed instances (for logs/metrics). Cleanse/dispel can never touch
 * unremovable encounter conditions. */
export function removeTagged(
  b: BattleState,
  side: 'player' | 'enemy',
  tags: EffectTag[],
  max?: number,
): EffectInstance[] {
  const removed: EffectInstance[] = [];
  const keep: EffectInstance[] = [];
  for (const i of b.effectInstances) {
    const eligible = i.side === side && i.removable && i.tags.some((t) => tags.includes(t));
    if (eligible && (max === undefined || removed.length < max)) removed.push(i);
    else keep.push(i);
  }
  b.effectInstances = keep;
  return removed;
}

// ── Shields (#79): one shared pool per side, capacity from contributions ──

/** Live maximum shield capacity on a side: the sum of all live
 * contribution instances. Derived, never stored. */
export function maxShield(b: BattleState, side: 'player' | 'enemy'): number {
  let total = 0;
  for (const i of b.effectInstances) {
    if (i.side === side && i.kind === 'shield') total += i.shieldAmount ?? 0;
  }
  return total;
}

export interface ShieldGrant {
  /** Capacity that actually entered the pool (after the max cap). */
  applied: number;
  /** Grant capacity trimmed by the cap — never lands in the pool. */
  wasted: number;
  /** Current-pool amount discarded because the new maximum sits below
   * it (replacing a large ward with a smaller one). */
  lost: number;
  /** The new live maximum. */
  max: number;
}

/** Grants one shield contribution (#79). applyInstance handles the
 * authored stacking policy: `refresh` renews the clock WITHOUT refilling
 * a depleted pool; `replace`/`stack` (and a stronger-wins recast) grant
 * fresh capacity. The pool then rises by the granted amount, capped to
 * the new maximum. */
export function grantShield(
  b: BattleState,
  side: 'player' | 'enemy',
  seed: InstanceSeed,
): ShieldGrant {
  const existing = b.effectInstances.find((i) => sameIdentity(i, seed));
  const refill = existing === undefined ||
    (seed.stacking !== 'refresh' &&
      !(seed.stacking === 'strongest' &&
        (seed.shieldAmount ?? 0) <= (existing.shieldAmount ?? 0)));
  const granted = refill ? seed.shieldAmount ?? 0 : 0;
  const before = b.shield[side];
  applyInstance(b, seed);
  const max = maxShield(b, side);
  const after = Math.min(before + granted, max);
  b.shield[side] = after;
  // Decomposition: `applied` is the pool gain from the grant, `wasted`
  // the grant capacity the cap trimmed, `lost` existing pool discarded
  // because the new maximum sits below it (small-ward replacement).
  const applied = Math.max(0, after - before);
  return { applied, wasted: granted - applied, lost: Math.max(0, before - after), max };
}

export interface ShieldAbsorb {
  absorbed: number;
  /** Damage that reaches HP after the shield took its share. */
  hpDamage: number;
  /** True when this hit drove a live pool to zero. */
  broke: boolean;
}

/** THE authoritative shield-absorption step (#79): post-mitigation damage
 * pools here before HP. Every HP-damage path routes through it unless its
 * spec opts out with `bypassShield`. */
export function absorbShield(
  b: BattleState,
  side: 'player' | 'enemy',
  dmg: number,
): ShieldAbsorb {
  const pool = b.shield[side];
  const absorbed = Math.min(pool, dmg);
  b.shield[side] = pool - absorbed;
  return { absorbed, hpDamage: dmg - absorbed, broke: absorbed > 0 && b.shield[side] === 0 };
}

export interface ShieldLoss {
  side: 'player' | 'enemy';
  /** Current-pool amount discarded by the cap — material only (> 0). */
  lost: number;
}

/** After a batch removal (expiry, cleanse, dispel) the maximum may drop:
 * remove the unused capacity first, then cap the current pool — the #79
 * canonical expiration rule, order-independent, computed once per batch.
 * Returns material losses for logs/metrics. */
export function applyShieldExpiry(
  b: BattleState,
  expired: readonly EffectInstance[],
): ShieldLoss[] {
  const sides = new Set(expired.filter((i) => i.kind === 'shield').map((i) => i.side));
  const losses: ShieldLoss[] = [];
  for (const side of sides) {
    const max = maxShield(b, side);
    const lost = b.shield[side] - max;
    if (lost > 0) {
      b.shield[side] = max;
      losses.push({ side, lost });
    }
  }
  return losses;
}

// ── Time: periodic ticks and end-of-round bookkeeping ───────────────────

export interface PeriodicTick {
  side: 'player' | 'enemy';
  /** Positive heals, negative damages. */
  amount: number;
  name: string;
  instance: EffectInstance;
}

function tickPhaseOf(i: EffectInstance, maxHp: number): PeriodicTick | undefined {
  if (i.kind !== 'periodic') return undefined;
  const amount = i.perRound ?? Math.round((i.pctOfMaxPerRound ?? 0) * maxHp);
  return { side: i.side, amount, name: i.name, instance: i };
}

/** Gathers the player-turn-start periodic ticks WITHOUT touching clocks
 * (#86): combat applies them one at a time with a terminal check between,
 * so a lethal tick can stop the round before later work runs. */
export function gatherTurnStartTicks(
  b: BattleState,
  maxHpOf: (side: 'player' | 'enemy') => number,
): PeriodicTick[] {
  const ticks: PeriodicTick[] = [];
  for (const i of b.effectInstances) {
    if (i.kind !== 'periodic' || i.tickPhase !== 'playerTurnStart') continue;
    const t = tickPhaseOf(i, maxHpOf(i.side));
    if (t) ticks.push(t);
  }
  return ticks;
}

/** Clock side of the player-turn-start phase (#86): decrements the ticked
 * instances on their own beat, prunes, and caps shields after the batch
 * removal. End-of-round bookkeeping never touches this phase. */
export function settleTurnStart(
  b: BattleState,
  ticks: readonly PeriodicTick[],
): ShieldLoss[] {
  for (const t of ticks) t.instance.remaining--;
  const expired = pruneExpired(b);
  return applyShieldExpiry(b, expired);
}

/** Ticks `playerTurnStart` periodic effects (called at the start of the
 * player's phase, before the stun check — poison-like pressure does not
 * care whether you can act). Each ticking instance decrements on its own
 * beat; end-of-round bookkeeping never touches this phase. */
export function tickPlayerTurnStart(
  b: BattleState,
  maxHpOf: (side: 'player' | 'enemy') => number,
): { ticks: PeriodicTick[]; shieldLosses: ShieldLoss[] } {
  const ticks = gatherTurnStartTicks(b, maxHpOf);
  const shieldLosses = settleTurnStart(b, ticks);
  return { ticks, shieldLosses };
}

/** Gathers the end-of-round periodic ticks WITHOUT touching clocks (#86):
 * combat applies them one at a time and stops at the first terminal
 * result, so a lethal DoT can never be followed by more work. */
export function gatherRoundEndTicks(
  b: BattleState,
  maxHpOf: (side: 'player' | 'enemy') => number,
): PeriodicTick[] {
  const ticks: PeriodicTick[] = [];
  for (const i of [...b.effectInstances]) {
    if (i.kind !== 'periodic' || i.tickPhase !== 'roundEnd') continue;
    const t = tickPhaseOf(i, maxHpOf(i.side!));
    if (t) ticks.push(t);
  }
  return ticks;
}

/** End-of-round clock bookkeeping (#86): duration decrements FIRST-phase
 * instances skip exactly their first tick (#27/#38/#77), control instances
 * tick by consumption and are untouched here, battle-lifetime instances
 * never age — then the prune. Returns the expired instances. */
export function settleEndOfRound(b: BattleState): EffectInstance[] {
  for (const i of b.effectInstances) {
    if (i.battleLifetime) continue; // lasts the whole battle (#80)
    if (i.kind === 'control') continue;
    if (i.kind === 'periodic' && i.tickPhase === 'playerTurnStart') continue;
    if (i.deferFirstTick) i.deferFirstTick = false;
    else i.remaining--;
  }
  return pruneExpired(b);
}

/** End-of-round bookkeeping: periodic `roundEnd` ticks FIRST (an effect at
 * its last remaining tick still fires), then duration decrements and the
 * prune. Deferred effects skip exactly their first end-of-round tick
 * (#27/#38/#77). Control instances tick by consumption, not rounds;
 * `playerTurnStart` periodics tick on their own beat and are untouched
 * here. (The combat engine uses the gather/settle split so it can stop at
 * terminal HP between ticks — #86; this combined form stays for direct
 * phase-level use and tests.) */
export function tickEndOfRound(
  b: BattleState,
  maxHpOf: (side: 'player' | 'enemy') => number,
): { ticks: PeriodicTick[]; expired: EffectInstance[]; shieldLosses: ShieldLoss[] } {
  const ticks = gatherRoundEndTicks(b, maxHpOf);
  const expired = settleEndOfRound(b);
  return { ticks, expired, shieldLosses: applyShieldExpiry(b, expired) };
}

/** Removes instances whose mechanical life is over. Control instances
 * expire ONLY by consumption (their target's next phase always arrives
 * before any prune could race it) — a round-based prune here would delete
 * an enemy-applied stun before the player's turn to lose. */
export function pruneExpired(b: BattleState): EffectInstance[] {
  const expired: EffectInstance[] = [];
  b.effectInstances = b.effectInstances.filter((i) => {
    const done = i.kind === 'control'
      ? (i.actions !== undefined && i.actions <= 0)
      : i.remaining <= 0;
    if (done) expired.push(i);
    return !done;
  });
  return expired;
}

// ── Spec helpers shared by the resolver and content tooling ─────────────

/** Builds the instance seed for an instance-bearing spec. Tags default by
 * shape so cleanse/dispel targeting works even when content omits them:
 * negative opponent statmods are harmful, self statmods beneficial,
 * periodics carry `periodic` plus their polarity. */
export function seedForSpec(
  spec: EffectSpec,
  defId: string,
  fallbackName: string,
  side: 'player' | 'enemy',
  source: EffectSource,
  shieldAmount?: number,
): InstanceSeed {
  const base = {
    defId,
    name: 'name' in spec && spec.name ? spec.name : fallbackName,
    side,
    source,
    tags: defaultTags(spec),
    stacking: spec.stacking ?? 'replace',
    removable: spec.removable ?? true,
    ...(spec.lifetime === 'battle' ? { battleLifetime: true as const } : {}),
  };
  switch (spec.kind) {
    case 'statmod':
      return {
        ...base,
        kind: 'statmod',
        stat: spec.stat,
        pct: spec.pct,
        duration: spec.duration,
        timing: spec.timing,
      };
    case 'control':
      return {
        ...base,
        kind: 'control',
        control: spec.control,
        actions: spec.actions,
        duration: spec.actions,
        timing: 'immediate',
      };
    case 'periodic':
      return {
        ...base,
        kind: 'periodic',
        perRound: spec.perRound,
        pctOfMaxPerRound: spec.pctOfMaxPerRound,
        tickPhase: spec.tickPhase,
        ...(spec.bypassShield ? { bypassShield: true } : {}),
        duration: spec.duration,
        timing: 'immediate',
      };
    case 'shield':
      return {
        ...base,
        kind: 'shield',
        shieldAmount: shieldAmount ?? spec.amount ?? 0,
        duration: spec.duration,
        timing: spec.timing,
      };
    default:
      throw new Error(`seedForSpec: non-instance spec kind ${(spec as { kind: string }).kind}`);
  }
}

/** Shape-derived default tags; authored tags merge on top. */
function defaultTags(spec: EffectSpec): EffectTag[] {
  const tags: EffectTag[] = [];
  switch (spec.kind) {
    case 'statmod': {
      const negative = (spec.pct ?? 0) < 0;
      tags.push(negative ? 'harmful' : 'beneficial');
      if (spec.stat === 'outgoing' && negative) tags.push('weaken');
      break;
    }
    case 'control':
      tags.push('harmful', 'control');
      break;
    case 'periodic': {
      const negative = (spec.perRound ?? 0) < 0 || (spec.pctOfMaxPerRound ?? 0) < 0;
      tags.push('periodic', negative ? 'harmful' : 'beneficial', negative ? 'poison' : 'regen');
      break;
    }
    case 'shield':
      tags.push('beneficial');
      break;
  }
  if (spec.tags) {
    for (const t of spec.tags) if (!tags.includes(t)) tags.push(t);
  }
  return tags;
}
