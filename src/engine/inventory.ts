/** Inventory operations. Pure helpers over PlayerState. */

import type { PlayerState } from './types.ts';
import { item } from '../content/items.ts';

export function countOf(player: PlayerState, itemId: string): number {
  return player.inventory.find((entry) => entry.id === itemId)?.qty ?? 0;
}

export function addItem(player: PlayerState, itemId: string, qty = 1): void {
  if (qty <= 0) return;
  const entry = player.inventory.find((entry) => entry.id === itemId);
  if (entry) entry.qty += qty;
  else player.inventory.push({ id: itemId, qty });
}

export function removeItem(player: PlayerState, itemId: string, qty = 1): boolean {
  const entry = player.inventory.find((entry) => entry.id === itemId);
  if (!entry || entry.qty < qty) return false;
  entry.qty -= qty;
  if (entry.qty <= 0) player.inventory = player.inventory.filter((entry) => entry.id !== itemId);
  return true;
}

export function grantDropRewards(player: PlayerState, drops: string[]): string[] {
  const lines: string[] = [];
  for (const id of drops) {
    addItem(player, id, 1);
    lines.push(`🎁 Loot: ${item(id)?.name ?? id}`);
  }
  return lines;
}

export function consumables(player: PlayerState): { id: string; name: string; qty: number }[] {
  return player.inventory
    .filter((entry) => item(entry.id)?.kind === 'consumable')
    .map((entry) => ({ id: entry.id, name: item(entry.id)?.name ?? entry.id, qty: entry.qty }));
}
