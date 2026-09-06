/** Read-only acquisition reference, shared by all item detail contexts. */
import type { InputRichBlock, InputRichMessage } from 'grammy/types';
import { encodeCb } from '../codec.ts';
import { itemName } from '../content/items.ts';
import { materialSources } from '../engine/materials.ts';
import { buttonsRow, cbBtn, heading, list, para } from './rich.ts';

export const SOURCES_PAGE_SIZE = 6;

export function sourcesButton() {
  return cbBtn('Sources', encodeCb({ v: 'sources', a: 'p', arg: 0 }));
}

export function renderItemSources(itemId: string, page: number): InputRichMessage {
  const sources = materialSources(itemId);
  const pages = Math.max(1, Math.ceil(sources.length / SOURCES_PAGE_SIZE));
  const pageIndex = Math.min(Math.max(0, Number.isFinite(page) ? Math.floor(page) : 0), pages - 1);
  const blocks: InputRichBlock[] = [heading('Sources', 4), para(itemName(itemId))];
  const entries = sources.slice(pageIndex * SOURCES_PAGE_SIZE, (pageIndex + 1) * SOURCES_PAGE_SIZE);
  blocks.push(
    entries.length
      ? list(entries.map((text) => [para(text)]))
      : para('No acquisition sources listed.'),
  );
  const nav = [];
  if (pageIndex > 0) {
    nav.push(cbBtn('⬅️ Prev', encodeCb({ v: 'sources', a: 'p', arg: pageIndex - 1 })));
  }
  if (pages > 1) {
    nav.push(
      cbBtn(`${pageIndex + 1}/${pages}`, encodeCb({ v: 'sources', a: 'p', arg: pageIndex })),
    );
  }
  if (pageIndex < pages - 1) {
    nav.push(cbBtn('Next ➡️', encodeCb({ v: 'sources', a: 'p', arg: pageIndex + 1 })));
  }
  if (nav.length) blocks.push(buttonsRow(nav));
  blocks.push(buttonsRow([cbBtn('⬅️ Item details', encodeCb({ v: 'sources', a: 'bk' }))]));
  return { blocks };
}
