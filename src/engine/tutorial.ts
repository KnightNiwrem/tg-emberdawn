/** The canonical guided-prologue outcome (#69, shared with the balance
 * harness #74): every hero exits the tutorial at level 2+, and the item
 * lesson's potion is replaced so the guided fight costs nothing permanent.
 * The live handler wraps this with its idempotency flag; the harness
 * applies it to simulated heroes so chapter reports start from the real
 * post-tutorial state instead of an impossible fresh level-1 one. */

import { grantXp } from './character.ts';
import { xpForNextLevel } from './classes.ts';
import { grantItem } from './quests.ts';
import type { PlayerState } from './types.ts';

export function applyTutorialOutcome(p: PlayerState): string[] {
  const lines: string[] = [];
  if (p.level < 2) lines.push(...grantXp(p, xpForNextLevel(1) + 5 - p.xp));
  grantItem(p, 'c_minor_potion', 1);
  lines.push("🎒 Maren's satchel replaces what the lesson spent.");
  return lines;
}
