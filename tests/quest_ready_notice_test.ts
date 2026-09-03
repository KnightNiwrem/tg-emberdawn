/** Quest-ready notices (#119): every active→turnIn transition must surface
 * ONE named `📜 "<name>" is ready to turn in!` line on the surface that
 * caused it — victory resolution, arrival, the talk interaction, acceptance,
 * or an item grant — and never re-announce on rechecks or redraws. */

import { assert, assertEquals } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { startBattle } from '../src/engine/combat.ts';
import { addItem, countOf } from '../src/engine/inventory.ts';
import {
  acceptQuest,
  grantItem,
  onItemGain,
  onKill,
  onTalk,
  questReadyLine,
  syncAvailability,
} from '../src/engine/quests.ts';
import { resolveVictory, travel } from '../src/engine/world.ts';
import { battleAction, enterBattle } from '../src/handlers/battle.ts';
import { npcqAction } from '../src/handlers/hub.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { withRev } from '../src/codec.ts';
import { fakeCtxCapture, seeded } from './helpers.ts';

const readyHits = (lines: string[]): string[] =>
  lines.filter((l) => l.includes('ready to turn in'));

Deno.test('ready notice: a kill objective completed in battle surfaces one named victory line', () => {
  const p = createPlayer(1201, 'T', 'warrior');
  syncAvailability(p);
  assert(acceptQuest(p, 'm1_embers', 'npc_maren').ok);
  for (let i = 0; i < 3; i++) assertEquals(onKill(p, 'e_ember_rat'), []);

  const b = startBattle('e_ember_rat', { kind: 'explore', zoneId: 'outskirts' }, {
    player: p,
    rng: seeded(41),
  })!.battle;
  b.enemy.hp = 0;
  const lines = resolveVictory(p, b, seeded(42));
  assertEquals(p.quests['m1_embers']!.status, 'turnIn');
  assertEquals(
    readyHits(lines),
    ['📜 “Sparks of Trouble” is ready to turn in!'],
    'exactly one named notice in the victory result',
  );
  // The notice rides the resolution lines, after the defeat headline.
  assert(
    lines.indexOf(readyHits(lines)[0]!) > lines.findIndex((l) => l.includes('is defeated!')),
    'readiness is announced after the victory headline',
  );
});

Deno.test('ready notice: onKill returns newly-ready ids; rechecks never re-report', () => {
  const p = createPlayer(1202, 'T', 'warrior');
  syncAvailability(p);
  assert(acceptQuest(p, 'm1_embers', 'npc_maren').ok);
  for (let i = 0; i < 3; i++) assertEquals(onKill(p, 'e_ember_rat'), []);
  assertEquals(onKill(p, 'e_ember_rat'), ['m1_embers'], 'the completing kill reports the quest');
  assertEquals(onKill(p, 'e_ember_rat'), [], 'an already-ready quest never re-reports');
  assertEquals(onItemGain(p), [], 'an unrelated recheck stays silent');
  assertEquals(p.quests['m1_embers']!.status, 'turnIn');
});

Deno.test('ready notice: a reach objective completed by travel surfaces one named arrival line', () => {
  const p = createPlayer(1203, 'T', 'warrior');
  p.level = 9;
  p.quests['m4_blessing'] = { status: 'done', counts: [] };
  syncAvailability(p);
  assert(acceptQuest(p, 'm5_fen', 'npc_bram').ok);
  p.unlockedZones.push('hollowmere');

  const res = travel(p, 'hollowmere');
  assert(res.ok);
  assertEquals(p.quests['m5_fen']!.status, 'turnIn');
  assertEquals(
    readyHits(res.lines),
    ['📜 “Into the Fen” is ready to turn in!'],
    'the arrival result carries the notice',
  );

  // Leaving and returning never repeats it.
  assert(travel(p, 'emberdawn').ok);
  const again = travel(p, 'hollowmere');
  assertEquals(readyHits(again.lines), [], 're-arrival is silent');
});

Deno.test('ready notice: a dungeon objective completed by the boss clear surfaces one named line', () => {
  const p = createPlayer(1204, 'T', 'warrior');
  p.level = 45;
  p.quests['m25_silence'] = { status: 'active', counts: [0] };
  const origin = {
    kind: 'dungeon',
    zoneId: 'abyss',
    dungeonId: 'd_seam',
    floor: 5,
    boss: true,
  } as const;

  const b = startBattle('e_warden', origin, { player: p, rng: seeded(43) })!.battle;
  b.enemy.hp = 0;
  const lines = resolveVictory(p, b, seeded(44));
  assert(lines.some((l) => l.includes('First clear')), 'boss-clear bookkeeping intact');
  assertEquals(p.quests['m25_silence']!.status, 'turnIn');
  assertEquals(
    readyHits(lines),
    ['📜 “Before the Dawn” is ready to turn in!'],
    'the boss-clear result carries the notice',
  );

  // A rematch clear never repeats it.
  const rematch = startBattle('e_warden', origin, { player: p, rng: seeded(45) })!.battle;
  rematch.enemy.hp = 0;
  assertEquals(readyHits(resolveVictory(p, rematch, seeded(46))), [], 'rematch stays silent');
});

Deno.test('ready notice: a talk objective reports readiness from onTalk, once', () => {
  const p = createPlayer(1205, 'T', 'warrior');
  p.level = 2;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(p, 'q_sealed_letter', 1); // m1's reward is in the bag
  syncAvailability(p);
  assert(acceptQuest(p, 'm2_letter', 'npc_maren').ok);
  assertEquals(p.quests['m2_letter']!.status, 'active', 'the talk objective is still open');

  assertEquals(onTalk(p, 'npc_bram'), ['m2_letter'], 'the completing conversation reports it');
  assertEquals(p.quests['m2_letter']!.status, 'turnIn');
  assertEquals(onTalk(p, 'npc_bram'), [], 'talking again never re-reports');
});

Deno.test('ready notice: multi-objective quests stay silent until ALL objectives are met', () => {
  const p = createPlayer(1206, 'T', 'warrior');
  p.level = 2;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(p, 'q_sealed_letter', 1); // the collect half is satisfied pre-accept
  syncAvailability(p);

  const res = acceptQuest(p, 'm2_letter', 'npc_maren');
  assert(res.ok);
  assertEquals(p.quests['m2_letter']!.status, 'active', 'collect alone does not ready m2');
  assert(res.lines[0]!.includes('Quest accepted'));
  assertEquals(readyHits(res.lines), [], 'no readiness claim while the talk objective is open');
});

Deno.test('ready notice: an ordinary combat drop completing a collect objective announces exactly once', () => {
  const p = createPlayer(1207, 'T', 'warrior');
  p.quests['m6_toxin'] = { status: 'active', counts: [0] };
  addItem(p, 'q_toxin_sample', 3); // one sample short of the four required
  const rng = seeded(47);
  let notices = 0;
  for (let i = 0; i < 60 && countOf(p, 'q_toxin_sample') < 4; i++) {
    const b = startBattle('e_leech', { kind: 'explore', zoneId: 'hollowmere' }, {
      player: p,
      rng,
    })!.battle;
    b.enemy.hp = 0;
    const lines = resolveVictory(p, b, rng);
    const hits = readyHits(lines);
    notices += hits.length;
    for (const hit of hits) {
      assert(hit.includes('The Water'), `the notice names the quest: ${hit}`);
      assertEquals(countOf(p, 'q_toxin_sample'), 4, 'the notice fires on the completing drop');
    }
  }
  assertEquals(countOf(p, 'q_toxin_sample'), 4, 'the fourth sample eventually drops');
  assertEquals(p.quests['m6_toxin']!.status, 'turnIn');
  assertEquals(notices, 1, 'exactly one notice across the whole grind');

  // Further victories after readiness stay silent (drops are also capped).
  const b = startBattle('e_leech', { kind: 'explore', zoneId: 'hollowmere' }, {
    player: p,
    rng,
  })!.battle;
  b.enemy.hp = 0;
  assertEquals(readyHits(resolveVictory(p, b, rng)), [], 'no repeat after the flip');
});

Deno.test('ready notice: one event completing multiple quests reports each once, in order', () => {
  const p = createPlayer(1208, 'T', 'warrior');
  // sq_ore needs 3 iron, m5_arms needs 2 — with 1 in the bag, ONE grant of 2
  // completes both in the same readiness sweep.
  p.quests['sq_ore'] = { status: 'active', counts: [0] };
  p.quests['m5_arms'] = { status: 'active', counts: [0] };
  addItem(p, 'm_iron_chunk', 1);
  const ready = grantItem(p, 'm_iron_chunk', 2);
  assertEquals(ready, ['sq_ore', 'm5_arms'], 'deterministic order, each quest exactly once');
  assertEquals(ready.map(questReadyLine), [
    '📜 “Ore for the Forge” is ready to turn in!',
    '📜 “Steel for the Descent” is ready to turn in!',
  ]);
  assertEquals(p.quests['sq_ore']!.status, 'turnIn');
  assertEquals(p.quests['m5_arms']!.status, 'turnIn');
});

Deno.test('ready notice: accepting an immediately-complete quest reports acceptance AND readiness', () => {
  const p = createPlayer(1209, 'T', 'warrior');
  p.level = 13;
  p.unlockedZones.push('hollowmere');
  p.currentZone = 'hollowmere'; // the Ferryman stands here
  // m8_passage's talk objective names the Ferryman — accepting AT him is the
  // conversation itself, so the quest is complete the moment it is accepted.
  p.quests['m8_passage'] = { status: 'available', counts: [] };
  const res = acceptQuest(p, 'm8_passage', 'npc_ferryman');
  assert(res.ok);
  assertEquals(p.quests['m8_passage']!.status, 'turnIn');
  assertEquals(
    res.lines,
    [`📜 Quest accepted: The Curator's Summons`, questReadyLine('m8_passage')],
    'both the acceptance and the readiness are reported',
  );
  assert(res.lines[1]!.includes('The Curator'), 'the notice names the quest');
});

Deno.test('ready notice: the npcq accept surface carries both lines', () => {
  const p = createPlayer(1210, 'T', 'warrior');
  p.level = 13;
  p.unlockedZones.push('hollowmere');
  p.currentZone = 'hollowmere';
  p.quests['m8_passage'] = { status: 'available', counts: [] };
  p.scene = { view: 'npcq', arg: 'm8_passage', arg2: 'npc_ferryman' };
  const res = npcqAction(p, { v: 'npcq', a: 'a', arg: 'm8_passage' });
  assertEquals(res.toast, undefined);
  assert(p.notices.some((l) => l.includes('Quest accepted')), 'acceptance is announced');
  assertEquals(
    readyHits(p.notices),
    ["📜 “The Curator's Summons” is ready to turn in!"],
    'immediate readiness is announced in the same interaction',
  );
});

Deno.test('ready notice: talking to the NPC surfaces the notice through the full router', async () => {
  const store = new MemoryStore();
  const p = createPlayer(1211, 'T', 'warrior');
  p.level = 2;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  grantItem(p, 'q_sealed_letter', 1);
  syncAvailability(p);
  assert(acceptQuest(p, 'm2_letter', 'npc_maren').ok);
  p.messageId = 950;
  await store.set(1211, p);

  // Bram is the second NPC of Emberdawn Village — talking to him completes
  // m2's talk objective and opens the authoritative interaction.
  const cur0 = (await store.get(1211))!;
  const tap = fakeCtxCapture(1211, 950, withRev(cur0.uiRev ?? 0, 'z:tk:1'));
  await handleCallback(tap.ctx, store);
  const cur = (await store.get(1211))!;
  assertEquals(cur.scene.view, 'npcq');
  assertEquals(cur.scene.arg, 'm2_letter');
  assertEquals(cur.scene.arg2, 'npc_bram');
  // Notices drain on commit, so assert on what the player was actually shown.
  assertEquals(tap.edits.length, 1, 'the interaction is delivered in place');
  const delivered = JSON.stringify(tap.edits[0]);
  assert(
    delivered.includes('📜 “The Sealed Letter” is ready to turn in!'),
    'the talk interaction itself carries the notice',
  );
  assertEquals(
    delivered.split('ready to turn in').length - 1,
    1,
    'the notice is delivered exactly once',
  );
});

Deno.test('ready notice: a battle-action victory announces readiness in notices, never in the round log', () => {
  const p = createPlayer(1212, 'T', 'warrior');
  syncAvailability(p);
  assert(acceptQuest(p, 'm1_embers', 'npc_maren').ok);
  for (let i = 0; i < 3; i++) onKill(p, 'e_ember_rat');
  const b = startBattle('e_ember_rat', { kind: 'explore', zoneId: 'outskirts' }, {
    player: p,
    rng: seeded(48),
  })!.battle;
  p.battle = b;
  b.enemy.hp = 1; // one strike ends it

  battleAction(p, { v: 'battle', a: 'atk' });
  assertEquals(b.phase, 'won');
  assertEquals(
    readyHits(p.notices),
    ['📜 “Sparks of Trouble” is ready to turn in!'],
    'the victory screen carries the notice',
  );
  assertEquals(
    b.history.flatMap((r) => r.lines).filter((l) => l.includes('ready to turn in')),
    [],
    'quest notices never leak into the combat-round history',
  );
});

Deno.test('ready notice: an opening-terminal victory shares resolveVictory behavior', () => {
  const p = createPlayer(1213, 'T', 'warrior');
  syncAvailability(p);
  assert(acceptQuest(p, 'm1_embers', 'npc_maren').ok);
  for (let i = 0; i < 3; i++) onKill(p, 'e_ember_rat');
  const b = startBattle('e_ember_rat', { kind: 'explore', zoneId: 'outskirts' }, {
    player: p,
    rng: seeded(49),
  })!.battle;
  b.enemy.hp = 0;

  // The opening adjudicated the fight terminal before any round ran (#96):
  // the SAME resolution lines must carry the notice.
  enterBattle(p, b, 'victory', ['⚡ The opening ends it before it begins.']);
  assertEquals(b.phase, 'won');
  assertEquals(p.notices[0], '⚡ The opening ends it before it begins.');
  assertEquals(
    readyHits(p.notices),
    ['📜 “Sparks of Trouble” is ready to turn in!'],
    'opening-terminal and action victories behave identically',
  );
});
