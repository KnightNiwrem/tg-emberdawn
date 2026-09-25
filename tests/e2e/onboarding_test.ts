/** E2E: a new player's first minutes, played only through the chat. */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { completePrologue, withPlayer } from './harness.ts';

Deno.test('e2e: /start offers every class on one rich message', async () => {
  await withPlayer(async (player) => {
    await player.send('/start');

    const botMessages = await player.botMessages();
    assertEquals(botMessages.length, 1);
    assert(botMessages[0]!.rich_message, 'the picker is a rich message');
    assertEquals(botMessages[0]!.reply_markup, undefined, 'buttons live in the message body');
    assertStringIncludes(await player.screenText(), 'Choose how you will face the road');
    assertEquals(await player.labels(), ['Play Warrior', 'Play Mage', 'Play Rogue', 'Play Cleric']);
  });
});

Deno.test('e2e: picking a class turns the picker into the village hub', async () => {
  await withPlayer(async (player) => {
    await player.send('/start');
    const picker = await player.screen();

    const pick = await player.tap('Play Mage');

    assertEquals(pick.status, 'answered', 'the tap is acknowledged');
    const hub = await player.screen();
    assertEquals(hub.message_id, picker.message_id, 'the picker is edited in place');
    assert(hub.edit_date !== undefined, 'the message shows as edited');
    const hubText = await player.screenText();
    assertStringIncludes(hubText, 'Emberdawn Village');
    assertStringIncludes(hubText, 'Ash · Lv 1 Mage');
    assertEquals(await player.labels(), ['🧓 Speak with Elder Maren', '❓ Help']);
  }, { playerName: 'Ash' });
});

for (const className of ['Warrior', 'Mage', 'Rogue', 'Cleric']) {
  Deno.test(`e2e: a ${className} plays the prologue into the open hub`, async () => {
    await withPlayer(async (player) => {
      await completePrologue(player, className);

      const hubText = await player.screenText();
      assertStringIncludes(hubText, 'Talk to Elder Maren');
      assertStringIncludes(hubText, 'Sparks of Trouble');
      const labels = await player.labels();
      for (const unlocked of ['🧭 Search', '🧺 Gather', '🛠️ Craft', '🚶 Travel']) {
        assert(labels.includes(unlocked), `${unlocked} is unlocked after the prologue`);
      }
      assertEquals((await player.botMessages()).length, 1, 'the whole prologue used one message');
    });
  });
}

Deno.test('e2e: the prologue fight levels the hero to 2', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');
    await player.tap('Character');

    assertStringIncludes(await player.screenText(), 'Lv 2 Warrior');
  });
});
