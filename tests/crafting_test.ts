import { assert, assertEquals } from '@std/assert';
import { RECIPES } from '../src/content/crafting.ts';
import { item, sellPrice } from '../src/content/items.ts';
import { ZONES } from '../src/content/zones.ts';
import { createPlayer } from '../src/engine/character.ts';
import { craft, recipeBlock, recipesAt } from '../src/engine/crafting.ts';
import { temper, temperCost, temperMaterialsForTier } from '../src/engine/forge.ts';
import { addItem, countOf } from '../src/engine/inventory.ts';

Deno.test('processing catalog resolves identities and cannot turn purchased inputs into sale profit', () => {
  assertEquals(new Set(RECIPES.map((recipe) => recipe.id)).size, RECIPES.length);
  for (const recipe of RECIPES) {
    assert(recipe.inputs.length > 1);
    assertEquals(
      new Set(recipe.inputs.map((materialCost) => materialCost.id)).size,
      recipe.inputs.length,
    );
    for (const zone of recipe.zones) assert(ZONES.some((zoneDef) => zoneDef.id === zone));
    assert(item(recipe.output.id));
    let inputValue = recipe.gold;
    for (const input of recipe.inputs) {
      assert(item(input.id));
      assert(Number.isInteger(input.qty) && input.qty > 0);
      inputValue += item(input.id)!.price * input.qty;
    }
    assert(sellPrice(recipe.output.id) * recipe.output.qty <= inputValue, recipe.id);
  }
});

Deno.test('every processing recipe debits exact inputs and grants exact output at its local counter', () => {
  for (const recipe of RECIPES) {
    const player = createPlayer(1, 'T', 'warrior');
    player.level = 45;
    player.currentZone = recipe.zones[0]!;
    player.gold = recipe.gold;
    player.inventory = [];
    for (const input of recipe.inputs) addItem(player, input.id, input.qty);
    assert(craft(player, recipe.id).ok, recipe.id);
    assertEquals(player.gold, 0);
    assertEquals(player.inventory, [{ id: recipe.output.id, qty: recipe.output.qty }]);
  }
});

Deno.test('processing refuses missing last ingredient, money, level, and wrong location without mutation', () => {
  const recipe = RECIPES.find((recipe) => recipe.id === 'eel_stew')!;
  for (const scenario of ['ingredient', 'gold', 'level', 'zone', 'unknown']) {
    const player = createPlayer(2, 'T', 'warrior');
    player.currentZone = 'mirefoot';
    player.level = 10;
    player.gold = 100;
    for (const input of recipe.inputs) addItem(player, input.id, input.qty);
    if (scenario === 'ingredient') {
      player.inventory = player.inventory.filter((entry) => entry.id !== 'm_salt');
    }
    if (scenario === 'gold') player.gold = 0;
    if (scenario === 'level') player.level = 1;
    if (scenario === 'zone') player.currentZone = 'abyss';
    const before = structuredClone(player);
    assert(!craft(player, scenario === 'unknown' ? 'invented' : recipe.id).ok);
    assertEquals(player, before, scenario);
  }
});

Deno.test('processing discloses future recipes and refuses fights and journeys', () => {
  const player = createPlayer(3, 'T', 'warrior');
  assert(recipesAt(player).some((recipe) => recipe.id === 'eel_stew'));
  assert(recipeBlock(player, 'eel_stew')?.includes('level'));
  player.battle = {} as NonNullable<typeof player.battle>;
  const before = structuredClone(player);
  assert(!craft(player, 'minor_potion').ok);
  assertEquals(player, before);
  delete player.battle;
  player.journey = {} as NonNullable<typeof player.journey>;
  const onRoad = structuredClone(player);
  assert(!craft(player, 'minor_potion').ok);
  assertEquals(player, onRoad);
});

Deno.test('tempering validates all materials atomically and charges modest tier-based fees', () => {
  const player = createPlayer(4, 'T', 'warrior');
  player.gold = 100;
  addItem(player, 'm_ember_shard', 3);
  const before = structuredClone(player);
  assert(!temper(player, 'weapon').ok);
  assertEquals(player, before);
  addItem(player, 'm_hardwood', 2);
  const cost = temperCost(player, 'weapon')!;
  assertEquals(cost, {
    gold: 15,
    materials: [{ id: 'm_ember_shard', qty: 1 }, { id: 'm_hardwood', qty: 2 }],
  });
  assert(temper(player, 'weapon').ok);
  assertEquals(countOf(player, 'm_ember_shard'), 2);
  assertEquals(countOf(player, 'm_hardwood'), 0);
  assertEquals(player.gold, 85);
  for (let tier = 1; tier <= 8; tier++) {
    for (const slot of ['weapon', 'armor'] as const) {
      player.equipment[slot] = `${slot === 'weapon' ? 'w' : 'a'}_warrior_${tier}`;
      const materials = temperCost(player, slot)!.materials;
      assertEquals(
        materials.map((materialCost) => materialCost.id),
        temperMaterialsForTier(tier, slot),
      );
      for (const material of materials) assert(item(material.id));
    }
  }
});

Deno.test('starter forge makes gathering tools through ordinary processing', () => {
  const player = createPlayer(5, 'T', 'warrior');
  player.inventory = [];
  player.gold = 13;
  addItem(player, 'm_hardwood', 2);
  addItem(player, 'm_plant_fiber', 2);
  addItem(player, 'm_bone', 1);
  addItem(player, 'm_iron_chunk', 2);
  addItem(player, 'm_coal', 1);
  assert(craft(player, 'fishing_rod').ok);
  assert(craft(player, 'iron_ingot').ok);
  assert(craft(player, 'pickaxe').ok);
  assertEquals(player.gold, 0);
  assertEquals(player.inventory, [{ id: 'm_fishing_rod', qty: 1 }, { id: 'm_pickaxe', qty: 1 }]);
});
