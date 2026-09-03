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
      if (!npcInZone(p.currentZone, npcId) || !def?.topics?.some((t) => t.id === cb.arg)) {
        return { toast: 'That topic has moved on.' };
      }
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
