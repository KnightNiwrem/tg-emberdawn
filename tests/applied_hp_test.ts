/** #106: applied-HP telemetry semantics — every damage family's hpDamaged
 * entry carries the RESOLVED blow (post-mitigation, post-shield, pre-floor)
 * and the actual hpLost (beforeHp − afterHp, capped by available HP), so a
 * 1-HP target contributes exactly 1 to HP-lost metrics no matter how large
 * the blow; lifesteal records hpRestored with attempted + applied and its
 * battle text reports the APPLIED amount. */

import { assert, assertEquals, assertExists } from '@std/assert';
import { statsOf } from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { grantShield } from '../src/engine/effects.ts';
import { makeHero } from '../src/engine/balance.ts';
import type { CombatTraceEntry } from '../src/engine/telemetry.ts';
import type { BattleState, PlayerState } from '../src/engine/types.ts';
import { seeded } from './helpers.ts';

const ORIGIN = { kind: 'explore', zoneId: 'outskirts' } as const;

const findTrace = <K extends CombatTraceEntry['kind']>(
  trace: CombatTraceEntry[],
  kind: K,
): Extract<CombatTraceEntry, { kind: K }>[] =>
  trace.filter((e): e is Extract<CombatTraceEntry, { kind: K }> => e.kind === kind);

function ratAtOneHp(p: PlayerState, seed: number): BattleState {
  const b = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(seed) })!.battle;
  b.enemy.hp = 1;
  p.battle = b;
  return b;
}

Deno.test('#106: direct overkill — a 1-HP enemy contributes exactly 1 hpLost', () => {
  const p = makeHero('warrior', 20, 'best');
  const b = ratAtOneHp(p, 41);
  const res = performAction(p, b, { kind: 'attack' }, seeded(42));
  assertEquals(b.enemy.hp, 0, 'the blow felled the rat');
  assertEquals(res.outcome, 'victory');
  const hits = findTrace(res.trace, 'hpDamaged').filter((e) =>
    e.target === 'enemy' && e.cause === 'playerAction'
  );
  assertEquals(hits.length, 1, 'one direct-hit entry');
  assertEquals(hits[0]!.hpLost, 1, 'the actual HP delta is all the rat had');
  assert(hits[0]!.resolved > 1, `the resolved blow keeps the overkill (${hits[0]!.resolved})`);
});

Deno.test('#106: periodic overkill — a lethal tick records hpLost = remaining HP', () => {
  const p = makeHero('warrior', 20, 'best');
  const b = ratAtOneHp(p, 43);
  b.effectInstances.push({
    iid: 'dot1',
    defId: 'test:dot',
    name: 'Doom Venom',
    side: 'enemy',
    source: { kind: 'skill', id: 'test', name: 'test fixture' },
    kind: 'periodic',
    perRound: -50,
    tickPhase: 'roundEnd',
    tags: ['harmful', 'periodic', 'poison'],
    stacking: 'replace',
    appliedRound: b.round,
    remaining: 3,
    removable: true,
    expiresRound: b.round + 2,
  });
  // Guard: the strike must not fell the rat first — the tick is the probe.
  const res = performAction(p, b, { kind: 'guard' }, seeded(44));
  assertEquals(b.enemy.hp, 0, 'the tick felled the rat');
  const hits = findTrace(res.trace, 'hpDamaged').filter((e) =>
    e.target === 'enemy' && e.cause === 'periodic'
  );
  assertEquals(hits.length, 1, 'one periodic-damage entry');
  assertEquals(hits[0]!.hpLost, 1, 'the tick could only take the HP the rat had');
  assertEquals(hits[0]!.resolved, 50, 'the resolved tick keeps its full magnitude');
  const tick = findTrace(res.trace, 'periodicTick').find((t) => t.applied < 0);
  assertExists(tick);
  assertEquals(tick.applied, -1, 'the tick entry agrees: applied is the actual delta');
});

Deno.test('#106: shield plus overkill — absorption is never counted as HP loss', () => {
  const p = makeHero('warrior', 20, 'best');
  const b = ratAtOneHp(p, 45);
  grantShield(b, 'enemy', {
    defId: 'test:ward',
    name: 'Test Ward',
    kind: 'shield',
    side: 'enemy',
    source: { kind: 'skill', id: 'test', name: 'test fixture' },
    shieldAmount: 10,
    tags: ['beneficial'],
    stacking: 'replace',
    duration: 9,
    timing: 'immediate',
    removable: true,
  });
  const res = performAction(p, b, { kind: 'attack' }, seeded(46));
  assertEquals(b.enemy.hp, 0);
  assertEquals(b.shield.enemy, 0, 'the ward spent its pool');
  const hits = findTrace(res.trace, 'hpDamaged').filter((e) =>
    e.target === 'enemy' && e.cause === 'playerAction'
  );
  assertEquals(hits.length, 1);
  assertEquals(
    hits[0]!.hpLost,
    1,
    'hpLost is the real HP delta — not the resolved blow, not blow+absorption',
  );
  assert(hits[0]!.resolved > 1, 'the ward overflow still reached HP');
  assert(
    res.lines.some((l) => l.includes('absorbed')),
    'the absorption is still visible in the battle text',
  );
});

Deno.test('#106: player lifesteal near max HP — attempted vs applied, text reports applied', () => {
  const p = makeHero('mage', 17, 'best');
  if (!p.skills.includes('sk_drain_life')) p.skills.push('sk_drain_life');
  p.mp = 999;
  const b = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(47) })!.battle;
  b.enemy.hp = 99999; // the rat must survive the strike — the drain is the probe
  b.enemy.maxHp = 99999;
  p.battle = b;
  p.hp = statsOf(p).maxHp - 1; // exactly 1 HP of headroom
  const res = performAction(p, b, { kind: 'skill', skillId: 'sk_drain_life' }, seeded(48));
  const restored = findTrace(res.trace, 'hpRestored').filter((e) => e.side === 'player');
  assertEquals(restored.length, 1, 'the drain appended typed restoration telemetry');
  assertEquals(restored[0]!.applied, 1, 'only the missing HP actually landed');
  assert(restored[0]!.attempted > 1, `the formulaic drain overflowed (${restored[0]!.attempted})`);
  assertEquals(restored[0]!.cause, 'playerAction');
  assert(
    res.lines.some((l) => l === '🩸 You drain 1 HP.'),
    `the line reports the APPLIED amount: ${res.lines.filter((l) => l.includes('drain'))}`,
  );
  assert(
    !res.lines.some((l) => l.includes(`drain ${restored[0]!.attempted}`)),
    'the formulaic amount never reaches the player',
  );
});

Deno.test('#106: enemy lifesteal near max HP — attempted vs applied, text reports applied', () => {
  // The Marsh Leech's Drain: damage + 60% lifesteal for the enemy. A seed
  // hunt finds a round where Drain lands (the strike must not be slipped).
  let found:
    | { p: PlayerState; b: BattleState; res: ReturnType<typeof performAction> }
    | undefined;
  for (let s = 1; s <= 200 && !found; s++) {
    const p = makeHero('warrior', 5, 'starting'); // too weak to fell the leech first
    const b = startBattle('e_leech', { kind: 'explore', zoneId: 'hollowmere' }, {
      player: p,
      rng: seeded(s),
    })!.battle;
    b.enemy.hp = b.enemy.maxHp - 1; // exactly 1 HP of headroom
    p.battle = b;
    p.hp = 99999; // survival is not the variable under test
    const res = performAction(p, b, { kind: 'guard' }, seeded(s));
    if (res.lines.some((l) => l.includes('drains') && l.includes('from you'))) {
      found = { p, b, res };
    }
  }
  assertExists(found, 'a landed Drain seed exists');
  const restored = findTrace(found.res.trace, 'hpRestored').filter((e) => e.side === 'enemy');
  assertEquals(restored.length, 1, 'the enemy drain appended typed restoration telemetry');
  assertEquals(restored[0]!.applied, 1, 'the leech could only bank its missing HP');
  assert(restored[0]!.attempted > 1, `the formulaic drain overflowed (${restored[0]!.attempted})`);
  assertEquals(restored[0]!.cause, 'enemyAction');
  assert(
    found.res.lines.some((l) => l === '🩸 Marsh Leech drains 1 HP from you!'),
    `the line reports the APPLIED amount: ${found.res.lines.filter((l) => l.includes('drain'))}`,
  );
  assertEquals(found.b.enemy.hp, found.b.enemy.maxHp, 'the leech tops off at exactly max HP');
});
