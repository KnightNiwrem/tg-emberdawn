/** #187: inspect the local shelf before buying, with complete item facts
 * and a persisted return page. Ordinary play stays in the live message. */
import { assert, assertEquals } from '@std/assert';
import type { InputRichMessage } from 'grammy/types';
import { type Cb, decodeCb, encodeCb, withRev } from '../src/codec.ts';
import { item } from '../src/content/items.ts';
import { createPlayer } from '../src/engine/character.ts';
import { startBattle } from '../src/engine/combat.ts';
import { countOf } from '../src/engine/inventory.ts';
import { offeredPrice, resolveStock } from '../src/engine/shops.ts';
import { shopAction } from '../src/handlers/hub.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { handleStart } from '../src/handlers/commands.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { renderSell, renderShop, renderShopItemDetail } from '../src/render/views.ts';
import { fakeCtxCapture } from './helpers.ts';

function shopper() {
  const player = createPlayer(1870, 'Shopper', 'warrior');
  player.tutorial = 'done';
  player.level = 7;
  player.gold = 1000;
  player.quests.m5_arms = { status: 'active', counts: [0] };
  player.scene = { view: 'shop', arg: '0' };
  player.messageId = 187;
  return player;
}

function controls(view: InputRichMessage): string[] {
  return (view.blocks ?? []).flatMap((block) =>
    block.type === 'buttons'
      ? block.buttons.flatMap((btn) => 'callback_data' in btn ? btn.callback_data : [])
      : []
  );
}

Deno.test('shop: compact shelves expose Details even for unaffordable, unowned items', () => {
  const player = shopper();
  player.gold = 0;
  player.inventory = [];
  const stock = resolveStock(player);
  const views = Array.from(
    { length: Math.ceil(stock.length / 6) },
    (_, page) => renderShop(player, page),
  );
  const wires = views.flatMap(controls);
  for (const offering of stock) {
    const cb: Cb = { v: 'shop', a: 'view', arg: offering.itemId };
    const wire = encodeCb(cb);
    assert(wires.includes(wire), `${offering.itemId} is inspectable`);
    assertEquals(decodeCb(withRev(9999, wire)), { ...cb, rev: 9999 });
    assert(new TextEncoder().encode(withRev(9999, wire)).length <= 64);
  }
  const text = JSON.stringify(views);
  assert(text.includes(item('t_9')!.desc!));
  assert(!text.includes('Bramble Bleed'), 'trigger sentences belong in Details');
  assert(!text.includes('Restores 60 HP.'), 'consumable rules also belong in Details');
  assert(!wires.some((wire) => decodeCb(wire)?.a === 'buy'), 'buying remains disabled');
});

Deno.test('shop: Details disclose equipment stats, requirements, triggers, consumables and materials', () => {
  const player = shopper();
  player.inventory = [];
  const cases: [string, string[]][] = [
    ['w_warrior_2', ['+14 ATK', 'Class: Warrior', 'Requires level 7.']],
    ['a_warrior_1', ['+3 DEF', '+6 HP', '+2 RES']],
    ['t_9', ['+3 ATK', '+3 DEF', 'Bramble Bleed: 4 damage', '2 rounds', '30% chance', '3×/battle']],
    ['c_minor_potion', ['Restores 60 HP.']],
    ['m_iron_chunk', [item('m_iron_chunk')!.desc!]],
  ];
  for (const [id, facts] of cases) {
    const view = renderShopItemDetail(player, id, 1);
    const text = JSON.stringify(view);
    for (const fact of facts) assert(text.includes(fact), `${id} discloses ${fact}`);
    if (item(id)!.desc) assert(text.includes(item(id)!.desc!));
    assert(text.includes('In bag: 0'));
    assert(controls(view).includes(encodeCb({ v: 'shop', a: 'buy', arg: id })));
    assert(controls(view).includes(encodeCb({ v: 'shop', a: 'p', arg: 1 })));
    assert(
      controls(view).every((wire) => ['shop', 'sources', 'uses'].includes(decodeCb(wire)!.v)),
      'shop actions and source navigation only',
    );
  }
});

Deno.test('shop: Details use local prices and disclose mastery for replacement gear', () => {
  const player = shopper();
  player.flags.forge_i_w_warrior_1 = 2;
  assert(JSON.stringify(renderShopItemDetail(player, 'w_warrior_1', 0)).includes('+16%'));
  assert(JSON.stringify(renderShopItemDetail(player, 'w_warrior_1', 0)).includes('every copy'));
  assert(!JSON.stringify(renderShopItemDetail(player, 'a_warrior_1', 0)).includes('Forge mastery'));

  player.currentZone = 'cinder';
  player.level = 45;
  player.quests.m19_ignivar = { status: 'done', counts: [1] };
  const local = resolveStock(player).find((offering) =>
    offering.price !== item(offering.itemId)!.price
  );
  assert(local, 'fixture exercises an authored local price rule');
  player.gold = local.price;
  const view = renderShopItemDetail(player, local.itemId, 0);
  assert(JSON.stringify(view).includes(`Price: ${local.price}g`));
  assert(controls(view).includes(encodeCb({ v: 'shop', a: 'buy', arg: local.itemId })));
  assertEquals(shopAction(player, { v: 'shop', a: 'buy', arg: local.itemId }).toast, undefined);
  assertEquals(player.gold, 0, 'the purchase charges exactly the displayed local price');
  player.gold = local.price - 1;
  assert(
    !controls(renderShopItemDetail(player, local.itemId, 0)).some((callbackData) =>
      decodeCb(callbackData)?.a === 'buy'
    ),
  );
});

Deno.test('shop: invalid, gated, incompatible and unavailable inspections refuse without mutation', () => {
  const player = shopper();
  for (const id of ['gone_item', 'w_warrior_8', 'w_mage_1', 't_18']) {
    const before = structuredClone(player);
    assert(shopAction(player, { v: 'shop', a: 'view', arg: id }).toast);
    assertEquals(player, before);
  }
  delete player.quests.m5_arms;
  const before = structuredClone(player);
  assert(shopAction(player, { v: 'shop', a: 'view', arg: 'w_warrior_2' }).toast);
  assertEquals(player, before, 'progression is rechecked');
  player.level = 1;
  assert(shopAction(player, { v: 'shop', a: 'view', arg: 't_9' }).toast);
  player.currentZone = 'mirefoot';
  assert(shopAction(player, { v: 'shop', a: 'view', arg: 'c_minor_potion' }).toast);
  player.currentZone = 'emberdawn';
  player.scene = { view: 'zone' };
  assert(shopAction(player, { v: 'shop', a: 'view', arg: 'c_minor_potion' }).toast);
  player.scene = { view: 'shop', arg: 'sell', arg2: '0' };
  assert(shopAction(player, { v: 'shop', a: 'view', arg: 'c_minor_potion' }).toast);

  player.scene = { view: 'shop', arg: '0' };
  player.battle = startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, {
    player,
    rng: () => 0.5,
  })!.battle;
  const fighting = structuredClone(player);
  assert(shopAction(player, { v: 'shop', a: 'view', arg: 'c_minor_potion' }).toast);
  assertEquals(player, fighting, 'inspection cannot divert a live fight');
});

Deno.test('shop: an offering removed while Details is open loses Buy and refuses charging', () => {
  const player = shopper();
  shopAction(player, { v: 'shop', a: 'view', arg: 'w_warrior_2' });
  delete player.quests.m5_arms;
  const before = structuredClone(player);
  const view = renderShopItemDetail(player, 'w_warrior_2', 0);
  assert(JSON.stringify(view).includes('no longer stocked'));
  assertEquals(controls(view), [encodeCb({ v: 'shop', a: 'p', arg: 0 })]);
  assert(shopAction(player, { v: 'shop', a: 'buy', arg: 'w_warrior_2' }).toast);
  assertEquals(player, before);
});

Deno.test('shop: inspect, save/load, buy, stale replay and Back retain the live message and page', async () => {
  const player = shopper();
  player.scene.arg = '1';
  player.gold = offeredPrice(player, 'm_iron_chunk')!;
  const store = new MemoryStore();
  await store.set(player.userId, player);
  const tap = async (cb: Cb) => {
    const live = (await store.get(player.userId))!;
    const capture = fakeCtxCapture(
      player.userId,
      live.messageId,
      withRev(live.uiRev, encodeCb(cb)),
    );
    await store.withLock(player.userId, () => handleCallback(capture.ctx, store));
    assertEquals(capture.sends.length, 0, 'normal actions edit in place');
    return capture;
  };
  const open = await tap({ v: 'shop', a: 'view', arg: 'm_iron_chunk' });
  assert(JSON.stringify(open.edits).includes(item('m_iron_chunk')!.desc!));
  const scene = { view: 'shop', arg: '1', arg2: 'm_iron_chunk' } as const;
  assertEquals((await store.get(player.userId))!.scene, scene);

  // A fresh deserialization, then /start, must reproduce the selected detail.
  await store.set(player.userId, JSON.parse(JSON.stringify(await store.get(player.userId))));
  const start = fakeCtxCapture(player.userId);
  await store.withLock(player.userId, () => handleStart(start.ctx, store));
  assert(JSON.stringify(start.sends).includes(item('m_iron_chunk')!.desc!));
  assertEquals((await store.get(player.userId))!.scene, scene);

  const live = (await store.get(player.userId))!;
  const buyWire = withRev(live.uiRev, encodeCb({ v: 'shop', a: 'buy', arg: 'm_iron_chunk' }));
  const purchased = await tap({ v: 'shop', a: 'buy', arg: 'm_iron_chunk' });
  const after = (await store.get(player.userId))!;
  assertEquals(after.scene, scene);
  assertEquals(after.gold, 0);
  assertEquals(countOf(after, 'm_iron_chunk'), 1);
  const rendered = JSON.stringify(purchased.edits);
  assert(rendered.includes('Bought Iron Chunk'));
  assert(rendered.includes('In bag: 1'));
  assert(rendered.includes('too costly'));

  const replay = fakeCtxCapture(player.userId, after.messageId, buyWire);
  const beforeReplay = structuredClone(after);
  await store.withLock(player.userId, () => handleCallback(replay.ctx, store));
  assertEquals(await store.get(player.userId), beforeReplay);
  assertEquals(replay.edits.length, 0);
  assert(replay.toasts.some((toast) => toast?.includes('stale')));
  await tap({ v: 'shop', a: 'p', arg: 1 });
  assertEquals((await store.get(player.userId))!.scene, { view: 'shop', arg: '1' });
});

Deno.test('shop: selling pagination and switching back to buying have distinct controls', () => {
  const player = shopper();
  const sellWire = encodeCb({ v: 'shop', a: 'p', arg: -1 });
  assert(controls(renderShop(player, 0)).includes(sellWire));
  shopAction(player, decodeCb(sellWire) as Cb & { v: 'shop' });
  assertEquals(player.scene, { view: 'shop', arg: 'sell', arg2: '0' });
  shopAction(player, { v: 'shop', a: 'p', arg: 1 });
  assertEquals(player.scene, { view: 'shop', arg: 'sell', arg2: '1' });
  shopAction(player, { v: 'shop', a: 'p', arg: 0 });
  assertEquals(player.scene, { view: 'shop', arg: 'sell', arg2: '0' });
  const buyWire = encodeCb({ v: 'shop', a: 'p', arg: -2 });
  assert(controls(renderSell(player, 0)).includes(buyWire));
  shopAction(player, decodeCb(buyWire) as Cb & { v: 'shop' });
  assertEquals(player.scene, { view: 'shop', arg: '0' });
});
