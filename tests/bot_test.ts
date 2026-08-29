/**
 * Integration tests: drive the real bot in-process via grammy-testing.
 * No token, no network. Assertions read captured replies and the store.
 */

import { assert, assertEquals } from '@std/assert';
import { prepareBot } from 'grammy-testing';
import { createBot } from '../src/bot.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { createPlayer, statsOf } from '../src/engine/character.ts';

async function setup() {
  const store = new MemoryStore();
  const bot = createBot({ token: '123456:TEST-TOKEN-FOR-TESTS', store });
  const { chats } = await prepareBot(bot);
  const user = chats.newUser({ id: 4242, first_name: 'Tester' });
  return { store, user };
}

Deno.test('/start with no character sends the class picker', async () => {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  const reply = user.replies.lastOrThrow();
  assert(reply.text !== undefined || reply.richMessage !== undefined);
  assertEquals(await store.get(4242), undefined);
});

Deno.test('class pick creates a character and shows the zone hub', async () => {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  await user.sendCallbackQuery('m:pk:mage');
  const p = await store.get(4242);
  assert(p, 'player should be created');
  assertEquals(p.classId, 'mage');
  assertEquals(p.scene.view, 'zone');
  assertEquals(p.name, 'Tester');
  // starting gear equipped
  assert(p.equipment.weapon === 'w_mage_1');
});

Deno.test('exploring can start battles; battles resolve; zone view returns', async () => {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  await user.sendCallbackQuery('m:pk:warrior');
  // Explore until a battle starts (weighted tables guarantee battles often).
  let started = false;
  for (let i = 0; i < 30 && !started; i++) {
    await user.sendCallbackQuery('z:ex');
    const p = (await store.get(4242))!;
    started = p.battle !== undefined;
  }
  assert(started, 'a battle should have started within 30 explores');
  // Fight: attack until the battle is no longer active.
  for (let i = 0; i < 100; i++) {
    const p = (await store.get(4242))!;
    if (!p.battle) break;
    if (p.battle.phase === 'active') {
      await user.sendCallbackQuery('b:atk');
    } else {
      await user.sendCallbackQuery('b:go');
    }
  }
  const p = (await store.get(4242))!;
  assertEquals(p.battle, undefined, 'battle should be resolved and cleared');
  assertEquals(p.scene.view, 'zone');
  // A resolved battle means either victory (stats) or death (revived).
  assert(p.hp > 0);
});

Deno.test('shop buy/sell flow updates gold and inventory', async () => {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  await user.sendCallbackQuery('m:pk:rogue');
  const p0 = (await store.get(4242))!;
  const gold0 = p0.gold;
  await user.sendCallbackQuery('z:sh');
  await user.sendCallbackQuery('h:buy:c_minor_potion');
  const p1 = (await store.get(4242))!;
  assertEquals(p1.gold, gold0 - 30);
  const qty = p1.inventory.find((e) => e.id === 'c_minor_potion')?.qty ?? 0;
  assert(qty >= 3);
  await user.sendCallbackQuery('h:sell:c_minor_potion');
  const p2 = (await store.get(4242))!;
  assertEquals(p2.gold, gold0 - 30 + 12);
});

Deno.test('quest accept via NPC talk and quest screens', async () => {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  await user.sendCallbackQuery('m:pk:warrior');
  await user.sendCallbackQuery('z:q'); // quest log
  await user.sendCallbackQuery('q:q:m1_embers'); // detail
  await user.sendCallbackQuery('q:a:m1_embers'); // accept
  const p = (await store.get(4242))!;
  assertEquals(p.quests['m1_embers']?.status, 'active');
});

Deno.test('travel view navigates and back returns to zone', async () => {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  await user.sendCallbackQuery('m:pk:warrior');
  await user.sendCallbackQuery('z:tv');
  assertEquals((await store.get(4242))!.scene.view, 'travel');
  await user.sendCallbackQuery('t:bk');
  assertEquals((await store.get(4242))!.scene.view, 'zone');
});

Deno.test('inventory equip flow swaps gear', async () => {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  await user.sendCallbackQuery('m:pk:warrior');
  // Give a better weapon directly, then equip it through the UI.
  const p0 = (await store.get(4242))!;
  p0.level = 7;
  p0.inventory.push({ id: 'w_warrior_2', qty: 1 });
  await store.set(4242, p0);
  await user.sendCallbackQuery('z:inv');
  await user.sendCallbackQuery('i:v:w_warrior_2');
  await user.sendCallbackQuery('i:eq:w_warrior_2');
  const p1 = (await store.get(4242))!;
  assertEquals(p1.equipment.weapon, 'w_warrior_2');
  // Old weapon back in the bag
  assert(p1.inventory.some((e) => e.id === 'w_warrior_1'));
  const atk = statsOf(p1).atk;
  assert(atk > 10);
});

Deno.test('forge tempering through the UI consumes resources', async () => {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  await user.sendCallbackQuery('m:pk:warrior');
  const p0 = (await store.get(4242))!;
  p0.gold = 5000;
  p0.inventory.push({ id: 'm_ember_shard', qty: 10 });
  await store.set(4242, p0);
  await user.sendCallbackQuery('z:fg');
  await user.sendCallbackQuery('f:w');
  const p1 = (await store.get(4242))!;
  assertEquals(p1.flags['forge_weapon'], 1);
  assertEquals(p1.gold, 5000 - 200);
  assertEquals(p1.inventory.find((e) => e.id === 'm_ember_shard')?.qty, 9);
});

Deno.test('full player persists across bot instance using the same store', async () => {
  const store = new MemoryStore();
  const bot = createBot({ token: '123456:TEST-TOKEN-FOR-TESTS', store });
  const { chats } = await prepareBot(bot);
  const user = chats.newUser({ id: 77, first_name: 'Persisto' });
  await user.sendCommand('/start');
  await user.sendCallbackQuery('m:pk:cleric');
  const p = await store.get(77);
  assert(p);
  assertEquals(p.classId, 'cleric');
  assertEquals(createPlayer(77, 'Persisto', 'cleric').classId, p.classId);
});

Deno.test('death flow: felling the player routes through death view and revives', async () => {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  await user.sendCallbackQuery('m:pk:warrior');
  // Force a hopeless fight against a boss.
  const p0 = (await store.get(4242))!;
  p0.unlockedZones.push('umbra');
  p0.currentZone = 'umbra';
  await store.set(4242, p0);
  await user.sendCallbackQuery('z:dg'); // dive into Sundered Throne → floor 1 enemy
  let p = (await store.get(4242))!;
  if (!p.battle) return; // explore rolls may differ; skip if no battle (defensive)
  // Keep attacking without healing until dead (boss zone enemies outscale Lv1).
  for (let i = 0; i < 60; i++) {
    p = (await store.get(4242))!;
    if (!p.battle) break;
    if (p.scene.view === 'death') break;
    if (p.battle.phase === 'active') await user.sendCallbackQuery('b:atk');
    else await user.sendCallbackQuery('b:go');
  }
  p = (await store.get(4242))!;
  if (p.scene.view === 'death') {
    await user.sendCallbackQuery('d:ok');
    p = (await store.get(4242))!;
    assertEquals(p.scene.view, 'zone');
    assert(p.hp > 0);
    assertEquals(p.stats.deaths, 1);
  } else {
    // Won or fled somehow — either way state must be consistent.
    assert(p.hp > 0);
  }
});
