import { expectScene } from './helpers.ts';
/**
 * NPC topic menu (#123): clicking an NPC opens an explicit topic-selection
 * scene enumerating EVERY currently available interaction. Opening it is
 * navigation — no quest or story mutation. Selections revalidate the live
 * scene, the NPC's physical presence, and current availability.
 */

import { assert, assertEquals } from '@std/assert';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { withRev } from '../src/codec.ts';
import { createPlayer } from '../src/engine/character.ts';
import { acceptQuest, grantItem, onKill, syncAvailability } from '../src/engine/quests.ts';
import { npcTopics } from '../src/engine/npc.ts';
import { renderNpcTopics } from '../src/render/views.ts';
import { fakeCtx } from './helpers.ts';
import { ZONES } from '../src/content/zones.ts';
import { QUESTS } from '../src/content/quests.ts';
import { npc } from '../src/content/quests.ts';
import { dialogue } from '../src/content/dialogues.ts';
import type { PlayerState } from '../src/engine/types.ts';

/** A hero in Emberdawn Village with arbitrary quest staging. */
function hero(id: number): PlayerState {
  const player = createPlayer(id, 'T', 'warrior');
  syncAvailability(player);
  return player;
}

Deno.test('topics: more than one valid topic is simultaneously reachable (#123)', () => {
  // The Ferryman can offer both swamp side quests AND hold a ready main
  // turn-in at the same moment — catalog order must never hide one.
  const player = hero(1100);
  player.level = 12;
  player.currentZone = 'hollowmere';
  player.unlockedZones = ['emberdawn', 'outskirts', 'whisperwood', 'hollowmere'];
  player.flags['zone_hollowmere'] = true;
  player.quests['m5_fen'] = { status: 'done', counts: [1] };
  syncAvailability(player); // m6_toxin (Ferryman), sq_boglins, sq_hags
  assert(acceptQuest(player, 'm6_toxin', 'npc_ferryman').ok);
  for (let i = 0; i < 4; i++) grantItem(player, 'q_toxin_sample', 1);
  const topics = npcTopics(player, 'npc_ferryman');
  const kinds = topics.map((topic) => topic.kind);
  assert(kinds.includes('questTurnIn'), 'the ready m6 turn-in is listed');
  assert(kinds.includes('questOffer'), 'sq_boglins offer is listed');
  const offers = topics.filter((topic) => topic.kind === 'questOffer');
  assert(offers.length >= 2, `both offers are listed (got ${offers.map((topic) => topic.id)})`);
  assert(kinds.includes('lore'), 'the authored lore topic is listed');
});

Deno.test('topics: two ready turn-ins at one NPC are both selectable (#123)', () => {
  const player = hero(1101);
  player.level = 4;
  player.flags['zone_whisperwood'] = true;
  syncAvailability(player);
  // Lyra finishes sq_rats and sq_charm; complete both.
  assert(acceptQuest(player, 'sq_rats', 'npc_lyra').ok);
  assert(acceptQuest(player, 'sq_charm', 'npc_lyra').ok);
  for (let i = 0; i < 6; i++) onKill(player, 'e_rat');
  grantItem(player, 'm_ember_shard', 4);
  const turnIns = npcTopics(player, 'npc_lyra').filter((topic) => topic.kind === 'questTurnIn');
  assertEquals(turnIns.length, 2, 'both ready quests are listed');
  assertEquals(
    turnIns.map((topic) => topic.id).sort(),
    ['sq_charm', 'sq_rats'],
  );
});

Deno.test('topics: opening the menu performs no quest or story mutation (#123)', () => {
  const player = hero(1102);
  player.level = 2;
  player.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(player, 'q_sealed_letter', 1);
  syncAvailability(player);
  assert(acceptQuest(player, 'm2_letter', 'npc_maren').ok);
  const before = JSON.stringify({ quests: player.quests, flags: player.flags, gold: player.gold });
  // Open Bram's menu: the m2 talk objective must NOT tick. The resolver is
  // pure — enumeration itself cannot mutate.
  const topics = npcTopics(player, 'npc_bram');
  assert(topics.some((topic) => topic.kind === 'questActive' && topic.id === 'm2_letter'));
  const after = JSON.stringify({ quests: player.quests, flags: player.flags, gold: player.gold });
  assertEquals(after, before, 'enumeration is pure');
  assertEquals(
    player.quests['m2_letter']?.status,
    'active',
    'the talk objective is untouched by contact',
  );
});

Deno.test('topics: generic NPC contact no longer completes talk objectives (#123)', async () => {
  const store = new MemoryStore();
  const player = hero(1103);
  player.level = 2;
  player.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(player, 'q_sealed_letter', 1);
  syncAvailability(player);
  assert(acceptQuest(player, 'm2_letter', 'npc_maren').ok);
  player.messageId = 101;
  player.scene = { view: 'zone' };
  await store.set(1103, player);
  let cur = (await store.get(1103))!;
  // Open Bram's topic menu twice — no progress may happen.
  await handleCallback(fakeCtx(1103, 101, withRev(cur.uiRev ?? 0, 'z:tk:1')), store);
  cur = (await store.get(1103))!;
  assertEquals(cur.scene.view, 'npc');
  assertEquals(cur.quests['m2_letter']?.status, 'active', 'contact alone ticks nothing');
  // The active-business topic IS the conversation (legacy beat): selecting
  // it ticks the talk objective and routes to the authoritative interaction.
  await handleCallback(fakeCtx(1103, 101, withRev(cur.uiRev ?? 0, 'npc:q:m2_letter')), store);
  cur = (await store.get(1103))!;
  assertEquals(
    cur.quests['m2_letter']?.status,
    'active',
    'the active topic opens the conversation',
  );
  assertEquals(cur.scene.view, 'dialogue');
  assertEquals(expectScene(cur, 'dialogue').dialogueId, 'dlg_m2_letter_talk');
  // Reaching the reading node emits the event — readiness, exactly once.
  await handleCallback(fakeCtx(1103, 101, withRev(cur.uiRev ?? 0, 'dlg:nx:c2')), store);
  cur = (await store.get(1103))!;
  assertEquals(cur.quests['m2_letter']?.status, 'turnIn');
  assertEquals(cur.scene.view, 'dialogue');
  assertEquals(expectScene(cur, 'dialogue').nodeId, 'c2');
});

Deno.test('topics: stale, forged, and no-longer-valid selections are harmless (#123)', async () => {
  const store = new MemoryStore();
  const player = hero(1104);
  player.level = 2;
  player.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(player, 'q_sealed_letter', 1);
  syncAvailability(player);
  assert(acceptQuest(player, 'm2_letter', 'npc_maren').ok);
  player.messageId = 102;
  player.scene = { view: 'zone' }; // NOT a topic menu
  await store.set(1104, player);
  let cur = (await store.get(1104))!;
  // Forged topic callback without a live menu: refusal, no mutation.
  const before = JSON.stringify(cur.quests['m2_letter']);
  await handleCallback(fakeCtx(1104, 102, withRev(cur.uiRev ?? 0, 'npc:q:m2_letter')), store);
  cur = (await store.get(1104))!;
  assertEquals(JSON.stringify(cur.quests['m2_letter']), before, 'no menu, no mutation');
  assert(cur.scene.view === 'zone' || cur.scene.view === 'npc');

  // Forged lore topic id: refusal.
  player.scene = { view: 'npc', npcId: 'npc_bram' };
  await store.set(1104, player);
  cur = (await store.get(1104))!;
  await handleCallback(fakeCtx(1104, 102, withRev(cur.uiRev ?? 0, 'npc:lore:nope')), store);
  cur = (await store.get(1104))!;
  assertEquals(expectScene(cur, 'npc').topic, undefined, 'forged topic refused');

  // No-longer-valid business: m1 is DONE — selecting its topic must
  // refuse instead of re-opening an interaction.
  player.scene = { view: 'npc', npcId: 'npc_maren' };
  await store.set(1104, player);
  cur = (await store.get(1104))!;
  await handleCallback(fakeCtx(1104, 102, withRev(cur.uiRev ?? 0, 'npc:q:m1_embers')), store);
  cur = (await store.get(1104))!;
  assertEquals(
    cur.quests['m1_embers']?.status,
    'done',
    'a finished quest cannot be re-opened',
  );
  assertEquals(expectScene(cur, 'npc').topic, undefined);

  // Wrong zone: Maren's topics are unreachable from the Whisperwood.
  player.currentZone = 'whisperwood';
  player.scene = { view: 'npc', npcId: 'npc_maren' };
  await store.set(1104, player);
  cur = (await store.get(1104))!;
  await handleCallback(fakeCtx(1104, 102, withRev(cur.uiRev ?? 0, 'npc:q:m2_letter')), store);
  cur = (await store.get(1104))!;
  assertEquals(
    cur.quests['m2_letter']?.status,
    'active',
    'wrong-zone selection refused',
  );
  assertEquals(cur.scene.view, 'npc');
});

Deno.test('topics: Leave returns to the zone; Back re-opens the menu (#123)', async () => {
  const store = new MemoryStore();
  const player = hero(1105);
  player.messageId = 103;
  player.scene = { view: 'npc', npcId: 'npc_lyra' };
  await store.set(1105, player);
  let cur = (await store.get(1105))!;
  await handleCallback(fakeCtx(1105, 103, withRev(cur.uiRev ?? 0, 'npc:bk')), store);
  cur = (await store.get(1105))!;
  assertEquals(cur.scene.view, 'zone', 'Leave exits the conversation');
  await handleCallback(fakeCtx(1105, 103, withRev(cur.uiRev ?? 0, 'z:tk:2')), store);
  cur = (await store.get(1105))!;
  assertEquals(cur.scene.view, 'npc');
  await handleCallback(fakeCtx(1105, 103, withRev(cur.uiRev ?? 0, 'npc:lore:lyra_work')), store);
  cur = (await store.get(1105))!;
  assertEquals(expectScene(cur, 'npc').topic, { kind: 'lore', id: 'lyra_work' });
  await handleCallback(fakeCtx(1105, 103, withRev(cur.uiRev ?? 0, 'npc:op:npc_lyra')), store);
  cur = (await store.get(1105))!;
  assertEquals(cur.scene.view, 'npc');
  assertEquals(expectScene(cur, 'npc').topic, undefined, 'Back returns to the topic list');
});

Deno.test('topics: an NPC with no quest business still exposes their conversation (#123)', () => {
  const player = hero(1106);
  player.currentZone = 'whisperwood';
  player.level = 4;
  player.scene = { view: 'npc', npcId: 'npc_pell' };
  // Pell has no quest business for this hero.
  const topics = npcTopics(player, 'npc_pell');
  assertEquals(topics.filter((topic) => topic.kind !== 'lore').length, 0);
  const view = JSON.stringify(renderNpcTopics(player));
  assert(view.includes('Stop there. Web across the next branch.'), 'the authored greeting renders');
  assert(view.includes('Ask about the spiders'), 'the authored lore topic renders');
  assert(view.includes('npc:bk'), 'Leave is offered');
  assert(!view.includes('dlg:'), 'no dialogue is reachable without business');
});

Deno.test('topics: every authored topic id fits the callback budget (#123)', () => {
  // Every authored topic id must encode into a wire form under 64 bytes
  // (with a 4-digit revision stamped).
  for (const zone of ZONES) {
    for (const def of zone.npcs) {
      for (const topic of def.topics ?? []) {
        const wire = withRev(1234, `npc:lore:${topic.id}`);
        assert(wire.length <= 64, `${def.id}:${topic.id} wire form too long (${wire.length})`);
      }
    }
  }
});

// ── Topic ownership (#131) ───────────────────────────────────────────────

/** Stages m2_letter active: Maren started it, Bram finishes it, and both
 * stand in Emberdawn Village — the same-zone wrong-NPC trap. */
function m2Active(id: number): PlayerState {
  const player = hero(id);
  player.level = 2;
  player.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(player, 'q_sealed_letter', 1);
  syncAvailability(player);
  assert(acceptQuest(player, 'm2_letter', 'npc_maren').ok);
  return player;
}

Deno.test('topics: an active quest at a non-owning contact is a pure reminder (#131)', async () => {
  const store = new MemoryStore();
  const player = m2Active(1107);
  // The row is LISTED at Maren (a pointer) but carries no dialogue — Bram
  // owns dlg_m2_letter_talk, so her row can never route into it.
  const row = npcTopics(player, 'npc_maren').find((topic) => topic.id === 'm2_letter');
  assertEquals(row?.kind, 'questActive');
  assertEquals(row?.dialogueId, undefined, "Maren's row must not carry Bram's dialogue");
  player.messageId = 104;
  player.scene = { view: 'zone' };
  await store.set(1107, player);
  let cur = (await store.get(1107))!;
  // Open Maren's menu (index 0) and select the active m2 business.
  await handleCallback(fakeCtx(1107, 104, withRev(cur.uiRev ?? 0, 'z:tk:0')), store);
  cur = (await store.get(1107))!;
  assertEquals(expectScene(cur, 'npc').npcId, 'npc_maren');
  const before = JSON.stringify({
    quests: cur.quests,
    flags: cur.flags,
    storyEvents: cur.storyEvents,
    gold: cur.gold,
  });
  await handleCallback(fakeCtx(1107, 104, withRev(cur.uiRev ?? 0, 'npc:q:m2_letter')), store);
  cur = (await store.get(1107))!;
  assertEquals(cur.scene.view, 'npc', 'no dialogue opens at the non-owning contact');
  assertEquals(expectScene(cur, 'npc').npcId, 'npc_maren');
  assertEquals(
    expectScene(cur, 'npc').topic,
    { kind: 'quest', id: 'm2_letter' },
    'a pure progress reminder renders instead',
  );
  assertEquals(cur.quests['m2_letter']?.status, 'active', 'no progress from the wrong NPC');
  assert(!cur.storyEvents.includes('heard_bram_reading'), 'the event was not emitted');
  const after = JSON.stringify({
    quests: cur.quests,
    flags: cur.flags,
    storyEvents: cur.storyEvents,
    gold: cur.gold,
  });
  assertEquals(after, before, 'the reminder is non-mutating');
});

Deno.test('topics: the owning contact opens the conversation; the event fires exactly once (#131)', async () => {
  const store = new MemoryStore();
  const player = m2Active(1108);
  // Bram's row carries the dialogue he owns.
  const row = npcTopics(player, 'npc_bram').find((topic) => topic.id === 'm2_letter');
  assertEquals(row?.dialogueId, 'dlg_m2_letter_talk');
  player.messageId = 105;
  player.scene = { view: 'zone' };
  await store.set(1108, player);
  let cur = (await store.get(1108))!;
  await handleCallback(fakeCtx(1108, 105, withRev(cur.uiRev ?? 0, 'z:tk:1')), store); // Bram
  cur = (await store.get(1108))!;
  await handleCallback(fakeCtx(1108, 105, withRev(cur.uiRev ?? 0, 'npc:q:m2_letter')), store);
  cur = (await store.get(1108))!;
  assertEquals(cur.scene.view, 'dialogue');
  assertEquals(expectScene(cur, 'dialogue').dialogueId, 'dlg_m2_letter_talk');
  await handleCallback(fakeCtx(1108, 105, withRev(cur.uiRev ?? 0, 'dlg:nx:c2')), store);
  cur = (await store.get(1108))!;
  assertEquals(cur.quests['m2_letter']?.status, 'turnIn');
  assertEquals(
    cur.storyEvents.filter((eventId) => eventId === 'heard_bram_reading').length,
    1,
    'the event fired exactly once',
  );
});

Deno.test('topics: an offer cannot be reached from a non-starter menu (#131)', async () => {
  const store = new MemoryStore();
  const player = hero(1109);
  player.level = 2;
  player.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(player, 'q_sealed_letter', 1);
  syncAvailability(player); // m2_letter available at Maren
  // Bram's menu does not list the offer at all.
  assert(!npcTopics(player, 'npc_bram').some((topic) => topic.id === 'm2_letter'));
  player.messageId = 106;
  player.scene = { view: 'zone' };
  await store.set(1109, player);
  let cur = (await store.get(1109))!;
  await handleCallback(fakeCtx(1109, 106, withRev(cur.uiRev ?? 0, 'z:tk:1')), store); // Bram
  cur = (await store.get(1109))!;
  // A forged selection of Maren's offer from Bram's menu refuses.
  await handleCallback(fakeCtx(1109, 106, withRev(cur.uiRev ?? 0, 'npc:q:m2_letter')), store);
  cur = (await store.get(1109))!;
  assertEquals(cur.quests['m2_letter']?.status, 'available', 'the offer did not open');
  assertEquals(cur.scene.view, 'npc');
  assertEquals(
    expectScene(cur, 'npc').topic,
    undefined,
    'no reminder for a quest this NPC has no business in',
  );
});

Deno.test('topics: a lore topic whose condition turns false after render is refused (#131)', async () => {
  const store = new MemoryStore();
  const player = hero(1110);
  player.messageId = 107;
  // Inject a conditional lore topic into Maren's def (restored below) — no
  // shipped topic carries a `when` yet, so the contract needs a fixture.
  const maren = npc('npc_maren')!;
  const injected = {
    id: 'test_when_topic',
    label: 'A conditional secret',
    text: 'You were meant to hear this.',
    when: { flag: { id: 'test_when_flag' } },
  };
  maren.topics = [...(maren.topics ?? []), injected];
  try {
    // Condition unmet: enumeration hides the topic…
    assert(!npcTopics(player, 'npc_maren').some((topic) => topic.id === 'test_when_topic'));
    player.scene = { view: 'npc', npcId: 'npc_maren' };
    await store.set(1110, player);
    let cur = (await store.get(1110))!;
    // …and a forged direct selection refuses without mutation.
    await handleCallback(
      fakeCtx(1110, 107, withRev(cur.uiRev ?? 0, 'npc:lore:test_when_topic')),
      store,
    );
    cur = (await store.get(1110))!;
    assertEquals(expectScene(cur, 'npc').topic, undefined, 'condition-hidden topic refused');
    // Condition met: the topic enumerates and opens.
    cur.flags['test_when_flag'] = true;
    cur.scene = { view: 'npc', npcId: 'npc_maren' };
    await store.set(1110, cur);
    cur = (await store.get(1110))!;
    assert(npcTopics(cur, 'npc_maren').some((topic) => topic.id === 'test_when_topic'));
    await handleCallback(
      fakeCtx(1110, 107, withRev(cur.uiRev ?? 0, 'npc:lore:test_when_topic')),
      store,
    );
    cur = (await store.get(1110))!;
    assertEquals(
      expectScene(cur, 'npc').topic,
      { kind: 'lore', id: 'test_when_topic' },
      'met condition opens the topic',
    );
    // The condition turns false AFTER the menu rendered: the stale tap
    // re-resolves the row, finds it gone, and refuses without mutation.
    delete cur.flags['test_when_flag'];
    cur.scene = { view: 'npc', npcId: 'npc_maren' };
    await store.set(1110, cur);
    cur = (await store.get(1110))!;
    await handleCallback(
      fakeCtx(1110, 107, withRev(cur.uiRev ?? 0, 'npc:lore:test_when_topic')),
      store,
    );
    cur = (await store.get(1110))!;
    assertEquals(
      expectScene(cur, 'npc').topic,
      undefined,
      'stale conditional topic refused at tap time',
    );
  } finally {
    maren.topics = maren.topics?.filter((topic) => topic.id !== 'test_when_topic');
  }
});

Deno.test('topics: no resolved row ever routes to a foreign-owned dialogue (#131)', () => {
  // Property sweep: for every NPC and every quest lifecycle status that
  // enumerates rows, every dialogue a row carries is owned by THAT NPC.
  const player = hero(1111);
  player.level = 45;
  for (const status of ['available', 'active', 'turnIn'] as const) {
    for (const questDef of QUESTS) player.quests[questDef.id] = { status, counts: [] };
    for (const zoneDef of ZONES) {
      for (const npcDef of zoneDef.npcs) {
        for (const topic of npcTopics(player, npcDef.id)) {
          if (topic.dialogueId) {
            assertEquals(
              dialogue(topic.dialogueId)?.npcId,
              npcDef.id,
              `${npcDef.id}: ${topic.kind} row ${topic.id} routes to a foreign dialogue`,
            );
          }
        }
      }
    }
  }
});
