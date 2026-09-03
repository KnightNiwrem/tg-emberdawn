/**
 * Hub actions: zone exploration, travel, shop, forge, quests, NPCs, meta.
 * Each handler mutates PlayerState only — I/O lives in session.ts.
 */

import type { PlayerState } from '../engine/types.ts';
import type { Cb } from '../codec.ts';
import {
  bossGateBlock,
  diveDungeon,
  dungeonOf,
  explore,
  nextDiveIsBoss,
  travel,
} from '../engine/world.ts';
import { zone as zoneDef } from '../content/zones.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { buy, sell } from '../engine/shops.ts';
import { temper } from '../engine/forge.ts';
import {
  acceptQuest,
  onTalk,
  questReadyLine,
  syncAvailability,
  turnInQuest,
} from '../engine/quests.ts';
import { npc, npcInZone, quest } from '../content/quests.ts';
import { dialogue, dialogueNode } from '../content/dialogues.ts';
import type { DialogueDef, DialogueNode } from '../content/types.ts';
import { applyDialogueChoice } from '../engine/story.ts';
import { evalCondition } from '../engine/conditions.ts';
import { applyDeath } from '../engine/character.ts';
import { createPlayer } from '../engine/character.ts';
import { CLASS_IDS } from '../engine/types.ts';
import { enterBattle } from './battle.ts';
import type { MutationResult } from './session.ts';

/** Zone hub actions (explore/dive/talk) + navigation. */
/** Small navigation helper: switch view and clear context. */
function go(p: PlayerState, view: PlayerState['scene']['view'], arg?: string): MutationResult {
  p.scene = arg === undefined ? { view } : { view, arg };
  return {};
}

/** Explore the zone: may start a battle, find treasure, rest, or nothing. */
function exploreAction(p: PlayerState): MutationResult {
  if (p.battle) {
    p.scene = { view: 'battle' };
    return { toast: 'Finish this fight first!' };
  }
  const outcome = explore(p);
  if (outcome.kind === 'battle') {
    // #96: enterBattle resolves the opening's explicit adjudication — a
    // terminal opening routes straight to victory/defeat resolution.
    return enterBattle(p, outcome.battle, outcome.outcome, [outcome.line]);
  }
  p.notices = outcome.lines;
  p.scene = { view: 'zone' };
  return {};
}

/** Dive into the zone's dungeon (next floor or boss). The boss floor is
 * inescapable — when the dive would reach it below the dungeon's authored
 * readiness level, the first tap stages an explicit confirmation (#73);
 * the z:dgb control proceeds deliberately. */
function diveAction(p: PlayerState, confirmed = false): MutationResult {
  if (p.battle) {
    p.scene = { view: 'battle' };
    return { toast: 'Finish this fight first!' };
  }
  const z = zoneDef(p.currentZone);
  const d = z ? dungeonOf(z) : undefined;
  if (!z || !d) return { toast: 'No dungeon here.' };
  const boss = enemyDef(d.boss);
  if (
    !confirmed &&
    nextDiveIsBoss(p, d) &&
    d.recommendedLevel !== undefined &&
    p.level < d.recommendedLevel
  ) {
    p.scene = { view: 'zone', arg: 'bossok' };
    return {
      toast: `Readiness check: ${boss?.name ?? 'the boss'} is Lv ${
        boss?.level ?? '?'
      }, tuned for Lv ${d.recommendedLevel}. This fight cannot be fled.`,
    };
  }
  const res = diveDungeon(p, d);
  if (!res.ok || !res.battle) {
    p.notices = res.lines;
    return { toast: res.lines[0] ?? bossGateBlock(p, d) };
  }
  // #96: enterBattle resolves the opening's explicit adjudication.
  return enterBattle(p, res.battle, res.outcome ?? 'ongoing', res.lines);
}

/** Talk to a zone NPC: opens the explicit topic-selection scene (#123).
 * Opening the menu is NAVIGATION — it never advances talk objectives,
 * never accepts or turns in a quest, and never mutates story state. Which
 * topic the player selects decides what happens (see npcAction). */
function talkAction(p: PlayerState, npcIndex: number): MutationResult {
  const z = zoneDef(p.currentZone);
  const npc = z?.npcs[npcIndex];
  if (!npc) return { toast: 'Nobody there.' };
  p.scene = { view: 'npc', arg: npc.id };
  return {};
}

/** NPC topic-menu actions (#123). Every selection revalidates the live
 * scene context (view + NPC id), the NPC's physical presence in the
 * current zone, and the CURRENT quest/topic availability — stale, forged
 * or no-longer-valid topic callbacks are harmless refusals. */
export function npcAction(p: PlayerState, cb: Cb & { v: 'npc' }): MutationResult {
  switch (cb.a) {
    case 'bk':
      // Leaving the scene invalidates its buttons (rev bump on commit).
      p.scene = { view: 'zone' };
      return {};
    case 'op': {
      if (!npcInZone(p.currentZone, cb.arg)) return { toast: 'Nobody there.' };
      p.scene = { view: 'npc', arg: cb.arg };
      return {};
    }
    case 'q': {
      // Quest business must be selected from a live topic menu for an NPC
      // who is actually here.
      if (p.scene.view !== 'npc' || !p.scene.arg) {
        return { toast: 'That conversation has moved on — talk to the NPC again.' };
      }
      const npcId = p.scene.arg;
      if (!npcInZone(p.currentZone, npcId)) return { toast: 'Nobody there.' };
      const q = quest(cb.arg);
      if (!q) return { toast: 'That business has moved on.' };
      const st = p.quests[q.id]?.status ?? 'unavailable';
      // Accept/turn-in route to the AUTHORITATIVE interaction (#64); the
      // engine revalidates contact and location again inside it.
      if (st === 'available' && q.startNpc === npcId) {
        p.scene = { view: 'npcq', arg: q.id, arg2: npcId };
        return {};
      }
      if (st === 'turnIn' && q.finishNpc === npcId) {
        p.scene = { view: 'npcq', arg: q.id, arg2: npcId };
        return {};
      }
      if (st === 'active' && (q.startNpc === npcId || q.finishNpc === npcId)) {
        // Interim conversation beat (#123, replaced by authored dialogue
        // events in #127): selecting an active quest's topic IS the
        // conversation — the named NPC's talk objectives tick HERE, never
        // on generic contact. Readiness is announced exactly once (#119).
        const ready = onTalk(p, npcId);
        if (ready.includes(q.id)) {
          p.scene = { view: 'npcq', arg: q.id, arg2: npcId };
          p.notices = ready.map(questReadyLine);
          return {};
        }
        p.notices = ready.map(questReadyLine);
        p.scene = { view: 'npc', arg: npcId, arg2: `q:${q.id}` };
        return {};
      }
      return { toast: 'That business has moved on.' };
    }
    case 'lore': {
      if (p.scene.view !== 'npc' || !p.scene.arg) {
        return { toast: 'That topic has moved on.' };
      }
      const npcId = p.scene.arg;
      const def = npc(npcId);
      const topic = def?.topics?.find((t) => t.id === cb.arg);
      if (!npcInZone(p.currentZone, npcId) || !topic) {
        return { toast: 'That topic has moved on.' };
      }
      // A dialogue-backed topic (#124) opens the conversation scene at its
      // start node; the static text renders the single-beat view.
      if (topic.dialogue) {
        const d = dialogue(topic.dialogue);
        if (!d || d.npcId !== npcId) return { toast: 'That topic has moved on.' };
        p.scene = { view: 'dialogue', arg: d.id, arg2: d.start };
        return {};
      }
      if (!topic.text) return { toast: 'That topic has moved on.' };
      p.scene = { view: 'npc', arg: npcId, arg2: `lore:${cb.arg}` };
      return {};
    }
  }
}

export function zoneAction(p: PlayerState, cb: Cb & { v: 'zone' }): MutationResult {
  switch (cb.a) {
    case 'hm':
      return go(p, 'zone');
    case 'ex':
      return exploreAction(p);
    case 'dg':
      return diveAction(p);
    case 'dgb':
      // Explicit confirmation for an under-level boss dive (#73).
      return diveAction(p, true);
    case 'tv':
      return go(p, 'travel');
    case 'ch':
      return go(p, 'character');
    case 'inv':
      return go(p, 'inventory', '0');
    case 'sk':
      return go(p, 'skills');
    case 'q':
      return go(p, 'quests');
    case 'sh':
      return go(p, 'shop', '0');
    case 'fg':
      return go(p, 'forge');
    case 'tk':
      return talkAction(p, cb.arg);
  }
}

export function travelAction(p: PlayerState, cb: Cb & { v: 'travel' }): MutationResult {
  if (cb.a === 'bk') {
    p.scene = { view: 'zone' };
    return {};
  }
  const res = travel(p, cb.arg);
  if (!res.ok) return { toast: res.lines[0] };
  p.notices = res.lines;
  p.scene = { view: 'zone' };
  syncAvailability(p);
  return {};
}

export function shopAction(p: PlayerState, cb: Cb & { v: 'shop' }): MutationResult {
  if (cb.a === 'bk') {
    p.scene = { view: 'zone' };
    return {};
  }
  if (cb.a === 'p') {
    // -1 switches to sell mode
    if (cb.arg < 0) {
      p.scene = { view: 'shop', arg: 'sell', arg2: '0' };
      return {};
    }
    if (p.scene.arg === 'sell') p.scene = { view: 'shop', arg: 'sell', arg2: String(cb.arg) };
    else p.scene = { view: 'shop', arg: String(cb.arg) };
    return {};
  }
  if (cb.a === 'buy') {
    const res = buy(p, cb.arg, 1);
    if (!res.ok) return { toast: res.lines[0] };
    // Success lines — the purchase confirmation plus any quest-ready
    // callout from grantItem — surface on the redrawn shop screen (#30)
    // instead of a silent redraw.
    p.notices = res.lines;
    return {};
  }
  // sell
  const res = sell(p, cb.arg, 1);
  if (!res.ok) return { toast: res.lines[0] };
  p.notices = res.lines;
  return {};
}

export function forgeAction(p: PlayerState, cb: Cb & { v: 'forge' }): MutationResult {
  if (cb.a === 'bk') {
    p.scene = { view: 'zone' };
    return {};
  }
  const res = temper(p, cb.a === 'w' ? 'weapon' : 'armor');
  p.notices = res.lines;
  return { toast: res.ok ? undefined : res.lines[0] };
}

export function questsAction(p: PlayerState, cb: Cb & { v: 'quests' }): MutationResult {
  // The Quest Log is a read-only journal (#65): the codec cannot even express
  // lifecycle actions for this view, so every case here is pure navigation.
  switch (cb.a) {
    case 'p': {
      // Side-quest page switch (#21); the detail selector stays clear.
      p.scene = { view: 'quests', arg2: String(cb.arg) };
      return {};
    }
    case 'bk': {
      // Back to the log on the SAME page the detail was opened from (#21).
      p.scene = { view: 'quests', arg2: p.scene.arg2 };
      return {};
    }
    case 'open':
    case 'q': {
      p.scene = { view: 'quests', arg: cb.arg, arg2: p.scene.arg2 };
      return {};
    }
  }
}

/** NPC-interaction quest actions (#64): the authoritative accept/turn-in
 * surface. The scene carries the interaction context (quest id + the NPC
 * talked to); the engine independently revalidates contact and location
 * before any mutation, the uiRev guard kills replays, and log navigation
 * can never mint n:* callbacks. */
export function npcqAction(p: PlayerState, cb: Cb & { v: 'npcq' }): MutationResult {
  if (cb.a === 'bk') {
    // Back goes to the same NPC's topic menu (#123) when the scene still
    // names that NPC and they are physically here; otherwise to the zone.
    const npcId = p.scene.view === 'npcq' ? p.scene.arg2 : undefined;
    p.scene = npcId && npcInZone(p.currentZone, npcId)
      ? { view: 'npc', arg: npcId }
      : { view: 'zone' };
    return {};
  }
  const questId = cb.arg;
  if (p.scene.view !== 'npcq' || p.scene.arg !== questId) {
    // A callback for an interaction that is no longer live.
    return { toast: 'That conversation has moved on — talk to the NPC again.' };
  }
  const npcId = p.scene.arg2 ?? '';
  if (cb.a === 'a') {
    const res = acceptQuest(p, questId, npcId);
    if (!res.ok) return { toast: res.msg };
    const q = quest(questId);
    // Acceptance line, the intro, then any immediate-readiness notice
    // (#119: a quest can be complete the moment it is accepted).
    p.notices = [res.msg, q?.intro ?? '', ...res.lines.slice(1)].filter(Boolean);
    p.scene = { view: 'npcq', arg: questId, arg2: npcId };
    return {};
  }
  // turn in
  const res = turnInQuest(p, questId, npcId);
  if (!res.ok) return { toast: res.lines[0] };
  p.notices = res.lines;
  p.scene = { view: 'zone' }; // business concluded — back to the hub
  syncAvailability(p);
  return {};
}

/** Dialogue scene actions (#124/#126): multi-node conversations and
 * branching choices. Every control revalidates the live scene, the
 * dialogue's NPC presence in the current zone, the current node, and the
 * exact target carried by the callback — forged, replayed (rev guard),
 * wrong-node and wrong-dialogue taps are non-mutating. Irreversible
 * choices stage an explicit confirmation panel BEFORE any mutation;
 * opening, backing out of, or abandoning it changes no story state. */
export function dialogueAction(p: PlayerState, cb: Cb & { v: 'dlg' }): MutationResult {
  const d = p.scene.view === 'dialogue' ? dialogue(p.scene.arg ?? '') : undefined;
  if (cb.a === 'bk') {
    // Back/End/Not-now returns to the owning NPC's topic menu when they
    // are still on-site; otherwise the zone. No story mutation.
    p.scene = d && npcInZone(p.currentZone, d.npcId)
      ? { view: 'npc', arg: d.npcId }
      : { view: 'zone' };
    return {};
  }
  if (cb.a === 'cc') {
    // Abandon the staged confirmation — back to the choice list, no
    // mutation (the choice remains available).
    if (p.scene.arg3?.startsWith('confirm:')) p.scene.arg3 = undefined;
    return {};
  }
  if (!d) return { toast: 'That conversation has moved on.' };
  if (!npcInZone(p.currentZone, d.npcId)) return { toast: 'Nobody there.' };
  const node = dialogueNode(d, p.scene.arg2 ?? '');
  if (cb.a === 'nx') {
    if (!node || node.kind !== 'line' || node.next !== cb.arg) {
      return { toast: 'That conversation has moved on.' };
    }
    p.scene = { view: 'dialogue', arg: d.id, arg2: cb.arg };
    return {};
  }
  if (cb.a === 'ch') {
    if (!node || node.kind !== 'choice') {
      return { toast: 'That conversation has moved on.' };
    }
    const choice = node.choices.find((c) => c.id === cb.arg);
    if (!choice) return { toast: 'That response is not on the table.' };
    // Availability is re-evaluated at tap time (rendering is not authority).
    if (choice.when && !evalCondition(p, choice.when)) {
      return { toast: 'That response is no longer available.' };
    }
    if (choice.irreversible) {
      // Stage the confirmation — nothing is mutated merely by opening it.
      p.scene = { view: 'dialogue', arg: d.id, arg2: node.id, arg3: `confirm:${choice.id}` };
      return {};
    }
    return applyChoice(p, d, node, choice.id);
  }
  // 'cf': the CONFIRMED irreversible choice — the staged panel must match.
  if (!node || node.kind !== 'choice') {
    return { toast: 'That conversation has moved on.' };
  }
  if (p.scene.arg3 !== `confirm:${cb.arg}`) {
    return { toast: 'Confirm the choice on its confirmation screen.' };
  }
  const choice = node.choices.find((c) => c.id === cb.arg);
  if (!choice?.irreversible) return { toast: 'That response is not on the table.' };
  return applyChoice(p, d, node, choice.id);
}

/** Applies a choice through the central engine operation and routes the
 * scene to the next beat (or back to the topic menu when the conversation
 * ends). Notice lines flow through the normal banner. */
function applyChoice(
  p: PlayerState,
  d: DialogueDef,
  node: Extract<DialogueNode, { kind: 'choice' }>,
  choiceId: string,
): MutationResult {
  const result = applyDialogueChoice(p, {
    dialogueId: d.id,
    nodeId: node.id,
    choiceId,
    npcId: d.npcId,
    now: Date.now(),
  });
  if (!result.ok) return { toast: result.refusal };
  p.notices = [...p.notices, ...result.lines];
  if (result.nextNodeId) {
    p.scene = { view: 'dialogue', arg: d.id, arg2: result.nextNodeId };
  } else {
    // The conversation concluded on this choice — back to the topics.
    p.scene = npcInZone(p.currentZone, d.npcId) ? { view: 'npc', arg: d.npcId } : { view: 'zone' };
  }
  return {};
}

export function deathAction(p: PlayerState): MutationResult {
  const line = applyDeath(p);
  p.battle = undefined;
  p.notices = [line, "You gather yourself. Roads end; dawns don't."];
  p.scene = { view: 'zone' };
  return {};
}

// ── Meta: class pick, help, reset ────────────────────────────────────────

/** The class picker is the ONLY meta action available without a save —
 * handleMeta refuses it whenever a character already exists, so a stale
 * picker can never overwrite a hero. */
export function pickClass(
  cb: Extract<Cb, { v: 'meta'; a: 'pick' }>,
  userId: number,
  name: string,
): PlayerState | undefined {
  const cid = CLASS_IDS.find((c) => c === cb.arg);
  if (!cid) return undefined;
  const fresh = createPlayer(userId, name, cid);
  syncAvailability(fresh);
  return fresh;
}

/** Meta actions that require an existing hero (help / reset staging and
 * cancellation). The type excludes 'pick': class creation is the only
 * no-player meta path and lives in pickClass() — and it excludes 'resetYes':
 * the confirmed reset is a real deletion (#62), handled as an I/O operation
 * in handleMeta, not as a pure mutation from one PlayerState into another.
 * A new meta action must choose its renderer in this switch and its
 * precondition here, at compile time. */
export function metaAction(
  p: PlayerState,
  cb: Extract<Cb, { v: 'meta'; a: 'help' | 'reset' | 'resetNo' }>,
): PlayerState {
  switch (cb.a) {
    case 'help':
      p.scene = { view: 'help' };
      return p;
    case 'reset':
      // Stage the confirmation — nothing is destroyed here (#19).
      p.scene = { view: 'reset' };
      return p;
    case 'resetNo':
      // Cancel: resume whatever was live — a pending fight stays a fight.
      p.scene = p.battle
        ? { view: p.battle.phase === 'lost' ? 'death' : 'battle' }
        : { view: 'zone' };
      return p;
  }
}
