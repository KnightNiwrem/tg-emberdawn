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
  const player = createPlayer(2072, 'Delver', 'warrior');
  player.tutorial = 'done';
  player.currentZone = 'whisperwood';
  player.level = 45;
  player.gold = 10000;
  player.messageId = 207;
  player.uiRev = 11;
  return player;
}

Deno.test('hub composition: compact centered controls, one description, no dungeon checkpoint prose', () => {
  for (const zoneDef of ZONES) {
    const player = delver();
    player.currentZone = zoneDef.id;
    player.notices = [
      `🧭 You arrive at ${zoneDef.emoji} ${zoneDef.name}.`,
      zoneDef.desc,
      'A quest is ready.',
    ];
    const before = JSON.stringify(player);
    const view = renderZone(player);
    const text = JSON.stringify(view);
    assertEquals(JSON.stringify(player), before);
    assertEquals(view.blocks!.filter((block) => block.type === 'heading').length, 1);
    assertEquals(text.split(zoneDef.desc).length - 1, 1, zoneDef.id);
    assert(text.includes('A quest is ready.'));
    assert(!text.includes('Recommended Lv'));
    assert(!text.includes('rematch available'));
    const rows = view.blocks!.filter((button) => button.type === 'buttons');
    assert(rows.every((row) => row.align === 'center' && row.buttons.length > 0));
    assert(rows.every((row) => row.buttons.every((button) => !('disabled' in button))));
    const wires = rows.flatMap((row) =>
      row.buttons.flatMap((button) => 'callback_data' in button ? [button.callback_data] : [])
    );
    assertEquals(wires.includes(encodeCb({ v: 'zone', a: 'dg' })), !!zoneDef.dungeon);
  }
});

Deno.test('dungeon UI: entry requires its staged confirmation and victory returns inside the run', () => {
  const player = delver();
  const before = JSON.stringify(player);
  assert(zoneAction(player, { v: 'zone', a: 'dgb' }).toast);
  assertEquals(JSON.stringify(player), before);
  zoneAction(player, { v: 'zone', a: 'dg' });
  assertEquals(player.dungeonRun, undefined);
  assert(JSON.stringify(renderZone(player)).includes('No free rest'));
  zoneAction(player, { v: 'zone', a: 'dgb' });
  assert(player.dungeonRun && player.battle);
  player.hp = 7;
  player.mp = 1;
  resolveVictory(player, player.battle, () => 0.5);
  player.battle.phase = 'won';
  battleAction(player, { v: 'battle', a: 'go' });
  assert(player.dungeonRun);
  assertEquals(player.hp, 7);
  assertEquals(player.mp, 1);
  const controls = renderZone(player).blocks!.flatMap((button) =>
    button.type === 'buttons' ? button.buttons : []
  )
    .flatMap((button) => 'callback_data' in button ? [decodeCb(button.callback_data)!.a] : []);
  assertEquals(controls, ['dg', 'inv', 'dx']);
  zoneAction(player, { v: 'zone', a: 'dx' });
  assertEquals(player.dungeonRun, undefined);
  zoneAction(player, { v: 'zone', a: 'dg' });
  zoneAction(player, { v: 'zone', a: 'dgb' });
  assertEquals(player.battle!.origin.kind === 'dungeon' && player.battle!.origin.floor, 1);
});

Deno.test('dungeon boundaries: external services and recovery trips refuse without spending', () => {
  const player = delver();
  const dungeon = zone(player.currentZone)!.dungeon!;
  player.dungeonRun = { zoneId: player.currentZone, dungeonId: dungeon.id, nextFloor: 2 };
  for (
    const operation of [
      () => explore(player),
      () => startJourney(player, 'w_whisperwood_mirefoot'),
      () => buy(player, 'c_potion'),
      () => craft(player, 'minor_potion'),
      () => temper(player, 'weapon'),
      () => gather(player, 'forage'),
      () => zoneAction(player, { v: 'zone', a: 'tk', arg: 0 }),
      () => zoneAction(player, { v: 'zone', a: 'gp' }),
      () => zoneAction(player, { v: 'zone', a: 'tv' }),
    ]
  ) {
    const before = JSON.stringify(player);
    operation();
    assertEquals(JSON.stringify(player), before);
  }
  const ctx = { dialogueId: 'dlg_m5_arms_offer', nodeId: 'oa', npcId: 'npc_bram', now: 1 };
  const before = JSON.stringify(player);
  assert(validateStoryBundle(player, [], ctx));
  assertThrows(() => applyStoryEffects(player, [], ctx));
  // Even the central arrival operation cannot grant a safe-haven heal.
  arriveAt(player, 'emberdawn');
  assertEquals(JSON.stringify(player), before);
  player.inventory = [{ id: 'c_minor_potion', qty: 1 }];
  player.hp = 1;
  assert(useRecoveryItem(player, 'c_minor_potion').ok);
  assertEquals(player.hp, 61);
  assert(!player.inventory.some((entry) => entry.id === 'c_minor_potion'));
});

Deno.test('dungeon controls: a replayed entry callback cannot begin a second attempt', async () => {
  const player = delver();
  player.scene = { view: 'zone', panel: 'dungeonEntrance' };
  const store = new MemoryStore();
  await store.set(player.userId, player);
  const wire = withRev(player.uiRev, encodeCb({ v: 'zone', a: 'dgb' }));
  await handleCallback(fakeCtxCapture(player.userId, player.messageId, wire).ctx, store);
  const first = (await store.get(player.userId))!;
  assert(first.dungeonRun && first.battle);
  const before = JSON.stringify(first);
  await handleCallback(fakeCtxCapture(player.userId, player.messageId, wire).ctx, store);
  assertEquals(JSON.stringify(await store.get(player.userId)), before);
});
