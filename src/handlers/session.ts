/**
 * Session orchestration: load → mutate → render → commit (edit in place) →
 * save. Owns the single-live-game-message lifecycle and staleness guard.
 */

import type { Context } from 'grammy';
import type { InputRichMessage } from 'grammy/types';
import type { PlayerState } from '../engine/types.ts';
import type { PlayerStore } from '../persistence/store.ts';
import { withRev } from '../codec.ts';
import { migratePlayer, SaveTooNewError } from '../engine/character.ts';
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
  renderResetConfirm,
  renderSell,
  renderShop,
  renderTravel,
  renderZone,
} from '../render/views.ts';

function renderFor(p: PlayerState): InputRichMessage {
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
    case 'reset':
      return renderResetConfirm(p);
    case 'character':
      return renderCharacter(p);
    case 'help':
      return renderHelp();
    default:
      return renderZone(p);
  }
}

/** Edit failures that mean the live message is gone or uneditable — only
 * these fall back to resending. Content errors (MESSAGE_TOO_LONG) and rate
 * limits surface instead: resending would fail identically or duplicate
 * the live message. */
const RESENDABLE = [
  'MESSAGE_ID_INVALID',
  'message to edit not found',
  "message can't be edited",
];

/** Stamps every button in a rendered message with the given render
 * revision (#16): the router only honors taps whose revision matches the
 * player's current one, so a double-tap or a button from an earlier view
 * of the SAME message can never re-execute a mutation. */
function stampRev(msg: InputRichMessage, rev: number): void {
  for (const block of msg.blocks ?? []) {
    if (block.type !== 'buttons') continue;
    for (const btn of block.buttons) {
      if (!('callback_data' in btn) || !btn.callback_data) continue;
      btn.callback_data = withRev(rev, btn.callback_data);
    }
  }
}

/** Commit: edit the live message in place; fall back to sending a new one.
 * On success, drains p.notices (the renderer itself stays pure) and bumps
 * the render revision stamped into the buttons just delivered (#16). */
export async function commit(ctx: Context, p: PlayerState): Promise<void> {
  const msg = renderFor(p);
  // Cycles 1..9999 to respect the 4-digit wire budget; a replay from exactly
  // one full cycle ago is not a realistic threat window.
  const nextRev = ((p.uiRev ?? 0) % 9999) + 1;
  stampRev(msg, nextRev);
  const editId = p.messageId;
  if (editId && ctx.chat) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, editId, msg);
      p.uiRev = nextRev;
      p.notices = [];
      return;
    } catch (e) {
      if (!(e instanceof GrammyError)) throw e;
      const d = e.description;
      if (d.includes('message is not modified')) {
        // Screen unchanged — the buttons already out there keep their current
        // revision, so it must NOT advance here.
        p.notices = [];
        return;
      }
      if (!RESENDABLE.some((frag) => d.includes(frag))) throw e;
      // fall through to resend
    }
  }
  if (!ctx.chat) return;
  const sent = await ctx.api.sendRichMessage(ctx.chat.id, msg);
  p.messageId = sent.message_id;
  p.uiRev = nextRev;
  p.notices = [];
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
/** Runs a mutation against an ALREADY-LOADED player and persists. Loading
 * happens exactly once per tap: a second store.get() (Postgres) returns a
 * fresh deserialized object and would silently drop in-memory state such
 * as newer-message adoption. */
export async function withLoadedPlayer(
  ctx: Context,
  store: PlayerStore,
  p: PlayerState,
  mutate: (p: PlayerState) => MutationResult | void | Promise<MutationResult | void>,
): Promise<void> {
  if (!ctx.chat) return;
  try {
    migratePlayer(p); // versioned save migration (destructive steps run once)
  } catch (e) {
    if (!(e instanceof SaveTooNewError)) throw e;
    // A NEWER binary wrote this save. Never read-mutate-write it: a rollback
    // must not silently downgrade player data (#4).
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx
      .reply(
        '⛔ This save was written by a newer version of the game. Update the app to continue — your progress is safe.',
      )
      .catch(() => {});
    return;
  }
  const result = (await mutate(p)) ?? {};
  p.stats.lastPlayed = Date.now();
  // Respond FIRST: commit may update p.messageId (resend fallback), and the
  // save must capture that pointer. Saving before commit used to strand the
  // live-message id, breaking every later tap after a resend.
  await respond(ctx, p, result.toast);
  const from = ctx.from;
  if (from) await store.set(from.id, p);
}

/** Guard used inside mutations: is this tap on the live game message? */
function isLiveMessage(p: PlayerState, ctx: Context): boolean {
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

/** Combined staleness + render-revision tap guard (#16). The tap must sit
 * on the live game message AND carry the revision the live render stamped.
 * A tap on a NEWER copy is adopted — pointer AND revision — because that
 * copy's render is authoritative (its save was likely missed, not its tap).
 * Returns false when the tap is stale; the caller answers with the stale
 * toast. Rev-less buttons (legacy renders, class picker) map to rev 0, so
 * pre-feature saves upgrade transparently on their first tap. */
export function tapIsCurrent(p: PlayerState, ctx: Context, rev: number | undefined): boolean {
  const tapped = ctx.callbackQuery?.message?.message_id;
  const newer = tapped !== undefined && p.messageId !== undefined && tapped > p.messageId;
  if (!isLiveMessage(p, ctx)) return false;
  if (newer) {
    p.uiRev = rev ?? 0;
    return true;
  }
  return (rev ?? 0) === (p.uiRev ?? 0);
}
