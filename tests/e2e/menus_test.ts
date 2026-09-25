/** Menu journeys with purchases, equipment changes, and crafted supplies visible in chat. */
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  completePrologue,
  findButton,
  travelTo,
  winBattle,
  withPlayer,
  withRoll,
} from './harness.ts';

Deno.test('e2e: inspect shop stock, buy a potion, sell it, and return to the bag', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');
    await player.tap('Shop');
    await player.tap('Next');
    assert((await player.labels()).includes('📄 2/2'));
    await player.tap('Details', { beside: 'Minor Potion' });
    assertStringIncludes(await player.screenText(), 'Price: 30g');
    assertStringIncludes(await player.screenText(), 'In bag: 3');
    await player.tap('Sources');
    assertStringIncludes(await player.screenText(), "Bram's Forge-stall");
    await player.tap('Item details');
    await player.tap('Buy · 30g');
    assertStringIncludes(await player.screenText(), 'In bag: 4');
    assertStringIncludes(await player.screenText(), '26 gold');
    assertEquals(findButton(await player.screen(), 'Buy — too costly').disabled, true);
    await player.tap('Shop');
    assert((await player.labels()).includes('📄 2/2'), 'detail returns to the same shelf page');
    await player.tap('Switch to selling');
    await player.tap('Sell Minor Potion');
    assertStringIncludes(await player.screenText(), 'Minor Potion ×3');
    assertStringIncludes(await player.screenText(), '38 gold');
    await player.tap('Back');
    await player.tap('Inventory');
    assert((await player.labels()).includes('🧪 Minor Potion ×3'));
    await player.tap('Minor Potion');
    assertStringIncludes(await player.screenText(), 'Minor Potion ×3');
    await player.tap('Back');
    assertStringIncludes(await player.screenText(), '🎒 Inventory');
    await player.tap('Back');
    assertStringIncludes(await player.screenText(), 'Emberdawn Village');
    assertEquals((await player.botMessages()).length, 1);
  });
});

Deno.test('e2e: inspect armor, unequip it, and equip the returned bag copy', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');
    await player.tap('Inventory');
    await player.tap('Equipment');
    await player.tap('Details', { beside: 'Padded Vest' });
    assertStringIncludes(await player.screenText(), 'Padded Vest');
    await player.tap('Equipment');
    await player.tap('Details', { beside: 'Rusty Blade' });
    assertStringIncludes(await player.screenText(), 'Rusty Blade');
    await player.tap('Equipment');
    await player.tap('Details', { beside: 'Padded Vest' });
    await player.tap('Unequip');
    assertStringIncludes(await player.screenText(), 'Armor: — empty —');
    await player.tap('Padded Vest');
    assertStringIncludes(await player.screenText(), 'Padded Vest ×1');
    await player.tap('⚔️ Equip');
    assertStringIncludes(await player.screenText(), 'Armor: Padded Vest');
    await player.tap('Back');
    await player.tap('Inventory');
    assert(!(await player.labels()).some((label) => label.includes('Padded Vest')));
    await player.tap('Back');
    await player.tap('Skills');
    assertStringIncludes(await player.screenText(), '✅ Cleave');
    assertStringIncludes(await player.screenText(), '🔒 Lv 4 Shield Bash');
    await player.tap('Back');
    assertStringIncludes(await player.screenText(), 'Emberdawn Village');
  });
});

Deno.test('e2e: gather ingredients, inspect their uses, and brew a potion', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');
    // Village Search rolls berries; gathering supplies the other ingredient.
    for (let berriesCollected = 0; berriesCollected < 3; berriesCollected++) {
      await withRoll(0.3, () => player.tap('Search'));
    }
    await player.tap('Gather');
    await withRoll(0.55, () => player.tap('Forage'));
    assertStringIncludes(await player.screenText(), 'Stored charges: 2/3');
    await player.tap('Back');
    await player.tap('Inventory');
    await player.tap('Wild Berries');
    await player.tap('Uses');
    assertStringIncludes(await player.screenText(), 'Brew Minor Potion');
    await player.tap('Item details');
    assertStringIncludes(await player.screenText(), 'Wild Berries ×3');
    await player.tap('Back');
    await player.tap('Back');
    await player.tap('Craft');
    assertStringIncludes(await player.screenText(), 'Local workshops · 1/');
    await player.tap('Next');
    assertStringIncludes(await player.screenText(), 'Brew Minor Potion');
    await player.tap('Make one batch', { beside: 'Brew Minor Potion' });
    assertStringIncludes(await player.screenText(), 'Wild Berries (have 0)');
    assertStringIncludes(await player.screenText(), 'Bitterleaf (have 1)');
    assertEquals(
      findButton(await player.screen(), 'Ingredients or requirements missing', 'Brew Minor Potion')
        .disabled,
      true,
    );
    await player.tap('Previous');
    assertStringIncludes(await player.screenText(), 'Local workshops · 1/');
    await player.tap('Back');
    await player.tap('Inventory');
    assert((await player.labels()).includes('🧪 Minor Potion ×4'));
    assert(!(await player.labels()).some((label) => label.includes('Wild Berries')));
    assertStringIncludes(await player.screenText(), '53 gold');
    await player.tap('Back');
    await player.tap('Gather');
    for (let chargesSpent = 0; chargesSpent < 2; chargesSpent++) await player.tap('Forage');
    assertStringIncludes(await player.screenText(), 'Stored charges: 0/3');
    const exhausted = await player.tap('Forage');
    assertStringIncludes(exhausted.answer?.text ?? '', 'need time to recover');
    assertStringIncludes(await player.screenText(), 'Stored charges: 0/3');
    await player.tap('Back');
    assertStringIncludes(await player.screenText(), 'Emberdawn Village');
  });
});

Deno.test('e2e: earn tempering materials, improve armor, and inspect the equipped result', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');
    await player.tap('Temper');
    const missing = await player.tap('Temper armor');
    assertStringIncludes(missing.answer?.text ?? '', 'Ember Shard');
    await player.tap('Back');
    await player.tap('Gather');
    for (let bundlesGathered = 0; bundlesGathered < 2; bundlesGathered++) {
      await withRoll(0, () => player.tap('Forage'));
    }
    await player.tap('Back');
    await travelTo(player, 'Emberdawn Outskirts');
    await withRoll(0.1, () => player.tap('Explore'));
    // This roll also selects the rat's ordinary material drops when the fight ends.
    await withRoll(0.1, () => winBattle(player, 'Strike'));
    assertStringIncludes(await player.screenText(), 'Ember Shard');
    await player.tap('Continue');
    await travelTo(player, 'Emberdawn Village');
    const goldBefore = +(await player.screenText()).match(/💰 (\d+)/)![1];
    await player.tap('Temper');
    await player.tap('Temper armor');
    assertStringIncludes(await player.screenText(), 'Padded Vest: +1/5');
    assertStringIncludes(await player.screenText(), `${goldBefore - 15} gold`);
    await player.tap('Back');
    await player.tap('Inventory');
    assert((await player.labels()).includes('🧱 Plant Fiber ×1'), 'tempering spent two fiber');
    await player.tap('Equipment');
    await player.tap('Details', { beside: 'Padded Vest' });
    assertStringIncludes(await player.screenText(), 'Padded Vest +1');
    await player.tap('Equipment');
    await player.tap('Back');
    assertStringIncludes(await player.screenText(), 'Emberdawn Village');
  });
});

Deno.test('e2e: inspect a second bag page and drop its last item without losing navigation', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Mage');
    // Stock a varied bag through real gathering and travel, then pack spare gear.
    await player.tap('Gather');
    for (const roll of [0, 0.3, 0.6]) await withRoll(roll, () => player.tap('Forage'));
    await player.tap('Back');
    await travelTo(player, 'Emberdawn Outskirts');
    await player.tap('Gather');
    for (const roll of [0.6, 0.9]) await withRoll(roll, () => player.tap('Forage'));
    await player.tap('Back');
    await player.tap('Inventory');
    await player.tap('Equipment');
    await player.tap('Unequip weapon');
    await player.tap('Unequip armor');
    await player.tap('Back');
    await player.tap('Inventory');
    await player.tap('Next');
    assert((await player.labels()).includes('📄 2/2'));
    // The last item is the armor just packed; select its visible label, not its ID.
    const armorLabel = (await player.labels()).find((label) => label.startsWith('🛡️ '));
    assert(armorLabel, 'packed armor appears on the second page');
    await player.tap(armorLabel);
    await player.tap('Sources');
    await player.tap('Item details');
    await player.tap('Back');
    assert((await player.labels()).includes('📄 2/2'), 'nested detail keeps the bag page');
    await player.tap(armorLabel);
    await player.tap('Drop');
    assertStringIncludes(await player.screenText(), '8 kinds of items');
    assert((await player.labels()).includes('📄 1/1'));
    assert(!(await player.labels()).some((label) => label.includes('Next')));
    await player.tap('Back');
    assertStringIncludes(await player.screenText(), 'Emberdawn Outskirts');
  });
});
