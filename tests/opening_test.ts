/** Pre-emptive battle-opening phase (#80): construction-time resolution in
 * explicit stable order (encounter ward → enemy opening → equipment →
 * learned pre-emptive skills), determinism under seeded RNG, once-only
 * persistence, battle-lifetime semantics, tutorial suppression, cast gating
 * and UI wiring. */

import { assert, assertEquals, assertExists } from '@std/assert';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import { performAction, previewBattle, startBattle } from '../src/engine/combat.ts';
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
  const player = createPlayer(id, 'R', 'rogue');
  player.level = 20;
  player.skills.push('sk_expose_weakness');
  player.equipment.trinket = 't_wardstone';
  return player;
}

/** A seed under which Expose Weakness's 60% opening roll SUCCEEDS. */
function exposeSuccessSeed(): number {
  for (let seed = 1; seed <= 200; seed++) {
    const battle =
      startBattle('e_rat', ORIGIN, { player: roguePlayer(900 + seed), rng: seeded(seed) })!.battle;
    if (battle.effectInstances.some((instance) => instance.defId === 'sk_expose_weakness:e0')) {
      return seed;
    }
  }
  throw new Error('no expose-success seed found in 1..200');
}

/** A seed under which the roll FAILS. */
function exposeFailureSeed(): number {
  for (let seed = 1; seed <= 200; seed++) {
    const battle =
      startBattle('e_rat', ORIGIN, { player: roguePlayer(900 + seed), rng: seeded(seed) })!.battle;
    if (!battle.effectInstances.some((instance) => instance.defId === 'sk_expose_weakness:e0')) {
      return seed;
    }
  }
  throw new Error('no expose-failure seed found in 1..200');
}

Deno.test('#80: openings resolve identically under the same seed', () => {
  const firstBattle =
    startBattle('e_rat', ORIGIN, { player: roguePlayer(1), rng: seeded(7) })!.battle;
  const secondBattle =
    startBattle('e_rat', ORIGIN, { player: roguePlayer(2), rng: seeded(7) })!.battle;
  assertEquals(firstBattle.opening, secondBattle.opening);
  assertEquals(firstBattle.effectInstances, secondBattle.effectInstances);
  assertEquals(firstBattle.shield, secondBattle.shield);
});

Deno.test('#80: opening chance rolls honor the seed — outcome-only persistence', () => {
  const win = exposeSuccessSeed();
  assert(win !== exposeFailureSeed());
  const battle = startBattle('e_rat', ORIGIN, { player: roguePlayer(3), rng: seeded(win) })!.battle;
  const exposed = battle.effectInstances.find((instance) =>
    instance.defId === 'sk_expose_weakness:e0'
  );
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
  const player = roguePlayer(4);
  const mpBefore = player.mp;
  const battle = startBattle('e_rat', ORIGIN, { player, rng: seeded(11) })!.battle;
  assertEquals(battle.round, 1);
  assertEquals(battle.history.length, 0);
  assertEquals(battle.cooldowns, {});
  // Expose Weakness costs 6 MP as a skill — the opening never charges it.
  assertEquals(player.mp, mpBefore);
});

Deno.test('#80: pipeline order — ward, then equipment, then pre-emptive skill', () => {
  const seed = exposeSuccessSeed();
  const battle =
    startBattle('e_aldric', BOSS_ORIGIN, { player: roguePlayer(5), rng: seeded(seed) })!.battle;
  const lines = battle.opening!.lines;
  assert(lines[0]!.includes('Sovereign Ward'), 'encounter ward resolves first');
  assert(lines[0]!.includes('250'));
  const wardIdx = lines.findIndex((line) => line.includes('Wardstone'));
  const exposeIdx = lines.findIndex((line) => line.includes('Exposed'));
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
  const wild =
    startBattle('e_chronowisp', ORIGIN, { player: roguePlayer(6), rng: seeded(3) })!.battle;
  assert(wild.opening!.lines.some((line) => line.includes('Chrono Anchor')));
  const anchored = wild.effectInstances.find((instance) => instance.defId === 'e_chronowisp:e0');
  assertExists(anchored);
  assertEquals(anchored.stat, 'spd');
  assertEquals(anchored.pct, -0.2);
  assertEquals(anchored.source.kind, 'enemyMove');
  const boss = startBattle('e_chronowisp', vaultBossOrigin, {
    player: roguePlayer(7),
    rng: seeded(3),
  })!.battle;
  assert(boss.opening!.lines.some((line) => line.includes('Chrono Anchor')));

  // Aldric's Sovereign Ward: boss provenance ONLY (#28/#79).
  const plain = startBattle('e_aldric', { kind: 'explore', zoneId: 'crownspire' }, {
    player: roguePlayer(8),
    rng: seeded(3),
  })!.battle;
  assertEquals(plain.opening?.lines.some((line) => line.includes('Sovereign Ward')), false);
  assertEquals(plain.shield.enemy, 0);
  const bossed =
    startBattle('e_aldric', BOSS_ORIGIN, { player: roguePlayer(9), rng: seeded(3) })!.battle;
  assertEquals(bossed.shield.enemy, 250);
});

Deno.test('#80: battle-lifetime wards never tick down or expire', () => {
  const player = roguePlayer(10);
  const battle = startBattle('e_rat', ORIGIN, { player, rng: seeded(21) })!.battle;
  const ward = battle.effectInstances.find((instance) => instance.battleLifetime);
  assertExists(ward);
  assertEquals(ward.remaining, 1);
  assertEquals(ward.expiresRound, Number.MAX_SAFE_INTEGER);
  assertEquals(ward.source, { kind: 'item', id: 't_wardstone', name: 'Wardstone Pendant' });
  assertEquals(battle.shield.player, 25);
  assertEquals(maxShield(battle, 'player'), 25);
  for (let roundIndex = 0; roundIndex < 5; roundIndex++) {
    tickEndOfRound(
      battle,
      (side) => side === 'player' ? statsOf(player).maxHp : battle.enemy.maxHp,
    );
  }
  assertEquals(ward.remaining, 1);
  assertEquals(battle.shield.player, 25);
  assert(battle.effectInstances.includes(ward));
});

Deno.test('#80: a 99-round opening shield expires at the end of round 99', () => {
  const preview = previewBattle('e_rat', ORIGIN)!;
  const inst = applyInstance(
    preview,
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
  assertEquals(inst.instance.expiresRound, 99);
});

Deno.test('#80: save/load/rerender never rerolls or reapplies the opening', () => {
  const player = roguePlayer(11);
  const battle = startBattle('e_rat', ORIGIN, { player, rng: seeded(31) })!.battle;
  const before = JSON.stringify(battle);
  const restored = JSON.parse(JSON.stringify(battle)) as BattleState;
  // The persisted JSON shape round-trips verbatim (JSON drops the live
  // instances' undefined-valued optional fields — saves carry only data).
  assertEquals(JSON.parse(JSON.stringify(restored)), JSON.parse(before));
  // A rerender against the restored battle mutates nothing.
  renderBattle({ ...player, battle: restored });
  assertEquals(JSON.stringify(restored), before);
});

Deno.test('#80/#81: pre-emptive skills render as labeled info rows, never cast buttons', () => {
  const player = roguePlayer(12);
  const battle = startBattle('e_rat', ORIGIN, { player, rng: seeded(41) })!.battle;
  player.battle = battle;
  const menuText = JSON.stringify(renderSkillMenu(player));
  // #81: the activation type is EXPLICIT — a labeled info row, not a cast
  // button (the button label would read “Expose Weakness — 6 MP”).
  assert(menuText.includes('⚡ Expose Weakness'), 'labeled info row present');
  assert(!menuText.includes('Expose Weakness — 6 MP'), 'no cast button');
  const res = performAction(
    player,
    battle,
    { kind: 'skill', skillId: 'sk_expose_weakness' },
    seeded(1),
  );
  assertEquals(res.consumedTurn, false);
  assert(res.lines.join(' ').includes('battle opens'));
});

Deno.test('#80: tutorial provenance suppresses openings at construction', () => {
  const player = roguePlayer(13);
  const battle = startBattle('e_cinder_mite', ORIGIN, {
    player,
    rng: seeded(51),
    tutorial: true,
  })!.battle;
  assertEquals(battle.opening, undefined);
  assertEquals(battle.effectInstances.length, 0);
  assertEquals(battle.shield.player, 0);
  assertEquals(battle.tutorial, true);
  assertEquals(battle.tutorialStep, 'basic');
});

Deno.test('#80: the opening renders expanded on round 1, collapsed thereafter', () => {
  const player = roguePlayer(14);
  const battle = startBattle('e_rat', ORIGIN, { player, rng: seeded(61) })!.battle;
  player.battle = battle;
  const fresh = JSON.stringify(renderBattle(player));
  assert(fresh.includes('Battle opening'));
  assert(fresh.includes('Wardstone'));
  assert(fresh.includes('"is_open":true'));
  // One full round later the panel remains available — collapsed.
  performAction(player, battle, { kind: 'guard' }, seeded(62));
  const later = JSON.stringify(renderBattle(player));
  assert(later.includes('Battle opening'));
  assert(!later.includes('"is_open":true'));
});

// ── #96: the opening is a terminal-governed resolution phase ─────────────

import type { EnemyDef, SkillDef } from '../src/content/types.ts';
import { ENEMIES } from '../src/content/enemies.ts';
import { item as itemDef } from '../src/content/items.ts';
import { addItem } from '../src/engine/inventory.ts';

/** Temporarily replaces a content object's field (the lookup indexes hold
 * the same references, so mutations are visible) and restores it after. */
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

Deno.test('#96: a lethal player opening wins immediately — later sources never run', () => {
  // The Wardstone Pendant's battleStart trigger becomes a lethal strike
  // (source 3); the learned pre-emptive Expose Weakness (source 4) is the
  // later source that must never resolve after the terminal transition.
  const wardstone = itemDef('t_wardstone')!;
  const originalTriggers = wardstone.triggers;
  wardstone.triggers = [{
    name: 'Probe Lethal',
    trigger: 'battleStart',
    effects: [{ kind: 'damage', attack: 'phys', power: 9999 }],
  }];
  try {
    const player = roguePlayer(6100);
    const res = startBattle('e_rat', ORIGIN, { player, rng: seeded(5) })!;
    assertEquals(res.outcome, 'victory', 'the opening itself felled the foe');
    assertEquals(res.battle.enemy.hp, 0, 'never restored to 1 — no global clamp');
    assertEquals(res.battle.phase, 'active', 'the result carries the adjudication');
    assertEquals(res.battle.round, 1, 'no round ran');
    assertEquals(
      res.battle.effectInstances.some((instance) => instance.defId === 'sk_expose_weakness:e0'),
      false,
      'the later pre-emptive source never resolved after the terminal transition',
    );
    assert(
      !res.battle.opening?.lines.some((line) => line.includes('Expose Weakness')),
      'no later opening line either',
    );
  } finally {
    wardstone.triggers = originalTriggers;
  }
});

/** A lethal-opening variant of e_rat, applied for one test. */
function withLethalRatOpening(run: () => void): void {
  const rat = ENEMIES.find((enemyDef) => enemyDef.id === 'e_rat')! as EnemyDef & {
    opening?: { name: string; effects: SkillDef['effects'] };
  };
  withOverridden(
    rat,
    'opening',
    { name: 'Death Gaze', effects: [{ kind: 'damage', attack: 'mag', power: 9999 }] },
    run,
  );
}

Deno.test('#96: a lethal enemy opening defeats immediately — later sources never run', () => {
  withLethalRatOpening(() => {
    // Expose Weakness (pre-emptive) + the Wardstone battleStart ward are
    // LATER sources — neither may resolve after the terminal opening.
    const player = roguePlayer(6200);
    const res = startBattle('e_rat', ORIGIN, { player, rng: seeded(5) })!;
    assertEquals(res.outcome, 'defeat', 'the opening itself felled the hero');
    assertEquals(player.hp, 0);
    assertEquals(res.battle.enemy.hp, res.battle.enemy.maxHp, 'the foe never acted twice');
    assertEquals(
      res.battle.shield.player,
      0,
      'the Wardstone battleStart proc never rolled after the terminal transition',
    );
    assertEquals(
      res.battle.effectInstances.some((instance) => instance.defId === 'sk_expose_weakness:e0'),
      false,
      'the later pre-emptive skill never resolved',
    );
  });
});

Deno.test('#96: Phoenix revival inside a lethal opening keeps the fight ongoing', () => {
  withLethalRatOpening(() => {
    const player = createPlayer(6300, 'T', 'warrior');
    addItem(player, 'c_phoenix_feather', 1);
    const res = startBattle('e_rat', ORIGIN, { player, rng: seeded(5) })!;
    assertEquals(res.outcome, 'ongoing', 'the synchronous revival prevents defeat');
    assert(player.hp > 0, 'the Cinder lifted the hero before any later source');
    assertEquals(res.battle.phoenixUsed, true);
  });
});

Deno.test('#96: performAction refuses to run a round on a pre-existing terminal state', () => {
  const player = createPlayer(6400, 'T', 'warrior');
  const battle = startBattle('e_rat', ORIGIN, { player, rng: seeded(5) })!.battle;
  // Synthetic terminal states (no authored content reaches them).
  battle.enemy.hp = 0;
  let res = performAction(player, battle, { kind: 'attack' }, seeded(6));
  assertEquals(res.outcome, 'victory', 'a dead foe is an immediate victory');
  assertEquals(res.consumedTurn, false, 'no turn is consumed');
  assertEquals(battle.round, 1, 'no round ran');
  assertEquals(battle.history.length, 0, 'no round was recorded');
  battle.enemy.hp = battle.enemy.maxHp;
  player.hp = 0;
  res = performAction(player, battle, { kind: 'attack' }, seeded(7));
  assertEquals(res.outcome, 'defeat');
  assertEquals(battle.enemy.turn, 0, 'the enemy never acted on a corpse');
});

// ── #99: previews are structurally unplayable — playable fights construct
// through startBattle ─────────────────────────────────────────────────────

Deno.test('#91/#99: previews resolve no openings and stay separate from playable battles', () => {
  // Aldric behind boss provenance: the Sovereign Ward is an OPENING source,
  // so a real construction resolves it — a preview must not.
  const preview = previewBattle('e_aldric', BOSS_ORIGIN)!;
  assertEquals(preview.phase, 'preview', "the container's phase is not a BattlePhase");
  assertEquals(preview.opening, undefined);
  assertEquals(preview.shield.enemy, 0, 'no opening ward — previews resolve no openings');
  assertEquals(preview.effectInstances.length, 0, 'no opening effects');
  assertEquals(preview.history.length, 0, 'no rounds could ever run');
  const plain = previewBattle('e_rat', ORIGIN)!;
  assertEquals(plain.opening, undefined);
  assertEquals(plain.effectInstances.length, 0);
  // The playable path — the same enemy, the same provenance — DOES.
  const live = startBattle('e_aldric', BOSS_ORIGIN, {
    player: createPlayer(6500, 'T', 'warrior'),
    rng: seeded(91),
  })!;
  assertEquals(live.battle.phase, 'active');
  assertEquals(live.battle.shield.enemy, 250, 'the ward resolves on playable construction');
  assertEquals(live.outcome, 'ongoing');
});
