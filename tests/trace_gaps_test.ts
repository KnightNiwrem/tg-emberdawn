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
  const p = createPlayer(id, 'T', 'warrior');
  p.level = 5;
  return p;
}

function paddedRat(p: PlayerState, seed: number): BattleState {
  const b = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(seed) })!.battle;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;
  return b;
}

const findTrace = <K extends CombatTraceEntry['kind']>(
  trace: CombatTraceEntry[],
  kind: K,
): Extract<CombatTraceEntry, { kind: K }>[] =>
  trace.filter((e): e is Extract<CombatTraceEntry, { kind: K }> => e.kind === kind);

Deno.test('#105: a periodic tick that exhausts the ward emits exactly one shieldBreak, in causal order', () => {
  const p = hero(1);
  p.hp = 99999; // survive the round so the tick adjudication is not the point
  const b = paddedRat(p, 21);
  grantShield(b, 'player', {
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
  b.effectInstances.push({
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
    appliedRound: b.round,
    remaining: 3,
    removable: true,
    expiresRound: b.round + 2,
  });
  const res = performAction(p, b, { kind: 'attack' }, seeded(21));
  const breaks = findTrace(res.trace, 'shieldBreak');
  assertEquals(breaks.length, 1, 'exactly one shieldBreak for the exhausted pool');
  assertEquals(breaks[0]!.side, 'player');
  assertEquals(b.shield.player, 0);
  // Causal order: the break precedes the damaging tick and its hpDamaged.
  const idx = (e: CombatTraceEntry) => res.trace.indexOf(e);
  const tick = findTrace(res.trace, 'periodicTick').find((t) => t.applied < 0);
  const damaged = findTrace(res.trace, 'hpDamaged').find((d) => d.cause === 'periodic');
  assertExists(tick);
  assertExists(damaged);
  assertEquals(idx(breaks[0]!) < idx(tick) && idx(tick) < idx(damaged), true);
});

Deno.test('#105: a cleansing consumable emits one effectRemoved per effect, with the real round', () => {
  const p = hero(2);
  const b = paddedRat(p, 22);
  addItem(p, 'c_antidote', 1);
  // Round 1 resolves (throwaway) so the cleanse acts at round 2.
  performAction(p, b, { kind: 'guard' }, seeded(22));
  assertEquals(b.round, 2);
  // Two removable harmful instances — the tonic removes both.
  injectMod(b, 'player', 'outgoing', -0.2, { defId: 'sap-a', name: 'Sap A' });
  injectMod(b, 'player', 'atk', -0.1, { defId: 'sap-b', name: 'Sap B' });
  const res = performAction(p, b, { kind: 'item', itemId: 'c_antidote' }, seeded(23));
  const removed = findTrace(res.trace, 'effectRemoved').filter((e) => e.cause === 'cleansed');
  assertEquals(removed.length, 2, 'one effectRemoved per removed instance');
  assertEquals(
    removed.map((e) => e.defId).sort(),
    ['sap-a', 'sap-b'],
  );
  assertEquals(
    removed.every((e) => e.round === 2),
    true,
    'the removal entries carry the real action round',
  );
  // #105: every removal names its initiator by stable content id — the
  // Cleansing Tonic, not the effect's own application source.
  assertEquals(
    removed.every((e) =>
      e.removedBy?.kind === 'item' && e.removedBy.id === 'c_antidote' &&
      e.removedBy.name === 'Cleansing Tonic'
    ),
    true,
    'every removal attributes the cleanse to the Cleansing Tonic',
  );
  assertEquals(
    b.effectInstances.some((i) => i.defId === 'sap-a' || i.defId === 'sap-b'),
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
  const p = createPlayer(4, 'T', 'cleric');
  p.level = 30;
  p.hp = 99999;
  p.mp = 999;
  p.skills.push('sk_purify');
  const b = paddedRat(p, 31);
  addItem(p, 'c_antidote', 1);
  injectMod(b, 'player', 'outgoing', -0.2, { defId: 'sap-item', name: 'Sap Item' });
  const r1 = performAction(p, b, { kind: 'item', itemId: 'c_antidote' }, seeded(31));
  injectMod(b, 'player', 'atk', -0.1, { defId: 'sap-skill', name: 'Sap Skill' });
  const r2 = performAction(p, b, { kind: 'skill', skillId: 'sk_purify' }, seeded(32));
  const itemRemovals = findTrace(r1.trace, 'effectRemoved').filter((e) => e.cause === 'cleansed');
  const skillRemovals = findTrace(r2.trace, 'effectRemoved').filter((e) => e.cause === 'cleansed');
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
  const p = hero(5);
  p.hp = 999999;
  const b = startBattle('e_warden', ORIGIN, { player: p, rng: seeded(41) })!.battle;
  b.enemy.hp = 999999;
  b.enemy.maxHp = 999999;
  p.battle = b;
  b.enemy.turn = 2;
  addItem(p, 'c_antidote', 1);
  injectMod(b, 'player', 'atk', -0.1, { defId: 'test:curse', name: 'Test Curse' });
  injectMod(b, 'player', 'def', 0.2, { defId: 'test:bless', name: 'Test Bless' });
  const res = performAction(p, b, { kind: 'item', itemId: 'c_antidote' }, seeded(42));
  const removed = findTrace(res.trace, 'effectRemoved');
  const cleansed = removed.filter((e) => e.cause === 'cleansed');
  const dispelled = removed.filter((e) => e.cause === 'dispelled');
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
    removed.every((e) => e.round === 1),
    true,
    'both removals happened in round 1 — removedBy is the only thing telling them apart',
  );
});

Deno.test('#105: the trace is caller-owned plain data — never persisted on the battle', () => {
  const p = hero(3);
  const b = paddedRat(p, 24);
  addItem(p, 'c_minor_potion', 2);
  const res = performAction(p, b, { kind: 'item', itemId: 'c_minor_potion' }, seeded(24));
  assertExists(res.trace);
  assertEquals('trace' in b, false, 'BattleState carries no trace field');
  assertEquals(
    JSON.stringify(b).includes('"kind":"hpRestored"'),
    false,
    'no trace entry survives battle persistence',
  );
  // Removal provenance is trace-only too: a cleanse names its source in the
  // returned trace, and that provenance never lands in the saved shape.
  addItem(p, 'c_antidote', 1);
  injectMod(b, 'player', 'atk', -0.1, { defId: 'test:sap', name: 'Test Sap' });
  const res2 = performAction(p, b, { kind: 'item', itemId: 'c_antidote' }, seeded(25));
  assertEquals(
    findTrace(res2.trace, 'effectRemoved')[0]?.removedBy?.id,
    'c_antidote',
    'the removal entry carries its source',
  );
  const saved = JSON.stringify(b);
  assertEquals(saved.includes('"effectRemoved"'), false, 'no removal entry survives persistence');
  assertEquals(saved.includes('"removedBy"'), false, 'removal provenance never persists');
});
