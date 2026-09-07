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
import { injectMod, seeded, withOverridden } from './helpers.ts';

const ORIGIN = { kind: 'explore', zoneId: 'outskirts' } as const;

function hero(id: number, classId: ClassId, level: number, trinket?: string): PlayerState {
  const player = createPlayer(id, 'T', classId);
  player.level = level;
  if (trinket) player.equipment.trinket = trinket;
  return player;
}

function fight(enemyId: string, player: PlayerState, seed: number): BattleState {
  const battle = startBattle(enemyId, ORIGIN, { player, rng: seeded(seed) })!.battle;
  player.battle = battle;
  return battle;
}

function round(
  player: PlayerState,
  battle: BattleState,
  seed: number,
  action: PlayerAction = { kind: 'attack' },
) {
  return performAction(player, battle, action, seeded(seed));
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
  const player = lines.findIndex((line) => line.includes('hits') || line.includes('sears'));
  const enemy = lines.findIndex((line) => line.includes('💥'));
  return player >= 0 && enemy >= 0 ? { player, enemy } : undefined;
}

Deno.test('#86: effective SPD decides who acts first — both directions', () => {
  // Fast player: the enemy is slowed to its floor.
  let fast: { player: number; enemy: number } | undefined;
  for (let seed = 1; seed <= 200 && !fast; seed++) {
    const player = hero(2000 + seed, 'warrior', 10);
    const battle = fight('e_rat', player, seed);
    battle.enemy.hp = 99999; // survive the round so both actions are visible
    injectMod(battle, 'enemy', 'spd', -0.95);
    fast = orderOf(round(player, battle, seed).lines);
  }
  assertExists(fast, 'a comparable fast-player seed exists');
  assert(fast.player < fast.enemy, `fast player acts first (${fast.player} vs ${fast.enemy})`);

  // Slow player: the same hero sprinting is all the enemy needs.
  let slow: { player: number; enemy: number } | undefined;
  for (let seed = 1; seed <= 200 && !slow; seed++) {
    const player = hero(2300 + seed, 'warrior', 10);
    const battle = fight('e_rat', player, seed);
    battle.enemy.hp = 99999; // survive the round so both actions are visible
    injectMod(battle, 'player', 'spd', -0.95);
    slow = orderOf(round(player, battle, seed).lines);
  }
  assertExists(slow, 'a comparable slow-player seed exists');
  assert(slow.enemy < slow.player, `slow player acts second (${slow.enemy} vs ${slow.player})`);
});

Deno.test('#86: equal SPD is a documented tie — the player takes slot 1', () => {
  let seen: { player: number; enemy: number } | undefined;
  for (let seed = 1; seed <= 200 && !seen; seed++) {
    const player = hero(2600 + seed, 'warrior', 10);
    const battle = fight('e_rat', player, seed);
    battle.enemy.hp = 99999; // survive the round so both actions are visible
    // Floor BOTH sides to effective SPD 1 → guaranteed tie.
    injectMod(battle, 'player', 'spd', -0.95);
    injectMod(battle, 'enemy', 'spd', -0.95);
    seen = orderOf(round(player, battle, seed).lines);
  }
  assertExists(seen, 'a comparable tie seed exists');
  assert(seen.player < seen.enemy, `ties keep the player first (${seen.player} vs ${seen.enemy})`);
});

Deno.test('#86: a faster player’s lethal hit skips the enemy slot and ALL end-of-round work', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const player = hero(2900 + seed, 'warrior', 30);
    const battle = fight('e_rat', player, seed);
    injectMod(battle, 'enemy', 'spd', -0.95); // player first, guaranteed
    battle.enemy.hp = 5; // one-shot territory
    // A round-end DoT on the winner must never tick this round.
    const dot = applyInstance(battle, periodicSeed('dot_a', 'player', -3, 'roundEnd'));
    const hpBefore = player.hp;
    const res = round(player, battle, seed);
    assertEquals(res.outcome, 'victory');
    assertEquals(player.hp, hpBefore, 'the winner’s DoT never ticked');
    assertEquals(battle.round, 1, 'no end-of-round ran — the round counter never advanced');
    assertEquals(dot.instance.remaining, 9, 'bookkeeping (expiry) never ran');
    assertEquals(battle.history.length, 1, 'the terminal round is recorded exactly once');
    assert(!res.lines.some((line) => line.includes('💥')), 'the enemy never acted');
    return;
  }
  throw new AssertionError('no lethal seed found');
});

Deno.test('#86: a faster enemy’s kill stops the queued action’s resource costs', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const player = hero(3200 + seed, 'cleric', 5);
    player.mp = 100;
    player.inventory.push({ id: 'c_minor_potion', qty: 1 });
    const potionsBefore = player.inventory.find((entry) => entry.id === 'c_minor_potion')?.qty ?? 0;
    const battle = fight('e_rat', player, seed);
    injectMod(battle, 'enemy', 'spd', 0.95); // enemy first, guaranteed
    injectMod(battle, 'enemy', 'atk', 19.5); // one lethal swing
    const res = round(player, battle, seed, { kind: 'skill', skillId: 'sk_mend' });
    if (res.outcome !== 'defeat') continue;
    assertEquals(player.mp, 100, 'MP never charged — the player never reached their slot');
    assertEquals(battle.cooldowns['sk_mend'] ?? 0, 0, 'cooldown never began');
    assertEquals(
      player.inventory.find((entry) => entry.id === 'c_minor_potion')?.qty,
      potionsBefore,
      'queued item never consumed',
    );
    assert(res.lines.some((line) => line.includes('💥')), 'the enemy acted in slot 1');
    assert(!res.lines.some((line) => line.includes('💚')), 'the heal never happened');
    assert(battle.enemy.hp > 0, 'no mutual-KO ambiguity — the enemy stands alone');
    assertEquals(battle.history.length, 1, 'the terminal round is recorded exactly once');
    return;
  }
  throw new AssertionError('no lethal enemy seed found');
});

Deno.test('#86: a lethal turn-start tick prevents the player action', () => {
  const player = hero(3500, 'warrior', 10);
  player.hp = 2;
  player.skills.push('sk_sunder_armor');
  player.mp = 100;
  const battle = fight('e_rat', player, 42);
  injectMod(battle, 'enemy', 'spd', -0.95); // player slot first
  applyInstance(battle, periodicSeed('dot_ts', 'player', -5, 'playerTurnStart'));
  const res = round(player, battle, 42, { kind: 'skill', skillId: 'sk_sunder_armor' });
  assertEquals(res.outcome, 'defeat');
  assertEquals(player.hp, 0);
  assertEquals(player.mp, 100, 'the skill never charged');
  assertEquals(battle.enemy.turn, 0, 'the enemy slot never ran');
  assertEquals(battle.history.length, 1, 'the terminal round is recorded exactly once');
  assert(!res.lines.some((line) => line.includes('Sunder Armor')));
});

Deno.test('#86: a lethal action stops its later ordered riders', () => {
  const player = hero(3600, 'warrior', 20);
  player.skills.push('sk_sunder_armor');
  player.mp = 100;
  const battle = fight('e_rat', player, 7);
  battle.enemy.hp = 3;
  injectMod(battle, 'enemy', 'spd', -0.95); // player first
  const res = round(player, battle, 7, { kind: 'skill', skillId: 'sk_sunder_armor' });
  assertEquals(res.outcome, 'victory');
  assert(
    res.lines.some((line) => line.includes('Sunder Armor')),
    'the strike itself resolved',
  );
  assertEquals(
    battle.effectInstances.some((instance) =>
      instance.side === 'enemy' && instance.name === 'Sundered'
    ),
    false,
    'the Armor Break rider never landed after the killing blow',
  );
});

Deno.test('#86: a lethal round-end tick stops later ticks and bookkeeping', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const player = hero(3700 + seed, 'warrior', 20);
    const battle = fight('e_rat', player, seed);
    battle.enemy.hp = 99999; // both slots must complete so the round-end phase runs
    applyInstance(battle, periodicSeed('dot_a', 'player', -500, 'roundEnd'));
    const dotB = applyInstance(battle, periodicSeed('dot_b', 'player', -1, 'roundEnd'));
    battle.cooldowns['sk_sunder_armor'] = 2;
    const res = round(player, battle, seed);
    assertEquals(res.outcome, 'defeat');
    assertEquals(player.hp, 0);
    assertEquals(dotB.instance.remaining, 9, 'the later tick never ran — and never decayed');
    assert(
      battle.effectInstances.includes(dotB.instance),
      'the surviving instance was never pruned',
    );
    assertEquals(battle.cooldowns['sk_sunder_armor'] ?? 0, 2, 'cooldown decay never ran');
    return;
  }
  throw new AssertionError('no completed-slot seed found');
});

Deno.test('#86: end-of-round Regen can never revive a defeated actor', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const player = hero(4000 + seed, 'cleric', 5);
    const battle = fight('e_rat', player, seed);
    injectMod(battle, 'enemy', 'spd', 0.95); // enemy first
    injectMod(battle, 'enemy', 'atk', 19.5); // lethal
    const hot = applyInstance(battle, periodicSeed('renew_test', 'player', 14, 'roundEnd'));
    const res = round(player, battle, seed);
    if (res.outcome !== 'defeat') continue;
    assertEquals(player.hp, 0, 'the HoT never revived the fallen');
    assertEquals(hot.instance.remaining, 9, 'the HoT never ticked at all');
    assert(!res.lines.some((line) => line.includes('💚')));
    return;
  }
  throw new AssertionError('no lethal enemy seed found');
});

Deno.test('#86: no DoT can kill the winner after the loser reached 0 HP', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const player = hero(4300 + seed, 'warrior', 30);
    const battle = fight('e_rat', player, seed);
    injectMod(battle, 'enemy', 'spd', -0.95); // player first — the loser dies first
    applyInstance(battle, periodicSeed('dot_kill', 'player', -500, 'roundEnd'));
    battle.enemy.hp = 5;
    const hpBefore = player.hp;
    const res = round(player, battle, seed);
    if (res.outcome === 'victory') {
      assertEquals(player.hp, hpBefore, 'the winner outlived the terminal transition');
      return;
    }
  }
  throw new AssertionError('no lethal seed found');
});

Deno.test('#86: an opening SPD debuff flips round-1 initiative', () => {
  const wisp = enemy('e_chronowisp');
  assertExists(wisp);
  const wispSpeed = wisp.spd;
  // A hero naturally FASTER than the wisp whose anchored SPD (−20%) is not.
  let plan: { classId: ClassId; level: number } | undefined;
  outer:
  for (const classId of CLASS_IDS) {
    for (let level = 1; level <= 45; level++) {
      const probe = hero(1, classId, level);
      const playerSpeed = statsOf(probe).spd;
      if (playerSpeed >= wispSpeed && Math.max(1, Math.round(playerSpeed * 0.8)) < wispSpeed) {
        plan = { classId, level };
        break outer;
      }
    }
  }
  assertExists(plan, 'a class/level pair exists around the anchor threshold');
  const player = hero(4500, plan.classId, plan.level);
  const battle = fight('e_chronowisp', player, 3); // the opening applies Chrono Anchor
  const anchor = battle.effectInstances.find((instance) =>
    instance.side === 'player' && instance.stat === 'spd'
  );
  assertExists(anchor, 'the opening landed its SPD debuff');
  assert(
    statsOf(player).spd >= wispSpeed,
    'control: without the opening the hero out-sprints the wisp',
  );
  assert(
    effectivePlayerSpd(player, battle) < effectiveEnemySpd(battle),
    'the opening flipped the initiative inputs',
  );
  let saw = false;
  for (let seed = 1; seed <= 200 && !saw; seed++) {
    const p2 = hero(4600 + seed, plan.classId, plan.level);
    const b2 = fight('e_chronowisp', p2, seed);
    const ord = orderOf(round(p2, b2, seed).lines);
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
  for (let seed = 1; seed <= 100 && !persisted; seed++) {
    const player = hero(4900 + seed, 'warrior', 10);
    const battle = fight('e_rat', player, seed);
    injectMod(battle, 'player', 'spd', -0.95);
    const res = round(player, battle, seed, { kind: 'guard' });
    if (res.lines.some((line) => line.includes('brace behind'))) {
      assertEquals(battle.guarding, true, 'the brace survives an enemy-first round');
      const res2 = round(player, battle, seed + 900);
      assert(res2.lines.some((line) => line.includes('💥')), 'the enemy acted in round 2');
      assertEquals(battle.guarding, false, 'the brace covered exactly that action');
      persisted = true;
    }
  }
  assert(persisted, 'an enemy-first guard seed exists');
  // Player-first: the very next enemy action consumes it inside the round.
  let consumed = false;
  for (let seed = 1; seed <= 100 && !consumed; seed++) {
    const player = hero(5200 + seed, 'warrior', 10);
    const battle = fight('e_rat', player, seed);
    injectMod(battle, 'enemy', 'spd', -0.95);
    const res = round(player, battle, seed, { kind: 'guard' });
    if (res.lines.some((line) => line.includes('brace behind'))) {
      assertEquals(battle.guarding, false, 'the immediate enemy response was covered');
      consumed = true;
    }
  }
  assert(consumed, 'a player-first guard seed exists');
});

Deno.test('#86: flee reports the fled outcome through the shared authority', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const player = hero(5500 + seed, 'rogue', 10);
    const battle = fight('e_rat', player, seed);
    const res = round(player, battle, seed, { kind: 'flee' });
    if (battle.phase === 'fled') {
      assertEquals(res.outcome, 'fled');
      assertEquals(res.consumedTurn, true);
      return;
    }
  }
  throw new AssertionError('no successful flee seed found');
});

Deno.test('#86: an invalid command consumes no round and ticks nothing', () => {
  const player = hero(5800, 'warrior', 10); // sk_whirlwind is level 13 — not learned
  const battle = fight('e_rat', player, 5);
  applyInstance(battle, periodicSeed('dot_inv', 'player', -3, 'playerTurnStart'));
  const hpBefore = player.hp;
  const res = round(player, battle, 5, { kind: 'skill', skillId: 'sk_whirlwind' });
  assertEquals(res.consumedTurn, false);
  assertEquals(res.outcome, 'ongoing');
  assertEquals(player.hp, hpBefore, 'turn-start effects never ran for an invalid command');
  assertEquals(battle.history.length, 0, 'no round was recorded');
  assertEquals(battle.round, 1);
});

// ── #94: SPD effects are measured in initiative snapshots ────────────────

Deno.test('#94: Smoke Step covers three snapshots — faster OR slower caster', () => {
  for (const fasterCaster of [true, false]) {
    let seen = false;
    for (let seed = 1; seed <= 200 && !seen; seed++) {
      const player = hero(5000 + seed, 'rogue', 9);
      player.skills.push('sk_smoke_step');
      player.mp = 999;
      const battle = fight('e_rat', player, seed);
      battle.enemy.hp = 99999; // outlive the observation window
      if (fasterCaster) injectMod(battle, 'enemy', 'spd', -0.95);
      else injectMod(battle, 'player', 'spd', -0.95);
      const ord = orderOf(round(player, battle, seed).lines);
      if (!ord) continue;
      if ((ord.player < ord.enemy) !== fasterCaster) continue;
      seen = true;
      // The rogue then casts Smoke Step mid-round — AFTER this round's
      // snapshot. (Attack action next to the cast keeps rng draws sane.)
      const castRound = battle.round;
      round(player, battle, seed + 1, { kind: 'skill', skillId: 'sk_smoke_step' });
      const inst = battle.effectInstances.find((instance) =>
        instance.defId === 'sk_smoke_step:e0'
      )!;
      // The cast round's own bookkeeping consumed the defer marker
      // WITHOUT ticking — remaining is untouched: no unit was spent on the
      // already-decided snapshot (#94).
      assertEquals(inst.remaining, 3, 'the cast round spent no initiative unit');
      assertEquals(inst.expiresRound, castRound + 3, 'one snapshot per advertised turn');
      // Three further rounds: 3 → 2 → 1 → 0 — exactly the foe's next
      // three moves face the haste, whichever side was faster at cast.
      for (let roundOffset = 0; roundOffset < 3; roundOffset++) {
        round(player, battle, seed + 10 + roundOffset);
        const left = battle.effectInstances.find((i2) => i2.defId === 'sk_smoke_step:e0');
        assertEquals(
          left?.remaining ?? 0,
          2 - roundOffset,
          `snapshot ${roundOffset + 1} consumed one unit`,
        );
      }
      assertEquals(
        battle.effectInstances.some((i2) => i2.defId === 'sk_smoke_step:e0'),
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
    for (let seed = 1; seed <= 200 && !seen; seed++) {
      const player = hero(5400 + seed, 'rogue', 9);
      player.skills.push('sk_crippling_cut');
      player.mp = 999;
      const battle = fight('e_rat', player, seed);
      battle.enemy.hp = 99999;
      if (fasterCaster) injectMod(battle, 'player', 'spd', 5);
      else injectMod(battle, 'enemy', 'spd', 5);
      const ord = orderOf(round(player, battle, seed).lines);
      if (!ord) continue;
      if ((ord.player < ord.enemy) !== fasterCaster) continue;
      seen = true;
      const castRound = battle.round;
      round(player, battle, seed + 1, { kind: 'skill', skillId: 'sk_crippling_cut' });
      const inst = battle.effectInstances.find((instance) =>
        instance.defId === 'sk_crippling_cut:e1'
      )!;
      assertEquals(inst.remaining, 2, 'the cast round spent no initiative unit (#94)');
      assertEquals(inst.expiresRound, castRound + 2);
      for (let roundOffset = 0; roundOffset < 2; roundOffset++) {
        round(player, battle, seed + 10 + roundOffset);
        const left = battle.effectInstances.find((i2) => i2.defId === 'sk_crippling_cut:e1');
        assertEquals(left?.remaining ?? 0, 1 - roundOffset, `slowed snapshot ${roundOffset + 1}`);
      }
      assertEquals(battle.effectInstances.some((i2) => i2.defId === 'sk_crippling_cut:e1'), false);
    }
    assert(seen, `a ${fasterCaster ? 'faster' : 'slower'}-rogue seed exists`);
  }
});

Deno.test('#94: opening SPD effects keep authored timing — the Chrono Anchor covers round 1', () => {
  // The wisp's Chrono Anchor fires in the OPENING (before round 1's
  // snapshot), so round 1 spends a unit: rounds 1..2 for its 2 turns.
  const player = hero(5700, 'warrior', 19);
  const battle = fight('e_chronowisp', player, 7);
  const anchor = battle.effectInstances.find((instance) => instance.name === 'Chrono Anchor')!;
  assertEquals(anchor.side, 'player');
  assertEquals(anchor.deferFirstTick, false, 'opening applications are never deferred');
  assertEquals(anchor.expiresRound, 2, 'round 1 counts — rounds 1..2');
  assertEquals(anchor.remaining, 2);
});

Deno.test('#94: refreshing a mid-round SPD buff re-banks its full snapshot count', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const player = hero(5800 + seed, 'rogue', 9);
    player.skills.push('sk_smoke_step');
    player.mp = 999;
    const battle = fight('e_rat', player, seed);
    battle.enemy.hp = 99999;
    round(player, battle, seed, { kind: 'skill', skillId: 'sk_smoke_step' }); // cast round 1
    delete battle.cooldowns['sk_smoke_step'];
    round(player, battle, seed + 1, { kind: 'skill', skillId: 'sk_smoke_step' }); // recast round 2
    const inst = battle.effectInstances.find((instance) => instance.defId === 'sk_smoke_step:e0')!;
    assertEquals(inst.remaining, 3, 'refresh rebuilt the clock from the recast round');
    assertEquals(inst.expiresRound, 2 + 3, 'three fresh snapshots from round 3');
    return;
  }
  throw new AssertionError('no usable seed');
});

// ── #107: timing provenance survives nested reactions ─────────────────────

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
  }];
  try {
    run();
  } finally {
    charm.triggers = original;
  }
}

/** The instanced haste, when present. */
function secondWind(battle: BattleState): EffectInstance | undefined {
  return battle.effectInstances.find((instance) => instance.name === 'Second Wind');
}

Deno.test('#107: an opening strike’s reactive haste covers rounds 1–2 — never deferred', () => {
  const rat = enemy('e_rat')!;
  withOverridden(rat, 'opening', {
    name: 'Probe Strike',
    effects: [{ kind: 'damage', attack: 'phys', power: 1 }],
  }, () => {
    hasteGrudge(() => {
      for (let seed = 1; seed <= 100; seed++) {
        const player = hero(7100, 'warrior', 1, 't_19');
        const battle = fight('e_rat', player, seed);
        if (!secondWind(battle)) continue; // the strike slipped (2% dodge) — next seed
        battle.enemy.hp = 99999;
        battle.enemy.maxHp = 99999;
        // Base ordering: the sprinted rat is faster — the haste must FLIP it.
        injectMod(battle, 'enemy', 'spd', 0.5);
        assert(
          effectivePlayerSpd(player, battle) > effectiveEnemySpd(battle),
          'the opening reaction’s haste is live for round 1’s snapshot',
        );
        const inst = secondWind(battle)!;
        assertEquals(inst.deferFirstTick, false, 'opening reactions are pre-snapshot (#94)');
        assertEquals(inst.remaining, 2);
        assertEquals(inst.expiresRound, 2, 'exactly rounds 1..2 for its 2 turns');
        // Round 1 consumes the first unit; round 2 stays hastened.
        round(player, battle, seed);
        assertEquals(secondWind(battle)?.remaining, 1, 'round 1 spent one snapshot unit');
        assert(
          effectivePlayerSpd(player, battle) > effectiveEnemySpd(battle),
          'round 2’s ordering is still flipped',
        );
        // Round 2 consumes the last unit; round 3 is back to base ordering.
        round(player, battle, seed + 1);
        assertEquals(secondWind(battle), undefined, 'expired exactly after round 2');
        assert(
          effectivePlayerSpd(player, battle) < effectiveEnemySpd(battle),
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
    for (let seed = 1; seed <= 100; seed++) {
      const player = hero(7100, 'warrior', 1, 't_19');
      const battle = fight('e_rat', player, seed);
      battle.enemy.hp = 99999;
      battle.enemy.maxHp = 99999;
      // Base ordering: the sprinted rat acts first in round 1 — the haste
      // this round CANNOT retroactively change that decided snapshot.
      injectMod(battle, 'enemy', 'spd', 0.5);
      round(player, battle, seed);
      const inst = secondWind(battle);
      if (!inst) continue; // the bite slipped — next seed
      // e_rat has no opening and no guard was used: the haste could only
      // have been applied by the enemy-action HP-loss reaction, mid-round.
      assertEquals(battle.opening, undefined, 'no opening source exists — the proc is mid-round');
      // The DEFER marker itself is consumed by the proc round's own
      // end-of-round bookkeeping; the observable contract is the clock:
      // the proc round spent no unit (remaining 2) and the two advertised
      // turns cover the NEXT two snapshots — expiresRound 3, not 2 (#94).
      assertEquals(inst.remaining, 2, 'the proc round spent no initiative unit (#94)');
      assertEquals(inst.expiresRound, 3, 'covers exactly the NEXT two snapshots: rounds 2..3');
      // Round 2: the deferred haste covers its first snapshot.
      round(player, battle, seed + 1);
      assertEquals(secondWind(battle)?.remaining, 1, 'round 2 spent one snapshot unit');
      assert(
        effectivePlayerSpd(player, battle) > effectiveEnemySpd(battle),
        'round 2’s ordering flipped',
      );
      // Round 3: the last snapshot; round 4 is back to base.
      round(player, battle, seed + 2);
      assertEquals(secondWind(battle), undefined, 'expired exactly after round 3');
      assert(
        effectivePlayerSpd(player, battle) < effectiveEnemySpd(battle),
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
  for (let seed = 1; seed <= 200; seed++) {
    const player = hero(7100, 'warrior', 25, 't_14');
    const battle = fight('e_rat', player, seed);
    const inst = battle.effectInstances.find((instance) => instance.defId === 't_14:t0:e0');
    if (!inst) continue; // the 50% roll missed — next seed
    assertEquals(inst.deferFirstTick, false, 'nested opening applications are pre-snapshot');
    assertEquals(inst.remaining, 2);
    assertEquals(inst.expiresRound, 2, 'rounds 1..2 for its 2 advertised turns');
    assertEquals(inst.side, 'enemy');
    return;
  }
  throw new AssertionError('no success seed for the battleStart proc');
});
