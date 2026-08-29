/**
 * Session orchestration: load → mutate → render → commit (edit in place) →
 * save. Owns the single-live-game-message lifecycle and staleness guard.
 */

import type { Context } from 'grammy';
import type { InputRichMessage } from 'grammy/types';
import type { PlayerState } from '../engine/types.ts';
import type { PlayerStore } from '../persistence/store.ts';
import { backfillPlayer } from '../engine/character.ts';
import { GrammyError } from 'grammy';
import { renderBattle, renderItemMenu, renderSkillMenu } from '../render/battle.ts';
import {
  renderEquipment,
  renderInventory,
  renderItemDetail,
  renderSkills,
} from '../render/menus.ts';
import {
  renderCharacter,
  renderDeath,
  renderForge,
  renderHelp,
  renderQuestDetail,
  renderQuests,
  renderSell,
  renderShop,
  renderTravel,
  renderZone,
} from '../render/views.ts';

export function renderFor(p: PlayerState): InputRichMessage {
  switch (p.scene.view) {
    case 'battle':
      return renderBattle(p);
    case 'battleSkills':
      return renderSkillMenu(p);
    case 'battleItems':
      return renderItemMenu(p);
    case 'inventory':
      return renderInventory(p, Number(p.scene.arg ?? 0));
    case 'item':
      return renderItemDetail(p, p.scene.arg ?? '');
    case 'equipment':
      return renderEquipment(p);
    case 'skills':
      return renderSkills(p);
    case 'quests':
      return p.scene.arg ? renderQuestDetail(p, p.scene.arg) : renderQuests(p);
    case 'shop':
      return p.scene.arg === 'sell'
        ? renderSell(p, Number(p.scene.arg2 ?? 0))
        : renderShop(p, Number(p.scene.arg ?? 0));
    case 'forge':
      return renderForge(p);
    case 'travel':
      return renderTravel(p);
    case 'death':
      return renderDeath(p);
    case 'character':
      return renderCharacter(p);
    case 'help':
      return renderHelp();
    default:
      return renderZone(p);
  }
}

/** Commit: edit the live message in place; fall back to sending a new one. */
export async function commit(ctx: Context, p: PlayerState): Promise<void> {
  const msg = renderFor(p);
  const editId = p.messageId;
  if (editId && ctx.chat) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, editId, msg);
      return;
    } catch (e) {
      if (e instanceof GrammyError) {
        const d = e.description;
        if (d.includes('message is not modified')) return;
        if (
          d.includes('MESSAGE_ID_INVALID') ||
          d.includes('message to edit not found') ||
          d.includes("message can't be edited") ||
          d.includes('MESSAGE_TOO_LONG') === false
        ) {
          // fall through to resend
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }
  }
  if (!ctx.chat) return;
  const sent = await ctx.api.sendRichMessage(ctx.chat.id, msg);
  p.messageId = sent.message_id;
}

/** Answer the tap (toast) and commit the new view. */
async function respond(ctx: Context, p: PlayerState, toast?: string): Promise<void> {
  await ctx.answerCallbackQuery(toast ? { text: toast.slice(0, 190) } : undefined);
  await commit(ctx, p);
}

export interface MutationResult {
  toast?: string;
}

/**
 * Loads (or initializes) the player, runs the mutation, renders, saves.
 * The mutation sets p.scene/p.notices; this wrapper handles I/O only.
 */
export async function withPlayer(
  ctx: Context,
  store: PlayerStore,
  mutate: (p: PlayerState) => MutationResult | void | Promise<MutationResult | void>,
): Promise<void> {
  const from = ctx.from;
  if (!from || !ctx.chat) return;
  const p = await store.get(from.id);
  if (!p) return; // no character yet — commands handle onboarding
  backfillPlayer(p); // idempotent save migration (skills, starting zones)
  const result = (await mutate(p)) ?? {};
  p.stats.lastPlayed = Date.now();
  await store.set(from.id, p);
  await respond(ctx, p, result.toast);
}

/** Guard used inside mutations: is this tap on the live game message? */
export function isLiveMessage(p: PlayerState, ctx: Context): boolean {
  const tapped = ctx.callbackQuery?.message?.message_id;
  if (!p.messageId || !tapped) return true; // nothing to compare against
  if (tapped === p.messageId) return true;
  // A NEWER message id means the tap is on a copy newer than our pointer
  // (e.g. after a resend we missed) — adopt it as live. Older copies are
  // genuinely stale and rejected.
  if (tapped > p.messageId) {
    p.messageId = tapped;
    return true;
  }
  return false;
}
