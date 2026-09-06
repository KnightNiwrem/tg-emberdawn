/** Deterministic path selection; walking and recovery remain with the caller (#182). */

import type { PlayerState } from './types.ts';
import { usableRoutesFrom } from './routes.ts';

/** First shortest path in authored route order. The destination predicate
 * only inspects a zone; this search never travels, heals, rolls, or mutates
 * the hero. Re-evaluate usable routes at each projected origin. */
export function findRoutePath(
  player: PlayerState,
  destination: (zoneId: string) => boolean,
  options: { includeStart?: boolean; maxHops?: number } = {},
): string[] | undefined {
  const queue = [{ zone: player.currentZone, path: [] as string[] }];
  const seen = new Set([player.currentZone]);
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const current = queue[queueIndex];
    if ((options.includeStart !== false || current.path.length > 0) && destination(current.zone)) {
      return current.path;
    }
    if (current.path.length >= (options.maxHops ?? Infinity)) continue;
    for (const route of usableRoutesFrom({ ...player, currentZone: current.zone })) {
      if (seen.has(route.to)) continue;
      seen.add(route.to);
      queue.push({ zone: route.to, path: [...current.path, route.id] });
    }
  }
  return undefined;
}
