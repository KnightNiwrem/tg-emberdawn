/** Processing revalidates local facilities and all costs before mutating inventory. */
import { DUNGEON_BLOCK } from './dungeon_run.ts';
import { recipe, type RecipeDef, RECIPES } from '../content/crafting.ts';
import { itemName } from '../content/items.ts';
import { countOf, removeItem } from './inventory.ts';
import { grantItem, questReadyLine } from './quests.ts';
import { JOURNEY_BLOCK } from './routes.ts';
import type { PlayerState } from './types.ts';

/** Include level-locked work so the counter can disclose requirements. */
export function recipesAt(player: PlayerState): RecipeDef[] {
  return RECIPES.filter((recipeDef) => recipeDef.zones.includes(player.currentZone));
}

export function recipeBlock(player: PlayerState, id: string): string | undefined {
  if (player.battle) return '⚔️ Finish the fight first.';
  if (player.dungeonRun) return DUNGEON_BLOCK;
  if (player.journey) return JOURNEY_BLOCK;
  const recipeDef = recipe(id);
  if (!recipeDef || !recipeDef.zones.includes(player.currentZone)) {
    return 'That recipe is not available here.';
  }
  if (player.level < recipeDef.level) return `Requires level ${recipeDef.level}.`;
  if (player.gold < recipeDef.gold) return `💰 Needs ${recipeDef.gold} gold.`;
  const missing = recipeDef.inputs.filter((input) => countOf(player, input.id) < input.qty);
  if (missing.length) {
    return `Needs ${missing.map((mat) => `${mat.qty}× ${itemName(mat.id)}`).join(' · ')}.`;
  }
  return undefined;
}

export function craft(player: PlayerState, id: string): { ok: boolean; lines: string[] } {
  const block = recipeBlock(player, id);
  if (block) return { ok: false, lines: [block] };
  const recipeDef = recipe(id)!;
  // Synchronous transaction: every input is checked before the first debit.
  for (const input of recipeDef.inputs) removeItem(player, input.id, input.qty);
  player.gold -= recipeDef.gold;
  const ready = grantItem(player, recipeDef.output.id, recipeDef.output.qty);
  return {
    ok: true,
    lines: [
      `Made ${recipeDef.output.qty}× ${itemName(recipeDef.output.id)}.`,
      ...ready.map(questReadyLine),
    ],
  };
}
