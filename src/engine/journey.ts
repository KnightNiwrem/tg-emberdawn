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

import type { BattleState, JourneyState, PlayerState } from './types.ts';
import type { TravelEvent } from '../content/types.ts';
import { zone } from '../content/zones.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { itemName } from '../content/items.ts';
import { type BattleOutcome, startBattle } from './combat.ts';
import { statsOf } from './character.ts';
import { grantItem, questReadyLine } from './quests.ts';
import { defaultRng, randInt, type Rng, weightedIndex } from './rng.ts';
import { arriveAt, encounterEligible } from './world.ts';
import { grantContextualDrops, rollDropTable } from './loot.ts';
import { departureCheck } from './routes.ts';

/** One coordinator result: what the handler should show next. */
export type JourneyStep =
  | { kind: 'battle'; battle: BattleState; outcome: BattleOutcome; line: string }
  | { kind: 'progress'; lines: string[] }
  | { kind: 'arrived'; lines: string[] };

/** Refusals carry a player-facing line; they never mutate. */
export type JourneyStart =
  | { ok: true; step: JourneyStep }
  | { ok: false; refusal: string };

/** The journey owns the interaction flow (#166): while a crossing is
 * live, every zone-bound interaction — NPC/dialogue, quest business,
 * explore, dungeon, shop and forge — is refused with this line, both at
 * the central engine mutations and at the handler entry points (defense
 * in depth). Navigation and the journey's own controls stay open. */
export const JOURNEY_BLOCK = '🧭 Finish the crossing first.';

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
export type JourneyTelemetry = (e: JourneyEventRecord) => void;

/** The event pool eligible for the NEXT roll at the player's level:
 * battle events honor authored level bands (#73 rule), everything else
 * always rolls. */
function eligiblePool(events: readonly TravelEvent[], level: number): TravelEvent[] {
  return events.filter((e) => encounterEligible(e, level));
}

function rollEvent(events: readonly TravelEvent[], level: number, rng: Rng): TravelEvent {
  const pool = eligiblePool(events, level);
  if (pool.length === 0) {
    // Integrity forbids an empty table for a nonzero count; this is the
    // belt-and-braces fallback so a roll is never lost.
    return { kind: 'flavor', weight: 1, text: 'The road is quiet.' };
  }
  return pool[weightedIndex(rng, pool.map((e) => e.weight))]!;
}

/** Resolves ONE non-interactive event exactly once; returns its lines and
 * the structured list of items it granted. Battle events never reach here. */
function applyQuietEvent(
  p: PlayerState,
  ev: TravelEvent,
  rng: Rng,
): { lines: string[]; granted: string[] } {
  switch (ev.kind) {
    case 'flavor':
      return { lines: [`${ev.text}`], granted: [] };
    case 'rest': {
      const s = statsOf(p);
      const healHp = Math.floor(s.maxHp * ev.healPct);
      const healMp = Math.floor(s.maxMp * ev.healPct);
      p.hp = Math.min(s.maxHp, p.hp + healHp);
      p.mp = Math.min(s.maxMp, p.mp + healMp);
      return {
        lines: [`🌙 ${ev.text}`, `💚 +${healHp} HP · 💧 +${healMp} MP`],
        granted: [],
      };
    }
    case 'treasure': {
      const lines = [`✨ ${ev.text}`];
      const granted: string[] = [];
      if (ev.gold) {
        const g = randInt(rng, Math.floor(ev.gold * 0.8), Math.ceil(ev.gold * 1.3));
        p.gold += g;
        lines.push(`💰 +${g} gold`);
      }
      if (ev.item) {
        lines.push(`🎁 Found: ${itemName(ev.item)}`);
        granted.push(ev.item);
        for (const qid of grantItem(p, ev.item, 1)) lines.push(questReadyLine(qid));
      }
      if (ev.dropTable) {
        // Contextual route resources (#158) through the ONE shared grant
        // site — quest-kind drops stay relevance-filtered (#165). The
        // granted ids are the STRUCTURED grant (#169).
        const rolled = grantContextualDrops(p, rollDropTable(ev.dropTable, rng));
        lines.push(...rolled.lines);
        granted.push(...rolled.granted);
      }
      return { lines, granted };
    }
    default:
      return { lines: ['The road is quiet.'], granted: [] };
  }
}

/** Revalidation for departing on an edge (#159): no battle, no journey,
 * then the ONE departure authority (#168) — route identity, current
 * origin, destination unlock, top-level route condition, usable plan.
 * Callback data is never authority. */
export function startJourney(
  p: PlayerState,
  edgeId: string,
  rng: Rng = defaultRng,
  telemetry?: JourneyTelemetry,
): JourneyStart {
  if (p.battle) return { ok: false, refusal: '⚔️ Finish the fight first.' };
  if (p.journey) return { ok: false, refusal: '🧭 You are already on the road.' };
  const checked = departureCheck(p, edgeId);
  if (!checked.ok) return { ok: false, refusal: checked.refusal };
  const resolved = checked.plan;
  const totalEvents = resolved.eventCount;
  if (totalEvents === 0) {
    // A zero-event edge is an immediate, welcoming crossing — the same
    // arrival authority, just without a persisted journey.
    return { ok: true, step: { kind: 'arrived', lines: arriveAt(p, resolved.to) } };
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
  p.journey = journey;
  return { ok: true, step: advanceJourney(p, rng, telemetry) };
}

/** Continues the active journey: resolves the next rolls in order,
 * stopping at a battle, and performs the final arrival when the last roll
 * completes. Never rerolls completed events; stale/double taps are
 * rejected upstream by the revision guard and the battle/journey guards
 * here. */
export function advanceJourney(
  p: PlayerState,
  rng: Rng = defaultRng,
  telemetry?: JourneyTelemetry,
): JourneyStep {
  const j = p.journey;
  if (!j) return { kind: 'progress', lines: ['You are not on the road.'] };
  if (p.battle) return { kind: 'progress', lines: ['⚔️ Finish the fight first.'] };
  const report: string[] = [...j.report];
  while (j.completedEvents < j.totalEvents) {
    const index = j.completedEvents;
    const ev = rollEvent(j.plan, p.level, rng);
    if (ev.kind === 'battle') {
      const started = startBattle(ev.enemy, {
        kind: 'travel',
        zoneId: j.fromZone,
        edgeId: j.edgeId,
        eventIndex: index,
      }, { player: p, rng });
      if (started) {
        // The fight is attached immediately: a paused crossing is ALWAYS a
        // journey + travel-battle pair, never a half-state (#159).
        p.battle = started.battle;
        // The road PRESENTED a fight — the roll is spent on it (#169):
        // the battle record emits here, at its resolution point, never
        // from rendered prose.
        telemetry?.({
          edgeId: j.edgeId,
          index,
          kind: 'battle',
          enemy: ev.enemy,
        });
        // A battle event consumes its roll only at its completion point —
        // victory (or an opening-terminal adjudication) marks it below;
        // the journey stays paused with the roll pending at `index`.
        j.report = report;
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
      j.completedEvents = index + 1;
      continue;
    }
    const resolved = applyQuietEvent(p, ev, rng);
    report.push(...resolved.lines);
    telemetry?.({
      edgeId: j.edgeId,
      index,
      kind: ev.kind,
      ...(resolved.granted.length > 0 ? { granted: resolved.granted } : {}),
    });
    j.completedEvents = index + 1;
  }
  // All rolls consumed — final arrival, exactly once.
  p.journey = undefined;
  const arrivalLines = arriveAt(p, j.toZone);
  return { kind: 'arrived', lines: [...report, ...arrivalLines] };
}

/** Marks the pending travel event complete after its battle is WON. The
 * single completion point for battle events (#160 owns the caller). */
export function completeTravelBattleEvent(p: PlayerState): void {
  const j = p.journey;
  const b = p.battle;
  if (!j || !b || b.origin.kind !== 'travel') return;
  if (b.origin.edgeId !== j.edgeId || b.origin.eventIndex !== j.completedEvents) return;
  j.completedEvents = j.completedEvents + 1;
}

/** Retreat from the journey intermission (#160 semantics): aborts the
 * edge, returns to the ORIGIN (where the player already is), keeps
 * already-earned rewards, rolls no return events. */
export function retreatFromJourney(p: PlayerState): string[] {
  const j = p.journey;
  if (!j || p.battle) return ['There is no crossing to abandon.'];
  p.journey = undefined;
  const z = zone(j.fromZone);
  return [
    `🧭 You turn back. The road to ${zone(j.toZone)?.name ?? j.toZone} keeps for another day.`,
    z?.desc ?? '',
  ]
    .filter((l) => l.length > 0);
}

/** A journey's headline: origin → destination with progress. */
export function journeyLine(j: JourneyState): string {
  const from = zone(j.fromZone);
  const to = zone(j.toZone);
  return `${from?.emoji ?? ''} ${from?.name ?? j.fromZone} → ${to?.emoji ?? ''} ${
    to?.name ?? j.toZone
  } — ${j.completedEvents}/${j.totalEvents} events`;
}
