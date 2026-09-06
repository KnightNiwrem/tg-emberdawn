/**
 * The journey coordinator (#159): ONE ordered, synchronous resolution for
 * crossings of authored routes. A journey is persisted plain-JSON state
 * that survives save/load and interactive battles; `currentZone` stays at
 * the edge origin until the coordinator's final arrival, which is the
 * single authority for changing zone, healing at a safe haven, running
 * `onZoneEnter`, and syncing availability.
 *
 * Resolution rules:
 *  - exactly the snapshotted plan's rolls are consumed, in order;
 *  - non-interactive results (flavor/treasure/rest) resolve consecutively
 *    into ONE journey report — no tap per quiet event;
 *  - a battle event starts a travel-provenance fight and pauses here
 *    (victory/flee/defeat lifecycle is handled at the battle boundary);
 *  - nothing rerolls: every mutation happens exactly once, at the event's
 *    completion point, inside the caller's per-user lock.
 */

import { DUNGEON_BLOCK } from './dungeon_run.ts';
import type { BattleState, JourneyState, PlayerState } from './types.ts';
import type { TravelEvent } from '../content/types.ts';
import { zone } from '../content/zones.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { type BattleOutcome, startBattle } from './combat.ts';
import { defaultRng, type Rng, weightedIndex } from './rng.ts';
import { arriveAt, encounterEligible } from './world.ts';
import { departureCheck } from './routes.ts';
import { applyQuietEvent } from './event_rewards.ts';

/** One coordinator result: what the handler should show next. */
export type JourneyStep =
  | { kind: 'battle'; battle: BattleState; outcome: BattleOutcome; line: string }
  | { kind: 'progress'; lines: string[] }
  | { kind: 'arrived'; lines: string[] };

/** Refusals carry a player-facing line; they never mutate. */
export type JourneyStart =
  | { ok: true; step: JourneyStep }
  | { ok: false; refusal: string };

/**
 * Structured journey telemetry (#169): plain records emitted by the
 * coordinator at each road event's RESOLUTION point, in order. Consumers
 * key on these records, never on rendered prose — changing narrative text
 * cannot change telemetry, and no line parsing exists anywhere.
 *  - quiet events (flavor/rest/treasure) emit when they fully resolve;
 *  - battle events emit when the road PRESENTS the fight (the roll is
 *    spent on it; a lost/fled fight aborts the crossing with the record
 *    already emitted — attempt/arrival counts carry the abort);
 *  - `granted` lists the contextual items the event actually put in the
 *    bag (the structured grant, post-relevance-filter).
 */
export interface JourneyEventRecord {
  edgeId: string;
  /** The event's position in the snapshotted plan. */
  index: number;
  /** The resolved event's authored kind ('battle' for road fights). */
  kind: TravelEvent['kind'];
  /** For battle records: the enemy the road presented. */
  enemy?: string;
  /** Contextual item ids this event granted (structured, post-filter). */
  granted?: string[];
}

/** Caller-owned telemetry sink: a plain callback, never a global. */
export type JourneyTelemetry = (event: JourneyEventRecord) => void;

/** The event pool eligible for the NEXT roll at the player's level:
 * battle events honor authored level bands (#73 rule), everything else
 * always rolls. */
function eligiblePool(events: readonly TravelEvent[], level: number): TravelEvent[] {
  return events.filter((event) => encounterEligible(event, level));
}

function rollEvent(events: readonly TravelEvent[], level: number, rng: Rng): TravelEvent {
  const pool = eligiblePool(events, level);
  if (pool.length === 0) {
    // Integrity forbids an empty table for a nonzero count; this is the
    // belt-and-braces fallback so a roll is never lost.
    return { kind: 'flavor', weight: 1, text: 'The road is quiet.' };
  }
  return pool[weightedIndex(rng, pool.map((event) => event.weight))]!;
}

/** Revalidation for departing on an edge (#159): no battle, no journey,
 * then the ONE departure authority (#168) — route identity, current
 * origin, destination unlock, top-level route condition, usable plan.
 * Callback data is never authority. */
export function startJourney(
  player: PlayerState,
  edgeId: string,
  rng: Rng = defaultRng,
  telemetry?: JourneyTelemetry,
): JourneyStart {
  if (player.dungeonRun) return { ok: false, refusal: DUNGEON_BLOCK };
  if (player.battle) return { ok: false, refusal: '⚔️ Finish the fight first.' };
  if (player.journey) return { ok: false, refusal: '🧭 You are already on the road.' };
  const checked = departureCheck(player, edgeId);
  if (!checked.ok) return { ok: false, refusal: checked.refusal };
  const resolved = checked.plan;
  const totalEvents = resolved.eventCount;
  if (totalEvents === 0) {
    // A zero-event edge is an immediate, welcoming crossing — the same
    // arrival authority, just without a persisted journey.
    return { ok: true, step: { kind: 'arrived', lines: arriveAt(player, resolved.to) } };
  }
  const journey: JourneyState = {
    edgeId: resolved.edgeId,
    variantId: resolved.variantId,
    fromZone: resolved.from,
    toZone: resolved.to,
    completedEvents: 0,
    totalEvents,
    plan: [...resolved.events],
    report: [],
  };
  player.journey = journey;
  return { ok: true, step: advanceJourney(player, rng, telemetry) };
}

/** Continues the active journey: resolves the next rolls in order,
 * stopping at a battle, and performs the final arrival when the last roll
 * completes. Never rerolls completed events; stale/double taps are
 * rejected upstream by the revision guard and the battle/journey guards
 * here. */
export function advanceJourney(
  player: PlayerState,
  rng: Rng = defaultRng,
  telemetry?: JourneyTelemetry,
): JourneyStep {
  const journey = player.journey;
  if (!journey) return { kind: 'progress', lines: ['You are not on the road.'] };
  if (player.battle) return { kind: 'progress', lines: ['⚔️ Finish the fight first.'] };
  const report: string[] = [...journey.report];
  while (journey.completedEvents < journey.totalEvents) {
    const index = journey.completedEvents;
    const ev = rollEvent(journey.plan, player.level, rng);
    if (ev.kind === 'battle') {
      const started = startBattle(ev.enemy, {
        kind: 'travel',
        zoneId: journey.fromZone,
        edgeId: journey.edgeId,
        eventIndex: index,
      }, { player, rng });
      if (started) {
        // The fight is attached immediately: a paused crossing is ALWAYS a
        // journey + travel-battle pair, never a half-state (#159).
        player.battle = started.battle;
        // The road PRESENTED a fight — the roll is spent on it (#169):
        // the battle record emits here, at its resolution point, never
        // from rendered prose.
        telemetry?.({
          edgeId: journey.edgeId,
          index,
          kind: 'battle',
          enemy: ev.enemy,
        });
        // A battle event consumes its roll only at its completion point —
        // victory (or an opening-terminal adjudication) marks it below;
        // the journey stays paused with the roll pending at `index`.
        journey.report = report;
        return {
          kind: 'battle',
          battle: started.battle,
          outcome: started.outcome,
          line: `${enemyDef(ev.enemy)?.emoji ?? '❔'} On the road: a ${
            enemyDef(ev.enemy)?.name ?? ev.enemy
          } bars the way!`,
        };
      }
      // An unresolvable enemy is a content fault — never eat the roll on
      // it; treat the crossing as quiet and move on (integrity tests make
      // this unreachable for authored content).
      report.push('The road is quiet.');
      journey.completedEvents = index + 1;
      continue;
    }
    const resolved = applyQuietEvent(player, ev, rng);
    report.push(...resolved.lines);
    telemetry?.({
      edgeId: journey.edgeId,
      index,
      kind: ev.kind,
      ...(resolved.granted.length > 0 ? { granted: resolved.granted } : {}),
    });
    journey.completedEvents = index + 1;
  }
  // All rolls consumed — final arrival, exactly once.
  player.journey = undefined;
  const arrivalLines = arriveAt(player, journey.toZone);
  return { kind: 'arrived', lines: [...report, ...arrivalLines] };
}

/** Marks the pending travel event complete after its battle is WON. The
 * single completion point for battle events (#160 owns the caller). */
export function completeTravelBattleEvent(player: PlayerState): void {
  const journey = player.journey;
  const battle = player.battle;
  if (!journey || !battle || battle.origin.kind !== 'travel') return;
  if (
    battle.origin.edgeId !== journey.edgeId || battle.origin.eventIndex !== journey.completedEvents
  ) return;
  journey.completedEvents = journey.completedEvents + 1;
}

/** Retreat from the journey intermission (#160 semantics): aborts the
 * edge, returns to the ORIGIN (where the player already is), keeps
 * already-earned rewards, rolls no return events. */
export function retreatFromJourney(player: PlayerState): string[] {
  const journey = player.journey;
  if (!journey || player.battle) return ['There is no crossing to abandon.'];
  player.journey = undefined;
  const originZone = zone(journey.fromZone);
  return [
    `🧭 You turn back. The road to ${
      zone(journey.toZone)?.name ?? journey.toZone
    } keeps for another day.`,
    originZone?.desc ?? '',
  ]
    .filter((line) => line.length > 0);
}

/** A journey's headline: origin → destination with progress. */
export function journeyLine(journey: JourneyState): string {
  const from = zone(journey.fromZone);
  const to = zone(journey.toZone);
  return `${from?.emoji ?? ''} ${from?.name ?? journey.fromZone} → ${to?.emoji ?? ''} ${
    to?.name ?? journey.toZone
  } — ${journey.completedEvents}/${journey.totalEvents} events`;
}
