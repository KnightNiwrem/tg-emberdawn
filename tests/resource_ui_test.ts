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
  return (view.blocks ?? []).flatMap((b) =>
    b.type === 'buttons'
      ? b.buttons.flatMap((btn) => 'callback_data' in btn ? btn.callback_data : [])
      : []
  );
}

function player() {
  const p = createPlayer(2031, 'Gatherer', 'warrior');
  p.tutorial = 'done';
  p.messageId = 203;
  p.uiRev = 12;
  return p;
}

Deno.test('resources UI: local menus expose complete facts and valid bounded callbacks without mutation', () => {
  const p = player();
  p.level = 45;
  for (const z of ZONES) {
    p.currentZone = z.id;
    for (const scene of ['gather', 'craft']) {
      for (let page = 0; page < 6; page++) {
        p.scene = { view: 'zone', arg: scene, arg2: String(page) };
        const before = JSON.stringify(p);
        const view = renderZone(p);
        assertEquals(JSON.stringify(p), before, 'render is a pure projection');
        for (const wire of controls(view)) {
          const stamped = withRev(9999, wire);
          assert(new TextEncoder().encode(stamped).length <= 64);
          assert(decodeCb(stamped), stamped);
        }
      }
    }
  }
  p.currentZone = 'whisperwood';
  const fish = JSON.stringify(renderGathering(p));
  for (const fact of ['Fishing Rod', 'Worm Bait', 'Grub Bait', '70%', '90%', 'reusable']) {
    assert(fish.includes(fact), fact);
  }
  p.currentZone = 'emberdawn';
  p.scene = { view: 'zone', arg: 'craft', arg2: '0' };
  const recipe = RECIPES[0];
  const view = JSON.stringify(renderCrafting(p));
  for (const input of recipe.inputs) assert(view.includes(item(input.id)!.name));
  assert(view.includes(item(recipe.output.id)!.name));
  assert(view.includes(`Fee: ${recipe.gold}g`));
  assert(
    !controls(renderCrafting(p)).some((wire) => decodeCb(wire)?.a === 'cr'),
    'unaffordable craft disabled',
  );
});

Deno.test('resources UI: material facts explain uses and real acquisition sources', () => {
  assert(materialUses('m_pickaxe').some((s) => s.includes('Reusable')));
  assert(materialUses('m_worm_bait').some((s) => s.includes('one is consumed')));
  assert(materialUses('m_iron_ingot').some((s) => s.includes('Tempering')));
  assert(materialUses('m_rat_tail').some((s) => s.includes('Trade good')));
  assert(materialSources('m_iron_ingot').some((s) => s.includes('Smelt iron')));
  for (const site of GATHERING_SITES) {
    for (const y of [...site.yields, ...Object.values(site.baitTables ?? {}).flat()]) {
      assert(materialSources(y.item).length > 0, y.item);
    }
  }
  const text = JSON.stringify(itemFactBlocks(item('c_wild_berry')!));
  assert(text.includes('Restores 12 HP.'));
  assert(!text.includes('Brew Minor Potion'), 'recipe uses belong on the Uses page');
});

Deno.test('resources UI: forged remote and battle controls do not consume anything or navigate', () => {
  const p = player();
  p.currentZone = 'abyss';
  for (
    const cb of [
      { v: 'zone', a: 'cr', arg: 'minor_potion' },
      { v: 'zone', a: 'ga', arg: 'fish_worm' },
      { v: 'zone', a: 'ga', arg: 'unknown' },
    ] as const
  ) {
    const before = JSON.stringify(p);
    assert(zoneAction(p, cb).toast);
    assertEquals(JSON.stringify(p), before);
  }
  p.currentZone = 'emberdawn';
  p.battle =
    startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, { player: p, rng: () => 0.5 })!
      .battle;
  for (
    const cb of [
      { v: 'zone', a: 'gp' },
      { v: 'zone', a: 'cp', arg: 0 },
      { v: 'zone', a: 'cr', arg: 'minor_potion' },
      { v: 'zone', a: 'ga', arg: 'forage' },
    ] as const
  ) {
    const before = JSON.stringify(p);
    assert(zoneAction(p, cb).toast);
    assertEquals(JSON.stringify(p), before);
  }
});

Deno.test('resources UI: stale craft replay grants only one batch on the live message', async () => {
  const p = player();
  const r = RECIPES.find((r) => r.id === 'minor_potion')!;
  p.gold = 100;
  for (const m of r.inputs) p.inventory.push({ id: m.id, qty: m.qty * 2 });
  p.scene = { view: 'zone', arg: 'craft', arg2: '0' };
  const before = countOf(p, r.output.id);
  const store = new MemoryStore();
  await store.set(p.userId, p);
  const wire = withRev(p.uiRev, encodeCb({ v: 'zone', a: 'cr', arg: r.id }));
  await handleCallback(fakeCtxCapture(p.userId, p.messageId, wire).ctx, store);
  const after = await store.get(p.userId);
  assertEquals(countOf(after!, r.output.id), before + r.output.qty);
  const snapshot = JSON.stringify(after);
  await handleCallback(fakeCtxCapture(p.userId, p.messageId, wire).ctx, store);
  assertEquals(JSON.stringify(await store.get(p.userId)), snapshot);
});
