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
  const itemId = scene.view === 'item'
    ? player.inventory.find((entry) => entry.id === scene.arg && entry.qty > 0)?.id
    : scene.view === 'equippedItem' &&
        (scene.arg === 'weapon' || scene.arg === 'armor' || scene.arg === 'trinket')
    ? player.equipment[scene.arg]
    : scene.view === 'shop' && scene.arg !== 'sell' && !player.journey && !player.dungeonRun
    ? resolveStock(player).find((offering) => offering.itemId === scene.arg2)?.itemId
    : undefined;
  if (!itemId || !item(itemId)) return { toast: 'Open an item detail page first.' };
  if (cb.a === 'bk') {
    if (!scene.arg3?.startsWith(`${cb.v}:`)) return {};
    delete scene.arg3;
  } else {
    scene.arg3 = `${cb.v}:${cb.arg}`;
  }
  return {};
}
