/** #178: campaign flee attempts use ordinary terminal accounting. */

import { assert, assertEquals } from '@std/assert';
import { runCampaignFight } from '../src/engine/balance.ts';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import { startBattle } from '../src/engine/combat.ts';
import { applyInstance } from '../src/engine/effects.ts';
import { advanceJourney } from '../src/engine/journey.ts';
import { dropTable } from '../src/content/loot.ts';
import { zone } from '../src/content/zones.ts';
import { route } from '../src/content/routes.ts';
import { injectMod } from './helpers.ts';

function roadFight(hp: number) {
  const player = createPlayer(178, 'Walker', 'warrior');
  player.tutorial = 'done';
  player.inventory = [];
  player.skills = [];
  player.mp = 0;
  player.hp = hp;
  player.currentZone = 'whisperwood';
  player.unlockedZones.push('whisperwood', 'mirefoot');
  const routeDef = route('w_whisperwood_mirefoot')!;
  player.journey = {
    edgeId: routeDef.id,
    variantId: 'base',
    fromZone: routeDef.from,
    toZone: routeDef.to,
    completedEvents: 0,
    totalEvents: 1,
    plan: routeDef.events!,
    report: [],
  };
  const battle = startBattle('e_rat', {
    kind: 'travel',
    zoneId: routeDef.from,
    edgeId: routeDef.id,
    eventIndex: 0,
  }, { player, rng: () => 0.99 })!.battle;
  player.battle = battle;
  // One point of damage per strike; two ordinary rounds precede fleeing.
  injectMod(battle, 'enemy', 'atk', -0.99);
  injectMod(battle, 'enemy', 'spd', -0.99);
  injectMod(battle, 'enemy', 'def', 9999);
  battle.enemy.hp = battle.enemy.maxHp = 300;
  return { p: player, b: battle };
}

Deno.test('campaign flee: a successful escape counts the final round and aborts the road', () => {
  const { p: player, b: battle } = roadFight(3);
  const result = runCampaignFight(player, battle, 'road', () => battle.round >= 3 ? 0 : 0.99);
  assertEquals(result.outcome, 'fled');
  assertEquals(result.rounds, 3);
  assertEquals(battle.history.length, 3, 'all consumed rounds were recorded by combat');
  assertEquals(player.battle, undefined);
  assertEquals(player.journey, undefined);
  assertEquals(player.currentZone, 'whisperwood');
});

Deno.test('campaign flee: a lethal failed escape reports death and counts the final round', () => {
  const { p: player, b: battle } = roadFight(3);
  player.gold = 100;
  const result = runCampaignFight(player, battle, 'road', () => 0.99);
  assertEquals(result.outcome, 'death');
  assertEquals(result.rounds, 3);
  assertEquals(battle.history.length, 3);
  assertEquals(player.gold, 90, 'the real death penalty is applied once');
  assertEquals(player.hp, statsOf(player).maxHp, 'revival fully restores (#212)');
  assertEquals(player.currentZone, player.respawnHaven);
  assertEquals(player.battle, undefined);
  assertEquals(player.journey, undefined);
});

Deno.test('campaign flee: periodic victory grants loot and completes the pending road event', () => {
  const { p: player, b: battle } = roadFight(10);
  applyInstance(battle, {
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
  const result = runCampaignFight(player, battle, 'road', () => battle.enemy.hp <= 0 ? 0 : 0.99);
  assertEquals(result.outcome, 'win');
  assertEquals(result.rounds, 3);
  assert(battle.history[2].lines.some((line) => line.includes('try to flee')));
  const entries = dropTable(zone('whisperwood')!.lootTable!)!.entries;
  assertEquals(result.contextualDrops, entries.length, 'every contextual roll grants once');
  for (const entry of entries) {
    assertEquals(
      player.inventory.find((inventoryEntry) => inventoryEntry.id === entry.item)?.qty,
      entry.qty ?? 1,
    );
  }
  assertEquals(player.journey?.completedEvents, 1);
  assertEquals(player.battle, undefined);
  const arrival = advanceJourney(player, () => {
    throw new Error('completed event was rerolled');
  });
  assertEquals(arrival.kind, 'arrived');
  assertEquals(player.currentZone, 'mirefoot');
  assertEquals(player.journey, undefined);
});

Deno.test('campaign fight: an opening-terminal victory consumes no round', () => {
  const { p: player, b: battle } = roadFight(10);
  battle.enemy.hp = 0;
  const result = runCampaignFight(player, battle, 'road', () => 0.99);
  assertEquals(result.outcome, 'win');
  assertEquals(result.rounds, 0);
  assertEquals(battle.history.length, 0);
  assertEquals(player.journey?.completedEvents, 1);
});
