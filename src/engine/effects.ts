/** Live combat-effect instances (#78): the authoritative mechanical battle
 * state. Pure, deterministic, plain-JSON. Combat mechanics read the folds
 * here; the battle UI derives its rows from the same instances — there is
 * no second presentational collection to drift. No grammY imports. */

import type { EffectSpec, EffectTag, StackingPolicy, StatKey } from '../content/types.ts';
import type { BattleState, EffectInstance, EffectSource } from './types.ts';
import { emitCombatEvent } from './telemetry.ts';

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

/** #90 stacking identity: one stable, human-readable key per authored
 * effect within its source — the source id, the equipment trigger index
 * (when the source is an item trigger), and the effect's position in its
 * spec list. Two same-kind effects from one skill/item/move therefore
 * coexist whenever they are authored as distinct entries, and item
 * provenance stays readable in saves and telemetry. The shared `sap` slot
 * is the ONE intentional cross-source identity (#77): every outgoing-damage
 * sap is the same named condition regardless of who cast it. Content
 * integrity asserts derived keys never collide within one source+trigger. */
export function effectDefId(
  sourceId: string,
  triggerIndex: number | undefined,
  effectIndex: number,
  spec: EffectSpec,
): string {
  if (spec.kind === 'statmod' && spec.stat === 'outgoing' && (spec.pct ?? 0) < 0) return 'sap';
  const trigger = triggerIndex === undefined ? '' : `:t${triggerIndex}`;
  return `${sourceId}${trigger}:e${effectIndex}`;
}

/** #90 harness-facing liveness: does any live instance on `side` carry a
 * stacking identity derived from `sourceId` (any of its effects/triggers)? */
export function hasLiveFromSource(
  b: BattleState,
  side: 'player' | 'enemy',
  sourceId: string,
): boolean {
  const prefix = `${sourceId}:`;
  return b.effectInstances.some((i) =>
    i.side === side && (i.defId === sourceId || i.defId.startsWith(prefix))
  );
}

/** Applies an effect instance with its authored stacking policy. Returns
 * the instance now backing the effect (the new one, or the retained prior
 * one for refresh/strongest-loss cases). Emits a structured
 * `effectApplied` event (#88) — the harness counts applications and
 * duration-1 casts without mid-round state sampling.
 *
 * #90 transition semantics — every policy is a COMPLETE step:
 * - `stack`: an independent instance joins the list.
 * - `replace`: the old instance is wholly retired; a fresh one applies.
 * - `refresh`: atomic rebuild — the recast is the latest intent, so the
 *   WHOLE payload (tags, removability, tick/bypass data, shield capacity,
 *   source/name) and the clock renew together from the fresh application;
 *   nothing stale survives. Same iid, same list slot.
 * - `strongest`: the stronger magnitude applies whole; a weaker recast
 *   keeps the winning payload AND its timing untouched (no timing leak)
 *   and may only extend the lifetime, with remaining and expiresRound
 *   moving by the same delta so they can never disagree. */
export function applyInstance(b: BattleState, seed: InstanceSeed): EffectInstance {
  const inst = applyInstanceRaw(b, seed);
  emitCombatEvent({
    kind: 'effectApplied',
    round: b.round,
    side: inst.side,
    defId: seed.defId,
    name: seed.name,
    duration: seed.battleLifetime === true ? 0 : seed.duration,
    tags: [...seed.tags],
    source: `${seed.source.kind}:${seed.source.name}`,
  });
  return inst;
}

/** The single authority for instance construction and lifetime
 * normalization (#90): `remaining`, `expiresRound`, `deferFirstTick` and
 * `battleLifetime` are derived together from (anchor round, duration,
 * timing, lifetime) and can never disagree. Passing `iid` reuses an
 * existing identity (refresh keeps its slot and UI row). */
function buildInstance(b: BattleState, seed: InstanceSeed, iid?: string): EffectInstance {
  const battleLife = seed.battleLifetime === true;
  let id: string;
  if (iid === undefined) {
    b.effectSeq++;
    id = `ef${b.effectSeq}`;
  } else {
    id = iid;
  }
  return {
    iid: id,
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
}

function applyInstanceRaw(b: BattleState, seed: InstanceSeed): EffectInstance {
  const idx = b.effectInstances.findIndex((i) => sameIdentity(i, seed));
  if (idx === -1) {
    const inst = buildInstance(b, seed);
    b.effectInstances.push(inst);
    return inst;
  }
  const existing = b.effectInstances[idx]!;
  switch (seed.stacking) {
    case 'stack': {
      const inst = buildInstance(b, seed);
      b.effectInstances.push(inst);
      return inst;
    }
    case 'refresh': {
      // #90 atomic rebuild: the recast is the latest intent — the whole
      // payload and the clock renew together from the fresh application;
      // nothing stale survives. Same iid, same list slot.
      b.effectInstances[idx] = buildInstance(b, seed, existing.iid);
      return b.effectInstances[idx]!;
    }
    case 'strongest': {
      const incoming = seed.pct ?? 0;
      const current = existing.pct ?? 0;
      // Magnitudes, not signed pcts: saps are stored negative, so the
      // STRONGER sap has the MORE negative pct and must still win (#78).
      if (Math.abs(incoming) > Math.abs(current)) {
        // Retire the weaker instance and apply the fresh one whole.
        b.effectInstances[idx] = buildInstance(b, seed);
        return b.effectInstances[idx]!;
      }
      // Keep the winning payload AND its timing — a weaker recast may not
      // leak its own timing metadata (#90); it may only extend the
      // lifetime, coherently: remaining and expiresRound move by the same
      // delta (battle-lifetime counts as infinitely long and upgrades the
      // winner), so the two clocks can never disagree.
      const freshLife = seed.battleLifetime === true
        ? Number.MAX_SAFE_INTEGER
        : expiresRoundFor(b.round, seed.duration, seed.timing);
      if (freshLife > existing.expiresRound) {
        if (seed.battleLifetime === true) {
          existing.battleLifetime = true;
          existing.expiresRound = Number.MAX_SAFE_INTEGER;
          existing.remaining = 1;
        } else {
          existing.remaining += freshLife - existing.expiresRound;
          existing.expiresRound = freshLife;
        }
      }
      return existing;
    }
    case 'replace':
    default: {
      b.effectInstances[idx] = buildInstance(b, seed);
      return b.effectInstances[idx]!;
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
    emitCombatEvent({
      kind: 'effectRemoved',
      round: b.round,
      side,
      defId: inst.defId,
      name: inst.name,
      cause: 'consumed',
    });
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
 * unremovable encounter conditions. `cause` labels the structured removal
 * events (#88) — the caller knows whether it was cleansing or dispelling. */
export function removeTagged(
  b: BattleState,
  side: 'player' | 'enemy',
  tags: EffectTag[],
  max?: number,
  cause: 'cleansed' | 'dispelled' = 'cleansed',
): EffectInstance[] {
  const removed: EffectInstance[] = [];
  const keep: EffectInstance[] = [];
  for (const i of b.effectInstances) {
    const eligible = i.side === side && i.removable && i.tags.some((t) => tags.includes(t));
    if (eligible && (max === undefined || removed.length < max)) removed.push(i);
    else keep.push(i);
  }
  b.effectInstances = keep;
  for (const i of removed) {
    emitCombatEvent({
      kind: 'effectRemoved',
      round: b.round,
      side: i.side,
      defId: i.defId,
      name: i.name,
      cause,
    });
  }
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
  const grant: ShieldGrant = {
    applied,
    wasted: granted - applied,
    lost: Math.max(0, before - after),
    max,
  };
  emitCombatEvent({ kind: 'shieldGrant', round: b.round, side, applied, wasted: grant.wasted });
  return grant;
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
  const broke = absorbed > 0 && b.shield[side] === 0;
  if (broke) emitCombatEvent({ kind: 'shieldBreak', round: b.round, side });
  return { absorbed, hpDamage: dmg - absorbed, broke };
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
  for (const i of expired) {
    emitCombatEvent({
      kind: 'effectRemoved',
      round: b.round,
      side: i.side,
      defId: i.defId,
      name: i.name,
      cause: 'expired',
    });
  }
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

/** Shape-derived default tags; authored tags merge on top.
 *
 * #87 semantic policy: polarity follows what the stat MEANS to the bearer,
 * never the sign alone. Incoming-damage modifiers are INVERTED — more
 * damage taken is harmful to the bearer, mitigation is beneficial — so
 * Expose Weakness and Death Mark can never read as enemy benefits. DoT
 * families are AUTHORED data, never inferred from negativity: the engine
 * derives only `periodic` + polarity, plus the one unambiguous family
 * (`regen`) for positive ticks; poison/burn/bleed must be authored
 * explicitly (content-integrity tested). */
function defaultTags(spec: EffectSpec): EffectTag[] {
  const tags: EffectTag[] = [];
  switch (spec.kind) {
    case 'statmod': {
      const negative = (spec.pct ?? 0) < 0;
      const beneficial = spec.stat === 'incoming' ? negative : !negative;
      tags.push(beneficial ? 'beneficial' : 'harmful');
      if (spec.stat === 'outgoing' && negative) tags.push('weaken');
      break;
    }
    case 'control':
      tags.push('harmful', 'control');
      break;
    case 'periodic': {
      const negative = (spec.perRound ?? 0) < 0 || (spec.pctOfMaxPerRound ?? 0) < 0;
      tags.push('periodic', negative ? 'harmful' : 'beneficial');
      if (!negative) tags.push('regen');
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

/** The tags an EffectSpec derives at application (#87) — exposed for the
 * status-resistance policy and content validation. */
export function semanticTags(spec: EffectSpec): EffectTag[] {
  return defaultTags(spec);
}
