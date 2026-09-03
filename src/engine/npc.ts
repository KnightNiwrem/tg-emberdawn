/**
 * NPC topic resolution (#123): clicking an NPC opens an explicit
 * topic-selection scene instead of auto-running the first matching quest
 * branch. This pure resolver enumerates EVERY currently available
 * interaction — ready turn-ins, new offers, active business, authored
 * lore — in a deterministic, stable order. Priority ordering emphasizes
 * rows; it never makes other topics inaccessible. Opening the menu is
 * navigation and performs no mutation; availability is re-evaluated at
 * tap time by the handlers.
 */

import type { PlayerState } from './types.ts';
import { npc, QUESTS } from '../content/quests.ts';
import { evalCondition } from './conditions.ts';

export type NpcTopicKind = 'questTurnIn' | 'questOffer' | 'questActive' | 'lore';

export interface NpcTopic {
  /** Compact callback-safe address: quest id or authored topic id. */
  id: string;
  kind: NpcTopicKind;
  questId?: string;
  /** Player-facing row label. */
  label: string;
}

/** Every currently valid topic for this NPC, in presentation order:
 * ready turn-ins, then new offers, then active business, then authored
 * lore. Quest-catalog order is never a filter — `find` would hide the
 * rest; this enumerates. */
export function npcTopics(p: PlayerState, npcId: string): NpcTopic[] {
  const topics: NpcTopic[] = [];
  for (const q of QUESTS) {
    if (q.finishNpc === npcId && p.quests[q.id]?.status === 'turnIn') {
      topics.push({
        id: q.id,
        kind: 'questTurnIn',
        questId: q.id,
        label: `🏁 Report: ${q.name}`,
      });
    }
  }
  for (const q of QUESTS) {
    if (q.startNpc === npcId && p.quests[q.id]?.status === 'available') {
      topics.push({ id: q.id, kind: 'questOffer', questId: q.id, label: `📜 ${q.name}` });
    }
  }
  for (const q of QUESTS) {
    if (
      (q.startNpc === npcId || q.finishNpc === npcId) &&
      p.quests[q.id]?.status === 'active'
    ) {
      topics.push({ id: q.id, kind: 'questActive', questId: q.id, label: `⏳ ${q.name}` });
    }
  }
  for (const t of npc(npcId)?.topics ?? []) {
    // Authored availability conditions (#125): the shared declarative
    // language, evaluated pure at enumeration time and revalidated at
    // tap time by the handler.
    if (t.when && !evalCondition(p, t.when)) continue;
    topics.push({ id: t.id, kind: 'lore', label: `❓ ${t.label}` });
  }
  return topics;
}
