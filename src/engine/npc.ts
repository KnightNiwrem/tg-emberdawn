/**
 * NPC topic resolution (#123, #131): clicking an NPC opens an explicit
 * topic-selection scene instead of auto-running the first matching quest
 * branch. This pure resolver enumerates EVERY currently available
 * interaction — ready turn-ins, new offers, active business, authored
 * lore — in a deterministic, stable order. Priority ordering emphasizes
 * rows; it never makes other topics inaccessible. Opening the menu is
 * navigation and performs no mutation.
 *
 * #131: the resolver is the ONE authority for both rendering and
 * selection. Each resolved row carries the dialogue it would open — and a
 * row carries a dialogue ONLY when the selected NPC owns it
 * (`dialogue.npcId === npcId`), so a topic can never route into another
 * NPC's conversation. Handlers re-resolve the exact row (kind + id) from a
 * FRESH `npcTopics(p, npcId)` at tap time: stale, forged or no-longer-
 * available selections (including a lore `when` that turned false after
 * render) are absent from the fresh list and refuse without mutation.
 */

import type { PlayerState } from './types.ts';
import type { QuestDef } from '../content/types.ts';
import { npc, QUESTS } from '../content/quests.ts';
import { dialogue } from '../content/dialogues.ts';
import { evalCondition } from './conditions.ts';

export type NpcTopicKind = 'questTurnIn' | 'questOffer' | 'questActive' | 'lore';

export interface NpcTopic {
  /** Compact callback-safe address: quest id or authored topic id. */
  id: string;
  kind: NpcTopicKind;
  questId?: string;
  /** Player-facing row label. */
  label: string;
  /** The dialogue this row opens, resolved at enumeration time. Present
   * ONLY when the selected NPC owns the dialogue — ownership is the
   * routing authority (#131). Absent rows are pure reminders (quest rows)
   * or static text (lore rows). */
  dialogueId?: string;
}

/** The dialogue a quest's active-business row may open for THIS npc: the
 * authored conversation, only while one of its story events is still
 * pending AND the conversation belongs to the selected NPC. At any other
 * contact the row is a non-mutating progress reminder (#131). */
function ownedConversation(
  p: PlayerState,
  q: QuestDef,
  npcId: string,
): string | undefined {
  if (!q.conversationDialogue) return undefined;
  const pendingEvent = q.objectives.some((o) =>
    o.kind === 'storyEvent' && !p.storyEvents.includes(o.target)
  );
  if (!pendingEvent) return undefined;
  const conv = dialogue(q.conversationDialogue);
  return conv?.npcId === npcId ? conv.id : undefined;
}

/** Every currently valid topic for this NPC, in presentation order:
 * ready turn-ins, then new offers, then active business, then authored
 * lore. Quest-catalog order is never a filter — `find` would hide the
 * rest; this enumerates. */
export function npcTopics(p: PlayerState, npcId: string): NpcTopic[] {
  const topics: NpcTopic[] = [];
  for (const q of QUESTS) {
    // Turn-in business belongs to the configured finisher alone (#63) —
    // and only a dialogue that NPC actually owns is routable (#131).
    if (q.finishNpc === npcId && p.quests[q.id]?.status === 'turnIn') {
      const d = dialogue(q.turnInDialogue);
      topics.push({
        id: q.id,
        kind: 'questTurnIn',
        questId: q.id,
        label: `🏁 Report: ${q.name}`,
        dialogueId: d?.npcId === npcId ? d.id : undefined,
      });
    }
  }
  for (const q of QUESTS) {
    // Offers belong to the configured starter alone (#63).
    if (q.startNpc === npcId && p.quests[q.id]?.status === 'available') {
      const d = dialogue(q.offerDialogue);
      topics.push({
        id: q.id,
        kind: 'questOffer',
        questId: q.id,
        label: `📜 ${q.name}`,
        dialogueId: d?.npcId === npcId ? d.id : undefined,
      });
    }
  }
  for (const q of QUESTS) {
    // Active business is listed at BOTH contacts so the player always has
    // a pointer; only the conversation's OWNING NPC opens it — the other
    // contact's row is a pure progress reminder (#131).
    if (
      (q.startNpc === npcId || q.finishNpc === npcId) &&
      p.quests[q.id]?.status === 'active'
    ) {
      topics.push({
        id: q.id,
        kind: 'questActive',
        questId: q.id,
        label: `⏳ ${q.name}`,
        dialogueId: ownedConversation(p, q, npcId),
      });
    }
  }
  for (const t of npc(npcId)?.topics ?? []) {
    // Authored availability conditions (#125): the shared declarative
    // language, evaluated pure at enumeration time and revalidated at tap
    // time by re-resolving the row in the handler (#131).
    if (t.when && !evalCondition(p, t.when)) continue;
    // A dialogue-backed topic routes only to a dialogue this NPC owns —
    // foreign-owned wiring is content corruption, never a route (#131).
    const d = t.dialogue ? dialogue(t.dialogue) : undefined;
    if (t.dialogue && d?.npcId !== npcId) continue;
    topics.push({ id: t.id, kind: 'lore', label: `❓ ${t.label}`, dialogueId: d?.id });
  }
  return topics;
}
