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
  p: PlayerState,
  ev: Exclude<TravelEvent, { kind: 'battle' }>,
  rng: Rng,
): { lines: string[]; granted: string[] } {
  switch (ev.kind) {
    case 'flavor':
      return { lines: [`${ev.text}`], granted: [] };
    case 'rest': {
      const s = statsOf(p);
      const healHp = Math.floor(s.maxHp * ev.healPct);
      const healMp = Math.floor(s.maxMp * ev.healPct);
      p.hp = Math.min(s.maxHp, p.hp + healHp);
      p.mp = Math.min(s.maxMp, p.mp + healMp);
      return {
        lines: [`🌙 ${ev.text}`, `💚 +${healHp} HP · 💧 +${healMp} MP`],
        granted: [],
      };
    }
    case 'treasure': {
      const lines = [`✨ ${ev.text}`];
      const granted: string[] = [];
      if (ev.gold) {
        const g = randInt(rng, Math.floor(ev.gold * 0.8), Math.ceil(ev.gold * 1.3));
        p.gold += g;
        lines.push(`💰 +${g} gold`);
      }
      if (ev.item) {
        lines.push(`🎁 Found: ${itemName(ev.item)}`);
        granted.push(ev.item);
        for (const qid of grantItem(p, ev.item, 1)) lines.push(questReadyLine(qid));
      }
      if (ev.dropTable) {
        // Contextual route resources (#158) through the ONE shared grant
        // site — quest-kind drops stay relevance-filtered (#165). The
        // granted ids are the STRUCTURED grant (#169).
        const rolled = grantContextualDrops(p, rollDropTable(ev.dropTable, rng));
        lines.push(...rolled.lines);
        granted.push(...rolled.granted);
      }
      return { lines, granted };
    }
  }
}
