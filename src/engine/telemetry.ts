/** Opt-in structured combat telemetry (#88): the engine emits typed events
 * at the moments metrics care about — effect applications and removals
 * (with CAUSE), periodic ticks (with the actually-applied amount), shield
 * breaks and grants, equipment proc attempts, and terminal outcomes.
 *
 * Production never installs a sink: the module-level callback defaults to
 * null and every emission pays one null check. The balance harness
 * installs a collector per simulated fight and detaches afterwards. Events
 * are plain data, emitted synchronously during resolution — NEVER persisted
 * (BattleState's saved shape is untouched) and never parsed from
 * presentation text. */

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

export type CombatEvent =
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
    /** HP damage after shield absorption. */
    amount: number;
    /** Produced inside a reactive-proc resolution — never re-triggers
     * equipment (#89). */
    procProduced: boolean;
  }
  | { kind: 'terminal'; round: number; outcome: 'victory' | 'defeat' };

let sink: ((e: CombatEvent) => void) | null = null;

/** Installs (or clears) the telemetry sink. The harness sets it per fight
 * and ALWAYS clears it in a finally block. */
export function setCombatTelemetry(fn: ((e: CombatEvent) => void) | null): void {
  sink = fn;
}

/** Engine-internal emission point — a no-op without a sink. */
export function emitCombatEvent(e: CombatEvent): void {
  if (sink) sink(e);
}
