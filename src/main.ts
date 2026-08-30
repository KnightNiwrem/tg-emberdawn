/**
 * Entrypoint.
 * - Webhook mode (default, Deno Deploy friendly): POST /webhook
 * - Polling mode: BOT_POLLING=1 deno task start (local dev)
 */

import { webhookCallback } from 'grammy';
import { createBot } from './bot.ts';
import { PgStore } from './persistence/store.ts';
import { createWebhookHandler } from './webhook-server.ts';

const token = Deno.env.get('BOT_TOKEN');
if (!token) {
  console.error('BOT_TOKEN environment variable is required');
  Deno.exit(1);
}

// Attached Prisma Postgres on Deno Deploy injects DATABASE_URL / PG* env vars
// (docs.deno.com/deploy/reference/databases). Locally, point DATABASE_URL at
// any Postgres.
const dbUrl = Deno.env.get('DATABASE_URL');
if (!dbUrl) {
  console.error(
    'DATABASE_URL is required (Deno Deploy injects it for attached Postgres; locally, point it at any Postgres).',
  );
  Deno.exit(1);
}
const store = await PgStore.open(dbUrl);
console.log('store: postgres');
const bot = createBot({ token, store });

if (Deno.env.get('BOT_POLLING') === '1') {
  console.log('Emberdawn bot starting in polling mode…');
  await bot.init();
  bot.start({ drop_pending_updates: false });
} else {
  // FAIL CLOSED (#29): a public POST /webhook without request authentication
  // would let anyone forge updates (saves are keyed by from.id, so a forged
  // update mutates another player's game). Polling mode exposes no endpoint
  // and needs no secret.
  const secretToken = Deno.env.get('WEBHOOK_SECRET');
  if (!secretToken) {
    console.error(
      'WEBHOOK_SECRET is required in webhook mode (polling with BOT_POLLING=1 does not need it).\n' +
        'Generate one: openssl rand -hex 32 — then register the SAME value: deno task webhook set <url>',
    );
    Deno.exit(1);
  }
  const handleUpdate = webhookCallback(bot, 'std/http', { secretToken });
  Deno.serve(createWebhookHandler({ handleUpdate, secretToken }));
}
