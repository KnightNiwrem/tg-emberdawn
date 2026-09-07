/**
 * #160 — the travel lifecycle boundary: victory/defeat/flee/retreat,
 * arrival quests, last-safe-haven death and respawn provenance.
 */

import { assert, assertEquals } from '@std/assert';
import { applyDeath, createPlayer, statsOf } from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { addItem } from '../src/engine/inventory.ts';
import { retreatFromJourney, startJourney } from '../src/engine/journey.ts';
import { dungeonOf, nextDungeonFloor } from '../src/engine/world.ts';
import { findUnresolvedPersistedIds } from '../src/engine/validate.ts';
import { syncAvailability } from '../src/engine/quests.ts';
import { deathAction } from '../src/handlers/hub.ts';
import { battleAction, enterBattle } from '../src/handlers/battle.ts';
import { fakeCtxCapture, seeded, travelDirect } from './helpers.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { withRev } from '../src/codec.ts';
import { ROUTES } from '../src/content/routes.ts';
import { zone } from '../src/content/zones.ts';
import { evalCondition } from '../src/engine/conditions.ts';

function stub(...values: number[]): () => number {
  let drawIndex = 0;
  return () => values[Math.min(drawIndex++, values.length - 1)]!;
}

function walker(id: number, at: string): ReturnType<typeof createPlayer> {
  const player = createPlayer(id, 'Walker', 'warrior');
  player.tutorial = 'done';
  player.level = 30; // road fights stay survivable and winnable on cue
  player.currentZone = at;
  return player;
}

// ── respawn provenance (#160) ────────────────────────────────────────────

Deno.test('respawnHaven starts at Emberdawn and moves only on real arrival', () => {
  const player = walker(1600, 'emberdawn');
  assertEquals(player.respawnHaven, 'emberdawn', 'fresh heroes respawn at the village');
  // Arriving at a further haven moves it — through the ONE authority.
  player.unlockedZones.push('hollowmere', 'mirefoot');
  assert(travelDirect(player, 'mirefoot').ok);
  assertEquals(player.respawnHaven, 'mirefoot', 'arrival at a haven updates the pointer');
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
  const player = walker(1602, 'emberdawn');
  player.unlockedZones.push('hollowmere', 'mirefoot');
  assert(travelDirect(player, 'mirefoot').ok);
  assert(travelDirect(player, 'outskirts').ok);
  player.gold = 100;
  const line = applyDeath(player);
  assertEquals(player.currentZone, 'mirefoot', 'the last reached haven, not the first');
  assertEquals(player.respawnHaven, 'mirefoot');
  assertEquals(player.gold, 90, 'the existing gold penalty holds');
  assertEquals(player.hp, statsOf(player).maxHp, 'revival fully restores (#212)');
  assert(line.includes('Mirefoot'), 'the recovery line names the haven');
  // A fresh hero still wakes at the village.
  const fresh = walker(1603, 'outskirts');
  applyDeath(fresh);
  assertEquals(fresh.currentZone, 'emberdawn');
});

Deno.test('corrupt respawn pointers are refused, never repaired', () => {
  const player = walker(1604, 'emberdawn');
  const problems = (haven: string): boolean => {
    const probe = structuredClone(player);
    probe.respawnHaven = haven;
    return findUnresolvedPersistedIds(probe).some((problem) => problem.family === 'respawnHaven');
  };
  assert(problems('w_nope'), 'unknown zone refused');
  assert(problems('outskirts'), 'a non-haven zone refused');
  assertEquals(findUnresolvedPersistedIds(player), [], 'the real pointer resolves');
});

// ── defeat on the road ───────────────────────────────────────────────────

Deno.test('defeat during a travel battle ends the crossing and revives at the haven', async () => {
  const store = new MemoryStore();
  const player = walker(1605, 'whisperwood');
  player.unlockedZones.push('hollowmere');
  player.gold = 200;
  const res = startJourney(player, 'w_whisperwood_hollowmere', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  await store.set(player.userId, player);

  // The road fight wins: the hero falls. The counter must land — a dodge
  // slip is always possible, so keep swinging until the fight resolves
  // (the hero never heals; an undodged hit at 1 HP is lethal).
  player.battle!.enemy.hp = 999999;
  player.hp = 1;
  let guard = 0;
  while (player.battle!.phase === 'active' && guard++ < 50) {
    battleAction(player, { v: 'battle', a: 'atk' });
  }
  assertEquals(player.battle!.phase, 'lost');
  assertEquals(player.scene.view, 'death');
  // Rise again: journey + battle clear, penalties apply, the haven receives.
  const dead = (await store.get(player.userId))!;
  const tapped = fakeCtxCapture(player.userId, 800, withRev(dead.uiRev, 'd:ok'));
  await handleCallback(tapped.ctx, store);
  const risen = (await store.get(player.userId))!;
  assertEquals(risen.battle, undefined);
  assertEquals(risen.journey, undefined, 'defeat always ends the crossing');
  assertEquals(risen.currentZone, risen.respawnHaven);
  assertEquals(risen.gold, 180, 'the death penalty applied');
  assertEquals(risen.stats.deaths, 1);
});

Deno.test('opening-terminal defeat follows the same lifecycle', () => {
  const player = walker(1606, 'whisperwood');
  player.unlockedZones.push('hollowmere');
  const res = startJourney(player, 'w_whisperwood_hollowmere', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  // The opening's lethal strike landed before any round — the same
  // adjudication an authored lethal opening routes through enterBattle.
  player.hp = 0;
  enterBattle(player, player.battle!, 'defeat', ['⚡ The opening ends it before it begins.']);
  assertEquals(player.battle!.phase, 'lost');
  assertEquals(player.scene.view, 'death');
  deathAction(player);
  assertEquals(player.journey, undefined, 'opening-terminal defeat ends the crossing');
  assertEquals(player.currentZone, 'emberdawn');
});

// ── phoenix revival is battle-local (#160) ───────────────────────────────

Deno.test('Phoenix Cinder revives inside the travel fight; the event completes once', () => {
  const player = walker(1607, 'whisperwood');
  player.unlockedZones.push('hollowmere');
  const res = startJourney(player, 'w_whisperwood_hollowmere', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  addItem(player, 'c_phoenix_feather', 1);
  // The road foe lands a lethal blow: the Cinder sparks, the fight continues.
  player.hp = 1;
  player.battle!.enemy.hp = 999999;
  const revived = performAction(player, player.battle!, { kind: 'attack' }, seeded(81));
  assertEquals(player.battle!.phoenixUsed, true, 'the Cinder spent itself in the travel fight');
  assertEquals(player.hp, Math.floor(statsOf(player).maxHp * 0.5), 'revived at half health');
  assertEquals(revived.outcome, 'ongoing', 'the fight continues — no defeat, no journey change');
  assertEquals(player.journey!.completedEvents, 0, 'revival neither advances nor aborts the event');
  // Now win: the pending event completes exactly once.
  player.battle!.enemy.hp = 0;
  battleAction(player, { v: 'battle', a: 'atk' });
  assertEquals(player.journey!.completedEvents, 1);
});

// ── victory hooks and dungeon isolation (#160) ───────────────────────────

Deno.test('travel victories grant rewards and kill hooks but never dungeon progress', () => {
  const player = walker(1608, 'whisperwood');
  player.unlockedZones.push('hollowmere');
  // A live kill objective over a road enemy (sq_boglins hunts Boglins).
  syncAvailability(player);
  player.quests['sq_boglins'] = { status: 'active', counts: [0] };
  // Previously earned dungeon caches survive ordinary road battles.
  player.flags['dgn_d_rootbound_cache_1'] = true;
  const res = startJourney(player, 'w_whisperwood_hollowmere', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  player.battle!.enemy.hp = 0;
  battleAction(player, { v: 'battle', a: 'atk' });
  assertEquals(player.journey!.completedEvents, 1, 'the event completed once');
  assertEquals(
    player.quests['sq_boglins']!.counts[0],
    1,
    'the road kill progressed the kill objective through the central hook',
  );
  assert(player.gold > 50 || player.stats.kills > 0, 'ordinary victory rewards flowed');
  const dungeon = dungeonOf(zone('whisperwood')!)!;
  assertEquals(
    nextDungeonFloor(player, dungeon),
    1,
    'travel battles never advance dungeon floors',
  );
});

Deno.test('retreat after partial completion keeps earned rewards; no return rolls', () => {
  const player = walker(1610, 'umbra');
  player.unlockedZones.push('abyss');
  // Treasure first, then the road fight pauses the burst (3-event edge).
  const res = startJourney(player, 'w_umbra_abyss', stub(0.95, 0.1));
  assert(res.ok && res.step.kind === 'battle');
  const goldAfterTreasure = player.gold;
  assert(goldAfterTreasure > 50, 'the treasure event paid out');
  // Win the fight and reach the intermission (one roll still pending).
  player.battle!.enemy.hp = 0;
  battleAction(player, { v: 'battle', a: 'atk' });
  assertEquals(player.journey!.completedEvents, 2);
  battleAction(player, { v: 'battle', a: 'go' });
  assertEquals(player.scene.view, 'journey');
  const goldAtIntermission = player.gold;
  // Retreat: the gold stays, no return events roll, the player is at the
  // origin (which may itself be a danger zone).
  const lines = retreatFromJourney(player);
  assertEquals(player.journey, undefined);
  assertEquals(player.currentZone, 'umbra');
  assertEquals(player.gold, goldAtIntermission, 'earned rewards remain earned');
  assert(lines.some((line) => line.includes('turn back')));
  // The identity gate accepts the retreated save.
  assertEquals(findUnresolvedPersistedIds(player), []);
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
    for (const routeDef of ROUTES) {
      if (routeDef.from !== cur) continue;
      if (routeDef.when && !evalCondition(fresh, routeDef.when)) continue;
      if (!seen.has(routeDef.to)) {
        seen.add(routeDef.to);
        queue.push(routeDef.to);
      }
    }
  }
  const zones = new Set(ROUTES.flatMap((routeDef) => [routeDef.from, routeDef.to]));
  for (const zoneId of zones) {
    assert(seen.has(zoneId), `zone ${zoneId} is gated behind an unwalkable road`);
  }
});

Deno.test('victory Continue after the LAST event lands the arrival directly', () => {
  const player = walker(1612, 'hollowmere');
  player.unlockedZones.push('whisperwood');
  // One-event crossing: the road fight IS the last event.
  const res = startJourney(player, 'w_hollowmere_whisperwood', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  player.battle!.enemy.hp = 0;
  battleAction(player, { v: 'battle', a: 'atk' });
  assertEquals(player.journey!.completedEvents, 1);
  battleAction(player, { v: 'battle', a: 'go' });
  assertEquals(player.currentZone, 'whisperwood', 'Continue after the last event arrives');
  assertEquals(player.journey, undefined);
  assertEquals(findUnresolvedPersistedIds(player), []);
});

Deno.test('travel battles are ordinary: never boss-classified', () => {
  const player = walker(1613, 'whisperwood');
  player.unlockedZones.push('hollowmere');
  const res = startJourney(player, 'w_whisperwood_hollowmere', stub(0.1));
  assert(res.ok && res.step.kind === 'battle');
  assertEquals(player.battle!.enemy.isBoss, false, 'route enemies are ordinary');
  // Even a boss-catalog enemy in travel provenance is NOT boss-classified:
  // provenance decides, not the catalog — and route tables never roll one
  // (content integrity).
  const bossy = startBattle('e_vosk', {
    kind: 'travel',
    zoneId: 'whisperwood',
    edgeId: 'w_whisperwood_hollowmere',
    eventIndex: 0,
  }, { player, rng: seeded(83) })!.battle;
  assertEquals(bossy.enemy.isBoss, false, 'provenance decides, not the catalog');
});
