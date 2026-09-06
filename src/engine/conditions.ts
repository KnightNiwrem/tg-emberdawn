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
export function evalCondition(player: PlayerState, condition: Condition): boolean {
  if ('all' in condition) return condition.all.every((sub) => evalCondition(player, sub));
  if ('any' in condition) return condition.any.some((sub) => evalCondition(player, sub));
  if ('not' in condition) return !evalCondition(player, condition.not);
  if ('questStatus' in condition) {
    return statusList(condition.questStatus.is).includes(
      player.quests[condition.questStatus.questId]?.status ?? 'unavailable',
    );
  }
  if ('decision' in condition) {
    const rec = player.decisions[condition.decision.id];
    if (!rec) return false;
    return condition.decision.choiceId === undefined ||
      rec.choiceId === condition.decision.choiceId;
  }
  if ('flag' in condition) {
    const flagValue = player.flags[condition.flag.id];
    if (flagValue === undefined) return false;
    return condition.flag.equals === undefined || flagValue === condition.flag.equals;
  }
  if ('levelAtLeast' in condition) return player.level >= condition.levelAtLeast;
  if ('ownsItem' in condition) {
    return countOf(player, condition.ownsItem.itemId) >= (condition.ownsItem.count ?? 1);
  }
  if ('inZone' in condition) return player.currentZone === condition.inZone;
  if ('questOutcome' in condition) {
    const outcome = player.questOutcomes[condition.questOutcome.questId];
    if (!outcome) return false;
    if (condition.questOutcome.kind !== undefined && outcome.kind !== condition.questOutcome.kind) {
      return false;
    }
    // A named outcome is a resolved-only concept (#150): a failed/locked
    // record never matches an outcome query — even when the condition omits
    // `kind` — because such a record can never have carried one.
    if (
      condition.questOutcome.outcome !== undefined &&
      (outcome.kind !== 'resolved' || outcome.outcome !== condition.questOutcome.outcome)
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/** Every content id a condition references — the integrity test's crawl
 * list (quest ids, item ids, zone ids). */
export function conditionRefs(condition: Condition): {
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
  walk(condition);
  return out;
}
