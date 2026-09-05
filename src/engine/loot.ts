/**
 * Contextual loot rolling (#158): zones and routes award region-specific
 * resources IN ADDITION to ordinary enemy rewards, without cloning enemy
 * definitions. Pure: seeded rng in, item ids out. Grant sites must route
 * quest-kind drops through the central relevance filter
 * (engine/quests.ts questDropAllowed) — relevance is never decided here.
 */

import { dropTable } from '../content/loot.ts';
import { itemName } from '../content/items.ts';
import { grantItem, questDropAllowed, questReadyLine } from './quests.ts';
import { defaultRng, type Rng } from './rng.ts';
import type { PlayerState } from './types.ts';

export interface ContextualDrop {
  item: string;
  qty: number;
}

/** Independent chance rolls over the table's entries. An unknown table
 * rolls nothing (callers treat an unknown reference as a content fault —
 * the integrity tests refuse one at authoring time). */
export function rollDropTable(
  tableId: string,
  rng: Rng = defaultRng,
): ContextualDrop[] {
  const t = dropTable(tableId);
  if (!t) return [];
  const out: ContextualDrop[] = [];
  for (const e of t.entries) {
    if (rng() < e.chance) out.push({ item: e.item, qty: e.qty ?? 1 });
  }
  return out;
}

/**
 * The ONE contextual grant site (#158, #165): every rolled contextual drop
 * — travel treasure and victory zone loot alike — passes through here, so
 * quest-kind drops ALWAYS obey the central relevance filter (#2) and every
 * grant routes through the central item path (collect objectives can
 * complete on the spot, and readiness is announced through questReadyLine).
 * Returns the presentation lines in grant order AND the structured list of
 * item ids that actually entered the bag (#169: telemetry reads this, never
 * the rendered lines).
 */
export function grantContextualDrops(
  p: PlayerState,
  drops: readonly ContextualDrop[],
): { lines: string[]; granted: string[] } {
  const lines: string[] = [];
  const granted: string[] = [];
  for (const drop of drops) {
    if (!questDropAllowed(p, drop.item)) continue;
    granted.push(drop.item);
    lines.push(`🎁 Found: ${itemName(drop.item)}${drop.qty > 1 ? ` ×${drop.qty}` : ''}`);
    for (const qid of grantItem(p, drop.item, drop.qty)) lines.push(questReadyLine(qid));
  }
  return { lines, granted };
}
