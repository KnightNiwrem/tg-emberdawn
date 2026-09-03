/**
 * Branching dialogue choices (#126): conditionally available responses,
 * deferral, irreversible confirmation, atomic single-application through
 * the central engine op, and durable decision-dependent consequences.
 */

import { assert, assertEquals } from '@std/assert';
import { withRev } from '../src/codec.ts';
import { createPlayer } from '../src/engine/character.ts';
import { syncAvailability } from '../src/engine/quests.ts';
import { applyDialogueChoice } from '../src/engine/story.ts';
import { evalCondition } from '../src/engine/conditions.ts';
import { dialogueAction, npcAction } from '../src/handlers/hub.ts';
import { renderDialogue } from '../src/render/views.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { fakeCtx } from './helpers.ts';
import type { PlayerState } from '../src/engine/types.ts';

const FERRY = 'npc_ferryman';
const DIALOGUE = 'dlg_ferry_promise';
const CHOICE_NODE = 'n3';

function ferryHero(id: number): PlayerState {
  const p = createPlayer(id, 'T', 'warrior');
  syncAvailability(p);
  p.currentZone = 'hollowmere';
  p.unlockedZones.push('hollowmere');
  p.flags['zone_hollowmere'] = true;
  return p;
}

function openChoice(p: PlayerState): void {
  p.scene = { view: 'npc', arg: FERRY };
  npcAction(p, { v: 'npc', a: 'lore', arg: 'ferry_promise' });
  assertEquals(p.scene.view, 'dialogue');
  assertEquals(p.scene.arg2, 'n1');
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n2' });
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: CHOICE_NODE });
  assertEquals(p.scene.arg2, CHOICE_NODE);
}

Deno.test('choices: both responses render, deferral is offered, prompt is separate', () => {
  const p = ferryHero(1400);
  openChoice(p);
  const view = JSON.stringify(renderDialogue(p));
  assert(view.includes('dlg:ch:promise'), 'the first response renders');
  assert(view.includes('dlg:ch:decline'), 'the second response renders');
  assert(view.includes('dlg:bk'), 'Not now deferral renders');
  assert(view.includes('So — what do I tell them?'), 'the NPC prompt is shown');
  assert(!view.includes('confirm'), 'no confirmation is staged yet');
});

Deno.test('choices: deferral ("Not now") performs no story mutation', () => {
  const p = ferryHero(1401);
  openChoice(p);
  const before = JSON.stringify({ d: p.decisions, f: p.flags, e: p.storyEvents });
  dialogueAction(p, { v: 'dlg', a: 'bk' });
  assertEquals(JSON.stringify({ d: p.decisions, f: p.flags, e: p.storyEvents }), before);
  assertEquals(p.scene.view, 'npc', 'deferral returns to the topic menu');
  assertEquals(p.scene.arg, FERRY);
  // The topic remains available for a later decision.
  openChoice(p);
  assertEquals(p.scene.arg2, CHOICE_NODE);
});

Deno.test('choices: irreversible selection stages confirmation; open/back mutate nothing', () => {
  const p = ferryHero(1402);
  openChoice(p);
  const before = JSON.stringify({ d: p.decisions, f: p.flags, e: p.storyEvents });
  dialogueAction(p, { v: 'dlg', a: 'ch', arg: 'promise' });
  assertEquals(p.scene.arg3, 'confirm:promise', 'the panel is staged');
  assertEquals(JSON.stringify({ d: p.decisions, f: p.flags, e: p.storyEvents }), before);
  const panel = JSON.stringify(renderDialogue(p));
  assert(panel.includes('cannot be changed'), 'permanence is stated');
  assert(panel.includes('The shrine will count on you'), 'the consequence hint renders');
  assert(panel.includes('dlg:cf:promise'), 'Confirm carries the choice id only');
  assert(panel.includes('dlg:cc'), 'Go back is offered');
  // Abandon: back to the choice list, still zero mutation.
  dialogueAction(p, { v: 'dlg', a: 'cc' });
  assertEquals(p.scene.arg3, undefined);
  assertEquals(JSON.stringify({ d: p.decisions, f: p.flags, e: p.storyEvents }), before);
});

Deno.test('choices: confirmation applies effects exactly once, atomically (#126)', () => {
  const p = ferryHero(1403);
  openChoice(p);
  dialogueAction(p, { v: 'dlg', a: 'ch', arg: 'promise' }); // stage
  dialogueAction(p, { v: 'dlg', a: 'cf', arg: 'promise' }); // confirm
  assertEquals(p.decisions['ferry_shrine_pledge']?.choiceId, 'promise');
  assertEquals(p.storyEvents, ['shrine_allegiance_chosen'], 'shared parent progress emitted');
  assertEquals(p.flags['shrine_pledge'], true);
  assertEquals(p.scene.arg2, 'n4', 'the choice advanced to its authored next node');
  assertEquals(p.scene.arg3, undefined, 'the staged panel cleared');
  // A later topic can identify the actual choice from the ledger.
  assert(evalCondition(p, { decision: { id: 'ferry_shrine_pledge', choiceId: 'promise' } }));
  assert(!evalCondition(p, { decision: { id: 'ferry_shrine_pledge', choiceId: 'decline' } }));
});

Deno.test('choices: the decline branch records its own decision, same event', () => {
  const a = ferryHero(1404);
  const b = ferryHero(1405);
  for (const p of [a, b]) openChoice(p);
  // The central op derives dialogue/node/NPC from the live scene (#130);
  // the irreversible promise needs its staged panel.
  applyDialogueChoice(a, { choiceId: 'decline', now: 1 });
  b.scene.arg3 = 'confirm:promise';
  applyDialogueChoice(b, { choiceId: 'promise', now: 1 });
  assertEquals(a.decisions['ferry_shrine_pledge']?.choiceId, 'decline');
  assertEquals(b.decisions['ferry_shrine_pledge']?.choiceId, 'promise');
  assertEquals(a.storyEvents, b.storyEvents, 'both choices share the parent-progress event');
});

Deno.test('choices: incompatible re-choices and engine-level replays are refused', () => {
  const p = ferryHero(1406);
  openChoice(p);
  p.scene.arg3 = 'confirm:promise';
  applyDialogueChoice(p, { choiceId: 'promise', now: 1 });
  // Trying to re-decide the same dialogue choice with the other option is
  // refused by the central op (ledger wins), and the state is untouched.
  // (The handler would have routed the scene on; restore the choice node.)
  p.scene = { view: 'dialogue', arg: DIALOGUE, arg2: CHOICE_NODE };
  const before = JSON.stringify({ d: p.decisions, f: p.flags, e: p.storyEvents });
  const r = applyDialogueChoice(p, { choiceId: 'decline', now: 2 });
  assertEquals(r.ok, false);
  assertEquals(JSON.stringify({ d: p.decisions, f: p.flags, e: p.storyEvents }), before);
  // A forged choice id refuses.
  const forged = applyDialogueChoice(p, { choiceId: 'nope', now: 2 });
  assertEquals(forged.ok, false);
});

Deno.test('choices: full router — double taps, cancellation, stale confirmations (#43, #126)', async () => {
  const store = new MemoryStore();
  const p = ferryHero(1407);
  p.messageId = 300;
  p.scene = { view: 'npc', arg: FERRY };
  await store.set(1407, p);
  let cur = (await store.get(1407))!;
  await handleCallback(
    fakeCtx(1407, 300, withRev(cur.uiRev ?? 0, 'npc:lore:ferry_promise')),
    store,
  );
  cur = (await store.get(1407))!;
  await handleCallback(fakeCtx(1407, 300, withRev(cur.uiRev ?? 0, 'dlg:nx:n2')), store);
  cur = (await store.get(1407))!;
  await handleCallback(fakeCtx(1407, 300, withRev(cur.uiRev ?? 0, 'dlg:nx:n3')), store);
  cur = (await store.get(1407))!;
  const rev = cur.uiRev ?? 0;
  // Stage the irreversible confirmation.
  await handleCallback(fakeCtx(1407, 300, withRev(rev, 'dlg:ch:promise')), store);
  cur = (await store.get(1407))!;
  assertEquals(cur.scene.arg3, 'confirm:promise');
  // Cancel.
  await handleCallback(fakeCtx(1407, 300, withRev(cur.uiRev ?? 0, 'dlg:cc')), store);
  cur = (await store.get(1407))!;
  assertEquals(cur.scene.arg3, undefined);
  assertEquals(Object.keys(cur.decisions).length, 0, 'cancellation mutated nothing');
  // Stage again and confirm.
  await handleCallback(fakeCtx(1407, 300, withRev(cur.uiRev ?? 0, 'dlg:ch:promise')), store);
  cur = (await store.get(1407))!;
  const confirmRev = cur.uiRev ?? 0;
  await handleCallback(fakeCtx(1407, 300, withRev(confirmRev, 'dlg:cf:promise')), store);
  cur = (await store.get(1407))!;
  assertEquals(cur.decisions['ferry_shrine_pledge']?.choiceId, 'promise');
  const after = JSON.stringify({ d: cur.decisions, f: cur.flags });
  // Double tap of the SAME confirm (same revision): rev guard rejects.
  await handleCallback(fakeCtx(1407, 300, withRev(confirmRev, 'dlg:cf:promise')), store);
  cur = (await store.get(1407))!;
  assertEquals(JSON.stringify({ d: cur.decisions, f: cur.flags }), after, 'no double apply');
  // A confirmation callback WITHOUT a staged panel refuses.
  await handleCallback(fakeCtx(1407, 300, withRev(cur.uiRev ?? 0, 'dlg:cf:decline')), store);
  cur = (await store.get(1407))!;
  assertEquals(cur.decisions['ferry_shrine_pledge']?.choiceId, 'promise', 'un-staged cf refused');
});

Deno.test('choices: scene persists through rerender and /start (#126)', () => {
  const p = ferryHero(1408);
  openChoice(p);
  p.scene.arg3 = 'confirm:promise';
  const staged = JSON.stringify(renderDialogue(p));
  const again = JSON.stringify(renderDialogue(p));
  assertEquals(staged, again, 'the confirmation panel is position-stable');
  // After applying, the resulting node also rerenders identically.
  dialogueAction(p, { v: 'dlg', a: 'cf', arg: 'promise' });
  const n4 = JSON.stringify(renderDialogue(p));
  assertEquals(n4, JSON.stringify(renderDialogue(p)));
});

Deno.test('choices: conditionally available responses revalidate at tap time (#126)', () => {
  // The vouch choice requires m6_toxin done. A fresh hero neither sees nor
  // applies it; after the quest completes it renders; and if the state no
  // longer satisfies the condition when the tap lands, the handler refuses.
  const p = ferryHero(1409);
  openChoice(p);
  assert(
    !JSON.stringify(renderDialogue(p)).includes('dlg:ch:vouch'),
    'an unmet condition hides the response',
  );
  const refused = applyDialogueChoice(p, { choiceId: 'vouch', now: 1 });
  assertEquals(refused.ok, false, 'tap-time reevaluation gates the effects');
  assertEquals(Object.keys(p.decisions).length, 0);
  // After the condition passes, the response renders and applies.
  p.quests['m6_toxin'] = { status: 'done', counts: [4] };
  assert(
    JSON.stringify(renderDialogue(p)).includes('dlg:ch:vouch'),
    'a met condition reveals the response',
  );
  const ok = applyDialogueChoice(p, { choiceId: 'vouch', now: 1 });
  assertEquals(ok.ok, true);
  assertEquals(p.decisions['ferry_shrine_pledge']?.choiceId, 'vouch');
  assertEquals(ok.nextNodeId, 'n6');
});
