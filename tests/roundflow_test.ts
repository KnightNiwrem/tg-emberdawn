/** #86 round state machine — SPD-ordered slots and immediate terminal
 * resolution: the faster effective SPD acts first (ties keep the historical
 * player-first rule), the first 0-HP transition ends the round (the
 * defeated actor never acts, no riders/procs follow, no end-of-round work
 * runs, nothing revives), and the engine returns ONE explicit outcome that
 * handlers, the harness and the tutorial all consume. */

import { assert, assertEquals, assertExists, AssertionError } from '@std/assert';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import {
  effectiveEnemySpd,
  effectivePlayerSpd,
  performAction,
  type PlayerAction,
  startBattle,
} from '../src/engine/combat.ts';
import { applyInstance, type InstanceSeed } from '../src/engine/effects.ts';
import type { BattleState, ClassId, EffectInstance, PlayerState } from '../src/engine/types.ts';
import { CLASS_IDS } from '../src/engine/types.ts';
import { enemy } from '../src/content/enemies.ts';
import { item } from '../src/content/items.ts';
import { injectMod, seeded } from './helpers.ts';

const ORIGIN = { kind: 'explore', zoneId: 'outskirts' } as const;

function hero(id: number, classId: ClassId, level: number, trinket?: string): PlayerState {
  const p = createPlayer(id, 'T', classId);
  p.level = level;
  if (trinket) p.equipment.trinket = trinket;
  return p;
}

function fight(enemyId: string, p: PlayerState, seed: number): BattleState {
  const b = startBattle(enemyId, ORIGIN, { player: p, rng: seeded(seed) })!.battle;
  p.battle = b;
  return b;
}

function round(
  p: PlayerState,
  b: BattleState,
  seed: number,
  action: PlayerAction = { kind: 'attack' },
) {
  return performAction(p, b, action, seeded(seed));
}

function periodicSeed(
  defId: string,
  side: 'player' | 'enemy',
  perRound: number,
  phase: 'roundEnd' | 'playerTurnStart',
): InstanceSeed {
  return {
    defId,
    name: 'Test Rot',
    kind: 'periodic',
    side,
    source: { kind: 'skill', id: 'test', name: 'test fixture' },
    perRound,
    tickPhase: phase,
    tags: perRound < 0 ? ['harmful'] : ['beneficial'],
    stacking: 'replace',
    duration: 9,
    timing: 'immediate',
    removable: true,
  };
}

/** First index of the player's damage line and the enemy's damage line —
 * both present means the round shows a comparable action order. */
function orderOf(lines: string[]): { player: number; enemy: number } | undefined {
  const player = lines.findIndex((l) => l.includes('hits') || l.includes('sears'));
  const enemy = lines.findIndex((l) => l.includes('💥'));
  return player >= 0 && enemy >= 0 ? { player, enemy } : undefined;
}

Deno.test('#86: effective SPD decides who acts first — both directions', () => {
  // Fast player: the enemy is slowed to its floor.
  let fast: { player: number; enemy: number } | undefined;
  for (let s = 1; s <= 200 && !fast; s++) {
    const p = hero(2000 + s, 'warrior', 10);
    const b = fight('e_rat', p, s);
    b.enemy.hp = 99999; // survive the round so both actions are visible
    injectMod(b, 'enemy', 'spd', -0.95);
    fast = orderOf(round(p, b, s).lines);
  }
  assertExists(fast, 'a comparable fast-player seed exists');
  assert(fast.player < fast.enemy, `fast player acts first (${fast.player} vs ${fast.enemy})`);

  // Slow player: the same hero sprinting is all the enemy needs.
  let slow: { player: number; enemy: number } | undefined;
  for (let s = 1; s <= 200 && !slow; s++) {
    const p = hero(2300 + s, 'warrior', 10);
    const b = fight('e_rat', p, s);
    b.enemy.hp = 99999; // survive the round so both actions are visible
    injectMod(b, 'player', 'spd', -0.95);
    slow = orderOf(round(p, b, s).lines);
  }
  assertExists(slow, 'a comparable slow-player seed exists');
  assert(slow.enemy < slow.player, `slow player acts second (${slow.enemy} vs ${slow.player})`);
});

Deno.test('#86: equal SPD is a documented tie — the player takes slot 1', () => {
  let seen: { player: number; enemy: number } | undefined;
  for (let s = 1; s <= 200 && !seen; s++) {
    const p = hero(2600 + s, 'warrior', 10);
    const b = fight('e_rat', p, s);
    b.enemy.hp = 99999; // survive the round so both actions are visible
    // Floor BOTH sides to effective SPD 1 → guaranteed tie.
    injectMod(b, 'player', 'spd', -0.95);
    injectMod(b, 'enemy', 'spd', -0.95);
    seen = orderOf(round(p, b, s).lines);
  }
  assertExists(seen, 'a comparable tie seed exists');
  assert(seen.player < seen.enemy, `ties keep the player first (${seen.player} vs ${seen.enemy})`);
});

Deno.test('#86: a faster player’s lethal hit skips the enemy slot and ALL end-of-round work', () => {
  for (let s = 1; s <= 100; s++) {
    const p = hero(2900 + s, 'warrior', 30);
    const b = fight('e_rat', p, s);
    injectMod(b, 'enemy', 'spd', -0.95); // player first, guaranteed
    b.enemy.hp = 5; // one-shot territory
    // A round-end DoT on the winner must never tick this round.
    const dot = applyInstance(b, periodicSeed('dot_a', 'player', -3, 'roundEnd'));
    const hpBefore = p.hp;
    const res = round(p, b, s);
    assertEquals(res.outcome, 'victory');
    assertEquals(p.hp, hpBefore, 'the winner’s DoT never ticked');
    assertEquals(b.round, 1, 'no end-of-round ran — the round counter never advanced');
    assertEquals(dot.instance.remaining, 9, 'bookkeeping (expiry) never ran');
    assertEquals(b.history.length, 1, 'the terminal round is recorded exactly once');
    assert(!res.lines.some((l) => l.includes('💥')), 'the enemy never acted');
    return;
  }
  throw new AssertionError('no lethal seed found');
});

Deno.test('#86: a faster enemy’s kill stops the queued action’s resource costs', () => {
  for (let s = 1; s <= 200; s++) {
    const p = hero(3200 + s, 'cleric', 5);
    p.mp = 100;
    p.inventory.push({ id: 'c_minor_potion', qty: 1 });
    const potionsBefore = p.inventory.find((e) => e.id === 'c_minor_potion')?.qty ?? 0;
    const b = fight('e_rat', p, s);
    injectMod(b, 'enemy', 'spd', 0.95); // enemy first, guaranteed
    injectMod(b, 'enemy', 'atk', 19.5); // one lethal swing
    const res = round(p, b, s, { kind: 'skill', skillId: 'sk_mend' });
    if (res.outcome !== 'defeat') continue;
    assertEquals(p.mp, 100, 'MP never charged — the player never reached their slot');
    assertEquals(b.cooldowns['sk_mend'] ?? 0, 0, 'cooldown never began');
    assertEquals(
      p.inventory.find((e) => e.id === 'c_minor_potion')?.qty,
      potionsBefore,
      'queued item never consumed',
    );
    assert(res.lines.some((l) => l.includes('💥')), 'the enemy acted in slot 1');
    assert(!res.lines.some((l) => l.includes('💚')), 'the heal never happened');
    assert(b.enemy.hp > 0, 'no mutual-KO ambiguity — the enemy stands alone');
    assertEquals(b.history.length, 1, 'the terminal round is recorded exactly once');
    return;
  }
  throw new AssertionError('no lethal enemy seed found');
});

Deno.test('#86: a lethal turn-start tick prevents the player action', () => {
  const p = hero(3500, 'warrior', 10);
  p.hp = 2;
  p.skills.push('sk_sunder_armor');
  p.mp = 100;
  const b = fight('e_rat', p, 42);
  injectMod(b, 'enemy', 'spd', -0.95); // player slot first
  applyInstance(b, periodicSeed('dot_ts', 'player', -5, 'playerTurnStart'));
  const res = round(p, b, 42, { kind: 'skill', skillId: 'sk_sunder_armor' });
  assertEquals(res.outcome, 'defeat');
  assertEquals(p.hp, 0);
  assertEquals(p.mp, 100, 'the skill never charged');
  assertEquals(b.enemy.turn, 0, 'the enemy slot never ran');
  assertEquals(b.history.length, 1, 'the terminal round is recorded exactly once');
  assert(!res.lines.some((l) => l.includes('Sunder Armor')));
});

Deno.test('#86: a lethal action stops its later ordered riders', () => {
  const p = hero(3600, 'warrior', 20);
  p.skills.push('sk_sunder_armor');
  p.mp = 100;
  const b = fight('e_rat', p, 7);
  b.enemy.hp = 3;
  injectMod(b, 'enemy', 'spd', -0.95); // player first
  const res = round(p, b, 7, { kind: 'skill', skillId: 'sk_sunder_armor' });
  assertEquals(res.outcome, 'victory');
  assert(
    res.lines.some((l) => l.includes('Sunder Armor')),
    'the strike itself resolved',
  );
  assertEquals(
    b.effectInstances.some((i) => i.side === 'enemy' && i.name === 'Sundered'),
    false,
    'the Armor Break rider never landed after the killing blow',
  );
});

Deno.test('#86: a lethal round-end tick stops later ticks and bookkeeping', () => {
  for (let s = 1; s <= 100; s++) {
    const p = hero(3700 + s, 'warrior', 20);
    const b = fight('e_rat', p, s);
    b.enemy.hp = 99999; // both slots must complete so the round-end phase runs
    applyInstance(b, periodicSeed('dot_a', 'player', -500, 'roundEnd'));
    const dotB = applyInstance(b, periodicSeed('dot_b', 'player', -1, 'roundEnd'));
    b.cooldowns['sk_sunder_armor'] = 2;
    const res = round(p, b, s);
    assertEquals(res.outcome, 'defeat');
    assertEquals(p.hp, 0);
    assertEquals(dotB.instance.remaining, 9, 'the later tick never ran — and never decayed');
    assert(b.effectInstances.includes(dotB.instance), 'the surviving instance was never pruned');
    assertEquals(b.cooldowns['sk_sunder_armor'] ?? 0, 2, 'cooldown decay never ran');
    return;
  }
  throw new AssertionError('no completed-slot seed found');
});

Deno.test('#86: end-of-round Regen can never revive a defeated actor', () => {
  for (let s = 1; s <= 200; s++) {
    const p = hero(4000 + s, 'cleric', 5);
    const b = fight('e_rat', p, s);
    injectMod(b, 'enemy', 'spd', 0.95); // enemy first
    injectMod(b, 'enemy', 'atk', 19.5); // lethal
    const hot = applyInstance(b, periodicSeed('renew_test', 'player', 14, 'roundEnd'));
    const res = round(p, b, s);
    if (res.outcome !== 'defeat') continue;
    assertEquals(p.hp, 0, 'the HoT never revived the fallen');
    assertEquals(hot.instance.remaining, 9, 'the HoT never ticked at all');
    assert(!res.lines.some((l) => l.includes('💚')));
    return;
  }
  throw new AssertionError('no lethal enemy seed found');
});

Deno.test('#86: no DoT can kill the winner after the loser reached 0 HP', () => {
  for (let s = 1; s <= 100; s++) {
    const p = hero(4300 + s, 'warrior', 30);
    const b = fight('e_rat', p, s);
    injectMod(b, 'enemy', 'spd', -0.95); // player first — the loser dies first
    applyInstance(b, periodicSeed('dot_kill', 'player', -500, 'roundEnd'));
    b.enemy.hp = 5;
    const hpBefore = p.hp;
    const res = round(p, b, s);
    if (res.outcome === 'victory') {
      assertEquals(p.hp, hpBefore, 'the winner outlived the terminal transition');
      return;
    }
  }
  throw new AssertionError('no lethal seed found');
});

Deno.test('#86: an opening SPD debuff flips round-1 initiative', () => {
  const wisp = enemy('e_chronowisp');
  assertExists(wisp);
  const W = wisp.spd;
  // A hero naturally FASTER than the wisp whose anchored SPD (−20%) is not.
  let plan: { classId: ClassId; level: number } | undefined;
  outer:
  for (const classId of CLASS_IDS) {
    for (let level = 1; level <= 45; level++) {
      const probe = hero(1, classId, level);
      const s = statsOf(probe).spd;
      if (s >= W && Math.max(1, Math.round(s * 0.8)) < W) {
        plan = { classId, level };
        break outer;
      }
    }
  }
  assertExists(plan, 'a class/level pair exists around the anchor threshold');
  const p = hero(4500, plan.classId, plan.level);
  const b = fight('e_chronowisp', p, 3); // the opening applies Chrono Anchor
  const anchor = b.effectInstances.find((i) => i.side === 'player' && i.stat === 'spd');
  assertExists(anchor, 'the opening landed its SPD debuff');
  assert(
    statsOf(p).spd >= W,
    'control: without the opening the hero out-sprints the wisp',
  );
  assert(
    effectivePlayerSpd(p, b) < effectiveEnemySpd(b),
    'the opening flipped the initiative inputs',
  );
  let saw = false;
  for (let s = 1; s <= 200 && !saw; s++) {
    const p2 = hero(4600 + s, plan.classId, plan.level);
    const b2 = fight('e_chronowisp', p2, s);
    const ord = orderOf(round(p2, b2, s).lines);
    if (ord) {
      assert(ord.enemy < ord.player, 'the anchored hero acts after the wisp in round 1');
      saw = true;
    }
  }
  assert(saw, 'a comparable anchored seed exists');
});

Deno.test('#86: the guard brace covers the next enemy action wherever SPD places it', () => {
  // Enemy-first: the brace is raised AFTER the enemy already acted, so it
  // persists into the next round and is consumed by that action.
  let persisted = false;
  for (let s = 1; s <= 100 && !persisted; s++) {
    const p = hero(4900 + s, 'warrior', 10);
    const b = fight('e_rat', p, s);
    injectMod(b, 'player', 'spd', -0.95);
    const res = round(p, b, s, { kind: 'guard' });
    if (res.lines.some((l) => l.includes('brace behind'))) {
      assertEquals(b.guarding, true, 'the brace survives an enemy-first round');
      const res2 = round(p, b, s + 900);
      assert(res2.lines.some((l) => l.includes('💥')), 'the enemy acted in round 2');
      assertEquals(b.guarding, false, 'the brace covered exactly that action');
      persisted = true;
    }
  }
  assert(persisted, 'an enemy-first guard seed exists');
  // Player-first: the very next enemy action consumes it inside the round.
  let consumed = false;
  for (let s = 1; s <= 100 && !consumed; s++) {
    const p = hero(5200 + s, 'warrior', 10);
    const b = fight('e_rat', p, s);
    injectMod(b, 'enemy', 'spd', -0.95);
    const res = round(p, b, s, { kind: 'guard' });
    if (res.lines.some((l) => l.includes('brace behind'))) {
      assertEquals(b.guarding, false, 'the immediate enemy response was covered');
      consumed = true;
    }
  }
  assert(consumed, 'a player-first guard seed exists');
});

Deno.test('#86: flee reports the fled outcome through the shared authority', () => {
  for (let s = 1; s <= 200; s++) {
    const p = hero(5500 + s, 'rogue', 10);
    const b = fight('e_rat', p, s);
    const res = round(p, b, s, { kind: 'flee' });
    if (b.phase === 'fled') {
      assertEquals(res.outcome, 'fled');
      assertEquals(res.consumedTurn, true);
      return;
    }
  }
  throw new AssertionError('no successful flee seed found');
});

Deno.test('#86: an invalid command consumes no round and ticks nothing', () => {
  const p = hero(5800, 'warrior', 10); // sk_whirlwind is level 13 — not learned
  const b = fight('e_rat', p, 5);
  applyInstance(b, periodicSeed('dot_inv', 'player', -3, 'playerTurnStart'));
  const hpBefore = p.hp;
  const res = round(p, b, 5, { kind: 'skill', skillId: 'sk_whirlwind' });
  assertEquals(res.consumedTurn, false);
  assertEquals(res.outcome, 'ongoing');
  assertEquals(p.hp, hpBefore, 'turn-start effects never ran for an invalid command');
  assertEquals(b.history.length, 0, 'no round was recorded');
  assertEquals(b.round, 1);
});

// ── #94: SPD effects are measured in initiative snapshots ────────────────

Deno.test('#94: Smoke Step covers three snapshots — faster OR slower caster', () => {
  for (const fasterCaster of [true, false]) {
    let seen = false;
    for (let s = 1; s <= 200 && !seen; s++) {
      const p = hero(5000 + s, 'rogue', 9);
      p.skills.push('sk_smoke_step');
      p.mp = 999;
      const b = fight('e_rat', p, s);
      b.enemy.hp = 99999; // outlive the observation window
      if (fasterCaster) injectMod(b, 'enemy', 'spd', -0.95);
      else injectMod(b, 'player', 'spd', -0.95);
      const ord = orderOf(round(p, b, s).lines);
      if (!ord) continue;
      if ((ord.player < ord.enemy) !== fasterCaster) continue;
      seen = true;
      // The rogue then casts Smoke Step mid-round — AFTER this round's
      // snapshot. (Attack action next to the cast keeps rng draws sane.)
      const castRound = b.round;
      round(p, b, s + 1, { kind: 'skill', skillId: 'sk_smoke_step' });
      const inst = b.effectInstances.find((i) => i.defId === 'sk_smoke_step:e0')!;
      // The cast round's own bookkeeping consumed the defer marker
      // WITHOUT ticking — remaining is untouched: no unit was spent on the
      // already-decided snapshot (#94).
      assertEquals(inst.remaining, 3, 'the cast round spent no initiative unit');
      assertEquals(inst.expiresRound, castRound + 3, 'one snapshot per advertised turn');
      // Three further rounds: 3 → 2 → 1 → 0 — exactly the foe's next
      // three moves face the haste, whichever side was faster at cast.
      for (let i = 0; i < 3; i++) {
        round(p, b, s + 10 + i);
        const left = b.effectInstances.find((i2) => i2.defId === 'sk_smoke_step:e0');
        assertEquals(left?.remaining ?? 0, 2 - i, `snapshot ${i + 1} consumed one unit`);
      }
      assertEquals(
        b.effectInstances.some((i2) => i2.defId === 'sk_smoke_step:e0'),
        false,
        'expired exactly after its third snapshot',
      );
    }
    assert(seen, `a ${fasterCaster ? 'faster' : 'slower'}-caster seed exists`);
  }
});

Deno.test('#94: Crippling Cut slows two snapshots regardless of application slot', () => {
  for (const fasterCaster of [true, false]) {
    let seen = false;
    for (let s = 1; s <= 200 && !seen; s++) {
      const p = hero(5400 + s, 'rogue', 9);
      p.skills.push('sk_crippling_cut');
      p.mp = 999;
      const b = fight('e_rat', p, s);
      b.enemy.hp = 99999;
      if (fasterCaster) injectMod(b, 'player', 'spd', 5);
      else injectMod(b, 'enemy', 'spd', 5);
      const ord = orderOf(round(p, b, s).lines);
      if (!ord) continue;
      if ((ord.player < ord.enemy) !== fasterCaster) continue;
      seen = true;
      const castRound = b.round;
      round(p, b, s + 1, { kind: 'skill', skillId: 'sk_crippling_cut' });
      const inst = b.effectInstances.find((i) => i.defId === 'sk_crippling_cut:e1')!;
      assertEquals(inst.remaining, 2, 'the cast round spent no initiative unit (#94)');
      assertEquals(inst.expiresRound, castRound + 2);
      for (let i = 0; i < 2; i++) {
        round(p, b, s + 10 + i);
        const left = b.effectInstances.find((i2) => i2.defId === 'sk_crippling_cut:e1');
        assertEquals(left?.remaining ?? 0, 1 - i, `slowed snapshot ${i + 1}`);
      }
      assertEquals(b.effectInstances.some((i2) => i2.defId === 'sk_crippling_cut:e1'), false);
    }
    assert(seen, `a ${fasterCaster ? 'faster' : 'slower'}-rogue seed exists`);
  }
});

Deno.test('#94: opening SPD effects keep authored timing — the Chrono Anchor covers round 1', () => {
  // The wisp's Chrono Anchor fires in the OPENING (before round 1's
  // snapshot), so round 1 spends a unit: rounds 1..2 for its 2 turns.
  const p = hero(5700, 'warrior', 19);
  const b = fight('e_chronowisp', p, 7);
  const anchor = b.effectInstances.find((i) => i.name === 'Chrono Anchor')!;
  assertEquals(anchor.side, 'player');
  assertEquals(anchor.deferFirstTick, false, 'opening applications are never deferred');
  assertEquals(anchor.expiresRound, 2, 'round 1 counts — rounds 1..2');
  assertEquals(anchor.remaining, 2);
});

Deno.test('#94: refreshing a mid-round SPD buff re-banks its full snapshot count', () => {
  for (let s = 1; s <= 100; s++) {
    const p = hero(5800 + s, 'rogue', 9);
    p.skills.push('sk_smoke_step');
    p.mp = 999;
    const b = fight('e_rat', p, s);
    b.enemy.hp = 99999;
    round(p, b, s, { kind: 'skill', skillId: 'sk_smoke_step' }); // cast round 1
    delete b.cooldowns['sk_smoke_step'];
    round(p, b, s + 1, { kind: 'skill', skillId: 'sk_smoke_step' }); // recast round 2
    const inst = b.effectInstances.find((i) => i.defId === 'sk_smoke_step:e0')!;
    assertEquals(inst.remaining, 3, 'refresh rebuilt the clock from the recast round');
    assertEquals(inst.expiresRound, 2 + 3, 'three fresh snapshots from round 3');
    return;
  }
  throw new AssertionError('no usable seed');
});

// ── #107: timing provenance survives nested reactions ─────────────────────

/** Temporarily overrides a content object's field, restoring afterwards. */
function withOverridden<T, K extends keyof T>(
  target: T,
  key: K,
  value: T[K],
  run: () => void,
): void {
  const original = target[key];
  target[key] = value;
  try {
    run();
  } finally {
    target[key] = original;
  }
}

/** The Grudge Charm as a self-SPD trigger: every HP loss to the wearer
 * applies a two-turn haste. The point of the fixture is WHERE the haste
 * lands in the round — its timing must match the HP loss that caused it. */
function hasteGrudge(run: () => void): void {
  const charm = item('t_19')!;
  const original = charm.triggers;
  charm.triggers = [{
    name: 'Second Wind',
    trigger: 'onHpDamage',
    // maxProcs 1: the fixture must observe ONE application's lifetime — a
    // second proc would re-bank a fresh instance and hide the decay story.
    maxProcs: 1,
    effects: [{
      kind: 'statmod',
      target: 'self',
      stat: 'spd',
      pct: 1.0,
      duration: 2,
      timing: 'immediate',
      name: 'Second Wind',
      tags: ['beneficial'],
    }],
    desc: 'test fixture: every HP loss hastens the wearer (2 turns)',
  }];
  try {
    run();
  } finally {
    charm.triggers = original;
  }
}

/** The instanced haste, when present. */
function secondWind(b: BattleState): EffectInstance | undefined {
  return b.effectInstances.find((i) => i.name === 'Second Wind');
}

Deno.test('#107: an opening strike’s reactive haste covers rounds 1–2 — never deferred', () => {
  const rat = enemy('e_rat')!;
  withOverridden(rat, 'opening', {
    name: 'Probe Strike',
    effects: [{ kind: 'damage', attack: 'phys', power: 1 }],
  }, () => {
    hasteGrudge(() => {
      for (let s = 1; s <= 100; s++) {
        const p = hero(7100, 'warrior', 1, 't_19');
        const b = fight('e_rat', p, s);
        if (!secondWind(b)) continue; // the strike slipped (2% dodge) — next seed
        b.enemy.hp = 99999;
        b.enemy.maxHp = 99999;
        // Base ordering: the sprinted rat is faster — the haste must FLIP it.
        injectMod(b, 'enemy', 'spd', 0.5);
        assert(
          effectivePlayerSpd(p, b) > effectiveEnemySpd(b),
          'the opening reaction’s haste is live for round 1’s snapshot',
        );
        const inst = secondWind(b)!;
        assertEquals(inst.deferFirstTick, false, 'opening reactions are pre-snapshot (#94)');
        assertEquals(inst.remaining, 2);
        assertEquals(inst.expiresRound, 2, 'exactly rounds 1..2 for its 2 turns');
        // Round 1 consumes the first unit; round 2 stays hastened.
        round(p, b, s);
        assertEquals(secondWind(b)?.remaining, 1, 'round 1 spent one snapshot unit');
        assert(
          effectivePlayerSpd(p, b) > effectiveEnemySpd(b),
          'round 2’s ordering is still flipped',
        );
        // Round 2 consumes the last unit; round 3 is back to base ordering.
        round(p, b, s + 1);
        assertEquals(secondWind(b), undefined, 'expired exactly after round 2');
        assert(
          effectivePlayerSpd(p, b) < effectiveEnemySpd(b),
          'round 3’s ordering is back to the base — no phantom third snapshot',
        );
        return;
      }
      throw new AssertionError('no seed with a landed opening strike');
    });
  });
});

Deno.test('#107: a mid-round reactive haste defers — covers rounds 2–3, never round 1', () => {
  hasteGrudge(() => {
    for (let s = 1; s <= 100; s++) {
      const p = hero(7100, 'warrior', 1, 't_19');
      const b = fight('e_rat', p, s);
      b.enemy.hp = 99999;
      b.enemy.maxHp = 99999;
      // Base ordering: the sprinted rat acts first in round 1 — the haste
      // this round CANNOT retroactively change that decided snapshot.
      injectMod(b, 'enemy', 'spd', 0.5);
      round(p, b, s);
      const inst = secondWind(b);
      if (!inst) continue; // the bite slipped — next seed
      // e_rat has no opening and no guard was used: the haste could only
      // have been applied by the enemy-action HP-loss reaction, mid-round.
      assertEquals(b.opening, undefined, 'no opening source exists — the proc is mid-round');
      // The DEFER marker itself is consumed by the proc round's own
      // end-of-round bookkeeping; the observable contract is the clock:
      // the proc round spent no unit (remaining 2) and the two advertised
      // turns cover the NEXT two snapshots — expiresRound 3, not 2 (#94).
      assertEquals(inst.remaining, 2, 'the proc round spent no initiative unit (#94)');
      assertEquals(inst.expiresRound, 3, 'covers exactly the NEXT two snapshots: rounds 2..3');
      // Round 2: the deferred haste covers its first snapshot.
      round(p, b, s + 1);
      assertEquals(secondWind(b)?.remaining, 1, 'round 2 spent one snapshot unit');
      assert(effectivePlayerSpd(p, b) > effectiveEnemySpd(b), 'round 2’s ordering flipped');
      // Round 3: the last snapshot; round 4 is back to base.
      round(p, b, s + 2);
      assertEquals(secondWind(b), undefined, 'expired exactly after round 3');
      assert(
        effectivePlayerSpd(p, b) < effectiveEnemySpd(b),
        'round 4’s ordering is back to base — no phantom snapshot',
      );
      return;
    }
    throw new AssertionError('no seed with a landed round-1 bite');
  });
});

Deno.test('#107: a nested battle-start trigger keeps authored timing — pre-snapshot', () => {
  // Hourglass Charm (t_14): 50% chance, at battleStart, to Slow the foe —
  // a trigger proc nested INSIDE the opening phase, not a plain opening
  // move. Its application precedes round 1's snapshot, so it must cover
  // rounds 1..2 with no deferred tick.
  for (let s = 1; s <= 200; s++) {
    const p = hero(7100, 'warrior', 25, 't_14');
    const b = fight('e_rat', p, s);
    const inst = b.effectInstances.find((i) => i.defId === 't_14:t0:e0');
    if (!inst) continue; // the 50% roll missed — next seed
    assertEquals(inst.deferFirstTick, false, 'nested opening applications are pre-snapshot');
    assertEquals(inst.remaining, 2);
    assertEquals(inst.expiresRound, 2, 'rounds 1..2 for its 2 advertised turns');
    assertEquals(inst.side, 'enemy');
    return;
  }
  throw new AssertionError('no success seed for the battleStart proc');
});
