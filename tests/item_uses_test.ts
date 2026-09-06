import { assert, assertEquals } from '@std/assert';
import type { InputRichMessage } from 'grammy/types';
import { decodeCb, encodeCb, withRev } from '../src/codec.ts';
import { item, ITEMS } from '../src/content/items.ts';
import { createPlayer } from '../src/engine/character.ts';
import { itemUseGroups } from '../src/engine/materials.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { sourcesAction } from '../src/handlers/item_sources.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { itemFactBlocks, renderItemDetail } from '../src/render/menus.ts';
import { itemReferenceRow, renderItemUses, USES_PAGE_SIZE } from '../src/render/item_uses.ts';
import { fakeCtxCapture } from './helpers.ts';

function controls(view: InputRichMessage): string[] {
  return (view.blocks ?? []).flatMap((b) =>
    b.type === 'buttons'
      ? b.buttons.flatMap((button) => 'callback_data' in button ? [button.callback_data] : [])
      : []
  );
}

Deno.test('Uses: recipes, tempering and activities have distinct roles and item details retain immediate effects', () => {
  const hardwood = itemUseGroups('m_hardwood');
  assertEquals(hardwood.map((g) => g.title), ['Recipes', 'Tempering']);
  assert(hardwood[0].entries.length > 1);
  assert(
    hardwood[0].entries.some((e) =>
      e.title === 'Make Fishing Rod' && e.detail?.includes('Consumes 1 per batch')
    ),
  );
  assertEquals(hardwood[1].entries, [{ title: 'Tier 1', detail: 'Weapons' }]);
  assertEquals(itemUseGroups('m_mystic_dust').find((g) => g.title === 'Tempering')!.entries, [
    { title: 'Tier 3', detail: 'Weapons and armor' },
    { title: 'Tier 4', detail: 'Weapons and armor' },
  ]);
  const bait = itemUseGroups('m_worm_bait').find((g) => g.title === 'Fishing')!;
  assert(bait.entries.length > 1);
  assert(bait.description?.includes('1 consumed per cast'));
  const tool = itemUseGroups('m_pickaxe').find((g) => g.title === 'Mining')!;
  assert(tool.description?.includes('Reusable tool'));
  const detail = JSON.stringify(itemFactBlocks(item('c_wild_berry')!));
  assert(detail.includes('Restores 12 HP.'));
  assert(!detail.includes('Brew Minor Potion'));
  assert(!JSON.stringify(itemFactBlocks(item('m_mystic_dust')!)).includes('Tempering'));
  assert(!JSON.stringify(itemFactBlocks(item('m_worm_bait')!)).includes('consumed per cast'));
  assertEquals(itemUseGroups('m_rat_tail')[0].title, 'Trading');
  assertEquals(itemUseGroups('w_warrior_1'), []);
});

Deno.test('Uses: every entry survives pagination, with headings and bounded navigation on each page', () => {
  for (const def of ITEMS) {
    const groups = itemUseGroups(def.id);
    const entries = groups.flatMap((g) => g.entries);
    const seen = [];
    for (let page = 0; page < Math.max(1, Math.ceil(entries.length / USES_PAGE_SIZE)); page++) {
      const view = renderItemUses(def.id, page);
      let sectionHeading = '';
      let count = 0;
      for (const block of view.blocks!) {
        if (block.type === 'heading' && typeof block.text === 'string') sectionHeading = block.text;
        if (block.type !== 'list') continue;
        assert(groups.some((g) => g.title === sectionHeading));
        for (const entry of block.items) {
          seen.push(entry.blocks);
          count++;
        }
      }
      assert(count <= USES_PAGE_SIZE);
      assert(controls(view).includes(encodeCb({ v: 'uses', a: 'bk' })));
      for (const wire of controls(view)) {
        const stamped = withRev(9999, wire);
        assertEquals(decodeCb(stamped)?.v, 'uses');
        assert(new TextEncoder().encode(stamped).length <= 64);
      }
    }
    assertEquals<unknown>(
      seen,
      entries.map((e) => [
        { type: 'paragraph', text: [{ type: 'bold', text: e.title }] },
        ...(e.detail ? [{ type: 'paragraph', text: e.detail }] : []),
      ]),
      def.id,
    );
    const row = itemReferenceRow(def.id);
    assert(row.type === 'buttons');
    assertEquals(row.buttons.map((b) => b.text), groups.length ? ['Sources', 'Uses'] : ['Sources']);
    assertEquals(row.align, 'center');
  }
});

Deno.test('Uses: guarded navigation preserves bag/shop context, resources and return state after reload', async () => {
  const p = createPlayer(209, 'Uses', 'warrior');
  p.tutorial = 'done';
  p.messageId = 209;
  p.inventory.push({ id: 'm_worm_bait', qty: 5 });
  const store = new MemoryStore();
  for (
    const scene of [
      { view: 'item', arg: 'm_worm_bait', arg2: '3' },
      { view: 'item', arg: 'm_worm_bait', arg2: 'eq' },
      { view: 'item', arg: 'm_worm_bait', arg2: 'j' },
      { view: 'shop', arg: '1', arg2: 'm_worm_bait' },
    ] as const
  ) {
    p.scene = scene;
    const resources = JSON.stringify([p.inventory, p.equipment, p.gold, p.hp, p.mp]);
    await store.set(p.userId, structuredClone(p));
    const open = withRev(p.uiRev, encodeCb({ v: 'uses', a: 'p', arg: 0 }));
    await handleCallback(fakeCtxCapture(p.userId, p.messageId, open).ctx, store);
    let saved = (await store.get(p.userId))!;
    assertEquals(saved.scene, { ...scene, arg3: 'uses:0' });
    const snapshot = JSON.stringify(saved);
    await handleCallback(fakeCtxCapture(p.userId, p.messageId, open).ctx, store);
    assertEquals(JSON.stringify(await store.get(p.userId)), snapshot);
    await store.set(p.userId, JSON.parse(snapshot));
    const next = withRev(saved.uiRev, encodeCb({ v: 'uses', a: 'p', arg: 1 }));
    await handleCallback(fakeCtxCapture(p.userId, p.messageId, next).ctx, store);
    saved = (await store.get(p.userId))!;
    assertEquals(saved.scene, { ...scene, arg3: 'uses:1' });
    const back = withRev(saved.uiRev, encodeCb({ v: 'uses', a: 'bk' }));
    await handleCallback(fakeCtxCapture(p.userId, p.messageId, back).ctx, store);
    saved = (await store.get(p.userId))!;
    assertEquals(saved.scene, scene);
    assertEquals(
      JSON.stringify([saved.inventory, saved.equipment, saved.gold, saved.hp, saved.mp]),
      resources,
    );
    if (scene.view === 'item') {
      assert(
        controls(renderItemDetail(saved, scene.arg, scene.arg2)).includes(
          encodeCb({ v: 'uses', a: 'p', arg: 0 }),
        ),
      );
    }
  }
  for (
    const scene of [{ view: 'zone' }, { view: 'item', arg: 'm_pickaxe' }, {
      view: 'shop',
      arg: 'sell',
      arg2: '0',
    }] as const
  ) {
    p.scene = scene;
    const before = JSON.stringify(p);
    assert(sourcesAction(p, { v: 'uses', a: 'p', arg: 0 }).toast);
    assertEquals(JSON.stringify(p), before);
  }
  assertEquals(decodeCb('uses:pg:-1'), undefined);
  assertEquals(decodeCb('uses:pg:NaN'), undefined);
});
