/**
 * Entrypoint.
 * - Webhook mode (default, Deno Deploy friendly): POST /webhook
 * - Polling mode: BOT_POLLING=1 deno task start (local dev)
 */

import { webhookCallback } from 'grammy';
import { createBot } from './bot.ts';
import { KvStore, PgStore } from './persistence/store.ts';
import type { PlayerStore } from './persistence/store.ts';

const token = Deno.env.get('BOT_TOKEN');
if (!token) {
  console.error('BOT_TOKEN environment variable is required');
  Deno.exit(1);
}

// Attached Prisma Postgres on Deno Deploy injects DATABASE_URL / PG* env vars
// (docs.deno.com/deploy/reference/databases). Fall back to local Deno KV.
const dbUrl = Deno.env.get('DATABASE_URL');
const store: PlayerStore = dbUrl
  ? await PgStore.open(dbUrl)
  : await KvStore.open(Deno.env.get('BOT_KV_PATH') || undefined);
console.log(dbUrl ? 'store: postgres (DATABASE_URL)' : 'store: local deno kv');
const bot = createBot({ token, store });

const secretToken = Deno.env.get('WEBHOOK_SECRET') || undefined;

if (Deno.env.get('BOT_POLLING') === '1') {
  console.log('Emberdawn bot starting in polling mode…');
  await bot.init();
  bot.start({ drop_pending_updates: false });
} else {
  const handleUpdate = webhookCallback(bot, 'std/http', { secretToken });
  Deno.serve(async (req: Request) => {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/webhook') {
      try {
        return await handleUpdate(req);
      } catch (err) {
        console.error('webhook error', err);
        return new Response('internal error', { status: 500 });
      }
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/healthz')) {
      return new Response('emberdawn bot: ok');
    }
    return new Response('not found', { status: 404 });
  });
}
