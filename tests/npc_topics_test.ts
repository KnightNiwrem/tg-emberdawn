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
import type { PlayerState } from '../src/engine/types.ts';

/** A hero in Emberdawn Village with arbitrary quest staging. */
function hero(id: number): PlayerState {
  const p = createPlayer(id, 'T', 'warrior');
  syncAvailability(p);
  return p;
}

Deno.test('topics: more than one valid topic is simultaneously reachable (#123)', () => {
  // The Ferryman can offer both swamp side quests AND hold a ready main
  // turn-in at the same moment — catalog order must never hide one.
  const p = hero(1100);
  p.level = 12;
  p.currentZone = 'hollowmere';
  p.unlockedZones = ['emberdawn', 'outskirts', 'whisperwood', 'hollowmere'];
  p.flags['zone_hollowmere'] = true;
  p.quests['m5_fen'] = { status: 'done', counts: [1] };
  syncAvailability(p); // m6_toxin (Ferryman), sq_boglins, sq_hags
  assert(acceptQuest(p, 'm6_toxin', 'npc_ferryman').ok);
  for (let i = 0; i < 4; i++) grantItem(p, 'q_toxin_sample', 1);
  const topics = npcTopics(p, 'npc_ferryman');
  const kinds = topics.map((t) => t.kind);
  assert(kinds.includes('questTurnIn'), 'the ready m6 turn-in is listed');
  assert(kinds.includes('questOffer'), 'sq_boglins offer is listed');
  const offers = topics.filter((t) => t.kind === 'questOffer');
  assert(offers.length >= 2, `both offers are listed (got ${offers.map((o) => o.id)})`);
  assert(kinds.includes('lore'), 'the authored lore topic is listed');
});

Deno.test('topics: two ready turn-ins at one NPC are both selectable (#123)', () => {
  const p = hero(1101);
  p.level = 4;
  p.flags['zone_whisperwood'] = true;
  syncAvailability(p);
  // Lyra finishes sq_rats and sq_charm; complete both.
  assert(acceptQuest(p, 'sq_rats', 'npc_lyra').ok);
  assert(acceptQuest(p, 'sq_charm', 'npc_lyra').ok);
  for (let i = 0; i < 6; i++) onKill(p, 'e_rat');
  grantItem(p, 'm_ember_shard', 4);
  const turnIns = npcTopics(p, 'npc_lyra').filter((t) => t.kind === 'questTurnIn');
  assertEquals(turnIns.length, 2, 'both ready quests are listed');
  assertEquals(
    turnIns.map((t) => t.id).sort(),
    ['sq_charm', 'sq_rats'],
  );
});

Deno.test('topics: opening the menu performs no quest or story mutation (#123)', () => {
  const p = hero(1102);
  p.level = 2;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(p, 'q_sealed_letter', 1);
  syncAvailability(p);
  assert(acceptQuest(p, 'm2_letter', 'npc_maren').ok);
  const before = JSON.stringify({ quests: p.quests, flags: p.flags, gold: p.gold });
  // Open Bram's menu: the m2 talk objective must NOT tick. The resolver is
  // pure — enumeration itself cannot mutate.
  const topics = npcTopics(p, 'npc_bram');
  assert(topics.some((t) => t.kind === 'questActive' && t.id === 'm2_letter'));
  const after = JSON.stringify({ quests: p.quests, flags: p.flags, gold: p.gold });
  assertEquals(after, before, 'enumeration is pure');
  assertEquals(
    p.quests['m2_letter']?.status,
    'active',
    'the talk objective is untouched by contact',
  );
});

Deno.test('topics: generic NPC contact no longer completes talk objectives (#123)', async () => {
  const store = new MemoryStore();
  const p = hero(1103);
  p.level = 2;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(p, 'q_sealed_letter', 1);
  syncAvailability(p);
  assert(acceptQuest(p, 'm2_letter', 'npc_maren').ok);
  p.messageId = 101;
  p.scene = { view: 'zone' };
  await store.set(1103, p);
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
  assertEquals(cur.scene.arg, 'dlg_m2_letter_talk');
  // Reaching the reading node emits the event — readiness, exactly once.
  await handleCallback(fakeCtx(1103, 101, withRev(cur.uiRev ?? 0, 'dlg:nx:c2')), store);
  cur = (await store.get(1103))!;
  assertEquals(cur.quests['m2_letter']?.status, 'turnIn');
  assertEquals(cur.scene.view, 'dialogue');
  assertEquals(cur.scene.arg2, 'c2');
});

Deno.test('topics: stale, forged, and no-longer-valid selections are harmless (#123)', async () => {
  const store = new MemoryStore();
  const p = hero(1104);
  p.level = 2;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(p, 'q_sealed_letter', 1);
  syncAvailability(p);
  assert(acceptQuest(p, 'm2_letter', 'npc_maren').ok);
  p.messageId = 102;
  p.scene = { view: 'zone' }; // NOT a topic menu
  await store.set(1104, p);
  let cur = (await store.get(1104))!;
  // Forged topic callback without a live menu: refusal, no mutation.
  const before = JSON.stringify(cur.quests['m2_letter']);
  await handleCallback(fakeCtx(1104, 102, withRev(cur.uiRev ?? 0, 'npc:q:m2_letter')), store);
  cur = (await store.get(1104))!;
  assertEquals(JSON.stringify(cur.quests['m2_letter']), before, 'no menu, no mutation');
  assert(cur.scene.view === 'zone' || cur.scene.view === 'npc');

  // Forged lore topic id: refusal.
  p.scene = { view: 'npc', arg: 'npc_bram' };
  await store.set(1104, p);
  cur = (await store.get(1104))!;
  await handleCallback(fakeCtx(1104, 102, withRev(cur.uiRev ?? 0, 'npc:lore:nope')), store);
  cur = (await store.get(1104))!;
  assertEquals(cur.scene.arg2, undefined, 'forged topic refused');

  // No-longer-valid business: m1 is DONE — selecting its topic must
  // refuse instead of re-opening an interaction.
  p.scene = { view: 'npc', arg: 'npc_maren' };
  await store.set(1104, p);
  cur = (await store.get(1104))!;
  await handleCallback(fakeCtx(1104, 102, withRev(cur.uiRev ?? 0, 'npc:q:m1_embers')), store);
  cur = (await store.get(1104))!;
  assertEquals(
    cur.quests['m1_embers']?.status,
    'done',
    'a finished quest cannot be re-opened',
  );
  assertEquals(cur.scene.arg2, undefined);

  // Wrong zone: Maren's topics are unreachable from the Whisperwood.
  p.currentZone = 'whisperwood';
  p.scene = { view: 'npc', arg: 'npc_maren' };
  await store.set(1104, p);
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
  const p = hero(1105);
  p.messageId = 103;
  p.scene = { view: 'npc', arg: 'npc_lyra' };
  await store.set(1105, p);
  let cur = (await store.get(1105))!;
  await handleCallback(fakeCtx(1105, 103, withRev(cur.uiRev ?? 0, 'npc:bk')), store);
  cur = (await store.get(1105))!;
  assertEquals(cur.scene.view, 'zone', 'Leave exits the conversation');
  await handleCallback(fakeCtx(1105, 103, withRev(cur.uiRev ?? 0, 'z:tk:2')), store);
  cur = (await store.get(1105))!;
  assertEquals(cur.scene.view, 'npc');
  await handleCallback(fakeCtx(1105, 103, withRev(cur.uiRev ?? 0, 'npc:lore:lyra_work')), store);
  cur = (await store.get(1105))!;
  assertEquals(cur.scene.arg2, 'lore:lyra_work');
  await handleCallback(fakeCtx(1105, 103, withRev(cur.uiRev ?? 0, 'npc:op:npc_lyra')), store);
  cur = (await store.get(1105))!;
  assertEquals(cur.scene.view, 'npc');
  assertEquals(cur.scene.arg2, undefined, 'Back returns to the topic list');
});

Deno.test('topics: an NPC with no quest business still exposes their conversation (#123)', () => {
  const p = hero(1106);
  p.currentZone = 'whisperwood';
  p.level = 4;
  p.scene = { view: 'npc', arg: 'npc_pell' };
  // Pell has no quest business for this hero.
  const topics = npcTopics(p, 'npc_pell');
  assertEquals(topics.filter((t) => t.kind !== 'lore').length, 0);
  const view = JSON.stringify(renderNpcTopics(p));
  assert(view.includes('You walk loud'), 'the authored greeting renders');
  assert(view.includes('Ask about the spiders'), 'the authored lore topic renders');
  assert(view.includes('npc:bk'), 'Leave is offered');
  assert(!view.includes('dlg:'), 'no dialogue is reachable without business');
});

Deno.test('topics: every authored topic id fits the callback budget (#123)', () => {
  // Every authored topic id must encode into a wire form under 64 bytes
  // (with a 4-digit revision stamped).
  for (const zone of ZONES) {
    for (const def of zone.npcs) {
      for (const t of def.topics ?? []) {
        const wire = withRev(1234, `npc:lore:${t.id}`);
        assert(wire.length <= 64, `${def.id}:${t.id} wire form too long (${wire.length})`);
      }
    }
  }
});
