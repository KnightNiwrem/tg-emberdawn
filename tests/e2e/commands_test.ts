/** E2E: slash commands beside the live game message. */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { listButtons } from 'tg-bot-api-emulator/clients/typescript/mod.ts';
import { completePrologue, travelTo, winBattle, withPlayer, withRoll } from './harness.ts';

Deno.test('e2e: /help replies without buttons and leaves the game playable', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Cleric');
    const live = await player.screen();

    await player.send('/help');

    const help = (await player.botMessages()).at(-1)!;
    assert(help.message_id > live.message_id, '/help sends its own message');
    assertEquals(listButtons(help), [], 'help never competes with the live message');
    assertEquals((await player.screen()).message_id, live.message_id);
    const inventory = await player.tap('Inventory');
    assertEquals(inventory.answer?.text, undefined, 'the live message still plays');
    assertStringIncludes(await player.screenText(), '🎒 Inventory');
    await player.tap('Back');
    await player.tap('Help');
    assertStringIncludes(await player.screenText(), 'Emberdawn — help');
    await player.tap('Back to the game');
    assertStringIncludes(await player.screenText(), 'Emberdawn Village');
  });
});

Deno.test('e2e: cancel /reset during a fight and finish the same battle', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');

    await travelTo(player, 'Emberdawn Outskirts');
    await withRoll(0.1, () => player.tap('Explore'));
    await player.tap('Strike');
    assertStringIncludes(await player.screenText(), 'Battle · Round 2');
    await player.send('/reset');
    assertStringIncludes(await player.screenText(), 'Delete this hero?');
    await player.tap('No — keep playing');

    assertStringIncludes(await player.screenText(), 'Battle · Round 2');
    await winBattle(player, 'Strike');
    await player.tap('Continue');
    await player.tap('Character');
    assertStringIncludes(await player.screenText(), 'Victories: 2');
  });
});

Deno.test('e2e: delete the hero from Character and choose a new class', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');

    await player.tap('Character');
    await player.tap('Delete hero');
    assertStringIncludes(await player.screenText(), 'Delete this hero?');
    await player.tap('Yes — start over');

    assertEquals(await player.labels(), ['Play Warrior', 'Play Mage', 'Play Rogue', 'Play Cleric']);
    await player.tap('Play Mage');
    assertStringIncludes(await player.screenText(), 'Lv 1 Mage');
    assertEquals(await player.labels(), ['🧓 Speak with Elder Maren', '❓ Help']);
  });
});
