import { expectScene } from './helpers.ts';
/**
 * The consequential branch (#132, #147): the Ferryman's shrine pledge
 * advances a real shared parent quest, starts one of two follow-up routes
 * and permanently locks the other. Covers the whole authored workflow —
 * the pledge parent accepted BEFORE any commitment, the shared event
 * advancing that already-active parent, queryable quest outcomes in the
 * shared condition language, declared named outcomes, the non-mutating
 * deferral, one-shot application, save/rerender stability, the aftermath's
 * full state matrix, and routes that can never be re-opened once
 * commitment lands.
 */

import { assert, assertEquals } from '@std/assert';
import { withRev } from '../src/codec.ts';
import { onKill, syncAvailability } from '../src/engine/quests.ts';
import { npcTopics } from '../src/engine/npc.ts';
import { evalCondition } from '../src/engine/conditions.ts';
import { applyDialogueChoice, applyStoryEffects } from '../src/engine/story.ts';
import type { StoryContext } from '../src/engine/story.ts';
import { renderDialogue } from '../src/render/views.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { fakeCtx, namedOutcome } from './helpers.ts';
import type { PlayerState } from '../src/engine/types.ts';
import { ferryHero } from './helpers_story.ts';

const FERRY = 'npc_ferryman';
const PLEDGE_NODE = 'n3';
const PARENT = 'sq_shrine_pledge';

/** Routes a stored hero through the parent's offer, then to the pledge's
 * choice node through the real callback router (the same surface players
 * use). */
async function atPledgeChoice(store: MemoryStore, userId: number) {
  const tap = async (data: string) => {
    const before = (await store.get(userId))!;
    await handleCallback(fakeCtx(userId, 400, withRev(before.uiRev ?? 0, data)), store);
    return (await store.get(userId))!;
  };
  await tap(`npc:q:${PARENT}`); // the pledge parent's offer topic
  await tap('dlg:ch:accept'); // carry the shrine's question
  await tap('npc:lore:ferry_promise');
  await tap('dlg:nx:n2');
  const cur = await tap('dlg:nx:n3');
  assertEquals(expectScene(cur, 'dialogue').nodeId, PLEDGE_NODE);
  return tap;
}

/** Commits the pledge response `choice` through select → stage → confirm. */
async function commitPledge(store: MemoryStore, userId: number, choice: string) {
  const tap = await atPledgeChoice(store, userId);
  await tap(`dlg:ch:${choice}`);
  return tap(`dlg:cf:${choice}`);
}

/** Stages and applies `choice` from the pledge's confirm panel (engine
 * surface, for state-matrix fixtures). */
function pledgeFrom(player: PlayerState, choice: string): void {
  player.scene = {
    view: 'dialogue',
    dialogueId: 'dlg_ferry_promise',
    nodeId: PLEDGE_NODE,
    confirmation: choice,
  };
  const result = applyDialogueChoice(player, { choiceId: choice, now: 1 });
  assert(result.ok);
}

Deno.test('branch: the deferral leaves the parent pending and both routes open', async () => {
  const store = new MemoryStore();
  const player = ferryHero(1700);
  player.messageId = 400;
  player.scene = { view: 'npc', npcId: FERRY };
  await store.set(1700, player);
  const tap = await atPledgeChoice(store, 1700);
  const story = (player: PlayerState) =>
    JSON.stringify({
      d: player.decisions,
      q: player.quests,
      o: player.questOutcomes,
      e: player.storyEvents,
    });
  const before = story(player);
  const cur = await tap('dlg:bk'); // "Not now"
  assertEquals(cur.scene.view, 'npc', 'deferral returns to the topic menu');
  assertEquals(
    story(cur),
    before,
    'no decision, no event, no route started, no route locked',
  );
  assertEquals(cur.quests['sq_shrine_pact']?.status ?? 'unavailable', 'unavailable');
  assertEquals(cur.quests['sq_ledger_debt']?.status ?? 'unavailable', 'unavailable');
  // The parent stays pending: active, its question unanswered (#147).
  assertEquals(cur.quests[PARENT]?.status, 'active');
  assertEquals(cur.quests[PARENT]?.counts, [0]);
  // The pledge topic is still offered while the parent is carried.
  assert(npcTopics(cur, FERRY).some((topic) => topic.id === 'ferry_promise'));
});

Deno.test('branch: the promise route advances the parent, starts the beacon, locks the debt', async () => {
  const store = new MemoryStore();
  const player = ferryHero(1701);
  player.messageId = 400;
  player.scene = { view: 'npc', npcId: FERRY };
  await store.set(1701, player);
  const cur = await commitPledge(store, 1701, 'promise');
  assertEquals(cur.decisions['ferry_shrine_pledge']?.choiceId, 'promise');
  // The shared parent (#147): the event advanced the ALREADY-ACTIVE parent
  // objective — real shared progress, not a retrofit onto the child.
  assertEquals(cur.quests[PARENT]?.status, 'turnIn', 'the parent question is answered');
  assertEquals(cur.quests[PARENT]?.counts, [1]);
  assertEquals(cur.quests['sq_shrine_pact']?.status, 'active');
  assertEquals(
    cur.quests['sq_shrine_pact']?.counts,
    [0],
    'the child carries only its own route objective',
  );
  assertEquals(cur.questOutcomes['sq_ledger_debt']?.kind, 'locked');
  // Permanent exclusion: ordinary prerequisites never resurrect the lock.
  const reloaded = (await store.get(1701))!;
  syncAvailability(reloaded);
  assertEquals(reloaded.quests['sq_ledger_debt']?.status ?? 'unavailable', 'unavailable');
  // The chosen route is live business at the Ferryman, and the answered
  // parent is ready to turn in — not an offer.
  const topics = npcTopics(reloaded, FERRY);
  assert(topics.some((topic) => topic.kind === 'questTurnIn' && topic.id === PARENT));
  assert(topics.some((topic) => topic.kind === 'questActive' && topic.id === 'sq_shrine_pact'));
  assert(!topics.some((topic) => topic.kind === 'questOffer'));
  // The decided topic no longer presents itself as undecided (#132): the
  // pledge topic is gone, the ledger aftermath is in its place.
  assert(!topics.some((topic) => topic.id === 'ferry_promise'));
  assert(topics.some((topic) => topic.id === 'ferry_ledger'));
});

Deno.test('branch: the decline route advances the parent, starts the debt, locks the beacon', async () => {
  const store = new MemoryStore();
  const player = ferryHero(1702);
  player.messageId = 400;
  player.scene = { view: 'npc', npcId: FERRY };
  await store.set(1702, player);
  const cur = await commitPledge(store, 1702, 'decline');
  assertEquals(cur.decisions['ferry_shrine_pledge']?.choiceId, 'decline');
  assertEquals(cur.quests[PARENT]?.status, 'turnIn', 'the same parent advanced');
  assertEquals(cur.quests[PARENT]?.counts, [1]);
  assertEquals(cur.quests['sq_ledger_debt']?.status, 'active');
  assertEquals(cur.quests['sq_ledger_debt']?.counts, [0]);
  assertEquals(cur.questOutcomes['sq_shrine_pact']?.kind, 'locked');
  syncAvailability(cur);
  assertEquals(cur.quests['sq_shrine_pact']?.status ?? 'unavailable', 'unavailable');
});

Deno.test('branch: after commitment the other choice can never unlock both routes', async () => {
  const store = new MemoryStore();
  const player = ferryHero(1703);
  player.messageId = 400;
  player.scene = { view: 'npc', npcId: FERRY };
  await store.set(1703, player);
  await commitPledge(store, 1703, 'promise');
  const cur = (await store.get(1703))!;
  // The parent question is answered, so the choice's own gate is closed —
  // and the ledger forbids re-deciding regardless: a fresh engine-level
  // attempt with the other choice is refused untouched.
  cur.scene = { view: 'dialogue', dialogueId: 'dlg_ferry_promise', nodeId: PLEDGE_NODE };
  const before = JSON.stringify({ q: cur.quests, o: cur.questOutcomes });
  const result = applyDialogueChoice(cur, { choiceId: 'decline', now: 99 });
  assertEquals(result.ok, false, 'the answered question and the ledger both refuse');
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
  const player = ferryHero(1704);
  player.messageId = 400;
  player.scene = { view: 'npc', npcId: FERRY };
  await store.set(1704, player);
  await commitPledge(store, 1704, 'promise');
  const cur = (await store.get(1704))!;
  cur.scene = { view: 'npc', npcId: FERRY };
  const firstTopics = JSON.stringify(npcTopics(cur, FERRY));
  const secondTopics = JSON.stringify(npcTopics(cur, FERRY));
  assertEquals(firstTopics, secondTopics, 'the post-commitment topic menu is stable');
  assert(!firstTopics.includes('ferry_promise'));
});

Deno.test('branch: the beacon route completes ordinarily — done, no outcome entry', () => {
  const player = ferryHero(1707);
  pledgeFrom(player, 'promise');
  for (let i = 0; i < 4; i++) onKill(player, 'e_wisp');
  assertEquals(player.quests['sq_shrine_pact']?.status, 'turnIn');
  const gold = player.gold;
  const ctx: StoryContext = {
    dialogueId: 'dlg_sq_shrine_pact_turnin',
    nodeId: 'ta',
    npcId: FERRY,
    now: 2,
  };
  applyStoryEffects(player, [{ kind: 'turnInQuest', questId: 'sq_shrine_pact' }], ctx);
  assertEquals(player.quests['sq_shrine_pact']?.status, 'done');
  assertEquals(player.questOutcomes['sq_shrine_pact'], undefined, 'ordinary completion: no entry');
  assert(player.gold > gold, 'the ordinary turn-in pays its reward');
  // Query semantics (#132): ordinary completion is read through
  // questStatus; the named outcome condition stays false.
  assert(evalCondition(player, { questStatus: { questId: 'sq_shrine_pact', is: 'done' } }));
  assert(
    !evalCondition(player, {
      questOutcome: { questId: 'sq_shrine_pact', kind: 'resolved' },
    }),
  );
  assert(
    !evalCondition(player, {
      questOutcome: { questId: 'sq_shrine_pact', kind: 'resolved', outcome: 'kept' },
    }),
  );
});

Deno.test('branch: keeping the light resolves the named outcome and forgoes the reward', () => {
  const player = ferryHero(1708);
  pledgeFrom(player, 'promise');
  for (let i = 0; i < 4; i++) onKill(player, 'e_wisp');
  assertEquals(player.quests['sq_shrine_pact']?.status, 'turnIn');
  const gold = player.gold;
  const ctx: StoryContext = {
    dialogueId: 'dlg_sq_shrine_pact_turnin',
    nodeId: 'ta',
    npcId: FERRY,
    now: 2,
  };
  applyStoryEffects(
    player,
    [{ kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'kept' }],
    ctx,
  );
  assertEquals(player.quests['sq_shrine_pact']?.status, 'done');
  assertEquals(player.questOutcomes['sq_shrine_pact']?.kind, 'resolved');
  assertEquals(namedOutcome(player.questOutcomes['sq_shrine_pact']), 'kept');
  assertEquals(player.gold, gold, 'no reward — the light was kept, not given');
  // The named outcome is queryable and composes through all/any/not (#132).
  assert(evalCondition(player, {
    questOutcome: { questId: 'sq_shrine_pact', kind: 'resolved', outcome: 'kept' },
  }));
  assert(evalCondition(player, {
    all: [
      { questOutcome: { questId: 'sq_shrine_pact', outcome: 'kept' } },
      { not: { questStatus: { questId: 'sq_shrine_pact', is: 'active' } } },
    ],
  }));
  assert(
    !evalCondition(player, {
      questOutcome: { questId: 'sq_shrine_pact', kind: 'failed' },
    }),
  );
  // The shipped aftermath topic lists for the decided player, and ONLY the
  // kept-light reaction renders for exactly this outcome (#147): no stale
  // relighting guidance, no debt rows.
  const topics = npcTopics(player, FERRY);
  assert(topics.some((topic) => topic.id === 'ferry_ledger'), 'the aftermath topic is offered');
  player.scene = { view: 'dialogue', dialogueId: 'dlg_ferry_aftermath', nodeId: 'a1' };
  const view = JSON.stringify(renderDialogue(player));
  assert(view.includes('dlg:ch:keptlight'), 'the kept-light reaction renders');
  assert(!view.includes('dlg:ch:beacon'), 'no relighting guidance for the kept outcome');
  assert(!view.includes('dlg:ch:lit'), 'the lit acknowledgment is not for the kept outcome');
  assert(!view.includes('dlg:ch:debt'), 'the debt guidance is not this player\u2019s');
});

Deno.test('branch: an undeclared named outcome refuses at runtime (#132)', () => {
  const player = ferryHero(1709);
  pledgeFrom(player, 'promise');
  for (let i = 0; i < 4; i++) onKill(player, 'e_wisp');
  const ctx: StoryContext = {
    dialogueId: 'dlg_test',
    nodeId: 'nX',
    npcId: FERRY,
    now: 3,
  };
  // 'sq_shrine_pact' declares only "kept".
  const before = JSON.stringify(player.quests['sq_shrine_pact']);
  assert(
    applyStoryEffects !== undefined &&
      validateRefusal(player, ctx),
    'an undeclared outcome is refused',
  );
  assertEquals(JSON.stringify(player.quests['sq_shrine_pact']), before);
});

function validateRefusal(player: PlayerState, ctx: StoryContext): boolean {
  try {
    applyStoryEffects(
      player,
      [{ kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'traded' }],
      ctx,
    );
    return false;
  } catch {
    return true;
  }
}

// ── the aftermath state matrix (#147) ────────────────────────────────────

function aftermathView(player: PlayerState): string {
  player.scene = { view: 'dialogue', dialogueId: 'dlg_ferry_aftermath', nodeId: 'a1' };
  return JSON.stringify(renderDialogue(player));
}

Deno.test('branch: the beacon aftermath follows the route state (#147)', () => {
  const player = ferryHero(1710);
  pledgeFrom(player, 'promise');

  // Active route: guidance for that route only.
  const guidance = aftermathView(player);
  assert(guidance.includes('dlg:ch:beacon'), 'route guidance while the beacon is open');
  assert(!guidance.includes('dlg:ch:lit'), 'no completion acknowledgment yet');
  assert(!guidance.includes('dlg:ch:keptlight'), 'no kept-light reaction yet');
  assert(
    !guidance.includes('dlg:ch:debt') && !guidance.includes('dlg:ch:paid'),
    'no debt rows for the beacon route',
  );

  // Ordinary completion: acknowledgment replaces the instructions.
  for (let i = 0; i < 4; i++) onKill(player, 'e_wisp');
  applyStoryEffects(player, [{ kind: 'turnInQuest', questId: 'sq_shrine_pact' }], {
    dialogueId: 'dlg_sq_shrine_pact_turnin',
    nodeId: 'ta',
    npcId: FERRY,
    now: 2,
  });
  const lit = aftermathView(player);
  assert(lit.includes('dlg:ch:lit'), 'the lit beacon is acknowledged');
  assert(!lit.includes('dlg:ch:beacon'), 'no stale relighting instructions after completion');
  assert(!lit.includes('dlg:ch:keptlight'));
  // Availability sync and rerendering change nothing: no stale guidance
  // returns, and the menu is position-stable.
  syncAvailability(player);
  assertEquals(aftermathView(player), lit, 'sync never resurrects completed-work instructions');
});

Deno.test('branch: the debt aftermath follows the debt route state (#147)', async () => {
  const player = ferryHero(1711);
  pledgeFrom(player, 'decline');

  // Active route: what remains owed, for that route only.
  const guidance = aftermathView(player);
  assert(guidance.includes('dlg:ch:debt'), 'route guidance while the debt is open');
  assert(!guidance.includes('dlg:ch:paid'), 'no balanced-books acknowledgment yet');
  assert(
    !guidance.includes('dlg:ch:beacon') && !guidance.includes('dlg:ch:lit'),
    'no beacon rows for the debt route',
  );

  // Completing the debt route: acknowledgment replaces the instructions.
  for (let i = 0; i < 4; i++) onKill(player, 'e_leech');
  applyStoryEffects(player, [{ kind: 'turnInQuest', questId: 'sq_ledger_debt' }], {
    dialogueId: 'dlg_sq_ledger_debt_turnin',
    nodeId: 'ta',
    npcId: FERRY,
    now: 2,
  });
  const paid = aftermathView(player);
  assert(paid.includes('dlg:ch:paid'), 'the balanced books are acknowledged');
  assert(!paid.includes('dlg:ch:debt'), 'no stale debt instructions after completion');

  // The full committed state — routes, locks, parent, and the aftermath
  // menu it renders — survives a save/reload round-trip unchanged.
  const store = new MemoryStore();
  player.messageId = 401;
  await store.set(1711, player);
  const reloaded = (await store.get(1711))!;
  syncAvailability(reloaded);
  assertEquals(reloaded.quests[PARENT]?.status, 'turnIn');
  assertEquals(reloaded.quests['sq_ledger_debt']?.status, 'done');
  assertEquals(aftermathView(reloaded), paid, 'the reload renders the same aftermath');
});

Deno.test('branch: the pledge parent turn-in completes the shared question (#147)', async () => {
  const store = new MemoryStore();
  const player = ferryHero(1712);
  player.messageId = 400;
  player.scene = { view: 'npc', npcId: FERRY };
  await store.set(1712, player);
  const tap = async (data: string) => {
    const before = (await store.get(1712))!;
    await handleCallback(fakeCtx(1712, 400, withRev(before.uiRev ?? 0, data)), store);
    return (await store.get(1712))!;
  };
  const cur = await commitPledge(store, 1712, 'promise');
  assertEquals(cur.quests[PARENT]?.status, 'turnIn');
  // Back to the topic menu, open the parent's ready turn-in, and hand the
  // answer over through the central authority.
  await tap('dlg:bk');
  await tap(`npc:q:${PARENT}`);
  await tap('dlg:nx:ta');
  const opened = await tap('dlg:ch:handover');
  assertEquals(opened.quests[PARENT]?.status, 'done', 'the shared question is closed');
  assertEquals(
    opened.quests['sq_shrine_pact']?.status,
    'active',
    'the chosen route is untouched by the parent turn-in',
  );
});
