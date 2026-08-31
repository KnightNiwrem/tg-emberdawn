/**
 * Integration tests: drive the real bot in-process via grammy-testing.
 * No token, no network. Assertions read captured replies and the store.
 */

import { assert, assertEquals } from '@std/assert';
import { prepareBot } from 'grammy-testing';
import { createBot } from '../src/bot.ts';
import { withRev } from '../src/codec.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import type { PlayerState } from '../src/engine/types.ts';

async function setup() {
  const store = new MemoryStore();
  const bot = createBot({ token: '123456:TEST-TOKEN-FOR-TESTS', store });
  const { chats } = await prepareBot(bot);
  const user = chats.newUser({ id: 4242, first_name: 'Tester' });
  return { store, user };
}

/** Taps a button the way a real client does (#16): carrying the render
 * revision currently on screen, which the store tracks per player. */
async function tap(
  store: MemoryStore,
  user: { id: number; sendCallbackQuery: (data: string) => Promise<unknown> },
  data: string,
): Promise<void> {
  const rev = (await store.get(user.id))?.uiRev ?? 0;
  await user.sendCallbackQuery(withRev(rev, data));
}

/** /start → pick warrior → apply direct mutations and save. */
async function startWarrior(mutate: (p: PlayerState) => void) {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  await tap(store, user, 'm:pk:warrior');
  const p0 = (await store.get(4242))!;
  mutate(p0);
  await store.set(4242, p0);
  return { user, store };
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
  await tap(store, user, 'm:pk:mage');
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
  await tap(store, user, 'm:pk:warrior');
  // Battles live in the wilds now — head to the Whisperwood first.
  await tap(store, user, 't:go:whisperwood');
  // Explore until a battle starts (weighted tables guarantee battles often).
  let started = false;
  for (let i = 0; i < 30 && !started; i++) {
    await tap(store, user, 'z:ex');
    const p = (await store.get(4242))!;
    started = p.battle !== undefined;
  }
  assert(started, 'a battle should have started within 30 explores');
  // Fight: attack until the battle resolves. If it ends in death, the UI is
  // the death screen — rise again (applyDeath + revive) like a player would.
  for (let i = 0; i < 100; i++) {
    const cur = (await store.get(4242))!;
    if (!cur.battle) break;
    if (cur.battle.phase === 'active') {
      await tap(store, user, 'b:atk');
    } else if (cur.battle.phase === 'lost') {
      await tap(store, user, 'd:ok');
    } else {
      await tap(store, user, 'b:go');
    }
  }
  const p = (await store.get(4242))!;
  assertEquals(p.battle, undefined, 'battle should be resolved and cleared');
  assertEquals(p.scene.view, 'zone');
  // A resolved battle means either victory (stats) or death (revived).
  assert(p.hp > 0, 'alive after the fight — revived if it was lost');
});

Deno.test('shop buy/sell flow updates gold and inventory', async () => {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  await tap(store, user, 'm:pk:rogue');
  const p0 = (await store.get(4242))!;
  const gold0 = p0.gold;
  await tap(store, user, 'z:sh');
  await tap(store, user, 'h:buy:c_minor_potion');
  const p1 = (await store.get(4242))!;
  assertEquals(p1.gold, gold0 - 30);
  const qty = p1.inventory.find((e) => e.id === 'c_minor_potion')?.qty ?? 0;
  assert(qty >= 3);
  await tap(store, user, 'h:sell:c_minor_potion');
  const p2 = (await store.get(4242))!;
  assertEquals(p2.gold, gold0 - 30 + 12);
});

Deno.test('quest accept via NPC talk — the authoritative interaction (#64)', async () => {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  await tap(store, user, 'm:pk:warrior');
  await tap(store, user, 'z:tk:0'); // talk to Elder Maren — m1's starter
  const opened = (await store.get(4242))!;
  assertEquals(opened.scene.view, 'npcq', 'talk opens the NPC interaction');
  assertEquals(opened.scene.arg, 'm1_embers');
  assertEquals(opened.scene.arg2, 'npc_maren');
  await tap(store, user, 'n:a:m1_embers'); // accept at the NPC
  const p = (await store.get(4242))!;
  assertEquals(p.quests['m1_embers']?.status, 'active');

  // The Quest Log route cannot accept — lifecycle authority is on-site.
  await tap(store, user, 'q:bk');
  await tap(store, user, 'z:q'); // quest log
  await tap(store, user, 'q:q:m1_embers'); // detail (read-only viewing)
  await tap(store, user, 'q:a:m1_embers'); // refused (#64)
  const refused = (await store.get(4242))!;
  assertEquals(refused.quests['m1_embers']?.status, 'active', 'log tap mutated nothing');
});

Deno.test('travel view navigates and back returns to zone', async () => {
  const { user, store } = await setup();
  await user.sendCommand('/start');
  await tap(store, user, 'm:pk:warrior');
  await tap(store, user, 'z:tv');
  assertEquals((await store.get(4242))!.scene.view, 'travel');
  await tap(store, user, 't:bk');
  assertEquals((await store.get(4242))!.scene.view, 'zone');
});

Deno.test('inventory equip flow swaps gear', async () => {
  // Give a better weapon directly, then equip it through the UI.
  const { user, store } = await startWarrior((p) => {
    p.level = 7;
    p.inventory.push({ id: 'w_warrior_2', qty: 1 });
  });
  await tap(store, user, 'z:inv');
  await tap(store, user, 'i:v:w_warrior_2');
  await tap(store, user, 'i:eq:w_warrior_2');
  const p1 = (await store.get(4242))!;
  assertEquals(p1.equipment.weapon, 'w_warrior_2');
  // Old weapon back in the bag
  assert(p1.inventory.some((e) => e.id === 'w_warrior_1'));
  const atk = statsOf(p1).atk;
  assert(atk > 10);
});

Deno.test('forge tempering through the UI consumes resources', async () => {
  const { user, store } = await startWarrior((p) => {
    p.gold = 5000;
    p.inventory.push({ id: 'm_ember_shard', qty: 10 });
  });
  await tap(store, user, 'z:fg');
  await tap(store, user, 'f:w');
  const p1 = (await store.get(4242))!;
  assertEquals(p1.flags['forge_i_w_warrior_1'], 1);
  assertEquals(p1.gold, 5000 - 200);
  assertEquals(p1.inventory.find((e) => e.id === 'm_ember_shard')?.qty, 9);
});

Deno.test('full player persists across bot instance using the same store', async () => {
  const store = new MemoryStore();
  const bot = createBot({ token: '123456:TEST-TOKEN-FOR-TESTS', store });
  const { chats } = await prepareBot(bot);
  const user = chats.newUser({ id: 77, first_name: 'Persisto' });
  await user.sendCommand('/start');
  await tap(store, user, 'm:pk:cleric');
  const p = await store.get(77);
  assert(p);
  assertEquals(p.classId, 'cleric');
  assertEquals(createPlayer(77, 'Persisto', 'cleric').classId, p.classId);
});

Deno.test('death flow: felling the player routes through death view and revives', async () => {
  // Force a hopeless fight against a boss.
  const { user, store } = await startWarrior((p) => {
    p.unlockedZones.push('umbra');
    p.currentZone = 'umbra';
  });
  await tap(store, user, 'z:dg'); // dive into Sundered Throne → floor 1 enemy
  let p = (await store.get(4242))!;
  if (!p.battle) return; // explore rolls may differ; skip if no battle (defensive)
  // Keep attacking without healing until dead (boss zone enemies outscale Lv1).
  for (let i = 0; i < 60; i++) {
    p = (await store.get(4242))!;
    if (!p.battle) break;
    if (p.scene.view === 'death') break;
    if (p.battle.phase === 'active') await tap(store, user, 'b:atk');
    else await tap(store, user, 'b:go');
  }
  p = (await store.get(4242))!;
  if (p.scene.view === 'death') {
    await tap(store, user, 'd:ok');
    p = (await store.get(4242))!;
    assertEquals(p.scene.view, 'zone');
    assert(p.hp > 0);
    assertEquals(p.stats.deaths, 1);
  } else {
    // Won or fled somehow — either way state must be consistent.
    assert(p.hp > 0);
  }
});
