/** HTTP-level tests for webhook request authentication (#29). */

import { assert, assertEquals } from '@std/assert';
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
