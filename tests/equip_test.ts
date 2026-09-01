/** Triggered equipment effects (#82): battleStart openings resolve once
 * inside the #80 pipeline (success AND failure both recorded), reactive
 * onHpDamage/onGuard procs respect maxProcs/cooldown/chance with
 * battle-local JSON-serializable bookkeeping, periodic ticks and
 * shield-only absorbs never proc, forge temper never scales proc data,
 * and the UI derives exact mechanics from the trigger fields. */

import { assert, assertEquals, assertExists } from '@std/assert';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { applyInstance, grantShield, incomingAmpPct } from '../src/engine/effects.ts';
import type { BattleState, ClassId, EffectInstance, PlayerState } from '../src/engine/types.ts';
import { item } from '../src/content/items.ts';
import { renderEquipment, renderItemDetail, triggerDisclosure } from '../src/render/menus.ts';
import { seeded } from './helpers.ts';

const ORIGIN = { kind: 'explore', zoneId: 'whisperwood' } as const;

function hero(id: number, classId: ClassId, level: number, trinket?: string): PlayerState {
  const p = createPlayer(id, 'T', classId);
  p.level = level;
  if (trinket) p.equipment.trinket = trinket;
  return p;
}

/** Tanky wolf so multi-round fights survive the hero's strikes. */
function tankyWolf(p: PlayerState, seed: number): BattleState {
  const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(seed) })!;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;
  return b;
}

/** The Warden of the Void actually scratches a high-level warrior — the
 * whisperwood wolf cannot (mitigation eats the whole bite), so late-band
 * proc tests fight the endgame elite instead. */
const ABYSS = { kind: 'explore', zoneId: 'abyss' } as const;

function tankyWarden(p: PlayerState, seed: number): BattleState {
  const b = startBattle('e_warden', ABYSS, { player: p, rng: seeded(seed) })!;
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
    const res = round(p, b, s);
    if (res.lines.some((l) => l.startsWith('⚡ ')) === wantProc) return s;
  }
  throw new Error(`no ${wantProc ? 'proc' : 'miss'} seed found for ${trinket}`);
}

/** A seed under which the trinket's battleStart roll (un)applies. */
function openingSeed(trinket: string, level: number, wantApplied: boolean): number {
  for (let s = 1; s <= 200; s++) {
    const p = hero(900 + s, 'warrior', level, trinket);
    const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(s) })!;
    if (b.effectInstances.some((i) => i.defId === trinket) === wantApplied) return s;
  }
  throw new Error(`no ${wantApplied ? 'success' : 'failure'} opening seed for ${trinket}`);
}

Deno.test('#82: battleStart trigger wards the wearer through the opening', () => {
  const p = hero(1, 'warrior', 28, 't_15');
  const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(1) })!;
  const ward = b.effectInstances.find((i) => i.defId === 't_15');
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
  const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(s) })!;
  assertEquals(b.effectInstances.some((i) => i.defId === 't_7'), false);
  const fizzles = b.opening?.lines.filter((l) => l.includes('roll missed')) ?? [];
  assertEquals(fizzles.length, 1, 'the miss is logged once — outcome persistence');
  assert(fizzles[0]!.includes('Keen Fracture'));
  assertEquals(b.shield.player, 0);
});

Deno.test('#82: battleStart success applies the typed effect once', () => {
  const s = openingSeed('t_7', 32, true);
  const p = hero(3, 'warrior', 32, 't_7');
  const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(s) })!;
  const exposed = b.effectInstances.find((i) => i.defId === 't_7');
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
  })!;
  const b = startBattle('e_wolf', ORIGIN, {
    player: hero(5, 'warrior', 28, 't_15'),
    rng: seeded(11),
  })!;
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
  const bleed = b.effectInstances.find((i) => i.defId === 't_9');
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
  assertEquals(p.hp, hpBefore, 'the strike never reached HP');
  assertEquals(res.lines.some((l) => l.startsWith('⚡ ')), false);
  assertEquals(b.procs?.['t_9:0']?.count ?? 0, 0);
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

Deno.test('#82: cooldown spaces reactive procs apart', () => {
  const run = (seed: number): { rounds: number[]; count: number } => {
    const p = hero(10, 'warrior', 36, 't_16');
    const b = tankyWarden(p, seed);
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
      procRounds[i]! - procRounds[i - 1]! >= 2,
      `procs at rounds ${procRounds[i - 1]} and ${procRounds[i]} respect the 2-round cooldown`,
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
  return b.effectInstances.find((i) => i.defId === trinket)!;
}

Deno.test('#82: forge temper never scales proc data', () => {
  const s = reactiveSeed('t_16', 36, true, tankyWarden);
  const base = procInstance('t_16', 36, s, false, tankyWarden);
  const tempered = procInstance('t_16', 36, s, true, tankyWarden);
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
      const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(s) })!;
      if (
        b.effectInstances.some((i) => i.defId === 't_7') &&
        b.effectInstances.some((i) => i.defId === 'sk_expose_weakness')
      ) {
        return s;
      }
    }
    throw new Error('no both-success seed');
  };
  const s = both();
  const p = hero(13, 'rogue', 45, 't_7');
  p.skills.push('sk_expose_weakness');
  const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(s) })!;
  const lens = b.effectInstances.find((i) => i.defId === 't_7')!;
  const sk = b.effectInstances.find((i) => i.defId === 'sk_expose_weakness')!;
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
  assert(caldera.includes('2-round cooldown'));
  assert(caldera.includes('up to 3×/battle'));
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
