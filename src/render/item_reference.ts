import type { ItemReference } from '../engine/types.ts';
/** Shared subviews after the caller validates the inspected item's context. */
import type { InputRichMessage } from 'grammy/types';
import { renderItemSources } from './item_sources.ts';
import { renderItemUses } from './item_uses.ts';

export function renderItemReference(
  itemId: string,
  subview: ItemReference | undefined,
): InputRichMessage | undefined {
  if (subview?.kind === 'sources') {
    return renderItemSources(itemId, subview.page);
  }
  if (subview?.kind === 'uses') {
    return renderItemUses(itemId, subview.page);
  }
  return undefined;
}
