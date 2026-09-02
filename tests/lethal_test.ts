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
import { seeded } from './helpers.ts';

const ORIGIN = { kind: 'explore', zoneId: 'outskirts' } as const;

function hero(id: number, classId: ClassId, level: number): PlayerState {
  const p = createPlayer(id, 'T', classId);
  p.level = level;
  return p;
}

/** Padded rat so only the authored lethality decides the fight. */
function tankyRat(p: PlayerState, seed: number): BattleState {
  const b = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(seed) })!.battle;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;
  return b;
}

/** Pads the hero behind an unbreakable ward: earlier enemy swings stay
 * shield-only (no HP loss, no proc), so the bypass-shield lethal tick is
 * the round's ONLY player HP loss. */
function warded(p: PlayerState): void {
  grantShield(p.battle!, 'player', {
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

/** One lethal enemy strike through the DIRECT damage family. */
function withDeathBite(run: (p: PlayerState) => void): void {
  const rat = ENEMIES.find((e) => e.id === 'e_rat')!;
  withOverridden(rat, 'moves', [{
    name: 'Death Bite',
    weight: 1,
    effects: [{ kind: 'damage', attack: 'phys', power: 9999 }],
  }], () => run(hero(1, 'warrior', 5)));
}

/** A lethal round-end DoT through the PERIODIC family (not dodgeable, not
 * routed through the resolver's damage branch). */
function lethalDoT(b: BattleState): EffectInstance {
  b.effectInstances.push({
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
    appliedRound: b.round,
    remaining: 3,
    removable: true,
    expiresRound: b.round + 2,
  });
  return b.effectInstances[b.effectInstances.length - 1]!;
}

/** The Grudge Charm's broad onHpDamage trigger, deterministic: always procs,
 * unlimited, no cooldown (fixture from #97's suite). */
function ungatedGrudge(run: (p: PlayerState) => void): void {
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
    desc: 'test fixture: every HP loss answers',
  }];
  try {
    const p = hero(2, 'warrior', 5);
    p.equipment.trinket = 't_19';
    run(p);
  } finally {
    charm.triggers = original;
  }
}

const procCount = (b: BattleState): number => b.procs?.['t_19:0']?.count ?? 0;

const findTrace = <K extends CombatTraceEntry['kind']>(
  trace: CombatTraceEntry[],
  kind: K,
): Extract<CombatTraceEntry, { kind: K }>[] =>
  trace.filter((e): e is Extract<CombatTraceEntry, { kind: K }> => e.kind === kind);

/** Runs one full round against the padded rat with a counting RNG wrapper
 * (same underlying seed per run, so draw streams stay aligned). */
function countedRound(
  p: PlayerState,
  b: BattleState,
  seed: number,
  draws: { n: number },
): ReturnType<typeof performAction> {
  const base = seeded(seed);
  const counting = () => {
    draws.n++;
    return base();
  };
  return performAction(p, b, { kind: 'attack' }, counting);
}

// ── Without the Cinder: both families are terminal at 0 HP ───────────────

Deno.test('#104: direct lethal hit — terminal immediately, no reactions, hpDamaged closes the trace', () => {
  withDeathBite((p) => {
    ungatedGrudge((grudged) => {
      void grudged;
      const b = tankyRat(p, 11);
      p.equipment.trinket = 't_19';
      const res = performAction(p, b, { kind: 'attack' }, seeded(11));
      assertEquals(res.outcome, 'defeat');
      assertEquals(p.hp, 0, 'no revival exists — defeat stands');
      assertEquals(b.phoenixUsed, false);
      assertEquals(procCount(b), 0, 'a fallen wearer procs nothing');
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
    desc: 'test fixture: every HP loss answers',
  }];
  try {
    const p = hero(3, 'warrior', 5);
    p.equipment.trinket = 't_19';
    p.hp = 99999; // the rat's reply must not decide this fight — the DoT does
    const b = tankyRat(p, 12);
    warded(p); // the reply stays shield-only; the bypass tick is the only loss
    lethalDoT(b);
    const res = performAction(p, b, { kind: 'attack' }, seeded(12));
    assertEquals(res.outcome, 'defeat', 'a lethal tick ends the round');
    assertEquals(p.hp, 0);
    assertEquals(b.phoenixUsed, false);
    assertEquals(procCount(b), 0, 'a fallen wearer procs nothing — periodic parity');
    const ticks = findTrace(res.trace, 'periodicTick');
    const damaged = findTrace(res.trace, 'hpDamaged');
    const terminal = findTrace(res.trace, 'terminal');
    assert(ticks.some((t) => t.applied < 0), 'the lethal tick is on the trace');
    assert(damaged.some((d) => d.cause === 'periodic' && d.target === 'player'));
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
  const p = hero(4, 'warrior', 5);
  p.hp = 99999;
  const b = tankyRat(p, 13);
  // Regen tick AFTER the lethal one in insertion order.
  lethalDoT(b);
  b.effectInstances.push({
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
    appliedRound: b.round,
    remaining: 5,
    removable: true,
    expiresRound: b.round + 4,
  });
  const res = performAction(p, b, { kind: 'attack' }, seeded(13));
  assertEquals(res.outcome, 'defeat');
  const regens = findTrace(res.trace, 'periodicTick').filter((t) => t.amount > 0);
  assertEquals(regens.length, 0, 'regeneration never resolved after 0 HP');
  assertEquals(p.hp, 0);
});

// ── With the Cinder: revival precedes reactions in BOTH families ─────────

Deno.test('#104: direct lethal with the Cinder — revival, then the broad trigger answers', () => {
  withDeathBite((p) => {
    addItem(p, 'c_phoenix_feather', 1);
    ungatedGrudge((grudged) => {
      void grudged;
      p.equipment.trinket = 't_19';
      const b = tankyRat(p, 14);
      const res = performAction(p, b, { kind: 'attack' }, seeded(14));
      const max = statsOf(p).maxHp;
      assertEquals(p.hp, Math.floor(max * 0.5), 'revived at half health');
      assertEquals(b.phoenixUsed, true);
      assertEquals(
        procCount(b),
        1,
        'the revived survivor answers the lethal event (direct family)',
      );
      assertEquals(res.outcome, 'ongoing', 'the synchronous revival prevents defeat');
      // Trace order: hpDamaged → revived → procAttempt.
      const damaged = findTrace(res.trace, 'hpDamaged').filter((d) => d.target === 'player');
      const revived = findTrace(res.trace, 'revived');
      const procs = findTrace(res.trace, 'procAttempt').filter((a) => a.success);
      assert(damaged.length > 0);
      assertEquals(revived.length, 1, 'the revival is recorded');
      assertEquals(procs.length, 1);
      const idx = (e: CombatTraceEntry) => res.trace.indexOf(e);
      assert(
        idx(damaged[damaged.length - 1]!) < idx(revived[0]!) &&
          idx(revived[0]!) < idx(procs[0]!),
        'the revival resolves between the lethal loss and the reaction scan',
      );
      assertEquals(revived[0]!.source, 'item:Phoenix Cinder');
      assertEquals(revived[0]!.applied, Math.floor(max * 0.5));
    });
  });
});

Deno.test('#104: periodic lethal with the Cinder — direct/periodic parity', () => {
  const p = hero(5, 'warrior', 5);
  p.hp = 99999;
  p.equipment.trinket = 't_19';
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
    desc: 'test fixture: every HP loss answers',
  }];
  try {
    addItem(p, 'c_phoenix_feather', 1);
    const b = tankyRat(p, 15);
    warded(p);
    lethalDoT(b);
    const res = performAction(p, b, { kind: 'attack' }, seeded(15));
    const max = statsOf(p).maxHp;
    assertEquals(p.hp, Math.floor(max * 0.5), 'revived at half health — periodic parity');
    assertEquals(b.phoenixUsed, true);
    assertEquals(
      procCount(b),
      1,
      'the revived survivor answers the lethal tick (periodic family)',
    );
    assertEquals(res.outcome, 'ongoing');
    const damaged = findTrace(res.trace, 'hpDamaged').filter((d) =>
      d.target === 'player' && d.cause === 'periodic'
    );
    const revived = findTrace(res.trace, 'revived');
    const procs = findTrace(res.trace, 'procAttempt').filter((a) => a.success);
    assertEquals(damaged.length, 1, 'the lethal tick is provenance-tagged');
    assertEquals(revived.length, 1);
    assertEquals(procs.length, 1);
    const idx = (e: CombatTraceEntry) => res.trace.indexOf(e);
    assert(
      idx(damaged[0]!) < idx(revived[0]!) && idx(revived[0]!) < idx(procs[0]!),
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
    desc: 'test fixture: a chance roll proves whether the scan ran',
  }];
  const run = (trinket: string | undefined, seed: number) => {
    const p = hero(6, 'warrior', 5);
    if (trinket) p.equipment.trinket = trinket;
    const b = tankyRat(p, seed);
    warded(p);
    lethalDoT(b);
    const draws = { n: 0 };
    const res = countedRound(p, b, seed, draws);
    return { draws: draws.n, res };
  };
  try {
    charm.triggers = gated;
    // A seed where the DoT actually lands the lethal tick.
    let seed = 1;
    let lethal: ReturnType<typeof run> | undefined;
    while (seed <= 60) {
      const r = run('t_19', seed);
      if (r.res.outcome === 'defeat') {
        lethal = r;
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
    desc: 'test fixture: a chance roll proves whether the scan ran',
  }];
  const run = (trinket: string | undefined, seed: number) => {
    const p = hero(7, 'warrior', 5);
    if (trinket) p.equipment.trinket = trinket;
    addItem(p, 'c_phoenix_feather', 1);
    const b = tankyRat(p, seed);
    warded(p);
    lethalDoT(b);
    const draws = { n: 0 };
    const res = countedRound(p, b, seed, draws);
    return { draws: draws.n, res, hp: p.hp };
  };
  try {
    charm.triggers = gated;
    let seed = 1;
    let revived: ReturnType<typeof run> | undefined;
    while (seed <= 60) {
      const r = run('t_19', seed);
      if (r.res.outcome === 'ongoing' && r.hp > 0) {
        revived = r;
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
    const successes = findTrace(revived.res.trace, 'procAttempt').filter((a) => a.success);
    assertEquals(successes.length, 1);
  } finally {
    charm.triggers = original;
  }
});
