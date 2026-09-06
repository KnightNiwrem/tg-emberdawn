import { assert, assertEquals } from '@std/assert';
import { RECIPES } from '../src/content/crafting.ts';
import { item, sellPrice } from '../src/content/items.ts';
import { ZONES } from '../src/content/zones.ts';
import { createPlayer } from '../src/engine/character.ts';
import { craft, recipeBlock, recipesAt } from '../src/engine/crafting.ts';
import { temper, temperCost, temperMaterialsForTier } from '../src/engine/forge.ts';
import { addItem, countOf } from '../src/engine/inventory.ts';

Deno.test('processing catalog resolves identities and cannot turn purchased inputs into sale profit', () => {
  assertEquals(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length);
  for (const r of RECIPES) {
    assert(r.inputs.length > 1);
    assertEquals(new Set(r.inputs.map((i) => i.id)).size, r.inputs.length);
    for (const zone of r.zones) assert(ZONES.some((z) => z.id === zone));
    assert(item(r.output.id));
    let inputValue = r.gold;
    for (const input of r.inputs) {
      assert(item(input.id));
      assert(Number.isInteger(input.qty) && input.qty > 0);
      inputValue += item(input.id)!.price * input.qty;
    }
    assert(sellPrice(r.output.id) * r.output.qty <= inputValue, r.id);
  }
});

Deno.test('every processing recipe debits exact inputs and grants exact output at its local counter', () => {
  for (const r of RECIPES) {
    const p = createPlayer(1, 'T', 'warrior');
    p.level = 45;
    p.currentZone = r.zones[0]!;
    p.gold = r.gold;
    p.inventory = [];
    for (const input of r.inputs) addItem(p, input.id, input.qty);
    assert(craft(p, r.id).ok, r.id);
    assertEquals(p.gold, 0);
    assertEquals(p.inventory, [{ id: r.output.id, qty: r.output.qty }]);
  }
});

Deno.test('processing refuses missing last ingredient, money, level, and wrong location without mutation', () => {
  const r = RECIPES.find((r) => r.id === 'eel_stew')!;
  for (const scenario of ['ingredient', 'gold', 'level', 'zone', 'unknown']) {
    const p = createPlayer(2, 'T', 'warrior');
    p.currentZone = 'mirefoot';
    p.level = 10;
    p.gold = 100;
    for (const input of r.inputs) addItem(p, input.id, input.qty);
    if (scenario === 'ingredient') p.inventory = p.inventory.filter((i) => i.id !== 'm_salt');
    if (scenario === 'gold') p.gold = 0;
    if (scenario === 'level') p.level = 1;
    if (scenario === 'zone') p.currentZone = 'abyss';
    const before = structuredClone(p);
    assert(!craft(p, scenario === 'unknown' ? 'invented' : r.id).ok);
    assertEquals(p, before, scenario);
  }
});

Deno.test('processing discloses future recipes and refuses fights and journeys', () => {
  const p = createPlayer(3, 'T', 'warrior');
  assert(recipesAt(p).some((r) => r.id === 'eel_stew'));
  assert(recipeBlock(p, 'eel_stew')?.includes('level'));
  p.battle = {} as NonNullable<typeof p.battle>;
  const before = structuredClone(p);
  assert(!craft(p, 'minor_potion').ok);
  assertEquals(p, before);
  delete p.battle;
  p.journey = {} as NonNullable<typeof p.journey>;
  const onRoad = structuredClone(p);
  assert(!craft(p, 'minor_potion').ok);
  assertEquals(p, onRoad);
});

Deno.test('tempering validates all materials atomically and charges modest tier-based fees', () => {
  const p = createPlayer(4, 'T', 'warrior');
  p.gold = 100;
  addItem(p, 'm_ember_shard', 3);
  const before = structuredClone(p);
  assert(!temper(p, 'weapon').ok);
  assertEquals(p, before);
  addItem(p, 'm_hardwood', 2);
  const cost = temperCost(p, 'weapon')!;
  assertEquals(cost, {
    gold: 15,
    materials: [{ id: 'm_ember_shard', qty: 1 }, { id: 'm_hardwood', qty: 2 }],
  });
  assert(temper(p, 'weapon').ok);
  assertEquals(countOf(p, 'm_ember_shard'), 2);
  assertEquals(countOf(p, 'm_hardwood'), 0);
  assertEquals(p.gold, 85);
  for (let tier = 1; tier <= 8; tier++) {
    for (const slot of ['weapon', 'armor'] as const) {
      p.equipment[slot] = `${slot === 'weapon' ? 'w' : 'a'}_warrior_${tier}`;
      const materials = temperCost(p, slot)!.materials;
      assertEquals(materials.map((m) => m.id), temperMaterialsForTier(tier, slot));
      for (const material of materials) assert(item(material.id));
    }
  }
});

Deno.test('starter forge makes gathering tools through ordinary processing', () => {
  const p = createPlayer(5, 'T', 'warrior');
  p.inventory = [];
  p.gold = 13;
  addItem(p, 'm_hardwood', 2);
  addItem(p, 'm_plant_fiber', 2);
  addItem(p, 'm_bone', 1);
  addItem(p, 'm_iron_chunk', 2);
  addItem(p, 'm_coal', 1);
  assert(craft(p, 'fishing_rod').ok);
  assert(craft(p, 'iron_ingot').ok);
  assert(craft(p, 'pickaxe').ok);
  assertEquals(p.gold, 0);
  assertEquals(p.inventory, [{ id: 'm_fishing_rod', qty: 1 }, { id: 'm_pickaxe', qty: 1 }]);
});
