/**
 * Battle actions: player turns, victory/defeat resolution, dungeon hooks.
 */

import type { BattlePhase, PlayerState } from '../engine/types.ts';
import type { Cb } from '../codec.ts';
import { performAction, type PlayerAction } from '../engine/combat.ts';
import { clampPools, statsOf } from '../engine/character.ts';
import { addItem, removeItem } from '../engine/inventory.ts';
import { isEquippable, item } from '../content/items.ts';
import { resolveVictory } from '../engine/world.ts';
import type { MutationResult } from './session.ts';

/** Runs one player action and resolves the round. */
export function battleAction(p: PlayerState, cb: Cb & { v: 'battle' }): MutationResult {
  const b = p.battle;
  if (!b) {
    p.scene = { view: 'zone' };
    return {};
  }

  // Battle finished: Continue returns to the zone (or back into an open menu).
  if (cb.a === 'go') {
    if (b.phase === 'active') {
      // "go" doubles as back-from-submenu while the fight is live.
      p.scene = { view: 'battle' };
      return {};
    }
    p.battle = undefined;
    p.scene = { view: 'zone' };
    return {};
  }
  if (cb.a === 'sk') {
    p.scene = { view: 'battleSkills' };
    return {};
  }
  if (cb.a === 'it') {
    p.scene = { view: 'battleItems' };
    return {};
  }

  if (b.phase !== 'active') return { toast: 'The battle is already over.' };

  let action: PlayerAction;
  switch (cb.a) {
    case 'atk':
      action = { kind: 'attack' };
      break;
    case 'gd':
      action = { kind: 'guard' };
      break;
    case 'fl':
      action = { kind: 'flee' };
      break;
    case 'use': {
      // Skill ids and consumable item ids share this entry point.
      if (isConsumable(cb.arg)) action = { kind: 'item', itemId: cb.arg };
      else action = { kind: 'skill', skillId: cb.arg };
      break;
    }
    default:
      return {};
  }

  const res = performAction(p, b, action);
  const lines = [...res.lines];
  const phase = b.phase as BattlePhase;

  if (phase === 'fled') {
    p.battle = undefined;
    p.scene = { view: 'zone' };
    p.notices = lines;
    return {};
  }

  // Victory resolution — routed through the engine so the battle's origin
  // (explore/elite/dungeon) decides rewards, quest hooks and bookkeeping.
  if (phase === 'active' && b.enemy.hp <= 0) {
    // Kill rounds return before the log push, so the round's lines are NOT
    // in the battle log — notices carry them plus the victory resolution
    // (#32 keeps ordinary rounds single-presented).
    p.notices = [...lines, ...resolveVictory(p, b)];
    b.phase = 'won';
    p.scene = { view: 'battle' };
    return {};
  }

  // Defeat resolution
  if (b.phase === 'active' && p.hp <= 0) {
    b.phase = 'lost';
    p.scene = { view: 'death' };
    p.notices = lines;
    return {};
  }

  // Non-terminal round: the log is the single presentation of the round's
  // lines (#32) — the redraw no longer repeats them as notices. Invalid
  // actions (no turn consumed, no enemy phase) never reach the log, so
  // they keep their feedback.
  p.notices = res.consumedTurn ? [] : lines;
  p.scene = { view: 'battle' };
  return {};
}

function isConsumable(id: string): boolean {
  return item(id)?.kind === 'consumable';
}

/** Non-battle item actions (inventory view). */
export function itemAction(
  p: PlayerState,
  op: 'u' | 'eq' | 'sell' | 'drop',
  itemId: string,
): MutationResult {
  if (op === 'u') {
    const def = item(itemId);
    if (!def || def.kind !== 'consumable') return { toast: "Can't use that here." };
    // Out-of-battle use: apply effect directly.
    const entry = p.inventory.find((e) => e.id === itemId);
    if (!entry) return { toast: "You don't have that." };
    const s = statsOf(p);
    const lines: string[] = [];
    if (def.effect?.healHp) {
      const before = p.hp;
      p.hp = Math.min(s.maxHp, p.hp + def.effect.healHp);
      lines.push(`🧪 Restored ${p.hp - before} HP.`);
    }
    if (def.effect?.healMp) {
      const before = p.mp;
      p.mp = Math.min(s.maxMp, p.mp + def.effect.healMp);
      lines.push(`💧 Restored ${p.mp - before} MP.`);
    }
    if (lines.length === 0) return { toast: 'Nothing happened.' };
    removeItem(p, itemId, 1);
    p.notices = lines;
    p.scene = { view: 'item', arg: itemId };
    return {};
  }
  if (op === 'eq') {
    const check = isEquippable(itemId, p.classId, p.level);
    if (!check.ok) return { toast: check.reason };
    const def = item(itemId)!;
    const slot = def.kind as 'weapon' | 'armor' | 'trinket';
    const prev = p.equipment[slot];
    // Ownership is verified by the engine, not the UI: removeItem must
    // actually take a copy from the bag before anything is equipped.
    if (!removeItem(p, itemId, 1)) return { toast: "You don't have that." };
    if (prev) addItem(p, prev, 1);
    p.equipment[slot] = itemId;
    // Swapping gear can lower max HP/MP — never leave pools over cap.
    clampPools(p);
    p.notices = [`⚔️ Equipped ${def.name}.`];
    p.scene = { view: 'equipment' };
    return {};
  }
  if (op === 'sell') {
    const def = item(itemId);
    if (!def || def.unique) return { toast: "Can't sell that." };
    if (!removeItem(p, itemId, 1)) return { toast: "You don't have that." };
    const gain = Math.floor(def.price * 0.4);
    p.gold += gain;
    p.notices = [`💱 Sold ${def.name} for ${gain} gold.`];
    p.scene = { view: 'inventory', arg: '0' };
    return {};
  }
  // drop
  const def = item(itemId);
  if (def?.kind === 'quest') return { toast: "That isn't yours to throw away." };
  if (def?.unique) return { toast: "You've earned that — it stays with you." };
  if (!removeItem(p, itemId, 1)) return { toast: "You don't have that." };
  p.notices = [`🗑️ Dropped ${item(itemId)?.name ?? itemId}.`];
  p.scene = { view: 'inventory', arg: '0' };
  return {};
}
