/** Carried recovery outside combat; no free resting or facility access. */
import { item } from '../content/items.ts';
import { statsOf } from './character.ts';
import { countOf, removeItem } from './inventory.ts';
import type { PlayerState } from './types.ts';

export function useRecoveryItem(
  player: PlayerState,
  itemId: string,
): { ok: boolean; lines: string[] } {
  const refuse = (line: string) => ({ ok: false, lines: [line] });
  if (player.battle) return refuse('Use combat supplies through the battle menu.');
  const def = item(itemId);
  if (!def || def.kind !== 'consumable') return refuse("Can't use that here.");
  if (countOf(player, itemId) < 1) return refuse("You don't have that.");
  const stats = statsOf(player);
  const hp = Math.max(0, Math.min(stats.maxHp - player.hp, def.effect?.healHp ?? 0));
  const mp = Math.max(0, Math.min(stats.maxMp - player.mp, def.effect?.healMp ?? 0));
  if (!hp && !mp) return refuse('No recovery needed.');
  removeItem(player, itemId, 1);
  player.hp += hp;
  player.mp += mp;
  return {
    ok: true,
    lines: [
      ...(hp ? [`🧪 Restored ${hp} HP.`] : []),
      ...(mp ? [`💧 Restored ${mp} MP.`] : []),
    ],
  };
}
