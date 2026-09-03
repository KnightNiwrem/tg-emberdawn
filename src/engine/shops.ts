/** Shop economy: buying and selling. Pure over PlayerState. */

import type { PlayerState } from './types.ts';
import type { ZoneDef } from '../content/types.ts';
import { isEquippable, item, itemName, sellPrice, shopStock } from '../content/items.ts';
import { removeItem } from './inventory.ts';
import { grantItem, questReadyLine } from './quests.ts';
import { zone } from '../content/zones.ts';

/** Shop gear tier follows the PLAYER's level, clamped to the zone's band,
 * so stock rises as you level instead of lagging a chapter behind — and
 * the Abyss (level 45) finally stocks tier-8 gear. Item tier t is legal at
 * level 1 + (t-1)*6. */
export function tierForLevel(level: number): number {
  return Math.min(8, Math.floor((level - 1) / 6) + 1);
}

/** Pure tier resolution (#74): the shop tier a zone offers a hero of
 * `level` — the level tier clamped into the zone's band. One rule shared
 * by the live shop and the harness's stock planning. */
export function shopTierForZone(z: ZoneDef, level: number): number {
  const loTier = Math.min(8, Math.floor((z.levels[0] - 1) / 6) + 1);
  const hiTier = Math.min(8, Math.floor((z.levels[1] - 1) / 6) + 1);
  return Math.min(hiTier, Math.max(loTier, tierForLevel(level)));
}

function shopTierFor(p: PlayerState): number {
  const z = zone(p.currentZone);
  if (!z) return tierForLevel(p.level);
  // The band clamp still governs the SHOP's identity (consumables and
  // materials are always usable, so the local tier is pure flavor). Gear
  // usability is NOT decided here anymore: shopStock filters every shelved
  // piece against the shopper's class and level, so the old clamp-up can
  // no longer bait a low-level traveler with level-locked gear (#22).
  return shopTierForZone(z, p.level);
}

export function currentStock(p: PlayerState): string[] {
  // Player level gates what's on the shelf (#6): nothing unequippable is
  // offered, so a purchase is always immediately usable.
  return shopStock(p.currentZone, shopTierFor(p), { level: p.level, classId: p.classId });
}

export function buy(p: PlayerState, itemId: string, qty = 1): { ok: boolean; lines: string[] } {
  const def = item(itemId);
  if (!def) return { ok: false, lines: ['The shopkeeper blinks. "Never heard of it."'] };
  if (!currentStock(p).includes(itemId)) {
    return { ok: false, lines: ['"Not stocking that today."'] };
  }
  // Defense in depth (#22): the shelf is already class/level-filtered, but
  // the counter revalidates before charging — a purchase can never hand
  // over gear the buyer cannot equip.
  if (
    (def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'trinket') &&
    !isEquippable(itemId, p.classId, p.level).ok
  ) {
    return { ok: false, lines: ['"You could not use that, friend."'] };
  }
  const cost = def.price * qty;
  if (p.gold < cost) return { ok: false, lines: ['💰 Not enough gold.'] };
  p.gold -= cost;
  const lines = [`🛒 Bought ${def.name}${qty > 1 ? ` ×${qty}` : ''} for ${cost} gold.`];
  for (const qid of grantItem(p, itemId, qty)) lines.push(questReadyLine(qid));
  return { ok: true, lines };
}

export function sell(p: PlayerState, itemId: string, qty = 1): { ok: boolean; lines: string[] } {
  const def = item(itemId);
  if (!def) return { ok: false, lines: ["That item doesn't exist."] };
  if (def.unique) return { ok: false, lines: ["🚫 That can't be sold."] };
  if (!removeItem(p, itemId, qty)) return { ok: false, lines: ["You don't have that many."] };
  const gain = sellPrice(itemId) * qty;
  p.gold += gain;
  return {
    ok: true,
    lines: [`💱 Sold ${itemName(itemId)}${qty > 1 ? ` ×${qty}` : ''} for ${gain} gold.`],
  };
}
