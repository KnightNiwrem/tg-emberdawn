/**
 * Quest state machine: availability, acceptance, objective progress,
 * completion and turn-in. Status transitions:
 *   unavailable → available → active → turnIn → done
 */

import { DUNGEON_BLOCK } from './dungeon_run.ts';
import type { PlayerState, QuestProgress } from './types.ts';
import type { Objective, QuestDef } from '../content/types.ts';
import { quest, QUESTS } from '../content/quests.ts';
import { addItem, countOf, removeItem } from './inventory.ts';
import { item, itemName } from '../content/items.ts';
import { enemyName } from '../content/enemies.ts';
import { zone as zoneDef, ZONES } from '../content/zones.ts';
import { grantXp, xpRewardLabel } from './character.ts';
import { npc, npcInZone } from '../content/quests.ts';
import { evalCondition } from './conditions.ts';
import { JOURNEY_BLOCK } from './routes.ts';

function progress(player: PlayerState, id: string): QuestProgress {
  let questProgress = player.quests[id];
  if (!questProgress) {
    questProgress = { status: 'unavailable', counts: [] };
    player.quests[id] = questProgress;
  }
  return questProgress;
}

/** Story eligibility shared by availability and level-locked guidance.
 * Level stays separate so the journal can explain an unmet level gate. */
function storyEligible(player: PlayerState, questDef: QuestDef): boolean {
  return !questExcluded(player, questDef.id) &&
    (!questDef.prereq || evalCondition(player, questDef.prereq));
}

/** Permanent quest resolutions (#125): a locked or failed quest can never
 * become available again — availability synchronization may not resurrect
 * it, whatever its ordinary prerequisites say. */
export function questExcluded(player: PlayerState, questId: string): boolean {
  const kind = player.questOutcomes[questId]?.kind;
  return kind === 'locked' || kind === 'failed';
}

/** Recomputes availability for every quest; returns ids newly available. */
export function syncAvailability(player: PlayerState): string[] {
  const newly: string[] = [];
  for (const questDef of QUESTS) {
    const cur = player.quests[questDef.id]?.status;
    if (
      (cur === undefined || cur === 'unavailable') && storyEligible(player, questDef) &&
      player.level >= questDef.level
    ) {
      progress(player, questDef.id).status = 'available';
      newly.push(questDef.id);
    }
  }
  // Pre-owned collectibles can complete a quest the moment it becomes
  // available; without this it sits unready until the next event hook.
  refreshProgress(player);
  return newly;
}

/** The next main quest the STORY has unlocked but the LEVEL still gates
 * (#33): story conditions pass, player level short. The quest
 * log names it during grind gaps — without an accept path. undefined while
 * the story itself still gates the next quest (never reveal it early) and
 * when the campaign is complete. */
export function levelLockedMain(player: PlayerState): QuestDef | undefined {
  for (const questDef of QUESTS) {
    if (!questDef.main) continue;
    if ((player.quests[questDef.id]?.status ?? 'unavailable') === 'done') continue;
    if (!storyEligible(player, questDef)) return undefined;
    return player.level >= questDef.level ? undefined : questDef;
  }
  return undefined;
}

/** Physical contact authority (#64): the acting NPC must be the quest's
 * configured contact AND physically stand in the player's current zone.
 * Quest status alone is never authorization — this gate runs inside the
 * engine, so no handler path (log, talk, or future UI) can skip it. */
function contactRefusal(
  currentZone: string,
  npcId: string,
  contactId: string,
): string | undefined {
  if (npcId === contactId && npcInZone(currentZone, contactId)) return undefined;
  return `Speak to ${npc(contactId)?.name ?? contactId} to do that.`;
}

/** The ONE quest-start policy (#129): flip to active with fresh counters
 * plus objective reconciliation — collect objectives read the bag live (a
 * player may already own the goods), reach objectives credit the target
 * when the player stands in it or EVER visited it (the `zone_` flag
 * onZoneEnter plants, #23), and storyEvent objectives credit an event that
 * already fired (#132): story events are the durable one-shot record
 * (#125), so a route quest started by the same choice that emitted its
 * parent event opens with that objective honestly complete. Shared by
 * direct acceptance (acceptQuest) and the story-effect start path so every
 * quest start reconciles identically. Returns the quests the start itself
 * just made turn-in-ready (#119). */
export function beginQuest(player: PlayerState, id: string): string[] {
  const questDef = quest(id);
  const questProgress = progress(player, id);
  questProgress.status = 'active';
  questProgress.counts = questDef?.objectives.map(() => 0) ?? [];
  for (const [index, objective] of (questDef?.objectives ?? []).entries()) {
    if (
      objective.kind === 'reach' &&
      (player.currentZone === objective.target || player.flags[`zone_${objective.target}`])
    ) {
      questProgress.counts[index] = 1;
    }
    if (objective.kind === 'storyEvent' && player.storyEvents.includes(objective.target)) {
      questProgress.counts[index] = 1;
    }
  }
  // The start itself can complete the quest (#119): pre-owned goods, an
  // already-visited reach target or an already-fired story event flip it
  // ready on the spot.
  return refreshProgress(player);
}

export function acceptQuest(
  player: PlayerState,
  id: string,
  npcId: string,
): { ok: boolean; msg: string; lines: string[]; ready: string[] } {
  const questDef = quest(id);
  if (!questDef) return { ok: false, msg: 'Unknown quest.', lines: ['Unknown quest.'], ready: [] };
  // A live crossing owns the interaction flow (#166): quest business is a
  // zone-bound interaction — no contact can be made on the road.
  if (player.journey || player.dungeonRun) {
    const msg = player.dungeonRun ? DUNGEON_BLOCK : JOURNEY_BLOCK;
    return { ok: false, msg, lines: [msg], ready: [] };
  }
  // Authority before status (#64): a wrong-NPC or wrong-zone attempt is
  // refused with guidance and never touches quest state.
  const refusal = contactRefusal(player.currentZone, npcId, questDef.startNpc);
  if (refusal) return { ok: false, msg: refusal, lines: [refusal], ready: [] };
  const questProgress = progress(player, id);
  if (questProgress.status !== 'available') {
    const msg = "That quest isn't available right now.";
    return { ok: false, msg, lines: [msg], ready: [] };
  }
  // Acceptance itself can complete the quest (#119): pre-owned goods or an
  // already-visited reach target. Readiness stays STRUCTURED (#145) — ids,
  // never formatted sentences: inside a story transaction a later effect
  // may still revoke it, and only the reconciled final state is announced.
  const ready = beginQuest(player, id);
  const msg = `📜 Quest accepted: ${questDef.name}`;
  return { ok: true, msg, lines: [msg], ready };
}

/** Live progress of one objective (collect objectives read the bag). */
function objectiveProgress(
  player: PlayerState,
  questProgress: QuestProgress,
  obj: Objective,
  index: number,
): number {
  if (obj.kind === 'collect') return Math.min(obj.count ?? 1, countOf(player, obj.target));
  if (
    obj.kind === 'kill' || obj.kind === 'dungeon' || obj.kind === 'storyEvent' ||
    obj.kind === 'reach'
  ) {
    return Math.min(obj.count ?? 1, questProgress.counts[index] ?? 0);
  }
  return 0;
}

function questComplete(player: PlayerState, id: string): boolean {
  const questDef = quest(id);
  const questProgress = player.quests[id];
  if (!questDef || !questProgress || questProgress.status !== 'active') return false;
  return questDef.objectives.every((obj, idx) =>
    objectiveProgress(player, questProgress, obj, idx) >= (obj.count ?? 1)
  );
}

/** Call after any kill/reach/event; flips completed active quests to turnIn. */
/** Recomputes live progress; returns quests that just became turn-in-ready.
 * The single active→turnIn transition authority (#119): a quest appears in
 * the result exactly once — the flip that readied it — and never again.
 * Exported for the story-effect layer (#125), which must reuse the SAME
 * transition authority instead of reimplementing readiness. */
export function refreshQuestProgress(player: PlayerState): string[] {
  return refreshProgress(player);
}

function refreshProgress(player: PlayerState): string[] {
  const ready: string[] = [];
  for (const [id, questProgress] of Object.entries(player.quests)) {
    if (questProgress.status === 'active' && questComplete(player, id)) {
      questProgress.status = 'turnIn';
      ready.push(id);
    }
  }
  return ready;
}

/** The ONE "ready to turn in" announcement (#119): every surface that flips
 * a quest to turnIn (drops, kills, travel, talk, caches, rewards, accept)
 * reports it through this line, so name lookup and wording cannot drift. */
export function questReadyLine(id: string): string {
  return `📜 “${quest(id)?.name ?? id}” is ready to turn in!`;
}

/** The ONE cancellation announcement (#145): a quest that was already
 * STARTED (active or turn-in-ready when the transaction began) and that an
 * explicit lock/fail then closed off is reported through this single
 * formatter, so the wording cannot drift across callers. An unaccepted
 * quest closes silently — it was never the player's to cancel. */
export function questCancelledLine(id: string, kind: 'locked' | 'failed'): string {
  const name = quest(id)?.name ?? id;
  return kind === 'failed'
    ? `📜 “${name}” can no longer be completed — that chance has slipped away.`
    : `📜 “${name}” is no longer within reach — that road has closed.`;
}

/** Item-acquisition hook for paths outside battle (shops, treasure):
 * collect objectives read the bag, so a purchase or cache can complete a
 * quest on the spot. Returns newly turn-in-ready quest ids. */
export function onItemGain(player: PlayerState): string[] {
  return refreshProgress(player);
}

/** The ONE way to hand out items outside battle: grants, then refreshes
 * collect-objective readiness. Every gain site routes through here so no
 * source has to remember the quest hook. */
export function grantItem(player: PlayerState, itemId: string, qty = 1): string[] {
  addItem(player, itemId, qty);
  return onItemGain(player);
}

/** Whether a rolled enemy drop may enter the bag. Quest-kind items only
 * drop while an OPEN quest (available/active/turnIn) still needs them and
 * the bag holds fewer than the requirement — surplus keys/samples/emblems
 * can never pile up as permanent unsellable clutter (#2). Materials and
 * consumables are never capped. */
export function questDropAllowed(player: PlayerState, itemId: string): boolean {
  if (item(itemId)?.kind !== 'quest') return true;
  let cap = 0;
  for (const questDef of QUESTS) {
    const status = player.quests[questDef.id]?.status;
    if (status !== 'available' && status !== 'active' && status !== 'turnIn') continue;
    for (const obj of questDef.objectives) {
      if (obj.kind === 'collect' && obj.target === itemId) {
        cap = Math.max(cap, obj.count ?? 1);
      }
    }
  }
  return countOf(player, itemId) < cap;
}

/** Dungeon-objective hook: called when a dungeon's boss falls for the first
 * time. Location-specific story objectives key on THIS, never on enemy ids —
 * an overworld echo of a boss must not substitute for the real fight.
 * Returns the quests this clear just made turn-in-ready (#119). */
export function onDungeonClear(player: PlayerState, dungeonId: string): string[] {
  return progressObjective(player, 'dungeon', dungeonId);
}

function objectiveLine(
  player: PlayerState,
  questDef: QuestDef,
  questProgress: QuestProgress,
  index: number,
): string {
  const obj = questDef.objectives[index]!;
  const need = obj.count ?? 1;
  const have = objectiveProgress(player, questProgress, obj, index);
  let label: string;
  switch (obj.kind) {
    case 'kill':
      label = `Defeat ${enemyName(obj.target)}`;
      break;
    case 'collect':
      label = `Collect ${itemName(obj.target)}`;
      break;
    case 'reach':
      label = `Travel to ${zoneDef(obj.target)?.name ?? obj.target}`;
      break;
    case 'storyEvent':
      label = obj.label ?? `Follow the story: ${obj.target}`;
      break;
    case 'dungeon':
      label = `Clear ${
        ZONES.find((z) => z.dungeon?.id === obj.target)?.dungeon?.name ?? obj.target
      }`;
      break;
  }
  return need > 1 ? `${label} — ${have}/${need}` : `${label}${have >= 1 ? ' ✓' : ''}`;
}

/** The quest-status line for one objective (#127): storyEvent objectives
 * carry their authored display label. */

export function questStatusLine(player: PlayerState, id: string): string {
  const questDef = quest(id);
  const questProgress = player.quests[id];
  if (!questDef) return '';
  if (
    !questProgress || questProgress.status === 'unavailable' || questProgress.status === 'available'
  ) {
    return questProgress?.status === 'available' ? '🟢 Available' : '🔒 Locked';
  }
  if (questProgress.status === 'done') return '✅ Completed';
  if (questProgress.status === 'turnIn') return '🏁 Ready to turn in';
  return questDef.objectives.map((_, index) =>
    objectiveLine(player, questDef, questProgress, index)
  ).join('\n');
}

export interface TurnInResult {
  ok: boolean;
  lines: string[];
  /** Quests the turn-in's rewards just made turn-in-ready (#119) —
   * STRUCTURED ids, never formatted sentences (#145): inside a story
   * transaction a later effect may still revoke readiness, and only the
   * reconciled final state is announced. */
  ready: string[];
}

/** One rule for both the counter's validation and consumption (#180). */
export function collectRequirements(questDef: QuestDef): Map<string, number> {
  const required = new Map<string, number>();
  for (const obj of questDef.objectives) {
    if (obj.kind !== 'collect') continue;
    required.set(obj.target, (required.get(obj.target) ?? 0) + (obj.count ?? 1));
  }
  return required;
}

/** The aggregated collect-goods check behind turnInQuest (#127): returns
 * the shortfall line, or undefined when the turn-in could proceed. The
 * story layer reaches it through the central turnInQuest authority, which
 * runs it again on the transaction draft (#129). */
export function turnInGoodsShortfall(player: PlayerState, id: string): string | undefined {
  const questDef = quest(id);
  if (!questDef) return "That quest isn't ready to turn in.";
  const required = collectRequirements(questDef);
  for (const [itemId, need] of required) {
    if (countOf(player, itemId) < need) {
      return `You no longer have enough ${itemName(itemId)} — the quest stays open.`;
    }
  }
  return undefined;
}

/** Turns a ready quest in: grants rewards, sets flags, unlocks zones.
 * Physical authority (#64): only the quest's configured FINISHER, on-site
 * in the player's current zone, can accept the handover — a conversation
 * event is not completion metadata, and the Quest Log can never grant
 * rewards. (#127: the outro is no longer echoed here — authored turn-in
 * dialogues present the completion beats themselves.) */
export function turnInQuest(player: PlayerState, id: string, npcId: string): TurnInResult {
  const questDef = quest(id);
  if (!questDef) return { ok: false, lines: ["That quest isn't ready to turn in."], ready: [] };
  // A live crossing owns the interaction flow (#166): the handover waits
  // for arrival — no turn-in happens on the road.
  if (player.dungeonRun) return { ok: false, lines: [DUNGEON_BLOCK], ready: [] };
  if (player.journey) return { ok: false, lines: [JOURNEY_BLOCK], ready: [] };
  const refusal = contactRefusal(player.currentZone, npcId, questDef.finishNpc);
  if (refusal) return { ok: false, lines: [refusal], ready: [] };
  const questProgress = player.quests[id];
  if (!questProgress || questProgress.status !== 'turnIn') {
    return { ok: false, lines: ["That quest isn't ready to turn in."], ready: [] };
  }
  // Revalidate at the counter: goods may have been spent, forged away or
  // dropped since the quest readied — the SHARED aggregated check (#8).
  const shortfall = turnInGoodsShortfall(player, id);
  if (shortfall) {
    questProgress.status = 'active';
    return { ok: false, lines: [shortfall], ready: [] };
  }
  const required = collectRequirements(questDef);
  questProgress.status = 'done';
  const lines: string[] = [];
  // Collect objectives hand their goods over — samples, sigils and keys
  // leave the bag at turn-in instead of lingering as dead weight.
  for (const [itemId, qty] of required) {
    removeItem(player, itemId, qty);
    lines.push(`📦 Handed over: ${itemName(itemId)} ×${qty}`);
  }
  const rewards = questDef.rewards;
  player.gold += rewards.gold;
  // Post-cap (#36): the reward line shows the conversion instead of
  // advertising XP the player cannot receive. Shared label (#42).
  lines.push(`💰 +${rewards.gold} gold · ${xpRewardLabel(player.level, rewards.xp)}`);
  lines.push(...grantXp(player, rewards.xp));
  for (const [itemId, qty] of Object.entries(rewards.items ?? {})) {
    addItem(player, itemId, qty);
    lines.push(`🎁 Received: ${itemName(itemId)}${qty > 1 ? ` ×${qty}` : ''}`);
  }
  // Reward items can complete OTHER active collect quests on the spot.
  // Readiness stays structured (#145): the caller announces it from the
  // reconciled final state, not from this intermediate flip.
  const ready = onItemGain(player);
  for (const flag of rewards.flags ?? []) player.flags[flag] = true;
  for (const zoneId of rewards.unlockZones ?? []) {
    if (!player.unlockedZones.includes(zoneId)) {
      player.unlockedZones.push(zoneId);
      lines.push(`🗺️ New area unlocked: ${zoneDef(zoneId)?.name ?? zoneId}`);
    }
  }
  return { ok: true, lines, ready };
}

/**
 * Progresses every active quest with an objective matching (kind, target).
 * +1 per event, capped at the objective's required count. Returns the quests
 * this event just made turn-in-ready (#119) so the active surface can
 * announce them — callers must not drop the result.
 */
function progressObjective(player: PlayerState, kind: Objective['kind'], target: string): string[] {
  for (const questDef of QUESTS) {
    const questProgress = player.quests[questDef.id];
    if (!questProgress || questProgress.status !== 'active') continue;
    questDef.objectives.forEach((obj, index) => {
      if (obj.kind === kind && obj.target === target) {
        questProgress.counts[index] = Math.min(
          obj.count ?? 1,
          (questProgress.counts[index] ?? 0) + 1,
        );
      }
    });
  }
  return refreshProgress(player);
}

/** Kill-objective hook: called for every enemy the player defeats. */
export function onKill(player: PlayerState, enemyId: string): string[] {
  return progressObjective(player, 'kill', enemyId);
}

/** Reach-objective hook: called on zone entry. */
export function onZoneEnter(player: PlayerState, zoneId: string): string[] {
  player.flags[`zone_${zoneId}`] = true;
  return progressObjective(player, 'reach', zoneId);
}

/** Story-event hook (#127): called when an authored dialogue reaches the
 * node (or choice) that emits the event. This is the ONE conversation
 * progression path — opening menus, selecting topics and generic NPC
 * contact never advance anything. Readiness flows back through the same
 * exactly-once transition authority (#119). */
export function onStoryEvent(player: PlayerState, event: string): string[] {
  return progressObjective(player, 'storyEvent', event);
}
