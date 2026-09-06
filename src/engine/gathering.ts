/** Bounded gathering, with location and inventory authority in the engine. */
import {
  type GatheringActivity,
  type GatheringSite,
  gatheringSites,
} from '../content/gathering.ts';
import { itemName } from '../content/items.ts';
import { countOf, removeItem } from './inventory.ts';
import { grantItem, questReadyLine } from './quests.ts';
import { defaultRng, randInt, type Rng, weightedIndex } from './rng.ts';
import { JOURNEY_BLOCK } from './routes.ts';
import type { PlayerState } from './types.ts';

export const GATHERING_CHARGES = 3;
export const GATHERING_COOLDOWN_MS = 6 * 3_600_000;

export interface GatheringOption extends GatheringSite {
  remaining: number;
  resetAt?: number;
  requirements: string;
}

/** Pure projection. A renderer omits now and sees stored depletion; only
 * an action supplies time to recheck an elapsed recharge. No clock reads. */
export function gatheringOptions(p: PlayerState, now?: number): GatheringOption[] {
  const used = p.flags[`gather_${p.currentZone}`];
  const reset = p.flags[`gatherReset_${p.currentZone}`];
  const resetAt = typeof reset === 'number' ? reset : undefined;
  const refreshed = now !== undefined && resetAt !== undefined && now >= resetAt;
  const remaining = refreshed
    ? GATHERING_CHARGES
    : Math.max(0, GATHERING_CHARGES - (typeof used === 'number' ? used : 0));
  return gatheringSites(p.currentZone).map((site) => ({
    ...site,
    remaining,
    ...(resetAt !== undefined && !refreshed ? { resetAt } : {}),
    requirements: [
      site.tool ? `${itemName(site.tool)} (reusable)` : 'No tool needed',
      ...(site.baitTables
        ? [`1 bait per cast: ${Object.keys(site.baitTables).map(itemName).join(' / ')}`]
        : []),
    ].join(' · '),
  }));
}

/** Bait is an untrusted selection, never authority over the catch table. */
export function gather(
  p: PlayerState,
  activity: GatheringActivity,
  rng: Rng = defaultRng,
  now: number = Date.now(),
  baitId?: string,
): { ok: boolean; lines: string[] } {
  const refuse = (line: string) => ({ ok: false, lines: [line] });
  if (p.battle) return refuse('⚔️ Finish the fight before gathering.');
  if (p.journey) return refuse(JOURNEY_BLOCK);
  const site = gatheringOptions(p, now).find((s) => s.activity === activity);
  if (!site) return refuse('That gathering activity is unavailable here.');
  if (site.remaining <= 0) {
    const minutes = Math.max(1, Math.ceil(((site.resetAt ?? now) - now) / 60_000));
    return refuse(`The gathering sites here need time to recover. Return in ${minutes} min.`);
  }
  if (site.tool && countOf(p, site.tool) < 1) {
    return refuse(`Bring a ${itemName(site.tool)} in your bag to ${activity} here.`);
  }
  let pool = site.yields;
  let bait: string | undefined;
  if (site.baitTables) {
    bait = baitId ?? Object.keys(site.baitTables).find((id) => countOf(p, id) > 0);
    if (!bait || !Object.hasOwn(site.baitTables, bait)) {
      return refuse(
        `Bring fishing bait: ${Object.keys(site.baitTables).map(itemName).join(' or ')}.`,
      );
    }
    if (countOf(p, bait) < 1) return refuse(`You need 1 ${itemName(bait)} for this cast.`);
    pool = site.baitTables[bait]!;
  } else if (baitId !== undefined) {
    return refuse('Bait is only used for fishing.');
  }
  const drop = pool[weightedIndex(rng, pool.map((entry) => entry.weight))];
  if (!drop) return refuse('There is nothing to gather here yet.');
  const qty = randInt(rng, drop.min, drop.max);
  // All refusals precede spending: changing tools, bait, zones or activities
  // cannot refresh the shared local allowance.
  if (bait) removeItem(p, bait, 1);
  const used = GATHERING_CHARGES - site.remaining + 1;
  p.flags[`gather_${p.currentZone}`] = used;
  delete p.flags[`gatherReset_${p.currentZone}`];
  if (used === GATHERING_CHARGES) {
    p.flags[`gatherReset_${p.currentZone}`] = now + GATHERING_COOLDOWN_MS;
  }
  const ready = grantItem(p, drop.item, qty);
  return {
    ok: true,
    lines: [
      site.text,
      ...(bait ? [`Used: 1 × ${itemName(bait)}.`] : []),
      `Gathered: ${qty} × ${itemName(drop.item)}.`,
      `Gathering remaining here: ${GATHERING_CHARGES - used}/${GATHERING_CHARGES}.` +
      (used === GATHERING_CHARGES ? ' Recharges in 6 hours.' : ''),
      ...ready.map(questReadyLine),
    ],
  };
}
