/** HTTP-level tests for webhook request authentication (#29) and the
 * callback-acknowledgment policy (#75). */

import { assert, assertEquals } from '@std/assert';
import { GrammyError, webhookCallback } from 'grammy';
import type { Bot, Context } from 'grammy';
import { prepareBot } from 'grammy-testing';
import { createBot } from '../src/bot.ts';
import { withRev } from '../src/codec.ts';
import { createPlayer } from '../src/engine/character.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { createWebhookHandler, secretMatches } from '../src/webhook-server.ts';

function post(headers: HeadersInit): Request {
  return new Request('https://app.example/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify({ update_id: 1 }),
  });
}

Deno.test('webhook: updates with a missing or wrong secret never reach the bot (#29)', async () => {
  let reached = 0;
  const handleUpdate = () => {
    reached++;
    return Promise.resolve(new Response('ok'));
  };
  const handler = createWebhookHandler({ handleUpdate, secretToken: 's3cret' });

  const good = await handler(post({ 'x-telegram-bot-api-secret-token': 's3cret' }));
  assertEquals(good.status, 200);
  assertEquals(reached, 1, 'correct secret reaches the bot');

  const missing = await handler(post({}));
  assertEquals(missing.status, 401);
  assertEquals(reached, 1, 'missing secret is rejected BEFORE the bot');

  const wrong = await handler(post({ 'x-telegram-bot-api-secret-token': 'nope' }));
  assertEquals(wrong.status, 401);
  assertEquals(reached, 1, 'wrong secret is rejected BEFORE the bot');

  // Health endpoints stay open; unknown paths still 404.
  assertEquals((await handler(new Request('https://app.example/healthz'))).status, 200);
  assertEquals((await handler(new Request('https://app.example/nope'))).status, 404);
});

Deno.test('secretMatches: exact compare, null-safe, length-safe', () => {
  assert(secretMatches('abc', 'abc'));
  assert(!secretMatches(null, 'abc'), 'Headers.get() miss → null → reject');
  assert(!secretMatches('abd', 'abc'));
  assert(!secretMatches('abcd', 'abc'), 'length mismatch must not throw or pass');
});

const EXPIRED = 'Bad Request: query is too old and response timeout expired or query ID is invalid';

/** Builds the platform handler around the REAL bot wired to a MemoryStore,
 * with `mapApi` free to install API-level failures. prepareBot() seeds
 * botInfo so webhookCallback's lazy init() never touches the network. */
async function webhookHarness(mapApi: (bot: Bot<Context>) => void) {
  const store = new MemoryStore();
  const bot = createBot({ token: '123456:TEST-TOKEN-FOR-TESTS', store });
  mapApi(bot);
  await prepareBot(bot);
  const handleUpdate = webhookCallback(bot, 'std/http', { secretToken: 's3cret' });
  const handler = createWebhookHandler({ handleUpdate, secretToken: 's3cret' });
  return { store, handler };
}

function postUpdate(update: unknown): Request {
  return new Request('https://app.example/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 's3cret',
    },
    body: JSON.stringify(update),
  });
}

/** A callback_query update from user 4242 tapping message 77. */
function callbackUpdate(updateId: number, data: string): Record<string, unknown> {
  return {
    update_id: updateId,
    callback_query: {
      id: `cbq-${updateId}`,
      from: { id: 4242, is_bot: false, first_name: 'Tester' },
      chat_instance: `inst-${updateId}`,
      data,
      message: {
        message_id: 77,
        date: 0,
        chat: { id: 4242, type: 'private', first_name: 'Tester' },
        from: { id: 42, is_bot: true, first_name: 'Emberdawn' },
      },
    },
  };
}

async function seededPlayer(store: MemoryStore): Promise<ReturnType<typeof createPlayer>> {
  const p = createPlayer(4242, 'Tester', 'warrior');
  p.messageId = 77; // the tapped copy IS the live game message
  await store.set(4242, p);
  return p;
}

Deno.test('webhook (#75): an expired callback acknowledgment answers 2xx and the action still lands', async () => {
  const { store, handler } = await webhookHarness((bot) => {
    bot.api.config.use((prev, method, payload) => {
      if (method === 'answerCallbackQuery') {
        return Promise.reject(
          new GrammyError(
            `Call to '${method}' failed with error '${EXPIRED}'`,
            { ok: false, error_code: 400, description: EXPIRED },
            method,
            payload,
          ),
        );
      }
      return prev(method, payload);
    });
  });
  const p = await seededPlayer(store);

  const res = await handler(postUpdate(callbackUpdate(1, withRev(p.uiRev, 'z:tv'))));

  assertEquals(res.status, 200, 'no 5xx: Telegram must not redeliver this update');
  assertEquals(
    (await store.get(4242))!.scene.view,
    'travel',
    'the action landed despite the failed acknowledgment',
  );
});

Deno.test('webhook (#75): a genuine game-message failure still returns 5xx', async () => {
  const { store, handler } = await webhookHarness((bot) => {
    bot.api.config.use((prev, method, payload) => {
      if (method === 'editMessageText') {
        const description = 'Bad Request: message is too long';
        return Promise.reject(
          new GrammyError(
            `Call to '${method}' failed with error '${description}'`,
            { ok: false, error_code: 400, description },
            method,
            payload,
          ),
        );
      }
      return prev(method, payload);
    });
  });
  const p = await seededPlayer(store);

  const res = await handler(postUpdate(callbackUpdate(1, withRev(p.uiRev, 'z:tv'))));

  assertEquals(
    res.status,
    500,
    'delivery failures must propagate so Telegram retries the action',
  );
  // NOTE: "nothing persisted" is not assertable against MemoryStore — its
  // get() returns the live object, so the aborted in-memory mutation shows
  // through even though store.set never ran (the production PgStore rolls
  // the whole lock section back; persistence_pg_test.ts covers it).
});
