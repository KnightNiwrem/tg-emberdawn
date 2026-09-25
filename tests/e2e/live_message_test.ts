/** E2E: one live message per player, and stale-tap protection as a real
 * client experiences it (#16, #43). */

import { assert, assertEquals, assertNotEquals, assertStringIncludes } from '@std/assert';
import { completePrologue, messageText, withPlayer } from './harness.ts';

const STALE_TOAST = 'That message is stale';

Deno.test('e2e: navigating menus edits the one live message', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Rogue');
    const live = await player.screen();

    await player.tap('Inventory');
    assert((await player.labels()).some((label) => label.includes('Minor Potion')));
    await player.tap('Back');
    await player.tap('Character');
    await player.tap('Back');
    await player.tap('Shop');
    await player.tap('Back');

    const botMessages = await player.botMessages();
    assertEquals(botMessages.map((message) => message.message_id), [live.message_id]);
    assertStringIncludes(await player.screenText(), 'Emberdawn Village');
  });
});

Deno.test('e2e: /start re-centers on a fresh message and the old copy goes stale', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');
    const oldCopy = await player.screen();

    await player.send('/start');
    const freshCopy = await player.screen();
    assertNotEquals(freshCopy.message_id, oldCopy.message_id, '/start sends a new live message');
    assertStringIncludes(await player.screenText(), 'The flame guides you back');
    const freshText = messageText(freshCopy);

    const staleTap = await player.tap('Inventory', oldCopy);

    assertStringIncludes(staleTap.answer?.text ?? '', STALE_TOAST);
    const [oldAfter, freshAfter] = await Promise.all([
      player.botMessages().then((messages) =>
        messages.find((message) => message.message_id === oldCopy.message_id)!
      ),
      player.screen(),
    ]);
    assertEquals(messageText(oldAfter), messageText(oldCopy), 'the old copy is untouched');
    assertEquals(messageText(freshAfter), freshText, 'the live message is untouched');
  });
});

Deno.test('e2e: a double tap acts once; the second tap is stale', async () => {
  await withPlayer(async (player, world) => {
    await player.send('/start');
    await player.tap('Play Warrior');
    await player.tap('Speak with Elder Maren');
    await player.tap('Take the ember');
    await player.tap('Face the cinder mite');
    assertStringIncludes(await player.screenText(), 'Battle · Round 1');

    // Both presses reach the emulator before the bot handles either.
    const start = await world.activity.position();
    const release = world.holdDeliveries();
    const firstPress = await player.press('Strike');
    const secondPress = await player.press('Strike');
    release();
    const firstHandled = await world.pressHandled(start, firstPress);
    const secondHandled = await world.pressHandled(start, secondPress);

    await world.activity.assertNone(
      { method: 'editMessageText' },
      { after: firstHandled, before: secondHandled },
    );
    const first = await world.account.getCallbackQuery(firstPress.id);
    const second = await world.account.getCallbackQuery(secondPress.id);
    assertEquals(first.answer?.text, undefined, 'the first tap strikes silently');
    assertStringIncludes(second.answer?.text ?? '', STALE_TOAST);
    const screenText = await player.screenText();
    assertStringIncludes(screenText, 'Battle · Round 2', 'exactly one round resolved');
    assert(!screenText.includes('Round 2 result'), 'no second strike was resolved');
  });
});
