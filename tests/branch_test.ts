/**
 * The consequential branch (#132): the Ferryman's shrine pledge starts one
 * of two follow-up quests and permanently locks the other. Covers the
 * whole authored workflow — queryable quest outcomes in the shared
 * condition language, declared named outcomes, the non-mutating deferral,
 * one-shot application, save/rerender stability, and a route that can
 * never be re-opened once commitment lands.
 */

import { assert, assertEquals } from '@std/assert';
import { withRev } from '../src/codec.ts';
import { createPlayer } from '../src/engine/character.ts';
import { syncAvailability } from '../src/engine/quests.ts';
import { onKill } from '../src/engine/quests.ts';
import { npcTopics } from '../src/engine/npc.ts';
import { evalCondition } from '../src/engine/conditions.ts';
import { applyDialogueChoice, applyStoryEffects } from '../src/engine/story.ts';
import type { StoryContext } from '../src/engine/story.ts';
import { renderDialogue } from '../src/render/views.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { fakeCtx } from './helpers.ts';
import type { PlayerState } from '../src/engine/types.ts';

const FERRY = 'npc_ferryman';
const PLEDGE_NODE = 'n3';

function ferryHero(id: number): PlayerState {
  const p = createPlayer(id, 'T', 'warrior');
  syncAvailability(p);
  p.currentZone = 'hollowmere';
  p.unlockedZones.push('hollowmere');
  p.flags['zone_hollowmere'] = true;
  return p;
}

/** Routes a stored hero to the pledge's choice node through the real
 * callback router (the same surface players use). */
async function atPledgeChoice(store: MemoryStore, userId: number) {
  const tap = async (data: string) => {
    const before = (await store.get(userId))!;
    await handleCallback(fakeCtx(userId, 400, withRev(before.uiRev ?? 0, data)), store);
    return (await store.get(userId))!;
  };
  await tap('npc:lore:ferry_promise');
  await tap('dlg:nx:n2');
  const cur = await tap('dlg:nx:n3');
  assertEquals(cur.scene.arg2, PLEDGE_NODE);
  return tap;
}

/** Commits the pledge response `choice` through select → stage → confirm. */
async function commitPledge(store: MemoryStore, userId: number, choice: string) {
  const tap = await atPledgeChoice(store, userId);
  await tap(`dlg:ch:${choice}`);
  return tap(`dlg:cf:${choice}`);
}

Deno.test('branch: the deferral leaves both routes open and mutates nothing', async () => {
  const store = new MemoryStore();
  const p = ferryHero(1700);
  p.messageId = 400;
  p.scene = { view: 'npc', arg: FERRY };
  await store.set(1700, p);
  const tap = await atPledgeChoice(store, 1700);
  const before = JSON.stringify({ d: p.decisions, q: p.quests, o: p.questOutcomes });
  const cur = await tap('dlg:bk'); // "Not now"
  assertEquals(cur.scene.view, 'npc', 'deferral returns to the topic menu');
  assertEquals(
    JSON.stringify({ d: cur.decisions, q: cur.quests, o: cur.questOutcomes }),
    before,
    'no decision, no route started, no route locked',
  );
  assertEquals(cur.quests['sq_shrine_pact']?.status ?? 'unavailable', 'unavailable');
  assertEquals(cur.quests['sq_ledger_debt']?.status ?? 'unavailable', 'unavailable');
  // Both routes remain open: the pledge topic is still offered.
  assert(npcTopics(cur, FERRY).some((t) => t.id === 'ferry_promise'));
});

Deno.test('branch: the promise route starts the beacon and permanently locks the debt', async () => {
  const store = new MemoryStore();
  const p = ferryHero(1701);
  p.messageId = 400;
  p.scene = { view: 'npc', arg: FERRY };
  await store.set(1701, p);
  const cur = await commitPledge(store, 1701, 'promise');
  assertEquals(cur.decisions['ferry_shrine_pledge']?.choiceId, 'promise');
  assertEquals(cur.quests['sq_shrine_pact']?.status, 'active');
  assertEquals(cur.quests['sq_shrine_pact']?.counts, [1, 0], 'the shared parent event credits');
  assertEquals(cur.questOutcomes['sq_ledger_debt']?.kind, 'locked');
  // Permanent exclusion: ordinary prerequisites never resurrect the lock.
  const reloaded = (await store.get(1701))!;
  syncAvailability(reloaded);
  assertEquals(reloaded.quests['sq_ledger_debt']?.status ?? 'unavailable', 'unavailable');
  // The chosen route is live business at the Ferryman, not an offer.
  const topics = npcTopics(reloaded, FERRY);
  assert(topics.some((t) => t.kind === 'questActive' && t.id === 'sq_shrine_pact'));
  assert(!topics.some((t) => t.kind === 'questOffer'));
  // The decided topic no longer presents itself as undecided (#132): the
  // pledge topic is gone, the ledger aftermath is in its place.
  assert(!topics.some((t) => t.id === 'ferry_promise'));
  assert(topics.some((t) => t.id === 'ferry_ledger'));
});

Deno.test('branch: the decline route starts the debt and permanently locks the beacon', async () => {
  const store = new MemoryStore();
  const p = ferryHero(1702);
  p.messageId = 400;
  p.scene = { view: 'npc', arg: FERRY };
  await store.set(1702, p);
  const cur = await commitPledge(store, 1702, 'decline');
  assertEquals(cur.decisions['ferry_shrine_pledge']?.choiceId, 'decline');
  assertEquals(cur.quests['sq_ledger_debt']?.status, 'active');
  assertEquals(cur.questOutcomes['sq_shrine_pact']?.kind, 'locked');
  syncAvailability(cur);
  assertEquals(cur.quests['sq_shrine_pact']?.status ?? 'unavailable', 'unavailable');
});

Deno.test('branch: after commitment the other choice can never unlock both routes', async () => {
  const store = new MemoryStore();
  const p = ferryHero(1703);
  p.messageId = 400;
  p.scene = { view: 'npc', arg: FERRY };
  await store.set(1703, p);
  await commitPledge(store, 1703, 'promise');
  const cur = (await store.get(1703))!;
  // The ledger forbids re-deciding: the scene routed on, and a fresh
  // engine-level attempt with the other choice is refused untouched.
  cur.scene = { view: 'dialogue', arg: 'dlg_ferry_promise', arg2: PLEDGE_NODE };
  const before = JSON.stringify({ q: cur.quests, o: cur.questOutcomes });
  const r = applyDialogueChoice(cur, { choiceId: 'decline', now: 99 });
  assertEquals(r.ok, false, 'the ledger wins over any later choice');
  assertEquals(
    JSON.stringify({ q: cur.quests, o: cur.questOutcomes }),
    before,
    'the locked route stays locked',
  );
  // Decision-gated availability is exclusive by construction: whatever the
  // decision, exactly ONE route is ever available (here: none — the chosen
  // one is already active, the other locked).
  syncAvailability(cur);
  const openable = ['sq_shrine_pact', 'sq_ledger_debt'].filter(
    (id) => cur.quests[id]?.status === 'available',
  );
  assertEquals(openable, [], 'no route is (re)offered after commitment');
});

Deno.test('branch: the committed state survives save/reload and rerenders stably', async () => {
  const store = new MemoryStore();
  const p = ferryHero(1704);
  p.messageId = 400;
  p.scene = { view: 'npc', arg: FERRY };
  await store.set(1704, p);
  await commitPledge(store, 1704, 'promise');
  const cur = (await store.get(1704))!;
  cur.scene = { view: 'npc', arg: FERRY };
  const a = JSON.stringify(npcTopics(cur, FERRY));
  const b = JSON.stringify(npcTopics(cur, FERRY));
  assertEquals(a, b, 'the post-commitment topic menu is stable');
  assert(!a.includes('ferry_promise'));
});

Deno.test('branch: the beacon route completes ordinarily — done, no outcome entry', () => {
  const p = ferryHero(1707);
  p.scene = {
    view: 'dialogue',
    arg: 'dlg_ferry_promise',
    arg2: PLEDGE_NODE,
    arg3: 'confirm:promise',
  };
  const r = applyDialogueChoice(p, { choiceId: 'promise', now: 1 });
  assert(r.ok);
  for (let i = 0; i < 4; i++) onKill(p, 'e_wisp');
  assertEquals(p.quests['sq_shrine_pact']?.status, 'turnIn');
  const gold = p.gold;
  const ctx: StoryContext = {
    dialogueId: 'dlg_sq_shrine_pact_turnin',
    nodeId: 'ta',
    npcId: FERRY,
    now: 2,
  };
  applyStoryEffects(p, [{ kind: 'turnInQuest', questId: 'sq_shrine_pact' }], ctx);
  assertEquals(p.quests['sq_shrine_pact']?.status, 'done');
  assertEquals(p.questOutcomes['sq_shrine_pact'], undefined, 'ordinary completion: no entry');
  assert(p.gold > gold, 'the ordinary turn-in pays its reward');
  // Query semantics (#132): ordinary completion is read through
  // questStatus; the named outcome condition stays false.
  assert(evalCondition(p, { questStatus: { questId: 'sq_shrine_pact', is: 'done' } }));
  assert(
    !evalCondition(p, {
      questOutcome: { questId: 'sq_shrine_pact', kind: 'resolved' },
    }),
  );
  assert(
    !evalCondition(p, {
      questOutcome: { questId: 'sq_shrine_pact', kind: 'resolved', outcome: 'kept' },
    }),
  );
});

Deno.test('branch: keeping the light resolves the named outcome and forgoes the reward', () => {
  const p = ferryHero(1708);
  p.scene = {
    view: 'dialogue',
    arg: 'dlg_ferry_promise',
    arg2: PLEDGE_NODE,
    arg3: 'confirm:promise',
  };
  const r = applyDialogueChoice(p, { choiceId: 'promise', now: 1 });
  assert(r.ok);
  for (let i = 0; i < 4; i++) onKill(p, 'e_wisp');
  assertEquals(p.quests['sq_shrine_pact']?.status, 'turnIn');
  const gold = p.gold;
  const ctx: StoryContext = {
    dialogueId: 'dlg_sq_shrine_pact_turnin',
    nodeId: 'ta',
    npcId: FERRY,
    now: 2,
  };
  applyStoryEffects(p, [{ kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'kept' }], ctx);
  assertEquals(p.quests['sq_shrine_pact']?.status, 'done');
  assertEquals(p.questOutcomes['sq_shrine_pact']?.kind, 'resolved');
  assertEquals(p.questOutcomes['sq_shrine_pact']?.outcome, 'kept');
  assertEquals(p.gold, gold, 'no reward — the light was kept, not given');
  // The named outcome is queryable and composes through all/any/not (#132).
  assert(evalCondition(p, {
    questOutcome: { questId: 'sq_shrine_pact', kind: 'resolved', outcome: 'kept' },
  }));
  assert(evalCondition(p, {
    all: [
      { questOutcome: { questId: 'sq_shrine_pact', outcome: 'kept' } },
      { not: { questStatus: { questId: 'sq_shrine_pact', is: 'active' } } },
    ],
  }));
  assert(
    !evalCondition(p, {
      questOutcome: { questId: 'sq_shrine_pact', kind: 'failed' },
    }),
  );
  // The shipped aftermath topic lists for the decided player, and its
  // kept-light response is available for exactly this outcome.
  const topics = npcTopics(p, FERRY);
  assert(topics.some((t) => t.id === 'ferry_ledger'), 'the aftermath topic is offered');
  p.scene = { view: 'dialogue', arg: 'dlg_ferry_aftermath', arg2: 'a1' };
  const view = JSON.stringify(renderDialogue(p));
  assert(view.includes('dlg:ch:keptlight'), 'the kept-light reaction renders');
  assert(view.includes('dlg:ch:beacon'), 'the believer guidance still renders for the decision');
  assert(!view.includes('dlg:ch:debt'), 'the debt guidance is not this player\u2019s');
});

Deno.test('branch: an undeclared named outcome refuses at runtime (#132)', () => {
  const p = ferryHero(1709);
  p.scene = {
    view: 'dialogue',
    arg: 'dlg_ferry_promise',
    arg2: PLEDGE_NODE,
    arg3: 'confirm:promise',
  };
  const ok = applyDialogueChoice(p, { choiceId: 'promise', now: 1 });
  assert(ok.ok);
  for (let i = 0; i < 4; i++) onKill(p, 'e_wisp');
  const ctx: StoryContext = {
    dialogueId: 'dlg_test',
    nodeId: 'nX',
    npcId: FERRY,
    now: 3,
  };
  // 'sq_shrine_pact' declares only "kept".
  const before = JSON.stringify(p.quests['sq_shrine_pact']);
  assert(
    applyStoryEffects !== undefined &&
      validateRefusal(p, ctx),
    'an undeclared outcome is refused',
  );
  assertEquals(JSON.stringify(p.quests['sq_shrine_pact']), before);
});

function validateRefusal(p: PlayerState, ctx: StoryContext): boolean {
  try {
    applyStoryEffects(
      p,
      [{ kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'traded' }],
      ctx,
    );
    return false;
  } catch {
    return true;
  }
}
