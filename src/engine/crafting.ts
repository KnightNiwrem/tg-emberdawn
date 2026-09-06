/** Processing revalidates local facilities and all costs before mutating inventory. */
import { DUNGEON_BLOCK } from './dungeon_run.ts';
import { recipe, type RecipeDef, RECIPES } from '../content/crafting.ts';
import { itemName } from '../content/items.ts';
import { countOf, removeItem } from './inventory.ts';
import { grantItem, questReadyLine } from './quests.ts';
import { JOURNEY_BLOCK } from './routes.ts';
import type { PlayerState } from './types.ts';

/** Include level-locked work so the counter can disclose requirements. */
export function recipesAt(p: PlayerState): RecipeDef[] {
  return RECIPES.filter((r) => r.zones.includes(p.currentZone));
}

export function recipeBlock(p: PlayerState, id: string): string | undefined {
  if (p.battle) return '⚔️ Finish the fight first.';
  if (p.dungeonRun) return DUNGEON_BLOCK;
  if (p.journey) return JOURNEY_BLOCK;
  const r = recipe(id);
  if (!r || !r.zones.includes(p.currentZone)) return 'That recipe is not available here.';
  if (p.level < r.level) return `Requires level ${r.level}.`;
  if (p.gold < r.gold) return `💰 Needs ${r.gold} gold.`;
  const missing = r.inputs.filter((input) => countOf(p, input.id) < input.qty);
  if (missing.length) {
    return `Needs ${missing.map((m) => `${m.qty}× ${itemName(m.id)}`).join(' · ')}.`;
  }
  return undefined;
}

export function craft(p: PlayerState, id: string): { ok: boolean; lines: string[] } {
  const block = recipeBlock(p, id);
  if (block) return { ok: false, lines: [block] };
  const r = recipe(id)!;
  // Synchronous transaction: every input is checked before the first debit.
  for (const input of r.inputs) removeItem(p, input.id, input.qty);
  p.gold -= r.gold;
  const ready = grantItem(p, r.output.id, r.output.qty);
  return {
    ok: true,
    lines: [`Made ${r.output.qty}× ${itemName(r.output.id)}.`, ...ready.map(questReadyLine)],
  };
}
