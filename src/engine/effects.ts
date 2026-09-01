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
  shieldAmount?: number;
  tags: EffectTag[];
  stacking: StackingPolicy;
  duration: number;
  timing: 'defer' | 'immediate';
  removable: boolean;
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
      shieldAmount: seed.shieldAmount,
      tags: [...seed.tags],
      stacking: seed.stacking,
      appliedRound: b.round,
      remaining: seed.duration,
      deferFirstTick: seed.timing === 'defer',
      removable: seed.removable,
      expiresRound: expiresRoundFor(b.round, seed.duration, seed.timing),
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
      existing.remaining = seed.duration;
      existing.deferFirstTick = seed.timing === 'defer';
      existing.expiresRound = expiresRoundFor(b.round, seed.duration, seed.timing);
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
      existing.remaining = Math.max(existing.remaining, seed.duration);
      existing.deferFirstTick = seed.timing === 'defer';
      existing.expiresRound = expiresRoundFor(b.round, seed.duration, seed.timing);
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

/** Ticks `playerTurnStart` periodic effects (called at the start of the
 * player's phase, before the stun check — poison-like pressure does not
 * care whether you can act). Each ticking instance decrements on its own
 * beat; end-of-round bookkeeping never touches this phase. */
export function tickPlayerTurnStart(
  b: BattleState,
  maxHpOf: (side: 'player' | 'enemy') => number,
): PeriodicTick[] {
  const ticks: PeriodicTick[] = [];
  for (const i of b.effectInstances) {
    if (i.kind !== 'periodic' || i.tickPhase !== 'playerTurnStart') continue;
    const t = tickPhaseOf(i, maxHpOf(i.side));
    if (t) ticks.push(t);
  }
  for (const t of ticks) t.instance.remaining--;
  pruneExpired(b);
  return ticks;
}

/** End-of-round bookkeeping: periodic `roundEnd` ticks FIRST (an effect at
 * its last remaining tick still fires), then duration decrements and the
 * prune. Deferred effects skip exactly their first end-of-round tick
 * (#27/#38/#77). Control instances tick by consumption, not rounds;
 * `playerTurnStart` periodics tick on their own beat and are untouched
 * here. */
export function tickEndOfRound(
  b: BattleState,
  maxHpOf: (side: 'player' | 'enemy') => number,
): { ticks: PeriodicTick[]; expired: EffectInstance[] } {
  const ticks: PeriodicTick[] = [];
  for (const i of [...b.effectInstances]) {
    if (i.kind !== 'periodic' || i.tickPhase !== 'roundEnd') continue;
    const t = tickPhaseOf(i, maxHpOf(i.side!));
    if (t) ticks.push(t);
  }
  for (const i of b.effectInstances) {
    if (i.kind === 'control') continue;
    if (i.kind === 'periodic' && i.tickPhase === 'playerTurnStart') continue;
    if (i.deferFirstTick) i.deferFirstTick = false;
    else i.remaining--;
  }
  const expired = pruneExpired(b);
  return { ticks, expired };
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
): InstanceSeed {
  const base = {
    defId,
    name: 'name' in spec && spec.name ? spec.name : fallbackName,
    side,
    source,
    tags: defaultTags(spec),
    stacking: spec.stacking ?? 'replace',
    removable: spec.removable ?? true,
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
        duration: spec.duration,
        timing: 'immediate',
      };
    case 'shield':
      return {
        ...base,
        kind: 'shield',
        shieldAmount: spec.amount ?? 0,
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
