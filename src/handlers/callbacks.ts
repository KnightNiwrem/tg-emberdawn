/** Central callback router: decode → load once → staleness guard → dispatch
 * → render → persist. Meta callbacks (class pick, help, reset) obey the same
 * live-message rules as everything else, and an existing character can never
 * be replaced by a stale or forged button. */

import type { Context } from 'grammy';
import { decodeCb } from '../codec.ts';
import type { PlayerStore } from '../persistence/store.ts';
import { commit, type MutationResult, tapIsCurrent, withLoadedPlayer } from './session.ts';
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
import { clampPools } from '../engine/character.ts';
import { itemName } from '../content/items.ts';

const STALE = 'That message is stale — use the latest game message (/start re-centers).';

export async function handleCallback(ctx: Context, store: PlayerStore): Promise<void> {
  const cb = ctx.callbackQuery?.data ? decodeCb(ctx.callbackQuery.data) : undefined;
  if (!cb) {
    await ctx.answerCallbackQuery({ text: 'Unknown control.' });
    return;
  }
  const from = ctx.from;
  if (!from) return;

  // Meta flows: guarded inside handleMeta (they have their own rules).
  if (cb.v === 'meta') {
    await handleMeta(ctx, store, cb, from.id, from.first_name ?? 'Traveler');
    return;
  }

  // Load exactly ONCE. Postgres re-deserializes on every get(), so a second
  // load would silently drop in-memory changes such as newer-message
  // adoption made by the staleness guard below.
  const p = await store.get(from.id);
  if (!p) {
    await ctx.answerCallbackQuery({ text: 'Tap /start to begin your tale.' });
    return;
  }

  // Combined staleness + render-revision guard (#16): a replay of an
  // already-acted-on button (same message, older revision) is rejected
  // before any mutation; a newer message copy is adopted together with the
  // revision it was rendered with.
  if (!tapIsCurrent(p, ctx, cb.rev)) {
    await ctx.answerCallbackQuery({ text: STALE });
    return;
  }

  await withLoadedPlayer(ctx, store, p, (player) => dispatch(player, cb));
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
      if (cb.a === 'open') {
        // Distinct open action (#17): the inventory menu's Equipment button
        // used to encode the BACK code, so tapping it just redrew Inventory
        // and the unequip screen was unreachable.
        player.scene = { view: 'equipment' };
        return {};
      }
      if (cb.a === 'bk') {
        player.scene = { view: 'inventory', arg: '0' };
        return {};
      }
      const slot = cb.arg as 'weapon' | 'armor' | 'trinket';
      const prev = player.equipment[slot];
      if (prev) {
        addItem(player, prev, 1);
        player.equipment[slot] = undefined;
        // Un-equipping can lower max HP/MP — never leave pools over cap.
        clampPools(player);
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

  // Character creation is the ONLY meta action allowed without a save — and
  // it is refused outright when a character exists, so a stale class picker
  // can never overwrite an existing hero.
  if (cb.a === 'pick') {
    if (existing) {
      await ctx.answerCallbackQuery({ text: 'You already have a character.' });
      return;
    }
    const outcome = metaAction(undefined, cb, userId, name);
    const fresh = outcome.player;
    if (!fresh) {
      await ctx.answerCallbackQuery({ text: outcome.toast ?? 'Unknown class.' });
      return;
    }
    fresh.notices = ['Your tale begins, Dawncaller. The dawn is out there, waiting to be found.'];
    fresh.scene = { view: 'zone' };
    if (ctx.callbackQuery?.message) fresh.messageId = ctx.callbackQuery.message.message_id;
    await ctx.answerCallbackQuery();
    // Deliver FIRST, then persist: commit may fall back to resending, and
    // the save must capture the final live-message pointer.
    if (ctx.chat) await commit(ctx, fresh);
    await store.set(userId, fresh);
    return;
  }

  // 'reset' now flows through the normal guarded path: metaAction stages the
  // confirmation scene; only resetYes destroys state (#19).
  if (!existing) {
    await ctx.answerCallbackQuery({ text: 'Tap /start to begin your tale.' });
    return;
  }
  // Everything else (help, reset confirmations) obeys the combined
  // staleness + render-revision guard (#16).
  if (!tapIsCurrent(existing, ctx, cb.rev)) {
    await ctx.answerCallbackQuery({ text: STALE });
    return;
  }

  const outcome = metaAction(existing, cb, userId, name);
  const player = outcome.player;

  if (cb.a === 'resetYes' && player) {
    // Full reset: brand-new state in a brand-new message.
    player.notices = ['A new tale begins. The dawn is waiting to be found.'];
    player.scene = { view: 'zone' };
    await ctx.answerCallbackQuery();
    if (ctx.chat) await commit(ctx, player);
    await store.set(userId, player);
    return;
  }

  if (player) {
    // help / resetNo: scene-only changes on the already-loaded player.
    await withLoadedPlayer(ctx, store, existing, () => {});
    return;
  }

  await ctx.answerCallbackQuery(outcome.toast ? { text: outcome.toast } : undefined);
}
