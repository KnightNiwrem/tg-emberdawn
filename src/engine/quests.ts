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
  return p.level >= q.level;
}

/** Recomputes availability for every quest; returns ids newly available. */
export function syncAvailability(p: PlayerState): string[] {
  const newly: string[] = [];
  for (const q of QUESTS) {
    const cur = p.quests[q.id]?.status;
    if (cur === undefined || cur === 'unavailable') {
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

export function acceptQuest(p: PlayerState, id: string): { ok: boolean; msg: string } {
  const q = quest(id);
  if (!q) return { ok: false, msg: 'Unknown quest.' };
  const qp = progress(p, id);
  if (qp.status !== 'available') return { ok: false, msg: "That quest isn't available right now." };
  qp.status = 'active';
  qp.counts = q.objectives.map(() => 0);
  // Collect objectives read the bag live — a player may already own
  // the goods when accepting (e.g. m22 after m21's Crownsworn kills).
  // Reach objectives (#23): zones unlock before their reach quests become
  // available, so the player may already stand in — or have already
  // visited — the target. "Reached" means EVER visited (the zone flag
  // onZoneEnter plants) or currently there; reconcile at accept instead
  // of demanding a pointless leave-and-return.
  q.objectives.forEach((o, i) => {
    if (o.kind === 'reach' && (p.currentZone === o.target || p.flags[`zone_${o.target}`])) {
      qp.counts[i] = 1;
    }
  });
  refreshProgress(p);
  return { ok: true, msg: `📜 Quest accepted: ${q.name}` };
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
    obj.kind === 'kill' || obj.kind === 'dungeon' || obj.kind === 'talk' || obj.kind === 'reach'
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
/** Recomputes live progress; returns quests that just became turn-in-ready. */
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

/** Dungeon-objective hook: called when a dungeon's boss falls for the first
 * time. Location-specific story objectives key on THIS, never on enemy ids —
 * an overworld echo of a boss must not substitute for the real fight. */
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

export function onDungeonClear(p: PlayerState, dungeonId: string): void {
  progressObjective(p, 'dungeon', dungeonId);
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
    case 'talk':
      label = `Speak with ${npcName(o.target)}`;
      break;
    case 'dungeon':
      label = `Clear ${ZONES.find((z) => z.dungeon?.id === o.target)?.dungeon?.name ?? o.target}`;
      break;
  }
  return need > 1 ? `${label} — ${have}/${need}` : `${label}${have >= 1 ? ' ✓' : ''}`;
}

import { npc } from '../content/quests.ts';
function npcName(id: string): string {
  return npc(id)?.name ?? id;
}

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

/** Turns a ready quest in: grants rewards, sets flags, unlocks zones. */
export function turnInQuest(p: PlayerState, id: string): TurnInResult {
  const q = quest(id);
  const qp = p.quests[id];
  if (!q || !qp || qp.status !== 'turnIn') {
    return { ok: false, lines: ["That quest isn't ready to turn in."] };
  }
  // Revalidate at the counter: goods may have been spent, forged away or
  // dropped since the quest readied. Requirements are AGGREGATED per item
  // first (#8) — two collect objectives on the same item must be covered by
  // the TOTAL supply, never validated against the same copies twice. Check
  // everything before consuming anything — turn-in is all-or-nothing.
  const required = new Map<string, number>();
  for (const obj of q.objectives) {
    if (obj.kind !== 'collect') continue;
    required.set(obj.target, (required.get(obj.target) ?? 0) + (obj.count ?? 1));
  }
  for (const [itemId, need] of required) {
    if (countOf(p, itemId) < need) {
      qp.status = 'active';
      return {
        ok: false,
        lines: [`You no longer have enough ${itemName(itemId)} — the quest stays open.`],
      };
    }
  }
  qp.status = 'done';
  const lines: string[] = [q.outro];
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
  for (const id of onItemGain(p)) {
    const rq = quest(id);
    if (rq) lines.push(`🏁 ${rq.name} is ready to turn in!`);
  }
  for (const f of r.flags ?? []) p.flags[f] = true;
  if (r.unlockZone && !p.unlockedZones.includes(r.unlockZone)) {
    p.unlockedZones.push(r.unlockZone);
    lines.push(`🗺️ New area unlocked: ${zoneDef(r.unlockZone)?.name ?? r.unlockZone}`);
  }
  return { ok: true, lines };
}

/**
 * Progresses every active quest with an objective matching (kind, target).
 * +1 per event, capped at the objective's required count.
 */
function progressObjective(p: PlayerState, kind: Objective['kind'], target: string): void {
  for (const q of QUESTS) {
    const qp = p.quests[q.id];
    if (!qp || qp.status !== 'active') continue;
    q.objectives.forEach((o, i) => {
      if (o.kind === kind && o.target === target) {
        qp.counts[i] = Math.min(o.count ?? 1, (qp.counts[i] ?? 0) + 1);
      }
    });
  }
  refreshProgress(p);
}

/** Kill-objective hook: called for every enemy the player defeats. */
export function onKill(p: PlayerState, enemyId: string): void {
  progressObjective(p, 'kill', enemyId);
}

/** Reach-objective hook: called on zone entry. */
export function onZoneEnter(p: PlayerState, zoneId: string): void {
  p.flags[`zone_${zoneId}`] = true;
  progressObjective(p, 'reach', zoneId);
}

/** Talk-objective hook: called when the player speaks to an NPC. */
export function onTalk(p: PlayerState, npcId: string): void {
  progressObjective(p, 'talk', npcId);
}
