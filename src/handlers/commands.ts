/** Slash commands: /start, /help, /reset. */

import type { Context } from 'grammy';
import type { PlayerStore } from '../persistence/store.ts';
import { commit } from './session.ts';
import { renderClassPicker } from '../render/views.ts';
import { renderHelp } from '../render/views.ts';
import { createPlayer } from '../engine/character.ts';
import { syncAvailability } from '../engine/quests.ts';

export async function handleStart(ctx: Context, store: PlayerStore): Promise<void> {
  const from = ctx.from;
  if (!from || !ctx.chat) return;
  const existing = await store.get(from.id);
  if (!existing) {
    await ctx.replyWithRichMessage(renderClassPicker());
    return;
  }
  // Re-center the game on a fresh message (old copies go stale automatically).
  existing.notices = ['🧭 The flame guides you back.'];
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
  const fresh = createPlayer(from.id, p.name, p.classId);
  syncAvailability(fresh);
  fresh.notices = ['🧹 A clean slate. Your previous tale fades like smoke.'];
  fresh.scene = { view: 'zone' };
  await store.set(from.id, fresh);
  await commit(ctx, fresh);
}
