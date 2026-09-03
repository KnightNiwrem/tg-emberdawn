/** Shared crawler for StoryEffect references (tests). */

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
