/** Grouped, paginated production and activity uses for the inspected item. */
import type { InputRichBlock, InputRichMessage } from 'grammy/types';
import { encodeCb } from '../codec.ts';
import { itemName } from '../content/items.ts';
import { itemUseGroups } from '../engine/materials.ts';
import { sourcesButton } from './item_sources.ts';
import { buttonsRow, cbBtn, heading, list, para } from './rich.ts';

export const USES_PAGE_SIZE = 4;

/** Reference navigation has its own compact row, separate from item actions. */
export function itemReferenceRow(itemId: string): InputRichBlock {
  const buttons = [sourcesButton()];
  if (itemUseGroups(itemId).length) {
    buttons.push(cbBtn('Uses', encodeCb({ v: 'uses', a: 'p', arg: 0 })));
  }
  return buttonsRow(buttons);
}

export function renderItemUses(itemId: string, page: number): InputRichMessage {
  const groups = itemUseGroups(itemId);
  const entries = groups.flatMap((group) => group.entries.map((entry) => ({ group, entry })));
  const pages = Math.max(1, Math.ceil(entries.length / USES_PAGE_SIZE));
  const pageIndex = Math.min(Math.max(0, Number.isFinite(page) ? Math.floor(page) : 0), pages - 1);
  const visible = entries.slice(pageIndex * USES_PAGE_SIZE, (pageIndex + 1) * USES_PAGE_SIZE);
  const blocks: InputRichBlock[] = [heading('Uses', 3), para(itemName(itemId))];
  for (const group of groups) {
    const section = visible.filter((item) => item.group === group);
    if (!section.length) continue;
    blocks.push(heading(group.title, 4));
    if (group.description) blocks.push(para(group.description));
    blocks.push(list(section.map(({ entry }) => [
      para([{ type: 'bold', text: entry.title }]),
      ...(entry.detail ? [para(entry.detail)] : []),
    ])));
  }
  if (!entries.length) blocks.push(para('No crafting, tempering, or gathering uses listed.'));
  const nav = [];
  if (pageIndex > 0) {
    nav.push(cbBtn('⬅️ Prev', encodeCb({ v: 'uses', a: 'p', arg: pageIndex - 1 })));
  }
  if (pages > 1) {
    nav.push(cbBtn(`${pageIndex + 1}/${pages}`, encodeCb({ v: 'uses', a: 'p', arg: pageIndex })));
  }
  if (pageIndex < pages - 1) {
    nav.push(cbBtn('Next ➡️', encodeCb({ v: 'uses', a: 'p', arg: pageIndex + 1 })));
  }
  if (nav.length) blocks.push(buttonsRow(nav));
  blocks.push(buttonsRow([cbBtn('⬅️ Item details', encodeCb({ v: 'uses', a: 'bk' }))]));
  return { blocks };
}
