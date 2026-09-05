/** Shared story fixtures and reference crawler (tests). */

import { assert } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { acceptQuest, syncAvailability } from '../src/engine/quests.ts';
import type { PlayerState } from '../src/engine/types.ts';
import type { StoryEffect } from '../src/content/types.ts';

export function storyEffectRefs(e: StoryEffect): {
  quests: string[];
  items: string[];
  zones: string[];
} {
  const out = { quests: [] as string[], items: [] as string[], zones: [] as string[] };
  switch (e.kind) {
    case 'startQuest':
    case 'resolveQuest':
    case 'failQuest':
    case 'lockQuest':
      out.quests.push(e.questId);
      break;
    case 'grantItem':
    case 'removeItem':
      out.items.push(e.itemId);
      break;
    case 'unlockZone':
      out.zones.push(e.zoneId);
      break;
    default:
      break;
  }
  return out;
}

/** At the Ferryman's dock with the pledge parent active before any
 * committing response exists to advance it (#147). */
export function ferryHero(id: number): PlayerState {
  const p = createPlayer(id, 'T', 'warrior');
  p.currentZone = 'hollowmere';
  p.unlockedZones.push('hollowmere');
  p.flags['zone_hollowmere'] = true;
  syncAvailability(p);
  assert(acceptQuest(p, 'sq_shrine_pledge', 'npc_ferryman').ok);
  return p;
}
