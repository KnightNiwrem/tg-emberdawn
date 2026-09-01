/** Pre-emptive battle-opening phase (#80): construction-time resolution in
 * explicit stable order (encounter ward → enemy opening → equipment →
 * learned pre-emptive skills), determinism under seeded RNG, once-only
 * persistence, battle-lifetime semantics, tutorial suppression, cast gating
 * and UI wiring. */

import { assert, assertEquals, assertExists } from '@std/assert';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { applyInstance, maxShield, seedForSpec, tickEndOfRound } from '../src/engine/effects.ts';
import type { BattleOrigin, BattleState, PlayerState } from '../src/engine/types.ts';
import { renderBattle, renderSkillMenu } from '../src/render/battle.ts';
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

/** A rogue carrying the full #80 kit: Expose Weakness + Wardstone Pendant. */
function roguePlayer(id: number): PlayerState {
  const p = createPlayer(id, 'R', 'rogue');
  p.level = 20;
  p.skills.push('sk_expose_weakness');
  p.equipment.trinket = 't_wardstone';
  return p;
}

/** A seed under which Expose Weakness's 60% opening roll SUCCEEDS. */
function exposeSuccessSeed(): number {
  for (let s = 1; s <= 200; s++) {
    const b = startBattle('e_rat', ORIGIN, { player: roguePlayer(900 + s), rng: seeded(s) })!;
    if (b.effectInstances.some((i) => i.defId === 'sk_expose_weakness')) return s;
  }
  throw new Error('no expose-success seed found in 1..200');
}

/** A seed under which the roll FAILS. */
function exposeFailureSeed(): number {
  for (let s = 1; s <= 200; s++) {
    const b = startBattle('e_rat', ORIGIN, { player: roguePlayer(900 + s), rng: seeded(s) })!;
    if (!b.effectInstances.some((i) => i.defId === 'sk_expose_weakness')) return s;
  }
  throw new Error('no expose-failure seed found in 1..200');
}

Deno.test('#80: openings resolve identically under the same seed', () => {
  const a = startBattle('e_rat', ORIGIN, { player: roguePlayer(1), rng: seeded(7) })!;
  const b = startBattle('e_rat', ORIGIN, { player: roguePlayer(2), rng: seeded(7) })!;
  assertEquals(a.opening, b.opening);
  assertEquals(a.effectInstances, b.effectInstances);
  assertEquals(a.shield, b.shield);
});

Deno.test('#80: opening chance rolls honor the seed — outcome-only persistence', () => {
  const win = exposeSuccessSeed();
  assert(win !== exposeFailureSeed());
  const b = startBattle('e_rat', ORIGIN, { player: roguePlayer(3), rng: seeded(win) })!;
  const exposed = b.effectInstances.find((i) => i.defId === 'sk_expose_weakness');
  assertExists(exposed);
  assertEquals(exposed.side, 'enemy');
  // Provenance survives in the instance (UI/history criterion).
  assertEquals(exposed.source, {
    kind: 'skill',
    id: 'sk_expose_weakness',
    name: 'Expose Weakness',
  });
  assertEquals(exposed.pct, 0.25);
});

Deno.test('#80: openings consume no round, MP or cooldowns', () => {
  const p = roguePlayer(4);
  const mpBefore = p.mp;
  const b = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(11) })!;
  assertEquals(b.round, 1);
  assertEquals(b.history.length, 0);
  assertEquals(b.cooldowns, {});
  // Expose Weakness costs 6 MP as a skill — the opening never charges it.
  assertEquals(p.mp, mpBefore);
});

Deno.test('#80: pipeline order — ward, then equipment, then pre-emptive skill', () => {
  const seed = exposeSuccessSeed();
  const b = startBattle('e_aldric', BOSS_ORIGIN, { player: roguePlayer(5), rng: seeded(seed) })!;
  const lines = b.opening!.lines;
  assert(lines[0]!.includes('Sovereign Ward'), 'encounter ward resolves first');
  assert(lines[0]!.includes('250'));
  const wardIdx = lines.findIndex((l) => l.includes('Wardstone'));
  const exposeIdx = lines.findIndex((l) => l.includes('Exposed'));
  assert(wardIdx > 0, 'equipment opening present');
  assert(exposeIdx > wardIdx, 'pre-emptive skill resolves after equipment');
});

Deno.test('#80: enemy-global openings fire in every provenance; boss ward is provenance-gated', () => {
  const vaultBossOrigin = {
    kind: 'dungeon',
    zoneId: 'sunspire',
    dungeonId: 'd_vault',
    floor: 1,
    boss: true,
  } as const satisfies BattleOrigin;
  const wild = startBattle('e_chronowisp', ORIGIN, { player: roguePlayer(6), rng: seeded(3) })!;
  assert(wild.opening!.lines.some((l) => l.includes('Chrono Anchor')));
  const anchored = wild.effectInstances.find((i) => i.defId === 'e_chronowisp');
  assertExists(anchored);
  assertEquals(anchored.stat, 'spd');
  assertEquals(anchored.pct, -0.2);
  assertEquals(anchored.source.kind, 'enemyMove');
  const boss = startBattle('e_chronowisp', vaultBossOrigin, {
    player: roguePlayer(7),
    rng: seeded(3),
  })!;
  assert(boss.opening!.lines.some((l) => l.includes('Chrono Anchor')));

  // Aldric's Sovereign Ward: boss provenance ONLY (#28/#79).
  const plain = startBattle('e_aldric', { kind: 'explore', zoneId: 'crownspire' }, {
    player: roguePlayer(8),
    rng: seeded(3),
  })!;
  assertEquals(plain.opening?.lines.some((l) => l.includes('Sovereign Ward')), false);
  assertEquals(plain.shield.enemy, 0);
  const bossed = startBattle('e_aldric', BOSS_ORIGIN, { player: roguePlayer(9), rng: seeded(3) })!;
  assertEquals(bossed.shield.enemy, 250);
});

Deno.test('#80: battle-lifetime wards never tick down or expire', () => {
  const p = roguePlayer(10);
  const b = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(21) })!;
  const ward = b.effectInstances.find((i) => i.battleLifetime);
  assertExists(ward);
  assertEquals(ward.remaining, 1);
  assertEquals(ward.expiresRound, Number.MAX_SAFE_INTEGER);
  assertEquals(ward.source, { kind: 'item', id: 't_wardstone', name: 'Wardstone Pendant' });
  assertEquals(b.shield.player, 25);
  assertEquals(maxShield(b, 'player'), 25);
  for (let r = 0; r < 5; r++) {
    tickEndOfRound(b, (side) => side === 'player' ? statsOf(p).maxHp : b.enemy.maxHp);
  }
  assertEquals(ward.remaining, 1);
  assertEquals(b.shield.player, 25);
  assert(b.effectInstances.includes(ward));
});

Deno.test('#80: a 99-round opening shield expires at the end of round 99', () => {
  const b = startBattle('e_rat', ORIGIN)!;
  const inst = applyInstance(
    b,
    seedForSpec(
      {
        kind: 'shield',
        target: 'self',
        amount: 50,
        duration: 99,
        timing: 'immediate',
      },
      'test:long',
      'Long Ward',
      'player',
      { kind: 'encounter', id: 'test', name: 'test' },
    ),
  );
  assertEquals(inst.expiresRound, 99);
});

Deno.test('#80: save/load/rerender never rerolls or reapplies the opening', () => {
  const p = roguePlayer(11);
  const b = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(31) })!;
  const before = JSON.stringify(b);
  const restored = JSON.parse(JSON.stringify(b)) as BattleState;
  // The persisted JSON shape round-trips verbatim (JSON drops the live
  // instances' undefined-valued optional fields — saves carry only data).
  assertEquals(JSON.parse(JSON.stringify(restored)), JSON.parse(before));
  // A rerender against the restored battle mutates nothing.
  renderBattle({ ...p, battle: restored });
  assertEquals(JSON.stringify(restored), before);
});

Deno.test('#80/#81: pre-emptive skills render as labeled info rows, never cast buttons', () => {
  const p = roguePlayer(12);
  const b = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(41) })!;
  p.battle = b;
  const menuText = JSON.stringify(renderSkillMenu(p));
  // #81: the activation type is EXPLICIT — a labeled info row, not a cast
  // button (the button label would read “Expose Weakness — 6 MP”).
  assert(menuText.includes('⚡ Expose Weakness'), 'labeled info row present');
  assert(!menuText.includes('Expose Weakness — 6 MP'), 'no cast button');
  const res = performAction(p, b, { kind: 'skill', skillId: 'sk_expose_weakness' }, seeded(1));
  assertEquals(res.consumedTurn, false);
  assert(res.lines.join(' ').includes('battle opens'));
});

Deno.test('#80: tutorial provenance suppresses openings at construction', () => {
  const p = roguePlayer(13);
  const b = startBattle('e_cinder_mite', ORIGIN, {
    player: p,
    rng: seeded(51),
    tutorial: true,
  })!;
  assertEquals(b.opening, undefined);
  assertEquals(b.effectInstances.length, 0);
  assertEquals(b.shield.player, 0);
  assertEquals(b.tutorial, true);
  assertEquals(b.tutorialStep, 'basic');
});

Deno.test('#80: the opening renders expanded on round 1, collapsed thereafter', () => {
  const p = roguePlayer(14);
  const b = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(61) })!;
  p.battle = b;
  const fresh = JSON.stringify(renderBattle(p));
  assert(fresh.includes('Battle opening'));
  assert(fresh.includes('Wardstone'));
  assert(fresh.includes('"is_open":true'));
  // One full round later the panel remains available — collapsed.
  performAction(p, b, { kind: 'guard' }, seeded(62));
  const later = JSON.stringify(renderBattle(p));
  assert(later.includes('Battle opening'));
  assert(!later.includes('"is_open":true'));
});
