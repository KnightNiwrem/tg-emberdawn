/** Deterministic path selection; walking and recovery remain with the caller (#182). */

import type { PlayerState } from './types.ts';
import { usableRoutesFrom } from './routes.ts';

/** First shortest path in authored route order. The destination predicate
 * only inspects a zone; this search never travels, heals, rolls, or mutates
 * the hero. Re-evaluate usable routes at each projected origin. */
export function findRoutePath(
  p: PlayerState,
  destination: (zoneId: string) => boolean,
  options: { includeStart?: boolean; maxHops?: number } = {},
): string[] | undefined {
  const queue = [{ zone: p.currentZone, path: [] as string[] }];
  const seen = new Set([p.currentZone]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if ((options.includeStart !== false || current.path.length > 0) && destination(current.zone)) {
      return current.path;
    }
    if (current.path.length >= (options.maxHops ?? Infinity)) continue;
    for (const r of usableRoutesFrom({ ...p, currentZone: current.zone })) {
      if (seen.has(r.to)) continue;
      seen.add(r.to);
      queue.push({ zone: r.to, path: [...current.path, r.id] });
    }
  }
  return undefined;
}
