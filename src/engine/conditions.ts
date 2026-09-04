/**
 * Declarative story-condition evaluation (#125): the engine half of the
 * shared condition language defined in content/types.ts. Pure, serializable
 * data in — boolean out. Never mutates the player, never branches on
 * content ids. Shared by NPC topic availability, dialogue choices (#126),
 * quest eligibility, and later consequences.
 */

import type { Condition } from '../content/types.ts';
import type { PlayerState, QuestStatus } from './types.ts';
import { countOf } from './inventory.ts';

function statusList(is: string | string[]): QuestStatus[] {
  return (Array.isArray(is) ? is : [is]) as QuestStatus[];
}

/** Pure, deterministic evaluation. Never mutates the player. */
export function evalCondition(p: PlayerState, c: Condition): boolean {
  if ('all' in c) return c.all.every((sub) => evalCondition(p, sub));
  if ('any' in c) return c.any.some((sub) => evalCondition(p, sub));
  if ('not' in c) return !evalCondition(p, c.not);
  if ('questStatus' in c) {
    return statusList(c.questStatus.is).includes(
      p.quests[c.questStatus.questId]?.status ?? 'unavailable',
    );
  }
  if ('decision' in c) {
    const rec = p.decisions[c.decision.id];
    if (!rec) return false;
    return c.decision.choiceId === undefined || rec.choiceId === c.decision.choiceId;
  }
  if ('flag' in c) {
    const v = p.flags[c.flag.id];
    if (v === undefined) return false;
    return c.flag.equals === undefined || v === c.flag.equals;
  }
  if ('levelAtLeast' in c) return p.level >= c.levelAtLeast;
  if ('ownsItem' in c) return countOf(p, c.ownsItem.itemId) >= (c.ownsItem.count ?? 1);
  if ('inZone' in c) return p.currentZone === c.inZone;
  if ('questOutcome' in c) {
    const o = p.questOutcomes[c.questOutcome.questId];
    if (!o) return false;
    if (c.questOutcome.kind !== undefined && o.kind !== c.questOutcome.kind) return false;
    if (c.questOutcome.outcome !== undefined && o.outcome !== c.questOutcome.outcome) return false;
    return true;
  }
  return false;
}

/** Every content id a condition references — the integrity test's crawl
 * list (quest ids, item ids, zone ids). */
export function conditionRefs(c: Condition): {
  quests: string[];
  items: string[];
  zones: string[];
} {
  const out = { quests: [] as string[], items: [] as string[], zones: [] as string[] };
  const walk = (cond: Condition): void => {
    if ('all' in cond) return cond.all.forEach(walk);
    if ('any' in cond) return cond.any.forEach(walk);
    if ('not' in cond) return walk(cond.not);
    if ('questStatus' in cond) out.quests.push(cond.questStatus.questId);
    if ('questOutcome' in cond) out.quests.push(cond.questOutcome.questId);
    if ('ownsItem' in cond) out.items.push(cond.ownsItem.itemId);
    if ('inZone' in cond) out.zones.push(cond.inZone);
  };
  walk(c);
  return out;
}
