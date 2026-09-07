/**
 * Hub actions: zone exploration, travel, shop, forge, quests, NPCs, meta.
 * Each handler mutates PlayerState only — I/O lives in session.ts.
 */

import { DUNGEON_BLOCK } from '../engine/dungeon_run.ts';
import type { PlayerState, SceneState } from '../engine/types.ts';
import type { Cb } from '../codec.ts';
import { abandonDungeon, diveDungeon, dungeonOf, explore } from '../engine/world.ts';
import { advanceJourney, retreatFromJourney, startJourney } from '../engine/journey.ts';
import { zone as zoneDef } from '../content/zones.ts';
import { buy, offeredPrice, sell, shopAt } from '../engine/shops.ts';
import { gather } from '../engine/gathering.ts';
import { craft, recipesAt } from '../engine/crafting.ts';
import { forgeAt, temper } from '../engine/forge.ts';
import { departureCheck, JOURNEY_BLOCK } from '../engine/routes.ts';
import { syncAvailability } from '../engine/quests.ts';
import { npc, npcInZone } from '../content/quests.ts';
import { dialogue, dialogueNode } from '../content/dialogues.ts';
import type { DialogueDef } from '../content/types.ts';
import { npcTopics } from '../engine/npc.ts';
import { applyDialogueChoice, applyStoryEffects, storyNoticeLines } from '../engine/story.ts';
import { evalCondition } from '../engine/conditions.ts';
import { applyDeath } from '../engine/character.ts';
import { createPlayer } from '../engine/character.ts';
import { CLASS_IDS } from '../engine/types.ts';
import { applyJourneyStep, enterBattle } from './battle.ts';
import type { MutationResult } from './session.ts';

/** Zone hub actions (explore/dive/talk) + navigation. */
/** Small navigation helper: switch view and clear context. */
function go(player: PlayerState, scene: SceneState): MutationResult {
  player.scene = scene;
  return {};
}

/** Explore the zone: may start a battle, find treasure, rest, or nothing. */
function exploreAction(player: PlayerState): MutationResult {
  if (player.battle) {
    player.scene = { view: 'battle' };
    return { toast: 'Finish this fight first!' };
  }
  // No exploring mid-crossing (#159): the player is on the road, not in
  // the wilds — and the destination's wilds are not theirs yet.
  if (player.journey) {
    player.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
  }
  const outcome = explore(player);
  if (outcome.kind === 'battle') {
    // #96: enterBattle resolves the opening's explicit adjudication — a
    // terminal opening routes straight to victory/defeat resolution.
    return enterBattle(player, outcome.battle, outcome.outcome, [outcome.line]);
  }
  player.notices = outcome.lines;
  player.scene = { view: 'zone' };
  return {};
}

/** Dive into the zone's dungeon (next floor or boss). The boss floor is
 * inescapable — when the dive would reach it below the dungeon's authored
 * readiness level, the first tap stages an explicit confirmation (#73);
 * the z:dgb control proceeds deliberately. */
function diveAction(player: PlayerState, confirmed = false): MutationResult {
  if (player.battle) {
    player.scene = { view: 'battle' };
    return { toast: 'Finish this fight first!' };
  }
  if (player.journey) {
    player.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
  }
  const currentZone = zoneDef(player.currentZone);
  const dungeon = currentZone ? dungeonOf(currentZone) : undefined;
  if (!currentZone || !dungeon) return { toast: 'No dungeon here.' };
  if (!player.dungeonRun && !confirmed) {
    player.scene = { view: 'zone', panel: 'dungeonEntrance' };
    return {};
  }
  if (
    confirmed &&
    (player.dungeonRun || player.scene.view !== 'zone' || player.scene.panel !== 'dungeonEntrance')
  ) {
    return { toast: 'Open the dungeon entrance first.' };
  }
  const result = diveDungeon(player, dungeon);
  if (!result.ok) return { toast: result.lines[0] };
  if (result.kind === 'discovery') {
    player.notices = result.lines;
    player.scene = { view: 'zone' };
    return {};
  }
  // #96: enterBattle resolves the opening's explicit adjudication.
  return enterBattle(player, result.battle, result.outcome, result.lines);
}

/** Talk to a zone NPC: opens the explicit topic-selection scene (#123).
 * Opening the menu is NAVIGATION — it never advances talk objectives,
 * never accepts or turns in a quest, and never mutates story state. Which
 * topic the player selects decides what happens (see npcAction). */
function talkAction(player: PlayerState, npcIndex: number): MutationResult {
  // Conversations wait for arrival (#159): no NPC contact mid-crossing.
  if (player.journey) {
    player.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
  }
  const currentZone = zoneDef(player.currentZone);
  const zoneNpc = currentZone?.npcs[npcIndex];
  if (!zoneNpc) return { toast: 'Nobody there.' };
  player.scene = { view: 'npc', npcId: zoneNpc.id };
  return {};
}

/** NPC topic-menu actions (#123). Every selection revalidates the live
 * scene context (view + NPC id), the NPC's physical presence in the
 * current zone, and the CURRENT quest/topic availability — stale, forged
 * or no-longer-valid topic callbacks are harmless refusals. #166: a live
 * crossing blocks every zone-bound interaction at this entry point too —
 * currentZone still reads the origin mid-crossing, so presence alone
 * cannot be the guard. Back stays open (navigation). */
export function npcAction(player: PlayerState, cb: Cb & { v: 'npc' }): MutationResult {
  if (player.journey && cb.a !== 'bk') {
    player.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
  }
  switch (cb.a) {
    case 'bk':
      // Leaving the scene invalidates its buttons (rev bump on commit).
      player.scene = { view: 'zone' };
      return {};
    case 'op': {
      if (!npcInZone(player.currentZone, cb.arg)) return { toast: 'Nobody there.' };
      player.scene = { view: 'npc', npcId: cb.arg };
      return {};
    }
    case 'q': {
      // Quest business must be selected from a live topic menu for an NPC
      // who is actually here.
      if (player.scene.view !== 'npc') {
        return { toast: 'That conversation has moved on — talk to the NPC again.' };
      }
      const npcId = player.scene.npcId;
      if (!npcInZone(player.currentZone, npcId)) return { toast: 'Nobody there.' };
      // #131: re-resolve the exact row (kind + id) from a FRESH resolution
      // by the ONE authoritative resolver — the same enumeration that
      // rendered the menu. A stale, forged or no-longer-available
      // selection is absent and refuses without mutation; the row carries
      // a dialogue ONLY when this NPC owns it, so quest business can never
      // open another NPC's conversation. #127: the dialogues' accept/
      // hand-over CHOICES invoke the central acceptQuest/turnInQuest
      // authorities as story effects, revalidated on-site by the engine.
      const row = npcTopics(player, npcId).find((topic) =>
        topic.kind !== 'lore' && topic.id === cb.arg
      );
      if (!row) return { toast: 'That business has moved on.' };
      if (row.dialogueId) {
        const dialogueDef = dialogue(row.dialogueId);
        if (!dialogueDef || dialogueDef.npcId !== npcId) {
          return { toast: 'That business has moved on.' };
        }
        enterDialogueNode(player, dialogueDef, dialogueDef.start);
        return {};
      }
      // No owned dialogue to open (active business at the non-owning
      // contact, or its event already fired): a pure progress reminder —
      // navigation only, never a story mutation.
      player.notices = [];
      player.scene = { view: 'npc', npcId: npcId, topic: { kind: 'quest', id: row.id } };
      return {};
    }
    case 'lore': {
      if (player.scene.view !== 'npc') {
        return { toast: 'That topic has moved on.' };
      }
      const npcId = player.scene.npcId;
      if (!npcInZone(player.currentZone, npcId)) return { toast: 'Nobody there.' };
      // #131: the fresh resolved row is the authority — its `when` was
      // just re-evaluated, so a condition that turned false after the menu
      // rendered (or a forged/condition-hidden id) refuses here.
      const row = npcTopics(player, npcId).find((topic) =>
        topic.kind === 'lore' && topic.id === cb.arg
      );
      if (!row) return { toast: 'That topic has moved on.' };
      // A dialogue-backed topic (#124) opens the conversation scene at its
      // start node; the static text renders the single-beat view.
      if (row.dialogueId) {
        const dialogueDef = dialogue(row.dialogueId);
        if (!dialogueDef || dialogueDef.npcId !== npcId) {
          return { toast: 'That topic has moved on.' };
        }
        player.scene = { view: 'dialogue', dialogueId: dialogueDef.id, nodeId: dialogueDef.start };
        return {};
      }
      const topic = npc(npcId)?.topics?.find((topicItem) => topicItem.id === cb.arg);
      if (!topic?.text) return { toast: 'That topic has moved on.' };
      player.scene = { view: 'npc', npcId: npcId, topic: { kind: 'lore', id: cb.arg } };
      return {};
    }
  }
}

export function zoneAction(player: PlayerState, cb: Cb & { v: 'zone' }): MutationResult {
  if (player.dungeonRun && !['hm', 'dg', 'dx', 'ch', 'inv', 'sk', 'q'].includes(cb.a)) {
    return { toast: DUNGEON_BLOCK };
  }
  switch (cb.a) {
    case 'hm':
      // Returning "home" from any panel preserves a live crossing (#159):
      // the journey intermission IS the player's current place.
      return go(player, { view: player.journey ? 'journey' : 'zone' });
    case 'ex':
      return exploreAction(player);
    case 'gp':
    case 'cp': {
      if (player.battle) return { toast: 'Finish the fight first.' };
      if (player.journey) return { toast: JOURNEY_BLOCK };
      if (cb.a === 'cp') {
        if (!recipesAt(player).length) return { toast: 'There is no workshop here.' };
        player.scene = { view: 'zone', panel: 'craft', page: cb.arg };
      } else player.scene = { view: 'zone', panel: 'gather' };
      return {};
    }
    case 'ga': {
      const action = cb.arg === 'fish_worm' || cb.arg === 'fish_grub' ? 'fish' : cb.arg;
      if (action !== 'forage' && action !== 'mine' && action !== 'fish') {
        return { toast: 'That gathering activity is unavailable.' };
      }
      const bait = cb.arg === 'fish_worm'
        ? 'm_worm_bait'
        : cb.arg === 'fish_grub'
        ? 'm_grub_bait'
        : undefined;
      const result = gather(player, action, undefined, undefined, bait);
      if (!result.ok) return { toast: result.lines[0] };
      player.notices = result.lines;
      player.scene = { view: 'zone', panel: 'gather' };
      return {};
    }
    case 'cr': {
      const result = craft(player, cb.arg);
      if (!result.ok) return { toast: result.lines[0] };
      player.notices = result.lines;
      player.scene = {
        view: 'zone',
        panel: 'craft',
        page: player.scene.view === 'zone' && player.scene.panel === 'craft'
          ? player.scene.page
          : 0,
      };
      return {};
    }
    case 'dg':
      return diveAction(player);
    case 'dx': {
      const result = abandonDungeon(player);
      if (!result.ok) return { toast: result.lines[0] };
      player.notices = result.lines;
      player.scene = { view: 'zone' };
      return {};
    }
    case 'dgb':
      // Explicit confirmation for an under-level boss dive (#73).
      return diveAction(player, true);
    case 'tv':
      // No second edge while a crossing is live (#159).
      if (player.journey) {
        player.scene = { view: 'journey' };
        return { toast: JOURNEY_BLOCK };
      }
      return go(player, { view: 'travel' });
    case 'ch':
      return go(player, { view: 'character' });
    case 'inv':
      return go(player, { view: 'inventory', page: 0 });
    case 'sk':
      return go(player, { view: 'skills' });
    case 'q':
      return go(player, { view: 'quests' });
    case 'sh': {
      // No second errand while a crossing is live (#159).
      if (player.journey) {
        player.scene = { view: 'journey' };
        return { toast: JOURNEY_BLOCK };
      }
      // Facility authority (#161): the button only opens the service the
      // current zone actually authors — a forged tap for an absent shop
      // (or a safe haven without one) is a non-mutating refusal.
      if (!shopAt(player)) return { toast: 'There is no shop here.' };
      return go(player, { view: 'shop', mode: 'buy', page: 0 });
    }
    case 'fg': {
      if (player.journey) {
        player.scene = { view: 'journey' };
        return { toast: JOURNEY_BLOCK };
      }
      if (!forgeAt(player)) return { toast: 'There is no forge here.' };
      return go(player, { view: 'forge' });
    }
    case 'tk':
      return talkAction(player, cb.arg);
  }
}

export function travelAction(player: PlayerState, cb: Cb & { v: 'travel' }): MutationResult {
  if (cb.a === 'bk') {
    player.scene = { view: 'zone' };
    return {};
  }
  // Hazardous departures demand an informed, explicit choice (#164): an
  // expedition-grade road stages a confirmation panel first; starter and
  // ordinary roads remain immediate and welcoming. #168: the staging ride
  // goes through the ONE departure authority — a closed road never even
  // stages a panel, and the same check startJourney applies decides here.
  const check = departureCheck(player, cb.arg);
  if (
    check.ok && check.plan.eventCount >= 3 &&
    (player.scene.view !== 'travel' || player.scene.confirmEdgeId !== cb.arg)
  ) {
    player.scene = { view: 'travel', confirmEdgeId: cb.arg };
    return {
      toast: `⚠️ ${
        check.plan.name ?? 'That road'
      } carries ${check.plan.eventCount} road events — confirm the departure.`,
    };
  }
  // The journey coordinator revalidates everything server-side (#159):
  // adjacency, unlocks, conditions, current state. The callback carries
  // only the stable edge id.
  const result = startJourney(player, cb.arg);
  if (!result.ok) return { toast: result.refusal };
  return applyJourneyStep(player, result.step);
}

/** Journey intermission controls (#159): Continue resolves the next
 * roll(s) — or the final arrival — through the ONE coordinator; Retreat
 * aborts back to the edge origin without rolling return events. */
export function journeyAction(player: PlayerState, cb: Cb & { v: 'journey' }): MutationResult {
  if (cb.a === 'go') {
    if (player.battle) {
      player.scene = { view: 'battle' };
      return { toast: 'Finish this fight first!' };
    }
    if (!player.journey) {
      player.scene = { view: 'zone' };
      return {};
    }
    return applyJourneyStep(player, advanceJourney(player));
  }
  // Retreat.
  if (player.battle) {
    player.scene = { view: 'battle' };
    return { toast: 'Finish this fight first!' };
  }
  if (!player.journey) return { toast: 'There is no crossing to abandon.' };
  player.notices = retreatFromJourney(player);
  player.scene = { view: 'zone' };
  return {};
}

export function shopAction(player: PlayerState, cb: Cb & { v: 'shop' }): MutationResult {
  if (cb.a === 'bk') {
    // Leaving is always allowed — a stale shop scene (content changed
    // under a save) must never trap the player.
    player.scene = { view: 'zone' };
    return {};
  }
  if (player.battle) return { toast: '⚔️ Finish the fight first.' };
  // No trade mid-crossing (#159): destination facilities stay closed
  // until arrival, origin counters wait for the road's end.
  if (player.journey) {
    player.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
  }
  // Server-side authority (#161): every trade action verifies the current
  // zone actually authors a shop — the renderer never grants access.
  if (!shopAt(player)) return { toast: 'There is no shop here.' };
  if (cb.a === 'view') {
    if (
      player.scene.view !== 'shop' || player.scene.mode === 'sell'
    ) {
      return { toast: 'Open the shop’s buying page to inspect its stock.' };
    }
    if (offeredPrice(player, cb.arg) === undefined) {
      return { toast: 'This item is no longer stocked here. Return to the shop.' };
    }
    // Keep the buy-list page while inspecting an item.
    player.scene = { view: 'shop', mode: 'buy', page: player.scene.page ?? 0, itemId: cb.arg };
    return {};
  }
  if (cb.a === 'p') {
    // Explicit mode switches: 0 is also the first SELL page, so it cannot
    // double as Switch to buying (#187). Nonnegative args paginate.
    if (cb.arg === -2) {
      player.scene = { view: 'shop', mode: 'buy', page: 0 };
      return {};
    }
    if (cb.arg === -1) {
      player.scene = { view: 'shop', mode: 'sell', page: 0 };
      return {};
    }
    if (player.scene.view === 'shop' && player.scene.mode === 'sell') {
      player.scene = { view: 'shop', mode: 'sell', page: cb.arg };
    } else player.scene = { view: 'shop', mode: 'buy', page: cb.arg };
    return {};
  }
  if (cb.a === 'buy') {
    const result = buy(player, cb.arg, 1);
    if (!result.ok) return { toast: result.lines[0] };
    // Success lines — the purchase confirmation plus any quest-ready
    // callout from grantItem — surface on the redrawn shop screen (#30)
    // instead of a silent redraw.
    player.notices = result.lines;
    return {};
  }
  // sell
  const result = sell(player, cb.arg, 1);
  if (!result.ok) return { toast: result.lines[0] };
  player.notices = result.lines;
  return {};
}

export function forgeAction(player: PlayerState, cb: Cb & { v: 'forge' }): MutationResult {
  if (cb.a === 'bk') {
    player.scene = { view: 'zone' };
    return {};
  }
  // No forge work mid-crossing (#159).
  if (player.journey) {
    player.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
  }
  // Facility authority (#161): a forged tap where no forge stands is a
  // non-mutating refusal; the engine revalidates capability itself.
  if (!forgeAt(player)) return { toast: 'There is no forge here.' };
  const result = temper(player, cb.a === 'w' ? 'weapon' : 'armor');
  player.notices = result.lines;
  return { toast: result.ok ? undefined : result.lines[0] };
}

export function questsAction(player: PlayerState, cb: Cb & { v: 'quests' }): MutationResult {
  // The Quest Log is a read-only journal (#65): the codec cannot even express
  // lifecycle actions for this view, so every case here is pure navigation.
  switch (cb.a) {
    case 'p': {
      // Side-quest page switch (#21); the detail selector stays clear.
      player.scene = { view: 'quests', page: cb.arg };
      return {};
    }
    case 'bk': {
      // Back to the log on the SAME page the detail was opened from (#21).
      player.scene = {
        view: 'quests',
        page: player.scene.view === 'quests' ? player.scene.page : undefined,
      };
      return {};
    }
    case 'open':
    case 'q': {
      player.scene = {
        view: 'quests',
        questId: cb.arg,
        page: player.scene.view === 'quests' ? player.scene.page : undefined,
      };
      return {};
    }
  }
}

/** Enters a dialogue node, applying its authored effects ONCE (#127) —
 * the transition INTO a node, never a rerender. Conversation-driven quest
 * progress emits its story event here, through the central story layer
 * (atomic, idempotent, #119 readiness). */
function enterDialogueNode(player: PlayerState, dialogueDef: DialogueDef, nodeId: string): void {
  const node = dialogueNode(dialogueDef, nodeId);
  if (node?.kind === 'line' && node.effects?.length) {
    const result = applyStoryEffects(player, node.effects, {
      dialogueId: dialogueDef.id,
      nodeId: node.id,
      npcId: dialogueDef.npcId,
      now: Date.now(),
    });
    player.notices = [...player.notices, ...storyNoticeLines(result)];
  }
  player.scene = { view: 'dialogue', dialogueId: dialogueDef.id, nodeId: nodeId };
}

/** Dialogue scene actions (#124/#126/#127/#130): multi-node conversations
 * and branching choices. This handler owns only TRANSPORT-level and
 * NAVIGATION checks — the live scene view, the dialogue/node the callback
 * was rendered from, and confirmation STAGING (a scene mutation, never
 * story state). The STORY-level authority for applying a choice — scene,
 * dialogue ownership, on-site NPC presence, availability, staged
 * confirmation and the transaction itself — lives entirely in the central
 * engine operation `applyDialogueChoice` (#130); this layer passes it only
 * the tapped choice id, exactly as the wire carries it. The two choice
 * actions are distinct wire intents (#136): `ch` selects a response
 * (staging the panel for an irreversible one), while `cf` confirms — and
 * `cf` is validated here to target an irreversible choice from its exact
 * staged panel before the central op is consulted, so a forged or
 * mismatched `cf` is a harmless refusal. */
export function dialogueAction(player: PlayerState, cb: Cb & { v: 'dlg' }): MutationResult {
  // #166: a live crossing owns the interaction flow — the mutating
  // dialogue controls refuse here as well; Back and confirmation
  // cancellation stay open (navigation only).
  if (player.journey && cb.a !== 'bk' && cb.a !== 'cc') {
    player.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
  }
  const dialogueDef = player.scene.view === 'dialogue'
    ? dialogue(player.scene.dialogueId)
    : undefined;
  if (cb.a === 'bk') {
    // Back/End/Not-now returns to the owning NPC's topic menu when they
    // are still on-site; otherwise the zone. No story mutation.
    player.scene = dialogueDef && npcInZone(player.currentZone, dialogueDef.npcId)
      ? { view: 'npc', npcId: dialogueDef.npcId }
      : { view: 'zone' };
    return {};
  }
  if (cb.a === 'cc') {
    // Abandon the staged confirmation — back to the choice list, no
    // mutation (the choice remains available).
    if (player.scene.view === 'dialogue') delete player.scene.confirmation;
    return {};
  }
  if (!dialogueDef || player.scene.view !== 'dialogue') {
    return { toast: 'That conversation has moved on.' };
  }
  // Presence gates Continue too: advancing a line node can apply its
  // authored line-entry effects (#127), a story mutation outside the
  // choice authority (#130).
  if (!npcInZone(player.currentZone, dialogueDef.npcId)) return { toast: 'Nobody there.' };
  const node = dialogueNode(dialogueDef, player.scene.nodeId);
  if (cb.a === 'nx') {
    if (!node || node.kind !== 'line' || node.next !== cb.arg) {
      return { toast: 'That conversation has moved on.' };
    }
    enterDialogueNode(player, dialogueDef, cb.arg);
    return {};
  }
  // 'ch' (tap a response) and 'cf' (tap Confirm on a staged panel) are
  // DISTINCT wire intents (#136), validated here at the transport boundary
  // before the central authority is consulted:
  //  - 'ch' applies an ordinary choice, but only STAGES the confirmation
  //    panel for an irreversible one;
  //  - 'cf' applies an irreversible choice, and only from its own exact
  //    staged panel — a forged or mismatched 'cf' is a non-mutating refusal.
  // (Every other dlg action returned above, so cb.a is 'ch' | 'cf' here.)
  if (!node || node.kind !== 'choice') {
    return { toast: 'That conversation has moved on.' };
  }
  const choice = node.choices.find((choice) => choice.id === cb.arg);
  if (!choice) return { toast: 'That response is not on the table.' };
  if (cb.a === 'cf') {
    // Confirm is valid only from the matching confirmation panel (#136):
    // an irreversible choice whose exact staging is live. Anything else —
    // an ordinary choice, no panel staged, or a panel staged for a
    // DIFFERENT choice — is a refusal that mutates nothing.
    if (!choice.irreversible || player.scene.confirmation !== choice.id) {
      return { toast: 'That conversation has moved on.' };
    }
    return applyChoice(player, dialogueDef, choice.id);
  }
  if (choice.irreversible) {
    // Stage the confirmation — nothing is mutated merely by opening it.
    // (Availability of a not-yet-available response is re-refused here so
    // the panel cannot be staged for a response the player cannot take;
    // the engine re-evaluates it again at application.)
    if (choice.when && !evalCondition(player, choice.when)) {
      return { toast: 'That response is no longer available.' };
    }
    player.scene = {
      view: 'dialogue',
      dialogueId: dialogueDef.id,
      nodeId: node.id,
      confirmation: choice.id,
    };
    return {};
  }
  return applyChoice(player, dialogueDef, choice.id);
}

/** Applies a choice through the ONE central engine operation (#126/#130) —
 * which revalidates the live scene, dialogue ownership, on-site presence,
 * availability and confirmation staging itself — and routes the scene to
 * the next beat (or back to the topic menu when the conversation ends).
 * Notice lines flow through the normal banner. */
function applyChoice(
  player: PlayerState,
  dialogueDef: DialogueDef,
  choiceId: string,
): MutationResult {
  const result = applyDialogueChoice(player, { choiceId, now: Date.now() });
  if (!result.ok) return { toast: result.refusal };
  player.notices = [...player.notices, ...result.lines];
  if (result.nextNodeId) {
    // The transition into the next beat may itself carry effects (#127).
    enterDialogueNode(player, dialogueDef, result.nextNodeId);
  } else {
    // The conversation concluded on this choice — back to the topics.
    player.scene = npcInZone(player.currentZone, dialogueDef.npcId)
      ? { view: 'npc', npcId: dialogueDef.npcId }
      : { view: 'zone' };
  }
  return {};
}

export function deathAction(player: PlayerState): MutationResult {
  const line = applyDeath(player);
  player.battle = undefined;
  // Defeat always ends the crossing (#159): the journey clears and the
  // player wakes wherever the death flow left them.
  player.journey = undefined;
  player.notices = [line, "You gather yourself. Roads end; dawns don't."];
  player.scene = { view: 'zone' };
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
  const classId = CLASS_IDS.find((id) => id === cb.arg);
  if (!classId) return undefined;
  const fresh = createPlayer(userId, name, classId);
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
  player: PlayerState,
  cb: Extract<Cb, { v: 'meta'; a: 'help' | 'reset' | 'resetNo' }>,
): PlayerState {
  switch (cb.a) {
    case 'help':
      player.scene = { view: 'help' };
      return player;
    case 'reset':
      // Stage the confirmation — nothing is destroyed here (#19).
      player.scene = { view: 'reset' };
      return player;
    case 'resetNo':
      // Cancel: resume whatever was live — a pending fight stays a fight,
      // a pending crossing stays a crossing.
      player.scene = player.battle
        ? { view: player.battle.phase === 'lost' ? 'death' : 'battle' }
        : player.journey
        ? { view: 'journey' }
        : { view: 'zone' };
      return player;
  }
}
