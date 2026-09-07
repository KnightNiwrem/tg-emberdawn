/**
 * Battle actions: player turns, victory/defeat resolution, dungeon hooks.
 */

import type { BattlePhase, PlayerState } from '../engine/types.ts';
import type { Cb } from '../codec.ts';
import { type BattleOutcome, performAction, type PlayerAction } from '../engine/combat.ts';
import { useRecoveryItem } from '../engine/supplies.ts';
import { clampPools } from '../engine/character.ts';
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
  player: PlayerState,
  battle: NonNullable<PlayerState['battle']>,
  outcome: BattleOutcome,
  intro: string[],
): MutationResult {
  player.battle = battle;
  if (outcome === 'victory') {
    // The opening log IS the terminal round's record (#67): notices carry
    // only the victory RESOLUTION, never a faked round.
    player.notices = [...intro, ...resolveVictory(player, battle)];
    // A travel-provenance victory completes its pending event at ONE
    // clearly owned point (#159); the journey resumes on Continue.
    if (battle.origin.kind === 'travel') completeTravelBattleEvent(player);
    battle.phase = 'won';
    player.scene = { view: 'battle' };
    return {};
  }
  if (outcome === 'defeat') {
    battle.phase = 'lost';
    player.scene = { view: 'death' };
    player.notices = intro;
    return {};
  }
  player.scene = { view: 'battle' };
  player.notices = intro;
  return {};
}

/** Resumes the crossing after a travel battle's Continue (#159): the next
 * event rolls resolve, or the final arrival lands. */
function resumeJourney(player: PlayerState): MutationResult {
  return applyJourneyStep(player, advanceJourney(player));
}

/** Applies an already-resolved coordinator result (#179); never rolls or
 * advances a journey, and never owns departure authorization. */
export function applyJourneyStep(player: PlayerState, step: JourneyStep): MutationResult {
  if (step.kind === 'battle') {
    return enterBattle(player, step.battle, step.outcome, [step.line]);
  }
  if (step.kind === 'arrived') {
    player.notices = step.lines;
    player.scene = { view: 'zone' };
    return {};
  }
  player.scene = { view: 'journey' };
  return {};
}

/** Runs one player action and resolves the round. */
export function battleAction(player: PlayerState, cb: Cb & { v: 'battle' }): MutationResult {
  const battle = player.battle;
  if (!battle) {
    player.scene = { view: 'zone' };
    return {};
  }

  // Battle finished: Continue returns to the zone (or back into an open menu).
  // The guided prologue (#69) routes its victory Continue through the
  // release instead: tutorial done, hub unlocked, next steps surfaced.
  if (cb.a === 'go') {
    if (battle.phase === 'active') {
      // "go" doubles as back-from-submenu while the fight is live.
      player.scene = { view: 'battle' };
      return {};
    }
    const won = battle.phase === 'won';
    const wasTravel = battle.origin.kind === 'travel';
    player.battle = undefined;
    if (won && player.tutorial === 'fight') {
      player.tutorial = 'done';
      player.scene = { view: 'zone' };
      player.notices = tutorialRelease();
      return {};
    }
    // A travel battle's Continue resumes the exact pending crossing (#159):
    // mid-crossing it offers the stable journey intermission (report +
    // continue/retreat/supplies); after the LAST event it lands the final
    // arrival through the one coordinator.
    if (won && wasTravel && player.journey) {
      if (player.journey.completedEvents >= player.journey.totalEvents) {
        return resumeJourney(player);
      }
      player.scene = { view: 'journey' };
      return {};
    }
    player.scene = { view: 'zone' };
    return {};
  }
  if (cb.a === 'sk') {
    player.scene = { view: 'battleSkills' };
    return {};
  }
  if (cb.a === 'it') {
    player.scene = { view: 'battleItems' };
    return {};
  }

  if (battle.phase !== 'active') return { toast: 'The battle is already over.' };

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
      if (item(cb.arg)?.kind === 'consumable') action = { kind: 'item', itemId: cb.arg };
      else action = { kind: 'skill', skillId: cb.arg };
      break;
    }
  }

  const result = performAction(player, battle, action);
  const lines = [...result.lines];
  const phase = battle.phase as BattlePhase;

  if (result.outcome === 'fled' || phase === 'fled') {
    player.battle = undefined;
    // A successful flee (or Smoke Bomb) from a travel fight ABORTS the
    // crossing (#159/#160): battle and journey clear, the player stays at
    // the edge origin, earned rewards remain.
    if (battle.origin.kind === 'travel') player.journey = undefined;
    if (battle.origin.kind === 'dungeon') player.dungeonRun = undefined;
    player.scene = { view: 'zone' };
    player.notices = lines;
    return {};
  }

  // Victory resolution — the ENGINE adjudicated (#86): result.outcome decides
  // the terminal state, never a handler HP re-check (mutual KO is
  // structurally impossible, so there is no check-order ambiguity).
  // Victory is routed through resolveVictory so the battle's origin
  // (explore/elite/dungeon/travel) decides rewards, quest hooks and
  // bookkeeping.
  if (result.outcome === 'victory') {
    // The kill round lives in battle.history as the terminal round (#67) —
    // notices carry only the victory RESOLUTION (defeat line, level-ups,
    // drops, dungeon bookkeeping), never the round itself and never an
    // XP/gold headline: rewards render once as Spoils from b.rewards (#40).
    player.notices = [...resolveVictory(player, battle)];
    // A travel-provenance victory completes its pending event at ONE
    // clearly owned point (#159); Continue resumes the crossing.
    if (battle.origin.kind === 'travel') completeTravelBattleEvent(player);
    // Guided prologue (#69): the deterministic ember reward lands exactly
    // once (flag-guarded) and lifts every hero to level 2 before release.
    if (player.tutorial === 'fight') player.notices.push(...grantTutorialReward(player));
    battle.phase = 'won';
    player.scene = { view: 'battle' };
    return {};
  }

  // Defeat resolution
  if (result.outcome === 'defeat') {
    battle.phase = 'lost';
    player.scene = { view: 'death' };
    player.notices = lines;
    return {};
  }

  // Non-terminal round: the log is the single presentation of the round's
  // lines (#32) — the redraw no longer repeats them as notices. Invalid
  // actions (no turn consumed, no enemy phase) never reach the log, so
  // they keep their feedback. The prologue coaches on every consumed turn
  // (#69): one concept at a time replaces the empty banner.
  player.notices = result.consumedTurn ? [] : lines;
  if (player.tutorial === 'fight' && result.consumedTurn) coachTutorial(player);
  player.scene = { view: 'battle' };
  return {};
}

/** Non-battle item actions (inventory view). Selling left the generic
 * inventory (#161): it happens only at a shop's counter — the codec can
 * no longer even express a bag-side sale. */
export function itemAction(
  player: PlayerState,
  operation: 'u' | 'eq' | 'drop',
  itemId: string,
): MutationResult {
  if (operation === 'u') {
    const result = useRecoveryItem(player, itemId);
    if (!result.ok) return { toast: result.lines[0] };
    player.notices = result.lines;
    // #112: re-rendering the detail keeps its origin context so Back still
    // returns where the player came from.
    player.scene = {
      view: 'item',
      itemId: itemId,
      ...(player.scene.view === 'item' && player.scene.returnTo !== undefined
        ? { returnTo: player.scene.returnTo }
        : {}),
    };
    return {};
  }
  if (operation === 'eq') {
    const check = isEquippable(itemId, player.classId, player.level);
    if (!check.ok) return { toast: check.reason };
    const itemDef = item(itemId)!;
    const slot = itemDef.kind as 'weapon' | 'armor' | 'trinket';
    const previousEquipped = player.equipment[slot];
    // Ownership is verified by the engine, not the UI: removeItem must
    // actually take a copy from the bag before anything is equipped.
    if (!removeItem(player, itemId, 1)) return { toast: "You don't have that." };
    if (previousEquipped) addItem(player, previousEquipped, 1);
    player.equipment[slot] = itemId;
    // Swapping gear can lower max HP/MP — never leave pools over cap.
    clampPools(player);
    player.notices = [`⚔️ Equipped ${itemDef.name}.`];
    player.scene = { view: 'equipment' };
    return {};
  }
  if (operation === 'drop') {
    const itemDef = item(itemId);
    if (itemDef?.kind === 'quest') return { toast: "That isn't yours to throw away." };
    if (itemDef?.unique) return { toast: "You've earned that — it stays with you." };
    if (!removeItem(player, itemId, 1)) return { toast: "You don't have that." };
    player.notices = [`🗑️ Dropped ${item(itemId)?.name ?? itemId}.`];
    player.scene = { view: 'inventory', page: 0 };
    return {};
  }
  // The switch is exhaustive ('u' | 'eq' | 'drop' all returned above).
  return { toast: "Can't do that with that." };
}
