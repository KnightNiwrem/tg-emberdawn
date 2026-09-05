/**
 * Declarative story effects (#125): the bounded serializable vocabulary for
 * dialogue/story consequences. Plain data — never content functions. Every
 * mutation routes through the CENTRAL quest/inventory/world authorities so
 * quest status, inventory, readiness notices and idempotence cannot drift.
 *
 * Bundles are TRANSACTIONAL (#129): an application clones the player into a
 * draft and applies every effect to that draft in authored order — each
 * effect's preconditions read the draft, so later effects see the projected
 * result of all earlier ones (grant → remove nets to zero; an impossible
 * cumulative removal refuses). The draft commits exactly once, only when
 * every operation succeeded; any refusal discards it and leaves the live
 * player byte-for-byte unchanged. validateStoryBundle is the SAME ordered
 * run against a throwaway draft, so its answer can never drift from what
 * application would do, and a mutating helper's failure (removeItem,
 * acceptQuest, turnInQuest) is a refusal — never silently ignored. The
 * returned StoryResult describes the FINAL committed draft (#137):
 * readyQuests is deduplicated and reconciled against it, so readiness a
 * later effect in the same bundle revoked never reaches the notice banner.
 *
 * Every committed application records a one-shot RECEIPT in
 * p.storyReceipts: `choice:<dialogue>:<node>:<choice>` for dialogue
 * choices, `line:<dialogue>:<node>` for line-entry effects. Replaying a
 * receipted application is a complete no-op — no duplicated items, rewards,
 * events, quest starts, locks or notices — so bundle-level idempotency no
 * longer rests on per-effect guards. Validation and application share the
 * receipt (#137): an already-committed application VALIDATES clean and
 * applies as a no-op, while a refused application records no receipt and
 * stays retryable.
 *
 * Terminal quest outcomes are MONOTONIC: a resolved (or completed) quest
 * can never become locked/failed, a locked/failed quest can never start or
 * resolve, and one terminal kind never overwrites another.
 *
 * Quest lifecycle output is reconciled in a fixed priority (#145) before
 * anything player-facing is formatted. This priority governs what the
 * RESULT may claim — it is NOT a pipeline of execution phases: effects
 * still run in authored order against the draft, and the single
 * active→turnIn authority (#119) still flips a quest the moment a causal
 * effect completes it (a later turnInQuest in the same bundle depends on
 * seeing that projected readiness). The reconciliation guarantees:
 * availability promotion is silent; explicit exclusion (lock/fail) beats
 * readiness — it cancels an already-STARTED quest with exactly one
 * canonical notice, closes an unaccepted quest silently, and clears stale
 * progress; readiness is announced only for quests still turnIn in the
 * final draft. Helpers report readiness as structured ids, never
 * sentences, so "ready to turn in" is a final derived conclusion. A bundle
 * that starts/accepts AND locks/fails the same quest is contradictory
 * content and refuses atomically (in either order); starting route A while
 * locking a DIFFERENT route B stays valid.
 *
 * Story effects never bypass the physical-contact authority (#63/#64):
 * startQuest/acceptQuest/turnInQuest only ever act on a quest whose
 * configured contact is the acting dialogue's on-site NPC. Every quest
 * start shares ONE objective-reconciliation policy (#129): beginQuest in
 * engine/quests.ts, the same core acceptQuest uses.
 */

import type { PlayerState, QuestStatus } from './types.ts';
import type { StoryEffect } from '../content/types.ts';
import { npcInZone, quest as questDef } from '../content/quests.ts';
import { dialogue as dialogueDef } from '../content/dialogues.ts';
import { item as itemDef } from '../content/items.ts';
import { zone as zoneDef } from '../content/zones.ts';
import { removeItem } from './inventory.ts';
import {
  acceptQuest,
  beginQuest,
  grantItem,
  questCancelledLine,
  questExcluded,
  questReadyLine,
  refreshQuestProgress,
  syncAvailability,
  turnInQuest,
} from './quests.ts';
import { onStoryEvent } from './quests.ts';
import { evalCondition } from './conditions.ts';
import { JOURNEY_BLOCK } from './routes.ts';

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
  /** Explicit application identity for the replay receipt (#129). When
   * omitted, the line-entry identity `line:<dialogueId>:<nodeId>` is used. */
  applicationId?: string;
}

export interface StoryResult {
  /** Player-facing lines (grants, unlocks) — renderers append them. */
  lines: string[];
  /** Quests turn-in-ready in the FINAL committed draft (#119, reconciled
   * #137): deduplicated, and a readiness a later effect in the same bundle
   * revoked (lock/fail/resolve/turn-in) never appears here — announce once. */
  readyQuests: string[];
  /** Transition log of the quests this bundle started (#137) — NOT a
   * final-state summary: a later effect in the same bundle may have locked,
   * failed, resolved or turned in a listed quest. Read `p.quests` for the
   * committed status. */
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

type BundleRun = { ok: true; result: StoryResult } | { ok: false; refusal: string };

/** Runtime-only context owned by one draft run (#180). Helpers cannot
 * commit or choose their own source, and all results reconcile together. */
interface QuestBundle {
  draft: PlayerState;
  ctx: StoryContext;
  result: StoryResult;
  entryStatus: ReadonlyMap<string, QuestStatus>;
  startedInBundle: Set<string>;
  cancelled: { id: string; kind: 'locked' | 'failed' }[];
}

function startStoryQuest(
  bundle: QuestBundle,
  e: Extract<StoryEffect, { kind: 'startQuest' }>,
): string | undefined {
  const { draft, ctx, result, startedInBundle } = bundle;
  const q = questDef(e.questId);
  if (!q) return `Unknown quest ${e.questId}.`;
  const st = draft.quests[e.questId]?.status;
  if (st === 'active' || st === 'turnIn' || st === 'done') return undefined; // idempotent
  // Authority: the acting dialogue's NPC must be the configured
  // starter, on-site (#63/#64) — no dialogue may puppet quests from
  // strangers.
  if (q.startNpc !== ctx.npcId || !npcInZone(draft.currentZone, ctx.npcId)) {
    return `${q.name} can only be started by its own contact, on-site.`;
  }
  if (questExcluded(draft, e.questId)) {
    return `${q.name} is no longer reachable.`;
  }
  // Earlier effects in THIS bundle (flags, unlocks) may have opened
  // availability — refresh the projection before judging.
  syncAvailability(draft);
  if (draft.quests[e.questId]?.status !== 'available') {
    return `${q.name} is not available right now.`;
  }
  // The shared start policy (#129): identical objective
  // reconciliation to acceptQuest (ever-visited reach targets count).
  result.readyQuests.push(...beginQuest(draft, e.questId));
  result.startedQuests.push(e.questId);
  startedInBundle.add(e.questId);
  return undefined;
}

function resolveStoryQuest(
  bundle: QuestBundle,
  e: Extract<StoryEffect, { kind: 'resolveQuest' }>,
): string | undefined {
  const { draft, ctx } = bundle;
  const q = questDef(e.questId);
  if (!q) return `Unknown quest ${e.questId}.`;
  // Declared named outcomes (#132, #146): a named resolution is legal
  // ONLY when the target quest declares that exact outcome. A quest
  // with no declaration refuses EVERY named resolution, and a value
  // outside the declaration — including one declared by a DIFFERENT
  // quest — fails loudly instead of persisting a terminal record no
  // authored condition could recognize.
  if (!q.outcomes?.includes(e.outcome)) {
    return `${q.name} does not declare outcome "${e.outcome}".`;
  }
  const prior = draft.questOutcomes[e.questId];
  if (prior?.kind === 'resolved') {
    if (prior.outcome !== e.outcome) {
      return `${q.name} already resolved as ${prior.outcome}.`;
    }
    return undefined; // idempotent
  }
  // Monotonic terminals (#129): a locked/failed quest never resolves.
  if (prior) return `${q.name} already has a permanent resolution.`;
  const qp = draft.quests[e.questId];
  if (qp?.status === 'done') return undefined; // completed via turn-in — nothing to resolve
  if (qp?.status !== 'active' && qp?.status !== 'turnIn') {
    return `${e.questId} cannot be resolved from status ${qp?.status ?? 'unavailable'}.`;
  }
  qp.status = 'done';
  draft.questOutcomes[e.questId] = {
    kind: 'resolved',
    outcome: e.outcome,
    at: ctx.now,
  };
  return undefined;
}

function excludeStoryQuest(
  bundle: QuestBundle,
  e: Extract<StoryEffect, { kind: 'failQuest' | 'lockQuest' }>,
): string | undefined {
  const { draft, ctx, startedInBundle, entryStatus, cancelled } = bundle;
  const q = questDef(e.questId);
  if (!q) return `Unknown quest ${e.questId}.`;
  const kind = e.kind === 'failQuest' ? 'failed' : 'locked';
  // Contradictory content (#145): a bundle may not start/accept a
  // quest and lock/fail that SAME quest in one application — that is
  // not a "start then cancel" workflow, it is an authoring error.
  if (startedInBundle.has(e.questId)) {
    return `${q.name} cannot be started and ${kind} in the same bundle.`;
  }
  const prior = draft.questOutcomes[e.questId];
  if (prior?.kind === kind) return undefined; // idempotent
  // Monotonic terminals (#129): a resolved quest never becomes
  // locked/failed, and one terminal kind never overwrites another.
  if (prior) return `${q.name} already has a permanent resolution.`;
  const qp = draft.quests[e.questId];
  if (qp?.status === 'done') return `${q.name} is already completed.`;
  // Cancellation vs silent close (#145): only a quest that was
  // already STARTED when the transaction began earns a notice; an
  // unaccepted quest simply closes. Stale progress is cleared either
  // way — the permanent outcome below bars resurrection.
  const entry = entryStatus.get(e.questId);
  if (entry === 'active' || entry === 'turnIn') cancelled.push({ id: e.questId, kind });
  if (qp) {
    qp.status = 'unavailable';
    qp.counts = qp.counts.map(() => 0);
  }
  draft.questOutcomes[e.questId] = {
    kind,
    reason: e.reason,
    by: ctx.dialogueId,
    at: ctx.now,
  };
  return undefined;
}

function acceptStoryQuest(
  bundle: QuestBundle,
  e: Extract<StoryEffect, { kind: 'acceptQuest' }>,
): string | undefined {
  const { draft, ctx, result, startedInBundle } = bundle;
  const q = questDef(e.questId);
  if (!q) return `Unknown quest ${e.questId}.`;
  const st = draft.quests[e.questId]?.status;
  if (st === 'active' || st === 'turnIn' || st === 'done') return undefined; // idempotent
  // Central authority (#63/#64): acceptance runs through
  // acceptQuest, which revalidates the configured STARTER on-site.
  if (q.startNpc !== ctx.npcId || !npcInZone(draft.currentZone, ctx.npcId)) {
    return `${q.name} can only be accepted from ${q.startNpc}, on-site.`;
  }
  if (questExcluded(draft, e.questId)) return `${q.name} is no longer reachable.`;
  // Earlier bundle effects may have opened availability (#129).
  syncAvailability(draft);
  // Central authority (#63/#64/#119): acceptance lines flow back as
  // result lines; immediate readiness stays STRUCTURED (#145) and is
  // announced only from the reconciled final state.
  const res = acceptQuest(draft, e.questId, ctx.npcId);
  if (!res.ok) return res.msg;
  result.lines.push(...res.lines);
  result.readyQuests.push(...res.ready);
  result.startedQuests.push(e.questId);
  startedInBundle.add(e.questId);
  return undefined;
}

function turnInStoryQuest(
  bundle: QuestBundle,
  e: Extract<StoryEffect, { kind: 'turnInQuest' }>,
): string | undefined {
  const { draft, ctx, result } = bundle;
  const q = questDef(e.questId);
  if (!q) return `Unknown quest ${e.questId}.`;
  if (draft.quests[e.questId]?.status === 'done') return undefined; // idempotent
  // Central authority (#63/#64): the turn-in runs through
  // turnInQuest, which revalidates the configured FINISHER on-site
  // and the aggregated collect goods (all-or-nothing).
  if (q.finishNpc !== ctx.npcId || !npcInZone(draft.currentZone, ctx.npcId)) {
    return `${q.name} can only be handed to ${q.finishNpc}, on-site.`;
  }
  const res = turnInQuest(draft, e.questId, ctx.npcId);
  if (!res.ok) return res.lines[0] ?? 'That quest is not ready to turn in.';
  result.lines.push(...res.lines);
  // Rewards can ready OTHER quests (#119): structured ids (#145),
  // reconciled against the final draft below.
  result.readyQuests.push(...res.ready);
  return undefined;
}

/** The ONE ordered resolution of a story bundle (#129): applies effects to
 * the DRAFT in authored order; every precondition reads the draft, so each
 * effect is evaluated against the projected result of all earlier effects.
 * The first refusal aborts the run and the caller discards the draft — the
 * live player is never touched. This single routine backs both
 * validateStoryBundle (throwaway draft) and applyStoryEffects (committed
 * draft), so validation and application cannot disagree.
 *
 * Quest lifecycle output stays STRUCTURED until the final reconciliation
 * (#145): helpers report readiness as ids, a bundle that starts and
 * locks/fails the SAME quest refuses atomically as contradictory content,
 * and an explicit lock/fail of an already-STARTED quest (active or
 * turn-in-ready when the transaction began) records one canonical
 * cancellation — formatted only after reconciliation, never mid-run. */
function runStoryBundle(
  draft: PlayerState,
  effects: readonly StoryEffect[],
  ctx: StoryContext,
): BundleRun {
  const result = emptyResult();
  const refuse = (refusal: string): BundleRun => ({ ok: false, refusal });
  // Entry snapshot (#145): the draft clones the pre-transaction state, so
  // this captures which quests were already STARTED (active/turnIn) when
  // the transaction began — only those earn a cancellation notice.
  const entryStatus = new Map(
    Object.entries(draft.quests).map(([id, qp]) => [id, qp.status]),
  );
  // Quests this run itself started: locking/failing one of them later in
  // the SAME bundle is contradictory content (#145), not a cancel workflow.
  const startedInBundle = new Set<string>();
  const cancelled: { id: string; kind: 'locked' | 'failed' }[] = [];
  const questBundle: QuestBundle = { draft, ctx, result, entryStatus, startedInBundle, cancelled };
  for (const e of effects) {
    switch (e.kind) {
      case 'setFlag':
        draft.flags[e.id] = e.value ?? true;
        break;
      case 'clearFlag':
        delete draft.flags[e.id];
        break;
      case 'recordDecision': {
        const prior = draft.decisions[e.id];
        if (prior) {
          // The ledger never rewrites: the same choice is an idempotent
          // skip, a different one is a contradiction.
          if (prior.choiceId !== e.choiceId) {
            return refuse(`Decision ${e.id} was already made differently.`);
          }
          break;
        }
        draft.decisions[e.id] = {
          choiceId: e.choiceId,
          dialogueId: ctx.dialogueId,
          nodeId: ctx.nodeId,
          chosenAt: ctx.now,
        };
        result.decisions.push(e.id);
        break;
      }
      case 'storyEvent': {
        if (draft.storyEvents.includes(e.event)) break; // deduped
        draft.storyEvents.push(e.event);
        result.events.push(e.event);
        // The quest hook (#127): the emitted event advances every matching
        // active storyEvent objective through the SAME transition
        // authority (#119).
        result.readyQuests.push(...onStoryEvent(draft, e.event));
        break;
      }
      case 'startQuest': {
        const refusal = startStoryQuest(questBundle, e);
        if (refusal !== undefined) return refuse(refusal);
        break;
      }
      case 'resolveQuest': {
        const refusal = resolveStoryQuest(questBundle, e);
        if (refusal !== undefined) return refuse(refusal);
        break;
      }
      case 'failQuest':
      case 'lockQuest': {
        const refusal = excludeStoryQuest(questBundle, e);
        if (refusal !== undefined) return refuse(refusal);
        break;
      }
      case 'unlockZone': {
        const z = zoneDef(e.zoneId);
        if (!z) return refuse(`Unknown zone ${e.zoneId}.`);
        if (!draft.unlockedZones.includes(e.zoneId)) {
          draft.unlockedZones.push(e.zoneId);
          result.lines.push(`🗺️ New area unlocked: ${z.name}`);
        }
        break;
      }
      case 'grantItem': {
        const def = itemDef(e.itemId);
        if (!def) return refuse(`Unknown item ${e.itemId}.`);
        result.readyQuests.push(...grantItem(draft, e.itemId, e.qty ?? 1));
        result.lines.push(`🎁 Received: ${def.name}`);
        break;
      }
      case 'removeItem': {
        if (!itemDef(e.itemId)) return refuse(`Unknown item ${e.itemId}.`);
        // A removal the projected bag cannot cover REFUSES the bundle —
        // the helper's failure is never silently ignored (#129).
        if (!removeItem(draft, e.itemId, e.qty ?? 1)) {
          return refuse(`Not enough ${e.itemId} to remove.`);
        }
        break;
      }
      case 'acceptQuest': {
        const refusal = acceptStoryQuest(questBundle, e);
        if (refusal !== undefined) return refuse(refusal);
        break;
      }
      case 'turnInQuest': {
        const refusal = turnInStoryQuest(questBundle, e);
        if (refusal !== undefined) return refuse(refusal);
        break;
      }
    }
  }
  // Availability may have shifted (flags/levels are unchanged here, but a
  // locked quest must drop out of 'available' at once) and collect
  // objectives may have completed from granted items. Readiness refresh runs
  // BEFORE promotion on purpose: syncAvailability internally refreshes
  // progress and would silently swallow the active→turnIn flip report.
  result.readyQuests.push(...refreshQuestProgress(draft));
  syncAvailability(draft);
  // The result describes the FINAL draft, not the run's intermediate
  // states (#137): readiness an earlier effect announced may have been
  // revoked by a later one (lock/fail/resolve/turn-in), so each quest is
  // kept once and only while it ends the bundle actually turn-in-ready.
  result.readyQuests = [...new Set(result.readyQuests)].filter(
    (id) => draft.quests[id]?.status === 'turnIn',
  );
  // Cancellation notices are formatted only now, from the reconciled
  // result (#145): one canonical line per already-started quest an explicit
  // lock/fail closed off; unaccepted quests closed silently above.
  result.lines.push(...cancelled.map((c) => questCancelledLine(c.id, c.kind)));
  return { ok: true, result };
}

/** The stable application identity (#129): an explicit applicationId when
 * the caller has one (dialogue choices), else the line-entry identity —
 * dialogue + node. */
function receiptKey(ctx: StoryContext): string {
  return ctx.applicationId ?? `line:${ctx.dialogueId}:${ctx.nodeId}`;
}

/** The ONLY commit point of the story transaction (#129): a fully applied
 * draft replaces the live player's state and the one-shot receipt is
 * recorded, so a replay of the same application is a complete no-op. */
function commitApplication(p: PlayerState, draft: PlayerState, receipt: string): void {
  Object.assign(p, draft);
  p.storyReceipts.push(receipt);
}

/** Pre-flights a bundle WITHOUT mutating: the same ordered application run
 * against a throwaway draft, so every effect's precondition is evaluated
 * against the projected result of all earlier effects. Returns undefined
 * when the whole bundle would apply cleanly, else a refusal message.
 * Static reference/contradiction validation is content-integrity's job;
 * this is the runtime half that makes bundles all-or-nothing.
 *
 * Replay parity with applyStoryEffects (#137): an application whose
 * receipt is already recorded is a valid no-op here too — preflight can
 * never reject a retry that application would accept as already done. */
export function validateStoryBundle(
  p: PlayerState,
  effects: readonly StoryEffect[],
  ctx: StoryContext,
): string | undefined {
  // A live crossing owns the interaction flow (#166): no story bundle —
  // not even a replay no-op — applies on the road. Preflight and
  // application stay in lockstep (#137).
  if (p.journey) return JOURNEY_BLOCK;
  if (p.storyReceipts.includes(receiptKey(ctx))) return undefined; // replay: no-op
  const run = runStoryBundle(structuredClone(p), effects, ctx);
  return run.ok ? undefined : run.refusal;
}

/** Applies a bundle atomically (#129): runs it against a draft of the
 * player, and only when every effect succeeds commits the draft once and
 * records the application receipt. Any refusal throws and leaves the live
 * player byte-for-byte unchanged (no receipt is recorded, so a corrected
 * retry may still apply). Replaying an already-committed application —
 * same receipt — is a complete no-op with an empty result. */
export function applyStoryEffects(
  p: PlayerState,
  effects: readonly StoryEffect[],
  ctx: StoryContext,
): StoryResult {
  // A live crossing owns the interaction flow (#166): no story bundle —
  // not even a replay no-op — applies on the road. The refusal throws,
  // leaving the live player byte-for-byte unchanged (the contract below).
  if (p.journey) throw new Error(`story bundle refused: ${JOURNEY_BLOCK}`);
  const receipt = receiptKey(ctx);
  if (p.storyReceipts.includes(receipt)) return emptyResult(); // replay: no-op
  const draft = structuredClone(p);
  const run = runStoryBundle(draft, effects, ctx);
  if (!run.ok) throw new Error(`story bundle refused: ${run.refusal}`);
  commitApplication(p, draft, receipt);
  return run.result;
}

/** Formats the result for the notice banner (ready lines once, #119). */
export function storyNoticeLines(result: StoryResult): string[] {
  return [
    ...result.lines,
    ...result.readyQuests.map(questReadyLine),
  ];
}

// ── Branching choices (#126, authority hardened #130) ────────────────────

/** What a caller may assert. NOTHING else is accepted: the dialogue, node
 * and acting NPC are derived from the player's live scene and the dialogue
 * definition — never trusted from the caller (#130). The wire callbacks
 * (`dlg:ch:`/`dlg:cf:`) already carry only the choice id. */
export interface ChoiceApplyArgs {
  choiceId: string;
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
 * (#126, authority hardened #130). The context is derived from the PLAYER'S
 * LIVE SCENE, not from caller assertions:
 *
 * - the scene must be the dialogue view, and the dialogue id and current
 *   node id come from `p.scene` — a caller cannot nominate another
 *   conversation or node;
 * - the acting NPC is resolved from the dialogue DEFINITION
 *   (`dialogue.npcId`) and must be physically present in the player's
 *   current zone — a forged caller-supplied NPC cannot provide authority;
 * - the choice must be reachable from that current choice node;
 * - availability (`when`) is re-evaluated at application time — rendering
 *   was never authority;
 * - an `irreversible: true` choice mutates only from its exact staged
 *   panel (`scene.arg3 === 'confirm:<choiceId>'`); an ordinary choice
 *   refuses while any confirmation is staged.
 *
 * Application then re-checks the decision ledger (a recorded decision can
 * never be overwritten) and applies the declarative effects as one atomic
 * transaction (#129). A committed choice records a one-shot receipt, so
 * replaying the same choice application is a complete no-op that still
 * routes to the authored next beat — it can never double-grant, re-lock or
 * overwrite a recorded decision.
 *
 * What is deliberately NOT here: callback revision / message staleness.
 * That is TRANSPORT-level authority, enforced by the locked per-player
 * router (handlers/callbacks.ts, #16/#43) before any handler runs; this
 * operation owns the STORY-level authority. */
export function applyDialogueChoice(
  p: PlayerState,
  args: ChoiceApplyArgs,
): ChoiceApplyResult {
  const movedOn = { ok: false as const, refusal: 'That conversation has moved on.', lines: [] };
  // A live crossing owns the interaction flow (#166): no conversation can
  // be advanced on the road — the central story op refuses before any
  // scene, ownership or availability check.
  if (p.journey) return { ok: false, refusal: JOURNEY_BLOCK, lines: [] };
  // Scene authority: the player must be inside a dialogue, at a choice
  // node — the dialogue and node ids are read from the live scene itself.
  if (p.scene.view !== 'dialogue' || !p.scene.arg || !p.scene.arg2) return movedOn;
  const d = dialogueDef(p.scene.arg);
  const node = d?.nodes.find((n) => n.id === p.scene.arg2);
  if (!d || !node || node.kind !== 'choice') return movedOn;
  // Ownership + presence: the acting NPC is whoever owns this dialogue,
  // and they must be standing in the player's current zone.
  if (!npcInZone(p.currentZone, d.npcId)) {
    return { ok: false, refusal: 'Nobody there.', lines: [] };
  }
  const choice = node.choices.find((c) => c.id === args.choiceId);
  if (!choice) return { ok: false, refusal: 'That response is not on the table.', lines: [] };
  const ctx: StoryContext = {
    dialogueId: d.id,
    nodeId: node.id,
    npcId: d.npcId,
    now: args.now,
    applicationId: `choice:${d.id}:${node.id}:${choice.id}`,
  };
  // Replay of an already-committed application (#129): a complete no-op —
  // no notices, no mutation — that still routes to the authored next beat.
  if (p.storyReceipts.includes(ctx.applicationId!)) {
    return { ok: true, nextNodeId: choice.next, lines: [] };
  }
  // Confirmation authority (#126): an irreversible choice mutates only from
  // its exact staged panel; a direct call from the choice list refuses.
  if (choice.irreversible) {
    if (p.scene.arg3 !== `confirm:${choice.id}`) {
      return {
        ok: false,
        refusal: 'Confirm the choice on its confirmation screen.',
        lines: [],
      };
    }
  } else if (p.scene.arg3?.startsWith('confirm:')) {
    // An ordinary choice cannot apply while an unrelated confirmation is
    // staged — the staged panel is the live sub-state, not the list.
    return movedOn;
  }
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
  const draft = structuredClone(p);
  const run = runStoryBundle(draft, choice.effects ?? [], ctx);
  if (!run.ok) return { ok: false, refusal: run.refusal, lines: [] };
  commitApplication(p, draft, ctx.applicationId!);
  return {
    ok: true,
    nextNodeId: choice.next,
    lines: storyNoticeLines(run.result),
    decided: run.result.decisions[0],
  };
}
