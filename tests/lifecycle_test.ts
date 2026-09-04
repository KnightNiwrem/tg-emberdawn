/**
 * #160 — the travel lifecycle boundary: victory/defeat/flee/retreat,
 * arrival quests, last-safe-haven death and respawn provenance.
 */

import { assert, assertEquals } from '@std/assert';
import { applyDeath, createPlayer, statsOf } from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { addItem } from '../src/engine/inventory.ts';
import { retreatFromJourney, startJourney } from '../src/engine/journey.ts';
import { dungeonOf, nextDungeonFloor, travelDirect } from '../src/engine/world.ts';
import { findUnresolvedPersistedIds } from '../src/engine/validate.ts';
import { syncAvailability } from '../src/engine/quests.ts';
import { deathAction } from '../src/handlers/hub.ts';
import { battleAction, enterBattle } from '../src/handlers/battle.ts';
import { fakeCtxCapture, seeded } from './helpers.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { withRev } from '../src/codec.ts';
import { ROUTES } from '../src/content/routes.ts';
import { zone } from '../src/content/zones.ts';
import { evalCondition } from '../src/engine/conditions.ts';

function stub(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

function walker(id: number, at: string): ReturnType<typeof createPlayer> {
  const p = createPlayer(id, 'Walker', 'warrior');
  p.tutorial = 'done';
  p.level = 30; // road fights stay survivable and winnable on cue
  p.currentZone = at;
  return p;
}

// ── respawn provenance (#160) ────────────────────────────────────────────

Deno.test('respawnHaven starts at Emberdawn and moves only on real arrival', () => {
  const p = walker(1600, 'emberdawn');
  assertEquals(p.respawnHaven, 'emberdawn', 'fresh heroes respawn at the village');
  // Arriving at a further haven moves it — through the ONE authority.
  p.unlockedZones.push('hollowmere', 'mirefoot');
  assert(travelDirect(p, 'mirefoot').ok);
  assertEquals(p.respawnHaven, 'mirefoot', 'arrival at a haven updates the pointer');
  // A journey that has merely BEGUN never moves it: depart toward the
  // hollowmere and pause mid-road.
  const p2 = walker(1601, 'whisperwood');
  p2.unlockedZones.push('hollowmere');
  const res = startJourney(p2, 'w_whisperwood_hollowmere', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  assertEquals(p2.respawnHaven, 'emberdawn', 'departure is not arrival');
  assertEquals(p2.currentZone, 'whisperwood');
  // And the identity gate accepts the pointer as authored content.
  assertEquals(findUnresolvedPersistedIds(p2), []);
});

Deno.test('death revives at the LAST reached haven, not the catalog first', () => {
  const p = walker(1602, 'emberdawn');
  p.unlockedZones.push('hollowmere', 'mirefoot');
  assert(travelDirect(p, 'mirefoot').ok);
  assert(travelDirect(p, 'outskirts').ok);
  p.gold = 100;
  const line = applyDeath(p);
  assertEquals(p.currentZone, 'mirefoot', 'the last reached haven, not the first');
  assertEquals(p.respawnHaven, 'mirefoot');
  assertEquals(p.gold, 90, 'the existing gold penalty holds');
  assertEquals(p.hp, Math.floor(statsOf(p).maxHp * 0.5));
  assert(line.includes('Mirefoot'), 'the recovery line names the haven');
  // A fresh hero still wakes at the village.
  const fresh = walker(1603, 'outskirts');
  applyDeath(fresh);
  assertEquals(fresh.currentZone, 'emberdawn');
});

Deno.test('corrupt respawn pointers are refused, never repaired', () => {
  const p = walker(1604, 'emberdawn');
  const problems = (haven: string): boolean => {
    const probe = structuredClone(p);
    probe.respawnHaven = haven;
    return findUnresolvedPersistedIds(probe).some((x) => x.family === 'respawnHaven');
  };
  assert(problems('w_nope'), 'unknown zone refused');
  assert(problems('outskirts'), 'a non-haven zone refused');
  assertEquals(findUnresolvedPersistedIds(p), [], 'the real pointer resolves');
});

// ── defeat on the road ───────────────────────────────────────────────────

Deno.test('defeat during a travel battle ends the crossing and revives at the haven', async () => {
  const store = new MemoryStore();
  const p = walker(1605, 'whisperwood');
  p.unlockedZones.push('hollowmere');
  p.gold = 200;
  const res = startJourney(p, 'w_whisperwood_hollowmere', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  await store.set(p.userId, p);

  // The road fight wins: the hero falls.
  p.battle!.enemy.hp = 999999;
  p.hp = 1;
  battleAction(p, { v: 'battle', a: 'atk' });
  assertEquals(p.battle!.phase, 'lost');
  assertEquals(p.scene.view, 'death');
  // Rise again: journey + battle clear, penalties apply, the haven receives.
  const dead = (await store.get(p.userId))!;
  const tapped = fakeCtxCapture(p.userId, 800, withRev(dead.uiRev, 'd:ok'));
  await handleCallback(tapped.ctx, store);
  const risen = (await store.get(p.userId))!;
  assertEquals(risen.battle, undefined);
  assertEquals(risen.journey, undefined, 'defeat always ends the crossing');
  assertEquals(risen.currentZone, risen.respawnHaven);
  assertEquals(risen.gold, 180, 'the death penalty applied');
  assertEquals(risen.stats.deaths, 1);
});

Deno.test('opening-terminal defeat follows the same lifecycle', () => {
  const p = walker(1606, 'whisperwood');
  p.unlockedZones.push('hollowmere');
  const res = startJourney(p, 'w_whisperwood_hollowmere', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  // The opening's lethal strike landed before any round — the same
  // adjudication an authored lethal opening routes through enterBattle.
  p.hp = 0;
  enterBattle(p, p.battle!, 'defeat', ['⚡ The opening ends it before it begins.']);
  assertEquals(p.battle!.phase, 'lost');
  assertEquals(p.scene.view, 'death');
  deathAction(p);
  assertEquals(p.journey, undefined, 'opening-terminal defeat ends the crossing');
  assertEquals(p.currentZone, 'emberdawn');
});

// ── phoenix revival is battle-local (#160) ───────────────────────────────

Deno.test('Phoenix Cinder revives inside the travel fight; the event completes once', () => {
  const p = walker(1607, 'whisperwood');
  p.unlockedZones.push('hollowmere');
  const res = startJourney(p, 'w_whisperwood_hollowmere', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  addItem(p, 'c_phoenix_feather', 1);
  // The road foe lands a lethal blow: the Cinder sparks, the fight continues.
  p.hp = 1;
  p.battle!.enemy.hp = 999999;
  const revived = performAction(p, p.battle!, { kind: 'attack' }, seeded(81));
  assertEquals(p.battle!.phoenixUsed, true, 'the Cinder spent itself in the travel fight');
  assertEquals(p.hp, Math.floor(statsOf(p).maxHp * 0.5), 'revived at half health');
  assertEquals(revived.outcome, 'ongoing', 'the fight continues — no defeat, no journey change');
  assertEquals(p.journey!.completedEvents, 0, 'revival neither advances nor aborts the event');
  // Now win: the pending event completes exactly once.
  p.battle!.enemy.hp = 0;
  battleAction(p, { v: 'battle', a: 'atk' });
  assertEquals(p.journey!.completedEvents, 1);
});

// ── victory hooks and dungeon isolation (#160) ───────────────────────────

Deno.test('travel victories grant rewards and kill hooks but never dungeon progress', () => {
  const p = walker(1608, 'whisperwood');
  p.unlockedZones.push('hollowmere');
  // A live kill objective over a road enemy (sq_boglins hunts Boglins).
  syncAvailability(p);
  p.quests['sq_boglins'] = { status: 'active', counts: [0] };
  // A dungeon mid-dive in the same region: its floor pointer must not move.
  p.flags['dgn_d_rootbound_floor'] = 2;
  const res = startJourney(p, 'w_whisperwood_hollowmere', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  p.battle!.enemy.hp = 0;
  battleAction(p, { v: 'battle', a: 'atk' });
  assertEquals(p.journey!.completedEvents, 1, 'the event completed once');
  assertEquals(
    p.quests['sq_boglins']!.counts[0],
    1,
    'the road kill progressed the kill objective through the central hook',
  );
  assert(p.gold > 50 || p.stats.kills > 0, 'ordinary victory rewards flowed');
  const d = dungeonOf(zone('whisperwood')!)!;
  assertEquals(
    nextDungeonFloor(p, d),
    2,
    'travel battles never advance dungeon floors',
  );
});

Deno.test('retreat after partial completion keeps earned rewards; no return rolls', () => {
  const q = walker(1610, 'umbra');
  q.unlockedZones.push('abyss');
  // Treasure first, then the road fight pauses the burst (3-event edge).
  const res = startJourney(q, 'w_umbra_abyss', stub(0.95, 0.1));
  assert(res.ok && res.step.kind === 'battle');
  const goldAfterTreasure = q.gold;
  assert(goldAfterTreasure > 50, 'the treasure event paid out');
  // Win the fight and reach the intermission (one roll still pending).
  q.battle!.enemy.hp = 0;
  battleAction(q, { v: 'battle', a: 'atk' });
  assertEquals(q.journey!.completedEvents, 2);
  battleAction(q, { v: 'battle', a: 'go' });
  assertEquals(q.scene.view, 'journey');
  const goldAtIntermission = q.gold;
  // Retreat: the gold stays, no return events roll, the player is at the
  // origin (which may itself be a danger zone).
  const lines = retreatFromJourney(q);
  assertEquals(q.journey, undefined);
  assertEquals(q.currentZone, 'umbra');
  assertEquals(q.gold, goldAtIntermission, 'earned rewards remain earned');
  assert(lines.some((l) => l.includes('turn back')));
  // The identity gate accepts the retreated save.
  assertEquals(findUnresolvedPersistedIds(q), []);
});

Deno.test('no circular route gates: a fresh player can walk to every zone', () => {
  // Every authored edge whose BASE condition passes for a fresh hero is
  // walkable; the graph must reach every zone without requiring a quest
  // whose own completion gates the only road in (#160 quest behavior).
  const fresh = createPlayer(1611, 'Fresh', 'warrior');
  const seen = new Set(['emberdawn']);
  const queue = ['emberdawn'];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const r of ROUTES) {
      if (r.from !== cur) continue;
      if (r.when && !evalCondition(fresh, r.when)) continue;
      if (!seen.has(r.to)) {
        seen.add(r.to);
        queue.push(r.to);
      }
    }
  }
  const zones = new Set(ROUTES.flatMap((r) => [r.from, r.to]));
  for (const z of zones) {
    assert(seen.has(z), `zone ${z} is gated behind an unwalkable road`);
  }
});

Deno.test('victory Continue after the LAST event lands the arrival directly', () => {
  const p = walker(1612, 'hollowmere');
  p.unlockedZones.push('whisperwood');
  // One-event crossing: the road fight IS the last event.
  const res = startJourney(p, 'w_hollowmere_whisperwood', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  p.battle!.enemy.hp = 0;
  battleAction(p, { v: 'battle', a: 'atk' });
  assertEquals(p.journey!.completedEvents, 1);
  battleAction(p, { v: 'battle', a: 'go' });
  assertEquals(p.currentZone, 'whisperwood', 'Continue after the last event arrives');
  assertEquals(p.journey, undefined);
  assertEquals(findUnresolvedPersistedIds(p), []);
});

Deno.test('travel battles are ordinary: never boss-classified', () => {
  const p = walker(1613, 'whisperwood');
  p.unlockedZones.push('hollowmere');
  const res = startJourney(p, 'w_whisperwood_hollowmere', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  assertEquals(p.battle!.enemy.isBoss, false, 'route enemies are ordinary');
  // Even a boss-catalog enemy in travel provenance is NOT boss-classified:
  // provenance decides, not the catalog — and route tables never roll one
  // (content integrity).
  const bossy = startBattle('e_vosk', {
    kind: 'travel',
    zoneId: 'whisperwood',
    edgeId: 'w_whisperwood_hollowmere',
    eventIndex: 0,
  }, { player: p, rng: seeded(83) })!.battle;
  assertEquals(bossy.enemy.isBoss, false, 'provenance decides, not the catalog');
});
