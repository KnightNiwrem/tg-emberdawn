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
    const listing = view.blocks!.find((block) => block.type === 'list');
    assert(listing?.type === 'list');
    assert(listing.items.length <= SOURCES_PAGE_SIZE);
    entries.push(...listing.items.map((listItem) => listItem.blocks[0]));
    for (const block of view.blocks!) {
      if (block.type !== 'buttons') continue;
      for (const button of block.buttons) {
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
  const player = createPlayer(208, 'Sources', 'warrior');
  player.tutorial = 'done';
  player.messageId = 208;
  player.inventory.push({ id: 'c_minor_potion', qty: 3 });
  player.equipment.weapon = 'w_warrior_1';
  const scenes = [
    { view: 'item', itemId: 'c_minor_potion', returnTo: { kind: 'inventory', page: 3 } },
    { view: 'item', itemId: 'c_minor_potion', returnTo: { kind: 'equipment' } },
    { view: 'item', itemId: 'c_minor_potion', returnTo: { kind: 'journey' } },
    { view: 'equippedItem', slot: 'weapon' },
    { view: 'shop', mode: 'buy', page: 1, itemId: 'c_minor_potion' },
  ] as const;
  const store = new MemoryStore();
  for (const scene of scenes) {
    player.scene = { ...scene };
    await store.set(player.userId, structuredClone(player));
    const before = JSON.stringify([
      player.inventory,
      player.equipment,
      player.gold,
      player.hp,
      player.mp,
    ]);
    const open = withRev(player.uiRev, encodeCb({ v: 'sources', a: 'p', arg: 0 }));
    await handleCallback(fakeCtxCapture(player.userId, player.messageId, open).ctx, store);
    let saved = (await store.get(player.userId))!;
    assertEquals(saved.scene, { ...scene, reference: { kind: 'sources', page: 0 } });
    const snapshot = JSON.stringify(saved);
    await handleCallback(fakeCtxCapture(player.userId, player.messageId, open).ctx, store);
    assertEquals(
      JSON.stringify(await store.get(player.userId)),
      snapshot,
      'stale open does nothing',
    );
    saved = JSON.parse(snapshot);
    await store.set(player.userId, saved);
    if (scene.view === 'item') {
      const next = withRev(saved.uiRev, encodeCb({ v: 'sources', a: 'p', arg: 1 }));
      await handleCallback(fakeCtxCapture(player.userId, player.messageId, next).ctx, store);
      saved = (await store.get(player.userId))!;
      assertEquals(saved.scene, { ...scene, reference: { kind: 'sources', page: 1 } });
    }
    const render = scene.view === 'item'
      ? renderItemDetail(saved, scene.itemId, scene.returnTo)
      : scene.view === 'equippedItem'
      ? renderEquippedItemDetail(saved, 'weapon')
      : renderShopItemDetail(saved, scene.itemId, 1);
    assert(JSON.stringify(render).includes('Item details'));
    const back = withRev(saved.uiRev, encodeCb({ v: 'sources', a: 'bk' }));
    await handleCallback(fakeCtxCapture(player.userId, player.messageId, back).ctx, store);
    saved = (await store.get(player.userId))!;
    assertEquals(saved.scene, scene);
    assertEquals(
      JSON.stringify([saved.inventory, saved.equipment, saved.gold, saved.hp, saved.mp]),
      before,
    );
  }
});

Deno.test('sources: invalid context, absent item, empty slot, unavailable stock and combat refuse navigation', () => {
  const player = createPlayer(2081, 'Sources', 'warrior');
  const cb: Cb & { v: 'sources' } = { v: 'sources', a: 'p', arg: 0 };
  for (
    const scene of [
      { view: 'zone' },
      { view: 'item', itemId: 'm_pickaxe' },
      { view: 'equippedItem', slot: 'trinket' },
      { view: 'shop', mode: 'sell', page: 0 },
      { view: 'shop', mode: 'buy', page: 0, itemId: 'w_warrior_8' },
    ] as const
  ) {
    player.scene = scene;
    const before = JSON.stringify(player);
    assert(sourcesAction(player, cb).toast);
    assertEquals(JSON.stringify(player), before);
  }
  player.inventory.push({ id: 'c_minor_potion', qty: 1 });
  player.scene = { view: 'item', itemId: 'c_minor_potion' };
  player.battle =
    startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, { player, rng: () => 0.5 })!
      .battle;
  const before = JSON.stringify(player);
  assert(sourcesAction(player, cb).toast);
  assertEquals(JSON.stringify(player), before);
  assertEquals(decodeCb('src:pg:-1'), undefined);
  assertEquals(decodeCb('src:pg:abc'), undefined);
});
