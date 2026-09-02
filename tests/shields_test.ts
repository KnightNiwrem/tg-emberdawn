/** Shields (#79): one shared pool per side, capacity from independently
 * expiring contributions. Engine-level regression of the canonical
 * grant/damage/expire semantics plus resolver, UI and persistence paths. */

import { assert, assertEquals } from '@std/assert';
import {
  createPlayer,
  CURRENT_STATE_VERSION,
  migratePlayer,
  statsOf,
} from '../src/engine/character.ts';
import { performAction, previewBattle, startBattle } from '../src/engine/combat.ts';
import {
  absorbShield,
  grantShield,
  type InstanceSeed,
  maxShield,
  tickEndOfRound,
} from '../src/engine/effects.ts';
import type { BattleState, PlayerState } from '../src/engine/types.ts';
import { renderBattle } from '../src/render/battle.ts';
import { seeded } from './helpers.ts';

const ORIGIN = { kind: 'explore', zoneId: 'outskirts' } as const;

/** Aldric's boss-provenance origin — the only way the Sovereign Ward opens. */
const BOSS_ORIGIN = {
  kind: 'dungeon',
  zoneId: 'crownspire',
  dungeonId: 'd_throne',
  floor: 4,
  boss: true,
} as const;

/** A shield contribution seed with the given identity and capacity. */
function ward(
  defId: string,
  amount: number,
  stacking: InstanceSeed['stacking'] = 'replace',
): InstanceSeed {
  return {
    defId,
    name: `Ward ${defId}`,
    kind: 'shield',
    side: 'player',
    source: { kind: 'skill', id: defId, name: `Ward ${defId}` },
    shieldAmount: amount,
    tags: ['beneficial'],
    stacking,
    duration: 3,
    timing: 'immediate',
    removable: true,
  };
}

function battleFor(id: number, enemyId = 'e_rat'): { p: PlayerState; b: BattleState } {
  const p = createPlayer(id, 'T', 'warrior');
  const b = previewBattle(enemyId, ORIGIN)!;
  p.battle = b;
  return { p, b };
}

/** Stuns the enemy for one action — keeps fixtures free of rng-dependent
 * replies (the control instance is consumed by the enemy phase). */
function stunEnemy(b: BattleState): void {
  b.effectSeq++;
  b.effectInstances.push({
    iid: `stun${b.effectSeq}`,
    defId: 'test:stun',
    name: 'Stunned',
    side: 'enemy',
    source: { kind: 'legacy', id: 'test', name: 'test fixture' },
    kind: 'control',
    control: 'stun',
    actions: 1,
    tags: ['harmful', 'control'],
    stacking: 'replace',
    appliedRound: b.round,
    remaining: 1,
    removable: true,
    expiresRound: b.round,
  });
}

/** Synthetic end-of-round poison on the player (no shipped DoT content). */
function poison(b: BattleState, opts: { bypass?: true } = {}): void {
  b.effectSeq++;
  b.effectInstances.push({
    iid: `psn${b.effectSeq}`,
    defId: 'poison',
    name: 'Poison',
    side: 'player',
    source: { kind: 'skill', id: 'test', name: 'test fixture' },
    kind: 'periodic',
    perRound: -5,
    tickPhase: 'roundEnd',
    ...(opts.bypass ? { bypassShield: true } : {}),
    tags: ['harmful', 'periodic', 'poison'],
    stacking: 'replace',
    appliedRound: b.round,
    remaining: 2,
    removable: true,
    expiresRound: b.round + 1,
  });
}

Deno.test('shields: the canonical 200 → 60/200 → 60/100 → 0/0 regression (#79)', () => {
  const { b } = battleFor(800);
  grantShield(b, 'player', ward('a', 100));
  grantShield(b, 'player', ward('b', 100));
  assertEquals(b.shield.player, 200, 'two 100 grants: 200/200');
  assertEquals(maxShield(b, 'player'), 200);
  const hit = absorbShield(b, 'player', 140);
  assertEquals(hit.absorbed, 140);
  assertEquals(hit.hpDamage, 0, 'the ward took everything');
  assertEquals(b.shield.player, 60, '140 damage leaves 60/200');
  // Expire contribution 'a': the batch prune removes it, the maximum
  // drops to 100, and current is untouched (nothing lost to report).
  const a = b.effectInstances.find((i) => i.defId === 'a')!;
  a.remaining = 1;
  const r1 = tickEndOfRound(b, () => 100);
  assertEquals(maxShield(b, 'player'), 100);
  assertEquals(b.shield.player, 60, 'current survives the first expiry');
  assertEquals(r1.shieldLosses, [], 'no loss — capacity absorbed the cut');
  // Expire 'b': new max 0, so current caps to 0 — the canonical 0/0.
  const bb = b.effectInstances.find((i) => i.defId === 'b')!;
  bb.remaining = 1;
  const r2 = tickEndOfRound(b, () => 100);
  assertEquals(maxShield(b, 'player'), 0);
  assertEquals(b.shield.player, 0, '0/0');
  assertEquals(r2.shieldLosses, [{ side: 'player', lost: 60 }]);
});

Deno.test('shields: simultaneous expiry is order-independent (#79)', () => {
  for (const flip of [false, true]) {
    const { b } = battleFor(801);
    grantShield(b, 'player', ward('x', 100));
    grantShield(b, 'player', ward('y', 100));
    if (flip) b.effectInstances.reverse();
    absorbShield(b, 'player', 150); // 50 left over 200 max
    for (const i of b.effectInstances) {
      if (i.kind === 'shield') i.remaining = 1;
    }
    const r = tickEndOfRound(b, () => 100);
    assertEquals(b.shield.player, 0);
    assertEquals(maxShield(b, 'player'), 0);
    assertEquals(r.shieldLosses, [{ side: 'player', lost: 50 }]);
  }
});

Deno.test('shields: grant policies — refresh never refills, replace grants fresh, cap wastes (#79)', () => {
  const { b } = battleFor(802);
  grantShield(b, 'player', ward('a', 100));
  assertEquals(b.shield.player, 100);
  // refresh: renews the clock, never refills a depleted pool.
  absorbShield(b, 'player', 40); // 60/100
  const refreshed = grantShield(b, 'player', ward('a', 100, 'refresh'));
  assertEquals(refreshed.applied, 0, 'refresh does not refill');
  assertEquals(refreshed.wasted, 0);
  assertEquals(b.shield.player, 60);
  assertEquals(b.effectInstances.find((i) => i.defId === 'a')!.remaining, 3, 'clock renewed');
  // replace: retires the old contribution, grants fresh capacity — capped
  // to the new maximum.
  const replaced = grantShield(b, 'player', ward('a', 120, 'replace'));
  assertEquals(replaced.applied, 60, '60 in the pool + fresh 120, capped to max 120');
  assertEquals(replaced.wasted, 60);
  assertEquals(b.shield.player, 120);
  assertEquals(maxShield(b, 'player'), 120, 'one slot for identity a');
  // stack: independent contributions coexist.
  const stacked = grantShield(b, 'player', ward('b', 100, 'stack'));
  assertEquals(stacked.applied, 100);
  assertEquals(b.shield.player, 220);
  assertEquals(maxShield(b, 'player'), 220);
  grantShield(b, 'player', ward('c', 50, 'stack'));
  assertEquals(b.shield.player, 270);
  grantShield(b, 'player', ward('d', 30, 'stack'));
  assertEquals(b.shield.player, 300);
  assertEquals(maxShield(b, 'player'), 300);
  // Shrink: replacing a large ward with a smaller one removes the unused
  // maximum first and caps current — capacity is LOST, not kept.
  const shrunk = grantShield(b, 'player', ward('a', 50, 'replace'));
  assertEquals(maxShield(b, 'player'), 230, '50 + 100 + 50 + 30');
  assertEquals(b.shield.player, 230, 'current capped to the new maximum');
  assertEquals(shrunk.applied, 0, 'the cap left nothing for the grant to add');
  assertEquals(shrunk.wasted, 50, 'the whole grant was trimmed');
  assertEquals(shrunk.lost, 70, 'existing pool discarded by the cap');
});

Deno.test('shields: repeatable replace sources cannot grow the pool unbounded (#79)', () => {
  const { b } = battleFor(900);
  for (let i = 0; i < 30; i++) grantShield(b, 'player', ward('w', 100, 'replace'));
  assertEquals(b.effectInstances.filter((i) => i.defId === 'w').length, 1, 'one slot');
  assertEquals(b.shield.player, 100, 'no growth without fresh capacity');
  assertEquals(maxShield(b, 'player'), 100);
});

Deno.test('shields: bypassShield lands on HP and leaves the ward untouched (#79)', () => {
  let observed = false;
  for (let seed = 1; seed <= 120 && !observed; seed++) {
    const rng = seeded(seed);
    const p = createPlayer(820 + seed, 'T', 'warrior');
    p.level = 45;
    const b = previewBattle('e_aldric', BOSS_ORIGIN)!;
    p.battle = b;
    for (let round = 0; round < 30 && b.phase === 'active' && !observed; round++) {
      grantShield(b, 'player', ward('w', 100));
      const shieldBefore = b.shield.player;
      const hpBefore = p.hp;
      const res = performAction(p, b, { kind: 'guard' }, rng);
      const hit = res.lines.find((l) => l.includes('Wardrender') && l.includes('damage to you'));
      if (!hit) continue;
      observed = true;
      assertEquals(b.shield.player, shieldBefore, 'bypass damage never touches the ward');
      assert(p.hp < hpBefore, 'bypass damage lands on HP');
      assert(!hit.includes('absorbed'), 'no absorbed parenthetical on bypass damage');
    }
  }
  assert(observed, 'a Wardrender round was observed across the seed sweep');
});

Deno.test('shields: requireHpDamage riders only land on flesh (#79)', () => {
  // Fully warded: every Crown of Night is absorbed → the sap never lands.
  let sawCrown = false;
  for (let seed = 1; seed <= 60 && !sawCrown; seed++) {
    const rng = seeded(seed);
    const p = createPlayer(960 + seed, 'T', 'warrior');
    p.level = 45;
    p.hp = 99999; // #86: a fallen wearer procs nothing — survive the scan
    const b = previewBattle('e_aldric', BOSS_ORIGIN)!;
    p.battle = b;
    for (let round = 0; round < 20 && b.phase === 'active' && !sawCrown; round++) {
      grantShield(b, 'player', ward('w', 999));
      const res = performAction(p, b, { kind: 'guard' }, rng);
      if (res.lines.some((l) => l.includes('Crown of Night'))) {
        sawCrown = true;
        assert(
          !res.lines.some((l) => l.includes('sapped')),
          `a fully-shielded hit must not land the rider: ${res.lines.join(' | ')}`,
        );
      }
    }
  }
  assert(sawCrown, 'a Crown of Night round was observed while warded');
  // Unwarded: the sap lands with the flesh hit.
  let sawSap = false;
  for (let seed = 1; seed <= 60 && !sawSap; seed++) {
    const rng = seeded(seed);
    const p = createPlayer(1040 + seed, 'T', 'warrior');
    p.level = 45;
    p.hp = 99999; // #86: a fallen wearer procs nothing — survive the scan
    const b = previewBattle('e_aldric', BOSS_ORIGIN)!;
    p.battle = b;
    for (let round = 0; round < 20 && b.phase === 'active' && !sawSap; round++) {
      const res = performAction(p, b, { kind: 'guard' }, rng);
      if (res.lines.some((l) => l.includes('Crown of Night'))) {
        assert(
          res.lines.some((l) => l.includes('sapped')),
          `an unwarded flesh hit must land the rider: ${res.lines.join(' | ')}`,
        );
        sawSap = true;
      }
    }
  }
  assert(sawSap, 'a flesh Crown of Night round was observed');
});

Deno.test('shields: enemy wards absorb, expire and announce (#79)', () => {
  const rng = seeded(31);
  const p = createPlayer(830, 'T', 'warrior');
  p.level = 17;
  const b = previewBattle('e_sentinel', ORIGIN)!;
  p.battle = b;
  let seen = false;
  for (let i = 0; i < 60 && !seen; i++) {
    const res = performAction(p, b, { kind: 'guard' }, rng);
    if (res.lines.some((l) => l.includes('Runic Bulwark'))) {
      seen = true;
      assertEquals(b.shield.enemy, 45);
      assertEquals(maxShield(b, 'enemy'), 45);
      assert(res.lines.some((l) => l.includes('absorbing up to 45')), res.lines.join(' | '));
    }
  }
  assert(seen, 'Runic Bulwark must appear within 60 rounds');
  const res = performAction(p, b, { kind: 'attack' }, rng);
  assert(res.lines.some((l) => l.includes('absorbed')), res.lines.join(' | '));
  assert(b.shield.enemy < 45, 'the ward took the strike');
  performAction(p, b, { kind: 'attack' }, rng);
  performAction(p, b, { kind: 'attack' }, rng);
  assertEquals(b.shield.enemy, 0, 'the ward expired after its two rounds');
  assertEquals(maxShield(b, 'enemy'), 0);
});

Deno.test('shields: boss-provenance encounters open behind the ward (#79)', () => {
  // #91: the ward is an opening source, so it resolves through the full
  // pipeline — which now requires the fighting hero and an explicit RNG.
  const boss = startBattle('e_aldric', BOSS_ORIGIN, {
    player: createPlayer(830, 'T', 'warrior'),
    rng: seeded(91),
  })!;
  assertEquals(boss.shield.enemy, 250);
  assertEquals(maxShield(boss, 'enemy'), 250);
  const inst = boss.effectInstances.find((i) => i.kind === 'shield')!;
  assertEquals(inst.defId, 'opening:e_aldric');
  assertEquals(inst.name, 'Sovereign Ward');
  assertEquals(inst.removable, false, 'the opening ward resists dispel');
  assertEquals(inst.expiresRound, 4, 'immediate timing: rounds 1..4');
  const plain = startBattle('e_aldric', { kind: 'explore', zoneId: 'crownspire' }, {
    player: createPlayer(831, 'T', 'warrior'),
    rng: seeded(92),
  })!;
  assertEquals(plain.shield.enemy, 0, 'same enemy id, non-boss provenance');
  assertEquals(plain.effectInstances.filter((i) => i.kind === 'shield').length, 0);
});

Deno.test('shields: Aegis of Dawn grants a real ward through the resolver (#79)', () => {
  const p = createPlayer(840, 'T', 'cleric');
  p.level = 14;
  p.skills.push('sk_aegis');
  p.mp = 999;
  const b = previewBattle('e_rat', ORIGIN)!;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;
  stunEnemy(b);
  const res = performAction(p, b, { kind: 'skill', skillId: 'sk_aegis' }, seeded(41));
  const expected = Math.round(statsOf(p).mag * 1.2 * 2 + 20);
  assertEquals(maxShield(b, 'player'), expected);
  assertEquals(b.shield.player, expected, 'a fresh ward starts full');
  assert(res.lines.some((l) => l.includes('absorbing up to')), res.lines.join(' | '));
});

Deno.test('shields: healing HP never refills the ward (#79)', () => {
  const p = createPlayer(850, 'T', 'cleric');
  p.level = 20;
  p.skills.push('sk_mend');
  p.mp = 999;
  p.hp = 10;
  const b = previewBattle('e_rat', ORIGIN)!;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;
  grantShield(b, 'player', ward('w', 100));
  absorbShield(b, 'player', 100);
  assertEquals(b.shield.player, 0);
  stunEnemy(b);
  performAction(p, b, { kind: 'skill', skillId: 'sk_mend' }, seeded(42));
  assert(p.hp > 10, 'the heal landed');
  assertEquals(b.shield.player, 0, 'HP healing never touches the ward');
  assertEquals(maxShield(b, 'player'), 100, 'the contribution still lives');
});

Deno.test('shields: periodic damage routes through the ward; bypass ticks bite HP (#79)', () => {
  // Default routing: the ward takes the tick.
  const { p, b } = battleFor(860);
  poison(b);
  grantShield(b, 'player', ward('w', 100));
  stunEnemy(b);
  const hpBefore = p.hp;
  const res = performAction(p, b, { kind: 'guard' }, seeded(43));
  assertEquals(p.hp, hpBefore, 'the ward took the tick');
  assertEquals(b.shield.player, 95);
  assert(res.lines.some((l) => l.includes('(🛡️ 5 absorbed)')), res.lines.join(' | '));
  // Opted-out tick: HP bites directly, the ward is untouched.
  const { p: p2, b: b2 } = battleFor(861);
  poison(b2, { bypass: true });
  grantShield(b2, 'player', ward('w', 100));
  stunEnemy(b2);
  const hpBefore2 = p2.hp;
  performAction(p2, b2, { kind: 'guard' }, seeded(44));
  assertEquals(p2.hp, hpBefore2 - 5, 'the bypass tick bites HP');
  assertEquals(b2.shield.player, 100, 'the ward is untouched');
});

Deno.test('shields: the battle screen renders, depletes and removes ward bars (#79)', () => {
  const { p, b } = battleFor(870);
  grantShield(b, 'player', ward('w', 80));
  const text = (): string => JSON.stringify(renderBattle(p));
  assert(text().includes('Shield 80/80'), 'the full ward renders');
  absorbShield(b, 'player', 80);
  assert(text().includes('Shield 0/80 (depleted)'), 'the empty state is legible');
  const inst = b.effectInstances.find((i) => i.defId === 'w')!;
  inst.remaining = 1;
  tickEndOfRound(b, () => 100);
  assertEquals(maxShield(b, 'player'), 0);
  assert(!text().includes('Shield '), 'the bar is gone at zero capacity');
});

Deno.test('migratePlayer: v6 in-flight battles gain the shield pool (#79)', () => {
  const p = createPlayer(880, 'T', 'warrior');
  p.stateVersion = 6;
  const b = previewBattle('e_rat', ORIGIN)!;
  p.battle = b;
  const rec = b as unknown as Record<string, unknown>;
  delete rec.shield; // simulate a pre-#79 in-flight battle
  migratePlayer(p);
  assertEquals(p.stateVersion, CURRENT_STATE_VERSION);
  assertEquals(b.shield, { player: 0, enemy: 0 });
});

Deno.test('shields: ward state survives a save/load round-trip (#79)', () => {
  const { p, b } = battleFor(890);
  grantShield(b, 'player', ward('w', 70));
  absorbShield(b, 'player', 20); // 50/70
  const loaded = structuredClone(p) as PlayerState;
  migratePlayer(loaded); // the load path (no-op at the current version)
  assertEquals(loaded.battle!.shield, { player: 50, enemy: 0 });
  assertEquals(maxShield(loaded.battle!, 'player'), 70);
  assertEquals(loaded.battle!.effectInstances.filter((i) => i.kind === 'shield').length, 1);
});
