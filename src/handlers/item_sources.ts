/** Item reference navigation retains the detail scene's item and return context. */
import type { Cb } from '../codec.ts';
import { item } from '../content/items.ts';
import { resolveStock } from '../engine/shops.ts';
import type { PlayerState } from '../engine/types.ts';

export function sourcesAction(
  p: PlayerState,
  cb: Cb & { v: 'sources' | 'uses' },
): { toast?: string } {
  if (p.battle) return { toast: 'Finish the current battle first.' };
  const s = p.scene;
  const id = s.view === 'item'
    ? p.inventory.find((e) => e.id === s.arg && e.qty > 0)?.id
    : s.view === 'equippedItem' && (s.arg === 'weapon' || s.arg === 'armor' || s.arg === 'trinket')
    ? p.equipment[s.arg]
    : s.view === 'shop' && s.arg !== 'sell' && !p.journey && !p.dungeonRun
    ? resolveStock(p).find((o) => o.itemId === s.arg2)?.itemId
    : undefined;
  if (!id || !item(id)) return { toast: 'Open an item detail page first.' };
  if (cb.a === 'bk') {
    if (!s.arg3?.startsWith(`${cb.v}:`)) return {};
    delete s.arg3;
  } else {
    s.arg3 = `${cb.v}:${cb.arg}`;
  }
  return {};
}
