/**
 * #159 — persisted, resumable edge journeys: ordered event resolution,
 * exactly-once rolls, battle pauses, save/load, replay safety, and
 * persisted-identity validation.
 */

import { assert, assertEquals } from '@std/assert';
import { createPlayer, CURRENT_STATE_VERSION, statsOf } from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { addItem } from '../src/engine/inventory.ts';
import {
  advanceJourney,
  journeyLine,
  retreatFromJourney,
  startJourney,
} from '../src/engine/journey.ts';
import {
  assertResolvablePersistedIds,
  findUnresolvedPersistedIds,
} from '../src/engine/validate.ts';
import { ROUTES } from '../src/content/routes.ts';
import { item as itemDef } from '../src/content/items.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { battleAction, enterBattle } from '../src/handlers/battle.ts';
import { shopAction, zoneAction } from '../src/handlers/hub.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { withRev } from '../src/codec.ts';
import { renderJourney } from '../src/render/views.ts';
import { acceptQuest, syncAvailability } from '../src/engine/quests.ts';
import { fakeCtxCapture, seeded, travelDirect } from './helpers.ts';

/** A stub rng returning a FIXED sequence, then repeating the last value —
 * journey tables are hand-indexed against the stub in each test. */
function stub(...values: number[]): () => number {
  let drawIndex = 0;
  return () => values[Math.min(drawIndex++, values.length - 1)]!;
}

function traveler(id: number, at: string, to: string): ReturnType<typeof createPlayer> {
  const player = createPlayer(id, 'Walker', 'warrior');
  player.tutorial = 'done';
  player.currentZone = at;
  if (!player.unlockedZones.includes(to)) player.unlockedZones.push(to);
  return player;
}

// ── zero, one, and several rolls ─────────────────────────────────────────

Deno.test('zero-event edges arrive directly and never persist a journey', () => {
  const player = traveler(1500, 'mirefoot', 'hollowmere');
  const res = startJourney(player, 'w_mirefoot_hollowmere');
  assert(res.ok && res.step.kind === 'arrived');
  assertEquals(player.currentZone, 'hollowmere');
  assertEquals(player.journey, undefined);
  assert(res.step.lines.some((line) => line.includes('You arrive at')));
});

Deno.test('exactly the authored rolls are consumed, in plan order (stub-indexed)', () => {
  // w_sunspire_frostpeak: 2 events. Table at L1: marauder[0,.3), icebat[.3,.5),
  // sentinel[.5,.7), flavor[.7,.8), rest[.8,.9), treasure[.9,1) — the stub picks flavor+rest.
  const player = traveler(1501, 'sunspire', 'frostpeak');
  const res = startJourney(player, 'w_sunspire_frostpeak', stub(0.75, 0.85));
  assert(res.ok && res.step.kind === 'arrived');
  assertEquals(player.currentZone, 'frostpeak');
  assertEquals(player.journey, undefined);
  const lines = res.step.lines.join('\n');
  assert(lines.includes('frost-glass'), "the flavor event's line is in the report");
  assert(lines.includes('HP'), 'the rest event applied');
  const eventLines = res.step.lines.filter((line) =>
    line.includes('frost-glass') || line.includes('marauder-cave')
  );
  assertEquals(eventLines.length, 2, 'exactly two rolls resolved');
});

Deno.test('quiet bursts resolve consecutively; the battle pauses at the exact count', () => {
  // w_umbra_abyss: 3 events. Table at L1: nightgaunt[0,2), horror[2,4),
  // voidspawn[4,6), flavor[6,7), rest[7,8), treasure[8,9) of 9 — quiet rng
  // picks land at 0.7 (flavor) and 0.8 (rest); 0.1 rolls the first battle.
  const player = traveler(1502, 'umbra', 'abyss');
  const res = startJourney(player, 'w_umbra_abyss', stub(0.7, 0.8, 0.1));
  assert(res.ok && res.step.kind === 'battle', 'the burst stops at the battle');
  assertEquals(player.journey!.completedEvents, 2, 'two quiet rolls consumed in ONE burst');
  assertEquals(player.journey!.totalEvents, 3);
  assertEquals(player.currentZone, 'umbra', 'currentZone stays the origin');
  // The battle's Continue completes the last roll -> final arrival.
  player.battle!.enemy.hp = 0;
  battleAction(player, { v: 'battle', a: 'atk' });
  assertEquals(player.journey!.completedEvents, 3);
  battleAction(player, { v: 'battle', a: 'go' });
  assertEquals(player.currentZone, 'abyss', 'final arrival lands after the last roll');
  assertEquals(player.journey, undefined);
});

Deno.test('mixed quiet/beneficial sequences resolve in authored order', () => {
  const player = traveler(1503, 'sunspire', 'frostpeak');
  const res = startJourney(player, 'w_sunspire_frostpeak', stub(0.95, 0.75));
  assert(res.ok && res.step.kind === 'arrived');
  const report = res.step.lines;
  const treasureIdx = report.findIndex((line) => line.includes('✨'));
  const flavorIdx = report.findIndex((line) => line.includes('frost-glass'));
  assert(treasureIdx >= 0 && flavorIdx > treasureIdx, 'beneficial before quiet, in order');
});

// ── battle pauses ────────────────────────────────────────────────────────

Deno.test('a battle event pauses the journey without reaching the destination', () => {
  const player = traveler(1504, 'sunspire', 'frostpeak');
  const res = startJourney(player, 'w_sunspire_frostpeak', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  assertEquals(player.currentZone, 'sunspire', 'still at the origin');
  assert(player.journey, 'the crossing persists');
  assertEquals(player.journey.completedEvents, 0, 'the roll completes only on victory');
  assertEquals(player.battle!.origin, {
    kind: 'travel',
    zoneId: 'sunspire',
    edgeId: 'w_sunspire_frostpeak',
    eventIndex: 0,
  });
  // Identity gate: the paused journey + its travel battle both resolve.
  assertEquals(findUnresolvedPersistedIds(player), []);
});

Deno.test('victory completes the event exactly once; Continue offers the intermission', () => {
  const player = traveler(1505, 'sunspire', 'frostpeak');
  const res = startJourney(player, 'w_sunspire_frostpeak', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  const battle = player.battle!;
  battle.enemy.hp = 0;
  const goldBefore = player.gold;
  // Round-flow victory through the handler — the completion point (#159).
  battleAction(player, { v: 'battle', a: 'atk' });
  assertEquals(battle.phase, 'won');
  assertEquals(player.journey!.completedEvents, 1, 'the pending event completed exactly once');
  assertEquals(player.currentZone, 'sunspire');
  assert(player.gold > goldBefore, 'victory rewards stayed earned');
  // Mid-crossing Continue offers the stable intermission, not a burst.
  battleAction(player, { v: 'battle', a: 'go' });
  assertEquals(player.scene.view, 'journey', 'the intermission is the live view');
  assertEquals(player.currentZone, 'sunspire');
  // The next Continue resolves the last roll → final arrival.
  const step = advanceJourney(player, stub(0.75));
  assertEquals(step.kind, 'arrived');
  assertEquals(player.currentZone, 'frostpeak', 'final arrival lands after the last roll');
  assertEquals(player.journey, undefined);
});

Deno.test('an opening-terminal travel victory follows the same lifecycle', () => {
  // Patch a lethal battleStart trigger onto the Wardstone (same technique
  // as tests/opening_test.ts) so the FIRST rolled event adjudicates
  // victory during the battle opening.
  const wardstone = itemDef('t_wardstone')!;
  const original = wardstone.triggers;
  wardstone.triggers = [{
    name: 'Probe Lethal',
    trigger: 'battleStart',
    effects: [{ kind: 'damage', attack: 'phys', power: 9999 }],
  }];
  try {
    const player = traveler(1506, 'sunspire', 'frostpeak');
    player.equipment.trinket = 't_wardstone'; // the patched trigger rides equipment
    const res = startJourney(player, 'w_sunspire_frostpeak', stub(0.1));
    assert(res.ok && res.step.kind === 'battle');
    assertEquals(res.step.outcome, 'victory', 'the opening felled the road foe');
    enterBattle(player, res.step.battle, res.step.outcome, [res.step.line]);
    assertEquals(player.journey!.completedEvents, 1, 'the opening-terminal victory completed it');
    assertEquals(res.step.battle.phase, 'won');
    // Mid-crossing Continue → the intermission, then the final roll.
    battleAction(player, { v: 'battle', a: 'go' });
    assertEquals(player.scene.view, 'journey');
    const step = advanceJourney(player, stub(0.75));
    assertEquals(step.kind, 'arrived');
    assertEquals(
      player.currentZone,
      'frostpeak',
      'the crossing arrived through the same authority',
    );
  } finally {
    wardstone.triggers = original;
  }
});

Deno.test('successful flee aborts the crossing; failed flee keeps it live', () => {
  const player = traveler(1507, 'sunspire', 'frostpeak');
  player.level = 30; // outspeeds the road foe and survives its blows
  const res = startJourney(player, 'w_sunspire_frostpeak', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  // Failed flee (rng draw above the escape odds): battle AND journey stay.
  performAction(player, player.battle!, { kind: 'flee' }, stub(0.99, 0.99, 0.99, 0.99));
  assertEquals(player.battle!.phase, 'active', 'the blocked way keeps the fight');
  assert(player.journey, 'the crossing survives a failed flee');
  assertEquals(player.journey!.completedEvents, 0);
  // Smoke Bomb: GUARANTEED escape from an ordinary road fight (#160) — the
  // handler aborts edge + journey at the ORIGIN.
  player.hp = statsOf(player).maxHp;
  addItem(player, 'c_smoke_bomb', 1);
  const result = battleAction(player, { v: 'battle', a: 'use', arg: 'c_smoke_bomb' });
  assertEquals(player.battle, undefined);
  assertEquals(player.journey, undefined, 'the crossing is abandoned');
  assertEquals(player.currentZone, 'sunspire', 'the player never left the origin');
  assertEquals(result.toast, undefined);
});

// ── intermission authority ───────────────────────────────────────────────

Deno.test('journey intermission blocks invalid location actions', () => {
  const player = traveler(1508, 'sunspire', 'frostpeak');
  const res = startJourney(player, 'w_sunspire_frostpeak', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  // Win the road fight and leave the victory screen: the stable
  // intermission (no battle attached, crossing live) is the state under test.
  player.battle!.enemy.hp = 0;
  battleAction(player, { v: 'battle', a: 'atk' });
  battleAction(player, { v: 'battle', a: 'go' });
  assertEquals(player.scene.view, 'journey');
  assertEquals(player.battle, undefined);
  assert(player.journey, 'the crossing is live');
  // A second journey refuses.
  const again = startJourney(player, 'w_sunspire_frostpeak');
  assert(!again.ok);
  assert(again.refusal.includes('already on the road'));
  // Explore, dive, talk, travel, shop, forge all refuse mid-crossing.
  for (
    const tap of [
      zoneAction(player, { v: 'zone', a: 'ex' }),
      zoneAction(player, { v: 'zone', a: 'dg' }),
      zoneAction(player, { v: 'zone', a: 'tk', arg: 0 }),
      zoneAction(player, { v: 'zone', a: 'tv' }),
      zoneAction(player, { v: 'zone', a: 'sh' }),
      zoneAction(player, { v: 'zone', a: 'fg' }),
      shopAction(player, { v: 'shop', a: 'buy', arg: 'c_minor_potion' }),
    ]
  ) {
    assert(tap.toast?.includes('crossing'), `refused with guidance: ${tap.toast}`);
    assertEquals(player.scene.view, 'journey', 'the scene returns to the crossing');
  }
  assertEquals(player.currentZone, 'sunspire', 'nothing moved the player');
  // Retreat aborts to the origin without return-event rolls.
  const hpBefore = player.hp;
  const retreat = retreatFromJourney(player);
  assert(retreat.some((line) => line.includes('turn back')));
  assertEquals(player.journey, undefined);
  assertEquals(player.currentZone, 'sunspire');
  assertEquals(player.hp, hpBefore, 'retreat heals nothing and rolls nothing');
});

// ── persistence, replay, recovery ────────────────────────────────────────

Deno.test('save/load during a journey resumes without rerolling or duplicating', async () => {
  const store = new MemoryStore();
  const player = traveler(1509, 'umbra', 'abyss');
  const res = startJourney(player, 'w_umbra_abyss', stub(0.7, 0.8, 0.1));
  assert(res.ok && res.step.kind === 'battle', 'the burst stops at the road fight');
  assertEquals(player.journey!.completedEvents, 2);
  const rolls = player.journey!.completedEvents;
  await store.set(player.userId, player);

  // /start-style reload: the same save reproduces the paused fight and
  // continues without consuming anything on the way in.
  const reloaded = (await store.get(player.userId))!;
  assertResolvablePersistedIds(reloaded);
  assertEquals(reloaded.journey!.completedEvents, rolls, 'no roll consumed by loading');
  const reloadedOrigin = reloaded.battle!.origin;
  assert(reloadedOrigin.kind === 'travel');
  assertEquals(reloadedOrigin.eventIndex, rolls, 'the same event stays pending');
  // Win the resumed fight: its completion marks the pending roll exactly once.
  reloaded.battle!.enemy.hp = 0;
  battleAction(reloaded, { v: 'battle', a: 'atk' });
  assertEquals(reloaded.journey!.completedEvents, rolls + 1);
  battleAction(reloaded, { v: 'battle', a: 'go' });
  assertEquals(reloaded.currentZone, 'abyss', 'the final arrival lands once');
  assertEquals(reloaded.journey, undefined);
  await store.set(reloaded.userId, reloaded);
  const done = (await store.get(reloaded.userId))!;
  assertEquals(done.journey, undefined);
  assertEquals(done.currentZone, 'abyss');
});

Deno.test('save/load mid travel-battle keeps both halves consistent', async () => {
  const store = new MemoryStore();
  const player = traveler(1510, 'sunspire', 'frostpeak');
  const res = startJourney(player, 'w_sunspire_frostpeak', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  await store.set(player.userId, player);
  const reloaded = (await store.get(player.userId))!;
  assertResolvablePersistedIds(reloaded);
  const origin = reloaded.battle!.origin;
  assert(origin.kind === 'travel', 'travel provenance survives the round-trip');
  assertEquals(origin.edgeId, 'w_sunspire_frostpeak');
  assertEquals(origin.eventIndex, reloaded.journey!.completedEvents);
  // The battle continues exactly where it was.
  reloaded.battle!.enemy.hp = 0;
  battleAction(reloaded, { v: 'battle', a: 'atk' });
  assertEquals(reloaded.battle!.phase, 'won');
  assertEquals(reloaded.journey!.completedEvents, 1, 'the resumed fight completes its event');
});

Deno.test('corrupt journey/battle combinations are refused, never repaired', () => {
  // A travel battle without its journey.
  const orphan = traveler(1511, 'sunspire', 'frostpeak');
  orphan.battle = startBattle('e_marauder', {
    kind: 'travel',
    zoneId: 'sunspire',
    edgeId: 'w_sunspire_frostpeak',
    eventIndex: 0,
  }, { player: orphan, rng: seeded(72) })!.battle;
  assert(
    findUnresolvedPersistedIds(orphan).some((problem) =>
      problem.detail.includes('without an active journey')
    ),
    'orphan travel battle refused',
  );

  // A journey paired with a battle of the wrong provenance.
  const mismatched = traveler(1512, 'sunspire', 'frostpeak');
  const res = startJourney(mismatched, 'w_sunspire_frostpeak', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  mismatched.battle = startBattle('e_rat', { kind: 'explore', zoneId: 'sunspire' }, {
    player: mismatched,
    rng: seeded(73),
  })!.battle;
  assert(
    findUnresolvedPersistedIds(mismatched).some((problem) =>
      problem.detail.includes('non-travel battle')
    ),
    'journey + explore battle refused',
  );

  // A journey whose event index no longer matches the fight.
  const shifted = traveler(1513, 'sunspire', 'frostpeak');
  const shiftedRes = startJourney(shifted, 'w_sunspire_frostpeak', stub(0.1));
  assert(shiftedRes.ok && shiftedRes.step.kind === 'battle');
  const shiftedOrigin = shifted.battle!.origin;
  if (shiftedOrigin.kind === 'travel') {
    shifted.battle!.origin = { ...shiftedOrigin, eventIndex: 1 };
  }
  assert(
    findUnresolvedPersistedIds(shifted).some((problem) =>
      problem.detail.includes('does not match the journey progress')
    ),
    'shifted event index refused',
  );
});

Deno.test('stale and double travel callbacks cannot double-start or double-advance', async () => {
  const store = new MemoryStore();
  const player = traveler(1514, 'mirefoot', 'hollowmere');
  player.messageId = 700;
  await store.set(player.userId, player);

  // Depart on the ZERO-event crossing.
  let tap = fakeCtxCapture(1514, 700, withRev(player.uiRev, 't:go:w_mirefoot_hollowmere'));
  await handleCallback(tap.ctx, store);
  let cur = (await store.get(1514))!;
  assertEquals(cur.currentZone, 'hollowmere', 'the zero-event road arrived');
  assertEquals(cur.journey, undefined);

  // A REPLAYED departure button (stale revision) is refused untouched.
  tap = fakeCtxCapture(1514, 700, withRev(player.uiRev, 't:go:w_mirefoot_hollowmere'));
  await handleCallback(tap.ctx, store);
  cur = (await store.get(1514))!;
  assertEquals(cur.currentZone, 'hollowmere', 'no second departure');

  // A real 1-event crossing through the full router: departure → battle →
  // victory → arrival, then a replayed Continue must not roll again.
  // Production randomness is pinned for the window (defaultRng reads the
  // live Math.random), so the road roll is the battle.
  const walker = traveler(1515, 'hollowmere', 'whisperwood');
  walker.messageId = 701;
  await store.set(walker.userId, walker);
  const realRandom = Math.random;
  Math.random = () => 0.1; // boglin is the first weighted entry
  try {
    tap = fakeCtxCapture(1515, 701, withRev(walker.uiRev, 't:go:w_hollowmere_whisperwood'));
    await handleCallback(tap.ctx, store);
  } finally {
    Math.random = realRandom;
  }
  cur = (await store.get(1515))!;
  assertEquals(cur.scene.view, 'battle', 'the road fight is live');
  assertEquals(cur.battle!.origin.kind, 'travel');
  cur.battle!.enemy.hp = 0;
  await store.set(1515, cur);
  tap = fakeCtxCapture(1515, 701, withRev(cur.uiRev, 'b:atk'));
  await handleCallback(tap.ctx, store);
  cur = (await store.get(1515))!;
  assertEquals(cur.battle!.phase, 'won', 'the road fight is won');
  assertEquals(cur.journey!.completedEvents, 1, 'the single roll completed');
  const revAfterWin = cur.uiRev;
  tap = fakeCtxCapture(1515, 701, withRev(revAfterWin, 'b:go'));
  await handleCallback(tap.ctx, store);
  cur = (await store.get(1515))!;
  assertEquals(cur.currentZone, 'whisperwood', 'final arrival through the router');
  assertEquals(cur.journey, undefined);
  // A replayed arrival Continue is a harmless no-op.
  tap = fakeCtxCapture(1515, 701, withRev(revAfterWin, 'b:go'));
  await handleCallback(tap.ctx, store);
  cur = (await store.get(1515))!;
  assertEquals(cur.currentZone, 'whisperwood', 'still arrived, nowhere else');
  assertEquals(cur.journey, undefined, 'no roll was consumed twice');
});

Deno.test('journey view renders resumable progress from PlayerState alone', () => {
  const player = traveler(1516, 'umbra', 'abyss');
  const res = startJourney(player, 'w_umbra_abyss', stub(0.7, 0.8, 0.1));
  assert(res.ok && res.step.kind === 'battle');
  const rendered = JSON.stringify(renderJourney(player));
  assert(rendered.includes('Umbral'));
  assert(rendered.includes('Abyss'));
  assert(rendered.includes('2/3'), 'progress renders from persisted state');
  assert(rendered.includes('Press on'), 'Continue renders');
  assert(rendered.includes('Retreat'), 'Retreat renders');
  // Rerendering never consumes a roll.
  assertEquals(player.journey!.completedEvents, 2);
  renderJourney(player);
  assertEquals(player.journey!.completedEvents, 2);
});

Deno.test('reach objectives complete only on final arrival, once (#159)', () => {
  const player = createPlayer(1518, 'Walker', 'warrior');
  player.level = 9;
  player.quests['m4_blessing'] = { status: 'done', counts: [] };
  player.unlockedZones.push('mirefoot', 'hollowmere');
  syncAvailability(player);
  assert(acceptQuest(player, 'm5_fen', 'npc_bram').ok, 'Bram stands in Emberdawn');
  assertEquals(player.quests['m5_fen']!.status, 'active');
  assert(travelDirect(player, 'mirefoot').ok, 'the arrival fixture reaches the landing');
  // Departure is NOT arrival: the reach objective stays open mid-crossing.
  const res = startJourney(player, 'w_mirefoot_hollowmere');
  assert(res.ok && res.step.kind === 'arrived', 'the poled crossing is deterministic');
  assertEquals(player.quests['m5_fen']!.status, 'turnIn', 'the reach completed on final arrival');
  assertEquals(
    res.step.lines.filter((line) => line.includes('ready to turn in')).length,
    1,
    'the readiness notice is announced exactly once',
  );
  // Re-arrival is silent.
  assert(startJourney(player, 'w_hollowmere_mirefoot').ok);
  const back = startJourney(player, 'w_mirefoot_hollowmere');
  assert(back.ok && back.step.kind === 'arrived');
  assertEquals(
    back.step.lines.filter((line) => line.includes('ready to turn in')),
    [],
    're-arrival never repeats the notice',
  );
});

Deno.test('journey helpers: headline, version gate, and plain-JSON round-trip', () => {
  const player = traveler(1519, 'sunspire', 'frostpeak');
  const res = startJourney(player, 'w_sunspire_frostpeak', stub(0.75, 0.1));
  assert(res.ok && res.step.kind === 'battle');
  const line = journeyLine(player.journey!);
  assert(line.includes('→'), 'origin → destination reads as a crossing');
  assert(line.includes('1/2'), 'progress is legible');
  // v12 carries journeys + the respawn haven.
  assertEquals(CURRENT_STATE_VERSION, 14);
  // The snapshotted plan is plain JSON and every reference resolves.
  assertResolvablePersistedIds(player);
  const roundTrip = JSON.parse(JSON.stringify(player));
  assertResolvablePersistedIds(roundTrip);
});

Deno.test('contextual drops and snapshot variant: the secured crossing takes its own plan', () => {
  // Base plan (m7 not done): 2 events, snapshot 'base'.
  const base = traveler(1520, 'whisperwood', 'hollowmere');
  const baseRes = startJourney(base, 'w_whisperwood_hollowmere', stub(0.99));
  assert(baseRes.ok);
  if (baseRes.step.kind === 'progress') {
    assertEquals(base.journey!.variantId, 'base');
    assertEquals(base.journey!.totalEvents, 2);
  }
  // Secured plan (m7 done): 1 event, the variant snapshot — a condition
  // change mid-road can never rewrite it.
  const secured = traveler(1521, 'whisperwood', 'hollowmere');
  secured.quests['m7_tyrant'] = { status: 'done', counts: [1] };
  const res = startJourney(secured, 'w_whisperwood_hollowmere', stub(0.99));
  assert(res.ok);
  // The secured table's treasure rolls last ([5,6) of 6): gold pays once.
  assert(res.step.kind === 'arrived', 'one secured roll arrives');
  assert(secured.gold > 50, 'the treasure roll paid out exactly once');
});

Deno.test('every shipped crossing snapshot passes the identity gate', () => {
  for (const routeDef of ROUTES) {
    if (routeDef.eventCount === 0) continue;
    const player = traveler(1530, routeDef.from, routeDef.to);
    const res = startJourney(player, routeDef.id, stub(0.1));
    if (!res.ok) continue; // level-locked tables refuse; integrity covers content
    assertEquals(findUnresolvedPersistedIds(player), [], `journey on ${routeDef.id} resolves`);
    if (player.journey) {
      retreatFromJourney(player);
      assertEquals(
        findUnresolvedPersistedIds(player),
        [],
        `retreated save on ${routeDef.id} resolves`,
      );
    }
  }
});

// ── cross-field journey corruption (#167) ────────────────────────────────

Deno.test('corrupt cross-field combinations: location and phase-progress relations', () => {
  // A live crossing keeps the player at the edge ORIGIN until arrival:
  // moving currentZone elsewhere while the journey stands is a state the
  // coordinator cannot produce.
  const moved = traveler(1533, 'sunspire', 'frostpeak');
  const movedRes = startJourney(moved, 'w_sunspire_frostpeak', stub(0.75, 0.1));
  assert(movedRes.ok && movedRes.step.kind === 'battle');
  moved.currentZone = 'frostpeak'; // both zones are valid — the combination is not
  const locationProblems = findUnresolvedPersistedIds(moved);
  assert(
    locationProblems.some((problem) =>
      problem.family === 'currentZone' && problem.id === 'frostpeak'
    ),
    `mismatched currentZone/fromZone refused: ${JSON.stringify(locationProblems)}`,
  );

  // An ACTIVELY FIGHTING travel battle owns the PENDING roll: a save that
  // already marks the event complete while the fight is live is refused.
  const forgedDone = traveler(1534, 'sunspire', 'frostpeak');
  const forgedRes = startJourney(forgedDone, 'w_sunspire_frostpeak', stub(0.1));
  assert(forgedRes.ok && forgedRes.step.kind === 'battle');
  forgedDone.journey!.completedEvents = 1;
  const activeProblems = findUnresolvedPersistedIds(forgedDone);
  assert(
    activeProblems.some((problem) =>
      problem.family === 'battle.origin' && problem.detail.includes('active')
    ),
    `active battle with a completed event refused: ${JSON.stringify(activeProblems)}`,
  );

  // ...and a WON battle whose event was NOT completed is refused the same
  // way — the relation must match the phase, in both directions.
  const wonStale = traveler(1535, 'sunspire', 'frostpeak');
  const wonRes = startJourney(wonStale, 'w_sunspire_frostpeak', stub(0.1));
  assert(wonRes.ok && wonRes.step.kind === 'battle');
  wonStale.battle!.enemy.hp = 0;
  battleAction(wonStale, { v: 'battle', a: 'atk' });
  assertEquals(wonStale.battle!.phase, 'won');
  wonStale.journey!.completedEvents = 0; // undo the victory's completion
  const wonProblems = findUnresolvedPersistedIds(wonStale);
  assert(
    wonProblems.some((problem) =>
      problem.family === 'battle.origin' && problem.detail.includes('won battle')
    ),
    `won battle with a pending event refused: ${JSON.stringify(wonProblems)}`,
  );
});

Deno.test('valid lifecycle states all pass the cross-field gate', () => {
  // Active battle at departure: pending roll owned by the fight.
  const fighting = traveler(1536, 'sunspire', 'frostpeak');
  const fightRes = startJourney(fighting, 'w_sunspire_frostpeak', stub(0.1));
  assert(fightRes.ok && fightRes.step.kind === 'battle');
  assertEquals(findUnresolvedPersistedIds(fighting), []);

  // Victory staging: the event completed, the battle awaits Continue.
  fighting.battle!.enemy.hp = 0;
  battleAction(fighting, { v: 'battle', a: 'atk' });
  assertEquals(findUnresolvedPersistedIds(fighting), []);

  // Intermission: battle dropped, the crossing live, still at the origin.
  battleAction(fighting, { v: 'battle', a: 'go' });
  assertEquals(fighting.scene.view, 'journey');
  assertEquals(fighting.battle, undefined);
  assertEquals(findUnresolvedPersistedIds(fighting), []);

  // Arrival boundary: the crossing cleared, the player at the destination.
  const step = advanceJourney(fighting, stub(0.75));
  assertEquals(step.kind, 'arrived');
  assertEquals(fighting.currentZone, 'frostpeak');
  assertEquals(findUnresolvedPersistedIds(fighting), []);
});

Deno.test('a defeat-staged travel battle keeps its pending roll and passes the gate', () => {
  const player = traveler(1537, 'sunspire', 'frostpeak');
  const res = startJourney(player, 'w_sunspire_frostpeak', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  player.battle!.enemy.hp = 999999;
  player.hp = 1;
  // The encounter stub does not govern the handler's combat RNG (#202).
  // Pin this synchronous turn so a random dodge cannot keep the hero alive.
  const realRandom = Math.random;
  Math.random = () => 0.5;
  try {
    battleAction(player, { v: 'battle', a: 'atk' });
  } finally {
    Math.random = realRandom;
  }
  assertEquals(player.battle!.phase, 'lost');
  // The lost fight's roll never completed; the journey stands until the
  // death confirm — and the persisted pair is exactly that relation.
  assertEquals(findUnresolvedPersistedIds(player), []);
});
