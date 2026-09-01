/** The canonical guided-prologue outcome (#69, shared with the balance
 * harness #74): every hero exits the tutorial at level 2+, and the item
 * lesson's potion is replaced so the guided fight costs nothing permanent.
 * The live handler wraps the outcome with its idempotency flag; the balance
 * sim uses the canonical constructor below. */

import { createPlayer, grantXp } from './character.ts';
import { xpForNextLevel } from './classes.ts';
import { grantItem } from './quests.ts';
import type { ClassId, PlayerState } from './types.ts';

/** XP half of the outcome (#69): every hero exits the prologue at level 2+. */
function grantTutorialXp(p: PlayerState): string[] {
  return p.level < 2 ? grantXp(p, xpForNextLevel(1) + 5 - p.xp) : [];
}

/** ONE canonical post-tutorial constructor (#74): the fresh class kit with
 * the level topped to 2. The live item lesson spends a potion and the ember
 * reward replaces it — net zero inventory change — so the canonical state
 * is exactly the fresh kit. The balance sim starts here; the live full-flow
 * test pins real play to this same state. */
export function createPostTutorialPlayer(
  userId: number,
  name: string,
  classId: ClassId,
): PlayerState {
  const p = createPlayer(userId, name, classId);
  grantTutorialXp(p);
  return p;
}

/** Live-path outcome: XP top-up plus the potion the lesson actually spent. */
export function applyTutorialOutcome(p: PlayerState): string[] {
  const lines = [...grantTutorialXp(p)];
  grantItem(p, 'c_minor_potion', 1);
  lines.push("🎒 Maren's satchel replaces what the lesson spent.");
  return lines;
}
