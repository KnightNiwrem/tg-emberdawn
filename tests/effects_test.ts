/** #78/#90 acceptance tests: data-driven effect instances.
 *
 * Covers the issues' core contracts that the ported parity tests don't
 * already pin: different sources coexisting on one stat, explicit
 * same-source stacking policies, strongest-wins saps, tag-driven cleanse
 * respecting unremovable conditions, periodic ticking/expiry, control
 * consumption, the v5→v6 save migration, and #90's stable per-effect
 * identity plus atomic reapplication semantics. */

import { assert, assertEquals } from '@std/assert';
import {
  createPlayer,
  CURRENT_STATE_VERSION,
  migratePlayer,
  statsOf,
} from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import {
  applyInstance,
  effectDefId,
  type InstanceSeed,
  sapPct,
  settleEndOfRound,
  statPct,
} from '../src/engine/effects.ts';
import type { EffectInstance } from '../src/engine/types.ts';
import type { EffectSpec } from '../src/content/types.ts';
import { ENEMIES } from '../src/content/enemies.ts';
import { ITEMS } from '../src/content/items.ts';
import { SKILLS } from '../src/content/skills.ts';
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
  const firstExpiry = b.effectInstances.find((i) => i.defId === 'sk_war_cry:e0')!.expiresRound;
  delete b.cooldowns['sk_war_cry'];
  performAction(p, b, { kind: 'skill', skillId: 'sk_war_cry' }, seeded(54));
  assertEquals(
    b.effectInstances.filter((i) => i.defId === 'sk_war_cry:e0').length,
    1,
    'replace retires the prior same-source instance',
  );
  assert(
    b.effectInstances.find((i) => i.defId === 'sk_war_cry:e0')!.expiresRound > firstExpiry,
    'recast renews the clock',
  );

  // Adrenaline: authored 'stack' — recasting adds an independent +20% ATK.
  p.hp = 10; // let the heal component land
  performAction(p, b, { kind: 'skill', skillId: 'sk_adrenaline' }, seeded(55));
  delete b.cooldowns['sk_adrenaline'];
  p.hp = 10;
  performAction(p, b, { kind: 'skill', skillId: 'sk_adrenaline' }, seeded(56));
  assertEquals(
    b.effectInstances.filter((i) => i.defId === 'sk_adrenaline:e1').length,
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
      source: { kind: 'legacy', id: 'test', name: 'test sap fixture' },
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

// ── #90: stable per-effect identity and atomic reapplication ──────────

Deno.test('#90: derived stacking identity is per-effect, trigger-aware, sap-collapsing', () => {
  const statmod: EffectSpec = {
    kind: 'statmod',
    stat: 'atk',
    pct: 0.1,
    duration: 2,
    timing: 'immediate',
  };
  assertEquals(effectDefId('sk_x', undefined, 0, statmod), 'sk_x:e0');
  assertEquals(effectDefId('sk_x', undefined, 1, statmod), 'sk_x:e1');
  assertEquals(effectDefId('t_9', 0, 0, statmod), 't_9:t0:e0');
  assertEquals(effectDefId('t_9', 1, 0, statmod), 't_9:t1:e0');
  assertEquals(effectDefId('t_9', 0, 2, statmod), 't_9:t0:e2');
  const sap: EffectSpec = {
    kind: 'statmod',
    stat: 'outgoing',
    pct: -0.2,
    duration: 2,
    timing: 'immediate',
  };
  assertEquals(effectDefId('sk_any', undefined, 0, sap), 'sap', 'saps share one slot (#77)');
  assertEquals(effectDefId('t_9', 1, 0, sap), 'sap', 'saps collapse across triggers too');
});

const isSapSpec = (sp: EffectSpec): boolean =>
  sp.kind === 'statmod' && sp.stat === 'outgoing' && (sp.pct ?? 0) < 0;

Deno.test('#90: content integrity — derived keys never collide within one source', () => {
  const check = (
    label: string,
    sourceId: string,
    triggerIndex: number | undefined,
    specs: readonly EffectSpec[],
  ): void => {
    for (let i = 0; i < specs.length; i++) {
      for (let j = i + 1; j < specs.length; j++) {
        const ki = effectDefId(sourceId, triggerIndex, i, specs[i]!);
        const kj = effectDefId(sourceId, triggerIndex, j, specs[j]!);
        if (ki === kj) {
          assert(
            isSapSpec(specs[i]!) && isSapSpec(specs[j]!),
            `${label}: only saps may share a stacking slot (${ki})`,
          );
        }
      }
    }
  };
  for (const sk of SKILLS) check(`skill ${sk.id}`, sk.id, undefined, sk.effects);
  for (const it of ITEMS) {
    it.triggers?.forEach((tg, ti) => check(`item ${it.id} trigger ${ti}`, it.id, ti, tg.effects));
  }
  for (const en of ENEMIES) {
    for (const mv of en.moves) {
      check(`enemy ${en.id} move ${mv.name}`, mv.name, undefined, mv.effects);
    }
    if (en.opening) check(`enemy ${en.id} opening`, en.id, undefined, en.opening.effects);
  }
});

Deno.test('#90: refresh is an atomic rebuild — payload and clock renew together', () => {
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  const base: InstanceSeed = {
    defId: 'test:refresh',
    name: 'Old Brand',
    kind: 'statmod',
    side: 'player',
    source: { kind: 'skill', id: 'sk_a', name: 'A' },
    stat: 'atk',
    pct: 0.1,
    tags: ['beneficial'],
    stacking: 'refresh',
    duration: 3,
    timing: 'defer',
    removable: true,
  };
  const first = applyInstance(b, base);
  assertEquals(first.name, 'Old Brand');
  assertEquals(first.deferFirstTick, true);

  const recast = applyInstance(b, {
    ...base,
    name: 'New Brand',
    pct: 0.2,
    duration: 2,
    timing: 'immediate',
  });
  assertEquals(recast.iid, first.iid, 'refresh keeps its identity');
  assertEquals(b.effectInstances.length, 1, 'same list slot — no duplicate');
  const inst = b.effectInstances[0]!;
  assertEquals(inst.name, 'New Brand', 'payload wholly renewed');
  assertEquals(inst.pct, 0.2, 'magnitude renewed');
  assertEquals(inst.deferFirstTick, false, 'timing renewed');
  assertEquals(inst.remaining, 2, 'clock renewed');
  assertEquals(
    inst.expiresRound,
    inst.appliedRound + inst.remaining - (inst.deferFirstTick ? 0 : 1),
    'expiresRound agrees with the fresh clock',
  );
});

Deno.test('#90: refresh flips finite ↔ battle-lifetime coherently', () => {
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  const finite: InstanceSeed = {
    defId: 'test:lt',
    name: 'Finite',
    kind: 'statmod',
    side: 'player',
    source: { kind: 'skill', id: 's', name: 'S' },
    stat: 'atk',
    pct: 0.1,
    tags: ['beneficial'],
    stacking: 'refresh',
    duration: 2,
    timing: 'immediate',
    removable: true,
  };
  applyInstance(b, finite);
  const upgraded = applyInstance(b, { ...finite, name: 'Forever', battleLifetime: true });
  assertEquals(upgraded.battleLifetime, true, 'flag set');
  assertEquals(upgraded.expiresRound, Number.MAX_SAFE_INTEGER);
  for (let i = 0; i < 3; i++) settleEndOfRound(b);
  assertEquals(b.effectInstances.length, 1, 'battle-lifetime never ages out');
  const downgraded = applyInstance(b, { ...finite, name: 'Finite Again' });
  assertEquals(downgraded.battleLifetime, undefined, 'flag cleared');
  assertEquals(downgraded.remaining, 2);
  assertEquals(downgraded.expiresRound, 2, 'finite clock rebuilt from the anchor round');
});

Deno.test('#90: strongest retains the winner — no timing leak, coherent extension', () => {
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  const strong: InstanceSeed = {
    defId: 'test:strong',
    name: 'Big',
    kind: 'statmod',
    side: 'player',
    source: { kind: 'skill', id: 's', name: 'S' },
    stat: 'atk',
    pct: 0.4,
    tags: ['beneficial'],
    stacking: 'strongest',
    duration: 2,
    timing: 'immediate',
    removable: true,
  };
  const winner = applyInstance(b, strong);
  assertEquals(winner.remaining, 2);
  assertEquals(winner.expiresRound, 2);

  // A weaker DEFER-timed recast must not leak its timing into the winner.
  const retained = applyInstance(b, {
    ...strong,
    pct: 0.1,
    duration: 1,
    timing: 'defer',
    name: 'Small',
  });
  assertEquals(retained.iid, winner.iid);
  assertEquals(retained.pct, 0.4, 'winner magnitude stands');
  assertEquals(retained.deferFirstTick, false, 'no timing leak from the weaker recast');
  assertEquals(retained.name, 'Big', 'payload untouched');

  // A longer weaker recast extends coherently: remaining and expiresRound
  // move by the same delta.
  const longer = applyInstance(b, { ...strong, pct: 0.1, duration: 4, timing: 'defer' });
  assertEquals(longer.expiresRound, 5, 'anchor round 1 + duration 4, deferred');
  assertEquals(longer.remaining, 5, 'extended by the same delta');
  assertEquals(
    longer.expiresRound - longer.remaining,
    winner.expiresRound - winner.remaining,
    'the two clocks moved together',
  );
});

Deno.test('#90: strongest battle-lifetime upgrade and incoming-wins are whole', () => {
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  const strong: InstanceSeed = {
    defId: 'test:strong2',
    name: 'Big',
    kind: 'statmod',
    side: 'player',
    source: { kind: 'skill', id: 's', name: 'S' },
    stat: 'atk',
    pct: 0.4,
    tags: ['beneficial'],
    stacking: 'strongest',
    duration: 2,
    timing: 'immediate',
    removable: true,
  };
  const winner = applyInstance(b, strong);
  // A weaker battle-lifetime recast upgrades the winner's lifetime —
  // magnitude and payload still stand.
  const upgraded = applyInstance(b, {
    ...strong,
    pct: 0.1,
    battleLifetime: true,
    name: 'Small',
  });
  assertEquals(upgraded.iid, winner.iid);
  assertEquals(upgraded.battleLifetime, true);
  assertEquals(upgraded.expiresRound, Number.MAX_SAFE_INTEGER);
  assertEquals(upgraded.remaining, 1);
  assertEquals(upgraded.pct, 0.4, 'winner magnitude stands');
  // A stronger recast applies WHOLE: fresh identity, fresh payload.
  const stronger = applyInstance(b, { ...strong, pct: 0.5 });
  assert(stronger.iid !== winner.iid, 'a winning recast is a new application');
  assertEquals(stronger.pct, 0.5);
  assertEquals(stronger.battleLifetime, undefined, 'finite again — no stale flag');
});

Deno.test('#90: stacking states survive a JSON round-trip and keep matching', () => {
  const base: InstanceSeed = {
    defId: 'test:rt',
    name: 'R',
    kind: 'statmod',
    side: 'player',
    source: { kind: 'skill', id: 's', name: 'S' },
    stat: 'atk',
    pct: 0.1,
    tags: ['beneficial'],
    stacking: 'replace',
    duration: 2,
    timing: 'immediate',
    removable: true,
  };
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  applyInstance(b, base);
  applyInstance(b, { ...base, stacking: 'stack', defId: 'test:rt2', name: 'S1' });
  applyInstance(b, { ...base, stacking: 'refresh', defId: 'test:rt3', name: 'Rf' });
  applyInstance(b, { ...base, stacking: 'strongest', defId: 'test:rt4', name: 'St', pct: 0.3 });
  applyInstance(b, {
    ...base,
    stacking: 'refresh',
    defId: 'test:rt3',
    battleLifetime: true,
    name: 'Rf',
  });

  // Save/load round-trip: serialization is stable and the reloaded
  // instances still match their identities for further reapplication.
  const snapshot = JSON.stringify(b.effectInstances);
  assertEquals(JSON.stringify(JSON.parse(snapshot)), snapshot);
  const b2 = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  b2.effectInstances = JSON.parse(snapshot) as EffectInstance[];
  b2.effectSeq = b.effectSeq;
  const re = applyInstance(b2, { ...base, defId: 'test:rt3', stacking: 'refresh', name: 'Again' });
  assertEquals(re.iid, b.effectInstances.find((i) => i.defId === 'test:rt3')!.iid);
  assertEquals(b2.effectInstances.length, b.effectInstances.length, 'no duplicate identity');
});
