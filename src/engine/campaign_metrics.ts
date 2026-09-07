/** Observational travel accounting; these functions never alter gameplay or draw RNG. */
import type { JourneyEventRecord } from './journey.ts';

/** Aggregates the campaign's actual journeys from structured telemetry. */
export interface TravelMetrics {
  /** Departures per edge id. */
  edgeAttempts: Record<string, number>;
  /** Successful final arrivals per edge id. */
  edgeArrivals: Record<string, number>;
  /** Resolved road events by structured kind (flavor/rest/treasure/
   * battle) across every road the sim walked — one count per resolved
   * roll, exactly once. Battle records emit when the road PRESENTS a
   * fight, so this sum can never be lower than `travelBattles`. */
  eventOutcomes: Record<string, number>;
  /** Resolved event composition for each road. */
  eventOutcomesByEdge: Record<string, Record<string, number>>;
  /** Road fights and the rounds they took. */
  travelBattles: number;
  travelRounds: number;
  /** Deaths and successful flee-escapes on roads. */
  roadDeaths: number;
  roadFlees: number;
  /** Granted contextual items from journey records and victory rewards. */
  contextualDrops: number;
  /** Sums of HP/MP fractions sampled before each arrival's potential haven heal. */
  hpArrivalSumPct: number;
  mpArrivalSumPct: number;
  /** Finalized means over arrivalSamples, in [0,1]. */
  hpPctOnArrival: number;
  mpPctOnArrival: number;
  arrivalSamples: number;
  /** Total resolved road events, derived from eventOutcomes. */
  totalRoadEvents: number;
}

export function createTravelMetrics(): TravelMetrics {
  return {
    edgeAttempts: {},
    edgeArrivals: {},
    eventOutcomes: {},
    eventOutcomesByEdge: {},
    travelBattles: 0,
    travelRounds: 0,
    roadDeaths: 0,
    roadFlees: 0,
    contextualDrops: 0,
    hpArrivalSumPct: 0,
    mpArrivalSumPct: 0,
    hpPctOnArrival: 0,
    mpPctOnArrival: 0,
    arrivalSamples: 0,
    totalRoadEvents: 0,
  };
}

export function recordJourneyEvent(metrics: TravelMetrics, event: JourneyEventRecord): void {
  metrics.eventOutcomes[event.kind] = (metrics.eventOutcomes[event.kind] ?? 0) + 1;
  const byEdge = metrics.eventOutcomesByEdge[event.edgeId] ??= {};
  byEdge[event.kind] = (byEdge[event.kind] ?? 0) + 1;
  if (event.granted?.length) metrics.contextualDrops += event.granted.length;
}

/** Sample before arrival: a haven's automatic heal must not hide road attrition. */
export function recordTravelArrival(
  metrics: TravelMetrics,
  edgeId: string,
  condition: { hp: number; mp: number; maxHp: number; maxMp: number },
): void {
  metrics.edgeArrivals[edgeId] = (metrics.edgeArrivals[edgeId] ?? 0) + 1;
  metrics.hpArrivalSumPct += condition.maxHp > 0 ? condition.hp / condition.maxHp : 0;
  metrics.mpArrivalSumPct += condition.maxMp > 0 ? condition.mp / condition.maxMp : 0;
  metrics.arrivalSamples++;
}

export function finalizeTravelMetrics(metrics: TravelMetrics): void {
  metrics.totalRoadEvents = Object.values(metrics.eventOutcomes).reduce(
    (sum, count) => sum + count,
    0,
  );
  metrics.hpPctOnArrival = metrics.arrivalSamples > 0
    ? metrics.hpArrivalSumPct / metrics.arrivalSamples
    : 0;
  metrics.mpPctOnArrival = metrics.arrivalSamples > 0
    ? metrics.mpArrivalSumPct / metrics.arrivalSamples
    : 0;
}
