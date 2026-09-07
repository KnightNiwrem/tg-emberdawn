import { assertEquals, assertRejects } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { fakeCtx } from './helpers.ts';

Deno.test('MemoryStore isolates nested state on both write and read', async () => {
  const store = new MemoryStore();
  const original = createPlayer(230, 'Stored', 'warrior');
  await store.set(original.userId, original);
  const snapshot = structuredClone(original);
  original.inventory[0].qty = 500;
  const loaded = (await store.get(original.userId))!;
  assertEquals(loaded, snapshot, 'write owns an independent copy');
  loaded.inventory[0].qty = 900;
  loaded.scene = { view: 'reset' };
  assertEquals(await store.get(original.userId), snapshot, 'read is not a write');
  await store.set(original.userId, loaded);
  assertEquals(await store.get(original.userId), loaded, 'explicit save persists changes');
});

Deno.test('failed purchase delivery leaves the stored player unchanged', async () => {
  const store = new MemoryStore();
  const player = createPlayer(231, 'Shopper', 'warrior');
  player.messageId = 100;
  player.uiRev = 3;
  player.scene = { view: 'shop', arg: '0' };
  await store.set(player.userId, player);
  const ctx = fakeCtx(player.userId, 100, 'h:3:buy:c_minor_potion');
  ctx.api.editMessageText = () => Promise.reject(new Error('delivery failed'));
  await assertRejects(() => handleCallback(ctx, store), Error, 'delivery failed');
  assertEquals(await store.get(player.userId), player);
});
