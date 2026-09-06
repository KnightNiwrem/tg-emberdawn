import { assert, assertEquals } from '@std/assert';
import { type Cb, decodeCb, encodeCb, withRev } from '../src/codec.ts';
import { ITEMS, sellPrice } from '../src/content/items.ts';
import { createPlayer } from '../src/engine/character.ts';
import { startBattle } from '../src/engine/combat.ts';
import { materialSources } from '../src/engine/materials.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { sourcesAction } from '../src/handlers/item_sources.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { itemFactBlocks, renderEquippedItemDetail, renderItemDetail } from '../src/render/menus.ts';
import { renderItemSources, SOURCES_PAGE_SIZE } from '../src/render/item_sources.ts';
import { renderShopItemDetail } from '../src/render/views.ts';
import { fakeCtxCapture } from './helpers.ts';

Deno.test('item facts: all catalog items end with merchant sell value and omit acquisition prose', () => {
  for (const def of ITEMS) {
    const blocks = itemFactBlocks(def);
    assertEquals(blocks.at(-1), {
      type: 'paragraph',
      text: `Sell value: ${def.unique ? '-' : `${sellPrice(def.id)}g`}`,
    });
    const text = JSON.stringify(blocks);
    assert(!text.includes('Sells for '));
    for (const source of materialSources(def.id)) {
      assert(
        !text.includes(JSON.stringify(source).slice(1, -1)),
        `${def.id}: source belongs on reference page`,
      );
    }
  }
});

Deno.test('sources: paginated entries retain every catalog source without changing player state', () => {
  const id = 'c_minor_potion';
  const sources = materialSources(id);
  assert(sources.length > SOURCES_PAGE_SIZE);
  const entries = [];
  for (let page = 0; page < Math.ceil(sources.length / SOURCES_PAGE_SIZE); page++) {
    const view = renderItemSources(id, page);
    const listing = view.blocks!.find((b) => b.type === 'list');
    assert(listing?.type === 'list');
    assert(listing.items.length <= SOURCES_PAGE_SIZE);
    entries.push(...listing.items.map((i) => i.blocks[0]));
    for (const b of view.blocks!) {
      if (b.type !== 'buttons') continue;
      for (const button of b.buttons) {
        if (!('callback_data' in button)) continue;
        const wire = withRev(9999, button.callback_data);
        assertEquals(decodeCb(wire)?.v, 'sources');
        assert(new TextEncoder().encode(wire).length <= 64);
      }
    }
  }
  assertEquals(entries, sources.map((text) => ({ type: 'paragraph', text })));
});

Deno.test('sources: open and Back survive serialization and preserve all three detail origins', async () => {
  const p = createPlayer(208, 'Sources', 'warrior');
  p.tutorial = 'done';
  p.messageId = 208;
  p.inventory.push({ id: 'c_minor_potion', qty: 3 });
  p.equipment.weapon = 'w_warrior_1';
  const scenes = [
    { view: 'item', arg: 'c_minor_potion', arg2: '3' },
    { view: 'item', arg: 'c_minor_potion', arg2: 'eq' },
    { view: 'item', arg: 'c_minor_potion', arg2: 'j' },
    { view: 'equippedItem', arg: 'weapon' },
    { view: 'shop', arg: '1', arg2: 'c_minor_potion' },
  ] as const;
  const store = new MemoryStore();
  for (const scene of scenes) {
    p.scene = { ...scene };
    await store.set(p.userId, structuredClone(p));
    const before = JSON.stringify([p.inventory, p.equipment, p.gold, p.hp, p.mp]);
    const open = withRev(p.uiRev, encodeCb({ v: 'sources', a: 'p', arg: 0 }));
    await handleCallback(fakeCtxCapture(p.userId, p.messageId, open).ctx, store);
    let saved = (await store.get(p.userId))!;
    assertEquals(saved.scene, { ...scene, arg3: 'sources:0' });
    const snapshot = JSON.stringify(saved);
    await handleCallback(fakeCtxCapture(p.userId, p.messageId, open).ctx, store);
    assertEquals(JSON.stringify(await store.get(p.userId)), snapshot, 'stale open does nothing');
    saved = JSON.parse(snapshot);
    await store.set(p.userId, saved);
    if (scene.view === 'item') {
      const next = withRev(saved.uiRev, encodeCb({ v: 'sources', a: 'p', arg: 1 }));
      await handleCallback(fakeCtxCapture(p.userId, p.messageId, next).ctx, store);
      saved = (await store.get(p.userId))!;
      assertEquals(saved.scene, { ...scene, arg3: 'sources:1' });
    }
    const render = scene.view === 'item'
      ? renderItemDetail(saved, scene.arg, scene.arg2)
      : scene.view === 'equippedItem'
      ? renderEquippedItemDetail(saved, 'weapon')
      : renderShopItemDetail(saved, scene.arg2, 1);
    assert(JSON.stringify(render).includes('Item details'));
    const back = withRev(saved.uiRev, encodeCb({ v: 'sources', a: 'bk' }));
    await handleCallback(fakeCtxCapture(p.userId, p.messageId, back).ctx, store);
    saved = (await store.get(p.userId))!;
    assertEquals(saved.scene, scene);
    assertEquals(
      JSON.stringify([saved.inventory, saved.equipment, saved.gold, saved.hp, saved.mp]),
      before,
    );
  }
});

Deno.test('sources: invalid context, absent item, empty slot, unavailable stock and combat refuse navigation', () => {
  const p = createPlayer(2081, 'Sources', 'warrior');
  const cb: Cb & { v: 'sources' } = { v: 'sources', a: 'p', arg: 0 };
  for (
    const scene of [
      { view: 'zone' },
      { view: 'item', arg: 'm_pickaxe' },
      { view: 'equippedItem', arg: 'trinket' },
      { view: 'shop', arg: 'sell', arg2: '0' },
      { view: 'shop', arg: '0', arg2: 'w_warrior_8' },
    ] as const
  ) {
    p.scene = scene;
    const before = JSON.stringify(p);
    assert(sourcesAction(p, cb).toast);
    assertEquals(JSON.stringify(p), before);
  }
  p.inventory.push({ id: 'c_minor_potion', qty: 1 });
  p.scene = { view: 'item', arg: 'c_minor_potion' };
  p.battle =
    startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, { player: p, rng: () => 0.5 })!
      .battle;
  const before = JSON.stringify(p);
  assert(sourcesAction(p, cb).toast);
  assertEquals(JSON.stringify(p), before);
  assertEquals(decodeCb('src:pg:-1'), undefined);
  assertEquals(decodeCb('src:pg:abc'), undefined);
});
