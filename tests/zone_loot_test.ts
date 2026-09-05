/**
 * #165 — authored zone loot tables roll during victory resolution:
 * structured origin policy, exactly-once rolls, central relevance
 * filtering, and the persisted structured stamp.
 */

import { assert, assertEquals } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { startBattle } from '../src/engine/combat.ts';
import { addItem, countOf } from '../src/engine/inventory.ts';
import { grantContextualDrops } from '../src/engine/loot.ts';
import { explore, resolveVictory, zoneLootEligible } from '../src/engine/world.ts';
import type { BattleOrigin, BattleState, PlayerState } from '../src/engine/types.ts';
import { dropTable } from '../src/content/loot.ts';
import { itemName } from '../src/content/items.ts';
import { zone } from '../src/content/zones.ts';
import { seeded } from './helpers.ts';

/** An rng where every chance roll hits (all authored chances are positive). */
function zeroRng(): () => number {
  return () => 0;
}

/** A forced victory: the enemy is dropped to 0 HP and resolution runs
 * through the engine's one victory authority. */
function wonBattle(
  p: PlayerState,
  origin: BattleOrigin,
  resolveRng: () => number,
  draws?: { n: number },
): { battle: BattleState; lines: string[] } {
  let rng = resolveRng;
  if (draws) {
    rng = () => {
      draws.n++;
      return resolveRng();
    };
  }
  const battle = startBattle('e_rat', origin, { player: p, rng: seeded(7) })!.battle;
  battle.enemy.hp = 0;
  return { battle, lines: resolveVictory(p, battle, rng) };
}

const fields = dropTable('dt_ember_fields')!;

Deno.test('zone loot: an explore victory in a table zone rolls the authored table in addition', () => {
  const p = createPlayer(1650, 'T', 'warrior');
  p.tutorial = 'done';
  // An all-zero rng makes every authored entry hit, so the expected grant
  // is the full table, in authored order.
  const { battle, lines } = wonBattle(p, { kind: 'explore', zoneId: 'outskirts' }, zeroRng());
  assertEquals(
    battle.rewards!.contextual,
    fields.entries.map((e) => ({ item: e.item, qty: e.qty ?? 1 })),
    'the zone table rolled in addition to the enemy rewards',
  );
  for (const e of fields.entries) {
    assert(
      lines.some((l) => l.includes(itemName(e.item))),
      `the resolution announces the contextual grant: ${e.item}`,
    );
  }
  // Exactly the zone table's qty lands ON TOP of the ordinary enemy drop
  // (e_rat drops the same shard itself — the table is additive by design).
  const baseline = createPlayer(1659, 'T', 'warrior');
  baseline.tutorial = 'done';
  wonBattle(
    baseline,
    { kind: 'dungeon', zoneId: 'outskirts', dungeonId: 'd_none', floor: 1, boss: false },
    zeroRng(),
  );
  for (const e of fields.entries) {
    assertEquals(
      countOf(p, e.item),
      countOf(baseline, e.item) + (e.qty ?? 1),
      `${e.item}: enemy rewards + the zone table, nothing more`,
    );
  }
});

Deno.test('zone loot: travel battles roll the road origin zone table', () => {
  const p = createPlayer(1651, 'T', 'warrior');
  p.tutorial = 'done';
  const { battle } = wonBattle(
    p,
    { kind: 'travel', zoneId: 'outskirts', edgeId: 'e_outskirts_whisperwood', eventIndex: 0 },
    zeroRng(),
  );
  assertEquals(battle.rewards!.contextual!.length, fields.entries.length);
});

Deno.test('zone loot: dungeon victories do not roll the zone table (documented policy)', () => {
  const p = createPlayer(1652, 'T', 'warrior');
  p.tutorial = 'done';
  const { battle, lines } = wonBattle(
    p,
    { kind: 'dungeon', zoneId: 'outskirts', dungeonId: 'd_none', floor: 1, boss: false },
    zeroRng(),
  );
  assertEquals(battle.rewards!.contextual, undefined, 'dungeons grant their own caches instead');
  assert(!lines.some((l) => l.includes('Found:')), 'no contextual line without the roll');
  // The bag holds only what the enemy itself dropped — no table grant.
  const fresh = createPlayer(1661, 'T', 'warrior');
  assertEquals(
    countOf(p, 'm_ember_shard'),
    countOf(fresh, 'm_ember_shard') + 1,
    'only the enemy drop',
  );
  for (const e of fields.entries) {
    if (e.item === 'm_ember_shard') continue;
    assertEquals(
      countOf(p, e.item),
      countOf(fresh, e.item),
      `${e.item}: never the zone table`,
    );
  }
});

Deno.test('zone loot: a zone without a table and a table that misses both grant nothing', () => {
  const p = createPlayer(1653, 'T', 'warrior');
  p.tutorial = 'done';
  // Emberdawn Village authors no lootTable.
  assertEquals(zone('emberdawn')!.lootTable, undefined);
  const { battle } = wonBattle(p, { kind: 'explore', zoneId: 'emberdawn' }, zeroRng());
  assertEquals(battle.rewards!.contextual, undefined);

  // An all-high rng misses every chance entry (0.25/0.08): nothing is
  // stamped and nothing is granted — while the table consumed exactly one
  // draw per authored entry, exactly once (isolated against the same
  // victory in the table-less zone).
  const p2 = createPlayer(1654, 'T', 'warrior');
  p2.tutorial = 'done';
  const high = () => 0.99;
  const baseDraws = { n: 0 };
  const base = wonBattle(p2, { kind: 'explore', zoneId: 'emberdawn' }, high, baseDraws);
  assertEquals(base.battle.rewards!.contextual, undefined);

  const p3 = createPlayer(1660, 'T', 'warrior');
  p3.tutorial = 'done';
  const tableDraws = { n: 0 };
  const withTable = wonBattle(p3, { kind: 'explore', zoneId: 'outskirts' }, high, tableDraws);
  assertEquals(tableDraws.n - baseDraws.n, fields.entries.length, 'one draw per entry, once');
  assertEquals(withTable.battle.rewards!.contextual, undefined);
  const fresh = createPlayer(1662, 'T', 'warrior');
  for (const e of fields.entries) {
    assertEquals(countOf(p3, e.item), countOf(fresh, e.item), `${e.item}: nothing rolled in`);
  }
});

Deno.test('zone loot: relevance filter gates quest-kind contextual drops at the shared grant site', () => {
  // The ONE shared contextual grant site serves travel treasure AND
  // victory zone loot; quest-kind drops obey the central relevance filter
  // exactly like ordinary enemy drops (#2).
  const suppressed = createPlayer(1655, 'T', 'warrior');
  assertEquals(
    grantContextualDrops(suppressed, [{ item: 'q_toxin_sample', qty: 1 }]),
    [],
    'no open quest → the contextual drop never enters the bag',
  );
  assertEquals(countOf(suppressed, 'q_toxin_sample'), 0);

  const needs = createPlayer(1656, 'T', 'warrior');
  needs.quests['m6_toxin'] = { status: 'active', counts: [0] };
  addItem(needs, 'q_toxin_sample', 3);
  const lines = grantContextualDrops(needs, [{ item: 'q_toxin_sample', qty: 1 }]);
  assertEquals(countOf(needs, 'q_toxin_sample'), 4, 'granted while an open quest needs it');
  assert(lines.some((l) => l.includes('ready to turn in')), 'the completing grant readies m6');

  const capped = createPlayer(1657, 'T', 'warrior');
  capped.quests['m6_toxin'] = { status: 'active', counts: [0] };
  addItem(capped, 'q_toxin_sample', 4);
  assertEquals(
    grantContextualDrops(capped, [{ item: 'q_toxin_sample', qty: 1 }]),
    [],
    'cap reached → suppressed',
  );
  assertEquals(countOf(capped, 'q_toxin_sample'), 4);
});

Deno.test('zone loot: the shipped Outskirts path exercises contextual loot end to end', () => {
  const p = createPlayer(1658, 'T', 'warrior');
  p.tutorial = 'done';
  p.level = 2;
  p.currentZone = 'outskirts';
  // The real explore table (rng 0 picks the weighted-first battle) and the
  // real victory routing — the authored dt_ember_fields rolls inside it.
  const out = explore(p, seeded(9));
  assert(out.kind === 'battle', 'the roll lands on an outskirts battle');
  out.battle.enemy.hp = 0;
  resolveVictory(p, out.battle, zeroRng());
  assert(
    (out.battle.rewards!.contextual?.length ?? 0) > 0,
    'a shipped explore victory grants its zone table',
  );
});

Deno.test('zone loot: the origin policy admits explore, elite and travel only', () => {
  assert(zoneLootEligible({ kind: 'explore', zoneId: 'outskirts' }));
  assert(zoneLootEligible({ kind: 'elite', zoneId: 'outskirts' }));
  assert(zoneLootEligible({ kind: 'travel', zoneId: 'outskirts', edgeId: 'e', eventIndex: 0 }));
  assert(
    !zoneLootEligible({
      kind: 'dungeon',
      zoneId: 'outskirts',
      dungeonId: 'd',
      floor: 1,
      boss: false,
    }),
    'dungeon victories grant their own caches instead',
  );
});
