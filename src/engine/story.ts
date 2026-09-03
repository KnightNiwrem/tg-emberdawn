/**
 * Declarative story effects (#125): the bounded serializable vocabulary for
 * dialogue/story consequences. Plain data — never content functions. Every
 * mutation routes through the CENTRAL quest/inventory/world authorities so
 * quest status, inventory, readiness notices and idempotence cannot drift.
 *
 * Bundles are ATOMIC: validateStoryBundle pre-flights every operation's
 * precondition against the player state in order, and applyStoryEffects
 * refuses to touch anything unless the whole bundle validates. Effects run
 * in documented authored order; repeating the same decision callback
 * cannot duplicate items, quest starts, or lockouts (idempotent guards).
 * Story effects never bypass the physical-contact authority (#63/#64):
 * startQuest only ever starts a quest whose configured STARTER is the
 * acting dialogue's on-site NPC.
 */

import type { PlayerState } from './types.ts';
import { npcInZone, quest as questDef } from '../content/quests.ts';
import { item as itemDef } from '../content/items.ts';
import { zone as zoneDef } from '../content/zones.ts';
import { countOf, removeItem } from './inventory.ts';
import { grantItem, questReadyLine, refreshQuestProgress, syncAvailability } from './quests.ts';

export type StoryEffect =
  | { kind: 'setFlag'; id: string; value?: number | string | boolean }
  | { kind: 'clearFlag'; id: string }
  | { kind: 'recordDecision'; id: string; choiceId: string }
  | { kind: 'storyEvent'; event: string }
  | { kind: 'startQuest'; questId: string }
  | { kind: 'resolveQuest'; questId: string; outcome: string }
  | { kind: 'failQuest'; questId: string; reason?: string }
  | { kind: 'lockQuest'; questId: string; reason?: string }
  | { kind: 'unlockZone'; zoneId: string }
  | { kind: 'grantItem'; itemId: string; qty?: number }
  | { kind: 'removeItem'; itemId: string; qty?: number };

/** Where a bundle is being applied from — provenance for decisions and
 * the on-site authority check for quest starts. */
export interface StoryContext {
  dialogueId: string;
  nodeId: string;
  npcId: string;
  /** Injected clock for deterministic tests (Date.now in handlers). */
  now: number;
}

export interface StoryResult {
  /** Player-facing lines (grants, unlocks) — renderers append them. */
  lines: string[];
  /** Quests this bundle made turn-in-ready (#119) — announce once. */
  readyQuests: string[];
  /** Quests this bundle started. */
  startedQuests: string[];
  /** Story events emitted (deduped). */
  events: string[];
  /** Decisions recorded. */
  decisions: string[];
}

const emptyResult = (): StoryResult => ({
  lines: [],
  readyQuests: [],
  startedQuests: [],
  events: [],
  decisions: [],
});

/** Pre-flights a bundle WITHOUT mutating: every operation's precondition is
 * checked in order against the current state. Returns undefined when the
 * whole bundle would apply cleanly, else a refusal message. Static
 * reference/contradiction validation is content-integrity's job; this is
 * the runtime half that makes bundles all-or-nothing. */
export function validateStoryBundle(
  p: PlayerState,
  effects: readonly StoryEffect[],
  ctx: StoryContext,
): string | undefined {
  // A shadow copy of just the quest statuses/decisions the bundle will
  // produce, so later preconditions see earlier effects (documented order).
  const questStatus: Record<string, string> = {};
  for (const [id, qp] of Object.entries(p.quests)) questStatus[id] = qp.status;
  const decisions = new Map(Object.entries(p.decisions).map(([id, rec]) => [id, rec.choiceId]));
  for (const e of effects) {
    switch (e.kind) {
      case 'recordDecision': {
        const prior = decisions.get(e.id);
        if (prior !== undefined && prior !== e.choiceId) {
          return `Decision ${e.id} was already made differently.`;
        }
        decisions.set(e.id, e.choiceId);
        break;
      }
      case 'startQuest': {
        const q = questDef(e.questId);
        if (!q) return `Unknown quest ${e.questId}.`;
        const st = questStatus[e.questId];
        if (st === 'active' || st === 'turnIn' || st === 'done') break; // idempotent
        // Authority: the acting dialogue's NPC must be the configured
        // starter, on-site (#63/#64) — no dialogue may puppet quests from
        // strangers.
        if (q.startNpc !== ctx.npcId || !npcInZone(p.currentZone, ctx.npcId)) {
          return `${q.name} can only be started by its own contact, on-site.`;
        }
        if (
          p.questOutcomes[e.questId]?.kind === 'locked' ||
          p.questOutcomes[e.questId]?.kind === 'failed'
        ) {
          return `${q.name} is no longer reachable.`;
        }
        if (st !== 'available') return `${q.name} is not available right now.`;
        questStatus[e.questId] = 'active';
        break;
      }
      case 'resolveQuest': {
        const st = questStatus[e.questId];
        if (st === 'done') break; // idempotent
        if (st !== 'active' && st !== 'turnIn') {
          return `${e.questId} cannot be resolved from status ${st ?? 'unavailable'}.`;
        }
        questStatus[e.questId] = 'done';
        break;
      }
      case 'failQuest':
      case 'lockQuest': {
        const prior = p.questOutcomes[e.questId];
        if (prior?.kind === (e.kind === 'failQuest' ? 'failed' : 'locked')) break; // idempotent
        if (!questDef(e.questId)) return `Unknown quest ${e.questId}.`;
        break;
      }
      case 'grantItem':
      case 'removeItem': {
        if (!itemDef(e.itemId)) return `Unknown item ${e.itemId}.`;
        if (e.kind === 'removeItem') {
          const have = countOf(p, e.itemId);
          if (have < (e.qty ?? 1)) return `Not enough ${e.itemId} to remove.`;
        }
        break;
      }
      case 'unlockZone': {
        if (!zoneDef(e.zoneId)) return `Unknown zone ${e.zoneId}.`;
        break;
      }
      case 'setFlag':
      case 'clearFlag':
      case 'storyEvent':
        break; // always applicable
    }
  }
  return undefined;
}

/** Applies a pre-validated bundle in authored order. Callers must treat
 * validateStoryBundle as the gate — apply assumes it passed. */
export function applyStoryEffects(
  p: PlayerState,
  effects: readonly StoryEffect[],
  ctx: StoryContext,
): StoryResult {
  const refusal = validateStoryBundle(p, effects, ctx);
  if (refusal) throw new Error(`story bundle refused: ${refusal}`);
  const result = emptyResult();
  for (const e of effects) {
    switch (e.kind) {
      case 'setFlag':
        p.flags[e.id] = e.value ?? true;
        break;
      case 'clearFlag':
        delete p.flags[e.id];
        break;
      case 'recordDecision': {
        if (p.decisions[e.id]) break; // idempotent — never overwrite
        p.decisions[e.id] = {
          choiceId: e.choiceId,
          dialogueId: ctx.dialogueId,
          nodeId: ctx.nodeId,
          chosenAt: ctx.now,
        };
        result.decisions.push(e.id);
        break;
      }
      case 'storyEvent': {
        if (!p.storyEvents.includes(e.event)) p.storyEvents.push(e.event);
        result.events.push(e.event);
        break;
      }
      case 'startQuest': {
        const st = p.quests[e.questId]?.status;
        if (st === 'active' || st === 'turnIn' || st === 'done') break;
        const started = startQuestViaStory(p, e.questId);
        if (started) result.startedQuests.push(e.questId);
        break;
      }
      case 'resolveQuest': {
        const qp = p.quests[e.questId];
        if (!qp || qp.status === 'done') break;
        if (qp.status !== 'active' && qp.status !== 'turnIn') break;
        qp.status = 'done';
        p.questOutcomes[e.questId] = {
          kind: 'resolved',
          outcome: e.outcome,
          at: ctx.now,
        };
        break;
      }
      case 'failQuest': {
        const prior = p.questOutcomes[e.questId];
        if (prior?.kind === 'failed') break;
        const qp = p.quests[e.questId];
        if (qp && qp.status !== 'done') qp.status = 'unavailable';
        p.questOutcomes[e.questId] = {
          kind: 'failed',
          reason: e.reason,
          by: ctx.dialogueId,
          at: ctx.now,
        };
        break;
      }
      case 'lockQuest': {
        const prior = p.questOutcomes[e.questId];
        if (prior?.kind === 'locked') break;
        const qp = p.quests[e.questId];
        if (qp && qp.status !== 'done') qp.status = 'unavailable';
        p.questOutcomes[e.questId] = {
          kind: 'locked',
          reason: e.reason,
          by: ctx.dialogueId,
          at: ctx.now,
        };
        break;
      }
      case 'unlockZone': {
        if (!p.unlockedZones.includes(e.zoneId)) {
          p.unlockedZones.push(e.zoneId);
          result.lines.push(`🗺️ New area unlocked: ${zoneDef(e.zoneId)?.name ?? e.zoneId}`);
        }
        break;
      }
      case 'grantItem': {
        const ready = grantItem(p, e.itemId, e.qty ?? 1);
        result.lines.push(`🎁 Received: ${itemDef(e.itemId)?.name ?? e.itemId}`);
        result.readyQuests.push(...ready);
        break;
      }
      case 'removeItem': {
        removeItem(p, e.itemId, e.qty ?? 1);
        break;
      }
    }
  }
  // Availability may have shifted (flags/levels are unchanged here, but a
  // locked quest must drop out of 'available' at once) and collect
  // objectives may have completed from granted items.
  result.readyQuests.push(...refreshQuestProgress(p));
  syncAvailability(p);
  return result;
}

/** The central story-path quest start: status mutation ONLY (no rewards,
 * no contact side effects) after validateStoryBundle's authority check. */
function startQuestViaStory(p: PlayerState, questId: string): boolean {
  const q = questDef(questId);
  const qp = p.quests[questId];
  if (!q || !qp || qp.status !== 'available') return false;
  qp.status = 'active';
  qp.counts = q.objectives.map(() => 0);
  return true;
}

/** Formats the result for the notice banner (ready lines once, #119). */
export function storyNoticeLines(result: StoryResult): string[] {
  return [
    ...result.lines,
    ...result.readyQuests.map(questReadyLine),
  ];
}
