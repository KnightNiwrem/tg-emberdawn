/** Balance measurements follow structured grants and trigger attempts (#176). */

import { assert, assertEquals } from '@std/assert';
import { enemy } from '../src/content/enemies.ts';
import { item } from '../src/content/items.ts';
import type { EffectSpec } from '../src/content/types.ts';
import {
  dungeonBossSource,
  makeHero,
  POLICIES,
  runFight,
  seededRng,
} from '../src/engine/balance.ts';
import { startBattle } from '../src/engine/combat.ts';

Deno.test('balance metrics: Aldric opening grants include both sides despite different wording', () => {
  const hero = makeHero('warrior', 45, 'starting');
  hero.tutorial = 'done';
  const source = dungeonBossSource('umbra')!;
  const started = startBattle(source.enemyId, source.origin, {
    player: structuredClone(hero),
    rng: seededRng(19),
  })!;
  const grants = started.trace.filter((e) => e.kind === 'shieldGrant');
  assert(grants.some((e) => e.side === 'enemy' && e.applied === 250));
  assert(grants.some((e) => e.side === 'player' && e.applied > 0));
  const total = grants.reduce((sum, e) => sum + e.applied + e.wasted, 0);
  const result = runFight(hero, source.enemyId, POLICIES.free, seededRng(19), source.origin);
  assertEquals(
    result.shieldGranted,
    total,
    'both opening wards count without further shield casts',
  );
  assert(
    result.shieldAbsorbed <= result.shieldGranted,
    'absorption cannot exceed granted capacity',
  );
});

Deno.test('balance metrics: grant/waste and reactive procs ignore custom, quiet and extra lines', () => {
  const rat = enemy('e_rat')!;
  const charm = item('t_19')!;
  const originalOpening = rat.opening;
  const originalTriggers = charm.triggers;
  // Two nonlethal opening wounds trigger the same ward twice. The second
  // wound bypasses its full pool, so replacing it wastes all 25 capacity.
  rat.opening = {
    name: 'Two scratches',
    effects: [
      { kind: 'damage', attack: 'phys', power: 0.01, bypassShield: true },
      { kind: 'damage', attack: 'phys', power: 0.01, bypassShield: true },
    ],
  };
  const ward: Extract<EffectSpec, { kind: 'shield' }> = {
    kind: 'shield',
    amount: 25,
    duration: 3,
    timing: 'immediate',
  };
  const hero = makeHero('warrior', 5, 'starting');
  hero.equipment.trinket = charm.id;
  const run = () => runFight(hero, rat.id, POLICIES.free, seededRng(176));
  try {
    charm.triggers = [
      { name: 'Opening activation', trigger: 'battleStart', effects: [] },
      { name: 'Reactive ward', trigger: 'onHpDamage', maxProcs: 2, effects: [ward] },
    ];
    const baseline = run();
    assertEquals(baseline.shieldGranted, 50, 'two new 25-capacity grants');
    assertEquals(baseline.shieldWasted, 25, 'the full-pool recast is wasted');
    assertEquals(
      baseline.equipProcs,
      2,
      'two reactions, including the one with an extra waste line',
    );
    assertEquals(baseline.procHits, 3, 'total hits also include the battle-start activation');
    assertEquals(baseline.procAttempts, 3);

    ward.line = 'A custom ward answers for {n}.';
    assertEquals(run(), baseline, 'custom wording changes no fight measurement or outcome');
    delete ward.line;
    ward.quiet = true;
    assertEquals(run(), baseline, 'a silent success still counts its grant and proc once');
    delete ward.quiet;

    ward.stacking = 'refresh';
    const refreshed = run();
    assertEquals(refreshed.shieldGranted, 25, 'refresh adds no grant capacity');
    assertEquals(refreshed.shieldWasted, 0, 'an ungranted refresh is not wasted capacity');
    assertEquals(
      refreshed.equipProcs,
      2,
      'successful triggers still count when a refresh adds no pool',
    );

    charm.triggers[1]!.chance = 0;
    const missed = run();
    assertEquals(missed.shieldGranted, 0);
    assertEquals(missed.equipProcs, 0, 'missed reactive attempts are not successes');
    assertEquals(missed.procHits, 1, 'the battle-start activation still succeeds');
    assert(missed.procAttempts > missed.procHits);
  } finally {
    rat.opening = originalOpening;
    charm.triggers = originalTriggers;
  }
});
