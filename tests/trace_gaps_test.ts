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
  assertEquals(
    b.effectInstances.some((i) => i.defId === 'sap-a' || i.defId === 'sap-b'),
    false,
    'the instances really left the arena',
  );
  // The consumable path appends to the caller-owned returned trace.
  assertExists(res.trace, 'the outer operation returns the resolution trace');
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
});
