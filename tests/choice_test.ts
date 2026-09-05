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
import { fakeCtx, fakeCtxCapture } from './helpers.ts';
import type { PlayerState } from '../src/engine/types.ts';
import { ferryHero } from './helpers_story.ts';

const FERRY = 'npc_ferryman';
const DIALOGUE = 'dlg_ferry_promise';
const CHOICE_NODE = 'n3';

/** A fresh hero in Emberdawn Village (Maren's zone). */
function hero(id: number): PlayerState {
  const p = createPlayer(id, 'T', 'warrior');
  syncAvailability(p);
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
  assert(
    view.includes('Which job will you take: the beacon or the water intake?'),
    'the NPC prompt is shown',
  );
  assertEquals(p.scene.arg3, undefined, 'no confirmation is staged yet');
  assert(!view.includes('dlg:cf:'), 'the list offers selection, never a committing confirmation');
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
  assert(panel.includes("The Shrine's Beacon"), 'the selected quest brief renders');
  assert(panel.includes('Defeat Marsh Wisp'), 'the brief names the objective');
  assert(
    panel.includes('Permanently closes: The Water Intake.'),
    'the generated warning names the permanent exclusion',
  );
  assert(panel.includes('dlg:cf:promise'), 'Confirm carries the choice id only');
  assert(panel.includes('dlg:cc'), 'Go back is offered');
  // Abandon: back to the choice list, still zero mutation.
  dialogueAction(p, { v: 'dlg', a: 'cc' });
  assertEquals(p.scene.arg3, undefined);
  assertEquals(JSON.stringify({ d: p.decisions, f: p.flags, e: p.storyEvents }), before);
});

Deno.test('choices: confirmation applies effects exactly once, atomically (#126, #132)', () => {
  const p = ferryHero(1403);
  openChoice(p);
  dialogueAction(p, { v: 'dlg', a: 'ch', arg: 'promise' }); // stage
  dialogueAction(p, { v: 'dlg', a: 'cf', arg: 'promise' }); // confirm
  assertEquals(p.decisions['ferry_shrine_pledge']?.choiceId, 'promise');
  assertEquals(p.storyEvents, ['shrine_allegiance_chosen'], 'shared parent progress emitted');
  // The shared parent (#147): the event advanced the already-active parent
  // objective; the parent is turn-in-ready.
  assertEquals(p.quests['sq_shrine_pledge']?.status, 'turnIn');
  assertEquals(p.quests['sq_shrine_pledge']?.counts, [1]);
  // The route consequence (#132): the believer route started (carrying
  // only its own route objective); the incompatible route locked.
  assertEquals(p.quests['sq_shrine_pact']?.status, 'active');
  assertEquals(p.quests['sq_shrine_pact']?.counts, [0]);
  assertEquals(p.questOutcomes['sq_ledger_debt']?.kind, 'locked');
  assertEquals(p.scene.arg2, 'n4', 'the choice advanced to its authored next node');
  assertEquals(p.scene.arg3, undefined, 'the staged panel cleared');
  // A later topic can identify the actual choice from the ledger.
  assert(evalCondition(p, { decision: { id: 'ferry_shrine_pledge', choiceId: 'promise' } }));
  assert(!evalCondition(p, { decision: { id: 'ferry_shrine_pledge', choiceId: 'decline' } }));
});

Deno.test('choices: the decline branch starts the other route and locks the first', () => {
  const a = ferryHero(1404);
  const b = ferryHero(1405);
  openChoice(a);
  openChoice(b);
  // The central op derives dialogue/node/NPC from the live scene (#130);
  // both committing responses are irreversible and need staged panels.
  a.scene.arg3 = 'confirm:decline';
  applyDialogueChoice(a, { choiceId: 'decline', now: 1 });
  b.scene.arg3 = 'confirm:promise';
  applyDialogueChoice(b, { choiceId: 'promise', now: 1 });
  assertEquals(a.decisions['ferry_shrine_pledge']?.choiceId, 'decline');
  assertEquals(b.decisions['ferry_shrine_pledge']?.choiceId, 'promise');
  assertEquals(a.storyEvents, b.storyEvents, 'both choices share the parent-progress event');
  // Each route starts its own follow-up quest and locks the other (#132).
  assertEquals(a.quests['sq_ledger_debt']?.status, 'active');
  assertEquals(a.questOutcomes['sq_shrine_pact']?.kind, 'locked');
  assertEquals(b.quests['sq_shrine_pact']?.status, 'active');
  assertEquals(b.questOutcomes['sq_ledger_debt']?.kind, 'locked');
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

/** Routes a stored hero to the Ferryman's choice node through the real
 * callback router, then returns a tap helper that always fires at the
 * CURRENT render revision (unless overridden) and reports the resulting
 * persisted player plus the toasts the route delivered. */
async function routerAtChoice(store: MemoryStore, userId: number) {
  const tap = async (data: string, rev?: number) => {
    const before = (await store.get(userId))!;
    const { ctx, toasts } = fakeCtxCapture(userId, 300, withRev(rev ?? before.uiRev ?? 0, data));
    await handleCallback(ctx, store);
    return { cur: (await store.get(userId))!, toasts };
  };
  await tap('npc:lore:ferry_promise');
  await tap('dlg:nx:n2');
  const { cur } = await tap('dlg:nx:n3');
  assertEquals(cur.scene.arg2, CHOICE_NODE);
  return tap;
}

Deno.test('choices: full router — forged and mismatched cf callbacks are harmless refusals (#136)', async () => {
  const store = new MemoryStore();
  const p = ferryHero(1410);
  p.messageId = 300;
  p.scene = { view: 'npc', arg: FERRY };
  await store.set(1410, p);
  const tap = await routerAtChoice(store, 1410);

  // Forged confirm of an ORDINARY choice, nothing staged: a non-mutating
  // refusal — no decision, no receipt, the scene stays on the choice list.
  let r = await tap('dlg:cf:decline');
  assert(r.toasts.some((t) => t?.includes('moved on')), `refusal toast: ${r.toasts}`);
  assertEquals(Object.keys(r.cur.decisions).length, 0, 'the ordinary choice was not applied');
  assertEquals(r.cur.storyReceipts, []);
  assertEquals(r.cur.scene.arg2, CHOICE_NODE);
  assertEquals(r.cur.scene.arg3, undefined, 'no panel was staged');

  // Confirm of the IRREVERSIBLE choice without its staged panel: refused.
  r = await tap('dlg:cf:promise');
  assert(r.toasts.some((t) => t?.includes('moved on')), `refusal toast: ${r.toasts}`);
  assertEquals(Object.keys(r.cur.decisions).length, 0);
  assertEquals(r.cur.storyReceipts, []);

  // A STALE revision never reaches the handler — neither ch nor cf.
  const stale = (r.cur.uiRev ?? 1) - 1;
  r = await tap('dlg:ch:promise', stale);
  assert(r.toasts.some((t) => t?.includes('stale')), `staleness toast: ${r.toasts}`);
  assertEquals(r.cur.scene.arg3, undefined, 'a stale select stages nothing');

  // Select STAGES the irreversible panel without applying anything.
  r = await tap('dlg:ch:promise');
  assertEquals(r.cur.scene.arg3, 'confirm:promise');
  assertEquals(Object.keys(r.cur.decisions).length, 0, 'staging is not an application');

  // A stale confirm is rejected by the router even while the panel is live.
  r = await tap('dlg:cf:promise', (r.cur.uiRev ?? 1) - 1);
  assert(r.toasts.some((t) => t?.includes('stale')), `staleness toast: ${r.toasts}`);
  assertEquals(Object.keys(r.cur.decisions).length, 0);

  // A panel staged for choice A cannot confirm choice B.
  r = await tap('dlg:cf:decline');
  assert(r.toasts.some((t) => t?.includes('moved on')), `refusal toast: ${r.toasts}`);
  assertEquals(r.cur.scene.arg3, 'confirm:promise', 'the staged panel survives the forged tap');
  assertEquals(Object.keys(r.cur.decisions).length, 0);
  assertEquals(r.cur.storyReceipts, []);

  // The exact staged confirm applies exactly once.
  r = await tap('dlg:cf:promise');
  assertEquals(r.cur.decisions['ferry_shrine_pledge']?.choiceId, 'promise');
  assertEquals(r.cur.storyReceipts, [`choice:${DIALOGUE}:${CHOICE_NODE}:promise`]);
  assertEquals(r.cur.scene.arg2, 'n4', 'the authored next beat');
  assertEquals(r.cur.scene.arg3, undefined);

  // A duplicate confirm at the CURRENT revision: the conversation has routed
  // on, so it refuses without a second application (the recorded receipt
  // also makes any engine-level replay a complete no-op — #129).
  r = await tap('dlg:cf:promise');
  assertEquals(Object.keys(r.cur.decisions).length, 1);
  assertEquals(r.cur.storyReceipts.length, 1, 'no second receipt, no double apply');
});

Deno.test('choices: full router — an ordinary ch still applies directly (#136)', async () => {
  // The pledge dialogue's committing responses are all irreversible; the
  // ordinary-direct path is exercised on m1_embers' standard offer accept.
  const store = new MemoryStore();
  const p = hero(1411);
  p.messageId = 300;
  p.scene = { view: 'npc', arg: 'npc_maren' };
  await store.set(1411, p);
  const tap = async (data: string) => {
    const before = (await store.get(1411))!;
    await handleCallback(fakeCtx(1411, 300, withRev(before.uiRev ?? 0, data)), store);
    return (await store.get(1411))!;
  };
  let cur = await tap('npc:q:m1_embers');
  assertEquals(cur.scene.view, 'dialogue');
  assertEquals(cur.scene.arg, 'dlg_m1_embers_offer');
  cur = await tap('dlg:nx:o2'); // advance through the offer beats
  cur = await tap('dlg:nx:oa'); // …to the choice node
  cur = await tap('dlg:ch:accept');
  assertEquals(cur.quests['m1_embers']?.status, 'active', 'the ordinary choice applied');
  assertEquals(cur.storyReceipts, ['choice:dlg_m1_embers_offer:oa:accept']);
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
  // After the condition passes, the response renders and applies — like
  // every committing pledge response, from its staged confirmation panel.
  p.quests['m6_toxin'] = { status: 'done', counts: [4] };
  assert(
    JSON.stringify(renderDialogue(p)).includes('dlg:ch:vouch'),
    'a met condition reveals the response',
  );
  p.scene.arg3 = 'confirm:vouch';
  const ok = applyDialogueChoice(p, { choiceId: 'vouch', now: 1 });
  assertEquals(ok.ok, true);
  assertEquals(p.decisions['ferry_shrine_pledge']?.choiceId, 'vouch');
  assertEquals(ok.nextNodeId, 'n6');
  // The vouch route is the believer route: the beacon started, the debt
  // route locked (#132).
  assertEquals(p.quests['sq_shrine_pact']?.status, 'active');
  assertEquals(p.questOutcomes['sq_ledger_debt']?.kind, 'locked');
});
