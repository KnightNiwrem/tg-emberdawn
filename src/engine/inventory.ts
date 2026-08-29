/** Inventory operations. Pure helpers over PlayerState. */

import type { PlayerState } from './types.ts';
import { item } from '../content/items.ts';

export function countOf(p: PlayerState, itemId: string): number {
  return p.inventory.find((e) => e.id === itemId)?.qty ?? 0;
}

export function addItem(p: PlayerState, itemId: string, qty = 1): void {
  if (qty <= 0) return;
  const entry = p.inventory.find((e) => e.id === itemId);
  if (entry) entry.qty += qty;
  else p.inventory.push({ id: itemId, qty });
}

export function removeItem(p: PlayerState, itemId: string, qty = 1): boolean {
  const entry = p.inventory.find((e) => e.id === itemId);
  if (!entry || entry.qty < qty) return false;
  entry.qty -= qty;
  if (entry.qty <= 0) p.inventory = p.inventory.filter((e) => e.id !== itemId);
  return true;
}

export function grantDropRewards(p: PlayerState, drops: string[]): string[] {
  const lines: string[] = [];
  for (const id of drops) {
    addItem(p, id, 1);
    lines.push(`🎁 Loot: ${item(id)?.name ?? id}`);
  }
  return lines;
}

export function consumables(p: PlayerState): { id: string; name: string; qty: number }[] {
  return p.inventory
    .filter((e) => item(e.id)?.kind === 'consumable')
    .map((e) => ({ id: e.id, name: item(e.id)?.name ?? e.id, qty: e.qty }));
}
