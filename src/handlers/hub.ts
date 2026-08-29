/**
 * Hub actions: zone exploration, travel, shop, forge, quests, NPCs, meta.
 * Each handler mutates PlayerState only — I/O lives in session.ts.
 */

import type { PlayerState } from '../engine/types.ts';
import type { Cb } from '../codec.ts';
import { diveDungeon, dungeonOf, explore, travel } from '../engine/world.ts';
import { zone as zoneDef } from '../content/zones.ts';
import { buy, sell } from '../engine/shops.ts';
import { temper } from '../engine/forge.ts';
import {
  acceptQuest,
  onTalk,
  questStatusLine,
  syncAvailability,
  turnInQuest,
} from '../engine/quests.ts';
import { quest, QUESTS } from '../content/quests.ts';
import { applyDeath } from '../engine/character.ts';
import { createPlayer } from '../engine/character.ts';
import { CLASS_IDS } from '../engine/types.ts';
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
    p.battle = outcome.battle;
    p.scene = { view: 'battle' };
    p.notices = [outcome.line];
    return {};
  }
  p.notices = outcome.lines;
  p.scene = { view: 'zone' };
  return {};
}

/** Dive into the zone's dungeon (next floor or boss). */
function diveAction(p: PlayerState): MutationResult {
  if (p.battle) {
    p.scene = { view: 'battle' };
    return { toast: 'Finish this fight first!' };
  }
  const z = zoneDef(p.currentZone);
  const d = z ? dungeonOf(z) : undefined;
  if (!z || !d) return { toast: 'No dungeon here.' };
  const res = diveDungeon(p, d);
  if (!res.ok || !res.battle) {
    p.notices = res.lines;
    return { toast: res.lines[0] };
  }
  p.battle = res.battle;
  p.scene = { view: 'battle' };
  p.notices = res.lines;
  return {};
}

/** Talk to a zone NPC; opens their quest when one is ready. */
function talkAction(p: PlayerState, npcIndex: number): MutationResult {
  const z = zoneDef(p.currentZone);
  const npc = z?.npcs[npcIndex];
  if (!npc) return { toast: 'Nobody there.' };
  onTalk(p, npc.id);
  // If the NPC gives an available or turnable quest, open it.
  const given = QUESTS.find((q) =>
    q.giver === npc.id && ['available', 'turnIn'].includes(p.quests[q.id]?.status ?? 'unavailable')
  );
  if (given) {
    p.scene = { view: 'quests', arg: given.id };
    p.notices = [npc.greeting];
    return {};
  }
  const activeGiven = QUESTS.find((q) => q.giver === npc.id && p.quests[q.id]?.status === 'active');
  if (activeGiven) {
    p.notices = [npc.greeting, `📜 ${activeGiven.name}: ${questStatusLine(p, activeGiven.id)}`];
    p.scene = { view: 'zone' };
    return {};
  }
  p.notices = [`🗣️ ${npc.name}: “${npc.greeting}”`];
  p.scene = { view: 'zone' };
  return {};
}

export function zoneAction(p: PlayerState, cb: Cb & { v: 'zone' }): MutationResult {
  switch (cb.a) {
    case 'hm':
      return go(p, 'zone');
    case 'ex':
      return exploreAction(p);
    case 'dg':
      return diveAction(p);
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
    return { toast: res.ok ? undefined : res.lines[0] };
  }
  // sell
  const res = sell(p, cb.arg, 1);
  return { toast: res.ok ? undefined : res.lines[0] };
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
  if (cb.a === 'bk') {
    p.scene = { view: 'quests' };
    return {};
  }
  if (cb.a === 'open') {
    p.scene = { view: 'quests', arg: cb.arg };
    return {};
  }
  if (cb.a === 'q') {
    p.scene = { view: 'quests', arg: cb.arg };
    return {};
  }
  if (cb.a === 'a') {
    const res = acceptQuest(p, cb.arg);
    if (!res.ok) return { toast: res.msg };
    const q = quest(cb.arg);
    p.notices = res.msg ? [res.msg, q?.intro ?? ''].filter(Boolean) : [];
    p.scene = { view: 'quests', arg: cb.arg };
    return {};
  }
  // turn in
  const res = turnInQuest(p, cb.arg);
  if (!res.ok) return { toast: res.lines[0] };
  p.notices = res.lines;
  p.scene = { view: 'quests' };
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

export function metaAction(
  p: PlayerState | undefined,
  cb: Cb & { v: 'meta' },
  userId: number,
  name: string,
): { player?: PlayerState; toast?: string; helpOnly?: boolean; confirmReset?: boolean } {
  switch (cb.a) {
    case 'help':
      if (p) {
        p.scene = { view: 'help' };
        return { player: p };
      }
      return { helpOnly: true };
    case 'pick': {
      const cid = CLASS_IDS.find((c) => c === cb.arg);
      if (!cid) return { toast: 'Unknown class.' };
      const fresh = createPlayer(userId, name, cid);
      syncAvailability(fresh);
      return { player: fresh };
    }
    case 'reset':
      return { confirmReset: true };
    case 'resetNo':
      if (p) {
        p.scene = { view: 'zone' };
        return { player: p };
      }
      return {};
    case 'resetYes':
      if (p) {
        const fresh = createPlayer(userId, p.name, p.classId);
        return { player: fresh };
      }
      return {};
  }
}
