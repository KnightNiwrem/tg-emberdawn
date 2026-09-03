/** Story-effect transactions (#129): validation IS the ordered application
 * run against a draft (later effects see the projected result of earlier
 * ones), commits are all-or-nothing with the live player byte-for-byte
 * unchanged on refusal, one-shot application receipts make replays complete
 * no-ops, terminal quest outcomes are monotonic, and every quest start
 * shares acceptQuest's objective-reconciliation policy. */

import { assert, assertEquals, assertThrows } from '@std/assert';
import type { StoryEffect } from '../src/content/types.ts';
import {
  applyDialogueChoice,
  applyStoryEffects,
  type StoryContext,
  storyNoticeLines,
  validateStoryBundle,
} from '../src/engine/story.ts';
import { createPlayer } from '../src/engine/character.ts';
import { acceptQuest, syncAvailability } from '../src/engine/quests.ts';
import { addItem, countOf } from '../src/engine/inventory.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import type { PlayerState } from '../src/engine/types.ts';

/** Distinct node ids = distinct line-entry applications (dlg:node identity). */
const ctxAt = (nodeId: string, npcId = 'npc_maren', dialogueId = 'dlg_test'): StoryContext => ({
  dialogueId,
  nodeId,
  npcId,
  now: 1700000000000,
});

function hero(id: number): PlayerState {
  return createPlayer(id, 'T', 'warrior');
}

const grant = (qty: number): StoryEffect => ({ kind: 'grantItem', itemId: 'm_iron_chunk', qty });
const remove = (qty: number): StoryEffect => ({ kind: 'removeItem', itemId: 'm_iron_chunk', qty });

// ── intra-bundle ordering: the projected state is authority ──────────────

Deno.test('tx: grant → remove is a valid ordered bundle that nets to zero', () => {
  const p = hero(1500);
  assertEquals(countOf(p, 'm_iron_chunk'), 0, 'fixture: no iron');
  const bundle = [grant(1), remove(1)];
  assertEquals(
    validateStoryBundle(p, bundle, ctxAt('n1')),
    undefined,
    'the removal sees the earlier grant',
  );
  const r = applyStoryEffects(p, bundle, ctxAt('n1'));
  assertEquals(countOf(p, 'm_iron_chunk'), 0, 'grant and removal net to zero');
  assertEquals(r.lines.length, 1, 'the grant notice is committed');
  assert(r.lines[0]!.includes('Received'));
  assertEquals(p.storyReceipts, ['line:dlg_test:n1'], 'the application receipt is recorded');
});

Deno.test('tx: two removals competing for one stack refuse the whole bundle', () => {
  const p = hero(1501);
  addItem(p, 'm_iron_chunk', 1);
  const before = JSON.stringify(p);
  const bundle = [remove(1), remove(1)];
  const refusal = validateStoryBundle(p, bundle, ctxAt('n1'));
  assert(refusal?.includes('Not enough'), `cumulative shortfall refused: ${refusal}`);
  assertThrows(() => applyStoryEffects(p, bundle, ctxAt('n1')));
  assertEquals(JSON.stringify(p), before, 'nothing applied — not even the first removal');
  assertEquals(p.storyReceipts, [], 'a refused application records no receipt');
  // No receipt means a corrected retry is still possible.
  applyStoryEffects(p, [remove(1)], ctxAt('n1'));
  assertEquals(countOf(p, 'm_iron_chunk'), 0);
});

Deno.test('tx: remove → grant reorders legally; grants accumulate for a larger removal', () => {
  const p = hero(1502);
  addItem(p, 'm_iron_chunk', 1);
  applyStoryEffects(p, [remove(1), grant(1)], ctxAt('n1'));
  assertEquals(countOf(p, 'm_iron_chunk'), 1, 'remove-then-grant nets to the original stack');

  const q = hero(1503);
  applyStoryEffects(q, [grant(2), grant(1), remove(3)], ctxAt('n1'));
  assertEquals(countOf(q, 'm_iron_chunk'), 0, 'two grants cover the larger removal');

  const r = hero(1504);
  const before = JSON.stringify(r);
  assert(validateStoryBundle(r, [grant(2), remove(3)], ctxAt('n1')) !== undefined);
  assertThrows(() => applyStoryEffects(r, [grant(2), remove(3)], ctxAt('n1')));
  assertEquals(JSON.stringify(r), before, 'an impossible cumulative removal commits nothing');
});

// ── replay idempotency: receipts, not per-effect guards ──────────────────

Deno.test('tx: replaying recordDecision + grant is a complete no-op', () => {
  const p = hero(1505);
  const base = countOf(p, 'c_minor_potion');
  const bundle: StoryEffect[] = [
    { kind: 'recordDecision', id: 'tx_pact', choiceId: 'a' },
    { kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 },
  ];
  const r1 = applyStoryEffects(p, bundle, ctxAt('n1'));
  assertEquals(r1.decisions, ['tx_pact']);
  assertEquals(countOf(p, 'c_minor_potion'), base + 1);

  const before = JSON.stringify(p);
  const r2 = applyStoryEffects(p, bundle, ctxAt('n1'));
  assertEquals(r2, { lines: [], readyQuests: [], startedQuests: [], events: [], decisions: [] });
  assertEquals(JSON.stringify(p), before, 'the replay touches nothing');
  assertEquals(countOf(p, 'c_minor_potion'), base + 1, 'no duplicated grant');
  assertEquals(p.storyReceipts, ['line:dlg_test:n1'], 'one receipt, not two');
});

Deno.test('tx: line-entry identity is dialogue + node — distinct beats apply distinctly', () => {
  const p = hero(1506);
  const base = countOf(p, 'c_minor_potion');
  applyStoryEffects(p, [{ kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 }], ctxAt('n1'));
  applyStoryEffects(p, [{ kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 }], ctxAt('n1'));
  assertEquals(countOf(p, 'c_minor_potion'), base + 1, 'same node replays as a no-op');
  applyStoryEffects(p, [{ kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 }], ctxAt('n2'));
  assertEquals(countOf(p, 'c_minor_potion'), base + 2, 'a different node is a new application');
  applyStoryEffects(
    p,
    [{ kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 }],
    ctxAt('n1', 'npc_maren', 'dlg_other'),
  );
  assertEquals(countOf(p, 'c_minor_potion'), base + 3, 'a different dialogue is a new application');
});

Deno.test('tx: a choice replay routes to the next beat with zero notices, even across save reloads', async () => {
  const p = hero(1507);
  syncAvailability(p);
  p.currentZone = 'hollowmere';
  p.unlockedZones.push('hollowmere');
  p.flags['zone_hollowmere'] = true;
  // The central op derives dialogue/node/NPC from the live scene (#130):
  // the irreversible promise needs its exact staged panel.
  p.scene = {
    view: 'dialogue',
    arg: 'dlg_ferry_promise',
    arg2: 'n3',
    arg3: 'confirm:promise',
  };
  const args = { choiceId: 'promise', now: 1 };
  const r1 = applyDialogueChoice(p, args);
  assert(r1.ok);
  assertEquals(r1.decided, 'ferry_shrine_pledge');
  assertEquals(p.storyReceipts, ['choice:dlg_ferry_promise:n3:promise']);
  const before = JSON.stringify(p);

  const r2 = applyDialogueChoice(p, { ...args, now: 2 });
  assertEquals(r2.ok, true);
  assertEquals(r2.nextNodeId, 'n4', 'the replay still routes to the next beat');
  assertEquals(r2.lines, [], 'the replay carries no notices');
  assertEquals(r2.decided, undefined);
  assertEquals(JSON.stringify(p), before, 'no state and no duplicated notices');

  // A save/reload round-trip keeps the receipt — retries after a crash or a
  // clone-on-read store cannot double-apply either.
  const store = new MemoryStore();
  await store.set(1507, p);
  const reloaded = (await store.get(1507))!;
  const r3 = applyDialogueChoice(reloaded, { ...args, now: 3 });
  assertEquals(r3.ok, true);
  assertEquals(r3.lines, []);
  assertEquals(JSON.stringify(reloaded), before, 'the receipt survives persistence');

  // A DIFFERENT choice on the same node is still refused by the ledger
  // (the handler would have cleared the staged panel on routing).
  p.scene.arg3 = undefined;
  const before4 = JSON.stringify(p);
  const r4 = applyDialogueChoice(p, { choiceId: 'decline', now: 4 });
  assertEquals(r4.ok, false);
  assertEquals(JSON.stringify(p), before4);
});

// ── terminal outcome monotonicity ────────────────────────────────────────

Deno.test('tx: lock → start refuses atomically; start → lock applies in order', () => {
  const p = hero(1510);
  p.level = 2;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  syncAvailability(p);
  assertEquals(p.quests['m2_letter']?.status, 'available');

  const before = JSON.stringify(p);
  const bad: StoryEffect[] = [
    { kind: 'lockQuest', questId: 'm2_letter', reason: 'route_closed' },
    { kind: 'startQuest', questId: 'm2_letter' },
  ];
  assert(validateStoryBundle(p, bad, ctxAt('n1')) !== undefined, 'start sees the earlier lock');
  assertThrows(() => applyStoryEffects(p, bad, ctxAt('n1')));
  assertEquals(JSON.stringify(p), before, 'the advertised start is not silently skipped');

  const good: StoryEffect[] = [
    { kind: 'startQuest', questId: 'm2_letter' },
    { kind: 'lockQuest', questId: 'm2_letter', reason: 'route_closed' },
  ];
  const r = applyStoryEffects(p, good, ctxAt('n1'));
  assertEquals(r.startedQuests, ['m2_letter']);
  assertEquals(p.quests['m2_letter']?.status, 'unavailable', 'the later lock wins the bundle');
  assertEquals(p.questOutcomes['m2_letter']?.kind, 'locked');
});

Deno.test('tx: a resolved quest can never become locked or failed — same bundle or later', () => {
  const p = hero(1511);
  p.quests['sq_rats'] = { status: 'active', counts: [6] };
  // Same bundle: the lock sees the earlier resolution and refuses it all.
  const before = JSON.stringify(p);
  const bad: StoryEffect[] = [
    { kind: 'resolveQuest', questId: 'sq_rats', outcome: 'culled' },
    { kind: 'lockQuest', questId: 'sq_rats' },
  ];
  assert(validateStoryBundle(p, bad, ctxAt('n1')) !== undefined);
  assertThrows(() => applyStoryEffects(p, bad, ctxAt('n1')));
  assertEquals(JSON.stringify(p), before, 'nothing — including the resolve — commits');

  applyStoryEffects(
    p,
    [{ kind: 'resolveQuest', questId: 'sq_rats', outcome: 'culled' }],
    ctxAt('n1'),
  );
  assertEquals(p.questOutcomes['sq_rats']?.kind, 'resolved');
  // Later applications: lock, fail, and a contradicting resolve all refuse.
  const attempts: StoryEffect[] = [
    { kind: 'lockQuest', questId: 'sq_rats' },
    { kind: 'failQuest', questId: 'sq_rats' },
    { kind: 'resolveQuest', questId: 'sq_rats', outcome: 'driven_off' },
  ];
  for (const [i, e] of attempts.entries()) {
    const snapshot = JSON.stringify(p);
    assert(validateStoryBundle(p, [e], ctxAt(`x${i}`)) !== undefined);
    assertThrows(() => applyStoryEffects(p, [e], ctxAt(`x${i}`)));
    assertEquals(JSON.stringify(p), snapshot, 'terminal outcome is never overwritten');
  }
  assertEquals(p.quests['sq_rats']?.status, 'done');
  assertEquals(p.questOutcomes['sq_rats']?.outcome, 'culled');
  // The SAME resolve replays idempotently.
  applyStoryEffects(
    p,
    [{ kind: 'resolveQuest', questId: 'sq_rats', outcome: 'culled' }],
    ctxAt('n9'),
  );
  assertEquals(p.questOutcomes['sq_rats']?.outcome, 'culled');
});

Deno.test('tx: a locked or failed quest can never start or resolve', () => {
  const p = hero(1512);
  p.level = 2;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  syncAvailability(p);
  applyStoryEffects(p, [{ kind: 'lockQuest', questId: 'm2_letter' }], ctxAt('n1'));
  for (
    const e of [
      { kind: 'startQuest', questId: 'm2_letter' },
      { kind: 'resolveQuest', questId: 'm2_letter', outcome: 'x' },
      { kind: 'failQuest', questId: 'm2_letter' },
    ] as StoryEffect[]
  ) {
    assert(validateStoryBundle(p, [e], ctxAt('n2')) !== undefined, `${e.kind} after lock refuses`);
  }

  const q = hero(1513);
  q.quests['sq_ore'] = { status: 'active', counts: [1] };
  applyStoryEffects(q, [{ kind: 'failQuest', questId: 'sq_ore' }], ctxAt('n1'));
  assert(
    validateStoryBundle(
      q,
      [{ kind: 'resolveQuest', questId: 'sq_ore', outcome: 'x' }],
      ctxAt('n2'),
    ) !== undefined,
  );
  assert(
    validateStoryBundle(q, [{ kind: 'lockQuest', questId: 'sq_ore' }], ctxAt('n2')) !== undefined,
  );
  assertEquals(q.questOutcomes['sq_ore']?.kind, 'failed', 'the original terminal kind stands');
});

// ── all-or-nothing commit ────────────────────────────────────────────────

Deno.test('tx: failure after an earlier success leaves the player byte-for-byte unchanged', () => {
  const p = hero(1514);
  const before = JSON.stringify(p);
  const bundle: StoryEffect[] = [
    { kind: 'grantItem', itemId: 'c_minor_potion', qty: 2 },
    { kind: 'setFlag', id: 'will_not_commit' },
    { kind: 'storyEvent', event: 'will_not_commit' },
    { kind: 'unlockZone', zoneId: 'hollowmere' },
    remove(1), // impossible: no iron was granted or owned
  ];
  assert(validateStoryBundle(p, bundle, ctxAt('n1')) !== undefined);
  assertThrows(() => applyStoryEffects(p, bundle, ctxAt('n1')));
  assertEquals(JSON.stringify(p), before, 'grant/flag/event/unlock all rolled back');
  assertEquals(p.storyReceipts, [], 'no receipt without a commit');
});

// ── cross-effect dependencies ────────────────────────────────────────────

Deno.test('tx: a flag set earlier in the bundle opens availability for a later start', () => {
  const p = hero(1515);
  p.level = 2; // sq_ore: level 2, prereqFlags zone_whisperwood, starter Bram
  syncAvailability(p);
  assertEquals(p.quests['sq_ore']?.status ?? 'unavailable', 'unavailable', 'the gate is shut');
  const r = applyStoryEffects(p, [
    { kind: 'setFlag', id: 'zone_whisperwood' },
    { kind: 'startQuest', questId: 'sq_ore' },
  ], ctxAt('n1', 'npc_bram'));
  assertEquals(r.startedQuests, ['sq_ore'], 'the later start inspected the earlier flag');
  assertEquals(p.quests['sq_ore']?.status, 'active');
});

Deno.test('tx: notices correspond only to committed effects and never duplicate on replay', () => {
  const p = hero(1516);
  p.quests['m6_toxin'] = { status: 'active', counts: [0] };
  addItem(p, 'q_toxin_sample', 3); // one short of four
  const r1 = applyStoryEffects(p, [
    { kind: 'grantItem', itemId: 'q_toxin_sample', qty: 1 },
  ], ctxAt('n1', 'npc_ferryman'));
  assertEquals(r1.readyQuests, ['m6_toxin'], 'the completing grant readies the quest once');
  const lines1 = storyNoticeLines(r1);
  assertEquals(lines1.filter((l) => l.includes('ready to turn in')).length, 1);
  assertEquals(p.quests['m6_toxin']?.status, 'turnIn');

  const r2 = applyStoryEffects(
    p,
    [{ kind: 'grantItem', itemId: 'q_toxin_sample', qty: 1 }],
    ctxAt('n1', 'npc_ferryman'),
  );
  assertEquals(storyNoticeLines(r2), [], 'a replay carries no notices at all');
  assertEquals(countOf(p, 'q_toxin_sample'), 4, 'no duplicated grant');
});

// ── one shared quest-start reconciliation policy ─────────────────────────

Deno.test('tx: ever-visited reach objectives reconcile identically via startQuest and acceptQuest', () => {
  const mk = (id: number) => {
    const p = hero(id);
    p.level = 9;
    p.quests['m4_blessing'] = { status: 'done', counts: [] };
    p.flags['zone_hollowmere'] = true; // visited earlier, back home now
    syncAvailability(p);
    assertEquals(p.quests['m5_fen']?.status, 'available');
    return p;
  };
  const viaStory = mk(1517);
  const r = applyStoryEffects(
    viaStory,
    [{ kind: 'startQuest', questId: 'm5_fen' }],
    ctxAt('n1', 'npc_bram'),
  );
  assertEquals(viaStory.quests['m5_fen']?.status, 'turnIn', 'the story start credits the visit');
  assertEquals(r.startedQuests, ['m5_fen']);
  assertEquals(r.readyQuests, ['m5_fen'], 'immediate readiness is announced through the bundle');

  const viaAccept = mk(1518);
  const res = acceptQuest(viaAccept, 'm5_fen', 'npc_bram');
  assert(res.ok);
  assertEquals(viaAccept.quests['m5_fen']?.status, 'turnIn', 'acceptance reconciles the same way');
  assert(res.lines.some((l) => l.includes('ready to turn in')), 'same readiness announcement');
  assertEquals(
    viaStory.quests['m5_fen'],
    viaAccept.quests['m5_fen'],
    'identical resulting progress through every start path',
  );
});

// ── turn-in effects: rewards exactly once ────────────────────────────────

Deno.test('tx: a turnInQuest effect commits rewards once; its replay is silent', () => {
  const p = hero(1519);
  p.quests['m1_embers'] = { status: 'turnIn', counts: [4] };
  const gold = p.gold;
  const r1 = applyStoryEffects(p, [{ kind: 'turnInQuest', questId: 'm1_embers' }], ctxAt('n1'));
  assertEquals(p.quests['m1_embers']?.status, 'done');
  assertEquals(p.gold, gold + 80, 'm1 reward gold granted');
  assertEquals(countOf(p, 'q_sealed_letter'), 1, 'm1 reward item granted');
  assert(r1.lines.some((l) => l.includes('+80 gold')));

  const before = JSON.stringify(p);
  const r2 = applyStoryEffects(p, [{ kind: 'turnInQuest', questId: 'm1_embers' }], ctxAt('n1'));
  assertEquals(storyNoticeLines(r2), [], 'replay re-grants nothing');
  assertEquals(JSON.stringify(p), before);
});

Deno.test('tx: a mid-bundle collect shortfall refuses the turn-in, not just the removal', () => {
  // turnInQuest runs the central authority inside the draft: without the
  // quest's goods the whole bundle refuses and nothing else commits.
  const p = hero(1520);
  p.level = 6;
  p.quests['m4_floors'] = { status: 'done', counts: [] };
  p.quests['m5_arms'] = { status: 'turnIn', counts: [0] };
  addItem(p, 'm_iron_chunk', 1); // the quest needs 2
  const before = JSON.stringify(p);
  const bundle: StoryEffect[] = [
    { kind: 'setFlag', id: 'will_not_commit' },
    { kind: 'turnInQuest', questId: 'm5_arms' },
  ];
  assert(validateStoryBundle(p, bundle, ctxAt('n1', 'npc_bram')) !== undefined);
  assertThrows(() => applyStoryEffects(p, bundle, ctxAt('n1', 'npc_bram')));
  assertEquals(JSON.stringify(p), before, 'the flag does not commit either');
  assertEquals(p.quests['m5_arms']?.status, 'turnIn', 'the quest is untouched');
});
