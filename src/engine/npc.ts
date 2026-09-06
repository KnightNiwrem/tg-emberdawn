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
  player: PlayerState,
  questDef: QuestDef,
  npcId: string,
): string | undefined {
  if (!questDef.conversationDialogue) return undefined;
  const pendingEvent = questDef.objectives.some((objective) =>
    objective.kind === 'storyEvent' && !player.storyEvents.includes(objective.target)
  );
  if (!pendingEvent) return undefined;
  const conv = dialogue(questDef.conversationDialogue);
  return conv?.npcId === npcId ? conv.id : undefined;
}

/** Every currently valid topic for this NPC, in presentation order:
 * ready turn-ins, then new offers, then active business, then authored
 * lore. Quest-catalog order is never a filter — `find` would hide the
 * rest; this enumerates. */
export function npcTopics(player: PlayerState, npcId: string): NpcTopic[] {
  const topics: NpcTopic[] = [];
  for (const questDef of QUESTS) {
    // Turn-in business belongs to the configured finisher alone (#63) —
    // and only a dialogue that NPC actually owns is routable (#131).
    if (questDef.finishNpc === npcId && player.quests[questDef.id]?.status === 'turnIn') {
      const dlg = dialogue(questDef.turnInDialogue);
      topics.push({
        id: questDef.id,
        kind: 'questTurnIn',
        questId: questDef.id,
        label: `🏁 Report: ${questDef.name}`,
        dialogueId: dlg?.npcId === npcId ? dlg.id : undefined,
      });
    }
  }
  for (const questDef of QUESTS) {
    // Offers belong to the configured starter alone (#63).
    if (questDef.startNpc === npcId && player.quests[questDef.id]?.status === 'available') {
      const dlg = dialogue(questDef.offerDialogue);
      topics.push({
        id: questDef.id,
        kind: 'questOffer',
        questId: questDef.id,
        label: `📜 ${questDef.name}`,
        dialogueId: dlg?.npcId === npcId ? dlg.id : undefined,
      });
    }
  }
  for (const questDef of QUESTS) {
    // Active business is listed at BOTH contacts so the player always has
    // a pointer; only the conversation's OWNING NPC opens it — the other
    // contact's row is a pure progress reminder (#131).
    if (
      (questDef.startNpc === npcId || questDef.finishNpc === npcId) &&
      player.quests[questDef.id]?.status === 'active'
    ) {
      topics.push({
        id: questDef.id,
        kind: 'questActive',
        questId: questDef.id,
        label: `⏳ ${questDef.name}`,
        dialogueId: ownedConversation(player, questDef, npcId),
      });
    }
  }
  for (const topic of npc(npcId)?.topics ?? []) {
    // Authored availability conditions (#125): the shared declarative
    // language, evaluated pure at enumeration time and revalidated at tap
    // time by re-resolving the row in the handler (#131).
    if (topic.when && !evalCondition(player, topic.when)) continue;
    // A dialogue-backed topic routes only to a dialogue this NPC owns —
    // foreign-owned wiring is content corruption, never a route (#131).
    const dlg = topic.dialogue ? dialogue(topic.dialogue) : undefined;
    if (topic.dialogue && dlg?.npcId !== npcId) continue;
    topics.push({ id: topic.id, kind: 'lore', label: `❓ ${topic.label}`, dialogueId: dlg?.id });
  }
  return topics;
}
