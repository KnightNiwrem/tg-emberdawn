/** Resource controls stay on the revision-guarded live message. */
import { assert, assertEquals } from '@std/assert';
import type { InputRichMessage } from 'grammy/types';
import { decodeCb, encodeCb, withRev } from '../src/codec.ts';
import { RECIPES } from '../src/content/crafting.ts';
import { GATHERING_SITES } from '../src/content/gathering.ts';
import { item } from '../src/content/items.ts';
import { ZONES } from '../src/content/zones.ts';
import { createPlayer } from '../src/engine/character.ts';
import { startBattle } from '../src/engine/combat.ts';
import { countOf } from '../src/engine/inventory.ts';
import { materialSources, materialUses } from '../src/engine/materials.ts';
import { zoneAction } from '../src/handlers/hub.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { renderCrafting, renderGathering, renderZone } from '../src/render/views.ts';
import { itemFactBlocks } from '../src/render/menus.ts';
import { fakeCtxCapture } from './helpers.ts';

function controls(view: InputRichMessage): string[] {
  return (view.blocks ?? []).flatMap((block) =>
    block.type === 'buttons'
      ? block.buttons.flatMap((btn) => 'callback_data' in btn ? btn.callback_data : [])
      : []
  );
}

function player() {
  const player = createPlayer(2031, 'Gatherer', 'warrior');
  player.tutorial = 'done';
  player.messageId = 203;
  player.uiRev = 12;
  return player;
}

Deno.test('resources UI: local menus expose complete facts and valid bounded callbacks without mutation', () => {
  const crafter = player();
  crafter.level = 45;
  for (const zoneDef of ZONES) {
    crafter.currentZone = zoneDef.id;
    for (const scene of ['gather', 'craft'] as const) {
      for (let page = 0; page < 6; page++) {
        crafter.scene = { view: 'zone', panel: scene, page: page };
        const before = JSON.stringify(crafter);
        const view = renderZone(crafter);
        assertEquals(JSON.stringify(crafter), before, 'render is a pure projection');
        for (const wire of controls(view)) {
          const stamped = withRev(9999, wire);
          assert(new TextEncoder().encode(stamped).length <= 64);
          assert(decodeCb(stamped), stamped);
        }
      }
    }
  }
  crafter.currentZone = 'whisperwood';
  const fish = JSON.stringify(renderGathering(crafter));
  for (const fact of ['Fishing Rod', 'Worm Bait', 'Grub Bait', '70%', '90%', 'reusable']) {
    assert(fish.includes(fact), fact);
  }
  crafter.currentZone = 'emberdawn';
  crafter.scene = { view: 'zone', panel: 'craft', page: 0 };
  const recipe = RECIPES[0];
  const view = JSON.stringify(renderCrafting(crafter));
  for (const input of recipe.inputs) assert(view.includes(item(input.id)!.name));
  assert(view.includes(item(recipe.output.id)!.name));
  assert(view.includes(`Fee: ${recipe.gold}g`));
  assert(
    !controls(renderCrafting(crafter)).some((wire) => decodeCb(wire)?.a === 'cr'),
    'unaffordable craft disabled',
  );
});

Deno.test('resources UI: material facts explain uses and real acquisition sources', () => {
  assert(materialUses('m_pickaxe').some((description) => description.includes('Reusable')));
  assert(
    materialUses('m_worm_bait').some((description) => description.includes('one is consumed')),
  );
  assert(materialUses('m_iron_ingot').some((description) => description.includes('Tempering')));
  assert(materialUses('m_rat_tail').some((description) => description.includes('Trade good')));
  assert(materialSources('m_iron_ingot').some((description) => description.includes('Smelt iron')));
  for (const site of GATHERING_SITES) {
    for (const gatheringYield of [...site.yields, ...Object.values(site.baitTables ?? {}).flat()]) {
      assert(materialSources(gatheringYield.item).length > 0, gatheringYield.item);
    }
  }
  const text = JSON.stringify(itemFactBlocks(item('c_wild_berry')!));
  assert(text.includes('Restores 12 HP.'));
  assert(!text.includes('Brew Minor Potion'), 'recipe uses belong on the Uses page');
});

Deno.test('resources UI: forged remote and battle controls do not consume anything or navigate', () => {
  const crafter = player();
  crafter.currentZone = 'abyss';
  for (
    const cb of [
      { v: 'zone', a: 'cr', arg: 'minor_potion' },
      { v: 'zone', a: 'ga', arg: 'fish_worm' },
      { v: 'zone', a: 'ga', arg: 'unknown' },
    ] as const
  ) {
    const before = JSON.stringify(crafter);
    assert(zoneAction(crafter, cb).toast);
    assertEquals(JSON.stringify(crafter), before);
  }
  crafter.currentZone = 'emberdawn';
  crafter.battle = startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, {
    player: crafter,
    rng: () => 0.5,
  })!
    .battle;
  for (
    const cb of [
      { v: 'zone', a: 'gp' },
      { v: 'zone', a: 'cp', arg: 0 },
      { v: 'zone', a: 'cr', arg: 'minor_potion' },
      { v: 'zone', a: 'ga', arg: 'forage' },
    ] as const
  ) {
    const before = JSON.stringify(crafter);
    assert(zoneAction(crafter, cb).toast);
    assertEquals(JSON.stringify(crafter), before);
  }
});

Deno.test('resources UI: stale craft replay grants only one batch on the live message', async () => {
  const crafter = player();
  const recipe = RECIPES.find((recipe) => recipe.id === 'minor_potion')!;
  crafter.gold = 100;
  for (const materialCost of recipe.inputs) {
    crafter.inventory.push({ id: materialCost.id, qty: materialCost.qty * 2 });
  }
  crafter.scene = { view: 'zone', panel: 'craft', page: 0 };
  const before = countOf(crafter, recipe.output.id);
  const store = new MemoryStore();
  await store.set(crafter.userId, crafter);
  const wire = withRev(crafter.uiRev, encodeCb({ v: 'zone', a: 'cr', arg: recipe.id }));
  await handleCallback(fakeCtxCapture(crafter.userId, crafter.messageId, wire).ctx, store);
  const after = await store.get(crafter.userId);
  assertEquals(countOf(after!, recipe.output.id), before + recipe.output.qty);
  const snapshot = JSON.stringify(after);
  await handleCallback(fakeCtxCapture(crafter.userId, crafter.messageId, wire).ctx, store);
  assertEquals(JSON.stringify(await store.get(crafter.userId)), snapshot);
});
