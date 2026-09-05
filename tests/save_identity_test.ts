/** #141: persisted content-identity validation.
 *
 * The stateVersion gate proves a save matches the current schema SHAPE, but
 * pre-launch content IDs can be renamed or removed without a shape change —
 * a same-version save can then carry identities that no longer resolve, and
 * rendering/mutation crashes on non-null assertions or degrades silently.
 *
 * These tests pin the central boundary (src/engine/validate.ts):
 *
 *  - the persisted identity locations listed in src/engine/validate.ts are
 *    checked (zones, items, skills, quests, flags, receipts, decisions,
 *    story events, scene args, battle) — a targeted list of high-risk
 *    locations, not an exhaustive runtime schema validation;
 *  - a fully valid current save passes untouched (byte-for-byte);
 *  - validation runs after the version gate and BEFORE mutation or render;
 *  - refusal leaves the stored JSON unchanged and points at /reset;
 *  - explicit /reset can still delete an unresolvable development save,
 *    while newer-version saves stay protected from deletion.
 */

import { assert, assertEquals, assertThrows } from '@std/assert';
import {
  assertSupportedSaveVersion,
  createPlayer,
  CURRENT_STATE_VERSION,
  SaveTooNewError,
  SaveTooOldError,
} from '../src/engine/character.ts';
import {
  assertResolvablePersistedIds,
  findUnresolvedPersistedIds,
  SaveUnresolvableError,
} from '../src/engine/validate.ts';
import { startBattle } from '../src/engine/combat.ts';
import { evalCondition } from '../src/engine/conditions.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { handleReset, handleStart } from '../src/handlers/commands.ts';
import { UNRESOLVABLE_SAVE_REPLY } from '../src/handlers/session.ts';
import { withRev } from '../src/codec.ts';
import { fakeCtxCapture } from './helpers.ts';
import { seeded } from './helpers.ts';
import { DIALOGUES } from '../src/content/dialogues.ts';
import { QUESTS } from '../src/content/quests.ts';
import type { PlayerState } from '../src/engine/types.ts';

const GONE = 'gone_404'; // matches no catalog id and no move/event name

/** First authored choice node + choice, for receipt/decision fixtures. */
function someChoice() {
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      if (n.kind === 'choice' && n.choices.length > 0) {
        return { dialogueId: d.id, nodeId: n.id, choiceId: n.choices[0].id };
      }
    }
  }
  throw new Error('no authored choice node found');
}

/** First authored recordDecision provenance tuple (#150): the exact
 * (decision, dialogue, node, choice) application current content produces. */
function someDecision() {
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      if (n.kind !== 'choice') continue;
      for (const c of n.choices) {
        for (const e of c.effects ?? []) {
          if (e.kind === 'recordDecision') {
            return { decisionId: e.id, dialogueId: d.id, nodeId: n.id, choiceId: c.id };
          }
        }
      }
    }
  }
  throw new Error('no authored recordDecision found');
}

/** First authored line node, for line-receipt fixtures. */
function someLine() {
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      if (n.kind === 'line') return { dialogueId: d.id, nodeId: n.id };
    }
  }
  throw new Error('no authored line node found');
}

/** First story-event name current content emits or consumes. */
function someStoryEvent(): string {
  for (const q of QUESTS) {
    for (const o of q.objectives) {
      if (o.kind === 'storyEvent') return o.target;
    }
  }
  throw new Error('no authored story event found');
}

function expectProblems(p: PlayerState, family: string): void {
  const problems = findUnresolvedPersistedIds(p);
  assert(
    problems.some((pr) => pr.family === family),
    `expected a '${family}' problem, got: ${JSON.stringify(problems)}`,
  );
  assertThrows(
    () => assertResolvablePersistedIds(p),
    SaveUnresolvableError,
    'no longer resolves',
  );
}

Deno.test('identity gate: a fully valid current save passes byte-for-byte (#141)', () => {
  const p = createPlayer(960, 'T', 'warrior');
  // Exercise every family with REAL content ids so the valid case is rich:
  const { dialogueId, nodeId, choiceId } = someChoice();
  const line = someLine();
  const decision = someDecision();
  p.quests[QUESTS[0].id] = { status: 'active', counts: [0] };
  p.questOutcomes[QUESTS[1].id] = { kind: 'locked', at: 1 };
  p.flags['forge_i_w_warrior_1'] = 2;
  p.storyReceipts.push(`choice:${dialogueId}:${nodeId}:${choiceId}`);
  p.storyReceipts.push(`line:${line.dialogueId}:${line.nodeId}`);
  p.decisions[decision.decisionId] = {
    choiceId: decision.choiceId,
    dialogueId: decision.dialogueId,
    nodeId: decision.nodeId,
    chosenAt: 1,
  };
  p.storyEvents.push(someStoryEvent());
  p.battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
    player: p,
    rng: seeded(1),
  })!.battle;
  p.battle.rewards = { xp: 1, gold: 1, drops: ['c_minor_potion'] };
  p.battle.procs = { 'w_warrior_1:0': { count: 1, round: 1 } };
  const before = JSON.stringify(p);

  assertEquals(findUnresolvedPersistedIds(p), []);
  assertResolvablePersistedIds(p); // must not throw
  assertEquals(JSON.stringify(p), before, 'validation never mutates the save');
});

Deno.test('identity gate: zone families (#141)', () => {
  const p = createPlayer(961, 'T', 'warrior');
  p.currentZone = GONE;
  expectProblems(p, 'currentZone');

  const q = createPlayer(962, 'T', 'warrior');
  q.unlockedZones.push(GONE);
  expectProblems(q, 'unlockedZones');
});

Deno.test('identity gate: item, skill and quest families (#141)', () => {
  const p = createPlayer(963, 'T', 'warrior');
  p.inventory.push({ id: GONE, qty: 1 });
  expectProblems(p, 'inventory');

  const eq = createPlayer(964, 'T', 'warrior');
  eq.equipment.weapon = GONE;
  expectProblems(eq, 'equipment');

  const sk = createPlayer(965, 'T', 'warrior');
  sk.skills.push(GONE);
  expectProblems(sk, 'skills');

  const qu = createPlayer(966, 'T', 'warrior');
  qu.quests[GONE] = { status: 'active', counts: [0] };
  expectProblems(qu, 'quests');

  const qo = createPlayer(967, 'T', 'warrior');
  qo.questOutcomes[GONE] = { kind: 'resolved', outcome: 'gone', at: 1 };
  expectProblems(qo, 'questOutcomes');
});

Deno.test('identity gate: flags and narrative records (#141)', () => {
  const p = createPlayer(968, 'T', 'warrior');
  p.flags[`forge_i_${GONE}`] = 3;
  expectProblems(p, 'flags');

  const ev = createPlayer(969, 'T', 'warrior');
  ev.storyEvents.push(GONE);
  expectProblems(ev, 'storyEvents');

  const rc = createPlayer(970, 'T', 'warrior');
  rc.storyReceipts.push(`choice:${GONE}:x:y`);
  expectProblems(rc, 'storyReceipts');

  const rc2 = createPlayer(971, 'T', 'warrior');
  rc2.storyReceipts.push('totally-unstructured');
  expectProblems(rc2, 'storyReceipts');

  const dc = createPlayer(972, 'T', 'warrior');
  const { dialogueId, nodeId, choiceId } = someChoice();
  dc.decisions[GONE] = { choiceId, dialogueId, nodeId, chosenAt: 1 };
  expectProblems(dc, 'decisions');

  const dc2 = createPlayer(973, 'T', 'warrior');
  dc2.decisions['ferry_shrine_pledge'] = { choiceId: GONE, dialogueId, nodeId, chosenAt: 1 };
  expectProblems(dc2, 'decisions');
});

Deno.test('identity gate: a decision is valid only against its exact authored provenance (#150)', () => {
  // The authored tuple itself is legitimate: the recorded decision id with
  // the exact dialogue/node/choice that can produce it.
  const decision = someDecision();
  const ok = createPlayer(994, 'T', 'warrior');
  ok.decisions[decision.decisionId] = {
    choiceId: decision.choiceId,
    dialogueId: decision.dialogueId,
    nodeId: decision.nodeId,
    chosenAt: 1,
  };
  assertEquals(findUnresolvedPersistedIds(ok), []);

  // Finding 2 (#150): every component id can resolve while the COMBINATION
  // is impossible — the same valid decision id persisted under an unrelated
  // but individually valid dialogue choice is refused, not matched.
  const { dialogueId, nodeId, choiceId } = someChoice();
  if (
    dialogueId === decision.dialogueId && nodeId === decision.nodeId &&
    choiceId === decision.choiceId
  ) {
    throw new Error('fixture choice collides with the authored decision tuple');
  }
  const forged = createPlayer(995, 'T', 'warrior');
  forged.decisions[decision.decisionId] = { choiceId, dialogueId, nodeId, chosenAt: 1 };
  expectProblems(forged, 'decisions');
});

Deno.test('identity gate: scene identity arguments (#141)', () => {
  const it = createPlayer(974, 'T', 'warrior');
  it.scene = { view: 'item', arg: GONE };
  expectProblems(it, 'scene.arg');

  const qu = createPlayer(975, 'T', 'warrior');
  qu.scene = { view: 'quests', arg: GONE };
  expectProblems(qu, 'scene.arg');

  const np = createPlayer(976, 'T', 'warrior');
  np.scene = { view: 'npc', arg: GONE };
  expectProblems(np, 'scene.arg');

  const dl = createPlayer(977, 'T', 'warrior');
  dl.scene = { view: 'dialogue', arg: someLine().dialogueId, arg2: GONE };
  expectProblems(dl, 'scene.arg2');

  const cf = createPlayer(978, 'T', 'warrior');
  const { dialogueId, nodeId } = someChoice();
  cf.scene = { view: 'dialogue', arg: dialogueId, arg2: nodeId, arg3: `confirm:${GONE}` };
  expectProblems(cf, 'scene.arg3');

  const eq = createPlayer(979, 'T', 'warrior');
  eq.scene = { view: 'equippedItem', arg: GONE };
  expectProblems(eq, 'scene.arg');

  const vw = createPlayer(980, 'T', 'warrior');
  vw.scene = { view: GONE } as unknown as PlayerState['scene'];
  expectProblems(vw, 'scene.view');
});

Deno.test('identity gate: shop selection is an item ID; sell pagination is not (#187)', () => {
  const p = createPlayer(1871, 'Shopper', 'warrior');
  p.scene = { view: 'shop', arg: '1', arg2: 'm_iron_chunk' };
  assertResolvablePersistedIds(p);
  p.scene.arg2 = GONE;
  expectProblems(p, 'scene.arg2');
  p.scene = { view: 'shop', arg: 'sell', arg2: '1' };
  assertResolvablePersistedIds(p);
  p.scene = { view: 'shop', arg: '1' };
  assertResolvablePersistedIds(p);
});

Deno.test('identity gate: an unresolved shop selection refuses /start without rewriting (#187)', async () => {
  const p = createPlayer(1872, 'Shopper', 'warrior');
  p.scene = { view: 'shop', arg: '0', arg2: GONE };
  const store = new MemoryStore();
  await store.set(p.userId, p);
  const before = structuredClone(p);
  const capture = fakeCtxCapture(p.userId);
  await store.withLock(p.userId, () => handleStart(capture.ctx, store));
  assertEquals(await store.get(p.userId), before);
  assertEquals(capture.sends.length, 0);
  assertEquals(capture.replies, [UNRESOLVABLE_SAVE_REPLY]);
});

Deno.test('identity gate: battle identities (#141)', () => {
  function withBattle(mutate: (p: PlayerState) => void): PlayerState {
    const p = createPlayer(981, 'T', 'warrior');
    p.battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
      player: p,
      rng: seeded(2),
    })!.battle;
    mutate(p);
    return p;
  }

  expectProblems(withBattle((p) => p.battle!.enemy.id = GONE), 'battle.enemy');
  expectProblems(
    withBattle((p) => p.battle!.origin = { kind: 'explore', zoneId: GONE }),
    'battle.origin',
  );
  expectProblems(
    withBattle((p) =>
      p.battle!.origin = {
        kind: 'dungeon',
        zoneId: 'whisperwood',
        dungeonId: GONE,
        floor: 1,
        boss: false,
      }
    ),
    'battle.origin',
  );
  expectProblems(
    withBattle((p) =>
      p.battle!.origin = {
        kind: 'dungeon',
        zoneId: 'whisperwood',
        dungeonId: 'd_rootbound',
        floor: 99,
        boss: true,
      }
    ),
    'battle.origin',
  );
  expectProblems(withBattle((p) => p.battle!.cooldowns[GONE] = 2), 'battle.cooldowns');
  expectProblems(
    withBattle((p) =>
      p.battle!.effectInstances.push({
        iid: 'x1',
        defId: GONE,
        name: 'X',
        side: 'player',
        source: { kind: 'item', id: GONE, name: 'X' },
        kind: 'statmod',
        tags: [],
        stacking: 'refresh',
        appliedRound: 1,
        remaining: 1,
        expiresRound: 2,
        removable: true,
      })
    ),
    'battle.effectSources',
  );
  expectProblems(
    withBattle((p) => p.battle!.procs = { [`${GONE}:0`]: { count: 1, round: 1 } }),
    'battle.procs',
  );
  expectProblems(
    withBattle((p) => p.battle!.rewards = { xp: 1, gold: 1, drops: [GONE] }),
    'battle.rewards',
  );
});

Deno.test('identity gate: named resolved outcomes must resolve against their quest (#146)', () => {
  // The declared pair is legitimate: sq_shrine_pact declares "kept".
  const ok = createPlayer(989, 'T', 'warrior');
  ok.questOutcomes['sq_shrine_pact'] = { kind: 'resolved', outcome: 'kept', at: 1 };
  assertEquals(findUnresolvedPersistedIds(ok), []);

  // A value the quest does not declare — a typo — is reported, never
  // repaired or substituted.
  const undeclared = createPlayer(990, 'T', 'warrior');
  undeclared.questOutcomes['sq_shrine_pact'] = { kind: 'resolved', outcome: 'typo', at: 1 };
  expectProblems(undeclared, 'questOutcomes');

  // "kept" is declared by sq_shrine_pact alone: it does not authorize a
  // cross-quest resolved record.
  const cross = createPlayer(991, 'T', 'warrior');
  cross.questOutcomes['sq_ledger_debt'] = { kind: 'resolved', outcome: 'kept', at: 1 };
  expectProblems(cross, 'questOutcomes');

  // A resolved record naming NO outcome is malformed the same way — the
  // discriminated union makes it unrepresentable in source, but a JSON save
  // can still carry one, so the runtime gate keeps catching it (#150).
  const empty = createPlayer(992, 'T', 'warrior');
  empty.questOutcomes['sq_shrine_pact'] = {
    kind: 'resolved',
    at: 1,
  } as unknown as PlayerState['questOutcomes'][string];
  expectProblems(empty, 'questOutcomes');

  // Failed/locked records carry no named outcome and stay valid.
  const terminal = createPlayer(993, 'T', 'warrior');
  terminal.questOutcomes['m2_letter'] = { kind: 'locked', at: 1 };
  assertEquals(findUnresolvedPersistedIds(terminal), []);
});

Deno.test('identity gate: a named outcome on a failed/locked record is refused (#150)', () => {
  // Finding 1 (#150): a locked save carrying a named outcome would
  // otherwise satisfy outcome conditions as though the resolution happened.
  // The gate refuses it — never repairs, never substitutes.
  const locked = createPlayer(996, 'T', 'warrior');
  locked.questOutcomes['sq_shrine_pact'] = {
    kind: 'locked',
    outcome: 'kept',
    at: 1,
  } as unknown as PlayerState['questOutcomes'][string];
  expectProblems(locked, 'questOutcomes');

  const failed = createPlayer(997, 'T', 'warrior');
  failed.questOutcomes['sq_shrine_pact'] = {
    kind: 'failed',
    outcome: 'kept',
    at: 1,
  } as unknown as PlayerState['questOutcomes'][string];
  expectProblems(failed, 'questOutcomes');

  // The engine-produced shapes (failQuest/lockQuest with reason/by) stay
  // legitimate — the invariant is about `outcome`, not the extra fields.
  const authored = createPlayer(998, 'T', 'warrior');
  authored.questOutcomes['m2_letter'] = {
    kind: 'locked',
    reason: 'shrine_route',
    by: 'dlg_ferry_promise',
    at: 1,
  };
  assertEquals(findUnresolvedPersistedIds(authored), []);
});

Deno.test('conditions: an outcome query matches resolved records only (#150)', () => {
  const p = createPlayer(999, 'T', 'warrior');
  // The legitimate resolution matches — with or without an explicit kind.
  p.questOutcomes['sq_shrine_pact'] = { kind: 'resolved', outcome: 'kept', at: 1 };
  assert(evalCondition(p, { questOutcome: { questId: 'sq_shrine_pact', outcome: 'kept' } }));
  assert(
    evalCondition(p, {
      questOutcome: { questId: 'sq_shrine_pact', kind: 'resolved', outcome: 'kept' },
    }),
  );

  // Finding 1 (#150): a malformed locked record posing as "kept" satisfies
  // no outcome query — the resolution never happened.
  const locked = JSON.parse(
    JSON.stringify(p),
  ) as PlayerState;
  locked.questOutcomes['sq_shrine_pact'] = {
    kind: 'locked',
    outcome: 'kept',
    at: 1,
  } as unknown as PlayerState['questOutcomes'][string];
  assert(
    !evalCondition(locked, { questOutcome: { questId: 'sq_shrine_pact', outcome: 'kept' } }),
    'a locked record never matches an outcome query',
  );
  assert(
    !evalCondition(locked, {
      questOutcome: { questId: 'sq_shrine_pact', kind: 'resolved', outcome: 'kept' },
    }),
  );
  // Kind-only queries behave exactly as before.
  assert(evalCondition(locked, { questOutcome: { questId: 'sq_shrine_pact', kind: 'locked' } }));
});

Deno.test('identity gate: handlers refuse before mutation, render, or save (#141)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(982, 'T', 'warrior');
  p.gold = 555;
  p.messageId = 700;
  p.uiRev = 1;
  p.currentZone = GONE; // same-version save with a dangling identity
  await store.set(982, p);
  assertSupportedSaveVersion(p); // the schema gate alone would PASS this save
  const storedBefore = JSON.stringify(await store.get(982));

  // /start explains the /reset path and never renders or rewrites.
  const start = fakeCtxCapture(982);
  await handleStart(start.ctx, store);
  assertEquals(start.sends.length + start.edits.length, 0, '/start renders nothing');
  assert(start.replies.some((r) => r === UNRESOLVABLE_SAVE_REPLY), '/start points at /reset');

  // A gameplay callback is refused the same way: no mutation, no render, no
  // save — and no fallback/replacement content is introduced.
  const tap = fakeCtxCapture(982, 700, withRev(1, 'z:sh'));
  await handleCallback(tap.ctx, store);
  assert(tap.replies.some((r) => r === UNRESOLVABLE_SAVE_REPLY));
  assertEquals(tap.edits.length + tap.sends.length, 0, 'no game render is committed');
  const after = await store.get(982);
  assertEquals(JSON.stringify(after), storedBefore, 'the stored save is untouched');
  assertEquals(after!.gold, 555, 'no mutation ran');
  assertEquals(after!.uiRev, 1, 'no render revision advanced');
  assertEquals(after!.currentZone, GONE, 'the player is never silently relocated');
});

Deno.test('identity gate: explicit /reset clears an unresolvable save; newer saves stay protected (#141)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(983, 'T', 'warrior');
  p.currentZone = GONE;
  await store.set(983, p);

  // The unloadable save cannot stage a confirmation, so explicit /reset
  // deletes it and offers the picker — the documented pre-launch escape.
  const reset = fakeCtxCapture(983);
  await handleReset(reset.ctx, store);
  assertEquals(await store.get(983), undefined, 'the unresolvable save is deleted');
  assert(
    JSON.stringify(reset.sends[0]).includes('Choose who you will be'),
    'the stateless class picker is delivered',
  );

  // A newer-version save is refused WITHOUT deletion, even when its
  // identities also fail to resolve.
  const newer = createPlayer(984, 'T', 'warrior');
  newer.stateVersion = CURRENT_STATE_VERSION + 1;
  newer.currentZone = GONE;
  await store.set(984, newer);
  const resetNewer = fakeCtxCapture(984);
  await handleReset(resetNewer.ctx, store);
  assert(
    resetNewer.replies.some((r) => String(r).includes('newer version')),
    'the newer-save refusal is delivered',
  );
  assertEquals((await store.get(984))?.stateVersion, CURRENT_STATE_VERSION + 1, 'not deleted');
});

Deno.test('identity gate: the three refusal classes stay distinct (#141)', () => {
  const tooOld = createPlayer(986, 'T', 'warrior');
  tooOld.stateVersion = CURRENT_STATE_VERSION - 1;
  tooOld.currentZone = GONE;
  assertThrows(() => assertSupportedSaveVersion(tooOld), SaveTooOldError);

  const tooNew = createPlayer(987, 'T', 'warrior');
  tooNew.stateVersion = CURRENT_STATE_VERSION + 1;
  assertThrows(() => assertSupportedSaveVersion(tooNew), SaveTooNewError);

  const dangling = createPlayer(988, 'T', 'warrior');
  dangling.currentZone = GONE;
  assertSupportedSaveVersion(dangling); // schema is current…
  assertThrows(() => assertResolvablePersistedIds(dangling), SaveUnresolvableError); // …identity is not
});

Deno.test('identity gate: fresh saves of every class always resolve (#141)', () => {
  for (const cls of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    assertEquals(findUnresolvedPersistedIds(createPlayer(985, 'T', cls)), []);
  }
});
