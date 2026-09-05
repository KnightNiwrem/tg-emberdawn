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
  const p = createPlayer(1870, 'Shopper', 'warrior');
  p.tutorial = 'done';
  p.level = 7;
  p.gold = 1000;
  p.quests.m5_arms = { status: 'active', counts: [0] };
  p.scene = { view: 'shop', arg: '0' };
  p.messageId = 187;
  return p;
}

function controls(view: InputRichMessage): string[] {
  return (view.blocks ?? []).flatMap((b) =>
    b.type === 'buttons'
      ? b.buttons.flatMap((btn) => 'callback_data' in btn ? btn.callback_data : [])
      : []
  );
}

Deno.test('shop: compact shelves expose Details even for unaffordable, unowned items', () => {
  const p = shopper();
  p.gold = 0;
  p.inventory = [];
  const stock = resolveStock(p);
  const views = Array.from({ length: Math.ceil(stock.length / 6) }, (_, n) => renderShop(p, n));
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
  const p = shopper();
  p.inventory = [];
  const cases: [string, string[]][] = [
    ['w_warrior_2', ['+14 ATK', 'Class: Warrior', 'Requires level 7.']],
    ['a_warrior_1', ['+3 DEF', '+6 HP', '+2 RES']],
    ['t_9', ['+3 ATK', '+3 DEF', 'Bramble Bleed: 4 damage', '2 rounds', '30% chance', '3×/battle']],
    ['c_minor_potion', ['Restores 60 HP.']],
    ['m_iron_chunk', ['Raw, heavy, honest.']],
  ];
  for (const [id, facts] of cases) {
    const view = renderShopItemDetail(p, id, 1);
    const text = JSON.stringify(view);
    for (const fact of facts) assert(text.includes(fact), `${id} discloses ${fact}`);
    if (item(id)!.desc) assert(text.includes(item(id)!.desc!));
    assert(text.includes('In bag: 0'));
    assert(controls(view).includes(encodeCb({ v: 'shop', a: 'buy', arg: id })));
    assert(controls(view).includes(encodeCb({ v: 'shop', a: 'p', arg: 1 })));
    assert(controls(view).every((wire) => decodeCb(wire)?.v === 'shop'), 'only shop actions');
  }
});

Deno.test('shop: Details use local prices and disclose mastery for replacement gear', () => {
  const p = shopper();
  p.flags.forge_i_w_warrior_1 = 2;
  assert(JSON.stringify(renderShopItemDetail(p, 'w_warrior_1', 0)).includes('+16%'));
  assert(JSON.stringify(renderShopItemDetail(p, 'w_warrior_1', 0)).includes('every copy'));
  assert(!JSON.stringify(renderShopItemDetail(p, 'a_warrior_1', 0)).includes('Forge mastery'));

  p.currentZone = 'cinder';
  p.level = 45;
  p.quests.m19_ignivar = { status: 'done', counts: [1] };
  const local = resolveStock(p).find((o) => o.price !== item(o.itemId)!.price);
  assert(local, 'fixture exercises an authored local price rule');
  p.gold = local.price;
  const view = renderShopItemDetail(p, local.itemId, 0);
  assert(JSON.stringify(view).includes(`Price: ${local.price}g`));
  assert(controls(view).includes(encodeCb({ v: 'shop', a: 'buy', arg: local.itemId })));
  assertEquals(shopAction(p, { v: 'shop', a: 'buy', arg: local.itemId }).toast, undefined);
  assertEquals(p.gold, 0, 'the purchase charges exactly the displayed local price');
  p.gold = local.price - 1;
  assert(
    !controls(renderShopItemDetail(p, local.itemId, 0)).some((w) => decodeCb(w)?.a === 'buy'),
  );
});

Deno.test('shop: invalid, gated, incompatible and unavailable inspections refuse without mutation', () => {
  const p = shopper();
  for (const id of ['gone_item', 'w_warrior_8', 'w_mage_1', 't_18']) {
    const before = structuredClone(p);
    assert(shopAction(p, { v: 'shop', a: 'view', arg: id }).toast);
    assertEquals(p, before);
  }
  delete p.quests.m5_arms;
  const before = structuredClone(p);
  assert(shopAction(p, { v: 'shop', a: 'view', arg: 'w_warrior_2' }).toast);
  assertEquals(p, before, 'progression is rechecked');
  p.level = 1;
  assert(shopAction(p, { v: 'shop', a: 'view', arg: 't_9' }).toast);
  p.currentZone = 'mirefoot';
  assert(shopAction(p, { v: 'shop', a: 'view', arg: 'c_minor_potion' }).toast);
  p.currentZone = 'emberdawn';
  p.scene = { view: 'zone' };
  assert(shopAction(p, { v: 'shop', a: 'view', arg: 'c_minor_potion' }).toast);
  p.scene = { view: 'shop', arg: 'sell', arg2: '0' };
  assert(shopAction(p, { v: 'shop', a: 'view', arg: 'c_minor_potion' }).toast);

  p.scene = { view: 'shop', arg: '0' };
  p.battle = startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, {
    player: p,
    rng: () => 0.5,
  })!.battle;
  const fighting = structuredClone(p);
  assert(shopAction(p, { v: 'shop', a: 'view', arg: 'c_minor_potion' }).toast);
  assertEquals(p, fighting, 'inspection cannot divert a live fight');
});

Deno.test('shop: an offering removed while Details is open loses Buy and refuses charging', () => {
  const p = shopper();
  shopAction(p, { v: 'shop', a: 'view', arg: 'w_warrior_2' });
  delete p.quests.m5_arms;
  const before = structuredClone(p);
  const view = renderShopItemDetail(p, 'w_warrior_2', 0);
  assert(JSON.stringify(view).includes('no longer stocked'));
  assertEquals(controls(view), [encodeCb({ v: 'shop', a: 'p', arg: 0 })]);
  assert(shopAction(p, { v: 'shop', a: 'buy', arg: 'w_warrior_2' }).toast);
  assertEquals(p, before);
});

Deno.test('shop: inspect, save/load, buy, stale replay and Back retain the live message and page', async () => {
  const p = shopper();
  p.scene.arg = '1';
  p.gold = offeredPrice(p, 'm_iron_chunk')!;
  const store = new MemoryStore();
  await store.set(p.userId, p);
  const tap = async (cb: Cb) => {
    const live = (await store.get(p.userId))!;
    const capture = fakeCtxCapture(p.userId, live.messageId, withRev(live.uiRev, encodeCb(cb)));
    await store.withLock(p.userId, () => handleCallback(capture.ctx, store));
    assertEquals(capture.sends.length, 0, 'normal actions edit in place');
    return capture;
  };
  const open = await tap({ v: 'shop', a: 'view', arg: 'm_iron_chunk' });
  assert(JSON.stringify(open.edits).includes('Raw, heavy, honest.'));
  const scene = { view: 'shop', arg: '1', arg2: 'm_iron_chunk' } as const;
  assertEquals((await store.get(p.userId))!.scene, scene);

  // A fresh deserialization, then /start, must reproduce the selected detail.
  await store.set(p.userId, JSON.parse(JSON.stringify(await store.get(p.userId))));
  const start = fakeCtxCapture(p.userId);
  await store.withLock(p.userId, () => handleStart(start.ctx, store));
  assert(JSON.stringify(start.sends).includes('Raw, heavy, honest.'));
  assertEquals((await store.get(p.userId))!.scene, scene);

  const live = (await store.get(p.userId))!;
  const buyWire = withRev(live.uiRev, encodeCb({ v: 'shop', a: 'buy', arg: 'm_iron_chunk' }));
  const purchased = await tap({ v: 'shop', a: 'buy', arg: 'm_iron_chunk' });
  const after = (await store.get(p.userId))!;
  assertEquals(after.scene, scene);
  assertEquals(after.gold, 0);
  assertEquals(countOf(after, 'm_iron_chunk'), 1);
  const rendered = JSON.stringify(purchased.edits);
  assert(rendered.includes('Bought Iron Chunk'));
  assert(rendered.includes('In bag: 1'));
  assert(rendered.includes('too costly'));

  const replay = fakeCtxCapture(p.userId, after.messageId, buyWire);
  const beforeReplay = structuredClone(after);
  await store.withLock(p.userId, () => handleCallback(replay.ctx, store));
  assertEquals(await store.get(p.userId), beforeReplay);
  assertEquals(replay.edits.length, 0);
  assert(replay.toasts.some((s) => s?.includes('stale')));
  await tap({ v: 'shop', a: 'p', arg: 1 });
  assertEquals((await store.get(p.userId))!.scene, { view: 'shop', arg: '1' });
});

Deno.test('shop: selling pagination and switching back to buying have distinct controls', () => {
  const p = shopper();
  const sellWire = encodeCb({ v: 'shop', a: 'p', arg: -1 });
  assert(controls(renderShop(p, 0)).includes(sellWire));
  shopAction(p, decodeCb(sellWire) as Cb & { v: 'shop' });
  assertEquals(p.scene, { view: 'shop', arg: 'sell', arg2: '0' });
  shopAction(p, { v: 'shop', a: 'p', arg: 1 });
  assertEquals(p.scene, { view: 'shop', arg: 'sell', arg2: '1' });
  shopAction(p, { v: 'shop', a: 'p', arg: 0 });
  assertEquals(p.scene, { view: 'shop', arg: 'sell', arg2: '0' });
  const buyWire = encodeCb({ v: 'shop', a: 'p', arg: -2 });
  assert(controls(renderSell(p, 0)).includes(buyWire));
  shopAction(p, decodeCb(buyWire) as Cb & { v: 'shop' });
  assertEquals(p.scene, { view: 'shop', arg: '0' });
});
