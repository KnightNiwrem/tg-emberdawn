/** Central callback router: decode → load once → staleness guard → dispatch
 * → render → persist. Meta callbacks (class pick, help, reset) obey the same
 * live-message rules as everything else, and an existing character can never
 * be replaced by a stale or forged button. */

import type { Context } from 'grammy';
import { decodeCb } from '../codec.ts';
import { answerCallbackBestEffort } from './ack.ts';
import type { PlayerStore } from '../persistence/store.ts';
import {
  commit,
  deliverClassPicker,
  type MutationResult,
  tapIsCurrent,
  withLoadedPlayer,
} from './session.ts';
import {
  deathAction,
  dialogueAction,
  forgeAction,
  journeyAction,
  metaAction,
  npcAction,
  pickClass,
  questsAction,
  shopAction,
  travelAction,
  zoneAction,
} from './hub.ts';
import { battleAction, itemAction } from './battle.ts';
import { tutorialAction } from './tutorial.ts';
import { addItem } from '../engine/inventory.ts';
import { clampPools } from '../engine/character.ts';
import { itemName } from '../content/items.ts';

const STALE = 'That message is stale — use the latest game message (/start re-centers).';

export async function handleCallback(ctx: Context, store: PlayerStore): Promise<void> {
  const cb = ctx.callbackQuery?.data ? decodeCb(ctx.callbackQuery.data) : undefined;
  if (!cb) {
    await answerCallbackBestEffort(ctx, { text: 'Unknown control.' });
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
    await answerCallbackBestEffort(ctx, { text: 'Tap /start to begin your tale.' });
    return;
  }

  // Combined staleness + render-revision guard (#16): a replay of an
  // already-acted-on button (same message, older revision) is rejected
  // before any mutation; a newer message copy is adopted together with the
  // revision it was rendered with.
  if (!tapIsCurrent(p, ctx, cb.rev)) {
    await answerCallbackBestEffort(ctx, { text: STALE });
    return;
  }

  await withLoadedPlayer(ctx, store, p, (player) => dispatch(player, cb));
}

function dispatch(
  player: NonNullable<Awaited<ReturnType<PlayerStore['get']>>>,
  // The router has already routed meta callbacks away (#58): dispatch sees
  // only gameplay views, exhaustively — no silent default.
  cb: Exclude<NonNullable<ReturnType<typeof decodeCb>>, { v: 'meta' }>,
): MutationResult {
  switch (cb.v) {
    case 'zone':
      return zoneAction(player, cb);
    case 'travel':
      return travelAction(player, cb);
    case 'journey':
      // Journey intermission controls (#159): continue/retreat, revalidated
      // server-side against the persisted crossing.
      return journeyAction(player, cb);
    case 'shop':
      return shopAction(player, cb);
    case 'forge':
      return forgeAction(player, cb);
    case 'quests':
      return questsAction(player, cb);
    case 'npc':
      // The NPC topic menu (#123): navigation + revalidated topic
      // selection; no story mutation happens on merely opening it.
      return npcAction(player, cb);
    case 'dlg':
      // The dialogue scene (#124): linear node advance under the same
      // staleness/revision and on-site-presence rules as every view.
      return dialogueAction(player, cb);
    case 'battle':
      return battleAction(player, cb);
    case 'tut':
      // Guided prologue controls (#69) — same guarded surface as every
      // other gameplay callback.
      return tutorialAction(player, cb);
    case 'death':
      return deathAction(player);
    case 'inventory': {
      if (cb.a === 'bk') {
        // Back from the bag preserves a live crossing (#159): the journey
        // intermission is the player's current place, not the zone hub.
        player.scene = player.journey ? { view: 'journey' } : { view: 'zone' };
        return {};
      }
      if (cb.a === 'p') {
        player.scene = { view: 'inventory', arg: String(cb.arg) };
        return {};
      }
      if (cb.a === 'v') {
        // #112: the detail records WHERE it was opened from — the current
        // inventory page, the Equipment screen, or an active journey — so
        // its Back button returns to the origin instead of a hardcoded view.
        const origin = player.scene.view === 'inventory'
          ? (player.scene.arg ?? '0')
          : player.scene.view === 'equipment'
          ? 'eq'
          : player.journey
          ? 'j'
          : undefined;
        player.scene = {
          view: 'item',
          arg: cb.arg,
          ...(origin !== undefined ? { arg2: origin } : {}),
        };
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
      if (cb.a === 'view') {
        // #112: inspect the EQUIPPED item by SLOT — the slot is the
        // authoritative ownership check (the renderer re-resolves
        // player.equipment[slot]); a forged/unknown slot token never
        // changes the scene.
        if (cb.arg === 'weapon' || cb.arg === 'armor' || cb.arg === 'trinket') {
          player.scene = { view: 'equippedItem', arg: cb.arg };
        }
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
      await answerCallbackBestEffort(ctx, { text: 'You already have a character.' });
      return;
    }
    const fresh = pickClass(cb, userId, name);
    if (!fresh) {
      await answerCallbackBestEffort(ctx, { text: 'Unknown class.' });
      return;
    }
    fresh.notices = ['Your tale begins, Dawncaller. The dawn is out there, waiting to be found.'];
    fresh.scene = { view: 'zone' };
    if (ctx.callbackQuery?.message) fresh.messageId = ctx.callbackQuery.message.message_id;
    await answerCallbackBestEffort(ctx);
    // Deliver FIRST, then persist: commit may fall back to resending, and
    // the save must capture the final live-message pointer.
    if (ctx.chat) await commit(ctx, fresh);
    await store.set(userId, fresh);
    return;
  }

  // 'reset' now flows through the normal guarded path: metaAction stages the
  // confirmation scene; only resetYes destroys state (#19).
  if (cb.a === 'resetYes' && !existing) {
    // Redelivered confirmation after the save is already gone (#62): the
    // reset happened — a harmless no-op, nothing left to delete or persist.
    await answerCallbackBestEffort(ctx, { text: 'Already reset — pick a class to begin anew.' });
    return;
  }
  if (!existing) {
    await answerCallbackBestEffort(ctx, { text: 'Tap /start to begin your tale.' });
    return;
  }
  // Everything else (help, reset confirmations) obeys the combined
  // staleness + render-revision guard (#16).
  if (!tapIsCurrent(existing, ctx, cb.rev)) {
    await answerCallbackBestEffort(ctx, { text: STALE });
    return;
  }

  if (cb.a === 'resetYes') {
    // Confirmed deletion (#62): the save is destroyed outright — no
    // replacement hero is built or persisted. Deliver the class picker
    // FIRST (edit the confirmation in place, resend fallback), so a failed
    // delivery leaves the old save untouched; only once the picker is on
    // screen does the store drop the row. The picker is stateless: nothing
    // is persisted again until pickClass() runs on a real class tap.
    await answerCallbackBestEffort(ctx, { text: 'Hero deleted. A new tale awaits.' });
    if (!ctx.chat) return; // nowhere to deliver the picker — keep the save
    await deliverClassPicker(ctx, existing.messageId);
    await store.delete(userId);
    return;
  }

  metaAction(existing, cb);

  // help / reset / resetNo: scene-only changes on the already-loaded player.
  await withLoadedPlayer(ctx, store, existing, () => {});
}
