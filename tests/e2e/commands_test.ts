/** E2E: slash commands beside the live game message. */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { completePrologue, messageButtons, withPlayer } from './harness.ts';

Deno.test('e2e: /help replies without buttons and leaves the game playable', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Cleric');
    const live = await player.screen();

    await player.send('/help');

    const help = (await player.botMessages()).at(-1)!;
    assert(help.message_id > live.message_id, '/help sends its own message');
    assertEquals(messageButtons(help), [], 'help never competes with the live message');
    assertEquals((await player.screen()).message_id, live.message_id);
    const inventory = await player.tap('Inventory');
    assertEquals(inventory.answer?.text, undefined, 'the live message still plays');
  });
});

Deno.test('e2e: /reset asks first, and "No" keeps the hero', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');

    await player.send('/reset');
    assertStringIncludes(await player.screenText(), 'Delete this hero?');
    await player.tap('No — keep playing');

    await player.tap('Character');
    assertStringIncludes(await player.screenText(), 'Lv 2 Warrior');
  });
});

Deno.test('e2e: confirmed /reset starts a brand-new tale', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');

    await player.send('/reset');
    await player.tap('Yes — start over');

    assertEquals(await player.labels(), ['Play Warrior', 'Play Mage', 'Play Rogue', 'Play Cleric']);
    await player.tap('Play Mage');
    assertStringIncludes(await player.screenText(), 'Lv 1 Mage');
    assertEquals(await player.labels(), ['🧓 Speak with Elder Maren', '❓ Help']);
  });
});
