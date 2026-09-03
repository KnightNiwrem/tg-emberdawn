/** Slash commands: /start, /help, /reset. */

import type { Context } from 'grammy';
import type { PlayerStore } from '../persistence/store.ts';
import { commit, INCOMPATIBLE_SAVE_REPLY } from './session.ts';
import { renderClassPicker } from '../render/views.ts';
import { renderHelp } from '../render/views.ts';
import {
  assertSupportedSaveVersion,
  SaveTooNewError,
  SaveTooOldError,
} from '../engine/character.ts';

export async function handleStart(ctx: Context, store: PlayerStore): Promise<void> {
  const from = ctx.from;
  if (!from || !ctx.chat) return;
  const existing = await store.get(from.id);
  if (!existing) {
    await ctx.replyWithRichMessage(renderClassPicker());
    return;
  }
  // Re-center ONLY: /start means "the live message is buried" — never a
  // gameplay action. Battles, gold, deaths and location are all preserved;
  // abandoning a fight is what /reset is for.
  try {
    assertSupportedSaveVersion(existing); // the compatibility gate runs here too
  } catch (e) {
    if (e instanceof SaveTooOldError) {
      // Incompatible pre-launch save (#44, #116): refuse and point at
      // /reset — never silently rewrite it.
      await ctx.reply(INCOMPATIBLE_SAVE_REPLY).catch(() => {});
      return;
    }
    if (!(e instanceof SaveTooNewError)) throw e;
    // Newer-binary save: refuse to touch it rather than downgrade (#4).
    await ctx
      .reply(
        '⛔ This save was written by a newer version of the game. Update the app to continue — your progress is safe.',
      )
      .catch(() => {});
    return;
  }
  existing.notices = ['🧭 The flame guides you back.'];
  // Resume whatever was happening — a live fight resumes as a fight, a lost
  // one stays on the death screen. /start never mutates gameplay state.
  if (existing.battle) {
    existing.scene = { view: existing.battle.phase === 'lost' ? 'death' : 'battle' };
  }
  existing.messageId = undefined; // force a fresh message, never an edit
  await commit(ctx, existing);
  await store.set(from.id, existing);
}

export async function handleHelp(ctx: Context): Promise<void> {
  if (!ctx.chat) return;
  // Informational: no buttons, so it never competes with the live game message.
  const help = renderHelp();
  const blocks = help.blocks ?? [];
  await ctx.api.sendRichMessage(ctx.chat.id, { blocks: blocks.slice(0, -1) });
}

export async function handleReset(ctx: Context, store: PlayerStore): Promise<void> {
  const from = ctx.from;
  if (!from || !ctx.chat) return;
  const p = await store.get(from.id);
  if (!p) {
    await ctx.replyWithRichMessage(renderClassPicker());
    return;
  }
  try {
    assertSupportedSaveVersion(p);
  } catch (e) {
    if (e instanceof SaveTooOldError) {
      // The save cannot be loaded, so a confirmation cannot be staged. An
      // explicit /reset is the documented escape hatch (#44, #116): drop the
      // unloadable save and offer the class picker.
      await store.delete(from.id);
      await ctx.replyWithRichMessage(renderClassPicker());
      return;
    }
    if (!(e instanceof SaveTooNewError)) throw e;
    await ctx
      .reply(
        '⛔ This save was written by a newer version of the game. Update the app to continue — your progress is safe.',
      )
      .catch(() => {});
    return;
  }
  // DESTRUCTIVE — never act on the slash command alone (#19): stage the
  // explicit Yes/No confirmation on the live message instead. State is
  // only destroyed when the player taps resetYes (m:ry).
  p.notices = ['⚠️ Confirm below: this erases your character for good.'];
  p.scene = { view: 'reset' };
  await commit(ctx, p);
  await store.set(from.id, p);
}
