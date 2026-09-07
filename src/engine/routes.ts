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

/** A live crossing owns the interaction flow (#166): zone-bound actions
 * refuse at both engine and handler entry points. Keep the shared refusal
 * here so their guards need no dependency on the journey coordinator. */
export const JOURNEY_BLOCK = '🧭 Finish the crossing first.';

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
export function resolveRoute(player: PlayerState, route: RouteDef): ResolvedRoute {
  const variant = (route.variants ?? []).find((variant) =>
    !variant.when || evalCondition(player, variant.when)
  );
  if (!variant) {
    return {
      edgeId: route.id,
      variantId: 'base',
      from: route.from,
      to: route.to,
      eventCount: route.eventCount,
      events: route.events ?? [],
      ...(route.name !== undefined ? { name: route.name } : {}),
      ...(route.desc !== undefined ? { desc: route.desc } : {}),
      ...(route.risk !== undefined ? { risk: route.risk } : {}),
    };
  }
  return {
    edgeId: route.id,
    variantId: variant.id,
    from: route.from,
    to: route.to,
    eventCount: variant.eventCount,
    events: variant.events ?? route.events ?? [],
    ...(variant.name !== undefined
      ? { name: variant.name }
      : route.name !== undefined
      ? { name: route.name }
      : {}),
    ...(variant.desc !== undefined
      ? { desc: variant.desc }
      : route.desc !== undefined
      ? { desc: route.desc }
      : {}),
    ...(variant.risk !== undefined
      ? { risk: variant.risk }
      : route.risk !== undefined
      ? { risk: route.risk }
      : {}),
  };
}

/** Resolved plan of one edge by id — undefined when the edge is unknown. */
export function resolveRouteById(player: PlayerState, edgeId: string): ResolvedRoute | undefined {
  const route = edgeRoute(edgeId);
  return route ? resolveRoute(player, route) : undefined;
}

/** Route availability (#158): the edge's base condition passes and the
 * resolved plan is usable (a nonzero event count resolves to a non-empty
 * table). Destination unlock state is checked by the callers that
 * enumerate or depart. */
export function routeUsable(player: PlayerState, route: RouteDef): boolean {
  return departureCheck(player, route.id).ok;
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

export function departureCheck(player: PlayerState, edgeId: string): DepartureCheck {
  const route = edgeRoute(edgeId);
  if (!route) return { ok: false, refusal: "You can't find a road to there." };
  if (route.from !== player.currentZone) {
    return { ok: false, refusal: '🚫 That road does not start here.' };
  }
  if (!player.unlockedZones.includes(route.to)) {
    return { ok: false, refusal: '🚫 That path is still closed to you.' };
  }
  // The top-level route condition (#168): the same gate the travel UI's
  // enumeration applies — a gated road is undepartable from ANY surface
  // while its condition stands, and opens the moment the condition turns
  // true.
  if (route.when && !evalCondition(player, route.when)) {
    return { ok: false, refusal: '🚫 That path is still closed to you.' };
  }
  const plan = resolveRoute(player, route);
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
export function usableRoutesFrom(player: PlayerState): RouteDef[] {
  return routesFrom(player.currentZone).filter((route) => departureCheck(player, route.id).ok);
}

/** All edges joining two zones in one direction (thin re-export so the
 * engine keeps one import surface for the catalog). */
export { routesBetween };
