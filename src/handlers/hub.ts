/**
 * Hub actions: zone exploration, travel, shop, forge, quests, NPCs, meta.
 * Each handler mutates PlayerState only — I/O lives in session.ts.
 */

import type { PlayerState } from '../engine/types.ts';
import type { Cb } from '../codec.ts';
import { bossGateBlock, diveDungeon, dungeonOf, explore, nextDiveIsBoss } from '../engine/world.ts';
import { advanceJourney, retreatFromJourney, startJourney } from '../engine/journey.ts';
import { zone as zoneDef } from '../content/zones.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { buy, sell, shopAt } from '../engine/shops.ts';
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
  // No exploring mid-crossing (#159): the player is on the road, not in
  // the wilds — and the destination's wilds are not theirs yet.
  if (p.journey) {
    p.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
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
  if (p.journey) {
    p.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
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
  // Conversations wait for arrival (#159): no NPC contact mid-crossing.
  if (p.journey) {
    p.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
  }
  const z = zoneDef(p.currentZone);
  const npc = z?.npcs[npcIndex];
  if (!npc) return { toast: 'Nobody there.' };
  p.scene = { view: 'npc', arg: npc.id };
  return {};
}

/** NPC topic-menu actions (#123). Every selection revalidates the live
 * scene context (view + NPC id), the NPC's physical presence in the
 * current zone, and the CURRENT quest/topic availability — stale, forged
 * or no-longer-valid topic callbacks are harmless refusals. #166: a live
 * crossing blocks every zone-bound interaction at this entry point too —
 * currentZone still reads the origin mid-crossing, so presence alone
 * cannot be the guard. Back stays open (navigation). */
export function npcAction(p: PlayerState, cb: Cb & { v: 'npc' }): MutationResult {
  if (p.journey && cb.a !== 'bk') {
    p.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
  }
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
      // #131: re-resolve the exact row (kind + id) from a FRESH resolution
      // by the ONE authoritative resolver — the same enumeration that
      // rendered the menu. A stale, forged or no-longer-available
      // selection is absent and refuses without mutation; the row carries
      // a dialogue ONLY when this NPC owns it, so quest business can never
      // open another NPC's conversation. #127: the dialogues' accept/
      // hand-over CHOICES invoke the central acceptQuest/turnInQuest
      // authorities as story effects, revalidated on-site by the engine.
      const row = npcTopics(p, npcId).find((t) => t.kind !== 'lore' && t.id === cb.arg);
      if (!row) return { toast: 'That business has moved on.' };
      if (row.dialogueId) {
        const d = dialogue(row.dialogueId);
        if (!d || d.npcId !== npcId) return { toast: 'That business has moved on.' };
        enterDialogueNode(p, d, d.start);
        return {};
      }
      // No owned dialogue to open (active business at the non-owning
      // contact, or its event already fired): a pure progress reminder —
      // navigation only, never a story mutation.
      p.notices = [];
      p.scene = { view: 'npc', arg: npcId, arg2: `q:${row.questId}` };
      return {};
    }
    case 'lore': {
      if (p.scene.view !== 'npc' || !p.scene.arg) {
        return { toast: 'That topic has moved on.' };
      }
      const npcId = p.scene.arg;
      if (!npcInZone(p.currentZone, npcId)) return { toast: 'Nobody there.' };
      // #131: the fresh resolved row is the authority — its `when` was
      // just re-evaluated, so a condition that turned false after the menu
      // rendered (or a forged/condition-hidden id) refuses here.
      const row = npcTopics(p, npcId).find((t) => t.kind === 'lore' && t.id === cb.arg);
      if (!row) return { toast: 'That topic has moved on.' };
      // A dialogue-backed topic (#124) opens the conversation scene at its
      // start node; the static text renders the single-beat view.
      if (row.dialogueId) {
        const d = dialogue(row.dialogueId);
        if (!d || d.npcId !== npcId) return { toast: 'That topic has moved on.' };
        p.scene = { view: 'dialogue', arg: d.id, arg2: d.start };
        return {};
      }
      const topic = npc(npcId)?.topics?.find((t) => t.id === cb.arg);
      if (!topic?.text) return { toast: 'That topic has moved on.' };
      p.scene = { view: 'npc', arg: npcId, arg2: `lore:${cb.arg}` };
      return {};
    }
  }
}

export function zoneAction(p: PlayerState, cb: Cb & { v: 'zone' }): MutationResult {
  switch (cb.a) {
    case 'hm':
      // Returning "home" from any panel preserves a live crossing (#159):
      // the journey intermission IS the player's current place.
      return go(p, p.journey ? 'journey' : 'zone');
    case 'ex':
      return exploreAction(p);
    case 'dg':
      return diveAction(p);
    case 'dgb':
      // Explicit confirmation for an under-level boss dive (#73).
      return diveAction(p, true);
    case 'tv':
      // No second edge while a crossing is live (#159).
      if (p.journey) {
        p.scene = { view: 'journey' };
        return { toast: JOURNEY_BLOCK };
      }
      return go(p, 'travel');
    case 'ch':
      return go(p, 'character');
    case 'inv':
      return go(p, 'inventory', '0');
    case 'sk':
      return go(p, 'skills');
    case 'q':
      return go(p, 'quests');
    case 'sh': {
      // No second errand while a crossing is live (#159).
      if (p.journey) {
        p.scene = { view: 'journey' };
        return { toast: JOURNEY_BLOCK };
      }
      // Facility authority (#161): the button only opens the service the
      // current zone actually authors — a forged tap for an absent shop
      // (or a safe haven without one) is a non-mutating refusal.
      if (!shopAt(p)) return { toast: 'There is no shop here.' };
      return go(p, 'shop', '0');
    }
    case 'fg': {
      if (p.journey) {
        p.scene = { view: 'journey' };
        return { toast: JOURNEY_BLOCK };
      }
      if (!forgeAt(p)) return { toast: 'There is no forge here.' };
      return go(p, 'forge');
    }
    case 'tk':
      return talkAction(p, cb.arg);
  }
}

export function travelAction(p: PlayerState, cb: Cb & { v: 'travel' }): MutationResult {
  if (cb.a === 'bk') {
    p.scene = { view: 'zone' };
    return {};
  }
  // Hazardous departures demand an informed, explicit choice (#164): an
  // expedition-grade road stages a confirmation panel first; starter and
  // ordinary roads remain immediate and welcoming. #168: the staging ride
  // goes through the ONE departure authority — a closed road never even
  // stages a panel, and the same check startJourney applies decides here.
  const check = departureCheck(p, cb.arg);
  if (
    check.ok && check.plan.eventCount >= 3 && p.scene.arg !== `go:${cb.arg}`
  ) {
    p.scene = { view: 'travel', arg: `go:${cb.arg}` };
    return {
      toast: `⚠️ ${
        check.plan.name ?? 'That road'
      } carries ${check.plan.eventCount} road events — confirm the departure.`,
    };
  }
  // The journey coordinator revalidates everything server-side (#159):
  // adjacency, unlocks, conditions, current state. The callback carries
  // only the stable edge id.
  const res = startJourney(p, cb.arg);
  if (!res.ok) return { toast: res.refusal };
  return applyJourneyStep(p, res.step);
}

/** Journey intermission controls (#159): Continue resolves the next
 * roll(s) — or the final arrival — through the ONE coordinator; Retreat
 * aborts back to the edge origin without rolling return events. */
export function journeyAction(p: PlayerState, cb: Cb & { v: 'journey' }): MutationResult {
  if (cb.a === 'go') {
    if (p.battle) {
      p.scene = { view: 'battle' };
      return { toast: 'Finish this fight first!' };
    }
    if (!p.journey) {
      p.scene = { view: 'zone' };
      return {};
    }
    return applyJourneyStep(p, advanceJourney(p));
  }
  // Retreat.
  if (p.battle) {
    p.scene = { view: 'battle' };
    return { toast: 'Finish this fight first!' };
  }
  if (!p.journey) return { toast: 'There is no crossing to abandon.' };
  p.notices = retreatFromJourney(p);
  p.scene = { view: 'zone' };
  return {};
}

export function shopAction(p: PlayerState, cb: Cb & { v: 'shop' }): MutationResult {
  if (cb.a === 'bk') {
    // Leaving is always allowed — a stale shop scene (content changed
    // under a save) must never trap the player.
    p.scene = { view: 'zone' };
    return {};
  }
  // No trade mid-crossing (#159): destination facilities stay closed
  // until arrival, origin counters wait for the road's end.
  if (p.journey) {
    p.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
  }
  // Server-side authority (#161): every trade action verifies the current
  // zone actually authors a shop — the renderer never grants access.
  if (!shopAt(p)) return { toast: 'There is no shop here.' };
  if (cb.a === 'p') {
    // -1 switches to sell mode (selling happens only at a shop's counter)
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
  // No forge work mid-crossing (#159).
  if (p.journey) {
    p.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
  }
  // Facility authority (#161): a forged tap where no forge stands is a
  // non-mutating refusal; the engine revalidates capability itself.
  if (!forgeAt(p)) return { toast: 'There is no forge here.' };
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

/** Enters a dialogue node, applying its authored effects ONCE (#127) —
 * the transition INTO a node, never a rerender. Conversation-driven quest
 * progress emits its story event here, through the central story layer
 * (atomic, idempotent, #119 readiness). */
function enterDialogueNode(p: PlayerState, d: DialogueDef, nodeId: string): void {
  const node = dialogueNode(d, nodeId);
  if (node?.kind === 'line' && node.effects?.length) {
    const result = applyStoryEffects(p, node.effects, {
      dialogueId: d.id,
      nodeId: node.id,
      npcId: d.npcId,
      now: Date.now(),
    });
    p.notices = [...p.notices, ...storyNoticeLines(result)];
  }
  p.scene = { view: 'dialogue', arg: d.id, arg2: nodeId };
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
export function dialogueAction(p: PlayerState, cb: Cb & { v: 'dlg' }): MutationResult {
  // #166: a live crossing owns the interaction flow — the mutating
  // dialogue controls refuse here as well; Back and confirmation
  // cancellation stay open (navigation only).
  if (p.journey && cb.a !== 'bk' && cb.a !== 'cc') {
    p.scene = { view: 'journey' };
    return { toast: JOURNEY_BLOCK };
  }
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
  // Presence gates Continue too: advancing a line node can apply its
  // authored line-entry effects (#127), a story mutation outside the
  // choice authority (#130).
  if (!npcInZone(p.currentZone, d.npcId)) return { toast: 'Nobody there.' };
  const node = dialogueNode(d, p.scene.arg2 ?? '');
  if (cb.a === 'nx') {
    if (!node || node.kind !== 'line' || node.next !== cb.arg) {
      return { toast: 'That conversation has moved on.' };
    }
    enterDialogueNode(p, d, cb.arg);
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
  const choice = node.choices.find((c) => c.id === cb.arg);
  if (!choice) return { toast: 'That response is not on the table.' };
  if (cb.a === 'cf') {
    // Confirm is valid only from the matching confirmation panel (#136):
    // an irreversible choice whose exact staging is live. Anything else —
    // an ordinary choice, no panel staged, or a panel staged for a
    // DIFFERENT choice — is a refusal that mutates nothing.
    if (!choice.irreversible || p.scene.arg3 !== `confirm:${choice.id}`) {
      return { toast: 'That conversation has moved on.' };
    }
    return applyChoice(p, d, choice.id);
  }
  if (choice.irreversible) {
    // Stage the confirmation — nothing is mutated merely by opening it.
    // (Availability of a not-yet-available response is re-refused here so
    // the panel cannot be staged for a response the player cannot take;
    // the engine re-evaluates it again at application.)
    if (choice.when && !evalCondition(p, choice.when)) {
      return { toast: 'That response is no longer available.' };
    }
    p.scene = { view: 'dialogue', arg: d.id, arg2: node.id, arg3: `confirm:${choice.id}` };
    return {};
  }
  return applyChoice(p, d, choice.id);
}

/** Applies a choice through the ONE central engine operation (#126/#130) —
 * which revalidates the live scene, dialogue ownership, on-site presence,
 * availability and confirmation staging itself — and routes the scene to
 * the next beat (or back to the topic menu when the conversation ends).
 * Notice lines flow through the normal banner. */
function applyChoice(
  p: PlayerState,
  d: DialogueDef,
  choiceId: string,
): MutationResult {
  const result = applyDialogueChoice(p, { choiceId, now: Date.now() });
  if (!result.ok) return { toast: result.refusal };
  p.notices = [...p.notices, ...result.lines];
  if (result.nextNodeId) {
    // The transition into the next beat may itself carry effects (#127).
    enterDialogueNode(p, d, result.nextNodeId);
  } else {
    // The conversation concluded on this choice — back to the topics.
    p.scene = npcInZone(p.currentZone, d.npcId) ? { view: 'npc', arg: d.npcId } : { view: 'zone' };
  }
  return {};
}

export function deathAction(p: PlayerState): MutationResult {
  const line = applyDeath(p);
  p.battle = undefined;
  // Defeat always ends the crossing (#159): the journey clears and the
  // player wakes wherever the death flow left them.
  p.journey = undefined;
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
      // Cancel: resume whatever was live — a pending fight stays a fight,
      // a pending crossing stays a crossing.
      p.scene = p.battle
        ? { view: p.battle.phase === 'lost' ? 'death' : 'battle' }
        : p.journey
        ? { view: 'journey' }
        : { view: 'zone' };
      return p;
  }
}
