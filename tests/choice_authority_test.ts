/** Central choice authority (#130): `applyDialogueChoice` derives the
 * dialogue, node and acting NPC from the PLAYER'S LIVE SCENE and the
 * dialogue definition — never from caller assertions. Wrong-scene,
 * wrong-dialogue, wrong-node, wrong-choice, wrong-zone, forged-context,
 * stale-condition and unstaged/mismatched-confirmation calls are
 * non-mutating refusals; the correctly staged irreversible choice applies
 * exactly once and its identical retry is a complete no-op (#129).
 * Callback revision / message staleness remains TRANSPORT-level authority
 * in the locked router — covered by the full-route test in choice_test.ts. */

import { assert, assertEquals } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { syncAvailability } from '../src/engine/quests.ts';
import { applyDialogueChoice } from '../src/engine/story.ts';
import type { PlayerState } from '../src/engine/types.ts';
import { ferryHero } from './helpers_story.ts';

const DIALOGUE = 'dlg_ferry_promise';
const CHOICE_NODE = 'n3';

/** The live scene: inside the Ferryman's promise dialogue, on its choice
 * node, optionally with a staged confirmation panel. */
function atChoice(player: PlayerState, staged?: string): void {
  player.scene = { view: 'dialogue', arg: DIALOGUE, arg2: CHOICE_NODE, arg3: staged };
}

/** The story state a refused call must never touch. */
function storySnapshot(player: PlayerState): string {
  return JSON.stringify({
    d: player.decisions,
    f: player.flags,
    e: player.storyEvents,
    r: player.storyReceipts,
    q: player.quests,
    o: player.questOutcomes,
  });
}

function assertRefused(player: PlayerState, choiceId: string): void {
  const before = storySnapshot(player);
  const result = applyDialogueChoice(player, { choiceId, now: 1 });
  assert(!result.ok);
  assertEquals(storySnapshot(player), before, 'a refusal mutates nothing — not even a receipt');
}

Deno.test('authority: no active dialogue scene refuses, even with the exact choice id', () => {
  const player = ferryHero(1600);
  // The #130 bypass shape: ordinary zone view, no dialogue open.
  player.scene = { view: 'zone' };
  assertRefused(player, 'promise');
  player.scene = { view: 'npc', arg: 'npc_ferryman' };
  assertRefused(player, 'promise');
  assertEquals(player.decisions['ferry_shrine_pledge'], undefined);
});

Deno.test('authority: wrong dialogue, wrong node, wrong choice all refuse', () => {
  const player = ferryHero(1601);
  // A different dialogue's scene cannot reach this dialogue's choices.
  player.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n1' };
  assertRefused(player, 'promise');
  // The right dialogue but a LINE node, not the choice node.
  player.scene = { view: 'dialogue', arg: DIALOGUE, arg2: 'n1' };
  assertRefused(player, 'promise');
  // The right choice node but a choice id it does not offer.
  atChoice(player);
  assertRefused(player, 'nope');
});

Deno.test('authority: correct dialogue in the wrong zone refuses — presence is enforced', () => {
  // The #130 bypass: the scene claims the Ferryman's dialogue while the
  // player stands in Emberdawn Village, where he is not present.
  const player = createPlayer(1602, 'T', 'warrior');
  syncAvailability(player);
  assertEquals(player.currentZone, 'emberdawn');
  atChoice(player, 'confirm:promise');
  assertRefused(player, 'promise');
  assertEquals(player.decisions['ferry_shrine_pledge'], undefined, 'no permanent record');
});

Deno.test('authority: the acting NPC comes from the dialogue definition, not the caller', () => {
  const player = ferryHero(1603);
  atChoice(player, 'confirm:promise');
  const result = applyDialogueChoice(player, { choiceId: 'promise', now: 1 });
  assert(result.ok);
  // Provenance names the dialogue's OWN npc/dialogue/node — the API accepts
  // no npcId, dialogueId or nodeId a caller could forge.
  assertEquals(player.decisions['ferry_shrine_pledge'], {
    choiceId: 'promise',
    dialogueId: DIALOGUE,
    nodeId: CHOICE_NODE,
    chosenAt: 1,
  });
});

Deno.test('authority: an irreversible choice refuses before its confirmation is staged', () => {
  const player = ferryHero(1604);
  atChoice(player); // on the choice list, no panel staged
  const before = storySnapshot(player);
  const result = applyDialogueChoice(player, { choiceId: 'promise', now: 1 });
  assert(!result.ok);
  assert(
    result.refusal?.includes('Confirm'),
    `points at the confirmation screen: ${result.refusal}`,
  );
  assertEquals(storySnapshot(player), before, 'an unstaged call mutates nothing');
  assertEquals(player.decisions['ferry_shrine_pledge'], undefined);
  assertEquals(player.storyReceipts, [], 'no receipt without a commit');
});

Deno.test('authority: a confirmation staged for a DIFFERENT choice does not authorize', () => {
  const player = ferryHero(1605);
  atChoice(player, 'confirm:vouch'); // staged for another response
  assertRefused(player, 'promise');
});

Deno.test('authority: an ordinary choice refuses while a confirmation is staged', () => {
  // Every committing pledge response is irreversible now; the ordinary
  // path lives on m1_embers' standard offer accept. A FORGED staging for
  // an ordinary choice (the handler never stages one) makes the central
  // op treat the staged panel — not the list — as the live sub-state.
  const player = createPlayer(1606, 'T', 'warrior');
  syncAvailability(player);
  player.scene = {
    view: 'dialogue',
    arg: 'dlg_m1_embers_offer',
    arg2: 'oa',
    arg3: 'confirm:accept',
  };
  const result = applyDialogueChoice(player, { choiceId: 'accept', now: 1 });
  assert(!result.ok, 'the staged panel is the live sub-state, not the list');
  assertEquals(player.decisions['ferry_shrine_pledge'], undefined);
  assertEquals(player.storyReceipts, []);
  assertEquals(player.quests['m1_embers']?.status, 'available', 'nothing was accepted');
});

Deno.test('authority: a condition that turned false after render refuses at apply time', () => {
  const player = ferryHero(1607);
  // 'vouch' requires m6_toxin done — rendered earlier, no longer true now.
  // The panel stages (rendering was never authority) but the central op
  // re-evaluates the condition and refuses before any mutation.
  atChoice(player, 'confirm:vouch');
  assertRefused(player, 'vouch');
  assertEquals(player.decisions['ferry_shrine_pledge'], undefined);
});

Deno.test('authority: correct scene, owner, presence and staged panel apply exactly once', () => {
  const player = ferryHero(1608);
  atChoice(player, 'confirm:promise');
  const result = applyDialogueChoice(player, { choiceId: 'promise', now: 1 });
  assert(result.ok);
  assertEquals(result.decided, 'ferry_shrine_pledge');
  assertEquals(result.nextNodeId, 'n4');
  assertEquals(player.decisions['ferry_shrine_pledge']?.choiceId, 'promise');
  assertEquals(player.storyEvents, ['shrine_allegiance_chosen']);
  // The shared parent (#147): the event advanced the already-active parent
  // objective. The route consequence (#132): the chosen route starts
  // (carrying only its own route objective), the incompatible route locks
  // permanently.
  assertEquals(player.quests['sq_shrine_pledge']?.status, 'turnIn');
  assertEquals(player.quests['sq_shrine_pledge']?.counts, [1]);
  assertEquals(player.quests['sq_shrine_pact']?.status, 'active');
  assertEquals(player.quests['sq_shrine_pact']?.counts, [0]);
  assertEquals(player.questOutcomes['sq_ledger_debt']?.kind, 'locked');
  assertEquals(player.storyReceipts, [`choice:${DIALOGUE}:${CHOICE_NODE}:promise`]);
});

Deno.test('authority: an identical retry is a complete no-op (#129 receipts)', () => {
  const player = ferryHero(1609);
  atChoice(player, 'confirm:promise');
  const r1 = applyDialogueChoice(player, { choiceId: 'promise', now: 1 });
  assert(r1.ok);
  const before = JSON.stringify(player);
  const r2 = applyDialogueChoice(player, { choiceId: 'promise', now: 2 });
  assert(r2.ok, 'the retry is accepted…');
  assertEquals(r2.nextNodeId, 'n4', '…routes to the authored next beat…');
  assertEquals(r2.lines, [], '…but carries no notices…');
  assertEquals(JSON.stringify(player), before, '…and mutates nothing at all');
});
