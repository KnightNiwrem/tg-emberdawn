/** #105: every real state transition reaches the caller-owned trace —
 * periodic damage records shield breaks, consumable cleanses record typed
 * effectRemoved entries with the real action round, and the trace itself
 * never leaks into persisted state. */

import { assertEquals, assertExists } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { grantShield } from '../src/engine/effects.ts';
import type { CombatTraceEntry } from '../src/engine/telemetry.ts';
import type { BattleState, PlayerState } from '../src/engine/types.ts';
import { addItem } from '../src/engine/inventory.ts';
import { injectMod, seeded } from './helpers.ts';

const ORIGIN = { kind: 'explore', zoneId: 'outskirts' } as const;

function hero(id: number): PlayerState {
  const player = createPlayer(id, 'T', 'warrior');
  player.level = 5;
  return player;
}

function paddedRat(player: PlayerState, seed: number): BattleState {
  const battle = startBattle('e_rat', ORIGIN, { player, rng: seeded(seed) })!.battle;
  battle.enemy.hp = 99999;
  battle.enemy.maxHp = 99999;
  player.battle = battle;
  return battle;
}

const findTrace = <K extends CombatTraceEntry['kind']>(
  trace: CombatTraceEntry[],
  kind: K,
): Extract<CombatTraceEntry, { kind: K }>[] =>
  trace.filter((event): event is Extract<CombatTraceEntry, { kind: K }> => event.kind === kind);

Deno.test('#105: a periodic tick that exhausts the ward emits exactly one shieldBreak, in causal order', () => {
  const player = hero(1);
  player.hp = 99999; // survive the round so the tick adjudication is not the point
  const battle = paddedRat(player, 21);
  grantShield(battle, 'player', {
    defId: 'test:ward',
    name: 'Test Ward',
    kind: 'shield',
    side: 'player',
    source: { kind: 'skill', id: 'test', name: 'Test' },
    shieldAmount: 99999,
    tags: ['beneficial'],
    stacking: 'replace',
    duration: 9,
    timing: 'immediate',
    removable: true,
  });
  // A ward-eating DoT (no bypass): the tick absorbs the whole pool first.
  battle.effectInstances.push({
    iid: 'dot1',
    defId: 'test:dot',
    name: 'Doom Venom',
    side: 'player',
    source: { kind: 'skill', id: 'test', name: 'test fixture' },
    kind: 'periodic',
    perRound: -999999,
    tickPhase: 'roundEnd',
    tags: ['harmful', 'periodic', 'poison'],
    stacking: 'replace',
    appliedRound: battle.round,
    remaining: 3,
    removable: true,
    expiresRound: battle.round + 2,
  });
  const res = performAction(player, battle, { kind: 'attack' }, seeded(21));
  const breaks = findTrace(res.trace, 'shieldBreak');
  assertEquals(breaks.length, 1, 'exactly one shieldBreak for the exhausted pool');
  assertEquals(breaks[0]!.side, 'player');
  assertEquals(battle.shield.player, 0);
  // Causal order: the break precedes the damaging tick and its hpDamaged.
  const traceIndex = (event: CombatTraceEntry) => res.trace.indexOf(event);
  const tick = findTrace(res.trace, 'periodicTick').find((event) => event.applied < 0);
  const damaged = findTrace(res.trace, 'hpDamaged').find((event) => event.cause === 'periodic');
  assertExists(tick);
  assertExists(damaged);
  assertEquals(
    traceIndex(breaks[0]!) < traceIndex(tick) && traceIndex(tick) < traceIndex(damaged),
    true,
  );
});

Deno.test('#105: a cleansing consumable emits one effectRemoved per effect, with the real round', () => {
  const player = hero(2);
  const battle = paddedRat(player, 22);
  addItem(player, 'c_antidote', 1);
  // Round 1 resolves (throwaway) so the cleanse acts at round 2.
  performAction(player, battle, { kind: 'guard' }, seeded(22));
  assertEquals(battle.round, 2);
  // Two removable harmful instances — the tonic removes both.
  injectMod(battle, 'player', 'outgoing', -0.2, { defId: 'sap-a', name: 'Sap A' });
  injectMod(battle, 'player', 'atk', -0.1, { defId: 'sap-b', name: 'Sap B' });
  const res = performAction(player, battle, { kind: 'item', itemId: 'c_antidote' }, seeded(23));
  const removed = findTrace(res.trace, 'effectRemoved').filter((event) =>
    event.cause === 'cleansed'
  );
  assertEquals(removed.length, 2, 'one effectRemoved per removed instance');
  assertEquals(
    removed.map((event) => event.defId).sort(),
    ['sap-a', 'sap-b'],
  );
  assertEquals(
    removed.every((event) => event.round === 2),
    true,
    'the removal entries carry the real action round',
  );
  // #105: every removal names its initiator by stable content id — the
  // Cleansing Tonic, not the effect's own application source.
  assertEquals(
    removed.every((event) =>
      event.removedBy?.kind === 'item' && event.removedBy.id === 'c_antidote' &&
      event.removedBy.name === 'Cleansing Tonic'
    ),
    true,
    'every removal attributes the cleanse to the Cleansing Tonic',
  );
  assertEquals(
    battle.effectInstances.some((instance) =>
      instance.defId === 'sap-a' || instance.defId === 'sap-b'
    ),
    false,
    'the instances really left the arena',
  );
  // The consumable path appends to the caller-owned returned trace.
  assertExists(res.trace, 'the outer operation returns the resolution trace');
});

Deno.test('#105: skill and item cleanses share the cause but stay distinguishable by source', () => {
  // A cleric learns Purify (heal + cleanse); the Tonic and the skill both
  // remove harmful effects with cause 'cleansed' — only removedBy tells
  // them apart.
  const player = createPlayer(4, 'T', 'cleric');
  player.level = 30;
  player.hp = 99999;
  player.mp = 999;
  player.skills.push('sk_purify');
  const battle = paddedRat(player, 31);
  addItem(player, 'c_antidote', 1);
  injectMod(battle, 'player', 'outgoing', -0.2, { defId: 'sap-item', name: 'Sap Item' });
  const r1 = performAction(player, battle, { kind: 'item', itemId: 'c_antidote' }, seeded(31));
  injectMod(battle, 'player', 'atk', -0.1, { defId: 'sap-skill', name: 'Sap Skill' });
  const r2 = performAction(player, battle, { kind: 'skill', skillId: 'sk_purify' }, seeded(32));
  const itemRemovals = findTrace(r1.trace, 'effectRemoved').filter((event) =>
    event.cause === 'cleansed'
  );
  const skillRemovals = findTrace(r2.trace, 'effectRemoved').filter((event) =>
    event.cause === 'cleansed'
  );
  assertEquals(itemRemovals.length, 1);
  assertEquals(skillRemovals.length, 1);
  assertEquals(itemRemovals[0]!.removedBy, {
    kind: 'item',
    id: 'c_antidote',
    name: 'Cleansing Tonic',
  });
  assertEquals(skillRemovals[0]!.removedBy, { kind: 'skill', id: 'sk_purify', name: 'Purify' });
  assertEquals(itemRemovals[0]!.cause === skillRemovals[0]!.cause, true, 'same cause…');
  assertEquals(
    itemRemovals[0]!.removedBy?.kind !== skillRemovals[0]!.removedBy?.kind,
    true,
    '…but the removal sources differ, so the two cleanses are distinguishable',
  );
});

Deno.test('#105: a same-round item cleanse and enemy dispel each name their removal source', () => {
  // The Warden of the Void's special (every 3rd enemy action) is Final
  // Silence — damage plus a one-benefit dispel. Seeding enemy.turn = 2
  // makes the first enemy action the third, so the special fires in the
  // same round the player cleanses with the Tonic.
  const player = hero(5);
  player.hp = 999999;
  const battle = startBattle('e_warden', ORIGIN, { player, rng: seeded(41) })!.battle;
  battle.enemy.hp = 999999;
  battle.enemy.maxHp = 999999;
  player.battle = battle;
  battle.enemy.turn = 2;
  addItem(player, 'c_antidote', 1);
  injectMod(battle, 'player', 'atk', -0.1, { defId: 'test:curse', name: 'Test Curse' });
  injectMod(battle, 'player', 'def', 0.2, { defId: 'test:bless', name: 'Test Bless' });
  const res = performAction(player, battle, { kind: 'item', itemId: 'c_antidote' }, seeded(42));
  const removed = findTrace(res.trace, 'effectRemoved');
  const cleansed = removed.filter((event) => event.cause === 'cleansed');
  const dispelled = removed.filter((event) => event.cause === 'dispelled');
  assertEquals(cleansed.length, 1, 'the Tonic cleansed the harmful curse');
  assertEquals(cleansed[0]!.defId, 'test:curse');
  assertEquals(cleansed[0]!.removedBy, {
    kind: 'item',
    id: 'c_antidote',
    name: 'Cleansing Tonic',
  });
  assertEquals(dispelled.length, 1, 'Final Silence stripped the beneficial blessing');
  assertEquals(dispelled[0]!.defId, 'test:bless');
  assertEquals(dispelled[0]!.removedBy, {
    kind: 'enemyMove',
    id: 'Final Silence',
    name: 'Final Silence',
  });
  assertEquals(
    removed.every((event) => event.round === 1),
    true,
    'both removals happened in round 1 — removedBy is the only thing telling them apart',
  );
});

Deno.test('#105: the trace is caller-owned plain data — never persisted on the battle', () => {
  const player = hero(3);
  const battle = paddedRat(player, 24);
  addItem(player, 'c_minor_potion', 2);
  const res = performAction(player, battle, { kind: 'item', itemId: 'c_minor_potion' }, seeded(24));
  assertExists(res.trace);
  assertEquals('trace' in battle, false, 'BattleState carries no trace field');
  assertEquals(
    JSON.stringify(battle).includes('"kind":"hpRestored"'),
    false,
    'no trace entry survives battle persistence',
  );
  // Removal provenance is trace-only too: a cleanse names its source in the
  // returned trace, and that provenance never lands in the saved shape.
  addItem(player, 'c_antidote', 1);
  injectMod(battle, 'player', 'atk', -0.1, { defId: 'test:sap', name: 'Test Sap' });
  const res2 = performAction(player, battle, { kind: 'item', itemId: 'c_antidote' }, seeded(25));
  assertEquals(
    findTrace(res2.trace, 'effectRemoved')[0]?.removedBy?.id,
    'c_antidote',
    'the removal entry carries its source',
  );
  const saved = JSON.stringify(battle);
  assertEquals(saved.includes('"effectRemoved"'), false, 'no removal entry survives persistence');
  assertEquals(saved.includes('"removedBy"'), false, 'removal provenance never persists');
});
