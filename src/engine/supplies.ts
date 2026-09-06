/** Carried recovery outside combat; no free resting or facility access. */
import { item } from '../content/items.ts';
import { statsOf } from './character.ts';
import { countOf, removeItem } from './inventory.ts';
import type { PlayerState } from './types.ts';

export function useRecoveryItem(p: PlayerState, id: string): { ok: boolean; lines: string[] } {
  const refuse = (line: string) => ({ ok: false, lines: [line] });
  if (p.battle) return refuse('Use combat supplies through the battle menu.');
  const def = item(id);
  if (!def || def.kind !== 'consumable') return refuse("Can't use that here.");
  if (countOf(p, id) < 1) return refuse("You don't have that.");
  const s = statsOf(p);
  const hp = Math.max(0, Math.min(s.maxHp - p.hp, def.effect?.healHp ?? 0));
  const mp = Math.max(0, Math.min(s.maxMp - p.mp, def.effect?.healMp ?? 0));
  if (!hp && !mp) return refuse('No recovery needed.');
  removeItem(p, id, 1);
  p.hp += hp;
  p.mp += mp;
  return {
    ok: true,
    lines: [
      ...(hp ? [`🧪 Restored ${hp} HP.`] : []),
      ...(mp ? [`💧 Restored ${mp} MP.`] : []),
    ],
  };
}
