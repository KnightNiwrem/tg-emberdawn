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
  const table = dropTable(tableId);
  if (!table) return [];
  const out: ContextualDrop[] = [];
  for (const entry of table.entries) {
    if (rng() < entry.chance) out.push({ item: entry.item, qty: entry.qty ?? 1 });
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
  player: PlayerState,
  drops: readonly ContextualDrop[],
): { lines: string[]; granted: string[] } {
  const lines: string[] = [];
  const granted: string[] = [];
  for (const drop of drops) {
    if (!questDropAllowed(player, drop.item)) continue;
    granted.push(drop.item);
    lines.push(`🎁 Found: ${itemName(drop.item)}${drop.qty > 1 ? ` ×${drop.qty}` : ''}`);
    for (const qid of grantItem(player, drop.item, drop.qty)) lines.push(questReadyLine(qid));
  }
  return { lines, granted };
}
