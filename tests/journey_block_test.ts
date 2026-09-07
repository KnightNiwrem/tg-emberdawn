/**
 * #166 — a live journey owns the interaction flow: central economy
 * mutations (buy/sell/temper), zone-bound engine ops (explore, dive,
 * quest lifecycle, story ops) and the real callback router all refuse
 * during battle-free intermissions, with navigation left open.
 */

import { assert, assertEquals } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { battleAction } from '../src/handlers/battle.ts';
import { addItem } from '../src/engine/inventory.ts';
import { startJourney } from '../src/engine/journey.ts';
import { explore } from '../src/engine/world.ts';
import { buy, sell } from '../src/engine/shops.ts';
import { temper } from '../src/engine/forge.ts';
import { acceptQuest, syncAvailability, turnInQuest } from '../src/engine/quests.ts';
import {
  applyDialogueChoice,
  applyStoryEffects,
  validateStoryBundle,
} from '../src/engine/story.ts';
import * as journeyMods from '../src/engine/journey.ts';
import { diveDungeon, dungeonOf } from '../src/engine/world.ts';
import { zone } from '../src/content/zones.ts';
import { route } from '../src/content/routes.ts';
import type { Condition } from '../src/content/types.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { withRev } from '../src/codec.ts';
import { fakeCtxCapture, seeded } from './helpers.ts';
import type { PlayerState } from '../src/engine/types.ts';

function stub(...values: number[]): () => number {
  let drawIndex = 0;
  return () => values[Math.min(drawIndex++, values.length - 1)]!;
}

/** A warrior parked at a battle-free journey intermission: one travel
 * battle won and Continued — the crossing is live, no battle attached. */
function intermission(id: number, from = 'sunspire', to = 'frostpeak'): PlayerState {
  const player = createPlayer(id, 'Walker', 'warrior');
  player.tutorial = 'done';
  player.level = 30;
  player.currentZone = from;
  player.unlockedZones.push(to);
  const res = startJourney(player, `w_${from}_${to}`, stub(0.1));
  assert(res.ok && res.step.kind === 'battle', 'the crossing pauses at its road fight');
  player.battle!.enemy.hp = 0;
  battleAction(player, { v: 'battle', a: 'atk' }); // victory completes the event
  battleAction(player, { v: 'battle', a: 'go' }); // Continue → the intermission view
  assertEquals(player.scene.view, 'journey');
  assert(player.journey, 'the crossing is live');
  assertEquals(player.battle, undefined, 'the intermission is battle-free');
  return player;
}

/** Snapshot of every state a zone-bound mutation could touch. */
function footprint(player: PlayerState): string {
  return JSON.stringify({
    gold: player.gold,
    inv: player.inventory,
    flags: player.flags,
    quests: player.quests,
    hp: player.hp,
    mp: player.mp,
    journey: player.journey,
    battle: player.battle,
  });
}

// ── central economy mutations (#166) ─────────────────────────────────────

Deno.test('intermission: direct buy, sell and temper refuse without mutation', () => {
  const player = intermission(1660, 'cinder', 'umbra'); // cinder authors shop + forge
  player.gold = 10000;
  addItem(player, 'm_cinder_heart', 50);
  const before = footprint(player);
  for (
    const attempt of [
      buy(player, 'c_super_potion', 2),
      sell(player, 'c_minor_potion', 1),
      temper(player, 'weapon'),
    ]
  ) {
    assert(!attempt.ok, 'the mutation is refused');
    assert(
      attempt.lines.some((line) => line.includes('crossing')),
      `guidance: ${attempt.lines[0]}`,
    );
  }
  assertEquals(footprint(player), before, 'not one coin, item or temper level moved');
});

Deno.test('intermission: explore and dungeon dives refuse at the engine', () => {
  const player = intermission(1661);
  const before = footprint(player);
  const ex = explore(player, seeded(1));
  assert(ex.kind === 'result', 'no battle starts');
  assert(ex.lines.some((line) => line.includes('crossing')));
  const dungeon = dungeonOf(zone('sunspire')!);
  assert(dungeon);
  const dive = diveDungeon(player, dungeon, seeded(2));
  assert(!dive.ok, 'the dive refuses');
  assert(dive.lines.some((line) => line.includes('crossing')));
  assertEquals(footprint(player), before, 'no battle started, nothing rolled');
});

Deno.test('intermission: quest lifecycle contacts refuse at the engine', () => {
  const player = intermission(1662, 'whisperwood', 'hollowmere');
  syncAvailability(player);
  player.quests['m4_floors'] = { status: 'turnIn', counts: [3, 2] };
  const before = footprint(player);
  // Origin-zone contacts are physically present — presence alone must
  // never authorize quest business on the road.
  const accept = acceptQuest(player, 'm4_floors', 'npc_warden_tom');
  assert(!accept.ok);
  assert(accept.lines.some((line) => line.includes('crossing')));
  const turnIn = turnInQuest(player, 'm4_floors', 'npc_warden_tom');
  assert(!turnIn.ok);
  assert(turnIn.lines.some((line) => line.includes('crossing')));
  assertEquals(footprint(player), before, 'quest state untouched');
});

Deno.test('intermission: the story ops refuse — choices and bundles never apply on the road', () => {
  const player = intermission(1663, 'whisperwood', 'hollowmere');
  const before = footprint(player);
  const choice = applyDialogueChoice(player, { choiceId: 'whatever', now: 0 });
  assert(!choice.ok);
  assert((choice.refusal ?? '').includes('crossing'), `refusal: ${choice.refusal}`);
  const bundle = validateStoryBundle(
    player,
    [{ kind: 'grantItem', itemId: 'c_antidote', qty: 1 }],
    {
      dialogueId: 'dlg_ferry_promise',
      nodeId: 'n1',
      npcId: 'npc_ferryman',
      now: 0,
    },
  );
  assertEquals(bundle, '🧭 Finish the crossing first.', 'preflight refuses in lockstep');
  let threw = '';
  try {
    applyStoryEffects(player, [{ kind: 'grantItem', itemId: 'c_antidote', qty: 1 }], {
      dialogueId: 'dlg_ferry_promise',
      nodeId: 'n1',
      npcId: 'npc_ferryman',
      now: 0,
    });
  } catch (error) {
    threw = String(error);
  }
  assert(threw.includes('crossing'), 'application refuses without committing');
  assertEquals(footprint(player), before, 'no story mutation committed');
});

// ── the real callback router (#166: current-rev forged callbacks) ────────

Deno.test('router: current-revision forged callbacks cannot operate NPC, dialogue, shop or forge flows', async () => {
  const store = new MemoryStore();
  const player = intermission(1664, 'cinder', 'umbra');
  player.gold = 10000;
  await store.set(player.userId, player);

  const forged = [
    'npc:op:npc_ashen', // the ORIGIN zone's NPC — present, still refused
    'npc:q:m20_ignivar',
    'npc:lore:sorrel_flame',
    'dlg:nx:n2',
    'dlg:ch:take_pledge',
    'dlg:cf:take_pledge',
    'h:buy:c_super_potion',
    'h:view:c_super_potion',
    'h:sell:c_minor_potion',
    'f:w',
    'f:a',
    'z:ex',
    'z:dg',
    'z:tk:0',
    'z:tv',
    'z:sh',
    'z:fg',
  ];
  const before = footprint(player);
  for (const wire of forged) {
    // Every tap rides the CURRENT revision on an adopted newer message
    // copy — staleness alone must never be the refuser.
    const live = (await store.get(player.userId))!;
    const tap = fakeCtxCapture(player.userId, 900000, withRev(live.uiRev, wire));
    await handleCallback(tap.ctx, store);
    const after = (await store.get(player.userId))!;
    assertEquals(after.scene.view, 'journey', `${wire} lands back on the crossing`);
    assertEquals(
      after.journey?.completedEvents,
      player.journey!.completedEvents,
      `${wire} rolls nothing`,
    );
    assertEquals(footprint(after), before, `${wire} mutates nothing`);
  }
});

Deno.test('router: navigation and the journey controls stay usable mid-crossing', async () => {
  const store = new MemoryStore();
  const player = intermission(1665, 'cinder', 'umbra');
  await store.set(player.userId, player);

  // Back navigation mutates nothing gameplay-wise and never refuses. Each
  // tap rides the CURRENT revision (the commit bumps it) on an adopted
  // newer message copy.
  for (const data of ['npc:bk', 'h:bk', 'f:bk', 'dlg:bk', 'dlg:cc']) {
    const live = (await store.get(player.userId))!;
    const tap = fakeCtxCapture(player.userId, 900000, withRev(live.uiRev, data));
    await handleCallback(tap.ctx, store);
    const after = (await store.get(player.userId))!;
    assert(after.journey, `${data} keeps the crossing alive`);
  }
  // The zone hub's home button re-centers the crossing.
  const live = (await store.get(player.userId))!;
  const home = fakeCtxCapture(player.userId, 900000, withRev(live.uiRev, 'z:hm'));
  await handleCallback(home.ctx, store);
  const homeP = (await store.get(player.userId))!;
  assertEquals(homeP.scene.view, 'journey', 'home returns to the crossing');
  // The journey's own controls still work: retreat aborts to the origin.
  const live2 = (await store.get(player.userId))!;
  const retreat = fakeCtxCapture(player.userId, 900000, withRev(live2.uiRev, 'j:rt'));
  await handleCallback(retreat.ctx, store);
  const done = (await store.get(player.userId))!;
  assertEquals(done.journey, undefined, 'retreat still resolves');
  assertEquals(done.currentZone, 'cinder', 'back at the origin');
});

Deno.test('router: the same forged callbacks behave identically during a journey battle', async () => {
  const store = new MemoryStore();
  const player = createPlayer(1666, 'Walker', 'warrior');
  player.tutorial = 'done';
  player.level = 30;
  player.currentZone = 'sunspire';
  player.unlockedZones.push('frostpeak');
  const res = startJourney(player, 'w_sunspire_frostpeak', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  await store.set(player.userId, player);
  const before = footprint(player);
  for (const data of ['npc:op:npc_curator', 'h:buy:c_potion', 'f:w', 'z:ex', 'z:dg']) {
    const tap = fakeCtxCapture(player.userId, 700, withRev(player.uiRev, data));
    await handleCallback(tap.ctx, store);
    const after = (await store.get(player.userId))!;
    assertEquals(footprint(after), before, `${data} mutates nothing mid-battle`);
    await store.set(player.userId, after);
  }
});

Deno.test('router: a forged departure callback for a gated road refuses; the open road departs (#168)', async () => {
  const store = new MemoryStore();
  // Patch a top-level gate onto the zero-event Root-path (no shipped
  // route authors one yet) and restore it after the test.
  const edge = route('w_outskirts_whisperwood')!;
  const edgeAny = edge as typeof edge & { when?: Condition };
  edgeAny.when = { flag: { id: 'road_gate_open' } };
  try {
    const player = createPlayer(1668, 'Walker', 'warrior');
    player.tutorial = 'done';
    player.currentZone = 'outskirts';
    await store.set(player.userId, player);
    // The forged departure (current revision, live message copy) is
    // refused: no arrival, no journey, no RNG consumption.
    const live = (await store.get(player.userId))!;
    const tap = fakeCtxCapture(
      player.userId,
      900000,
      withRev(live.uiRev, 't:go:w_outskirts_whisperwood'),
    );
    await handleCallback(tap.ctx, store);
    const refused = (await store.get(player.userId))!;
    assertEquals(refused.currentZone, 'outskirts', 'the player never left');
    assertEquals(refused.journey, undefined, 'no crossing started');
    assertEquals(refused.stats.battlesWon, 0, 'nothing resolved on the refused tap');
    // The same callback departs once the live condition turns true —
    // the zero-event road arrives directly.
    refused.flags['road_gate_open'] = true;
    await store.set(refused.userId, refused);
    const live2 = (await store.get(refused.userId))!;
    const tap2 = fakeCtxCapture(
      refused.userId,
      900000,
      withRev(live2.uiRev, 't:go:w_outskirts_whisperwood'),
    );
    await handleCallback(tap2.ctx, store);
    const arrived = (await store.get(refused.userId))!;
    assertEquals(arrived.currentZone, 'whisperwood', 'the opened road departs');
    assertEquals(arrived.journey, undefined);
  } finally {
    delete edgeAny.when;
  }
});

Deno.test('after arrival the same actions work again (the refusal is journey-scoped)', () => {
  const player = intermission(1667, 'sunspire', 'frostpeak');
  // Continue through the last roll (a quiet one, stub-picked) → arrival.
  const { advanceJourney } = journeyMods;
  const step = advanceJourney(player, stub(0.75));
  assertEquals(step.kind, 'arrived');
  assertEquals(player.journey, undefined, 'the crossing is over');
  assertEquals(player.currentZone, 'frostpeak');
  // The engine mutations behave normally again.
  const ex = explore(player, seeded(3));
  assert(
    ex.kind === 'battle' || ex.lines.every((line) => !line.includes('crossing')),
    'explore no longer refuses once the road ends',
  );
  const noQuest = acceptQuest(player, 'm13_pass', 'npc_outcast');
  assert(!noQuest.ok, 'still gated by quest availability — not by the journey');
  assert(!noQuest.msg.includes('crossing'), 'the journey is not the refuser anymore');
});
