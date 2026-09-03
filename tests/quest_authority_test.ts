/** Quest action authority (#64, #127): accept/turn-in require the quest's
 * configured contact, physically present in the player's current zone.
 * The Quest Log can neither accept nor turn in; wrong-site attempts never
 * mutate; the authored dialogue flows invoke the central authorities with
 * the acting NPC's identity, which the engine revalidates on-site. */

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
  onStoryEvent,
  syncAvailability,
  turnInQuest,
} from '../src/engine/quests.ts';
import { fakeCtx } from './helpers.ts';

/** Walks a dialogue from its start to its choice node via real taps. */
function walkToChoice(
  store: MemoryStore,
  userId: number,
  messageId: number,
  start: PlayerState,
): Promise<void> {
  return (async () => {
    let cur = start;
    for (let i = 0; i < 12; i++) {
      const scene = cur.scene;
      if (scene.view !== 'dialogue') return;
      const d = dialogue(scene.arg ?? '')!;
      const node = d.nodes.find((n) => n.id === scene.arg2)!;
      if (node.kind === 'choice') return;
      if (node.kind === 'line' && node.next) {
        await handleCallback(
          fakeCtx(userId, messageId, withRev(cur.uiRev ?? 0, `dlg:nx:${node.next}`)),
          store,
        );
        cur = (await store.get(userId))!;
      } else return;
    }
  })();
}

// Quest-dialogue lookup for the walker.
import { dialogue } from '../src/content/dialogues.ts';
import type { PlayerState } from '../src/engine/types.ts';

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
  onStoryEvent(p, 'heard_bram_reading'); // the conversation event — quest is ready
  assertEquals(p.quests['m2_letter']?.status, 'turnIn');

  // The reading readied it, but "return to the giver" is NOT the rule:
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

Deno.test('handler: log callbacks refuse with guidance; the topic menu is navigation (#64, #127)', async () => {
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

  // The menu is navigation; the OFFER dialogue accepts through its
  // authored choice — the central authority runs inside the effect.
  await handleCallback(fakeCtx(982, 900, withRev(cur.uiRev ?? 0, 'q:bk')), store);
  cur = (await store.get(982))!;
  await handleCallback(fakeCtx(982, 900, withRev(cur.uiRev ?? 0, 'z:tk:0')), store);
  cur = (await store.get(982))!;
  assertEquals(cur.scene.view, 'npc');
  await handleCallback(fakeCtx(982, 900, withRev(cur.uiRev ?? 0, 'npc:q:m1_embers')), store);
  cur = (await store.get(982))!;
  assertEquals(cur.scene.view, 'dialogue');
  assertEquals(cur.scene.arg, 'dlg_m1_embers_offer');
  // Walk to the accept choice and confirm it.
  await walkToChoice(store, 982, 900, cur);
  cur = (await store.get(982))!;
  assertEquals(cur.scene.arg2, 'oa');
  assertEquals(cur.quests['m1_embers']?.status, 'available', 'reading alone accepts nothing');
  await handleCallback(fakeCtx(982, 900, withRev(cur.uiRev ?? 0, 'dlg:ch:accept')), store);
  cur = (await store.get(982))!;
  assertEquals(cur.quests['m1_embers']?.status, 'active', 'the authored choice accepts');

  // Duplicate accept (same revision): the rev guard rejects it — no replay.
  const before = JSON.stringify(cur.quests['m1_embers']);
  await handleCallback(fakeCtx(982, 900, withRev(cur.uiRev ?? 0, 'dlg:ch:accept')), store);
  cur = (await store.get(982))!;
  assertEquals(JSON.stringify(cur.quests['m1_embers']), before, 'duplicate is a no-op');
});

Deno.test('handler: duplicate turn-in choices cannot grant rewards twice (#64, #127)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(983, 'T', 'warrior');
  syncAvailability(p);
  assert(acceptQuest(p, 'm1_embers', 'npc_maren').ok);
  for (let i = 0; i < 4; i++) onKill(p, 'e_ember_rat');
  p.messageId = 910;
  await store.set(983, p);

  // Open the turn-in dialogue the way the UI does: topics → ready quest.
  let cur = (await store.get(983))!;
  await handleCallback(fakeCtx(983, 910, withRev(cur.uiRev ?? 0, 'z:tk:0')), store);
  cur = (await store.get(983))!;
  await handleCallback(fakeCtx(983, 910, withRev(cur.uiRev ?? 0, 'npc:q:m1_embers')), store);
  cur = (await store.get(983))!;
  assertEquals(cur.scene.view, 'dialogue');
  assertEquals(cur.scene.arg, 'dlg_m1_embers_turnin');
  // Walk to the hand-over choice and confirm it.
  await walkToChoice(store, 983, 910, cur);
  cur = (await store.get(983))!;
  assertEquals(cur.scene.arg2, 'ta');
  const rev = cur.uiRev ?? 0;
  await handleCallback(fakeCtx(983, 910, withRev(rev, 'dlg:ch:handover')), store);
  cur = (await store.get(983))!;
  assertEquals(cur.quests['m1_embers']?.status, 'done');
  const gold = cur.gold;
  // Redelivered confirmation: rejected by the revision guard.
  await handleCallback(fakeCtx(983, 910, withRev(rev, 'dlg:ch:handover')), store);
  cur = (await store.get(983))!;
  assertEquals(cur.gold, gold, 'no double reward');
  assertEquals(cur.quests['m1_embers']?.status, 'done');
});

Deno.test('handler: dialogue choice callbacks without a live scene are harmless (#127)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(984, 'T', 'warrior');
  p.level = 2;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(p, 'q_sealed_letter', 1);
  syncAvailability(p);
  p.messageId = 920;
  p.scene = { view: 'zone' }; // NOT a dialogue
  await store.set(984, p);
  let cur = (await store.get(984))!;
  await handleCallback(fakeCtx(984, 920, withRev(cur.uiRev ?? 0, 'dlg:ch:accept')), store);
  cur = (await store.get(984))!;
  assertEquals(cur.quests['m2_letter']?.status ?? 'unavailable', 'available', 'no accept');

  // A live offer dialogue: the accept choice runs through the central
  // authority with the dialogue's OWN NPC — the right quest accepts, the
  // wrong-quest id (m1, already done) is not on this table.
  cur.scene = { view: 'dialogue', arg: 'dlg_m2_letter_offer', arg2: 'oa' };
  await store.set(984, cur);
  cur = (await store.get(984))!;
  await handleCallback(fakeCtx(984, 920, withRev(cur.uiRev ?? 0, 'dlg:ch:accept')), store);
  cur = (await store.get(984))!;
  assertEquals(cur.quests['m2_letter']?.status, 'active', 'm2 accepted via its own flow');
  assertEquals(cur.quests['m1_embers']?.status, 'done', 'm1 untouched');
});

Deno.test('handler: the Maren → Bram delivery end to end (#63, #64, #127)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(985, 'T', 'warrior');
  p.level = 5;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(p, 'q_sealed_letter', 1); // m1's reward is in the bag
  syncAvailability(p); // m2 becomes available
  p.messageId = 930;
  await store.set(985, p);

  let cur = (await store.get(985))!;
  // Talk to Maren (index 0) and open her m2 offer topic (#123).
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'z:tk:0')), store);
  cur = (await store.get(985))!;
  assertEquals(cur.scene.view, 'npc');
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'npc:q:m2_letter')), store);
  cur = (await store.get(985))!;
  assertEquals(cur.scene.view, 'dialogue');
  assertEquals(cur.scene.arg, 'dlg_m2_letter_offer');
  // Walk to the accept choice; accept.
  await walkToChoice(store, 985, 930, cur);
  cur = (await store.get(985))!;
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'dlg:ch:accept')), store);
  cur = (await store.get(985))!;
  assertEquals(cur.quests['m2_letter']?.status, 'active');
  // The accept choice ends its conversation: back to Maren's topic menu.
  assertEquals(cur.scene.view, 'npc');
  assertEquals(cur.scene.arg, 'npc_maren');

  // Then go talk to Bram: the ACTIVE business topic opens the authored
  // conversation; reaching the reading node emits the stable event that
  // completes the delivery (#127).
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'npc:bk')), store);
  cur = (await store.get(985))!;
  assertEquals(cur.scene.view, 'zone');
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'z:tk:1')), store); // Bram
  cur = (await store.get(985))!;
  assertEquals(cur.scene.view, 'npc');
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'npc:q:m2_letter')), store);
  cur = (await store.get(985))!;
  assertEquals(cur.scene.view, 'dialogue', 'the conversation topic opens the reading');
  assertEquals(cur.scene.arg, 'dlg_m2_letter_talk');
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'dlg:nx:c2')), store);
  cur = (await store.get(985))!;
  assertEquals(cur.quests['m2_letter']?.status, 'turnIn', 'the event readied the quest');
  // The ready quest's topic now routes to the turn-in dialogue.
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'dlg:bk')), store);
  cur = (await store.get(985))!;
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'npc:q:m2_letter')), store);
  cur = (await store.get(985))!;
  assertEquals(cur.scene.arg, 'dlg_m2_letter_turnin');
  await walkToChoice(store, 985, 930, cur);
  cur = (await store.get(985))!;
  await handleCallback(fakeCtx(985, 930, withRev(cur.uiRev ?? 0, 'dlg:ch:handover')), store);
  cur = (await store.get(985))!;
  assertEquals(cur.quests['m2_letter']?.status, 'done');
  assertEquals(countOf(cur, 'q_sealed_letter'), 0, 'letter handed to Bram');
});
