/** Slash commands: /start, /help, /reset. */

import type { Context } from 'grammy';
import type { PlayerStore } from '../persistence/store.ts';
import { commit } from './session.ts';
import { renderClassPicker } from '../render/views.ts';
import { renderHelp } from '../render/views.ts';
import { createPlayer, migratePlayer } from '../engine/character.ts';
import { syncAvailability } from '../engine/quests.ts';

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
  migratePlayer(existing); // versioned save migration runs here too
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
  const fresh = createPlayer(from.id, p.name, p.classId);
  syncAvailability(fresh);
  fresh.notices = ['🧹 A clean slate. Your previous tale fades like smoke.'];
  fresh.scene = { view: 'zone' };
  // Commit first so fresh.messageId points at the live message, THEN save —
  // persisting before commit used to store a stale/missing pointer and
  // orphan the game (every tap afterwards hit the staleness guard).
  await commit(ctx, fresh);
  await store.set(from.id, fresh);
}
