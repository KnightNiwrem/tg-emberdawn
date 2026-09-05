/**
 * #166 — a live journey owns the interaction flow: central economy
 * mutations (buy/sell/temper), zone-bound engine ops (explore, dive,
 * quest lifecycle, story ops) and the real callback router all refuse
 * during battle-free intermissions, with navigation left open.
 */

import { assert, assertEquals } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { battleAction } from '../src/handlers/battle.ts';
import { addItem, countOf } from '../src/engine/inventory.ts';
import { startJourney } from '../src/engine/journey.ts';
import { explore, travelDirect } from '../src/engine/world.ts';
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
import { MemoryStore } from '../src/persistence/store.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { withRev } from '../src/codec.ts';
import { fakeCtxCapture, seeded } from './helpers.ts';
import type { PlayerState } from '../src/engine/types.ts';

function stub(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

/** A warrior parked at a battle-free journey intermission: one travel
 * battle won and Continued — the crossing is live, no battle attached. */
function intermission(id: number, from = 'sunspire', to = 'frostpeak'): PlayerState {
  const p = createPlayer(id, 'Walker', 'warrior');
  p.tutorial = 'done';
  p.level = 30;
  p.currentZone = from;
  p.unlockedZones.push(to);
  const res = startJourney(p, `w_${from}_${to}`, stub(0.1));
  assert(res.ok && res.step.kind === 'battle', 'the crossing pauses at its road fight');
  p.battle!.enemy.hp = 0;
  battleAction(p, { v: 'battle', a: 'atk' }); // victory completes the event
  battleAction(p, { v: 'battle', a: 'go' }); // Continue → the intermission view
  assertEquals(p.scene.view, 'journey');
  assert(p.journey, 'the crossing is live');
  assertEquals(p.battle, undefined, 'the intermission is battle-free');
  return p;
}

/** Snapshot of every state a zone-bound mutation could touch. */
function footprint(p: PlayerState): string {
  return JSON.stringify({
    gold: p.gold,
    inv: p.inventory,
    flags: p.flags,
    quests: p.quests,
    hp: p.hp,
    mp: p.mp,
    journey: p.journey,
    battle: p.battle,
  });
}

// ── central economy mutations (#166) ─────────────────────────────────────

Deno.test('intermission: direct buy, sell and temper refuse without mutation', () => {
  const p = intermission(1660, 'cinder', 'umbra'); // cinder authors shop + forge
  p.gold = 10000;
  addItem(p, 'm_cinder_heart', 50);
  const before = footprint(p);
  for (
    const attempt of [
      buy(p, 'c_super_potion', 2),
      sell(p, 'c_minor_potion', 1),
      temper(p, 'weapon'),
    ]
  ) {
    assertEquals(attempt.ok, false, 'the mutation is refused');
    assert(attempt.lines.some((l) => l.includes('crossing')), `guidance: ${attempt.lines[0]}`);
  }
  assertEquals(footprint(p), before, 'not one coin, item or temper level moved');
});

Deno.test('intermission: explore and dungeon dives refuse at the engine', () => {
  const p = intermission(1661);
  const before = footprint(p);
  const ex = explore(p, seeded(1));
  assert(ex.kind === 'result', 'no battle starts');
  assert(ex.lines.some((l) => l.includes('crossing')));
  const d = dungeonOf(zone('sunspire')!);
  assert(d);
  const dive = diveDungeon(p, d, seeded(2));
  assertEquals(dive.ok, false, 'the dive refuses');
  assert(dive.lines.some((l) => l.includes('crossing')));
  assertEquals(footprint(p), before, 'no battle started, nothing rolled');
});

Deno.test('intermission: quest lifecycle contacts refuse at the engine', () => {
  const p = intermission(1662, 'whisperwood', 'hollowmere');
  syncAvailability(p);
  p.quests['m4_floors'] = { status: 'turnIn', counts: [3, 2] };
  const before = footprint(p);
  // Origin-zone contacts are physically present — presence alone must
  // never authorize quest business on the road.
  const accept = acceptQuest(p, 'm4_floors', 'npc_warden_tom');
  assertEquals(accept.ok, false);
  assert(accept.lines.some((l) => l.includes('crossing')));
  const turnIn = turnInQuest(p, 'm4_floors', 'npc_warden_tom');
  assertEquals(turnIn.ok, false);
  assert(turnIn.lines.some((l) => l.includes('crossing')));
  assertEquals(footprint(p), before, 'quest state untouched');
});

Deno.test('intermission: the story ops refuse — choices and bundles never apply on the road', () => {
  const p = intermission(1663, 'whisperwood', 'hollowmere');
  const before = footprint(p);
  const choice = applyDialogueChoice(p, { choiceId: 'whatever', now: 0 });
  assertEquals(choice.ok, false);
  assert((choice.refusal ?? '').includes('crossing'), `refusal: ${choice.refusal}`);
  const bundle = validateStoryBundle(p, [{ kind: 'grantItem', itemId: 'c_antidote', qty: 1 }], {
    dialogueId: 'dlg_ferry_promise',
    nodeId: 'n1',
    npcId: 'npc_ferryman',
    now: 0,
  });
  assertEquals(bundle, '🧭 Finish the crossing first.', 'preflight refuses in lockstep');
  let threw = '';
  try {
    applyStoryEffects(p, [{ kind: 'grantItem', itemId: 'c_antidote', qty: 1 }], {
      dialogueId: 'dlg_ferry_promise',
      nodeId: 'n1',
      npcId: 'npc_ferryman',
      now: 0,
    });
  } catch (e) {
    threw = String(e);
  }
  assert(threw.includes('crossing'), 'application refuses without committing');
  assertEquals(footprint(p), before, 'no story mutation committed');
});

// ── the real callback router (#166: current-rev forged callbacks) ────────

Deno.test('router: current-revision forged callbacks cannot operate NPC, dialogue, shop or forge flows', async () => {
  const store = new MemoryStore();
  const p = intermission(1664, 'cinder', 'umbra');
  p.gold = 10000;
  await store.set(p.userId, p);

  const forged = [
    'npc:op:npc_ashen', // the ORIGIN zone's NPC — present, still refused
    'npc:q:m20_ignivar',
    'npc:lore:sorrel_flame',
    'dlg:nx:n2',
    'dlg:ch:take_pledge',
    'dlg:cf:take_pledge',
    'h:buy:c_super_potion',
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
  const before = footprint(p);
  for (const wire of forged) {
    // Every tap rides the CURRENT revision on an adopted newer message
    // copy — staleness alone must never be the refuser.
    const live = (await store.get(p.userId))!;
    const tap = fakeCtxCapture(p.userId, 900000, withRev(live.uiRev, wire));
    await handleCallback(tap.ctx, store);
    const after = (await store.get(p.userId))!;
    assertEquals(after.scene.view, 'journey', `${wire} lands back on the crossing`);
    assertEquals(
      after.journey?.completedEvents,
      p.journey!.completedEvents,
      `${wire} rolls nothing`,
    );
    assertEquals(footprint(after), before, `${wire} mutates nothing`);
  }
});

Deno.test('router: navigation and the journey controls stay usable mid-crossing', async () => {
  const store = new MemoryStore();
  const p = intermission(1665, 'cinder', 'umbra');
  await store.set(p.userId, p);

  // Back navigation mutates nothing gameplay-wise and never refuses. Each
  // tap rides the CURRENT revision (the commit bumps it) on an adopted
  // newer message copy.
  for (const data of ['npc:bk', 'h:bk', 'f:bk', 'dlg:bk', 'dlg:cc']) {
    const live = (await store.get(p.userId))!;
    const tap = fakeCtxCapture(p.userId, 900000, withRev(live.uiRev, data));
    await handleCallback(tap.ctx, store);
    const after = (await store.get(p.userId))!;
    assert(after.journey, `${data} keeps the crossing alive`);
  }
  // The zone hub's home button re-centers the crossing.
  const live = (await store.get(p.userId))!;
  const home = fakeCtxCapture(p.userId, 900000, withRev(live.uiRev, 'z:hm'));
  await handleCallback(home.ctx, store);
  const homeP = (await store.get(p.userId))!;
  assertEquals(homeP.scene.view, 'journey', 'home returns to the crossing');
  // The journey's own controls still work: retreat aborts to the origin.
  const live2 = (await store.get(p.userId))!;
  const retreat = fakeCtxCapture(p.userId, 900000, withRev(live2.uiRev, 'j:rt'));
  await handleCallback(retreat.ctx, store);
  const done = (await store.get(p.userId))!;
  assertEquals(done.journey, undefined, 'retreat still resolves');
  assertEquals(done.currentZone, 'cinder', 'back at the origin');
});

Deno.test('router: the same forged callbacks behave identically during a journey battle', async () => {
  const store = new MemoryStore();
  const p = createPlayer(1666, 'Walker', 'warrior');
  p.tutorial = 'done';
  p.level = 30;
  p.currentZone = 'sunspire';
  p.unlockedZones.push('frostpeak');
  const res = startJourney(p, 'w_sunspire_frostpeak', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  await store.set(p.userId, p);
  const before = footprint(p);
  for (const data of ['npc:op:npc_curator', 'h:buy:c_potion', 'f:w', 'z:ex', 'z:dg']) {
    const tap = fakeCtxCapture(p.userId, 700, withRev(p.uiRev, data));
    await handleCallback(tap.ctx, store);
    const after = (await store.get(p.userId))!;
    assertEquals(footprint(after), before, `${data} mutates nothing mid-battle`);
    await store.set(p.userId, after);
  }
});

Deno.test('after arrival the same actions work again (the refusal is journey-scoped)', () => {
  const p = intermission(1667, 'sunspire', 'frostpeak');
  // Continue through the last roll (a quiet one, stub-picked) → arrival.
  const { advanceJourney } = journeyMods;
  const step = advanceJourney(p, stub(0.75));
  assertEquals(step.kind, 'arrived');
  assertEquals(p.journey, undefined, 'the crossing is over');
  assertEquals(p.currentZone, 'frostpeak');
  // The engine mutations behave normally again.
  const ex = explore(p, seeded(3));
  assert(
    ex.kind === 'battle' || ex.lines.every((l) => !l.includes('crossing')),
    'explore no longer refuses once the road ends',
  );
  const noQuest = acceptQuest(p, 'm13_pass', 'npc_outcast');
  assertEquals(noQuest.ok, false, 'still gated by quest availability — not by the journey');
  assert(!noQuest.msg.includes('crossing'), 'the journey is not the refuser anymore');
});
