/** Slash commands: /start, /help, /reset. */

import type { Context } from 'grammy';
import type { PlayerStore } from '../persistence/store.ts';
import { commit, loadPlayer } from './session.ts';
import { renderClassPicker, renderHelp } from '../render/views.ts';

export async function handleStart(ctx: Context, store: PlayerStore): Promise<void> {
  const from = ctx.from;
  if (!from || !ctx.chat) return;
  const loaded = await loadPlayer(store, from.id);
  if (loaded.kind === 'missing') {
    await ctx.replyWithRichMessage(renderClassPicker());
    return;
  }
  if (loaded.kind === 'refused') {
    await ctx.reply(loaded.message).catch(() => {});
    return;
  }
  const existing = loaded.player;
  existing.notices = ['🧭 The flame guides you back.'];
  // Resume whatever was happening — a live fight resumes as a fight, a lost
  // one stays on the death screen, and a battle-free crossing re-centers
  // on the journey intermission (#170). /start never mutates gameplay state.
  if (existing.battle) {
    existing.scene = { view: existing.battle.phase === 'lost' ? 'death' : 'battle' };
  } else if (existing.journey) {
    existing.scene = { view: 'journey' };
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
  const loaded = await loadPlayer(store, from.id);
  if (loaded.kind === 'missing') {
    await ctx.replyWithRichMessage(renderClassPicker());
    return;
  }
  if (loaded.kind === 'refused') {
    if (loaded.reason === 'new') {
      await ctx.reply(loaded.message).catch(() => {});
    } else {
      // Unloadable pre-launch saves cannot stage a confirmation scene.
      await store.delete(from.id);
      await ctx.replyWithRichMessage(renderClassPicker());
    }
    return;
  }
  const player = loaded.player;
  // DESTRUCTIVE — never act on the slash command alone (#19): stage the
  // explicit Yes/No confirmation on the live message instead. State is
  // only destroyed when the player taps resetYes (m:ry).
  player.notices = ['⚠️ Confirm below: this erases your character for good.'];
  player.scene = { view: 'reset' };
  await commit(ctx, player);
  await store.set(from.id, player);
}
