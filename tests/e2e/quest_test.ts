/** A quest is read in the journal, accepted in person, fought, and reported. */
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { completePrologue, travelTo, winBattle, withPlayer, withRoll } from './harness.ts';

Deno.test('e2e: follow Sparks of Trouble from the journal through Maren to its reward', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');
    await player.tap('Quests');
    await player.tap('Sparks of Trouble');
    assertStringIncludes(await player.screenText(), 'Start with Elder Maren');
    assertEquals(await player.labels(), ['⬅️ Back'], 'the journal directs the player to Maren');
    await player.tap('Back');
    await player.tap('Back');
    await player.tap('Elder Maren');
    await player.tap('Sparks of Trouble');
    await player.tap('Continue');
    await player.tap('Continue');
    await player.tap('Not now');
    assert((await player.labels()).includes('📜 Sparks of Trouble'), 'deferring keeps the offer');
    await player.tap('Sparks of Trouble');
    await player.tap('Continue');
    await player.tap('Continue');
    await player.tap('Accept');
    assertStringIncludes(await player.screenText(), 'Quest accepted: Sparks of Trouble');
    await player.tap('Leave');
    await travelTo(player, 'Emberdawn Outskirts');

    for (let ratsDefeated = 0; ratsDefeated < 4; ratsDefeated++) {
      await withRoll(0.1, () => player.tap('Explore'));
      assertStringIncludes(await player.screenText(), 'Ember Rat');
      await winBattle(player, 'Strike');
      if (ratsDefeated === 3) {
        assertStringIncludes(await player.screenText(), '“Sparks of Trouble” is ready to turn in!');
      }
      await player.tap('Continue');
    }
    await player.tap('Quests');
    await player.tap('Ready — view details');
    assertStringIncludes(await player.screenText(), 'Finish with Elder Maren');
    assertEquals(await player.labels(), ['⬅️ Back']);
    await player.tap('Back');
    await player.tap('Back');
    await travelTo(player, 'Emberdawn Village');
    await player.tap('Elder Maren');
    await player.tap('Sparks of Trouble');
    await player.tap('Continue');
    await player.tap('Continue');
    await player.tap('Report the quiet roads');
    assertStringIncludes(await player.screenText(), 'She presses the letter into your hands');
    await player.tap('End conversation');
    assert(!(await player.labels()).some((label) => label.includes('Sparks of Trouble')));
    await player.tap('Leave');
    await player.tap('Inventory');
    assert((await player.labels()).includes('📜 Sealed Letter ×1'));
    await player.tap('Back');
    await player.tap('Character');
    assertStringIncludes(await player.screenText(), 'Quests done: 1');
    assertStringIncludes(await player.screenText(), 'Victories: 5');
    assertEquals((await player.botMessages()).length, 1);
  });
});
