/** #104: direct and periodic lethal damage share ONE synchronous HP-loss
 * transition — trace, then the immediate revival interception, then the
 * terminal stop, then a revived survivor's reactions. Parity is asserted
 * for both families, with and without the Phoenix Cinder, on final HP,
 * `phoenixUsed`, proc counts, trace order, outcome and RNG draw count.
 * #105: the transition also records the revival itself and periodic
 * shield breaks in the caller-owned trace. */

import { assert, assertEquals, assertExists } from '@std/assert';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { grantShield } from '../src/engine/effects.ts';
import type { EffectInstance, PlayerState } from '../src/engine/types.ts';
import type { CombatTraceEntry } from '../src/engine/telemetry.ts';
import type { BattleState, ClassId } from '../src/engine/types.ts';
import { ENEMIES } from '../src/content/enemies.ts';
import { item } from '../src/content/items.ts';
import { addItem } from '../src/engine/inventory.ts';
import { seeded, withOverridden } from './helpers.ts';

const ORIGIN = { kind: 'explore', zoneId: 'outskirts' } as const;

function hero(id: number, classId: ClassId, level: number): PlayerState {
  const player = createPlayer(id, 'T', classId);
  player.level = level;
  return player;
}

/** Padded rat so only the authored lethality decides the fight. */
function tankyRat(player: PlayerState, seed: number): BattleState {
  const battle = startBattle('e_rat', ORIGIN, { player, rng: seeded(seed) })!.battle;
  battle.enemy.hp = 99999;
  battle.enemy.maxHp = 99999;
  player.battle = battle;
  return battle;
}

/** Pads the hero behind an unbreakable ward: earlier enemy swings stay
 * shield-only (no HP loss, no proc), so the bypass-shield lethal tick is
 * the round's ONLY player HP loss. */
function warded(player: PlayerState): void {
  grantShield(player.battle!, 'player', {
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
}

/** One lethal enemy strike through the DIRECT damage family. */
function withDeathBite(run: (player: PlayerState) => void): void {
  const rat = ENEMIES.find((enemyDef) => enemyDef.id === 'e_rat')!;
  withOverridden(rat, 'moves', [{
    name: 'Death Bite',
    weight: 1,
    effects: [{ kind: 'damage', attack: 'phys', power: 9999 }],
  }], () => run(hero(1, 'warrior', 5)));
}

/** A lethal round-end DoT through the PERIODIC family (not dodgeable, not
 * routed through the resolver's damage branch). */
function lethalDoT(battle: BattleState): EffectInstance {
  battle.effectInstances.push({
    iid: 'dot1',
    defId: 'test:lethal',
    name: 'Doom Venom',
    side: 'player',
    source: { kind: 'skill', id: 'test', name: 'test fixture' },
    kind: 'periodic',
    perRound: -999999,
    bypassShield: true,
    tickPhase: 'roundEnd',
    tags: ['harmful', 'periodic', 'poison'],
    stacking: 'replace',
    appliedRound: battle.round,
    remaining: 3,
    removable: true,
    expiresRound: battle.round + 2,
  });
  return battle.effectInstances[battle.effectInstances.length - 1]!;
}

/** The Grudge Charm's broad onHpDamage trigger, deterministic: always procs,
 * unlimited, no cooldown (fixture from #97's suite). */
function ungatedGrudge(run: (player: PlayerState) => void): void {
  const charm = item('t_19')!;
  const original = charm.triggers;
  charm.triggers = [{
    name: 'Grudge Prick',
    trigger: 'onHpDamage',
    effects: [{
      kind: 'periodic',
      target: 'opponent',
      perRound: -3,
      duration: 2,
      tickPhase: 'roundEnd',
      name: 'Grudge Bleed',
      tags: ['bleed', 'harmful'],
    }],
  }];
  try {
    const player = hero(2, 'warrior', 5);
    player.equipment.trinket = 't_19';
    run(player);
  } finally {
    charm.triggers = original;
  }
}

const procCount = (battle: BattleState): number => battle.procs?.['t_19:0']?.count ?? 0;

const findTrace = <K extends CombatTraceEntry['kind']>(
  trace: CombatTraceEntry[],
  kind: K,
): Extract<CombatTraceEntry, { kind: K }>[] =>
  trace.filter((event): event is Extract<CombatTraceEntry, { kind: K }> => event.kind === kind);

/** Runs one full round against the padded rat with a counting RNG wrapper
 * (same underlying seed per run, so draw streams stay aligned). */
function countedRound(
  player: PlayerState,
  battle: BattleState,
  seed: number,
  draws: { n: number },
): ReturnType<typeof performAction> {
  const base = seeded(seed);
  const counting = () => {
    draws.n++;
    return base();
  };
  return performAction(player, battle, { kind: 'attack' }, counting);
}

// ── Without the Cinder: both families are terminal at 0 HP ───────────────

Deno.test('#104: direct lethal hit — terminal immediately, no reactions, hpDamaged closes the trace', () => {
  withDeathBite((player) => {
    ungatedGrudge((grudged) => {
      void grudged;
      const battle = tankyRat(player, 11);
      player.equipment.trinket = 't_19';
      const res = performAction(player, battle, { kind: 'attack' }, seeded(11));
      assertEquals(res.outcome, 'defeat');
      assertEquals(player.hp, 0, 'no revival exists — defeat stands');
      assertEquals(battle.phoenixUsed, false);
      assertEquals(procCount(battle), 0, 'a fallen wearer procs nothing');
      // Trace order: the hpDamaged entry is the LAST event before the
      // terminal adjudication — nothing resolved after 0 HP.
      const damaged = findTrace(res.trace, 'hpDamaged');
      const terminal = findTrace(res.trace, 'terminal');
      assertEquals(terminal.length, 1);
      assert(damaged.length > 0, 'the lethal HP loss is on the trace');
      assertEquals(
        res.trace.indexOf(damaged[damaged.length - 1]!),
        res.trace.length - 2,
        'the terminal entry directly follows the lethal hpDamaged',
      );
      assertEquals(
        damaged[damaged.length - 1]!.target,
        'player',
        'the final hpDamaged is the player’s lethal loss',
      );
    });
  });
});

Deno.test('#104: periodic lethal tick — same terminal contract as a direct hit', () => {
  const charm = item('t_19')!;
  const original = charm.triggers;
  charm.triggers = [{
    name: 'Grudge Prick',
    trigger: 'onHpDamage',
    effects: [{
      kind: 'periodic',
      target: 'opponent',
      perRound: -3,
      duration: 2,
      tickPhase: 'roundEnd',
      name: 'Grudge Bleed',
      tags: ['bleed', 'harmful'],
    }],
  }];
  try {
    const player = hero(3, 'warrior', 5);
    player.equipment.trinket = 't_19';
    player.hp = 99999; // the rat's reply must not decide this fight — the DoT does
    const battle = tankyRat(player, 12);
    warded(player); // the reply stays shield-only; the bypass tick is the only loss
    lethalDoT(battle);
    const res = performAction(player, battle, { kind: 'attack' }, seeded(12));
    assertEquals(res.outcome, 'defeat', 'a lethal tick ends the round');
    assertEquals(player.hp, 0);
    assertEquals(battle.phoenixUsed, false);
    assertEquals(procCount(battle), 0, 'a fallen wearer procs nothing — periodic parity');
    const ticks = findTrace(res.trace, 'periodicTick');
    const damaged = findTrace(res.trace, 'hpDamaged');
    const terminal = findTrace(res.trace, 'terminal');
    assert(ticks.some((event) => event.applied < 0), 'the lethal tick is on the trace');
    assert(damaged.some((event) => event.cause === 'periodic' && event.target === 'player'));
    assertEquals(
      res.trace.indexOf(terminal[0]!),
      res.trace.length - 1,
      'the terminal entry is the resolution’s last record',
    );
    assertEquals(
      res.trace.indexOf(damaged[damaged.length - 1]!),
      res.trace.length - 2,
      'nothing resolved between the lethal loss and the adjudication',
    );
  } finally {
    charm.triggers = original;
  }
});

Deno.test('#104: unrevived end-of-round work never runs after the lethal tick', () => {
  const player = hero(4, 'warrior', 5);
  player.hp = 99999;
  const battle = tankyRat(player, 13);
  // Regen tick AFTER the lethal one in insertion order.
  lethalDoT(battle);
  battle.effectInstances.push({
    iid: 'hot1',
    defId: 'test:regen',
    name: 'Test Regen',
    side: 'player',
    source: { kind: 'skill', id: 'test', name: 'test fixture' },
    kind: 'periodic',
    perRound: 50,
    tickPhase: 'roundEnd',
    tags: ['beneficial', 'periodic', 'regen'],
    stacking: 'replace',
    appliedRound: battle.round,
    remaining: 5,
    removable: true,
    expiresRound: battle.round + 4,
  });
  const res = performAction(player, battle, { kind: 'attack' }, seeded(13));
  assertEquals(res.outcome, 'defeat');
  const regens = findTrace(res.trace, 'periodicTick').filter((event) => event.amount > 0);
  assertEquals(regens.length, 0, 'regeneration never resolved after 0 HP');
  assertEquals(player.hp, 0);
});

// ── With the Cinder: revival precedes reactions in BOTH families ─────────

Deno.test('#104: direct lethal with the Cinder — revival, then the broad trigger answers', () => {
  withDeathBite((player) => {
    addItem(player, 'c_phoenix_feather', 1);
    ungatedGrudge((grudged) => {
      void grudged;
      player.equipment.trinket = 't_19';
      const battle = tankyRat(player, 14);
      const res = performAction(player, battle, { kind: 'attack' }, seeded(14));
      const max = statsOf(player).maxHp;
      assertEquals(player.hp, Math.floor(max * 0.5), 'revived at half health');
      assertEquals(battle.phoenixUsed, true);
      assertEquals(
        procCount(battle),
        1,
        'the revived survivor answers the lethal event (direct family)',
      );
      assertEquals(res.outcome, 'ongoing', 'the synchronous revival prevents defeat');
      // Trace order: hpDamaged → revived → procAttempt.
      const damaged = findTrace(res.trace, 'hpDamaged').filter((event) =>
        event.target === 'player'
      );
      const revived = findTrace(res.trace, 'revived');
      const procs = findTrace(res.trace, 'procAttempt').filter((event) => event.success);
      assert(damaged.length > 0);
      assertEquals(revived.length, 1, 'the revival is recorded');
      assertEquals(procs.length, 1);
      const traceIndex = (event: CombatTraceEntry) => res.trace.indexOf(event);
      assert(
        traceIndex(damaged[damaged.length - 1]!) < traceIndex(revived[0]!) &&
          traceIndex(revived[0]!) < traceIndex(procs[0]!),
        'the revival resolves between the lethal loss and the reaction scan',
      );
      assertEquals(revived[0]!.source, 'item:Phoenix Cinder');
      assertEquals(revived[0]!.applied, Math.floor(max * 0.5));
    });
  });
});

Deno.test('#104: periodic lethal with the Cinder — direct/periodic parity', () => {
  const player = hero(5, 'warrior', 5);
  player.hp = 99999;
  player.equipment.trinket = 't_19';
  const charm = item('t_19')!;
  const original = charm.triggers;
  charm.triggers = [{
    name: 'Grudge Prick',
    trigger: 'onHpDamage',
    effects: [{
      kind: 'periodic',
      target: 'opponent',
      perRound: -3,
      duration: 2,
      tickPhase: 'roundEnd',
      name: 'Grudge Bleed',
      tags: ['bleed', 'harmful'],
    }],
  }];
  try {
    addItem(player, 'c_phoenix_feather', 1);
    const battle = tankyRat(player, 15);
    warded(player);
    lethalDoT(battle);
    const res = performAction(player, battle, { kind: 'attack' }, seeded(15));
    const max = statsOf(player).maxHp;
    assertEquals(player.hp, Math.floor(max * 0.5), 'revived at half health — periodic parity');
    assertEquals(battle.phoenixUsed, true);
    assertEquals(
      procCount(battle),
      1,
      'the revived survivor answers the lethal tick (periodic family)',
    );
    assertEquals(res.outcome, 'ongoing');
    const damaged = findTrace(res.trace, 'hpDamaged').filter((event) =>
      event.target === 'player' && event.cause === 'periodic'
    );
    const revived = findTrace(res.trace, 'revived');
    const procs = findTrace(res.trace, 'procAttempt').filter((event) => event.success);
    assertEquals(damaged.length, 1, 'the lethal tick is provenance-tagged');
    assertEquals(revived.length, 1);
    assertEquals(procs.length, 1);
    const traceIndex = (event: CombatTraceEntry) => res.trace.indexOf(event);
    assert(
      traceIndex(damaged[0]!) < traceIndex(revived[0]!) &&
        traceIndex(revived[0]!) < traceIndex(procs[0]!),
      'tick → revival → reaction — identical order to a direct lethal hit',
    );
  } finally {
    charm.triggers = original;
  }
});

// ── RNG draw counts: the transition never wastes draws ───────────────────

Deno.test('#104: RNG parity — an unrevived lethal event draws nothing further', () => {
  const charm = item('t_19')!;
  const original = charm.triggers;
  const gated: typeof charm.triggers = [{
    name: 'Gated Prick',
    trigger: 'onHpDamage',
    chance: 0.99,
    effects: [{
      kind: 'periodic',
      target: 'opponent',
      perRound: -3,
      duration: 2,
      tickPhase: 'roundEnd',
      name: 'Grudge Bleed',
      tags: ['bleed', 'harmful'],
    }],
  }];
  const run = (trinket: string | undefined, seed: number) => {
    const player = hero(6, 'warrior', 5);
    if (trinket) player.equipment.trinket = trinket;
    const battle = tankyRat(player, seed);
    warded(player);
    lethalDoT(battle);
    const draws = { n: 0 };
    const res = countedRound(player, battle, seed, draws);
    return { draws: draws.n, res };
  };
  try {
    charm.triggers = gated;
    // A seed where the DoT actually lands the lethal tick.
    let seed = 1;
    let lethal: ReturnType<typeof run> | undefined;
    while (seed <= 60) {
      const fixture = run('t_19', seed);
      if (fixture.res.outcome === 'defeat') {
        lethal = fixture;
        break;
      }
      seed++;
    }
    assertExists(lethal, 'no seed reproduced a lethal tick');
    // The control wears nothing: identical state and seed up to the tick.
    const control = run(undefined, seed);
    assertEquals(
      lethal.draws,
      control.draws,
      'the reactive scan never ran after the unrevived 0-HP transition',
    );
    assertEquals(lethal.res.outcome, 'defeat');
  } finally {
    charm.triggers = original;
  }
});

Deno.test('#104: RNG parity — a revived survivor draws the reaction scan (periodic)', () => {
  const charm = item('t_19')!;
  const original = charm.triggers;
  const gated: typeof charm.triggers = [{
    name: 'Gated Prick',
    trigger: 'onHpDamage',
    chance: 0.99,
    effects: [{
      kind: 'periodic',
      target: 'opponent',
      perRound: -3,
      duration: 2,
      tickPhase: 'roundEnd',
      name: 'Grudge Bleed',
      tags: ['bleed', 'harmful'],
    }],
  }];
  const run = (trinket: string | undefined, seed: number) => {
    const player = hero(7, 'warrior', 5);
    if (trinket) player.equipment.trinket = trinket;
    addItem(player, 'c_phoenix_feather', 1);
    const battle = tankyRat(player, seed);
    warded(player);
    lethalDoT(battle);
    const draws = { n: 0 };
    const res = countedRound(player, battle, seed, draws);
    return { draws: draws.n, res, hp: player.hp };
  };
  try {
    charm.triggers = gated;
    let seed = 1;
    let revived: ReturnType<typeof run> | undefined;
    while (seed <= 60) {
      const fixture = run('t_19', seed);
      if (fixture.res.outcome === 'ongoing' && fixture.hp > 0) {
        revived = fixture;
        break;
      }
      seed++;
    }
    assertExists(revived, 'no seed reproduced a revived round');
    const control = run(undefined, seed);
    assertEquals(revived.hp, Math.floor(statsOf(hero(8, 'warrior', 5)).maxHp * 0.5));
    assertEquals(
      revived.draws,
      control.draws + 1,
      'the revived survivor’s scan drew exactly its one chance roll',
    );
    const successes = findTrace(revived.res.trace, 'procAttempt').filter((event) => event.success);
    assertEquals(successes.length, 1);
  } finally {
    charm.triggers = original;
  }
});
