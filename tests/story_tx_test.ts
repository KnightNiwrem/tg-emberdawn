/** Story-effect transactions (#129): validation IS the ordered application
 * run against a draft (later effects see the projected result of earlier
 * ones), commits are all-or-nothing with the live player byte-for-byte
 * unchanged on refusal, one-shot application receipts make replays complete
 * no-ops, terminal quest outcomes are monotonic, and every quest start
 * shares acceptQuest's objective-reconciliation policy. Results describe
 * the FINAL committed draft (#137): readyQuests is deduplicated and
 * reconciled to it, startedQuests is a transition log, and validation
 * shares the receipt so a replay validates exactly like it applies. */

import { assert, assertEquals, assertThrows } from '@std/assert';
import { namedOutcome } from './helpers.ts';
import type { StoryEffect } from '../src/content/types.ts';
import {
  applyDialogueChoice,
  applyStoryEffects,
  type StoryContext,
  storyNoticeLines,
  validateStoryBundle,
} from '../src/engine/story.ts';
import { createPlayer } from '../src/engine/character.ts';
import { acceptQuest, questReadyLine, syncAvailability } from '../src/engine/quests.ts';
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
  const player = hero(1500);
  assertEquals(countOf(player, 'm_iron_chunk'), 0, 'fixture: no iron');
  const bundle = [grant(1), remove(1)];
  assertEquals(
    validateStoryBundle(player, bundle, ctxAt('n1')),
    undefined,
    'the removal sees the earlier grant',
  );
  const result = applyStoryEffects(player, bundle, ctxAt('n1'));
  assertEquals(countOf(player, 'm_iron_chunk'), 0, 'grant and removal net to zero');
  assertEquals(result.lines.length, 1, 'the grant notice is committed');
  assert(result.lines[0]!.includes('Received'));
  assertEquals(player.storyReceipts, ['line:dlg_test:n1'], 'the application receipt is recorded');
});

Deno.test('tx: two removals competing for one stack refuse the whole bundle', () => {
  const player = hero(1501);
  addItem(player, 'm_iron_chunk', 1);
  const before = JSON.stringify(player);
  const bundle = [remove(1), remove(1)];
  const refusal = validateStoryBundle(player, bundle, ctxAt('n1'));
  assert(refusal?.includes('Not enough'), `cumulative shortfall refused: ${refusal}`);
  assertThrows(() => applyStoryEffects(player, bundle, ctxAt('n1')));
  assertEquals(JSON.stringify(player), before, 'nothing applied — not even the first removal');
  assertEquals(player.storyReceipts, [], 'a refused application records no receipt');
  // No receipt means a corrected retry is still possible.
  applyStoryEffects(player, [remove(1)], ctxAt('n1'));
  assertEquals(countOf(player, 'm_iron_chunk'), 0);
});

Deno.test('tx: remove → grant reorders legally; grants accumulate for a larger removal', () => {
  const playerA = hero(1502);
  addItem(playerA, 'm_iron_chunk', 1);
  applyStoryEffects(playerA, [remove(1), grant(1)], ctxAt('n1'));
  assertEquals(countOf(playerA, 'm_iron_chunk'), 1, 'remove-then-grant nets to the original stack');

  const playerB = hero(1503);
  applyStoryEffects(playerB, [grant(2), grant(1), remove(3)], ctxAt('n1'));
  assertEquals(countOf(playerB, 'm_iron_chunk'), 0, 'two grants cover the larger removal');

  const playerC = hero(1504);
  const before = JSON.stringify(playerC);
  assert(validateStoryBundle(playerC, [grant(2), remove(3)], ctxAt('n1')) !== undefined);
  assertThrows(() => applyStoryEffects(playerC, [grant(2), remove(3)], ctxAt('n1')));
  assertEquals(JSON.stringify(playerC), before, 'an impossible cumulative removal commits nothing');
});

// ── replay idempotency: receipts, not per-effect guards ──────────────────

Deno.test('tx: replaying recordDecision + grant is a complete no-op', () => {
  const player = hero(1505);
  const base = countOf(player, 'c_minor_potion');
  const bundle: StoryEffect[] = [
    { kind: 'recordDecision', id: 'tx_pact', choiceId: 'a' },
    { kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 },
  ];
  const r1 = applyStoryEffects(player, bundle, ctxAt('n1'));
  assertEquals(r1.decisions, ['tx_pact']);
  assertEquals(countOf(player, 'c_minor_potion'), base + 1);

  const before = JSON.stringify(player);
  const r2 = applyStoryEffects(player, bundle, ctxAt('n1'));
  assertEquals(r2, { lines: [], readyQuests: [], startedQuests: [], events: [], decisions: [] });
  assertEquals(JSON.stringify(player), before, 'the replay touches nothing');
  assertEquals(countOf(player, 'c_minor_potion'), base + 1, 'no duplicated grant');
  assertEquals(player.storyReceipts, ['line:dlg_test:n1'], 'one receipt, not two');
});

Deno.test('tx: line-entry identity is dialogue + node — distinct beats apply distinctly', () => {
  const player = hero(1506);
  const base = countOf(player, 'c_minor_potion');
  applyStoryEffects(player, [{ kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 }], ctxAt('n1'));
  applyStoryEffects(player, [{ kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 }], ctxAt('n1'));
  assertEquals(countOf(player, 'c_minor_potion'), base + 1, 'same node replays as a no-op');
  applyStoryEffects(player, [{ kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 }], ctxAt('n2'));
  assertEquals(
    countOf(player, 'c_minor_potion'),
    base + 2,
    'a different node is a new application',
  );
  applyStoryEffects(
    player,
    [{ kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 }],
    ctxAt('n1', 'npc_maren', 'dlg_other'),
  );
  assertEquals(
    countOf(player, 'c_minor_potion'),
    base + 3,
    'a different dialogue is a new application',
  );
});

Deno.test('tx: a choice replay routes to the next beat with zero notices, even across save reloads', async () => {
  const player = hero(1507);
  player.currentZone = 'hollowmere';
  player.unlockedZones.push('hollowmere');
  player.flags['zone_hollowmere'] = true;
  syncAvailability(player);
  // The pledge parent (#147) is active — the committing responses are
  // gated on the shared question being carried.
  assert(acceptQuest(player, 'sq_shrine_pledge', 'npc_ferryman').ok);
  // The central op derives dialogue/node/NPC from the live scene (#130):
  // the irreversible promise needs its exact staged panel.
  player.scene = {
    view: 'dialogue',
    arg: 'dlg_ferry_promise',
    arg2: 'n3',
    arg3: 'confirm:promise',
  };
  const args = { choiceId: 'promise', now: 1 };
  const r1 = applyDialogueChoice(player, args);
  assert(r1.ok);
  assertEquals(r1.decided, 'ferry_shrine_pledge');
  assertEquals(player.storyReceipts, ['choice:dlg_ferry_promise:n3:promise']);
  const before = JSON.stringify(player);

  const r2 = applyDialogueChoice(player, { ...args, now: 2 });
  assert(r2.ok);
  assertEquals(r2.nextNodeId, 'n4', 'the replay still routes to the next beat');
  assertEquals(r2.lines, [], 'the replay carries no notices');
  assertEquals(r2.decided, undefined);
  assertEquals(JSON.stringify(player), before, 'no state and no duplicated notices');

  // A save/reload round-trip keeps the receipt — retries after a crash or a
  // clone-on-read store cannot double-apply either.
  const store = new MemoryStore();
  await store.set(1507, player);
  const reloaded = (await store.get(1507))!;
  const r3 = applyDialogueChoice(reloaded, { ...args, now: 3 });
  assert(r3.ok);
  assertEquals(r3.lines, []);
  assertEquals(JSON.stringify(reloaded), before, 'the receipt survives persistence');

  // A DIFFERENT choice on the same node is still refused by the ledger
  // (the handler would have cleared the staged panel on routing).
  player.scene.arg3 = undefined;
  const before4 = JSON.stringify(player);
  const r4 = applyDialogueChoice(player, { choiceId: 'decline', now: 4 });
  assert(!r4.ok);
  assertEquals(JSON.stringify(player), before4);
});

// ── terminal outcome monotonicity ────────────────────────────────────────

Deno.test('tx: starting and locking the SAME quest refuses atomically in either order (#145)', () => {
  const player = hero(1510);
  player.level = 2;
  player.quests['m1_embers'] = { status: 'done', counts: [4] };
  syncAvailability(player);
  assertEquals(player.quests['m2_letter']?.status, 'available');

  // lock → start: the start sees the earlier exclusion.
  const before = JSON.stringify(player);
  const bad: StoryEffect[] = [
    { kind: 'lockQuest', questId: 'm2_letter', reason: 'route_closed' },
    { kind: 'startQuest', questId: 'm2_letter' },
  ];
  assert(
    validateStoryBundle(player, bad, ctxAt('n1')) !== undefined,
    'start sees the earlier lock',
  );
  assertThrows(() => applyStoryEffects(player, bad, ctxAt('n1')));
  assertEquals(JSON.stringify(player), before, 'the advertised start is not silently skipped');

  // start → lock: contradictory content (#145) — never a "start then
  // cancel" workflow; the bundle refuses atomically instead.
  const contradictory: StoryEffect[] = [
    { kind: 'startQuest', questId: 'm2_letter' },
    { kind: 'lockQuest', questId: 'm2_letter', reason: 'route_closed' },
  ];
  const refusal = validateStoryBundle(player, contradictory, ctxAt('n1'));
  assert(refusal?.includes('same bundle'), `contradiction named: ${refusal}`);
  assertThrows(() => applyStoryEffects(player, contradictory, ctxAt('n1')));
  assertEquals(JSON.stringify(player), before, 'nothing commits — not even the start');
  assertEquals(player.storyReceipts, [], 'no receipt without a commit');

  // Starting route A while locking a DIFFERENT route B stays valid (#145).
  const result = applyStoryEffects(player, [
    { kind: 'startQuest', questId: 'm2_letter' },
    { kind: 'lockQuest', questId: 'sq_ore', reason: 'route_closed' },
  ], ctxAt('n1'));
  assertEquals(result.startedQuests, ['m2_letter']);
  assertEquals(player.quests['m2_letter']?.status, 'active', 'the chosen route started');
  assertEquals(player.questOutcomes['sq_ore']?.kind, 'locked', 'the other route closed');
});

Deno.test('tx: a resolved quest can never become locked or failed — same bundle or later', () => {
  // The declared beacon route (#146) is the fixture: "kept" is the one
  // named resolution sq_shrine_pact declares.
  const player = hero(1511);
  player.quests['sq_shrine_pact'] = { status: 'active', counts: [1, 0] };
  // Same bundle: the lock sees the earlier resolution and refuses it all.
  const before = JSON.stringify(player);
  const bad: StoryEffect[] = [
    { kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'kept' },
    { kind: 'lockQuest', questId: 'sq_shrine_pact' },
  ];
  assert(validateStoryBundle(player, bad, ctxAt('n1')) !== undefined);
  assertThrows(() => applyStoryEffects(player, bad, ctxAt('n1')));
  assertEquals(JSON.stringify(player), before, 'nothing — including the resolve — commits');

  applyStoryEffects(
    player,
    [{ kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'kept' }],
    ctxAt('n1'),
  );
  assertEquals(player.questOutcomes['sq_shrine_pact']?.kind, 'resolved');
  // Later applications: lock and fail refuse — the terminal resolution
  // stands (and a DIFFERENT named outcome would be refused all the sooner,
  // #146).
  const attempts: StoryEffect[] = [
    { kind: 'lockQuest', questId: 'sq_shrine_pact' },
    { kind: 'failQuest', questId: 'sq_shrine_pact' },
  ];
  for (const [attemptIndex, effect] of attempts.entries()) {
    const snapshot = JSON.stringify(player);
    assert(validateStoryBundle(player, [effect], ctxAt(`x${attemptIndex}`)) !== undefined);
    assertThrows(() => applyStoryEffects(player, [effect], ctxAt(`x${attemptIndex}`)));
    assertEquals(JSON.stringify(player), snapshot, 'terminal outcome is never overwritten');
  }
  assertEquals(player.quests['sq_shrine_pact']?.status, 'done');
  assertEquals(namedOutcome(player.questOutcomes['sq_shrine_pact']), 'kept');
  // The SAME resolve replays idempotently.
  applyStoryEffects(
    player,
    [{ kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'kept' }],
    ctxAt('n9'),
  );
  assertEquals(namedOutcome(player.questOutcomes['sq_shrine_pact']), 'kept');
});

Deno.test('tx: a locked or failed quest can never start or resolve', () => {
  const lockedPlayer = hero(1512);
  lockedPlayer.quests['sq_shrine_pact'] = { status: 'active', counts: [1, 0] };
  applyStoryEffects(lockedPlayer, [{ kind: 'lockQuest', questId: 'sq_shrine_pact' }], ctxAt('n1'));
  for (
    const effect of [
      { kind: 'startQuest', questId: 'sq_shrine_pact' },
      { kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'kept' },
      { kind: 'failQuest', questId: 'sq_shrine_pact' },
    ] as StoryEffect[]
  ) {
    assert(
      validateStoryBundle(lockedPlayer, [effect], ctxAt('n2')) !== undefined,
      `${effect.kind} after lock refuses`,
    );
  }

  const failedPlayer = hero(1513);
  failedPlayer.quests['sq_shrine_pact'] = { status: 'active', counts: [1, 0] };
  applyStoryEffects(failedPlayer, [{ kind: 'failQuest', questId: 'sq_shrine_pact' }], ctxAt('n1'));
  assert(
    validateStoryBundle(
      failedPlayer,
      [{ kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'kept' }],
      ctxAt('n2'),
    ) !== undefined,
  );
  assert(
    validateStoryBundle(
      failedPlayer,
      [{ kind: 'lockQuest', questId: 'sq_shrine_pact' }],
      ctxAt('n2'),
    ) !==
      undefined,
  );
  assertEquals(
    failedPlayer.questOutcomes['sq_shrine_pact']?.kind,
    'failed',
    'the original terminal kind stands',
  );
});

// ── all-or-nothing commit ────────────────────────────────────────────────

Deno.test('tx: failure after an earlier success leaves the player byte-for-byte unchanged', () => {
  const player = hero(1514);
  const before = JSON.stringify(player);
  const bundle: StoryEffect[] = [
    { kind: 'grantItem', itemId: 'c_minor_potion', qty: 2 },
    { kind: 'setFlag', id: 'will_not_commit' },
    { kind: 'storyEvent', event: 'will_not_commit' },
    { kind: 'unlockZone', zoneId: 'hollowmere' },
    remove(1), // impossible: no iron was granted or owned
  ];
  assert(validateStoryBundle(player, bundle, ctxAt('n1')) !== undefined);
  assertThrows(() => applyStoryEffects(player, bundle, ctxAt('n1')));
  assertEquals(JSON.stringify(player), before, 'grant/flag/event/unlock all rolled back');
  assertEquals(player.storyReceipts, [], 'no receipt without a commit');
});

// ── cross-effect dependencies ────────────────────────────────────────────

Deno.test('tx: a flag set earlier in the bundle opens availability for a later start', () => {
  const player = hero(1515);
  player.level = 2; // sq_ore: level 2, requires zone_whisperwood flag, starter Bram
  syncAvailability(player);
  assertEquals(player.quests['sq_ore']?.status ?? 'unavailable', 'unavailable', 'the gate is shut');
  const result = applyStoryEffects(player, [
    { kind: 'setFlag', id: 'zone_whisperwood' },
    { kind: 'startQuest', questId: 'sq_ore' },
  ], ctxAt('n1', 'npc_bram'));
  assertEquals(result.startedQuests, ['sq_ore'], 'the later start inspected the earlier flag');
  assertEquals(player.quests['sq_ore']?.status, 'active');
});

Deno.test('tx: notices correspond only to committed effects and never duplicate on replay', () => {
  const player = hero(1516);
  player.quests['m6_toxin'] = { status: 'active', counts: [0] };
  addItem(player, 'q_toxin_sample', 3); // one short of four
  const r1 = applyStoryEffects(player, [
    { kind: 'grantItem', itemId: 'q_toxin_sample', qty: 1 },
  ], ctxAt('n1', 'npc_ferryman'));
  assertEquals(r1.readyQuests, ['m6_toxin'], 'the completing grant readies the quest once');
  const lines1 = storyNoticeLines(r1);
  assertEquals(lines1.filter((line) => line.includes('ready to turn in')).length, 1);
  assertEquals(player.quests['m6_toxin']?.status, 'turnIn');

  const r2 = applyStoryEffects(
    player,
    [{ kind: 'grantItem', itemId: 'q_toxin_sample', qty: 1 }],
    ctxAt('n1', 'npc_ferryman'),
  );
  assertEquals(storyNoticeLines(r2), [], 'a replay carries no notices at all');
  assertEquals(countOf(player, 'q_toxin_sample'), 4, 'no duplicated grant');
});

// ── one shared quest-start reconciliation policy ─────────────────────────

Deno.test('tx: ever-visited reach objectives reconcile identically via startQuest and acceptQuest', () => {
  const mk = (id: number) => {
    const player = hero(id);
    player.level = 9;
    player.quests['m4_blessing'] = { status: 'done', counts: [] };
    player.flags['zone_hollowmere'] = true; // visited earlier, back home now
    syncAvailability(player);
    assertEquals(player.quests['m5_fen']?.status, 'available');
    return player;
  };
  const viaStory = mk(1517);
  const result = applyStoryEffects(
    viaStory,
    [{ kind: 'startQuest', questId: 'm5_fen' }],
    ctxAt('n1', 'npc_bram'),
  );
  assertEquals(viaStory.quests['m5_fen']?.status, 'turnIn', 'the story start credits the visit');
  assertEquals(result.startedQuests, ['m5_fen']);
  assertEquals(
    result.readyQuests,
    ['m5_fen'],
    'immediate readiness is announced through the bundle',
  );

  const viaAccept = mk(1518);
  const res = acceptQuest(viaAccept, 'm5_fen', 'npc_bram');
  assert(res.ok);
  assertEquals(viaAccept.quests['m5_fen']?.status, 'turnIn', 'acceptance reconciles the same way');
  // Readiness is STRUCTURED (#145): the helper reports the id and the
  // caller formats it — acceptance lines carry no ready sentence.
  assertEquals(res.ready, ['m5_fen'], 'same readiness, reported as an id');
  assert(
    !res.lines.some((line) => line.includes('ready to turn in')),
    'no eager readiness sentence',
  );
  assertEquals(res.ready.map(questReadyLine), [questReadyLine('m5_fen')]);
  assertEquals(
    viaStory.quests['m5_fen'],
    viaAccept.quests['m5_fen'],
    'identical resulting progress through every start path',
  );
});

// ── turn-in effects: rewards exactly once ────────────────────────────────

Deno.test('tx: a turnInQuest effect commits rewards once; its replay is silent', () => {
  const player = hero(1519);
  player.quests['m1_embers'] = { status: 'turnIn', counts: [4] };
  const gold = player.gold;
  const r1 = applyStoryEffects(
    player,
    [{ kind: 'turnInQuest', questId: 'm1_embers' }],
    ctxAt('n1'),
  );
  assertEquals(player.quests['m1_embers']?.status, 'done');
  assertEquals(player.gold, gold + 80, 'm1 reward gold granted');
  assertEquals(countOf(player, 'q_sealed_letter'), 1, 'm1 reward item granted');
  assert(r1.lines.some((line) => line.includes('+80 gold')));

  const before = JSON.stringify(player);
  const r2 = applyStoryEffects(
    player,
    [{ kind: 'turnInQuest', questId: 'm1_embers' }],
    ctxAt('n1'),
  );
  assertEquals(storyNoticeLines(r2), [], 'replay re-grants nothing');
  assertEquals(JSON.stringify(player), before);
});

Deno.test('tx: a mid-bundle collect shortfall refuses the turn-in, not just the removal', () => {
  // turnInQuest runs the central authority inside the draft: without the
  // quest's goods the whole bundle refuses and nothing else commits.
  const player = hero(1520);
  player.level = 6;
  player.quests['m4_floors'] = { status: 'done', counts: [] };
  player.quests['m5_arms'] = { status: 'turnIn', counts: [0] };
  addItem(player, 'm_iron_chunk', 1); // the quest needs 2
  const before = JSON.stringify(player);
  const bundle: StoryEffect[] = [
    { kind: 'setFlag', id: 'will_not_commit' },
    { kind: 'turnInQuest', questId: 'm5_arms' },
  ];
  assert(validateStoryBundle(player, bundle, ctxAt('n1', 'npc_bram')) !== undefined);
  assertThrows(() => applyStoryEffects(player, bundle, ctxAt('n1', 'npc_bram')));
  assertEquals(JSON.stringify(player), before, 'the flag does not commit either');
  assertEquals(player.quests['m5_arms']?.status, 'turnIn', 'the quest is untouched');
});

// ── the result describes the final committed draft (#137) ────────────────

/** A hero one toxin sample short of completing m6_toxin. */
function toxinHero(id: number): PlayerState {
  const player = hero(id);
  player.quests['m6_toxin'] = { status: 'active', counts: [0] };
  addItem(player, 'q_toxin_sample', 3);
  return player;
}

Deno.test('tx: readiness revoked by a later lock never reaches the result (#137)', () => {
  const player = toxinHero(1521);
  player.quests['m6_toxin']!.counts = [2]; // visible stale progress to clear
  const result = applyStoryEffects(player, [
    { kind: 'grantItem', itemId: 'q_toxin_sample', qty: 1 },
    { kind: 'lockQuest', questId: 'm6_toxin', reason: 'route_closed' },
  ], ctxAt('n1', 'npc_ferryman'));
  assertEquals(player.quests['m6_toxin']?.status, 'unavailable', 'the lock committed');
  assertEquals(player.quests['m6_toxin']?.counts, [0], 'stale objective progress is cleared');
  assertEquals(player.questOutcomes['m6_toxin']?.kind, 'locked');
  assertEquals(result.readyQuests, [], 'the revoked readiness is not announced');
  const notices = storyNoticeLines(result);
  assertEquals(
    notices.filter((line) => line.includes('ready to turn in')),
    [],
    'no false ready banner for a quest the same bundle locked',
  );
  // The quest was ACTIVE at transaction entry: exactly one canonical
  // cancellation notice (#145), no more, and the receipt replay is silent.
  assertEquals(
    notices.filter((line) => line.includes('no longer within reach')),
    ["📜 “The Water's Bane” is no longer within reach — that road has closed."],
    'one canonical route-closed notice',
  );
  const r2 = applyStoryEffects(player, [
    { kind: 'grantItem', itemId: 'q_toxin_sample', qty: 1 },
    { kind: 'lockQuest', questId: 'm6_toxin', reason: 'route_closed' },
  ], ctxAt('n1', 'npc_ferryman'));
  assertEquals(storyNoticeLines(r2), [], 'the replay emits no notice at all');
});

Deno.test('tx: readiness followed by resolve, fail or turn-in reports no false banner (#137)', () => {
  // The resolved leg uses the declared beacon route (#146): a quest that is
  // turn-in-ready and then resolved in the same bundle reports no readiness.
  const resolved = hero(1522);
  resolved.quests['sq_shrine_pact'] = { status: 'turnIn', counts: [1, 4] };
  const r1 = applyStoryEffects(resolved, [
    { kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 },
    { kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'kept' },
  ], ctxAt('n1', 'npc_ferryman'));
  assertEquals(resolved.quests['sq_shrine_pact']?.status, 'done');
  assertEquals(r1.readyQuests, [], 'a resolved quest is not also announced ready');

  const failed = toxinHero(1523);
  const r2 = applyStoryEffects(failed, [
    { kind: 'grantItem', itemId: 'q_toxin_sample', qty: 1 },
    { kind: 'failQuest', questId: 'm6_toxin', reason: 'too_late' },
  ], ctxAt('n1', 'npc_ferryman'));
  assertEquals(failed.quests['m6_toxin']?.status, 'unavailable');
  assertEquals(r2.readyQuests, [], 'a failed quest is not also announced ready');
  assertEquals(
    storyNoticeLines(r2).filter((line) => line.includes('can no longer be completed')),
    ["📜 “The Water's Bane” can no longer be completed — that chance has slipped away."],
    'failure has its own canonical cancellation copy (#145)',
  );

  // Turn-in inside the same bundle: the completing grant readies the quest,
  // the turn-in finishes it — the result carries the rewards, not a stale
  // "ready to turn in" banner.
  const turnedIn = toxinHero(1524);
  turnedIn.currentZone = 'hollowmere';
  const r3 = applyStoryEffects(turnedIn, [
    { kind: 'grantItem', itemId: 'q_toxin_sample', qty: 1 },
    { kind: 'turnInQuest', questId: 'm6_toxin' },
  ], ctxAt('n1', 'npc_ferryman'));
  assertEquals(turnedIn.quests['m6_toxin']?.status, 'done');
  assertEquals(r3.readyQuests, [], 'a turned-in quest is not also announced ready');
  assert(r3.lines.some((line) => line.includes('+400 gold')), 'the turn-in rewards are reported');
});

Deno.test('tx: readiness that survives the whole bundle is announced exactly once (#137)', () => {
  const player = toxinHero(1525);
  const result = applyStoryEffects(player, [
    { kind: 'grantItem', itemId: 'q_toxin_sample', qty: 1 },
    { kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 },
  ], ctxAt('n1', 'npc_ferryman'));
  assertEquals(player.quests['m6_toxin']?.status, 'turnIn');
  assertEquals(result.readyQuests, ['m6_toxin'], 'deduplicated final readiness');
  assertEquals(
    storyNoticeLines(result).filter((line) => line.includes('ready to turn in')).length,
    1,
    'exactly one notice',
  );
});

Deno.test('tx: startedQuests is a transition log, not a final-state summary (#137/#145)', () => {
  const player = hero(1526);
  player.currentZone = 'hollowmere'; // the Ferryman stands here
  // start + resolve is legal (only start + lock/fail is contradictory,
  // #145): the log records the start even though the final state is done.
  // The beacon route opens through its real gate: the recorded pledge
  // decision makes it available, and "kept" is its declared outcome (#146).
  const result = applyStoryEffects(player, [
    { kind: 'recordDecision', id: 'ferry_shrine_pledge', choiceId: 'promise' },
    { kind: 'storyEvent', event: 'shrine_allegiance_chosen' },
    { kind: 'startQuest', questId: 'sq_shrine_pact' },
    { kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'kept' },
  ], ctxAt('n1', 'npc_ferryman'));
  assertEquals(
    result.startedQuests,
    ['sq_shrine_pact'],
    'the log records that the bundle started it',
  );
  assertEquals(
    player.quests['sq_shrine_pact']?.status,
    'done',
    '…while the final state moved past it',
  );
  assertEquals(player.questOutcomes['sq_shrine_pact']?.kind, 'resolved');
  assertEquals(result.readyQuests, [], 'readiness, by contrast, is reconciled to the final draft');
});

// ── lifecycle reconciliation: cancellation and contradictions (#145) ─────

Deno.test('tx: locking a turn-in-ready quest cancels it — one notice, no readiness (#145)', () => {
  const player = hero(1530);
  player.quests['m6_toxin'] = { status: 'turnIn', counts: [4] };
  const result = applyStoryEffects(player, [
    { kind: 'lockQuest', questId: 'm6_toxin', reason: 'route_closed' },
  ], ctxAt('n1', 'npc_ferryman'));
  assertEquals(player.quests['m6_toxin']?.status, 'unavailable');
  assertEquals(player.quests['m6_toxin']?.counts, [0], 'stale progress cleared');
  assertEquals(player.questOutcomes['m6_toxin']?.kind, 'locked');
  const notices = storyNoticeLines(result);
  assertEquals(
    notices.filter((line) => line.includes('no longer within reach')).length,
    1,
    'exactly one cancellation notice',
  );
  assertEquals(
    notices.filter((line) => line.includes('ready to turn in')),
    [],
    'cancellation wins',
  );
  assertEquals(result.readyQuests, []);
});

Deno.test('tx: locking an UNACCEPTED quest closes it silently (#145)', () => {
  const player = hero(1531);
  player.level = 2;
  player.flags['zone_whisperwood'] = true;
  syncAvailability(player);
  assertEquals(player.quests['sq_ore']?.status, 'available');
  const result = applyStoryEffects(player, [
    { kind: 'lockQuest', questId: 'sq_ore', reason: 'route_closed' },
    { kind: 'lockQuest', questId: 'm6_toxin', reason: 'route_closed' }, // never even available
  ], ctxAt('n1'));
  assertEquals(player.quests['sq_ore']?.status, 'unavailable');
  assertEquals(player.questOutcomes['sq_ore']?.kind, 'locked');
  assertEquals(player.questOutcomes['m6_toxin']?.kind, 'locked');
  assertEquals(result.lines, [], 'no cancellation copy for quests the player never took');
  assertEquals(result.readyQuests, []);
});

Deno.test('tx: a reward readies another quest, then a lock cancels it — no stale readiness (#145)', () => {
  // m3_roots' turn-in grants the Iron Chunk that completes active sq_ore;
  // a later lock in the same bundle must suppress that readiness (#145).
  const player = hero(1532);
  player.quests['m3_roots'] = { status: 'turnIn', counts: [1] };
  player.quests['sq_ore'] = { status: 'active', counts: [0] };
  addItem(player, 'm_iron_chunk', 2); // one short of three
  const result = applyStoryEffects(player, [
    { kind: 'turnInQuest', questId: 'm3_roots' },
    { kind: 'lockQuest', questId: 'sq_ore', reason: 'route_closed' },
  ], ctxAt('n1', 'npc_bram'));
  assertEquals(player.quests['m3_roots']?.status, 'done');
  assertEquals(player.quests['sq_ore']?.status, 'unavailable', 'the exclusion committed');
  assertEquals(player.questOutcomes['sq_ore']?.kind, 'locked');
  assertEquals(result.readyQuests, [], 'reward-originated readiness is reconciled away');
  const notices = storyNoticeLines(result);
  assert(
    notices.some((line) => line.includes('🎁 Received: Iron Chunk')),
    'the reward is reported',
  );
  assertEquals(
    notices.filter((line) => line.includes('ready to turn in')),
    [],
    'no readiness claim for the cancelled quest',
  );
  assertEquals(
    notices.filter((line) => line.includes('no longer within reach')),
    ['📜 “Ore for the Forge” is no longer within reach — that road has closed.'],
    'one canonical cancellation notice for the started quest',
  );
});

Deno.test('tx: immediate acceptance readiness followed by exclusion is contradictory (#145)', () => {
  const player = hero(1533);
  player.level = 9;
  player.quests['m4_blessing'] = { status: 'done', counts: [] };
  player.flags['zone_hollowmere'] = true; // ever-visited → m5_fen readies on start
  syncAvailability(player);
  assertEquals(player.quests['m5_fen']?.status, 'available');
  const bundle: StoryEffect[] = [
    { kind: 'acceptQuest', questId: 'm5_fen' },
    { kind: 'lockQuest', questId: 'm5_fen', reason: 'route_closed' },
  ];
  const before = JSON.stringify(player);
  const refusal = validateStoryBundle(player, bundle, ctxAt('n1', 'npc_bram'));
  assert(refusal?.includes('same bundle'), `contradiction named: ${refusal}`);
  assertThrows(() => applyStoryEffects(player, bundle, ctxAt('n1', 'npc_bram')));
  assertEquals(JSON.stringify(player), before, 'the quest was never briefly started');
});

Deno.test('tx: acceptQuest + failQuest for the same quest refuse in either order (#145)', () => {
  const mk = (id: number) => {
    const player = hero(id);
    player.level = 2;
    player.quests['m1_embers'] = { status: 'done', counts: [4] };
    syncAvailability(player);
    assertEquals(player.quests['m2_letter']?.status, 'available');
    return player;
  };
  const fwd = mk(1534);
  const forward: StoryEffect[] = [
    { kind: 'acceptQuest', questId: 'm2_letter' },
    { kind: 'failQuest', questId: 'm2_letter', reason: 'too_late' },
  ];
  const refusal = validateStoryBundle(fwd, forward, ctxAt('n1'));
  assert(refusal?.includes('same bundle'), `contradiction named: ${refusal}`);
  assertThrows(() => applyStoryEffects(fwd, forward, ctxAt('n1')));
  assertEquals(fwd.quests['m2_letter']?.status, 'available', 'nothing committed');

  const rev = mk(1535);
  const reverse: StoryEffect[] = [
    { kind: 'failQuest', questId: 'm2_letter', reason: 'too_late' },
    { kind: 'acceptQuest', questId: 'm2_letter' },
  ];
  assert(
    validateStoryBundle(rev, reverse, ctxAt('n1')) !== undefined,
    'the accept sees the earlier failure',
  );
  assertThrows(() => applyStoryEffects(rev, reverse, ctxAt('n1')));
  assertEquals(rev.quests['m2_letter']?.status, 'available', 'nothing committed either');
});

// ── validation/application replay parity (#137) ──────────────────────────

Deno.test('tx: an already-receipted application validates and applies as a no-op (#137)', () => {
  const player = hero(1527);
  addItem(player, 'm_iron_chunk', 1);
  applyStoryEffects(player, [remove(1)], ctxAt('n1'));
  assertEquals(countOf(player, 'm_iron_chunk'), 0, 'the final chunk is gone');
  // Revalidating the SAME application identity agrees with application: the
  // recorded receipt makes it a valid replay no-op, even though a fresh run
  // of these effects would now refuse on the empty bag.
  assertEquals(validateStoryBundle(player, [remove(1)], ctxAt('n1')), undefined);
  const before = JSON.stringify(player);
  const result = applyStoryEffects(player, [remove(1)], ctxAt('n1'));
  assertEquals(result, {
    lines: [],
    readyQuests: [],
    startedQuests: [],
    events: [],
    decisions: [],
  });
  assertEquals(JSON.stringify(player), before, 'the replay touches nothing');
  // A DIFFERENT application identity is fresh business and still refuses.
  assert(validateStoryBundle(player, [remove(1)], ctxAt('n2')) !== undefined);
});

Deno.test('tx: a failed application acquires no receipt and stays retryable (#137)', () => {
  const player = hero(1528);
  const bundle = [remove(1)]; // no iron owned
  assert(validateStoryBundle(player, bundle, ctxAt('n1')) !== undefined);
  assertThrows(() => applyStoryEffects(player, bundle, ctxAt('n1')));
  assertEquals(player.storyReceipts, [], 'a refused application records no receipt');
  // No receipt, so validation keeps refusing the unmodified retry…
  assert(validateStoryBundle(player, bundle, ctxAt('n1')) !== undefined);
  // …and the corrected retry still applies.
  addItem(player, 'm_iron_chunk', 1);
  applyStoryEffects(player, bundle, ctxAt('n1'));
  assertEquals(countOf(player, 'm_iron_chunk'), 0);
});
