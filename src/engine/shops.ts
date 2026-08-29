/** Shop economy: buying and selling. Pure over PlayerState. */

import type { PlayerState } from './types.ts';
import { item, itemName, sellPrice, shopStock } from '../content/items.ts';
import { addItem, removeItem } from './inventory.ts';
import { zoneTier } from '../content/zones.ts';

export function currentStock(p: PlayerState): string[] {
  const z = p.currentZone;
  return shopStock(z, zoneTier(z));
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
  return {
    ok: true,
    lines: [`🛒 Bought ${def.name}${qty > 1 ? ` ×${qty}` : ''} for ${cost} gold.`],
  };
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
