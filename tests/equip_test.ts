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
import { type CombatTraceEntry, type DamageCause } from '../src/engine/telemetry.ts';
import type { BattleState, ClassId, EffectInstance, PlayerState } from '../src/engine/types.ts';
import { ENEMIES } from '../src/content/enemies.ts';
import { item } from '../src/content/items.ts';
import { addItem } from '../src/engine/inventory.ts';
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
  const hpBefore = p.hp;
  const res = round(p, b, s);
  const events = res.trace;
  assertEquals(p.hp, hpBefore, 'the strike never reached HP');
  assertEquals(res.lines.some((l) => l.startsWith('⚡ ')), false);
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
    const events: CombatTraceEntry[] = [];
    const procs: number[] = [];
    const hits: boolean[] = [];
    for (let r = 0; r < 3; r++) {
      p.hp = statsOf(p).maxHp; // survival is not the variable under test
      const res = round(p, b, seed);
      events.push(...res.trace);
      hits.push(p.hp < statsOf(p).maxHp); // the warden's strike reached HP
      if (res.lines.some((l) => l.startsWith('⚡ '))) procs.push(b.round - 1);
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
    p.hp = statsOf(p).maxHp;
    const res = round(p, b, seed);
    return { b, res, events: res.trace, hit: p.hp < statsOf(p).maxHp };
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
  const attempts = miss.events.filter((
    e,
  ): e is Extract<CombatTraceEntry, { kind: 'procAttempt' }> => e.kind === 'procAttempt');
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
  const events = round(p, b, s).trace;
  const hpEvents = events.filter((e): e is Extract<CombatTraceEntry, { kind: 'hpDamaged' }> =>
    e.kind === 'hpDamaged'
  );
  const by = (cause: DamageCause, target: 'player' | 'enemy') =>
    hpEvents.filter((e) => e.cause === cause && e.target === target);
  assert(by('enemyAction', 'player').length >= 1, 'the wolf strike is provenance-tagged');
  assert(by('playerAction', 'enemy').length >= 1, 'the hero strike is provenance-tagged');
  assert(by('periodic', 'enemy').length >= 1, "the proc's bleed tick is provenance-tagged");
  assert(
    hpEvents.every((e) => e.hpLost > 0 && e.resolved >= e.hpLost && e.procProduced === false),
    'hpLost is the real applied HP loss (≤ the resolved blow, #106); no content produces proc-produced damage today',
  );
});

// ── #97: reactive equipment dispatches per actual HP-loss event ──────────

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

/** The Grudge Charm (broad onHpDamage) with gates removed: deterministic
 * always-proc, unlimited per battle, no cooldown. */
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
    run(hero(700, 'warrior', 5, 't_19'));
  } finally {
    charm.triggers = original;
  }
}

/** Procs recorded by the battle bookkeeping (successful reactive procs). */
const procCount = (b: BattleState): number => b.procs?.['t_19:0']?.count ?? 0;

/** Tanky rat for synthetic-move fixtures (#97): the mutated moves belong
 * to e_rat, so the fight must actually be against the rat. */
function tankyRat(p: PlayerState, seed: number): BattleState {
  const b = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(seed) })!.battle;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;
  return b;
}

Deno.test('#97: a two-hit enemy move answers onHpDamage twice', () => {
  ungatedGrudge((p) => {
    const rat = ENEMIES.find((e) => e.id === 'e_rat')!;
    withOverridden(rat, 'moves', [{
      name: 'Double Bite',
      weight: 1,
      effects: [
        { kind: 'damage', attack: 'phys', power: 1 },
        { kind: 'damage', attack: 'phys', power: 1 },
      ],
    }], () => {
      const b = tankyRat(p, 601);
      round(p, b, 601);
      assertEquals(
        procCount(b),
        2,
        'each ordered HP-loss event dispatches its own proc opportunity',
      );
    });
  });
});

Deno.test('#97: a cooldown trigger stays spent within the same round', () => {
  // Authored t_19: cooldown 1 — the second hit of one round cannot re-arm.
  const p = hero(701, 'warrior', 5, 't_19');
  const rat = ENEMIES.find((e) => e.id === 'e_rat')!;
  withOverridden(rat, 'moves', [{
    name: 'Double Bite',
    weight: 1,
    effects: [
      { kind: 'damage', attack: 'phys', power: 1 },
      { kind: 'damage', attack: 'phys', power: 1 },
    ],
  }], () => {
    const b = tankyRat(p, 602);
    round(p, b, 602);
    assertEquals(procCount(b), 1, 'cooldown gates the same-round second event');
  });
});

Deno.test('#97: damage followed by healing keeps its damage opportunity', () => {
  ungatedGrudge((p) => {
    p.hp = 40; // below max so the rider's heal can erase the net loss
    const rat = ENEMIES.find((e) => e.id === 'e_rat')!;
    withOverridden(rat, 'moves', [{
      name: 'Leeching Bite',
      weight: 1,
      effects: [
        { kind: 'damage', attack: 'phys', power: 1 },
        { kind: 'restore', target: 'opponent', hpPctOfMax: 0.5 },
      ],
    }], () => {
      const b = tankyRat(p, 603);
      round(p, b, 603);
      assertEquals(
        procCount(b),
        1,
        'net-positive HP movement never suppresses the real damage event',
      );
    });
  });
});

Deno.test('#97: a shield-only absorption never dispatches', () => {
  ungatedGrudge((p) => {
    const b = tankyRat(p, 604);
    grantShield(b, 'player', {
      defId: 'test:ward',
      name: 'Test Ward',
      kind: 'shield',
      side: 'player',
      source: { kind: 'skill', id: 'test', name: 'Test' },
      shieldAmount: 9999,
      tags: ['beneficial'],
      stacking: 'replace',
      duration: 9,
      timing: 'immediate',
      removable: true,
    });
    round(p, b, 604);
    assertEquals(procCount(b), 0, 'no HP reached flesh — no HP-loss event existed');
  });
});

Deno.test('#97: Phoenix revival lets the lethal event answer — once', () => {
  const p = hero(705, 'warrior', 5, 't_19');
  addItem(p, 'c_phoenix_feather', 1);
  const rat = ENEMIES.find((e) => e.id === 'e_rat')!;
  withOverridden(rat, 'moves', [{
    name: 'Death Bite',
    weight: 1,
    effects: [{ kind: 'damage', attack: 'phys', power: 9999 }],
  }], () => {
    const b = tankyRat(p, 605);
    round(p, b, 605);
    assert(p.hp > 0, 'the Cinder revived the wearer');
    assertEquals(
      procCount(b),
      1,
      'a synchronously revived wearer still answers the lethal HP-loss event',
    );
  });
});

Deno.test('#97: opening strikes answer broad triggers per event, never narrow ones', () => {
  const rat = ENEMIES.find((e) => e.id === 'e_rat')!;
  withOverridden(rat, 'opening', {
    name: 'Probe Strike',
    effects: [{ kind: 'damage', attack: 'phys', power: 1 }],
  }, () => {
    // Narrow trigger: an opening is not a direct enemy action — silent.
    const narrow = hero(706, 'warrior', 5, 't_9');
    const bn = tankyRat(narrow, 606);
    assertEquals(bn.procs?.['t_9:0'], undefined, 'narrow trigger never answers an opening');

    // Broad trigger: each opening HP loss dispatches (ungated → exactly 1).
    ungatedGrudge((p) => {
      const b = tankyRat(p, 607);
      assertEquals(procCount(b), 1, 'the broad trigger answered the opening strike');
    });
  });
});

Deno.test('#97: proc-produced damage never re-dispatches (recursion bound)', () => {
  // The proc's own effect damages the WEARER — #109 makes `target: 'self'`
  // real, so the HP loss genuinely lands on the player: that loss is
  // proc-produced and must not trigger equipment again. Without the
  // structural bound this fixture recurses forever (each self-wound would
  // re-proc the next).
  const charm = item('t_19')!;
  const original = charm.triggers;
  charm.triggers = [{
    name: 'Backlash',
    trigger: 'onHpDamage',
    effects: [{ kind: 'damage', attack: 'phys', power: 1, target: 'self' }],
    desc: 'test fixture: the proc itself wounds the wearer',
  }];
  try {
    const p = hero(707, 'warrior', 20, 't_19');
    p.hp = 99999; // survive the self-wound loop would-be
    const b = tankyRat(p, 608);
    const hpBefore = p.hp;
    const res = round(p, b, 608);
    assertEquals(procCount(b), 1, 'the proc-produced self-damage never re-triggered');
    assert(p.hp < hpBefore, 'the self-damage REALLY wounded the wearer (#109), not the foe');
    const selfWounds = res.trace.filter((
      e,
    ): e is Extract<CombatTraceEntry, { kind: 'hpDamaged' }> =>
      e.kind === 'hpDamaged' && e.attacker === 'player' && e.target === 'player'
    );
    assert(selfWounds.length >= 1, 'the trace names the wearer as BOTH attacker and target');
    assert(
      selfWounds.every((e) => e.procProduced),
      'the self-wound is marked proc-produced',
    );
  } finally {
    charm.triggers = original;
  }
});

// ── #103: terminal HP stops the reactive scan immediately ────────────────

Deno.test('#103: a lethal trigger ends the scan — the next trigger never draws', () => {
  const charm = item('t_19')!;
  const original = charm.triggers;
  const lethalFirst: typeof charm.triggers = [
    {
      name: 'Killing Blow',
      trigger: 'onHpDamage',
      effects: [{ kind: 'damage', attack: 'phys', power: 9999 }],
      desc: 'test fixture: the first trigger fells the foe',
    },
    {
      name: 'Never Inspected',
      trigger: 'onHpDamage',
      chance: 0.99,
      effects: [{
        kind: 'statmod',
        target: 'opponent',
        stat: 'spd',
        pct: -0.5,
        duration: 2,
        timing: 'immediate',
        name: 'Never Slow',
      }],
      desc: 'test fixture: must never be evaluated after a terminal transition',
    },
  ];
  /** Full round under a counting RNG (same underlying seed per run, so the
   * draw streams of both configurations stay aligned up to the scan). */
  const run = (seed: number, triggers: typeof charm.triggers) => {
    charm.triggers = triggers;
    const p = hero(708, 'warrior', 20, 't_19');
    p.hp = 99999; // the rat's reply is not the variable — only the scan is
    let draws = 0;
    const base = seeded(seed);
    const counting = () => {
      draws++;
      return base();
    };
    const b = startBattle('e_rat', ORIGIN, { player: p, rng: counting })!.battle;
    const before = draws;
    b.enemy.hp = 99999;
    b.enemy.maxHp = 99999;
    p.battle = b;
    const res = performAction(p, b, { kind: 'attack' }, counting);
    return { draws: draws - before, res, b };
  };
  try {
    // A seed where the rat's reply drew blood (the scan ran and the first
    // trigger felled the padded foe — the player strike never could).
    let seed = 0;
    let probe: ReturnType<typeof run> | undefined;
    while (seed++ < 300 && !probe) {
      const r = run(seed, lethalFirst);
      if (r.res.outcome === 'victory') probe = r;
    }
    assert(probe, 'no seed reproduced a trigger kill');
    // The control wears ONLY the lethal trigger: identical state, seed and
    // draws up to the scan, nothing left to draw afterwards.
    const control = run(seed, [lethalFirst[0]!]);
    assertEquals(
      probe.draws,
      control.draws,
      'the skipped trigger consumed no RNG draw of any kind',
    );
    const attempts = probe.res.trace.filter((
      e,
    ): e is Extract<CombatTraceEntry, { kind: 'procAttempt' }> => e.kind === 'procAttempt');
    assertEquals(attempts.length, 1, 'only the first trigger recorded an attempt');
    assertEquals(attempts[0]!.trigger, 'Killing Blow');
    assertEquals(
      probe.b.effectInstances.some((i) => i.name === 'Never Slow'),
      false,
      'the skipped trigger applied no effect',
    );
    assertEquals(probe.b.procs?.['t_19:0']?.count, 1, 'the first trigger procs once');
    assertEquals(probe.b.procs?.['t_19:1'], undefined, 'the second trigger wrote no bookkeeping');
  } finally {
    charm.triggers = original;
  }
});

Deno.test('#103: non-terminal multi-trigger order stays deterministic', () => {
  const charm = item('t_19')!;
  const original = charm.triggers;
  charm.triggers = [
    {
      name: 'First Sap',
      trigger: 'onHpDamage',
      effects: [{
        kind: 'statmod',
        target: 'opponent',
        stat: 'atk',
        pct: -0.1,
        duration: 2,
        timing: 'immediate',
        name: 'First Mark',
      }],
      desc: 'test fixture: fires first in authored order',
    },
    {
      name: 'Second Bleed',
      trigger: 'onHpDamage',
      effects: [{
        kind: 'periodic',
        target: 'opponent',
        perRound: -2,
        duration: 2,
        tickPhase: 'roundEnd',
        name: 'Second Bleed',
        tags: ['bleed', 'harmful'],
      }],
      desc: 'test fixture: fires second in authored order',
    },
  ];
  try {
    // A seed where the rat's reply drew blood and BOTH triggers fired.
    let found: { res: ReturnType<typeof round>; b: BattleState } | undefined;
    for (let s = 1; s <= 300 && !found; s++) {
      const p = hero(709, 'warrior', 20, 't_19');
      p.hp = 99999;
      const b = tankyRat(p, s);
      const res = round(p, b, s);
      if (
        b.effectInstances.some((i) => i.name === 'First Mark') &&
        b.effectInstances.some((i) => i.name === 'Second Bleed')
      ) {
        found = { res, b };
      }
    }
    assert(found, 'no seed fired both non-terminal triggers');
    const attempts = found.res.trace.filter((
      e,
    ): e is Extract<CombatTraceEntry, { kind: 'procAttempt' }> => e.kind === 'procAttempt');
    assertEquals(
      attempts.map((a) => a.trigger),
      ['First Sap', 'Second Bleed'],
      'authored order is preserved when combat continues',
    );
    assertEquals(found.b.procs?.['t_19:0']?.count, 1);
    assertEquals(found.b.procs?.['t_19:1']?.count, 1);
  } finally {
    charm.triggers = original;
  }
});

// ── #109: explicit damage targets are honored verbatim ───────────────────

/** Extracts hpDamaged entries from a trace. */
function hpEvents(trace: CombatTraceEntry[]): Extract<CombatTraceEntry, { kind: 'hpDamaged' }>[] {
  return trace.filter((
    e,
  ): e is Extract<CombatTraceEntry, { kind: 'hpDamaged' }> => e.kind === 'hpDamaged');
}

Deno.test('#109: player-authored self-damage wounds the wearer, never the foe', () => {
  const charm = item('t_19')!;
  const original = charm.triggers;
  charm.triggers = [{
    name: 'Blood Toll',
    trigger: 'battleStart',
    effects: [{ kind: 'damage', attack: 'phys', power: 1, target: 'self' }],
    desc: 'test fixture: the bearer pays blood as the battle opens',
  }];
  try {
    const p = hero(800, 'warrior', 20, 't_19');
    p.hp = statsOf(p).maxHp;
    const full = p.hp;
    const res = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(801) })!;
    assert(p.hp < full, 'the recoil reduced the wearer’s HP');
    assertEquals(res.battle.enemy.hp, res.battle.enemy.maxHp, 'the foe is untouched');
    const wounds = hpEvents(res.trace);
    assertEquals(wounds.length, 1, 'exactly one HP-loss event');
    assertEquals(wounds[0]!.attacker, 'player', 'the trace names the actual attacker');
    assertEquals(wounds[0]!.target, 'player', 'the trace names the actual target');
  } finally {
    charm.triggers = original;
  }
});

Deno.test('#109: player self-damage routes through the wearer’s own ward', () => {
  const charm = item('t_19')!;
  const original = charm.triggers;
  charm.triggers = [{
    name: 'Blood Toll',
    trigger: 'onGuard',
    effects: [{ kind: 'damage', attack: 'phys', power: 1, target: 'self' }],
    desc: 'test fixture: bracing costs blood',
  }];
  try {
    const p = hero(802, 'warrior', 20, 't_19');
    p.hp = statsOf(p).maxHp;
    const full = p.hp;
    const b = tankyRat(p, 803);
    grantShield(b, 'player', {
      defId: 'test:ward',
      name: 'Test Ward',
      kind: 'shield',
      side: 'player',
      source: { kind: 'skill', id: 'test', name: 'Test' },
      shieldAmount: 9999,
      tags: ['beneficial'],
      stacking: 'replace',
      duration: 9,
      timing: 'immediate',
      removable: true,
    });
    const wardBefore = b.shield.player;
    const res = performAction(p, b, { kind: 'guard' }, seeded(803));
    assertEquals(p.hp, full, 'the ward absorbed the recoil — no HP reached flesh');
    assert(b.shield.player < wardBefore, 'the recoil pooled into the wearer’s OWN ward');
    assertEquals(hpEvents(res.trace).length, 0, 'shield-only absorbs emit nothing');
  } finally {
    charm.triggers = original;
  }
});

Deno.test('#109: enemy-authored self-damage wounds the foe, never the wearer', () => {
  const rat = ENEMIES.find((e) => e.id === 'e_rat')!;
  withOverridden(rat, 'opening', {
    name: 'Self Lash',
    effects: [{ kind: 'damage', attack: 'phys', power: 1, target: 'self' }],
  }, () => {
    const p = hero(804, 'warrior', 5);
    p.hp = statsOf(p).maxHp;
    const full = p.hp;
    const res = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(805) })!;
    assert(res.battle.enemy.hp < res.battle.enemy.maxHp, 'the foe wounded ITSELF');
    assertEquals(p.hp, full, 'the wearer is untouched');
    const wounds = hpEvents(res.trace);
    assertEquals(wounds.length, 1);
    assertEquals(wounds[0]!.attacker, 'enemy', 'the trace names the actual attacker');
    assertEquals(wounds[0]!.target, 'enemy', 'the trace names the actual target');
  });
});

Deno.test('#109: lethal enemy self-damage ends the fight as a victory', () => {
  const rat = ENEMIES.find((e) => e.id === 'e_rat')!;
  withOverridden(rat, 'opening', {
    name: 'Death Spiral',
    effects: [{ kind: 'damage', attack: 'phys', power: 9999, target: 'self' }],
  }, () => {
    const p = hero(806, 'warrior', 5);
    p.hp = statsOf(p).maxHp;
    const full = p.hp;
    const res = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(807) })!;
    assertEquals(res.outcome, 'victory', 'a self-felled foe is a won fight');
    assertEquals(res.battle.enemy.hp, 0);
    assertEquals(p.hp, full, 'the wearer never lost HP');
    const terminal = res.trace.find((e) => e.kind === 'terminal');
    assertExists(terminal, 'the opening adjudication recorded the terminal state');
  });
});

Deno.test('#109: lethal player self-damage obeys the immediate-revival contract', () => {
  const charm = item('t_19')!;
  const original = charm.triggers;
  charm.triggers = [{
    name: 'Final Toll',
    trigger: 'onHpDamage',
    maxProcs: 1,
    effects: [{ kind: 'damage', attack: 'phys', power: 9999, target: 'self' }],
    desc: 'test fixture: the first HP loss pays everything',
  }];
  try {
    // With the Cinder: the self-inflicted lethal blow intercepts — the same
    // immediate revival any enemy hit enjoys (#104), once.
    const revived = hero(808, 'warrior', 5, 't_19');
    revived.hp = statsOf(revived).maxHp;
    addItem(revived, 'c_phoenix_feather', 1);
    const br = tankyRat(revived, 809);
    const hpBefore = revived.hp;
    round(revived, br, 809);
    assert(revived.hp > 0, 'the Cinder revived the wearer from the self-inflicted blow');
    assert(revived.hp < hpBefore, 'the revival restored half, not everything');
    // Without the Cinder: the same recoil is terminal — and nothing later
    // in the resolution escapes the stop (#103).
    const mortal = hero(810, 'warrior', 5, 't_19');
    const bm = tankyRat(mortal, 811);
    const res = round(mortal, bm, 811);
    assertEquals(mortal.hp, 0, 'unrevived self-damage is lethal');
    assertEquals(res.outcome, 'defeat');
  } finally {
    charm.triggers = original;
  }
});
