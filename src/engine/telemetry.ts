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

export type CombatEvent =
  | {
    kind: 'effectApplied';
    round: number;
    side: CombatSide;
    defId: string;
    name: string;
    /** Authored duration (battle-lifetime ⇒ 0) — duration-1 casts are
     * countable without mid-round state sampling (#88). */
    duration: number;
    tags: string[];
    source: string;
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
