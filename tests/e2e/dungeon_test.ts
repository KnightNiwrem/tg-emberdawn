/** A short dungeon expedition, using only earned gear and carried supplies. */
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { completePrologue, travelTo, winBattle, withPlayer, withRoll } from './harness.ts';

Deno.test('e2e: clear a dungeon floor, use supplies, leave, and restart the descent', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');
    await travelTo(player, 'Emberdawn Outskirts');
    await travelTo(player, 'Whisperwood');
    await player.tap('Rootbound Hollow');
    assertStringIncludes(await player.screenText(), 'Recommended Lv 7 · Your level: 2');
    assertStringIncludes(await player.screenText(), 'The boss cannot be fled');
    await player.tap('Not now');
    assertStringIncludes(await player.screenText(), '🌲 Whisperwood');
    await player.tap('Rootbound Hollow');
    await player.tap('Enter dungeon');
    assertStringIncludes(await player.screenText(), 'Floor 1:');
    await winBattle(player, 'Strike');
    assertStringIncludes(await player.screenText(), 'Floor cache: Iron Chunk');
    await player.tap('Continue');
    assertStringIncludes(await player.screenText(), 'Next: floor 2 of 5');
    assertEquals(await player.labels(), ['Continue', '🎒 Supplies', 'Leave dungeon']);
    await player.tap('Supplies');
    assert((await player.labels()).includes('🧱 Iron Chunk ×1'));
    await player.tap('Minor Potion');
    await player.tap('🧪 Use');
    assertStringIncludes(await player.screenText(), 'Minor Potion ×2');
    await player.tap('Back');
    assertStringIncludes(await player.screenText(), '🎒 Inventory');
    await player.tap('Back');
    assertStringIncludes(await player.screenText(), 'Next: floor 2 of 5');
    await player.tap('Leave dungeon');
    assertStringIncludes(await player.screenText(), '🌲 Whisperwood');
    await player.tap('Rootbound Hollow');
    await player.tap('Enter dungeon');
    assertStringIncludes(await player.screenText(), 'Floor 1:');
    await withRoll(0, () => player.tap('Flee'));
    assertStringIncludes(await player.screenText(), '🌲 Whisperwood');
    await player.tap('Inventory');
    assert((await player.labels()).includes('🧱 Iron Chunk ×1'), 'earned cache survives retreat');
    await player.tap('Back');
    await travelTo(player, 'Emberdawn Outskirts');
    await travelTo(player, 'Emberdawn Village');
    assertStringIncludes(await player.screenText(), 'Emberdawn Village');
    assertEquals((await player.botMessages()).length, 1);
  });
});
