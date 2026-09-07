/** Shared story fixtures and reference crawler (tests). */

import { assert } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { acceptQuest, syncAvailability } from '../src/engine/quests.ts';
import type { PlayerState } from '../src/engine/types.ts';
import type { StoryEffect } from '../src/content/types.ts';

export function storyEffectRefs(effect: StoryEffect): {
  quests: string[];
  items: string[];
  zones: string[];
} {
  const out = { quests: [] as string[], items: [] as string[], zones: [] as string[] };
  switch (effect.kind) {
    case 'startQuest':
    case 'resolveQuest':
    case 'failQuest':
    case 'lockQuest':
      out.quests.push(effect.questId);
      break;
    case 'grantItem':
    case 'removeItem':
      out.items.push(effect.itemId);
      break;
    case 'unlockZone':
      out.zones.push(effect.zoneId);
      break;
    default:
      break;
  }
  return out;
}

/** At the Ferryman's dock with the pledge parent active before any
 * committing response exists to advance it (#147). */
export function ferryHero(id: number): PlayerState {
  const player = createPlayer(id, 'T', 'warrior');
  player.currentZone = 'hollowmere';
  player.unlockedZones.push('hollowmere');
  player.flags['zone_hollowmere'] = true;
  syncAvailability(player);
  assert(acceptQuest(player, 'sq_shrine_pledge', 'npc_ferryman').ok);
  return player;
}
