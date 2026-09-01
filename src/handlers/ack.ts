/**
 * Callback-acknowledgment policy (#75): `answerCallbackQuery` is client
 * acknowledgment / toast delivery ONLY — its success is never required for
 * the game mutation, the message render, or persistence to be correct.
 *
 * In webhook mode an escaping rejection reaches createWebhookHandler, which
 * answers HTTP 500 — and Telegram retries non-2xx deliveries. The
 * redelivered callback query is older still, so its acknowledgment fails
 * again: a self-sustaining redelivery loop that wedges the chat behind it.
 * Every acknowledgment is therefore BEST EFFORT: attempt it promptly (the
 * normal client UX), log a failure, and continue the update. Failures of
 * ESSENTIAL operations — game-message delivery, database persistence —
 * keep propagating so Telegram can retry the action itself.
 */

import type { Context } from 'grammy';

/** Answers the callback query (toast included when given), swallowing and
 * logging every failure. The call stays awaited rather than fire-and-forget:
 * serverless execution may end after the HTTP response, so an un-awaited
 * acknowledgment could race the update's completion. */
export async function answerCallbackBestEffort(
  ctx: Context,
  answer?: Parameters<Context['answerCallbackQuery']>[0],
): Promise<void> {
  try {
    await ctx.answerCallbackQuery(answer);
  } catch (error) {
    // Safe shape only: update id + error class/message (a GrammyError's
    // message carries Telegram's description, e.g. "Bad Request: query is
    // too old…"). Never the token or the request payload.
    console.warn(
      `callback acknowledgment failed (update ${ctx.update?.update_id ?? '?'}); continuing`,
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    );
  }
}
