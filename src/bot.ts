/**
 * Builds the bot. Does NOT start it — main.ts owns lifecycle.
 * store is injectable so tests can pass a MemoryStore.
 */

import { Bot } from 'grammy';
import type { Context } from 'grammy';
import type { PlayerStore } from './persistence/store.ts';
import { handleCallback } from './handlers/callbacks.ts';
import { handleHelp, handleReset, handleStart } from './handlers/commands.ts';

export interface BotOptions {
  token: string;
  store: PlayerStore;
}

export function createBot(opts: BotOptions): Bot<Context> {
  const bot = new Bot<Context>(opts.token);

  // Layer 1 (in-process): serialize per user so each load/mutate/save cycle
  // is atomic. Layer 2 (cross-instance, #18): PgStore.withLock holds a
  // session advisory lock around the whole update, so a second bot instance
  // waits instead of racing a lost-update against this one.
  const chains = new Map<number, Promise<void>>();
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    const prev = chains.get(id ?? 0) ?? Promise.resolve();
    const run = prev.then(() => (id === undefined ? next() : opts.store.withLock(id, next)));
    chains.set(id ?? 0, run);
    try {
      await run;
    } finally {
      if (chains.get(id ?? 0) === run) chains.delete(id ?? 0);
    }
  });

  bot.command('start', (ctx) => handleStart(ctx, opts.store));
  bot.command('help', (ctx) => handleHelp(ctx));
  bot.command('reset', (ctx) => handleReset(ctx, opts.store));

  bot.on('callback_query:data', (ctx) => handleCallback(ctx, opts.store));

  bot.catch((err) => console.error('bot error', err.error));
  return bot;
}
