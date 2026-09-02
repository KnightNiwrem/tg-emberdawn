/** Structured combat trace (#101): the engine records typed entries at the
 * moments metrics care about — effect applications and removals (with
 * CAUSE), periodic ticks (with the actually-applied amount), shield breaks
 * and grants, HP damage and restores (with structured amounts), equipment
 * proc attempts, and terminal outcomes.
 *
 * There is NO module-global sink, event bus, listener registry or async
 * queue: every resolution OWNS a plain caller-visible array
 * (CombatTraceEntry[]) and appends plain data SYNCHRONOUSLY after the
 * state transition it records — `startBattle`/`performAction` return it,
 * nested subflows (equipment procs) append to the same array in execution
 * order, and concurrent fights each collect their own. Entries are plain
 * data — NEVER persisted (BattleState's saved shape is untouched), never
 * parsed from presentation text, and ignoring them changes nothing: no
 * state, line, outcome or RNG draw depends on recording.
 *
 * Applied-HP contract (#106): HP-changing entries distinguish the
 * FORMULAIC/RESOLVED magnitude from the ACTUAL HP delta. `hpDamaged`
 * carries `resolved` (post-mitigation, post-shield, pre-floor) and
 * `hpLost` (the capped beforeHp − afterHp every damage family reports);
 * `hpRestored`/`revived` carry `attempted` (the formula) and `applied`
 * (the real delta, overheal = attempted − applied). Metrics that mean
 * "HP that actually moved" read hpLost/applied, never resolved/attempted. */

import type { EffectSource } from './types.ts';

export type CombatSide = 'player' | 'enemy';

/** #93: what an effect application actually did. Telemetry reports the
 * RETAINED instance for `extended`/`ignored`, so a rejected weaker recast
 * can never be counted as though its incoming payload became active. */
export type EffectApplyOutcome =
  | 'created'
  | 'replaced'
  | 'refreshed'
  | 'extended'
  | 'ignored';

/** #89: what produced a burst of HP damage. `enemyAction` — a direct enemy
 * move; `playerAction` — the player's own strike/skill; `periodic` —
 * DOT/HOT ticks; `opening` — the battle-opening phase; `proc` — reactive-
 * proc resolutions; `reflect` — reserved for future retaliation mechanics
 * (nothing authored today). */
export type DamageCause =
  | 'enemyAction'
  | 'playerAction'
  | 'periodic'
  | 'opening'
  | 'proc'
  | 'reflect';

/** #95: what produced an HP restoration — the DamageCause family plus the
 * item channel (out-of-battle-shaped consumable heals). */
export type RestoreCause = DamageCause | 'item';

export type CombatTraceEntry =
  | {
    kind: 'effectApplied';
    round: number;
    side: CombatSide;
    defId: string;
    /** The RETAINED instance's display name — a rejected weaker recast
     * reports the winner's payload, never its own (#93). */
    name: string;
    /** The RETAINED instance's remaining life (battle-lifetime ⇒ 0).
     * Count only created/replaced/refreshed outcomes as applications
     * (#93): extended/ignored recasts activate no new payload. */
    duration: number;
    tags: string[];
    source: string;
    outcome: EffectApplyOutcome;
  }
  | {
    kind: 'effectRemoved';
    round: number;
    side: CombatSide;
    defId: string;
    name: string;
    cause: 'expired' | 'cleansed' | 'dispelled' | 'consumed';
    /** What INITIATED the removal (#105) — the consumable, skill, enemy
     * move or equipment/pre-emptive source whose resolution removed the
     * effect. Deliberately NOT named `source`: the removed effect has its
     * own application source (EffectInstance.source) and the two usually
     * differ. Authored removals ('cleansed'/'dispelled') always carry it;
     * non-authored timing removals ('expired' — the clock ran out,
     * 'consumed' — a control spent its actions) have no initiator, so the
     * field is ABSENT there rather than faked with a synthetic system id. */
    removedBy?: EffectSource;
  }
  | {
    kind: 'periodicTick';
    round: number;
    side: CombatSide;
    name: string;
    /** Authored tick magnitude (positive heals, negative damage). */
    amount: number;
    /** What actually landed after clamps — the gap on a heal is WASTED
     * periodic healing (#88). */
    applied: number;
  }
  | { kind: 'shieldBreak'; round: number; side: CombatSide }
  | { kind: 'shieldGrant'; round: number; side: CombatSide; applied: number; wasted: number }
  | {
    kind: 'procAttempt';
    round: number;
    item: string;
    trigger: string;
    /** True when the attempt executed its effects; false on a missed chance
     * roll. Gated attempts (maxProcs/cooldown) are not attempts at all. */
    success: boolean;
  }
  | {
    kind: 'hpDamaged';
    round: number;
    cause: DamageCause;
    /** Who dealt it (null for environment or self-inflicted causes). */
    attacker: 'player' | 'enemy' | null;
    target: 'player' | 'enemy';
    /** #106: the RESOLVED blow — damage after mitigation and shield
     * absorption, BEFORE the target-HP floor. Overkill included (useful
     * for combat analysis); never an HP delta. */
    resolved: number;
    /** #106: the actual HP the target lost — beforeHp − afterHp, always
     * capped by available HP. Every damage family (direct, opening,
     * periodic, bypass-shield, self/recoil, proc) reports this same
     * meaning, and HP-lost metrics (balance dealt/taken) sum THIS field.
     * Shield absorption is never counted here. Emitted only when
     * hpLost > 0 — shield-only absorbs record nothing (#89). */
    hpLost: number;
    /** Produced inside a reactive-proc resolution — never re-triggers
     * equipment (#89). */
    procProduced: boolean;
  }
  | {
    kind: 'hpRestored';
    round: number;
    side: CombatSide;
    source: string;
    cause: RestoreCause;
    /** The formulaic heal before clamping (#95). */
    attempted: number;
    /** What actually landed after the max-HP clamp — the gap is
     * OVERHEAL, never phantom applied healing. */
    applied: number;
  }
  | {
    kind: 'revived';
    round: number;
    /** What intercepted the lethal transition — 'item:Phoenix Cinder'
     * today. The one permitted immediate revival interception (#104). */
    source: string;
    /** The formulaic restoration (half max HP for the authored revival). */
    attempted: number;
    /** The actual HP delta recorded by the interception — revival runs
     * from exactly 0, so applied is the restored HP itself. */
    applied: number;
  }
  | { kind: 'terminal'; round: number; outcome: 'victory' | 'defeat' };

/** Records one completed state transition (#101): plain data appended to
 * the resolution's trace array. Never a dispatched gameplay event —
 * mechanics never read the trace back. */
export function recordCombatEvent(
  trace: CombatTraceEntry[] | undefined,
  e: CombatTraceEntry,
): void {
  trace?.push(e);
}
