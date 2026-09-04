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

const DIALOGUE = 'dlg_ferry_promise';
const CHOICE_NODE = 'n3';

/** A hero standing at the Ferryman's dock in Hollowmere. */
function ferryHero(id: number): PlayerState {
  const p = createPlayer(id, 'T', 'warrior');
  syncAvailability(p);
  p.currentZone = 'hollowmere';
  p.unlockedZones.push('hollowmere');
  p.flags['zone_hollowmere'] = true;
  return p;
}

/** The live scene: inside the Ferryman's promise dialogue, on its choice
 * node, optionally with a staged confirmation panel. */
function atChoice(p: PlayerState, staged?: string): void {
  p.scene = { view: 'dialogue', arg: DIALOGUE, arg2: CHOICE_NODE, arg3: staged };
}

/** The story state a refused call must never touch. */
function storySnapshot(p: PlayerState): string {
  return JSON.stringify({
    d: p.decisions,
    f: p.flags,
    e: p.storyEvents,
    r: p.storyReceipts,
    q: p.quests,
    o: p.questOutcomes,
  });
}

function assertRefused(p: PlayerState, choiceId: string): void {
  const before = storySnapshot(p);
  const r = applyDialogueChoice(p, { choiceId, now: 1 });
  assertEquals(r.ok, false);
  assertEquals(storySnapshot(p), before, 'a refusal mutates nothing — not even a receipt');
}

Deno.test('authority: no active dialogue scene refuses, even with the exact choice id', () => {
  const p = ferryHero(1600);
  // The #130 bypass shape: ordinary zone view, no dialogue open.
  p.scene = { view: 'zone' };
  assertRefused(p, 'promise');
  p.scene = { view: 'npc', arg: 'npc_ferryman' };
  assertRefused(p, 'promise');
  assertEquals(p.decisions['ferry_shrine_pledge'], undefined);
});

Deno.test('authority: wrong dialogue, wrong node, wrong choice all refuse', () => {
  const p = ferryHero(1601);
  // A different dialogue's scene cannot reach this dialogue's choices.
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n1' };
  assertRefused(p, 'promise');
  // The right dialogue but a LINE node, not the choice node.
  p.scene = { view: 'dialogue', arg: DIALOGUE, arg2: 'n1' };
  assertRefused(p, 'promise');
  // The right choice node but a choice id it does not offer.
  atChoice(p);
  assertRefused(p, 'nope');
});

Deno.test('authority: correct dialogue in the wrong zone refuses — presence is enforced', () => {
  // The #130 bypass: the scene claims the Ferryman's dialogue while the
  // player stands in Emberdawn Village, where he is not present.
  const p = createPlayer(1602, 'T', 'warrior');
  syncAvailability(p);
  assertEquals(p.currentZone, 'emberdawn');
  atChoice(p, 'confirm:promise');
  assertRefused(p, 'promise');
  assertEquals(p.decisions['ferry_shrine_pledge'], undefined, 'no permanent record');
});

Deno.test('authority: the acting NPC comes from the dialogue definition, not the caller', () => {
  const p = ferryHero(1603);
  atChoice(p, 'confirm:promise');
  const r = applyDialogueChoice(p, { choiceId: 'promise', now: 1 });
  assert(r.ok);
  // Provenance names the dialogue's OWN npc/dialogue/node — the API accepts
  // no npcId, dialogueId or nodeId a caller could forge.
  assertEquals(p.decisions['ferry_shrine_pledge'], {
    choiceId: 'promise',
    dialogueId: DIALOGUE,
    nodeId: CHOICE_NODE,
    chosenAt: 1,
  });
});

Deno.test('authority: an irreversible choice refuses before its confirmation is staged', () => {
  const p = ferryHero(1604);
  atChoice(p); // on the choice list, no panel staged
  const before = storySnapshot(p);
  const r = applyDialogueChoice(p, { choiceId: 'promise', now: 1 });
  assertEquals(r.ok, false);
  assert(r.refusal?.includes('Confirm'), `points at the confirmation screen: ${r.refusal}`);
  assertEquals(storySnapshot(p), before, 'an unstaged call mutates nothing');
  assertEquals(p.decisions['ferry_shrine_pledge'], undefined);
  assertEquals(p.storyReceipts, [], 'no receipt without a commit');
});

Deno.test('authority: a confirmation staged for a DIFFERENT choice does not authorize', () => {
  const p = ferryHero(1605);
  atChoice(p, 'confirm:vouch'); // staged for another response
  assertRefused(p, 'promise');
});

Deno.test('authority: an ordinary choice refuses while a confirmation is staged', () => {
  // Every committing pledge response is irreversible now; the ordinary
  // path lives on m1_embers' standard offer accept. A FORGED staging for
  // an ordinary choice (the handler never stages one) makes the central
  // op treat the staged panel — not the list — as the live sub-state.
  const p = createPlayer(1606, 'T', 'warrior');
  syncAvailability(p);
  p.scene = { view: 'dialogue', arg: 'dlg_m1_embers_offer', arg2: 'oa', arg3: 'confirm:accept' };
  const r = applyDialogueChoice(p, { choiceId: 'accept', now: 1 });
  assertEquals(r.ok, false, 'the staged panel is the live sub-state, not the list');
  assertEquals(p.decisions['ferry_shrine_pledge'], undefined);
  assertEquals(p.storyReceipts, []);
  assertEquals(p.quests['m1_embers']?.status, 'available', 'nothing was accepted');
});

Deno.test('authority: a condition that turned false after render refuses at apply time', () => {
  const p = ferryHero(1607);
  // 'vouch' requires m6_toxin done — rendered earlier, no longer true now.
  // The panel stages (rendering was never authority) but the central op
  // re-evaluates the condition and refuses before any mutation.
  atChoice(p, 'confirm:vouch');
  assertRefused(p, 'vouch');
  assertEquals(p.decisions['ferry_shrine_pledge'], undefined);
});

Deno.test('authority: correct scene, owner, presence and staged panel apply exactly once', () => {
  const p = ferryHero(1608);
  atChoice(p, 'confirm:promise');
  const r = applyDialogueChoice(p, { choiceId: 'promise', now: 1 });
  assert(r.ok);
  assertEquals(r.decided, 'ferry_shrine_pledge');
  assertEquals(r.nextNodeId, 'n4');
  assertEquals(p.decisions['ferry_shrine_pledge']?.choiceId, 'promise');
  assertEquals(p.storyEvents, ['shrine_allegiance_chosen']);
  // The route consequence (#132): the chosen route starts (with the parent
  // event already credited), the incompatible route locks permanently.
  assertEquals(p.quests['sq_shrine_pact']?.status, 'active');
  assertEquals(p.quests['sq_shrine_pact']?.counts, [1, 0]);
  assertEquals(p.questOutcomes['sq_ledger_debt']?.kind, 'locked');
  assertEquals(p.storyReceipts, [`choice:${DIALOGUE}:${CHOICE_NODE}:promise`]);
});

Deno.test('authority: an identical retry is a complete no-op (#129 receipts)', () => {
  const p = ferryHero(1609);
  atChoice(p, 'confirm:promise');
  const r1 = applyDialogueChoice(p, { choiceId: 'promise', now: 1 });
  assert(r1.ok);
  const before = JSON.stringify(p);
  const r2 = applyDialogueChoice(p, { choiceId: 'promise', now: 2 });
  assertEquals(r2.ok, true, 'the retry is accepted…');
  assertEquals(r2.nextNodeId, 'n4', '…routes to the authored next beat…');
  assertEquals(r2.lines, [], '…but carries no notices…');
  assertEquals(JSON.stringify(p), before, '…and mutates nothing at all');
});
