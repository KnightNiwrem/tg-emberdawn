/** Item reference navigation retains the detail scene's item and return context. */
import type { Cb } from '../codec.ts';
import { item } from '../content/items.ts';
import { resolveStock } from '../engine/shops.ts';
import type { PlayerState } from '../engine/types.ts';

export function sourcesAction(
  player: PlayerState,
  cb: Cb & { v: 'sources' | 'uses' },
): { toast?: string } {
  if (player.battle) return { toast: 'Finish the current battle first.' };
  const scene = player.scene;
  if (
    scene.view !== 'item' && scene.view !== 'equippedItem' &&
    !(scene.view === 'shop' && scene.mode === 'buy')
  ) {
    return { toast: 'Open an item detail page first.' };
  }
  const itemId = scene.view === 'item'
    ? player.inventory.find((entry) => entry.id === scene.itemId && entry.qty > 0)?.id
    : scene.view === 'equippedItem'
    ? player.equipment[scene.slot]
    : scene.view === 'shop' && scene.mode === 'buy' && !player.journey && !player.dungeonRun
    ? resolveStock(player).find((offering) => offering.itemId === scene.itemId)?.itemId
    : undefined;
  if (!itemId || !item(itemId)) return { toast: 'Open an item detail page first.' };
  if (cb.a === 'bk') {
    if (scene.reference?.kind !== cb.v) return {};
    delete scene.reference;
  } else {
    scene.reference = { kind: cb.v, page: cb.arg };
  }
  return {};
}
