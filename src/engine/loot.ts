/**
 * Contextual loot rolling (#158): zones and routes award region-specific
 * resources IN ADDITION to ordinary enemy rewards, without cloning enemy
 * definitions. Pure: seeded rng in, item ids out. Grant sites must route
 * quest-kind drops through the central relevance filter
 * (engine/quests.ts questDropAllowed) — relevance is never decided here.
 */

import { dropTable } from '../content/loot.ts';
import { defaultRng, type Rng } from './rng.ts';

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
