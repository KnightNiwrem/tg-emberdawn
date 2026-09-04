/**
 * Shop economy (#161): location-scoped shops with authored stock rules.
 * Pure over PlayerState. Rendering is never authorization — every buy and
 * sell re-resolves the CURRENT zone's shop and its CURRENT offering at
 * mutation time, so a forged or stale callback can never purchase (or
 * pawn) what the shelf does not carry.
 *
 * Safety and services are orthogonal: shop presence is authored per zone
 * (content/facilities.ts), never derived from `safeHaven`, and battles
 * forbid all trade.
 */

import type { PlayerState } from './types.ts';
import type { ShopDef } from '../content/types.ts';
import { shopInZone } from '../content/facilities.ts';
import { isEquippable, item, itemName, sellPrice } from '../content/items.ts';
import { removeItem } from './inventory.ts';
import { grantItem, questReadyLine } from './quests.ts';
import { evalCondition } from './conditions.ts';

/** One resolvable shelf entry: the item and the price THIS shop charges
 * for it (authored local price rules included). */
export interface ShopOffering {
  itemId: string;
  price: number;
}

/** The shop authored at the player's current zone, if any. */
export function shopAt(p: PlayerState): ShopDef | undefined {
  return shopInZone(p.currentZone);
}

/** Resolves the shop's CURRENT shelf for THIS shopper (#161): authored
 * rules in order, condition-gated groups included, gear re-filtered to
 * the shopper's class and level (#22) so every shelved purchase is
 * immediately usable. First sighting of an item wins its price. */
export function resolveStock(p: PlayerState, at?: ShopDef): ShopOffering[] {
  const def = at ?? shopAt(p);
  if (!def) return [];
  const out: ShopOffering[] = [];
  const seen = new Set<string>();
  for (const rule of def.stock) {
    if (rule.when && !evalCondition(p, rule.when)) continue;
    const pct = rule.pricePct ?? 1;
    for (const id of rule.items) {
      if (seen.has(id)) continue;
      const d = item(id);
      if (!d) continue;
      // The shelf only offers what THIS shopper can use (#22/#6).
      if (
        (d.kind === 'weapon' || d.kind === 'armor' || d.kind === 'trinket') &&
        !isEquippable(id, p.classId, p.level).ok
      ) {
        continue;
      }
      seen.add(id);
      out.push({ itemId: id, price: Math.max(1, Math.round(d.price * pct)) });
    }
  }
  return out;
}

/** The resolved price of an item at the current shop, or undefined when
 * the current shelf does not carry it. */
export function offeredPrice(p: PlayerState, itemId: string): number | undefined {
  return resolveStock(p).find((o) => o.itemId === itemId)?.price;
}

export function buy(p: PlayerState, itemId: string, qty = 1): { ok: boolean; lines: string[] } {
  // A fight in front of you forbids the counter (#161): no battle or
  // active journey may open trade.
  if (p.battle) return { ok: false, lines: ['⚔️ Finish the fight first.'] };
  const def = item(itemId);
  if (!def) return { ok: false, lines: ['The shopkeeper blinks. "Never heard of it."'] };
  // Server-side authority (#161): the offering is re-resolved from the
  // CURRENT zone and live progression — a rendered slot or callback id is
  // never authority.
  const offering = resolveStock(p).find((o) => o.itemId === itemId);
  if (!offering) return { ok: false, lines: ['"Not stocking that today."'] };
  // Defense in depth (#22): the shelf is already class/level-filtered, but
  // the counter revalidates before charging — a purchase can never hand
  // over gear the buyer cannot equip.
  if (
    (def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'trinket') &&
    !isEquippable(itemId, p.classId, p.level).ok
  ) {
    return { ok: false, lines: ['"You could not use that, friend."'] };
  }
  const cost = offering.price * qty;
  if (p.gold < cost) return { ok: false, lines: ['💰 Not enough gold.'] };
  p.gold -= cost;
  const lines = [
    `🛒 Bought ${def.name}${qty > 1 ? ` ×${qty}` : ''} for ${cost} gold.`,
  ];
  for (const qid of grantItem(p, itemId, qty)) lines.push(questReadyLine(qid));
  return { ok: true, lines };
}

/** Selling follows an explicit locality rule (#161): a present, currently
 * usable shop at the player's zone. No shop — no sale; the generic
 * inventory no longer sells at all (dropping remains a bag operation). */
export function sell(p: PlayerState, itemId: string, qty = 1): { ok: boolean; lines: string[] } {
  // Same locality authority as buying (#161): a fight forbids trade.
  if (p.battle) return { ok: false, lines: ['⚔️ Finish the fight first.'] };
  const def = item(itemId);
  if (!def) return { ok: false, lines: ["That item doesn't exist."] };
  if (def.unique) return { ok: false, lines: ["🚫 That can't be sold."] };
  if (!shopAt(p)) return { ok: false, lines: ['💱 No merchant here would buy that.'] };
  if (!removeItem(p, itemId, qty)) return { ok: false, lines: ["You don't have that many."] };
  const gain = sellPrice(itemId) * qty;
  p.gold += gain;
  return {
    ok: true,
    lines: [`💱 Sold ${itemName(itemId)}${qty > 1 ? ` ×${qty}` : ''} for ${gain} gold.`],
  };
}
