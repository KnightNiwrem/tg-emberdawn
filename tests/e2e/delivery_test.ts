/** E2E: webhook authentication and Telegram failures at the I/O boundary
 * (#29, #75). */

import { assertEquals, assertObjectMatch, assertStringIncludes } from '@std/assert';
import { withPlayer } from './harness.ts';

Deno.test('e2e: updates signed with the wrong secret never reach the game', async () => {
  await withPlayer(async (player, world) => {
    await world.registerWebhookSecret('not-the-configured-secret');
    const start = await world.activity.position();

    const sent = await world.account.sendMessage({ to: world.chat, text: '/start' });

    // A refused update is handed over again at once, but only after the
    // first attempt was answered, so the retry fences that attempt. An
    // accepted update would be confirmed instead.
    const firstAttempt = await world.delivered(
      start,
      (update) => update.message?.message_id === sent.message_id,
    );
    const outcome = await world.activity.waitFor(
      { update_id: firstAttempt.update.update_id },
      { after: firstAttempt },
    );
    assertEquals(outcome.kind, 'update_delivered', 'the update was refused and retried');
    await world.activity.assertNone({ kind: 'bot_api_call' }, { after: start, before: outcome });
    const { last_error_message: deliveryError } = await world.webhookInfo();
    assertStringIncludes(deliveryError ?? '', '401');
    assertEquals(await player.botMessages(), [], 'the forged update got no reply');
  });
});

Deno.test('e2e: a rate-limited edit is redelivered and applied exactly once', async () => {
  await withPlayer(async (player, world) => {
    await player.send('/start');
    await player.tap('Play Warrior');
    await player.tap('Speak with Elder Maren');
    await player.tap('Take the ember');
    await player.tap('Face the cinder mite');
    await world.rateLimit('editMessageText');
    const start = await world.activity.position();

    await player.tap('Strike');

    // The failed edit answers the webhook 500, so the emulator hands the same
    // callback over again; its acknowledgment then fails (already answered)
    // and the replayed tap renders the one strike.
    const sequence = world.activity.cursor({ after: start });
    const failedEdit = await sequence.next({ method: 'editMessageText', ok: false });
    assertObjectMatch(failedEdit.answer, { error_code: 429 });
    await sequence.next({ kind: 'update_delivered' });
    const repeatedAck = await sequence.next({ method: 'answerCallbackQuery' });
    assertEquals(repeatedAck.answer.ok, false, 'the query was already answered');
    const edit = await sequence.next({ method: 'editMessageText' });
    assertEquals(edit.answer.ok, true);
    const screenText = await player.screenText();
    assertStringIncludes(screenText, 'Battle · Round 2');
    assertEquals(screenText.match(/Strike hits Cinder Mite/g)?.length, 1, 'one strike landed');
    assertEquals((await player.botMessages()).length, 1, 'no duplicate live message');
  });
});

Deno.test('e2e: a failed acknowledgment still plays the tap', async () => {
  await withPlayer(async (player, world) => {
    await player.send('/start');
    await world.rateLimit('answerCallbackQuery');
    const start = await world.activity.position();

    const pick = await player.tap('Play Rogue');

    const sequence = world.activity.cursor({ after: start });
    const failedAck = await sequence.next({ method: 'answerCallbackQuery' });
    assertObjectMatch(failedAck.answer, { ok: false, error_code: 429 });
    const edit = await sequence.next({ method: 'editMessageText' });
    assertEquals(edit.answer.ok, true, 'the tap still rendered');
    assertEquals(pick.status, 'awaiting_answer', 'the toast was lost');
    assertStringIncludes(await player.screenText(), 'Lv 1 Rogue');
  });
});
