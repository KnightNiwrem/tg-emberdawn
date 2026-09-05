/**
 * Battle actions: player turns, victory/defeat resolution, dungeon hooks.
 */

import type { BattlePhase, PlayerState } from '../engine/types.ts';
import type { Cb } from '../codec.ts';
import { type BattleOutcome, performAction, type PlayerAction } from '../engine/combat.ts';
import { clampPools, statsOf } from '../engine/character.ts';
import { addItem, removeItem } from '../engine/inventory.ts';
import { isEquippable, item } from '../content/items.ts';
import { resolveVictory } from '../engine/world.ts';
import { advanceJourney, completeTravelBattleEvent, type JourneyStep } from '../engine/journey.ts';
import { coachTutorial, grantTutorialReward, tutorialRelease } from './tutorial.ts';
import type { MutationResult } from './session.ts';

/** Resolves an opening-terminal battle at construction (#96): the same
 * explicit adjudication battleAction applies after a round, applied to the
 * opening's outcome before any round runs. Terminal outcomes route exactly
 * like round outcomes — victory through resolveVictory (rewards, quest
 * hooks, dungeon bookkeeping), defeat to the death view; 'ongoing' simply
 * enters the fight. */
export function enterBattle(
  p: PlayerState,
  b: NonNullable<PlayerState['battle']>,
  outcome: BattleOutcome,
  intro: string[],
): MutationResult {
  p.battle = b;
  if (outcome === 'victory') {
    // The opening log IS the terminal round's record (#67): notices carry
    // only the victory RESOLUTION, never a faked round.
    p.notices = [...intro, ...resolveVictory(p, b)];
    // A travel-provenance victory completes its pending event at ONE
    // clearly owned point (#159); the journey resumes on Continue.
    if (b.origin.kind === 'travel') completeTravelBattleEvent(p);
    b.phase = 'won';
    p.scene = { view: 'battle' };
    return {};
  }
  if (outcome === 'defeat') {
    b.phase = 'lost';
    p.scene = { view: 'death' };
    p.notices = intro;
    return {};
  }
  p.scene = { view: 'battle' };
  p.notices = intro;
  return {};
}

/** Resumes the crossing after a travel battle's Continue (#159): the next
 * event rolls resolve, or the final arrival lands. */
function resumeJourney(p: PlayerState): MutationResult {
  return applyJourneyStep(p, advanceJourney(p));
}

/** Applies an already-resolved coordinator result (#179); never rolls or
 * advances a journey, and never owns departure authorization. */
export function applyJourneyStep(p: PlayerState, step: JourneyStep): MutationResult {
  if (step.kind === 'battle') {
    return enterBattle(p, step.battle, step.outcome, [step.line]);
  }
  if (step.kind === 'arrived') {
    p.notices = step.lines;
    p.scene = { view: 'zone' };
    return {};
  }
  p.scene = { view: 'journey' };
  return {};
}

/** Runs one player action and resolves the round. */
export function battleAction(p: PlayerState, cb: Cb & { v: 'battle' }): MutationResult {
  const b = p.battle;
  if (!b) {
    p.scene = { view: 'zone' };
    return {};
  }

  // Battle finished: Continue returns to the zone (or back into an open menu).
  // The guided prologue (#69) routes its victory Continue through the
  // release instead: tutorial done, hub unlocked, next steps surfaced.
  if (cb.a === 'go') {
    if (b.phase === 'active') {
      // "go" doubles as back-from-submenu while the fight is live.
      p.scene = { view: 'battle' };
      return {};
    }
    const won = b.phase === 'won';
    const wasTravel = b.origin.kind === 'travel';
    p.battle = undefined;
    if (won && p.tutorial === 'fight') {
      p.tutorial = 'done';
      p.scene = { view: 'zone' };
      p.notices = tutorialRelease();
      return {};
    }
    // A travel battle's Continue resumes the exact pending crossing (#159):
    // mid-crossing it offers the stable journey intermission (report +
    // continue/retreat/supplies); after the LAST event it lands the final
    // arrival through the one coordinator.
    if (won && wasTravel && p.journey) {
      if (p.journey.completedEvents >= p.journey.totalEvents) return resumeJourney(p);
      p.scene = { view: 'journey' };
      return {};
    }
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

  // The navigation actions (go/sk/it) returned above — only combat actions
  // remain, so the switch is exhaustive with no silent default (#58).
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
  }

  const res = performAction(p, b, action);
  const lines = [...res.lines];
  const phase = b.phase as BattlePhase;

  if (res.outcome === 'fled' || phase === 'fled') {
    p.battle = undefined;
    // A successful flee (or Smoke Bomb) from a travel fight ABORTS the
    // crossing (#159/#160): battle and journey clear, the player stays at
    // the edge origin, earned rewards remain.
    if (b.origin.kind === 'travel') p.journey = undefined;
    p.scene = { view: 'zone' };
    p.notices = lines;
    return {};
  }

  // Victory resolution — the ENGINE adjudicated (#86): res.outcome decides
  // the terminal state, never a handler HP re-check (mutual KO is
  // structurally impossible, so there is no check-order ambiguity).
  // Victory is routed through resolveVictory so the battle's origin
  // (explore/elite/dungeon/travel) decides rewards, quest hooks and
  // bookkeeping.
  if (res.outcome === 'victory') {
    // The kill round lives in battle.history as the terminal round (#67) —
    // notices carry only the victory RESOLUTION (defeat line, level-ups,
    // drops, dungeon bookkeeping), never the round itself and never an
    // XP/gold headline: rewards render once as Spoils from b.rewards (#40).
    p.notices = [...resolveVictory(p, b)];
    // A travel-provenance victory completes its pending event at ONE
    // clearly owned point (#159); Continue resumes the crossing.
    if (b.origin.kind === 'travel') completeTravelBattleEvent(p);
    // Guided prologue (#69): the deterministic ember reward lands exactly
    // once (flag-guarded) and lifts every hero to level 2 before release.
    if (p.tutorial === 'fight') p.notices.push(...grantTutorialReward(p));
    b.phase = 'won';
    p.scene = { view: 'battle' };
    return {};
  }

  // Defeat resolution
  if (res.outcome === 'defeat') {
    b.phase = 'lost';
    p.scene = { view: 'death' };
    p.notices = lines;
    return {};
  }

  // Non-terminal round: the log is the single presentation of the round's
  // lines (#32) — the redraw no longer repeats them as notices. Invalid
  // actions (no turn consumed, no enemy phase) never reach the log, so
  // they keep their feedback. The prologue coaches on every consumed turn
  // (#69): one concept at a time replaces the empty banner.
  p.notices = res.consumedTurn ? [] : lines;
  if (p.tutorial === 'fight' && res.consumedTurn) coachTutorial(p);
  p.scene = { view: 'battle' };
  return {};
}

function isConsumable(id: string): boolean {
  return item(id)?.kind === 'consumable';
}

/** Non-battle item actions (inventory view). Selling left the generic
 * inventory (#161): it happens only at a shop's counter — the codec can
 * no longer even express a bag-side sale. */
export function itemAction(
  p: PlayerState,
  op: 'u' | 'eq' | 'drop',
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
    // #112: re-rendering the detail keeps its origin context so Back still
    // returns where the player came from.
    p.scene = {
      view: 'item',
      arg: itemId,
      ...(p.scene.view === 'item' && p.scene.arg2 !== undefined ? { arg2: p.scene.arg2 } : {}),
    };
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
  if (op === 'drop') {
    const def = item(itemId);
    if (def?.kind === 'quest') return { toast: "That isn't yours to throw away." };
    if (def?.unique) return { toast: "You've earned that — it stays with you." };
    if (!removeItem(p, itemId, 1)) return { toast: "You don't have that." };
    p.notices = [`🗑️ Dropped ${item(itemId)?.name ?? itemId}.`];
    p.scene = { view: 'inventory', arg: '0' };
    return {};
  }
  // The switch is exhaustive ('u' | 'eq' | 'drop' all returned above).
  return { toast: "Can't do that with that." };
}
