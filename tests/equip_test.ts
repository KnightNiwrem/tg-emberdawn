/** Triggered equipment effects (#82, #89): battleStart openings resolve
 * once inside the #80 pipeline (success AND failure both recorded),
 * reactive procs are cause-matched (onEnemyActionHpDamage = direct enemy
 * actions only; onHpDamage = every HP loss, ticks included) and respect
 * maxProcs/cooldown/chance with battle-local JSON-serializable
 * bookkeeping, shield-only absorbs never proc, forge temper never scales
 * proc data, and the UI derives exact mechanics from the trigger fields. */

import { assert, assertEquals, assertExists } from '@std/assert';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { applyInstance, grantShield, incomingAmpPct } from '../src/engine/effects.ts';
import { type CombatEvent, type DamageCause, setCombatTelemetry } from '../src/engine/telemetry.ts';
import type { BattleState, ClassId, EffectInstance, PlayerState } from '../src/engine/types.ts';
import { item } from '../src/content/items.ts';
import { renderEquipment, renderItemDetail, triggerDisclosure } from '../src/render/menus.ts';
import { seeded } from './helpers.ts';

const ORIGIN = { kind: 'explore', zoneId: 'whisperwood' } as const;

/** #90: the stacking identity of an equipment trigger's first effect. */
const trigId = (trinket: string): string => `${trinket}:t0:e0`;

function hero(id: number, classId: ClassId, level: number, trinket?: string): PlayerState {
  const p = createPlayer(id, 'T', classId);
  p.level = level;
  if (trinket) p.equipment.trinket = trinket;
  return p;
}

/** Tanky wolf so multi-round fights survive the hero's strikes. */
function tankyWolf(p: PlayerState, seed: number): BattleState {
  const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(seed) })!.battle;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;
  return b;
}

/** The Forge Warden hits hard but has NO status resistance — late-band
 * proc tests that must observe a LANDED application use it instead of the
 * Void Warden (whose #83 statusResist can eat the proc attempt). */
function tankyForge(p: PlayerState, seed: number): BattleState {
  p.hp = 99999; // #86: a fallen wearer procs nothing — survive the Warden's swings
  const b = startBattle('e_forge_warden', ORIGIN, { player: p, rng: seeded(seed) })!.battle;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;
  return b;
}

/** Same-seed rounds replay identical draws — deterministic procs. */
function round(p: PlayerState, b: BattleState, seed: number) {
  return performAction(p, b, { kind: 'attack' }, seeded(seed));
}

/** A seed under which the trinket's reactive trigger procs on round 1 —
 * which also proves the wolf's move actually dealt HP damage that round. */
function reactiveSeed(
  trinket: string,
  level: number,
  wantProc: boolean,
  enemy: (p: PlayerState, s: number) => BattleState = tankyWolf,
): number {
  for (let s = 1; s <= 300; s++) {
    const p = hero(900 + s, 'warrior', level, trinket);
    const b = enemy(p, s);
    round(p, b, s);
    // Hunt on a LANDED application — a resisted attempt (⚡-prefixed resist
    // line) must not read as a proc (#83 statusResist).
    if (b.effectInstances.some((i) => i.defId === trigId(trinket)) === wantProc) return s;
  }
  throw new Error(`no ${wantProc ? 'proc' : 'miss'} seed found for ${trinket}`);
}

/** A seed under which the trinket's battleStart roll (un)applies. */
function openingSeed(trinket: string, level: number, wantApplied: boolean): number {
  for (let s = 1; s <= 200; s++) {
    const p = hero(900 + s, 'warrior', level, trinket);
    const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(s) })!.battle;
    if (b.effectInstances.some((i) => i.defId === trigId(trinket)) === wantApplied) return s;
  }
  throw new Error(`no ${wantApplied ? 'success' : 'failure'} opening seed for ${trinket}`);
}

Deno.test('#82: battleStart trigger wards the wearer through the opening', () => {
  const p = hero(1, 'warrior', 28, 't_15');
  const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(1) })!.battle;
  const ward = b.effectInstances.find((i) => i.defId === 't_15:t0:e0');
  assertExists(ward, 'the Rime Ward instance exists');
  assertEquals(ward.side, 'player');
  assertEquals(ward.shieldAmount, 35);
  assertEquals(b.shield.player, 35, 'opening wards fill the pool with no waste');
  assert(b.opening?.lines.some((l) => l.includes('Rime crystals settle over you')));
  assert(b.opening?.lines.some((l) => l.includes('absorbing up to 35 damage')));
  assertEquals(b.round, 1, 'the opening consumes no round');
});

Deno.test('#82: battleStart chance failure is recorded exactly once', () => {
  const s = openingSeed('t_7', 32, false);
  const p = hero(2, 'warrior', 32, 't_7');
  const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(s) })!.battle;
  assertEquals(b.effectInstances.some((i) => i.defId === 't_7:t0:e0'), false);
  const fizzles = b.opening?.lines.filter((l) => l.includes('roll missed')) ?? [];
  assertEquals(fizzles.length, 1, 'the miss is logged once — outcome persistence');
  assert(fizzles[0]!.includes('Keen Fracture'));
  assertEquals(b.shield.player, 0);
});

Deno.test('#82: battleStart success applies the typed effect once', () => {
  const s = openingSeed('t_7', 32, true);
  const p = hero(3, 'warrior', 32, 't_7');
  const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(s) })!.battle;
  const exposed = b.effectInstances.find((i) => i.defId === 't_7:t0:e0');
  assertExists(exposed);
  assertEquals(exposed.side, 'enemy');
  assertEquals(exposed.stat, 'incoming');
  assertEquals(exposed.pct, 0.25);
  assertEquals(exposed.source, { kind: 'item', id: 't_7', name: 'Glass Arrowhead' });
  assertEquals(b.opening?.lines.some((l) => l.includes('roll missed')), false);
});

Deno.test('#82: openings are deterministic; procs persist verbatim via JSON', () => {
  const a = startBattle('e_wolf', ORIGIN, {
    player: hero(4, 'warrior', 28, 't_15'),
    rng: seeded(11),
  })!.battle;
  const b = startBattle('e_wolf', ORIGIN, {
    player: hero(5, 'warrior', 28, 't_15'),
    rng: seeded(11),
  })!.battle;
  assertEquals(a.opening, b.opening);
  assertEquals(a.effectInstances, b.effectInstances);

  // A reactive proc's bookkeeping survives a save-shaped roundtrip.
  const s = reactiveSeed('t_9', 5, true);
  const rp = hero(6, 'warrior', 5, 't_9');
  const rb = tankyWolf(rp, s);
  round(rp, rb, s);
  assertExists(rb.procs);
  const rt = JSON.parse(JSON.stringify(rb)) as BattleState;
  assertEquals(rt.procs, rb.procs);
  assertEquals(rt.opening, rb.opening);
});

Deno.test('#82: onHpDamage retaliation procs with source attribution', () => {
  const s = reactiveSeed('t_9', 5, true);
  const p = hero(7, 'warrior', 5, 't_9');
  const b = tankyWolf(p, s);
  const res = round(p, b, s);
  const bleed = b.effectInstances.find((i) => i.defId === 't_9:t0:e0');
  assertExists(bleed, 'the attacker is bleeding');
  assertEquals(bleed.side, 'enemy');
  assertEquals(bleed.kind, 'periodic');
  assertEquals(bleed.perRound, -4);
  assertEquals(bleed.source, { kind: 'item', id: 't_9', name: 'Thorn Ring' });
  assertEquals(b.procs?.['t_9:0'], { count: 1, round: 1 });
  assert(res.lines.some((l) => l.startsWith('⚡ ')), 'proc lines carry the ⚡ attribution');
});

Deno.test('#82: shield-only absorbs never proc onHpDamage', () => {
  const s = reactiveSeed('t_9', 5, true);
  const p = hero(8, 'warrior', 5, 't_9');
  const b = tankyWolf(p, s);
  grantShield(b, 'player', {
    defId: 'test_ward',
    name: 'Test Ward',
    kind: 'shield',
    side: 'player',
    source: { kind: 'item', id: 'test_ward', name: 'Test Ward' },
    shieldAmount: 500,
    tags: ['beneficial'],
    stacking: 'replace',
    duration: 2,
    timing: 'immediate',
    removable: false,
  });
  const events: CombatEvent[] = [];
  setCombatTelemetry((e) => events.push(e));
  try {
    const hpBefore = p.hp;
    const res = round(p, b, s);
    assertEquals(p.hp, hpBefore, 'the strike never reached HP');
    assertEquals(res.lines.some((l) => l.startsWith('⚡ ')), false);
  } finally {
    setCombatTelemetry(null);
  }
  assertEquals(b.procs?.['t_9:0']?.count ?? 0, 0);
  assertEquals(
    events.filter((e) => e.kind === 'hpDamaged' && e.target === 'player').length,
    0,
    'shield-only absorption emits no hpDamaged event (#89)',
  );
});

Deno.test('#82: maxProcs caps reactive procs per battle', () => {
  const s = reactiveSeed('t_9', 5, true);
  const p = hero(9, 'warrior', 5, 't_9');
  const b = tankyWolf(p, s);
  let procLines = 0;
  for (let r = 0; r < 5; r++) {
    const res = round(p, b, s);
    procLines += res.lines.filter((l) => l.startsWith('⚡ ')).length;
  }
  assertEquals(b.procs?.['t_9:0']?.count, 3, 'capped at the authored limit');
  assertEquals(procLines, 3);
});

Deno.test('#89: cooldown 2 blocks the two rounds after a proc', () => {
  const run = (seed: number): { rounds: number[]; count: number } => {
    const p = hero(10, 'warrior', 36, 't_16');
    const b = tankyForge(p, seed);
    const rounds: number[] = [];
    for (let r = 0; r < 7; r++) {
      p.hp = statsOf(p).maxHp; // survival is not the variable under test
      const res = round(p, b, seed);
      if (res.lines.some((l) => l.startsWith('⚡ '))) rounds.push(b.round - 1);
    }
    return { rounds, count: b.procs?.['t_16:0']?.count ?? 0 };
  };
  let result = { rounds: [] as number[], count: 0 };
  for (let seed = 1; seed <= 80; seed++) {
    result = run(seed);
    if (result.rounds.length >= 2) break;
  }
  const { rounds: procRounds, count } = result;
  assert(procRounds.length >= 2, 'at least two procs landed within seven rounds');
  for (let i = 1; i < procRounds.length; i++) {
    assert(
      procRounds[i]! - procRounds[i - 1]! >= 3,
      `procs at rounds ${procRounds[i - 1]} and ${
        procRounds[i]
      } respect the cooldown-2 gate (blocked R+1..R+2, eligible R+3, #89)`,
    );
  }
  assertEquals(count, procRounds.length, 'bookkeeping matches the observed procs');
});

Deno.test('#82: periodic ticks damage the wearer but never proc', () => {
  const p = hero(11, 'warrior', 5, 't_9');
  const b = tankyWolf(p, 1);
  applyInstance(b, {
    defId: 'test_poison',
    name: 'Test Rot',
    kind: 'periodic',
    side: 'player',
    source: { kind: 'skill', id: 'test', name: 'Test' },
    perRound: -5,
    tickPhase: 'roundEnd',
    tags: ['poison', 'harmful'],
    stacking: 'replace',
    duration: 3,
    timing: 'immediate',
    removable: true,
  });
  applyInstance(b, {
    defId: 'test_stun',
    name: 'Stun',
    kind: 'control',
    side: 'enemy',
    source: { kind: 'skill', id: 'test', name: 'Test' },
    control: 'stun',
    actions: 1,
    tags: ['control', 'harmful'],
    stacking: 'replace',
    duration: 1,
    timing: 'immediate',
    removable: false,
  });
  const hpBefore = p.hp;
  const res = round(p, b, 1);
  assert(p.hp < hpBefore, 'the end-of-round tick bit HP');
  assertEquals(res.lines.some((l) => l.startsWith('⚡ ')), false, 'ticks are not enemy actions');
  assertEquals(b.procs?.['t_9:0']?.count ?? 0, 0);
});

Deno.test('#82: onGuard triggers restore MP and cap at maxProcs', () => {
  const p = hero(12, 'mage', 15, 't_13');
  const b = tankyWolf(p, 5);
  p.mp = 5;
  const base = Math.ceil(statsOf(p).maxMp * 0.08);
  const tide = Math.floor(statsOf(p).maxMp * 0.08);
  performAction(p, b, { kind: 'guard' }, seeded(5));
  assertEquals(b.procs?.['t_13:0']?.count, 1);
  assertEquals(p.mp, 5 + base + tide, 'guard MP plus the tide return');
  for (let i = 0; i < 3; i++) performAction(p, b, { kind: 'guard' }, seeded(5));
  assertEquals(b.procs?.['t_13:0']?.count, 3, 'capped at 3 restores');
});

function procInstance(
  trinket: string,
  level: number,
  s: number,
  temper: boolean,
  enemy: (p: PlayerState, s: number) => BattleState = tankyWolf,
): EffectInstance {
  const p = hero(800, 'warrior', level, trinket);
  if (temper) p.flags['forge_i_w_warrior_1'] = 5;
  const b = enemy(p, s);
  round(p, b, s);
  return b.effectInstances.find((i) => i.defId === trigId(trinket))!;
}

Deno.test('#82: forge temper never scales proc data', () => {
  const s = reactiveSeed('t_16', 36, true, tankyForge);
  const base = procInstance('t_16', 36, s, false, tankyForge);
  const tempered = procInstance('t_16', 36, s, true, tankyForge);
  assertEquals(tempered.perRound, base.perRound);
  assertEquals(tempered.perRound, -12, 'temper is stat-only; potency is authored data');
  assertEquals(tempered.remaining, base.remaining);
  assertEquals(tempered.name, base.name);
});

Deno.test('#82: item opening + pre-emptive skill coexist, item slot first', () => {
  const both = (): number => {
    for (let s = 1; s <= 200; s++) {
      const p = hero(900 + s, 'rogue', 45, 't_7');
      p.skills.push('sk_expose_weakness');
      const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(s) })!.battle;
      if (
        b.effectInstances.some((i) => i.defId === 't_7:t0:e0') &&
        b.effectInstances.some((i) => i.defId === 'sk_expose_weakness:e0')
      ) {
        return s;
      }
    }
    throw new Error('no both-success seed');
  };
  const s = both();
  const p = hero(13, 'rogue', 45, 't_7');
  p.skills.push('sk_expose_weakness');
  const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(s) })!.battle;
  const lens = b.effectInstances.find((i) => i.defId === 't_7:t0:e0')!;
  const sk = b.effectInstances.find((i) => i.defId === 'sk_expose_weakness:e0')!;
  assertEquals(lens.stat, 'incoming');
  assertEquals(sk.stat, 'incoming');
  assertEquals(incomingAmpPct(b, 'enemy'), 0.5, 'different sources fold additively');
  assert(
    b.effectInstances.indexOf(lens) < b.effectInstances.indexOf(sk),
    'equipment slot order precedes learned pre-emptive skills',
  );
});

Deno.test('#82: UI disclosure derives exact mechanics from trigger data', () => {
  const arrow = triggerDisclosure(item('t_7'));
  assertEquals(arrow, [
    '⚡ Battle start: Expose the foe (+25% damage taken, 3 rounds). (45% chance)',
  ]);
  const caldera = triggerDisclosure(item('t_16'))[0]!;
  assert(caldera.includes('50% chance'));
  assert(caldera.includes('at most once every 3 rounds'));
  assert(caldera.includes('up to 3×/battle'));
  assert(
    triggerDisclosure(item('t_9'))[0]!.startsWith('⚡ When an enemy action damages you:'),
  );
  assertEquals(triggerDisclosure(item('t_19')), [
    '⚡ On taking any HP loss: any HP loss answers with a small bleed (every other round). (up to 6×/battle · at most once every 2 rounds)',
  ]);
  assertEquals(
    triggerDisclosure(item('t_13')),
    ['⚡ On guard: restore 8% of max MP. (up to 3×/battle)'],
  );
  assertEquals(triggerDisclosure(item('c_potion')), []);

  const bag = hero(14, 'warrior', 32, 't_7');
  bag.inventory.push({ id: 't_7', qty: 1 });
  assert(JSON.stringify(renderItemDetail(bag, 't_7')).includes('⚡ Battle start'));
  assert(
    JSON.stringify(renderEquipment(hero(15, 'warrior', 28, 't_15'))).includes('⚡ Battle start'),
  );
});

// ── #89: cause-matched triggers, exact cooldown arithmetic, provenance ──

Deno.test('#89: broad onHpDamage answers periodic ticks', () => {
  const p = hero(21, 'warrior', 5, 't_19');
  const b = tankyWolf(p, 1);
  applyInstance(b, {
    defId: 'test_poison',
    name: 'Test Rot',
    kind: 'periodic',
    side: 'player',
    source: { kind: 'skill', id: 'test', name: 'Test' },
    perRound: -5,
    tickPhase: 'roundEnd',
    tags: ['poison', 'harmful'],
    stacking: 'replace',
    duration: 3,
    timing: 'immediate',
    removable: true,
  });
  applyInstance(b, {
    defId: 'test_stun',
    name: 'Stun',
    kind: 'control',
    side: 'enemy',
    source: { kind: 'skill', id: 'test', name: 'Test' },
    control: 'stun',
    actions: 1,
    tags: ['control', 'harmful'],
    stacking: 'replace',
    duration: 1,
    timing: 'immediate',
    removable: false,
  });
  const hpBefore = p.hp;
  const res = round(p, b, 1);
  assert(p.hp < hpBefore, 'the end-of-round tick bit HP');
  assertEquals(
    res.lines.some((l) => l.includes('damage to you!')),
    false,
    'the stunned wolf never struck — the tick is the only HP loss',
  );
  assert(res.lines.some((l) => l.startsWith('⚡ ')), 'the broad trigger answers the tick');
  const bleed = b.effectInstances.find((i) => i.defId === 't_19:t0:e0');
  assertExists(bleed, 'the striker is bleeding');
  assertEquals(bleed.side, 'enemy');
  assertEquals(bleed.perRound, -3);
  assertEquals(b.procs?.['t_19:0']?.count, 1);
});

Deno.test('#89: cooldown 1 pins exact eligible rounds (R+1 blocked, R+2 re-arms)', () => {
  const run = (seed: number) => {
    const p = hero(22, 'warrior', 36, 't_19');
    const b = tankyForge(p, seed);
    const events: CombatEvent[] = [];
    setCombatTelemetry((e) => events.push(e));
    const procs: number[] = [];
    const hits: boolean[] = [];
    try {
      for (let r = 0; r < 3; r++) {
        p.hp = statsOf(p).maxHp; // survival is not the variable under test
        const res = round(p, b, seed);
        hits.push(p.hp < statsOf(p).maxHp); // the warden's strike reached HP
        if (res.lines.some((l) => l.startsWith('⚡ '))) procs.push(b.round - 1);
      }
    } finally {
      setCombatTelemetry(null);
    }
    return { b, events, procs, hits };
  };
  let found: ReturnType<typeof run> | undefined;
  for (let seed = 1; seed <= 300; seed++) {
    const r = run(seed);
    if (r.hits.every(Boolean) && r.procs.length === 2 && r.procs[0] === 1 && r.procs[1] === 3) {
      found = r;
      break;
    }
  }
  assertExists(found, 'no seed reproduces the exact cooldown-1 cadence');
  assertEquals(found.procs, [1, 3]);
  assertEquals(found.b.procs?.['t_19:0'], { count: 2, round: 3 });
  assertEquals(
    found.events.filter((e) => e.kind === 'procAttempt').length,
    2,
    'exactly the two successes emitted attempts — the blocked round emitted nothing',
  );
});

Deno.test('#89: unauthored cooldown answers every round (cooldown-0 contract)', () => {
  const run = (seed: number): number[] => {
    const p = hero(23, 'warrior', 5, 't_9');
    const b = tankyWolf(p, seed);
    const procs: number[] = [];
    for (let r = 0; r < 2; r++) {
      p.hp = statsOf(p).maxHp;
      const res = round(p, b, seed);
      if (res.lines.some((l) => l.startsWith('⚡ '))) procs.push(b.round - 1);
    }
    return procs;
  };
  let found = false;
  for (let seed = 1; seed <= 300; seed++) {
    if (run(seed).join(',') === '1,2') {
      found = true;
      break;
    }
  }
  assert(found, 't_9 (no cooldown field) may proc on consecutive rounds');
});

Deno.test('#89: missed chance rolls write nothing (no budget, no cooldown)', () => {
  const run = (seed: number) => {
    const p = hero(24, 'warrior', 5, 't_9');
    const b = tankyWolf(p, seed);
    const events: CombatEvent[] = [];
    setCombatTelemetry((e) => events.push(e));
    try {
      p.hp = statsOf(p).maxHp;
      const res = round(p, b, seed);
      return { b, res, events, hit: p.hp < statsOf(p).maxHp };
    } finally {
      setCombatTelemetry(null);
    }
  };
  let miss: ReturnType<typeof run> | undefined;
  for (let seed = 1; seed <= 300; seed++) {
    const r = run(seed);
    if (
      r.hit && !r.res.lines.some((l) => l.startsWith('⚡ ')) &&
      r.b.procs?.['t_9:0'] === undefined
    ) {
      miss = r;
      break;
    }
  }
  assertExists(miss, 'no seed reproduces a landed strike with a missed chance roll');
  assertEquals(miss.b.procs?.['t_9:0'], undefined, 'the miss wrote no bookkeeping at all');
  const attempts = miss.events.filter((e): e is Extract<CombatEvent, { kind: 'procAttempt' }> =>
    e.kind === 'procAttempt'
  );
  assertEquals(attempts.length, 1, 'the miss is recorded as exactly one attempt');
  assertEquals(attempts[0]!.success, false, 'a missed roll is a failure that consumed nothing');
});

Deno.test('#89: non-damaging openings scan nothing', () => {
  // Chrono Wisp's Chrono Anchor (#80) slows but never wounds — no HP-loss
  // scan runs, so neither reactive trigger kind may proc from an opening.
  for (const trinket of ['t_9', 't_19'] as const) {
    const p = hero(25, 'warrior', 25, trinket);
    const b = startBattle('e_chronowisp', ORIGIN, { player: p, rng: seeded(1) })!.battle;
    assertEquals(b.procs, undefined, `${trinket} procs nothing on a non-damaging opening`);
    assertEquals(
      b.effectInstances.some((i) => i.defId === trigId(trinket)),
      false,
      `${trinket} applied nothing at the opening`,
    );
  }
});

Deno.test('#89: hpDamaged telemetry carries cause, attacker, target, procProduced', () => {
  const s = reactiveSeed('t_19', 5, true);
  const p = hero(26, 'warrior', 5, 't_19');
  const b = tankyWolf(p, s);
  const events: CombatEvent[] = [];
  setCombatTelemetry((e) => events.push(e));
  try {
    round(p, b, s);
  } finally {
    setCombatTelemetry(null);
  }
  const hpEvents = events.filter((e): e is Extract<CombatEvent, { kind: 'hpDamaged' }> =>
    e.kind === 'hpDamaged'
  );
  const by = (cause: DamageCause, target: 'player' | 'enemy') =>
    hpEvents.filter((e) => e.cause === cause && e.target === target);
  assert(by('enemyAction', 'player').length >= 1, 'the wolf strike is provenance-tagged');
  assert(by('playerAction', 'enemy').length >= 1, 'the hero strike is provenance-tagged');
  assert(by('periodic', 'enemy').length >= 1, "the proc's bleed tick is provenance-tagged");
  assert(
    hpEvents.every((e) => e.amount > 0 && e.procProduced === false),
    'amounts are real post-shield HP loss; no content produces proc-produced damage today',
  );
});
