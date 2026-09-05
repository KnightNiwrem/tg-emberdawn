/**
 * World-route resolution (#158): which edges a player can depart on, and
 * which crossing plan is active. Pure over PlayerState + the authored
 * route catalog — no Telegram, no clock, no ambient randomness.
 *
 * The resolved plan is the snapshot a journey persists (#159): once a
 * crossing starts, its edge id + resolved variant plan are authoritative
 * for the whole crossing, so a mid-road condition change can never
 * rewrite the crossing in progress.
 */

import type { RouteDef, TravelEvent } from '../content/types.ts';
import { route as edgeRoute, routesBetween, routesFrom } from '../content/routes.ts';
import { evalCondition } from './conditions.ts';
import type { PlayerState } from './types.ts';

/** The resolved crossing plan for a route: which variant applies, how many
 * forced event rolls the crossing carries, and which table supplies them.
 * `variantId: 'base'` marks the unmodified base plan. */
export interface ResolvedRoute {
  edgeId: string;
  variantId: string;
  from: string;
  to: string;
  eventCount: number;
  events: readonly TravelEvent[];
  name?: string;
  desc?: string;
  risk?: import('../content/types.ts').RouteRisk;
}

/** First-match variant selection in AUTHORED order; the base plan is
 * always the fallback. Pure and deterministic. */
export function resolveRoute(p: PlayerState, r: RouteDef): ResolvedRoute {
  const variant = (r.variants ?? []).find((v) => !v.when || evalCondition(p, v.when));
  if (!variant) {
    return {
      edgeId: r.id,
      variantId: 'base',
      from: r.from,
      to: r.to,
      eventCount: r.eventCount,
      events: r.events ?? [],
      ...(r.name !== undefined ? { name: r.name } : {}),
      ...(r.desc !== undefined ? { desc: r.desc } : {}),
      ...(r.risk !== undefined ? { risk: r.risk } : {}),
    };
  }
  return {
    edgeId: r.id,
    variantId: variant.id,
    from: r.from,
    to: r.to,
    eventCount: variant.eventCount,
    events: variant.events ?? r.events ?? [],
    ...(variant.name !== undefined
      ? { name: variant.name }
      : r.name !== undefined
      ? { name: r.name }
      : {}),
    ...(variant.desc !== undefined
      ? { desc: variant.desc }
      : r.desc !== undefined
      ? { desc: r.desc }
      : {}),
    ...(variant.risk !== undefined
      ? { risk: variant.risk }
      : r.risk !== undefined
      ? { risk: r.risk }
      : {}),
  };
}

/** Resolved plan of one edge by id — undefined when the edge is unknown. */
export function resolveRouteById(p: PlayerState, edgeId: string): ResolvedRoute | undefined {
  const r = edgeRoute(edgeId);
  return r ? resolveRoute(p, r) : undefined;
}

/** Route availability (#158): the edge's base condition passes and the
 * resolved plan is usable (a nonzero event count resolves to a non-empty
 * table). Destination unlock state is checked by the callers that
 * enumerate or depart. */
export function routeUsable(p: PlayerState, r: RouteDef): boolean {
  return departureCheck(p, r.id).ok;
}

/** The ONE authoritative departure resolver (#168): pure over the live
 * player state. Returns the resolved plan exactly when the player may
 * depart on `edgeId` RIGHT NOW — route identity, current origin,
 * destination unlock, the top-level route condition, and the resolved
 * variant's usable event plan — or the reason they may not. UI
 * enumeration (`usableRoutesFrom`) and `startJourney` BOTH route through
 * it, so the displayed and executable route sets cannot diverge and a
 * forged departure callback for a closed road is refused without
 * mutation or RNG consumption. */
export type DepartureCheck =
  | { ok: true; plan: ResolvedRoute }
  | { ok: false; refusal: string };

export function departureCheck(p: PlayerState, edgeId: string): DepartureCheck {
  const r = edgeRoute(edgeId);
  if (!r) return { ok: false, refusal: "You can't find a road to there." };
  if (r.from !== p.currentZone) {
    return { ok: false, refusal: '🚫 That road does not start here.' };
  }
  if (!p.unlockedZones.includes(r.to)) {
    return { ok: false, refusal: '🚫 That path is still closed to you.' };
  }
  // The top-level route condition (#168): the same gate the travel UI's
  // enumeration applies — a gated road is undepartable from ANY surface
  // while its condition stands, and opens the moment the condition turns
  // true.
  if (r.when && !evalCondition(p, r.when)) {
    return { ok: false, refusal: '🚫 That path is still closed to you.' };
  }
  const plan = resolveRoute(p, r);
  if (plan.eventCount > 0 && plan.events.length === 0) {
    return { ok: false, refusal: '🚫 That road cannot be crossed right now.' };
  }
  return { ok: true, plan };
}

/** Outgoing edges the player could actually depart on RIGHT NOW: authored
 * adjacency from the current zone, an unlocked destination, and currently
 * passing conditions. The travel UI enumerates exactly this — never every
 * unlocked zone. The enumeration IS the departure authority's own filter,
 * so what is displayed is exactly what startJourney will accept. */
export function usableRoutesFrom(p: PlayerState): RouteDef[] {
  return routesFrom(p.currentZone).filter((r) => departureCheck(p, r.id).ok);
}

/** All edges joining two zones in one direction (thin re-export so the
 * engine keeps one import surface for the catalog). */
export { routesBetween };
