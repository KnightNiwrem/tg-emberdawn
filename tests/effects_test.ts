/** #78 acceptance tests: data-driven effect instances.
 *
 * Covers the issue's core contracts that the ported parity tests don't
 * already pin: different sources coexisting on one stat, explicit
 * same-source stacking policies, strongest-wins saps, tag-driven cleanse
 * respecting unremovable conditions, periodic ticking/expiry, control
 * consumption, and the v5→v6 save migration. */

import { assert, assertEquals } from '@std/assert';
import {
  createPlayer,
  CURRENT_STATE_VERSION,
  migratePlayer,
  statsOf,
} from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { applyInstance, sapPct, statPct } from '../src/engine/effects.ts';
import type { EffectInstance } from '../src/engine/types.ts';
import { injectMod, modInstance, seeded } from './helpers.ts';

Deno.test('effects: different sources on one stat coexist and fold additively (#78)', () => {
  const p = createPlayer(501, 'T', 'warrior');
  p.level = 30;
  p.skills.push('sk_war_cry');
  p.mp = 999;
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;
  // A second ATK source (as Adrenaline would contribute) is injected: under
  // the old fixed slots this would have fused or overwritten.
  injectMod(b, 'player', 'atk', 0.2, { defId: 'sk_adrenaline', name: 'Adrenaline Surge' });
  performAction(p, b, { kind: 'skill', skillId: 'sk_war_cry' }, seeded(51));
  assertEquals(
    b.effectInstances.filter((i) => i.stat === 'atk').length,
    2,
    'two independent ATK instances',
  );
  assertEquals(
    statPct(b, 'player', 'atk'),
    0.55,
    '+35% (War Cry) + +20% (second source), additive',
  );
});

Deno.test('effects: same-source policies are explicit — replace vs stack (#78)', () => {
  const p = createPlayer(502, 'T', 'warrior');
  p.level = 40;
  p.skills.push('sk_war_cry', 'sk_adrenaline');
  p.mp = 999;
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;

  // War Cry: authored 'replace' — recasting retires the prior instance and
  // applies a fresh one (same magnitude, renewed clock).
  performAction(p, b, { kind: 'skill', skillId: 'sk_war_cry' }, seeded(52));
  performAction(p, b, { kind: 'attack' }, seeded(53));
  const firstExpiry = b.effectInstances.find((i) => i.defId === 'sk_war_cry')!.expiresRound;
  delete b.cooldowns['sk_war_cry'];
  performAction(p, b, { kind: 'skill', skillId: 'sk_war_cry' }, seeded(54));
  assertEquals(
    b.effectInstances.filter((i) => i.defId === 'sk_war_cry').length,
    1,
    'replace retires the prior same-source instance',
  );
  assert(
    b.effectInstances.find((i) => i.defId === 'sk_war_cry')!.expiresRound > firstExpiry,
    'recast renews the clock',
  );

  // Adrenaline: authored 'stack' — recasting adds an independent +20% ATK.
  p.hp = 10; // let the heal component land
  performAction(p, b, { kind: 'skill', skillId: 'sk_adrenaline' }, seeded(55));
  delete b.cooldowns['sk_adrenaline'];
  p.hp = 10;
  performAction(p, b, { kind: 'skill', skillId: 'sk_adrenaline' }, seeded(56));
  assertEquals(
    b.effectInstances.filter((i) => i.defId === 'sk_adrenaline').length,
    2,
    'stack adds an independent contribution',
  );
  assertEquals(statPct(b, 'player', 'atk'), 0.75, 'War Cry 0.35 + Adrenaline 0.2 + 0.2');
});

Deno.test('effects: saps share one slot with strongest-wins (#78)', () => {
  const p = createPlayer(503, 'T', 'warrior');
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  p.battle = b;
  const sap = (pct: number): void => {
    applyInstance(b, {
      defId: 'sap',
      name: 'Sapped',
      kind: 'statmod',
      side: 'player',
      source: { kind: 'skill', id: 'sk_venom_cut', name: 'Venom Cut' },
      stat: 'outgoing',
      pct: -pct,
      tags: ['harmful'],
      stacking: 'strongest',
      duration: 3,
      timing: 'immediate',
      removable: true,
    });
  };
  sap(0.15);
  assertEquals(sapPct(b, 'player'), 0.15);
  sap(0.3);
  assertEquals(
    b.effectInstances.filter((i) => i.defId === 'sap').length,
    1,
    'the stronger sap supersedes, not stacks beside',
  );
  assertEquals(sapPct(b, 'player'), 0.3);
  sap(0.15);
  assertEquals(
    b.effectInstances.filter((i) => i.defId === 'sap').length,
    1,
    'a weaker recast never downgrades',
  );
  assertEquals(sapPct(b, 'player'), 0.3);
});

Deno.test('effects: tagged cleanse removes harmful removable, never encounter conditions (#78)', () => {
  const p = createPlayer(504, 'T', 'cleric');
  p.level = 45;
  p.skills.push('sk_miracle');
  p.mp = 999;
  p.hp = 10;
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;
  // A removable sap + an unremovable (encounter) condition.
  injectMod(b, 'player', 'outgoing', -0.2, { defId: 'sap', name: 'Sapped' });
  injectMod(b, 'player', 'spd', -0.5, { defId: 'encounter:bog', name: 'Bogged', removable: false });
  // The wolf must not reply — a Howl sap landing after the cleanse would
  // muddy the assertions below. Stun it for this round; the enemy phase
  // consumes the control instance like any other.
  b.effectSeq++;
  b.effectInstances.push({
    iid: 't3',
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
  performAction(p, b, { kind: 'skill', skillId: 'sk_miracle' }, seeded(57));
  assertEquals(p.hp, statsOf(p).maxHp, 'Miracle fully restores');
  assertEquals(sapPct(b, 'player'), 0, 'the removable sap is cleansed');
  assertEquals(modInstance(b, 'player', 'outgoing'), undefined);
  assertEquals(statPct(b, 'player', 'spd'), -0.5, 'the unremovable condition survives');
});

Deno.test('effects: periodic roundEnd effects tick, then expire (#78)', () => {
  const p = createPlayer(505, 'T', 'warrior');
  p.level = 20;
  const b = startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' })!;
  p.battle = b;
  // Synthetic Poison (no content ships DoTs yet — vocabulary proof): 5/round.
  b.effectSeq++;
  const poison: EffectInstance = {
    iid: 't1',
    defId: 'poison',
    name: 'Poison',
    side: 'enemy',
    source: { kind: 'skill', id: 'test', name: 'test fixture' },
    kind: 'periodic',
    perRound: -5,
    tickPhase: 'roundEnd',
    tags: ['harmful', 'periodic', 'poison'],
    stacking: 'replace',
    appliedRound: b.round,
    remaining: 2,
    removable: true,
    expiresRound: b.round + 1,
  };
  b.effectInstances.push(poison);
  const hpBefore = b.enemy.hp;
  performAction(p, b, { kind: 'guard' }, seeded(58));
  assertEquals(b.enemy.hp, hpBefore - 5, 'tick 1 at end of round');
  performAction(p, b, { kind: 'guard' }, seeded(59));
  assertEquals(b.enemy.hp, hpBefore - 10, 'tick 2 (its last remaining tick still fires)');
  performAction(p, b, { kind: 'guard' }, seeded(60));
  assertEquals(b.enemy.hp, hpBefore - 10, 'expired — no further ticks');
  assertEquals(b.effectInstances.filter((i) => i.defId === 'poison').length, 0, 'instance pruned');
});

Deno.test('effects: control instances consume the target\u2019s actions (#78)', () => {
  const p = createPlayer(506, 'T', 'warrior');
  const b = startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' })!;
  p.battle = b;
  b.effectInstances.push({
    iid: 't2',
    defId: 'test:stun',
    name: 'Stunned',
    side: 'player',
    source: { kind: 'legacy', id: 'test', name: 'test fixture' },
    kind: 'control',
    control: 'stun',
    actions: 2,
    tags: ['harmful', 'control'],
    stacking: 'replace',
    appliedRound: b.round,
    remaining: 2,
    removable: true,
    expiresRound: b.round,
  });
  const r1 = performAction(p, b, { kind: 'attack' }, seeded(61));
  assertEquals(r1.skipped, true, 'stun consumes action 1');
  assert(r1.lines.some((l) => l.includes('stunned')));
  const r2 = performAction(p, b, { kind: 'attack' }, seeded(62));
  assertEquals(r2.skipped, true, 'stun consumes action 2');
  const r3 = performAction(p, b, { kind: 'attack' }, seeded(63));
  assertEquals(r3.skipped, false, 'control exhausted — actions resume');
  assertEquals(
    b.effectInstances.filter((i) => i.kind === 'control').length,
    0,
    'consumed and removed',
  );
});

Deno.test('migratePlayer: v5 in-flight battles map CombatBuffs to effect instances (#78)', () => {
  const p = createPlayer(507, 'T', 'cleric');
  p.stateVersion = 5;
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  // Simulate a v5 battle mid-fight: Blessing legs, a sap, a live enemy stun.
  const rec = b as unknown as Record<string, unknown>;
  rec.buffs = {
    atkPct: 0,
    defPct: 0.3,
    resPct: 0,
    magPct: 0.3,
    spdPct: 0,
    durations: { def: 2, mag: 3 },
    weakenedPct: 0.15,
    weakenTurns: 1,
    enemyWeakenedPct: 0,
    enemyWeakenTurns: 0,
    stunnedTurns: 0,
    stunnedEnemy: true,
  };
  rec.effects = [
    {
      key: 'mag',
      id: 'sk_blessing',
      name: 'Blessing',
      side: 'player',
      magnitude: '+30% MAG',
      source: 'Blessing',
      expiresRound: b.round + 2,
    },
    {
      key: 'def',
      id: 'sk_blessing',
      name: 'Blessing',
      side: 'player',
      magnitude: '+30% DEF',
      source: 'Blessing',
      expiresRound: b.round + 1,
    },
  ];
  const hpBefore = b.enemy.hp;
  const cooldownsBefore = { ...b.cooldowns };
  const historyBefore = b.history.length;
  p.battle = b;
  migratePlayer(p);
  assertEquals(p.stateVersion, CURRENT_STATE_VERSION);
  // Aggregates became instances with magnitudes and remaining rounds intact.
  assertEquals(statPct(b, 'player', 'mag'), 0.3);
  assertEquals(statPct(b, 'player', 'def'), 0.3);
  assertEquals(sapPct(b, 'player'), 0.15);
  const enemyStun = b.effectInstances.find((i) => i.kind === 'control' && i.side === 'enemy');
  assert(enemyStun, 'the stunned-enemy flag became a control instance');
  assertEquals(enemyStun.actions, 1);
  // Identity carried over from the old display entries.
  assertEquals(modInstance(b, 'player', 'mag')!.name, 'Blessing');
  // Legacy fields stripped; mechanics preserved.
  assertEquals(rec.buffs, undefined);
  assertEquals(rec.effects, undefined);
  assertEquals(b.enemy.hp, hpBefore, 'enemy HP preserved');
  assertEquals(b.cooldowns, cooldownsBefore, 'cooldowns preserved');
  assertEquals(b.history.length, historyBefore, 'history preserved');
  // The battle stays playable: the migrated stun is consumed by the next
  // enemy phase like any other control instance.
  const res = performAction(p, b, { kind: 'guard' }, seeded(64));
  assert(res.lines.some((l) => l.includes('stunned and cannot act')), 'migrated stun fires once');
});
