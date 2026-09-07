/** Shields (#79): one shared pool per side, capacity from independently
 * expiring contributions. Engine-level regression of the canonical
 * grant/damage/expire semantics plus resolver, UI and persistence paths. */

import { assert, assertEquals } from '@std/assert';
import { assertSupportedSaveVersion, createPlayer, statsOf } from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
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
  const player = createPlayer(id, 'T', 'warrior');
  // #99: playable fights construct through startBattle — the real opening
  // pipeline with the fighting hero and an explicit RNG.
  const battle = startBattle(enemyId, ORIGIN, { player, rng: seeded(id) })!.battle;
  player.battle = battle;
  return { p: player, b: battle };
}

/** Stuns the enemy for one action — keeps fixtures free of rng-dependent
 * replies (the control instance is consumed by the enemy phase). */
function stunEnemy(battle: BattleState): void {
  battle.effectSeq++;
  battle.effectInstances.push({
    iid: `stun${battle.effectSeq}`,
    defId: 'test:stun',
    name: 'Stunned',
    side: 'enemy',
    source: { kind: 'skill', id: 'test', name: 'test fixture' },
    kind: 'control',
    control: 'stun',
    actions: 1,
    tags: ['harmful', 'control'],
    stacking: 'replace',
    appliedRound: battle.round,
    remaining: 1,
    removable: true,
    expiresRound: battle.round,
  });
}

/** Synthetic end-of-round poison on the player (no shipped DoT content). */
function poison(battle: BattleState, options: { bypass?: true } = {}): void {
  battle.effectSeq++;
  battle.effectInstances.push({
    iid: `psn${battle.effectSeq}`,
    defId: 'poison',
    name: 'Poison',
    side: 'player',
    source: { kind: 'skill', id: 'test', name: 'test fixture' },
    kind: 'periodic',
    perRound: -5,
    tickPhase: 'roundEnd',
    ...(options.bypass ? { bypassShield: true } : {}),
    tags: ['harmful', 'periodic', 'poison'],
    stacking: 'replace',
    appliedRound: battle.round,
    remaining: 2,
    removable: true,
    expiresRound: battle.round + 1,
  });
}

Deno.test('shields: the canonical 200 → 60/200 → 60/100 → 0/0 regression (#79)', () => {
  const { b: battle } = battleFor(800);
  grantShield(battle, 'player', ward('a', 100));
  grantShield(battle, 'player', ward('b', 100));
  assertEquals(battle.shield.player, 200, 'two 100 grants: 200/200');
  assertEquals(maxShield(battle, 'player'), 200);
  const hit = absorbShield(battle, 'player', 140);
  assertEquals(hit.absorbed, 140);
  assertEquals(hit.hpDamage, 0, 'the ward took everything');
  assertEquals(battle.shield.player, 60, '140 damage leaves 60/200');
  // Expire contribution 'a': the batch prune removes it, the maximum
  // drops to 100, and current is untouched (nothing lost to report).
  const instanceA = battle.effectInstances.find((inst) => inst.defId === 'a')!;
  instanceA.remaining = 1;
  const r1 = tickEndOfRound(battle, () => 100);
  assertEquals(maxShield(battle, 'player'), 100);
  assertEquals(battle.shield.player, 60, 'current survives the first expiry');
  assertEquals(r1.shieldLosses, [], 'no loss — capacity absorbed the cut');
  // Expire 'b': new max 0, so current caps to 0 — the canonical 0/0.
  const instanceB = battle.effectInstances.find((inst) => inst.defId === 'b')!;
  instanceB.remaining = 1;
  const r2 = tickEndOfRound(battle, () => 100);
  assertEquals(maxShield(battle, 'player'), 0);
  assertEquals(battle.shield.player, 0, '0/0');
  assertEquals(r2.shieldLosses, [{ side: 'player', lost: 60 }]);
});

Deno.test('shields: simultaneous expiry is order-independent (#79)', () => {
  for (const flip of [false, true]) {
    const { b: battle } = battleFor(801);
    grantShield(battle, 'player', ward('x', 100));
    grantShield(battle, 'player', ward('y', 100));
    if (flip) battle.effectInstances.reverse();
    absorbShield(battle, 'player', 150); // 50 left over 200 max
    for (const instance of battle.effectInstances) {
      if (instance.kind === 'shield') instance.remaining = 1;
    }
    const tickResult = tickEndOfRound(battle, () => 100);
    assertEquals(battle.shield.player, 0);
    assertEquals(maxShield(battle, 'player'), 0);
    assertEquals(tickResult.shieldLosses, [{ side: 'player', lost: 50 }]);
  }
});

Deno.test('shields: grant policies — refresh never refills, replace grants fresh, cap wastes (#79)', () => {
  const { b: battle } = battleFor(802);
  grantShield(battle, 'player', ward('a', 100));
  assertEquals(battle.shield.player, 100);
  // refresh: renews the clock, never refills a depleted pool.
  absorbShield(battle, 'player', 40); // 60/100
  const refreshed = grantShield(battle, 'player', ward('a', 100, 'refresh'));
  assertEquals(refreshed.applied, 0, 'refresh does not refill');
  assertEquals(refreshed.wasted, 0);
  assertEquals(battle.shield.player, 60);
  assertEquals(
    battle.effectInstances.find((instance) => instance.defId === 'a')!.remaining,
    3,
    'clock renewed',
  );
  // replace: retires the old contribution, grants fresh capacity — capped
  // to the new maximum.
  const replaced = grantShield(battle, 'player', ward('a', 120, 'replace'));
  assertEquals(replaced.applied, 60, '60 in the pool + fresh 120, capped to max 120');
  assertEquals(replaced.wasted, 60);
  assertEquals(battle.shield.player, 120);
  assertEquals(maxShield(battle, 'player'), 120, 'one slot for identity a');
  // stack: independent contributions coexist.
  const stacked = grantShield(battle, 'player', ward('b', 100, 'stack'));
  assertEquals(stacked.applied, 100);
  assertEquals(battle.shield.player, 220);
  assertEquals(maxShield(battle, 'player'), 220);
  grantShield(battle, 'player', ward('c', 50, 'stack'));
  assertEquals(battle.shield.player, 270);
  grantShield(battle, 'player', ward('d', 30, 'stack'));
  assertEquals(battle.shield.player, 300);
  assertEquals(maxShield(battle, 'player'), 300);
  // Shrink: replacing a large ward with a smaller one removes the unused
  // maximum first and caps current — capacity is LOST, not kept.
  const shrunk = grantShield(battle, 'player', ward('a', 50, 'replace'));
  assertEquals(maxShield(battle, 'player'), 230, '50 + 100 + 50 + 30');
  assertEquals(battle.shield.player, 230, 'current capped to the new maximum');
  assertEquals(shrunk.applied, 0, 'the cap left nothing for the grant to add');
  assertEquals(shrunk.wasted, 50, 'the whole grant was trimmed');
  assertEquals(shrunk.lost, 70, 'existing pool discarded by the cap');
});

Deno.test('shields: repeatable replace sources cannot grow the pool unbounded (#79)', () => {
  const { b: battle } = battleFor(900);
  for (let i = 0; i < 30; i++) grantShield(battle, 'player', ward('w', 100, 'replace'));
  assertEquals(
    battle.effectInstances.filter((instance) => instance.defId === 'w').length,
    1,
    'one slot',
  );
  assertEquals(battle.shield.player, 100, 'no growth without fresh capacity');
  assertEquals(maxShield(battle, 'player'), 100);
});

Deno.test('shields: strongest wards compare capacity, not pct (#93)', () => {
  const { b: battle } = battleFor(910);
  // First grant creates the contribution.
  const first = grantShield(battle, 'player', ward('s', 100, 'strongest'));
  assertEquals(first.applied, 100);
  assertEquals(battle.shield.player, 100);
  assertEquals(maxShield(battle, 'player'), 100);
  // A STRONGER recast supersedes it whole: the 200-point contribution
  // replaces the 100-point one — existing current is preserved up to the
  // new maximum, overflow is wasted.
  const stronger = grantShield(battle, 'player', ward('s', 200, 'strongest'));
  assertEquals(
    battle.effectInstances.filter((instance) => instance.defId === 's').length,
    1,
    'one slot',
  );
  assertEquals(maxShield(battle, 'player'), 200, 'the bigger ward now backs the pool');
  assertEquals(battle.shield.player, 200, '100 current preserved, +100 fresh, capped at 200');
  assertEquals(stronger.applied, 100, 'only the fresh capacity entered');
  assertEquals(stronger.wasted, 100, 'the capped remainder');
  assertEquals(stronger.lost, 0);
  // A weaker recast neither overwrites nor refills — the 200 stands.
  absorbShield(battle, 'player', 200); // drain the pool to 0
  const weaker = grantShield(battle, 'player', ward('s', 150, 'strongest'));
  assertEquals(weaker.applied, 0, 'a weaker ward never refills');
  assertEquals(weaker.wasted, 0, 'its capacity never even entered the pool');
  assertEquals(maxShield(battle, 'player'), 200, 'the stronger contribution still stands');
  assertEquals(battle.shield.player, 0);
  // An equal-strength recast follows the documented lifetime rule: it may
  // only extend the lifetime — never refill.
  const longer = ward('s', 200, 'strongest');
  longer.duration = 9;
  const extended = grantShield(battle, 'player', longer);
  assertEquals(extended.applied, 0, 'equal strength never refills');
  assertEquals(maxShield(battle, 'player'), 200);
  const inst = battle.effectInstances.find((instance) => instance.defId === 's')!;
  assertEquals(inst.expiresRound, 9, 'equal-strength recast extended the lifetime');
});

Deno.test('shields: strongest vs refresh vs replace grant behavior stays distinct (#93)', () => {
  const { b: battle } = battleFor(911);
  grantShield(battle, 'player', ward('r', 100, 'refresh'));
  absorbShield(battle, 'player', 100);
  // Refresh renews the clock but the depleted pool stays empty.
  grantShield(battle, 'player', ward('r', 100, 'refresh'));
  assertEquals(battle.shield.player, 0, 'refresh never refills');
  assertEquals(maxShield(battle, 'player'), 100);
  // Replace grants fresh capacity again.
  grantShield(battle, 'player', ward('r', 100, 'replace'));
  assertEquals(battle.shield.player, 100, 'replace refills');
});

Deno.test('shields: bypassShield lands on HP and leaves the ward untouched (#79)', () => {
  let observed = false;
  for (let seed = 1; seed <= 120 && !observed; seed++) {
    const rng = seeded(seed);
    const player = createPlayer(820 + seed, 'T', 'warrior');
    player.level = 45;
    const battle = startBattle('e_aldric', BOSS_ORIGIN, { player, rng })!.battle;
    player.battle = battle;
    for (let round = 0; round < 30 && battle.phase === 'active' && !observed; round++) {
      grantShield(battle, 'player', ward('w', 100));
      const shieldBefore = battle.shield.player;
      const hpBefore = player.hp;
      const res = performAction(player, battle, { kind: 'guard' }, rng);
      const hit = res.lines.find((line) =>
        line.includes('Wardrender') && line.includes('damage to you')
      );
      if (!hit) continue;
      observed = true;
      assertEquals(battle.shield.player, shieldBefore, 'bypass damage never touches the ward');
      assert(player.hp < hpBefore, 'bypass damage lands on HP');
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
    const player = createPlayer(960 + seed, 'T', 'warrior');
    player.level = 45;
    player.hp = 99999; // #86: a fallen wearer procs nothing — survive the scan
    const battle = startBattle('e_aldric', BOSS_ORIGIN, { player, rng })!.battle;
    player.battle = battle;
    for (let round = 0; round < 20 && battle.phase === 'active' && !sawCrown; round++) {
      grantShield(battle, 'player', ward('w', 999));
      const res = performAction(player, battle, { kind: 'guard' }, rng);
      if (res.lines.some((line) => line.includes('Crown of Night'))) {
        sawCrown = true;
        assert(
          !res.lines.some((line) => line.includes('sapped')),
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
    const player = createPlayer(1040 + seed, 'T', 'warrior');
    player.level = 45;
    player.hp = 99999; // #86: a fallen wearer procs nothing — survive the scan
    const battle = startBattle('e_aldric', BOSS_ORIGIN, { player, rng })!.battle;
    player.battle = battle;
    for (let round = 0; round < 20 && battle.phase === 'active' && !sawSap; round++) {
      const res = performAction(player, battle, { kind: 'guard' }, rng);
      if (res.lines.some((line) => line.includes('Crown of Night'))) {
        assert(
          res.lines.some((line) => line.includes('sapped')),
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
  const player = createPlayer(830, 'T', 'warrior');
  player.level = 17;
  const battle = startBattle('e_sentinel', ORIGIN, { player, rng: seeded(30) })!.battle;
  player.battle = battle;
  let seen = false;
  for (let roundIndex = 0; roundIndex < 60 && !seen; roundIndex++) {
    const res = performAction(player, battle, { kind: 'guard' }, rng);
    if (res.lines.some((line) => line.includes('Runic Bulwark'))) {
      seen = true;
      assertEquals(battle.shield.enemy, 45);
      assertEquals(maxShield(battle, 'enemy'), 45);
      assert(res.lines.some((line) => line.includes('absorbing up to 45')), res.lines.join(' | '));
    }
  }
  assert(seen, 'Runic Bulwark must appear within 60 rounds');
  const res = performAction(player, battle, { kind: 'attack' }, rng);
  assert(res.lines.some((line) => line.includes('absorbed')), res.lines.join(' | '));
  assert(battle.shield.enemy < 45, 'the ward took the strike');
  performAction(player, battle, { kind: 'attack' }, rng);
  performAction(player, battle, { kind: 'attack' }, rng);
  assertEquals(battle.shield.enemy, 0, 'the ward expired after its two rounds');
  assertEquals(maxShield(battle, 'enemy'), 0);
});

Deno.test('shields: boss-provenance encounters open behind the ward (#79)', () => {
  // #91: the ward is an opening source, so it resolves through the full
  // pipeline — which now requires the fighting hero and an explicit RNG.
  const boss = startBattle('e_aldric', BOSS_ORIGIN, {
    player: createPlayer(830, 'T', 'warrior'),
    rng: seeded(91),
  })!.battle;
  assertEquals(boss.shield.enemy, 250);
  assertEquals(maxShield(boss, 'enemy'), 250);
  const inst = boss.effectInstances.find((instance) => instance.kind === 'shield')!;
  assertEquals(inst.defId, 'opening:e_aldric');
  assertEquals(inst.name, 'Sovereign Ward');
  assertEquals(inst.removable, false, 'the opening ward resists dispel');
  assertEquals(inst.expiresRound, 4, 'immediate timing: rounds 1..4');
  const plain = startBattle('e_aldric', { kind: 'explore', zoneId: 'crownspire' }, {
    player: createPlayer(831, 'T', 'warrior'),
    rng: seeded(92),
  })!.battle;
  assertEquals(plain.shield.enemy, 0, 'same enemy id, non-boss provenance');
  assertEquals(plain.effectInstances.filter((instance) => instance.kind === 'shield').length, 0);
});

Deno.test('shields: Aegis of Dawn grants a real ward through the resolver (#79)', () => {
  const player = createPlayer(840, 'T', 'cleric');
  player.level = 14;
  player.skills.push('sk_aegis');
  player.mp = 999;
  const battle = startBattle('e_rat', ORIGIN, { player, rng: seeded(40) })!.battle;
  battle.enemy.hp = 99999;
  battle.enemy.maxHp = 99999;
  player.battle = battle;
  stunEnemy(battle);
  const res = performAction(player, battle, { kind: 'skill', skillId: 'sk_aegis' }, seeded(41));
  const expected = Math.round(statsOf(player).mag * 1.2 * 2 + 20);
  assertEquals(maxShield(battle, 'player'), expected);
  assertEquals(battle.shield.player, expected, 'a fresh ward starts full');
  assert(res.lines.some((line) => line.includes('absorbing up to')), res.lines.join(' | '));
});

Deno.test('shields: healing HP never refills the ward (#79)', () => {
  const player = createPlayer(850, 'T', 'cleric');
  player.level = 20;
  player.skills.push('sk_mend');
  player.mp = 999;
  player.hp = 10;
  const battle = startBattle('e_rat', ORIGIN, { player, rng: seeded(41) })!.battle;
  battle.enemy.hp = 99999;
  battle.enemy.maxHp = 99999;
  player.battle = battle;
  grantShield(battle, 'player', ward('w', 100));
  absorbShield(battle, 'player', 100);
  assertEquals(battle.shield.player, 0);
  stunEnemy(battle);
  performAction(player, battle, { kind: 'skill', skillId: 'sk_mend' }, seeded(42));
  assert(player.hp > 10, 'the heal landed');
  assertEquals(battle.shield.player, 0, 'HP healing never touches the ward');
  assertEquals(maxShield(battle, 'player'), 100, 'the contribution still lives');
});

Deno.test('shields: periodic damage routes through the ward; bypass ticks bite HP (#79)', () => {
  // Default routing: the ward takes the tick.
  const { p: player, b: battle } = battleFor(860);
  poison(battle);
  grantShield(battle, 'player', ward('w', 100));
  stunEnemy(battle);
  const hpBefore = player.hp;
  const res = performAction(player, battle, { kind: 'guard' }, seeded(43));
  assertEquals(player.hp, hpBefore, 'the ward took the tick');
  assertEquals(battle.shield.player, 95);
  assert(res.lines.some((line) => line.includes('(🛡️ 5 absorbed)')), res.lines.join(' | '));
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
  const { p: player, b: battle } = battleFor(870);
  grantShield(battle, 'player', ward('w', 80));
  const text = (): string => JSON.stringify(renderBattle(player));
  assert(text().includes('Shield 80/80'), 'the full ward renders');
  absorbShield(battle, 'player', 80);
  assert(text().includes('Shield 0/80 (depleted)'), 'the empty state is legible');
  const inst = battle.effectInstances.find((instance) => instance.defId === 'w')!;
  inst.remaining = 1;
  tickEndOfRound(battle, () => 100);
  assertEquals(maxShield(battle, 'player'), 0);
  assert(!text().includes('Shield '), 'the bar is gone at zero capacity');
});

Deno.test('shields: ward state survives a save/load round-trip (#79)', () => {
  const { p: player, b: battle } = battleFor(890);
  grantShield(battle, 'player', ward('w', 70));
  absorbShield(battle, 'player', 20); // 50/70
  const loaded = structuredClone(player) as PlayerState;
  assertSupportedSaveVersion(loaded); // the load path (a no-op at the current version)
  assertEquals(loaded.battle!.shield, { player: 50, enemy: 0 });
  assertEquals(maxShield(loaded.battle!, 'player'), 70);
  assertEquals(
    loaded.battle!.effectInstances.filter((instance) => instance.kind === 'shield').length,
    1,
  );
});
