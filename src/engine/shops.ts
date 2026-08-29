/** Shop economy: buying and selling. Pure over PlayerState. */

import type { PlayerState } from './types.ts';
import { item, itemName, sellPrice, shopStock } from '../content/items.ts';
import { addItem, removeItem } from './inventory.ts';
import { onItemGain } from './quests.ts';
import { quest } from '../content/quests.ts';
import { zone } from '../content/zones.ts';

/** Shop gear tier follows the PLAYER's level, clamped to the zone's band,
 * so stock rises as you level instead of lagging a chapter behind — and
 * the Abyss (level 45) finally stocks tier-8 gear. Item tier t is legal at
 * level 1 + (t-1)*6. */
export function shopTierFor(p: PlayerState): number {
  const levelTier = Math.min(8, Math.floor(p.level / 6) + 1);
  const z = zone(p.currentZone);
  if (!z) return levelTier;
  const loTier = Math.min(8, Math.floor((z.levels[0] - 1) / 6) + 1);
  const hiTier = Math.min(8, Math.floor((z.levels[1] - 1) / 6) + 1);
  return Math.min(hiTier, Math.max(loTier, levelTier));
}

export function currentStock(p: PlayerState): string[] {
  return shopStock(p.currentZone, shopTierFor(p));
}

export function buy(p: PlayerState, itemId: string, qty = 1): { ok: boolean; lines: string[] } {
  const def = item(itemId);
  if (!def) return { ok: false, lines: ['The shopkeeper blinks. "Never heard of it."'] };
  if (!currentStock(p).includes(itemId)) {
    return { ok: false, lines: ['"Not stocking that today."'] };
  }
  const cost = def.price * qty;
  if (p.gold < cost) return { ok: false, lines: ['💰 Not enough gold.'] };
  p.gold -= cost;
  addItem(p, itemId, qty);
  const lines = [`🛒 Bought ${def.name}${qty > 1 ? ` ×${qty}` : ''} for ${cost} gold.`];
  for (const qid of onItemGain(p)) {
    lines.push(`📜 “${quest(qid)?.name ?? qid}” is ready to turn in!`);
  }
  return { ok: true, lines };
}

export function sell(p: PlayerState, itemId: string, qty = 1): { ok: boolean; lines: string[] } {
  const def = item(itemId);
  if (!def) return { ok: false, lines: ["That item doesn't exist."] };
  if (def.unique) return { ok: false, lines: ["🚫 Quest items can't be sold."] };
  if (!removeItem(p, itemId, qty)) return { ok: false, lines: ["You don't have that many."] };
  const gain = sellPrice(itemId) * qty;
  p.gold += gain;
  return {
    ok: true,
    lines: [`💱 Sold ${itemName(itemId)}${qty > 1 ? ` ×${qty}` : ''} for ${gain} gold.`],
  };
}
