/** Shared subviews after the caller validates the inspected item's context. */
import type { InputRichMessage } from 'grammy/types';
import { renderItemSources } from './item_sources.ts';
import { renderItemUses } from './item_uses.ts';

export function renderItemReference(
  itemId: string,
  subview: string | undefined,
): InputRichMessage | undefined {
  if (subview?.startsWith('sources:')) {
    return renderItemSources(itemId, Number(subview.slice(8)));
  }
  if (subview?.startsWith('uses:')) {
    return renderItemUses(itemId, Number(subview.slice(5)));
  }
  return undefined;
}
