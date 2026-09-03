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
import type { StoryEffect } from '../content/types.ts';
import { npcInZone, quest as questDef } from '../content/quests.ts';
import { dialogue as dialogueDef } from '../content/dialogues.ts';
import { item as itemDef } from '../content/items.ts';
import { zone as zoneDef } from '../content/zones.ts';
import { countOf, removeItem } from './inventory.ts';
import { grantItem, questReadyLine, refreshQuestProgress, syncAvailability } from './quests.ts';
import { evalCondition } from './conditions.ts';

/** The central story-path authorities. (StoryEffect itself is content
 * data — see content/types.ts.) */

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

// ── Branching choices (#126) ─────────────────────────────────────────────

export interface ChoiceApplyArgs {
  dialogueId: string;
  nodeId: string;
  choiceId: string;
  npcId: string;
  now: number;
}

export interface ChoiceApplyResult {
  ok: boolean;
  refusal?: string;
  /** Node to render next; undefined → the conversation ends and the
   * player returns to the NPC topic menu. */
  nextNodeId?: string;
  /** Notices for the next screen (lines + once-only readiness, #119). */
  lines: string[];
  /** True when the applied choice was recorded as this decision's winner. */
  decided?: string;
}

/** The ONE central operation that validates and applies a dialogue choice
 * (#126): re-evaluates availability, refuses incompatible prior decisions,
 * applies the declarative effects atomically (validateStoryBundle), and
 * derives the next beat. Effects themselves are idempotent, so a choice
 * replay can never double-grant or overwrite a recorded decision. */
export function applyDialogueChoice(
  p: PlayerState,
  args: ChoiceApplyArgs,
): ChoiceApplyResult {
  const d = dialogueDef(args.dialogueId);
  const node = d?.nodes.find((n) => n.id === args.nodeId);
  if (!d || !node || node.kind !== 'choice') {
    return { ok: false, refusal: 'That conversation has moved on.', lines: [] };
  }
  const choice = node.choices.find((c) => c.id === args.choiceId);
  if (!choice) return { ok: false, refusal: 'That response is not on the table.', lines: [] };
  // Availability is re-evaluated at tap time — rendering was never authority.
  if (choice.when && !evalCondition(p, choice.when)) {
    return { ok: false, refusal: 'That response is no longer available.', lines: [] };
  }
  // An already-recorded decision cannot be overwritten by a different
  // choice — the ledger wins over any replay or forged tap.
  const decisionEffects = (choice.effects ?? []).filter((e) => e.kind === 'recordDecision');
  for (const e of decisionEffects) {
    if (e.kind === 'recordDecision') {
      const prior = p.decisions[e.id];
      if (prior && prior.choiceId !== e.choiceId) {
        return { ok: false, refusal: 'That decision was already made.', lines: [] };
      }
    }
  }
  const ctx: StoryContext = {
    dialogueId: d.id,
    nodeId: node.id,
    npcId: args.npcId,
    now: args.now,
  };
  const effects = choice.effects ?? [];
  const refusal = validateStoryBundle(p, effects, ctx);
  if (refusal) return { ok: false, refusal, lines: [] };
  const result = applyStoryEffects(p, effects, ctx);
  return {
    ok: true,
    nextNodeId: choice.next,
    lines: storyNoticeLines(result),
    decided: result.decisions[0],
  };
}
