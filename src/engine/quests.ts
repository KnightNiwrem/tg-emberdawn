/**
 * Quest state machine: availability, acceptance, objective progress,
 * completion and turn-in. Status transitions:
 *   unavailable → available → active → turnIn → done
 */

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

function progress(p: PlayerState, id: string): QuestProgress {
  let q = p.quests[id];
  if (!q) {
    q = { status: 'unavailable', counts: [] };
    p.quests[id] = q;
  }
  return q;
}

function prereqsMet(p: PlayerState, q: QuestDef): boolean {
  if (q.prereqQuest && p.quests[q.prereqQuest]?.status !== 'done') return false;
  if (q.prereqFlags && !q.prereqFlags.some((f) => p.flags[f] !== undefined)) return false;
  // Declarative prereq condition (#125): the shared condition language,
  // evaluated when present. ANDed with the legacy fields above.
  if (q.prereq && !evalCondition(p, q.prereq)) return false;
  return p.level >= q.level;
}

/** Permanent quest resolutions (#125): a locked or failed quest can never
 * become available again — availability synchronization may not resurrect
 * it, whatever its ordinary prerequisites say. */
export function questExcluded(p: PlayerState, questId: string): boolean {
  const kind = p.questOutcomes[questId]?.kind;
  return kind === 'locked' || kind === 'failed';
}

/** Recomputes availability for every quest; returns ids newly available. */
export function syncAvailability(p: PlayerState): string[] {
  const newly: string[] = [];
  for (const q of QUESTS) {
    const cur = p.quests[q.id]?.status;
    if ((cur === undefined || cur === 'unavailable') && !questExcluded(p, q.id)) {
      if (prereqsMet(p, q)) {
        progress(p, q.id).status = 'available';
        newly.push(q.id);
      }
    }
  }
  // Pre-owned collectibles can complete a quest the moment it becomes
  // available; without this it sits unready until the next event hook.
  refreshProgress(p);
  return newly;
}

/** The next main quest the STORY has unlocked but the LEVEL still gates
 * (#33): prerequisite quest done / flags set, player level short. The quest
 * log names it during grind gaps — without an accept path. undefined while
 * the story itself still gates the next quest (never reveal it early) and
 * when the campaign is complete. */
export function levelLockedMain(p: PlayerState): QuestDef | undefined {
  for (const q of QUESTS) {
    if (!q.main) continue;
    if ((p.quests[q.id]?.status ?? 'unavailable') === 'done') continue;
    if (q.prereqQuest && p.quests[q.prereqQuest]?.status !== 'done') return undefined;
    if (q.prereqFlags && !q.prereqFlags.some((f) => p.flags[f] !== undefined)) return undefined;
    return p.level >= q.level ? undefined : q;
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
 * player may already own the goods) and reach objectives credit the target
 * when the player stands in it or EVER visited it (the `zone_` flag
 * onZoneEnter plants, #23). Shared by direct acceptance (acceptQuest) and
 * the story-effect start path so every quest start reconciles identically.
 * Returns the quests the start itself just made turn-in-ready (#119). */
export function beginQuest(p: PlayerState, id: string): string[] {
  const q = quest(id);
  const qp = progress(p, id);
  qp.status = 'active';
  qp.counts = q?.objectives.map(() => 0) ?? [];
  for (const [i, o] of (q?.objectives ?? []).entries()) {
    if (o.kind === 'reach' && (p.currentZone === o.target || p.flags[`zone_${o.target}`])) {
      qp.counts[i] = 1;
    }
  }
  // The start itself can complete the quest (#119): pre-owned goods or an
  // already-visited reach target flip it ready on the spot.
  return refreshProgress(p);
}

export function acceptQuest(
  p: PlayerState,
  id: string,
  npcId: string,
): { ok: boolean; msg: string; lines: string[] } {
  const q = quest(id);
  if (!q) return { ok: false, msg: 'Unknown quest.', lines: ['Unknown quest.'] };
  // Authority before status (#64): a wrong-NPC or wrong-zone attempt is
  // refused with guidance and never touches quest state.
  const refusal = contactRefusal(p.currentZone, npcId, q.startNpc);
  if (refusal) return { ok: false, msg: refusal, lines: [refusal] };
  const qp = progress(p, id);
  if (qp.status !== 'available') {
    const msg = "That quest isn't available right now.";
    return { ok: false, msg, lines: [msg] };
  }
  // Acceptance itself can complete the quest (#119): pre-owned goods or an
  // already-visited reach target. Report BOTH the acceptance and the
  // readiness.
  const ready = beginQuest(p, id);
  const msg = `📜 Quest accepted: ${q.name}`;
  return { ok: true, msg, lines: [msg, ...ready.map(questReadyLine)] };
}

/** Live progress of one objective (collect objectives read the bag). */
function objectiveProgress(
  p: PlayerState,
  qp: QuestProgress,
  obj: Objective,
  index: number,
): number {
  if (obj.kind === 'collect') return Math.min(obj.count ?? 1, countOf(p, obj.target));
  if (
    obj.kind === 'kill' || obj.kind === 'dungeon' || obj.kind === 'storyEvent' ||
    obj.kind === 'reach'
  ) {
    return Math.min(obj.count ?? 1, qp.counts[index] ?? 0);
  }
  return 0;
}

function questComplete(p: PlayerState, id: string): boolean {
  const q = quest(id);
  const qp = p.quests[id];
  if (!q || !qp || qp.status !== 'active') return false;
  return q.objectives.every((o, i) => objectiveProgress(p, qp, o, i) >= (o.count ?? 1));
}

/** Call after any kill/reach/event; flips completed active quests to turnIn. */
/** Recomputes live progress; returns quests that just became turn-in-ready.
 * The single active→turnIn transition authority (#119): a quest appears in
 * the result exactly once — the flip that readied it — and never again.
 * Exported for the story-effect layer (#125), which must reuse the SAME
 * transition authority instead of reimplementing readiness. */
export function refreshQuestProgress(p: PlayerState): string[] {
  return refreshProgress(p);
}

function refreshProgress(p: PlayerState): string[] {
  const ready: string[] = [];
  for (const [id, qp] of Object.entries(p.quests)) {
    if (qp.status === 'active' && questComplete(p, id)) {
      qp.status = 'turnIn';
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

/** Item-acquisition hook for paths outside battle (shops, treasure):
 * collect objectives read the bag, so a purchase or cache can complete a
 * quest on the spot. Returns newly turn-in-ready quest ids. */
export function onItemGain(p: PlayerState): string[] {
  return refreshProgress(p);
}

/** The ONE way to hand out items outside battle: grants, then refreshes
 * collect-objective readiness. Every gain site routes through here so no
 * source has to remember the quest hook. */
export function grantItem(p: PlayerState, itemId: string, qty = 1): string[] {
  addItem(p, itemId, qty);
  return onItemGain(p);
}

/** Whether a rolled enemy drop may enter the bag. Quest-kind items only
 * drop while an OPEN quest (available/active/turnIn) still needs them and
 * the bag holds fewer than the requirement — surplus keys/samples/emblems
 * can never pile up as permanent unsellable clutter (#2). Materials and
 * consumables are never capped. */
export function questDropAllowed(p: PlayerState, itemId: string): boolean {
  if (item(itemId)?.kind !== 'quest') return true;
  let cap = 0;
  for (const q of QUESTS) {
    const st = p.quests[q.id]?.status;
    if (st !== 'available' && st !== 'active' && st !== 'turnIn') continue;
    for (const o of q.objectives) {
      if (o.kind === 'collect' && o.target === itemId) {
        cap = Math.max(cap, o.count ?? 1);
      }
    }
  }
  return countOf(p, itemId) < cap;
}

/** Dungeon-objective hook: called when a dungeon's boss falls for the first
 * time. Location-specific story objectives key on THIS, never on enemy ids —
 * an overworld echo of a boss must not substitute for the real fight.
 * Returns the quests this clear just made turn-in-ready (#119). */
export function onDungeonClear(p: PlayerState, dungeonId: string): string[] {
  return progressObjective(p, 'dungeon', dungeonId);
}

function objectiveLine(p: PlayerState, q: QuestDef, qp: QuestProgress, i: number): string {
  const o = q.objectives[i]!;
  const need = o.count ?? 1;
  const have = objectiveProgress(p, qp, o, i);
  let label: string;
  switch (o.kind) {
    case 'kill':
      label = `Slay ${enemyName(o.target)}`;
      break;
    case 'collect':
      label = `Collect ${itemName(o.target)}`;
      break;
    case 'reach':
      label = `Travel to ${zoneDef(o.target)?.name ?? o.target}`;
      break;
    case 'storyEvent':
      label = o.label ?? `Follow the story: ${o.target}`;
      break;
    case 'dungeon':
      label = `Clear ${ZONES.find((z) => z.dungeon?.id === o.target)?.dungeon?.name ?? o.target}`;
      break;
  }
  return need > 1 ? `${label} — ${have}/${need}` : `${label}${have >= 1 ? ' ✓' : ''}`;
}

/** The quest-status line for one objective (#127): storyEvent objectives
 * carry their authored display label. */

export function questStatusLine(p: PlayerState, id: string): string {
  const q = quest(id);
  const qp = p.quests[id];
  if (!q) return '';
  if (!qp || qp.status === 'unavailable' || qp.status === 'available') {
    return qp?.status === 'available' ? '🟢 Available' : '🔒 Locked';
  }
  if (qp.status === 'done') return '✅ Completed';
  if (qp.status === 'turnIn') return '🏁 Ready to turn in';
  return q.objectives.map((_, i) => objectiveLine(p, q, qp, i)).join('\n');
}

export interface TurnInResult {
  ok: boolean;
  lines: string[];
}

/** The aggregated collect-goods check behind turnInQuest (#127): returns
 * the shortfall line, or undefined when the turn-in could proceed. The
 * story layer reaches it through the central turnInQuest authority, which
 * runs it again on the transaction draft (#129). */
export function turnInGoodsShortfall(p: PlayerState, id: string): string | undefined {
  const q = quest(id);
  if (!q) return "That quest isn't ready to turn in.";
  const required = new Map<string, number>();
  for (const obj of q.objectives) {
    if (obj.kind !== 'collect') continue;
    required.set(obj.target, (required.get(obj.target) ?? 0) + (obj.count ?? 1));
  }
  for (const [itemId, need] of required) {
    if (countOf(p, itemId) < need) {
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
export function turnInQuest(p: PlayerState, id: string, npcId: string): TurnInResult {
  const q = quest(id);
  if (!q) return { ok: false, lines: ["That quest isn't ready to turn in."] };
  const refusal = contactRefusal(p.currentZone, npcId, q.finishNpc);
  if (refusal) return { ok: false, lines: [refusal] };
  const qp = p.quests[id];
  if (!qp || qp.status !== 'turnIn') {
    return { ok: false, lines: ["That quest isn't ready to turn in."] };
  }
  // Revalidate at the counter: goods may have been spent, forged away or
  // dropped since the quest readied — the SHARED aggregated check (#8).
  const shortfall = turnInGoodsShortfall(p, id);
  if (shortfall) {
    qp.status = 'active';
    return { ok: false, lines: [shortfall] };
  }
  const required = new Map<string, number>();
  for (const obj of q.objectives) {
    if (obj.kind !== 'collect') continue;
    required.set(obj.target, (required.get(obj.target) ?? 0) + (obj.count ?? 1));
  }
  qp.status = 'done';
  const lines: string[] = [];
  // Collect objectives hand their goods over — samples, sigils and keys
  // leave the bag at turn-in instead of lingering as dead weight.
  for (const [itemId, qty] of required) {
    removeItem(p, itemId, qty);
    lines.push(`📦 Handed over: ${itemName(itemId)} ×${qty}`);
  }
  const r = q.rewards;
  p.gold += r.gold;
  // Post-cap (#36): the reward line shows the conversion instead of
  // advertising XP the player cannot receive. Shared label (#42).
  lines.push(`💰 +${r.gold} gold · ${xpRewardLabel(p.level, r.xp)}`);
  lines.push(...grantXp(p, r.xp));
  for (const [itemId, qty] of Object.entries(r.items ?? {})) {
    addItem(p, itemId, qty);
    lines.push(`🎁 Received: ${itemName(itemId)}${qty > 1 ? ` ×${qty}` : ''}`);
  }
  // Reward items can complete OTHER active collect quests on the spot.
  for (const id of onItemGain(p)) lines.push(questReadyLine(id));
  for (const f of r.flags ?? []) p.flags[f] = true;
  if (r.unlockZone && !p.unlockedZones.includes(r.unlockZone)) {
    p.unlockedZones.push(r.unlockZone);
    lines.push(`🗺️ New area unlocked: ${zoneDef(r.unlockZone)?.name ?? r.unlockZone}`);
  }
  return { ok: true, lines };
}

/**
 * Progresses every active quest with an objective matching (kind, target).
 * +1 per event, capped at the objective's required count. Returns the quests
 * this event just made turn-in-ready (#119) so the active surface can
 * announce them — callers must not drop the result.
 */
function progressObjective(p: PlayerState, kind: Objective['kind'], target: string): string[] {
  for (const q of QUESTS) {
    const qp = p.quests[q.id];
    if (!qp || qp.status !== 'active') continue;
    q.objectives.forEach((o, i) => {
      if (o.kind === kind && o.target === target) {
        qp.counts[i] = Math.min(o.count ?? 1, (qp.counts[i] ?? 0) + 1);
      }
    });
  }
  return refreshProgress(p);
}

/** Kill-objective hook: called for every enemy the player defeats. */
export function onKill(p: PlayerState, enemyId: string): string[] {
  return progressObjective(p, 'kill', enemyId);
}

/** Reach-objective hook: called on zone entry. */
export function onZoneEnter(p: PlayerState, zoneId: string): string[] {
  p.flags[`zone_${zoneId}`] = true;
  return progressObjective(p, 'reach', zoneId);
}

/** Story-event hook (#127): called when an authored dialogue reaches the
 * node (or choice) that emits the event. This is the ONE conversation
 * progression path — opening menus, selecting topics and generic NPC
 * contact never advance anything. Readiness flows back through the same
 * exactly-once transition authority (#119). */
export function onStoryEvent(p: PlayerState, event: string): string[] {
  return progressObjective(p, 'storyEvent', event);
}
