/** Shared ordered rewards for exploration and travel quiet events (#179). */

import type { TravelEvent } from '../content/types.ts';
import type { PlayerState } from './types.ts';
import { itemName } from '../content/items.ts';
import { statsOf } from './character.ts';
import { grantItem, questReadyLine } from './quests.ts';
import { randInt, type Rng } from './rng.ts';
import { grantContextualDrops, rollDropTable } from './loot.ts';

/** Resolves ONE non-interactive event exactly once; returns its lines and
 * the structured list of items it granted. Battle events never reach here. */
export function applyQuietEvent(
  player: PlayerState,
  event: Exclude<TravelEvent, { kind: 'battle' }>,
  rng: Rng,
): { lines: string[]; granted: string[] } {
  switch (event.kind) {
    case 'flavor':
      return { lines: [`${event.text}`], granted: [] };
    case 'rest': {
      const stats = statsOf(player);
      const healHp = Math.min(stats.maxHp - player.hp, Math.floor(stats.maxHp * event.healPct));
      const healMp = Math.min(stats.maxMp - player.mp, Math.floor(stats.maxMp * event.healPct));
      player.hp = Math.min(stats.maxHp, player.hp + healHp);
      player.mp = Math.min(stats.maxMp, player.mp + healMp);
      return {
        lines: [`🌙 ${event.text}`, `💚 +${healHp} HP · 💧 +${healMp} MP`],
        granted: [],
      };
    }
    case 'treasure': {
      const lines = [`✨ ${event.text}`];
      const granted: string[] = [];
      if (event.gold) {
        const goldAmount = randInt(rng, Math.floor(event.gold * 0.8), Math.ceil(event.gold * 1.3));
        player.gold += goldAmount;
        lines.push(`💰 +${goldAmount} gold`);
      }
      if (event.item) {
        lines.push(`🎁 Found: ${itemName(event.item)}`);
        granted.push(event.item);
        for (const questId of grantItem(player, event.item, 1)) lines.push(questReadyLine(questId));
      }
      if (event.dropTable) {
        // Contextual route resources (#158) through the ONE shared grant
        // site — quest-kind drops stay relevance-filtered (#165). The
        // granted ids are the STRUCTURED grant (#169).
        const rolled = grantContextualDrops(player, rollDropTable(event.dropTable, rng));
        lines.push(...rolled.lines);
        granted.push(...rolled.granted);
      }
      return { lines, granted };
    }
  }
}
