/** #178: campaign flee attempts use ordinary terminal accounting. */

import { assert, assertEquals } from '@std/assert';
import { runCampaignFight } from '../src/engine/balance.ts';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import { startBattle } from '../src/engine/combat.ts';
import { applyInstance } from '../src/engine/effects.ts';
import { advanceJourney } from '../src/engine/journey.ts';
import { route } from '../src/content/routes.ts';
import { injectMod } from './helpers.ts';

function roadFight(hp: number) {
  const p = createPlayer(178, 'Walker', 'warrior');
  p.tutorial = 'done';
  p.inventory = [];
  p.skills = [];
  p.mp = 0;
  p.hp = hp;
  p.currentZone = 'whisperwood';
  p.unlockedZones.push('whisperwood', 'mirefoot');
  const r = route('w_whisperwood_mirefoot')!;
  p.journey = {
    edgeId: r.id,
    variantId: 'base',
    fromZone: r.from,
    toZone: r.to,
    completedEvents: 0,
    totalEvents: 1,
    plan: r.events!,
    report: [],
  };
  const b = startBattle('e_rat', {
    kind: 'travel',
    zoneId: r.from,
    edgeId: r.id,
    eventIndex: 0,
  }, { player: p, rng: () => 0.99 })!.battle;
  p.battle = b;
  // One point of damage per strike; two ordinary rounds precede fleeing.
  injectMod(b, 'enemy', 'atk', -0.99);
  injectMod(b, 'enemy', 'spd', -0.99);
  injectMod(b, 'enemy', 'def', 9999);
  b.enemy.hp = b.enemy.maxHp = 300;
  return { p, b };
}

Deno.test('campaign flee: a successful escape counts the final round and aborts the road', () => {
  const { p, b } = roadFight(3);
  const result = runCampaignFight(p, b, 'road', () => b.round >= 3 ? 0 : 0.99);
  assertEquals(result.outcome, 'fled');
  assertEquals(result.rounds, 3);
  assertEquals(b.history.length, 3, 'all consumed rounds were recorded by combat');
  assertEquals(p.battle, undefined);
  assertEquals(p.journey, undefined);
  assertEquals(p.currentZone, 'whisperwood');
});

Deno.test('campaign flee: a lethal failed escape reports death and counts the final round', () => {
  const { p, b } = roadFight(3);
  p.gold = 100;
  const result = runCampaignFight(p, b, 'road', () => 0.99);
  assertEquals(result.outcome, 'death');
  assertEquals(result.rounds, 3);
  assertEquals(b.history.length, 3);
  assertEquals(p.gold, 90, 'the real death penalty is applied once');
  assertEquals(p.hp, Math.floor(statsOf(p).maxHp * 0.5));
  assertEquals(p.currentZone, p.respawnHaven);
  assertEquals(p.battle, undefined);
  assertEquals(p.journey, undefined);
});

Deno.test('campaign flee: periodic victory grants loot and completes the pending road event', () => {
  const { p, b } = roadFight(10);
  applyInstance(b, {
    defId: 'test:rot',
    name: 'Test Rot',
    kind: 'periodic',
    side: 'enemy',
    source: { kind: 'skill', id: 'test', name: 'Test' },
    perRound: -100,
    tickPhase: 'roundEnd',
    tags: ['harmful'],
    stacking: 'replace',
    duration: 3,
    timing: 'immediate',
    removable: true,
  });
  const result = runCampaignFight(p, b, 'road', () => b.enemy.hp <= 0 ? 0 : 0.99);
  assertEquals(result.outcome, 'win');
  assertEquals(result.rounds, 3);
  assert(b.history[2].lines.some((l) => l.includes('try to flee')));
  assertEquals(result.contextualDrops, 2, 'both Whisperwood contextual rolls grant');
  assertEquals(p.inventory.find((e) => e.id === 'm_iron_chunk')?.qty, 1);
  assertEquals(p.inventory.find((e) => e.id === 'c_minor_ether')?.qty, 1);
  assertEquals(p.journey?.completedEvents, 1);
  assertEquals(p.battle, undefined);
  const arrival = advanceJourney(p, () => {
    throw new Error('completed event was rerolled');
  });
  assertEquals(arrival.kind, 'arrived');
  assertEquals(p.currentZone, 'mirefoot');
  assertEquals(p.journey, undefined);
});

Deno.test('campaign fight: an opening-terminal victory consumes no round', () => {
  const { p, b } = roadFight(10);
  b.enemy.hp = 0;
  const result = runCampaignFight(p, b, 'road', () => 0.99);
  assertEquals(result.outcome, 'win');
  assertEquals(result.rounds, 0);
  assertEquals(b.history.length, 0);
  assertEquals(p.journey?.completedEvents, 1);
});
