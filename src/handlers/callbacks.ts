/** Central callback router: decode → staleness guard → dispatch → render. */

import type { Context } from 'grammy';
import { decodeCb } from '../codec.ts';
import type { PlayerStore } from '../persistence/store.ts';
import { commit, isLiveMessage, type MutationResult, withPlayer } from './session.ts';
import {
  deathAction,
  forgeAction,
  metaAction,
  questsAction,
  shopAction,
  travelAction,
  zoneAction,
} from './hub.ts';
import { battleAction, itemAction } from './battle.ts';
import { addItem } from '../engine/inventory.ts';
import { itemName } from '../content/items.ts';

export async function handleCallback(ctx: Context, store: PlayerStore): Promise<void> {
  const cb = ctx.callbackQuery?.data ? decodeCb(ctx.callbackQuery.data) : undefined;
  if (!cb) {
    await ctx.answerCallbackQuery({ text: 'Unknown control.' });
    return;
  }
  const from = ctx.from;
  if (!from) return;

  // Meta flows that don't require an existing character.
  if (cb.v === 'meta') {
    await handleMeta(ctx, store, cb, from.id, from.first_name ?? 'Traveler');
    return;
  }

  const p = await store.get(from.id);
  if (!p) {
    await ctx.answerCallbackQuery({ text: 'Tap /start to begin your tale.' });
    return;
  }

  // Staleness guard: taps on an old copy of the game message.
  if (!isLiveMessage(p, ctx)) {
    await ctx.answerCallbackQuery({
      text: 'That message is stale — use the latest game message (/start re-centers).',
    });
    return;
  }

  await withPlayer(ctx, store, (player) => dispatch(player, cb));
}

function dispatch(
  player: NonNullable<Awaited<ReturnType<PlayerStore['get']>>>,
  cb: NonNullable<ReturnType<typeof decodeCb>>,
): MutationResult {
  switch (cb.v) {
    case 'zone':
      return zoneAction(player, cb);
    case 'travel':
      return travelAction(player, cb);
    case 'shop':
      return shopAction(player, cb);
    case 'forge':
      return forgeAction(player, cb);
    case 'quests':
      return questsAction(player, cb);
    case 'battle':
      return battleAction(player, cb);
    case 'death':
      return deathAction(player);
    case 'inventory': {
      if (cb.a === 'bk') {
        player.scene = { view: 'zone' };
        return {};
      }
      if (cb.a === 'p') {
        player.scene = { view: 'inventory', arg: String(cb.arg) };
        return {};
      }
      if (cb.a === 'v') {
        player.scene = { view: 'item', arg: cb.arg };
        return {};
      }
      return itemAction(player, cb.a, cb.arg);
    }
    case 'equipment': {
      if (cb.a === 'bk') {
        player.scene = { view: 'inventory', arg: '0' };
        return {};
      }
      const slot = cb.arg as 'weapon' | 'armor' | 'trinket';
      const prev = player.equipment[slot];
      if (prev) {
        addItem(player, prev, 1);
        player.equipment[slot] = undefined;
        player.notices = [`Unequipped ${itemName(prev)}.`];
      }
      player.scene = { view: 'equipment' };
      return {};
    }
    case 'skills': {
      player.scene = { view: 'zone' };
      return {};
    }
    default:
      return {};
  }
}

async function handleMeta(
  ctx: Context,
  store: PlayerStore,
  cb: Extract<ReturnType<typeof decodeCb>, { v: 'meta' }>,
  userId: number,
  name: string,
): Promise<void> {
  const existing = await store.get(userId);
  const outcome = metaAction(existing, cb, userId, name);

  if (cb.a === 'help') {
    if (existing) {
      await withPlayer(ctx, store, (p) => {
        p.scene = { view: 'help' };
        return {};
      });
      return;
    }
    await ctx.answerCallbackQuery({ text: 'Tap /start to begin your tale.' });
    return;
  }

  if (cb.a === 'reset') {
    await ctx.answerCallbackQuery({ text: 'Use /reset to confirm a full reset.' });
    return;
  }
  if (cb.a === 'resetNo') {
    if (existing) {
      await withPlayer(ctx, store, (p) => {
        p.scene = { view: 'zone' };
        return {};
      });
      return;
    }
    await ctx.answerCallbackQuery();
    return;
  }

  const player = outcome.player;
  if (!player) {
    await ctx.answerCallbackQuery(outcome.toast ? { text: outcome.toast } : undefined);
    return;
  }

  // Character created (pick) or reset (resetYes): fresh state, fresh message.
  player.notices = [
    cb.a === 'pick'
      ? 'Your tale begins, Dawncaller. The dawn is out there, waiting to be found.'
      : 'A new tale begins. The dawn is waiting to be found.',
  ];
  player.scene = { view: 'zone' };
  if (cb.a === 'pick' && ctx.callbackQuery?.message && ctx.chat) {
    player.messageId = ctx.callbackQuery.message.message_id;
    await store.set(userId, player);
    await ctx.answerCallbackQuery();
    await commit(ctx, player);
    return;
  }
  // resetYes: send a brand-new game message.
  await store.set(userId, player);
  await ctx.answerCallbackQuery();
  if (ctx.chat) {
    const { renderFor } = await import('./session.ts');
    const sent = await ctx.api.sendRichMessage(ctx.chat.id, renderFor(player));
    player.messageId = sent.message_id;
    await store.set(userId, player);
  }
}
