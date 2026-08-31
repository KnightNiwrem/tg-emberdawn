/** Quest action authority (#64): accept/turn-in require the quest's
 * configured contact, physically present in the player's current zone.
 * The Quest Log can neither accept nor turn in; wrong-site attempts never
 * mutate; the npcq scene context is revalidated in the handler. */

import { assert, assertEquals } from '@std/assert';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { withRev } from '../src/codec.ts';
import { createPlayer } from '../src/engine/character.ts';
import { countOf } from '../src/engine/inventory.ts';
import {
  acceptQuest,
  grantItem,
  onKill,
  onTalk,
  syncAvailability,
  turnInQuest,
} from '../src/engine/quests.ts';
import { renderQuestInteraction } from '../src/render/views.ts';
import { fakeCtx } from './helpers.ts';

Deno.test('accepting requires the configured STARTER in the current zone (#64)', () => {
  const p = createPlayer(980, 'T', 'warrior'); // starts in Emberdawn Village
  syncAvailability(p);

  // Wrong NPC — Bram cannot offer Maren's quest.
  const wrongNpc = acceptQuest(p, 'm1_embers', 'npc_bram');
  assertEquals(wrongNpc.ok, false);
  assert(wrongNpc.msg.includes('Elder Maren'), `guidance names the contact: ${wrongNpc.msg}`);
  assertEquals(p.quests['m1_embers']?.status ?? 'unavailable', 'available', 'non-mutating');
  assertEquals(p.scene.view, 'zone', 'nothing else moved');

  // Right NPC, wrong zone — Maren is not standing in the Whisperwood.
  p.currentZone = 'whisperwood';
  const wrongZone = acceptQuest(p, 'm1_embers', 'npc_maren');
  assertEquals(wrongZone.ok, false);
  assert(wrongZone.msg.includes('Elder Maren'));
  assertEquals(p.quests['m1_embers']?.status ?? 'unavailable', 'available', 'non-mutating');

  // Right NPC, on-site: works. Same-NPC start/finish completes at Maren.
  p.currentZone = 'emberdawn';
  assert(acceptQuest(p, 'm1_embers', 'npc_maren').ok);
  for (let i = 0; i < 4; i++) onKill(p, 'e_ember_rat');
  assert(turnInQuest(p, 'm1_embers', 'npc_maren').ok);
  assertEquals(p.quests['m1_embers']?.status, 'done');
});

Deno.test('turning in requires the configured FINISHER — never the starter, never the log (#64)', () => {
  const p = createPlayer(981, 'T', 'warrior');
  p.level = 2; // m2 requires level 2
  p.quests['m1_embers'] = { status: 'done', counts: [] }; // m2's prereq
  syncAvailability(p);
  // m2: Maren starts, Bram finishes (delivery flow, #63).
  assert(acceptQuest(p, 'm2_letter', 'npc_maren').ok);
  grantItem(p, 'q_sealed_letter', 1);
  onTalk(p, 'npc_bram'); // talk objective ticks — the quest is ready
  assertEquals(p.quests['m2_letter']?.status, 'turnIn');

  // Talking to Bram readied it, but "return to the giver" is NOT the rule:
  // Maren cannot accept the handover — the finisher is the explicit field.
  const atStarter = turnInQuest(p, 'm2_letter', 'npc_maren');
  assertEquals(atStarter.ok, false, 'talk objectives do not define the finisher');
  assert(atStarter.lines[0]!.includes('Blacksmith Bram'));
  assertEquals(p.quests['m2_letter']?.status, 'turnIn', 'refusal is non-mutating');
  assertEquals(countOf(p, 'q_sealed_letter'), 1, 'nothing left the bag');

  // Wrong zone: Bram stands in Emberdawn — not the Whisperwood.
  p.currentZone = 'whisperwood';
  const wrongZone = turnInQuest(p, 'm2_letter', 'npc_bram');
  assertEquals(wrongZone.ok, false);
  assertEquals(countOf(p, 'q_sealed_letter'), 1, 'still non-mutating');

  // On-site with the finisher: completes, goods handed over.
  p.currentZone = 'emberdawn';
  assert(turnInQuest(p, 'm2_letter', 'npc_bram').ok);
  assertEquals(p.quests['m2_letter']?.status, 'done');
  assertEquals(countOf(p, 'q_sealed_letter'), 0, 'the letter was handed over');
});

Deno.test('handler: log callbacks refuse with guidance; NPC interaction is the only surface (#64)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(982, 'T', 'warrior');
  syncAvailability(p);
  p.messageId = 900;
  await store.set(982, p);

  // Log → detail → Accept: refused, nothing mutates. Since #65 the wire
  // form is gone entirely — these taps decode as unknown controls.
  await handleCallback(fakeCtx(982, 900, withRev(0, 'q:q:m1_embers')), store);
  let cur = (await store.get(982))!;
  await handleCallback(fakeCtx(982, 900, withRev(cur.uiRev ?? 0, 'q:a:m1_embers')), store);
  cur = (await store.get(982))!;
  assertEquals(cur.quests['m1_embers']?.status, 'available', 'log cannot accept');
  await handleCallback(fakeCtx(982, 900, withRev(cur.uiRev ?? 0, 'q:t:m1_embers')), store);
  cur = (await store.get(982))!;
  assertEquals(cur.quests['m1_embers']?.status, 'available', 'log cannot turn in either');

  // Back to the zone, then talk to Maren (npc index 0): the npcq opens.
  await handleCallback(fakeCtx(982, 900, withRev(cur.uiRev ?? 0, 'q:bk')), store);
  cur = (await store.get(982))!;
  await handleCallback(fakeCtx(982, 900, withRev(cur.uiRev ?? 0, 'z:tk:0')), store);
  cur = (await store.get(982))!;
  assertEquals(cur.scene.view, 'npcq');
  assertEquals(cur.scene.arg2, 'npc_maren');

  // Accept through the interaction — authoritative.
  await handleCallback(fakeCtx(982, 900, withRev(cur.uiRev ?? 0, 'n:a:m1_embers')), store);
  cur = (await store.get(982))!;
  assertEquals(cur.quests['m1_embers']?.status, 'active');

  // Duplicate accept (same revision): the rev guard rejects it — no replay.
  const before = JSON.stringify(cur.quests['m1_embers']);
  await handleCallback(fakeCtx(982, 900, withRev(cur.uiRev ?? 0, 'n:a:m1_embers')), store);
  cur = (await store.get(982))!;
  assertEquals(JSON.stringify(cur.quests['m1_embers']), before, 'duplicate is a no-op');
});

Deno.test('handler: duplicate turn-in callbacks cannot grant rewards twice (#64)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(983, 'T', 'warrior');
  syncAvailability(p);
  assert(acceptQuest(p, 'm1_embers', 'npc_maren').ok);
  for (let i = 0; i < 4; i++) onKill(p, 'e_ember_rat');
  p.messageId = 910;
  await store.set(983, p);

  // Open the interaction the way the UI does: talk to Maren.
  let cur = (await store.get(983))!;
  await handleCallback(fakeCtx(983, 910, withRev(cur.uiRev ?? 0, 'z:tk:0')), store);
  cur = (await store.get(983))!;
  assertEquals(cur.scene.view, 'npcq');
  const rev = cur.uiRev ?? 0;
  await handleCallback(fakeCtx(983, 910, withRev(rev, 'n:t:m1_embers')), store);
  cur = (await store.get(983))!;
  assertEquals(cur.quests['m1_embers']?.status, 'done');
  const gold = cur.gold;
  // Redelivered confirmation: rejected by the revision guard.
  await handleCallback(fakeCtx(983, 910, withRev(rev, 'n:t:m1_embers')), store);
  cur = (await store.get(983))!;
  assertEquals(cur.gold, gold, 'no double reward');
  assertEquals(cur.quests['m1_embers']?.status, 'done');
});

Deno.test('handler: npcq callbacks without a live interaction are harmless refusals (#64)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(984, 'T', 'warrior');
  syncAvailability(p);
  p.messageId = 920;
  p.scene = { view: 'zone' }; // NOT an npcq interaction
  await store.set(984, p);
  let cur = (await store.get(984))!;
  await handleCallback(fakeCtx(984, 920, withRev(cur.uiRev ?? 0, 'n:a:m1_embers')), store);
  cur = (await store.get(984))!;
  assertEquals(cur.quests['m1_embers']?.status ?? 'unavailable', 'available', 'no accept');

  // Wrong-context interaction: the live scene holds a DIFFERENT quest.
  cur.scene = { view: 'npcq', arg: 'm2_letter', arg2: 'npc_maren' };
  await store.set(984, cur);
  cur = (await store.get(984))!;
  await handleCallback(fakeCtx(984, 920, withRev(cur.uiRev ?? 0, 'n:a:m1_embers')), store);
  cur = (await store.get(984))!;
  assertEquals(
    cur.quests['m1_embers']?.status ?? 'unavailable',
    'available',
    'scene mismatch refuses',
  );
});

Deno.test('handler: the Maren → Bram delivery end to end (#63, #64)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(985, 'T', 'warrior');
  p.level = 5;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(p, 'q_sealed_letter', 1); // m1's reward is in the bag
  syncAvailability(p); // m2 becomes available
  p.messageId = 930;
  await store.set(985, p);

  let cur = (await store.get(985))!;
  // Talk to Maren (index 0) — she OFFERS m2 (starter routing).
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'z:tk:0')), store);
  cur = (await store.get(985))!;
  assertEquals(cur.scene.view, 'npcq');
  assertEquals(cur.scene.arg, 'm2_letter');
  assertEquals(cur.scene.arg2, 'npc_maren');
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'n:a:m2_letter')), store);
  cur = (await store.get(985))!;
  assertEquals(cur.quests['m2_letter']?.status, 'active');

  // Back out, then talk to Bram: onTalk ticks the talk objective, and Bram
  // is the FINISHER — ready business surfaces ahead of new offers (#63).
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'n:bk')), store);
  cur = (await store.get(985))!;
  assertEquals(cur.scene.view, 'zone', 'Back leaves the interaction');
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'z:tk:1')), store); // Bram
  cur = (await store.get(985))!;
  assertEquals(cur.scene.view, 'npcq');
  assertEquals(cur.scene.arg, 'm2_letter');
  assertEquals(cur.scene.arg2, 'npc_bram', 'Bram is the finisher');
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'n:t:m2_letter')), store);
  cur = (await store.get(985))!;
  assertEquals(cur.quests['m2_letter']?.status, 'done');
  assertEquals(countOf(cur, 'q_sealed_letter'), 0, 'letter handed to Bram');
});

Deno.test('renderer: the interaction view offers buttons only for the right contact on-site (#64)', () => {
  const p = createPlayer(986, 'T', 'warrior');
  syncAvailability(p);
  // The npcq render for m1 at the WRONG npc (Bram) shows no Accept button.
  const wrong = JSON.stringify(renderQuestInteraction(p, 'm1_embers', 'npc_bram'));
  assert(!wrong.includes('n:a:m1_embers'), 'no accept authority off-contact');
  // At the right npc, the Accept button appears.
  const right = JSON.stringify(renderQuestInteraction(p, 'm1_embers', 'npc_maren'));
  assert(right.includes('n:a:m1_embers'), 'on-site starter gets the button');
});
