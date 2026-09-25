/** A new player learns each class's actions and reaches the playable village. */
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { BASIC_ACTION, FIRST_SKILL, startPrologue, winBattle, withPlayer } from './harness.ts';

for (const className of ['Warrior', 'Mage', 'Rogue', 'Cleric'] as const) {
  Deno.test(`e2e: a ${className} learns combat and opens the village menus`, async () => {
    await withPlayer(async (player) => {
      await startPrologue(player, className);
      assertStringIncludes(await player.screenText(), 'Battle · Round 1');
      await player.tap(BASIC_ACTION[className]);
      assertStringIncludes(await player.screenText(), 'Battle · Round 2');
      await player.tap('Skills');
      await player.tap(FIRST_SKILL[className]);
      assertStringIncludes(await player.screenText(), 'Battle · Round 3');
      await player.tap('Guard');
      assertStringIncludes(await player.screenText(), 'Battle · Round 4');
      await player.tap('Items');
      await player.tap('Use Minor Potion');
      assertStringIncludes(await player.screenText(), 'Battle · Round 5');
      await winBattle(player, BASIC_ACTION[className]);
      assertStringIncludes(await player.screenText(), 'Spoils:');
      await player.tap('Continue');

      assertStringIncludes(await player.screenText(), 'Talk to Elder Maren');
      for (const unlocked of ['🧭 Search', '🧺 Gather', '🛠️ Craft', '🚶 Travel']) {
        assert((await player.labels()).includes(unlocked));
      }
      await player.tap('Character');
      assertStringIncludes(await player.screenText(), `Ash — Lv 2 ${className}`);
      assertStringIncludes(await player.screenText(), 'Victories: 1');
      await player.tap('Inventory');
      assert(
        (await player.labels()).includes(`🧪 Minor Potion ×${className === 'Warrior' ? 3 : 2}`),
        'lesson potion was replaced',
      );
      await player.tap('Back');
      assertStringIncludes(await player.screenText(), 'Emberdawn Village');
      const messages = await player.botMessages();
      assertEquals(messages.length, 1, 'onboarding and menu navigation edit one message');
      assert(messages[0].rich_message);
      assertEquals(messages[0].reply_markup, undefined, 'controls are in the rich message body');
    });
  });
}
