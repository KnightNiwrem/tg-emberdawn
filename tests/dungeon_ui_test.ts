import { assert, assertEquals, assertThrows } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { zone, ZONES } from '../src/content/zones.ts';
import { renderZone } from '../src/render/views.ts';
import { decodeCb, encodeCb, withRev } from '../src/codec.ts';
import { zoneAction } from '../src/handlers/hub.ts';
import { battleAction } from '../src/handlers/battle.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { arriveAt, explore, resolveVictory } from '../src/engine/world.ts';
import { startJourney } from '../src/engine/journey.ts';
import { buy } from '../src/engine/shops.ts';
import { craft } from '../src/engine/crafting.ts';
import { temper } from '../src/engine/forge.ts';
import { gather } from '../src/engine/gathering.ts';
import { applyStoryEffects, validateStoryBundle } from '../src/engine/story.ts';
import { useRecoveryItem } from '../src/engine/supplies.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { fakeCtxCapture } from './helpers.ts';

function delver() {
  const p = createPlayer(2072, 'Delver', 'warrior');
  p.tutorial = 'done';
  p.currentZone = 'whisperwood';
  p.level = 45;
  p.gold = 10000;
  p.messageId = 207;
  p.uiRev = 11;
  return p;
}

Deno.test('hub composition: compact centered controls, one description, no dungeon checkpoint prose', () => {
  for (const z of ZONES) {
    const p = delver();
    p.currentZone = z.id;
    p.notices = [`🧭 You arrive at ${z.emoji} ${z.name}.`, z.desc, 'A quest is ready.'];
    const before = JSON.stringify(p);
    const view = renderZone(p);
    const text = JSON.stringify(view);
    assertEquals(JSON.stringify(p), before);
    assertEquals(view.blocks!.filter((b) => b.type === 'heading').length, 1);
    assertEquals(text.split(z.desc).length - 1, 1, z.id);
    assert(text.includes('A quest is ready.'));
    assert(!text.includes('Recommended Lv'));
    assert(!text.includes('rematch available'));
    const rows = view.blocks!.filter((b) => b.type === 'buttons');
    assert(rows.every((r) => r.align === 'center' && r.buttons.length > 0));
    assert(rows.every((r) => r.buttons.every((b) => !('disabled' in b))));
    const wires = rows.flatMap((r) =>
      r.buttons.flatMap((b) => 'callback_data' in b ? [b.callback_data] : [])
    );
    assertEquals(wires.includes(encodeCb({ v: 'zone', a: 'dg' })), !!z.dungeon);
  }
});

Deno.test('dungeon UI: entry requires its staged confirmation and victory returns inside the run', () => {
  const p = delver();
  const before = JSON.stringify(p);
  assert(zoneAction(p, { v: 'zone', a: 'dgb' }).toast);
  assertEquals(JSON.stringify(p), before);
  zoneAction(p, { v: 'zone', a: 'dg' });
  assertEquals(p.dungeonRun, undefined);
  assert(JSON.stringify(renderZone(p)).includes('No free rest'));
  zoneAction(p, { v: 'zone', a: 'dgb' });
  assert(p.dungeonRun && p.battle);
  p.hp = 7;
  p.mp = 1;
  resolveVictory(p, p.battle, () => 0.5);
  p.battle.phase = 'won';
  battleAction(p, { v: 'battle', a: 'go' });
  assert(p.dungeonRun);
  assertEquals(p.hp, 7);
  assertEquals(p.mp, 1);
  const controls = renderZone(p).blocks!.flatMap((b) => b.type === 'buttons' ? b.buttons : [])
    .flatMap((b) => 'callback_data' in b ? [decodeCb(b.callback_data)!.a] : []);
  assertEquals(controls, ['dg', 'inv', 'dx']);
  zoneAction(p, { v: 'zone', a: 'dx' });
  assertEquals(p.dungeonRun, undefined);
  zoneAction(p, { v: 'zone', a: 'dg' });
  zoneAction(p, { v: 'zone', a: 'dgb' });
  assertEquals(p.battle!.origin.kind === 'dungeon' && p.battle!.origin.floor, 1);
});

Deno.test('dungeon boundaries: external services and recovery trips refuse without spending', () => {
  const p = delver();
  const d = zone(p.currentZone)!.dungeon!;
  p.dungeonRun = { zoneId: p.currentZone, dungeonId: d.id, nextFloor: 2 };
  for (
    const operation of [
      () => explore(p),
      () => startJourney(p, 'w_whisperwood_mirefoot'),
      () => buy(p, 'c_potion'),
      () => craft(p, 'minor_potion'),
      () => temper(p, 'weapon'),
      () => gather(p, 'forage'),
      () => zoneAction(p, { v: 'zone', a: 'tk', arg: 0 }),
      () => zoneAction(p, { v: 'zone', a: 'gp' }),
      () => zoneAction(p, { v: 'zone', a: 'tv' }),
    ]
  ) {
    const before = JSON.stringify(p);
    operation();
    assertEquals(JSON.stringify(p), before);
  }
  const ctx = { dialogueId: 'dlg_m5_arms_offer', nodeId: 'oa', npcId: 'npc_bram', now: 1 };
  const before = JSON.stringify(p);
  assert(validateStoryBundle(p, [], ctx));
  assertThrows(() => applyStoryEffects(p, [], ctx));
  // Even the central arrival operation cannot grant a safe-haven heal.
  arriveAt(p, 'emberdawn');
  assertEquals(JSON.stringify(p), before);
  p.inventory = [{ id: 'c_minor_potion', qty: 1 }];
  p.hp = 1;
  assert(useRecoveryItem(p, 'c_minor_potion').ok);
  assertEquals(p.hp, 61);
  assert(!p.inventory.some((i) => i.id === 'c_minor_potion'));
});

Deno.test('dungeon controls: a replayed entry callback cannot begin a second attempt', async () => {
  const p = delver();
  p.scene = { view: 'zone', arg: 'bossok' };
  const store = new MemoryStore();
  await store.set(p.userId, p);
  const wire = withRev(p.uiRev, encodeCb({ v: 'zone', a: 'dgb' }));
  await handleCallback(fakeCtxCapture(p.userId, p.messageId, wire).ctx, store);
  const first = (await store.get(p.userId))!;
  assert(first.dungeonRun && first.battle);
  const before = JSON.stringify(first);
  await handleCallback(fakeCtxCapture(p.userId, p.messageId, wire).ctx, store);
  assertEquals(JSON.stringify(await store.get(p.userId)), before);
});
