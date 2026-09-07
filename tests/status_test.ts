/** #83 shared status vocabulary — enemy adoption: Poison is the only
 * shield-bypassing DoT, Burn routes through wards, Slow (Chill/Web/Ageing
 * flavors) cuts SPD, shells are real expiring wards under #79 semantics,
 * bosses carry authored status resistance with visible "resists" feedback,
 * and the enemy AI never wastes heals/wards/buffs. Silence as an
 * action-status is deliberately NOT shipped. */

import { assert, assertEquals, assertExists } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import {
  dodgeChance,
  effectiveEnemySpd,
  effectivePlayerSpd,
  performAction,
  type PlayerAction,
  startBattle,
} from '../src/engine/combat.ts';
import {
  applyInstance,
  grantShield,
  type InstanceSeed,
  removeTagged,
  seedForSpec,
  semanticTags,
  statPct,
} from '../src/engine/effects.ts';
import type { BattleOrigin, BattleState, ClassId, PlayerState } from '../src/engine/types.ts';
import { skill } from '../src/content/skills.ts';
import { enemy } from '../src/content/enemies.ts';
import { item } from '../src/content/items.ts';
import { consumableEffectLines } from '../src/engine/mechanics.ts';
import { chooseAction, POLICIES } from '../src/engine/balance.ts';
import { renderBattle } from '../src/render/battle.ts';
import { injectMod, seeded } from './helpers.ts';
import type { EffectSpec, EffectTag, StatKey } from '../src/content/types.ts';

const ORIGIN = { kind: 'explore', zoneId: 'whisperwood' } as const;
const ABYSS = { kind: 'explore', zoneId: 'abyss' } as const;

function hero(id: number, classId: ClassId, level: number): PlayerState {
  const player = createPlayer(id, 'T', classId);
  player.level = level;
  return player;
}

function fight(
  enemyId: string,
  player: PlayerState,
  seed: number,
  origin: BattleOrigin = ORIGIN,
): BattleState {
  const battle = startBattle(enemyId, origin, { player, rng: seeded(seed) })!.battle;
  battle.enemy.hp = 99999;
  battle.enemy.maxHp = 99999;
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

function wardOf(amount: number): InstanceSeed {
  return {
    defId: 'test_ward',
    name: 'Test Ward',
    kind: 'shield',
    side: 'player',
    source: { kind: 'item', id: 'test_ward', name: 'Test Ward' },
    shieldAmount: amount,
    tags: ['beneficial'],
    stacking: 'replace',
    duration: 9,
    timing: 'immediate',
    removable: false,
  };
}

Deno.test('#83: Venom Bite is a real shield-bypassing poison', () => {
  let seed = -1;
  for (let candidateSeed = 1; candidateSeed <= 120; candidateSeed++) {
    const player = hero(500 + candidateSeed, 'warrior', 6);
    const battle = fight('e_spider', player, candidateSeed);
    const res = round(player, battle, candidateSeed);
    if (
      res.lines.some((line) => line.includes('The venom bites in')) &&
      battle.effectInstances.some((instance) =>
        instance.side === 'player' && instance.name === 'Poison'
      )
    ) {
      seed = candidateSeed;
      break;
    }
  }
  assert(seed > 0, 'a venom seed exists');
  const player = hero(1, 'warrior', 6);
  const battle = fight('e_spider', player, seed);
  round(player, battle, seed);
  const poison = battle.effectInstances.find((instance) =>
    instance.side === 'player' && instance.name === 'Poison'
  );
  assertExists(poison);
  assertEquals(poison.defId, 'Venom Bite:e1');
  assertEquals(poison.bypassShield, true, 'Poison is the ONLY bypassing DoT');
  assertEquals(poison.perRound, -4);
  assertEquals(poison.tags?.includes('poison'), true);
  assertEquals(poison.tags?.includes('harmful'), true);
  // A fresh ward does not stop the next tick — Poison bites HP directly.
  grantShield(battle, 'player', wardOf(500));
  const hpBefore = player.hp;
  round(player, battle, seed + 1);
  assert(player.hp < hpBefore, 'the poison tick ignored the ward');
});

Deno.test('#83: player poison shares the bypass identity', () => {
  const venom = skill('sk_venom_cut')!.effects.find((effect) => effect.kind === 'periodic')!;
  assert(venom.kind === 'periodic');
  assertEquals(venom.bypassShield, true);
  assertEquals(venom.tags?.includes('poison'), true);
  const ambush = skill('sk_ambush')!.effects.find((effect) => effect.kind === 'periodic')!;
  assert(ambush.kind === 'periodic');
  assertEquals(ambush.bypassShield, true);
});

Deno.test('#83: Burn routes through the ward like ordinary damage', () => {
  let seed = -1;
  for (let candidateSeed = 1; candidateSeed <= 120; candidateSeed++) {
    const player = hero(500 + candidateSeed, 'warrior', 33);
    player.hp = 99999; // #86: a lethal hit stops its riders — survive to watch the burn land
    const battle = fight('e_cinderhound', player, candidateSeed);
    const res = round(player, battle, candidateSeed);
    if (res.lines.some((line) => line.includes('Burning'))) {
      seed = candidateSeed;
      break;
    }
  }
  assert(seed > 0, 'a burn seed exists');
  const player = hero(2, 'warrior', 33);
  player.hp = 99999; // #86: same survival for the deterministic replay
  const battle = fight('e_cinderhound', player, seed);
  round(player, battle, seed);
  const burn = battle.effectInstances.find((instance) =>
    instance.side === 'player' && instance.name === 'Burn'
  );
  assertExists(burn);
  assertEquals(burn.bypassShield, undefined, 'Burn is ward-routed, unlike Poison');
  grantShield(battle, 'player', wardOf(500));
  const hpBefore = player.hp;
  round(player, battle, seed + 1);
  assertEquals(player.hp, hpBefore, 'the ward absorbed strike and burn alike');
  assert(battle.shield.player < 500, 'the ward paid for them');
});

Deno.test('#83: Web Snare slows — SPD and therefore dodge fall', () => {
  let seed = -1;
  for (let candidateSeed = 1; candidateSeed <= 120; candidateSeed++) {
    const player = hero(500 + candidateSeed, 'warrior', 6);
    const battle = fight('e_spider', player, candidateSeed);
    const res = round(player, battle, candidateSeed);
    if (res.lines.some((line) => line.includes('The webbing binds'))) {
      seed = candidateSeed;
      break;
    }
  }
  assert(seed > 0, 'a snare seed exists');
  const player = hero(3, 'warrior', 6);
  const battle = fight('e_spider', player, seed);
  round(player, battle, seed);
  const webbed = battle.effectInstances.find((instance) =>
    instance.side === 'player' && instance.name === 'Webbed'
  );
  assertExists(webbed);
  assertEquals(webbed.stat, 'spd');
  assertEquals(webbed.pct, -0.25);
  assertEquals(webbed.tags.includes('slow'), true);
  assert(statPct(battle, 'player', 'spd') < 0);
});

Deno.test('#83: Frost Shell is a real expiring ward, not a mitigation stance', () => {
  let seed = -1;
  for (let candidateSeed = 1; candidateSeed <= 120; candidateSeed++) {
    const player = hero(500 + candidateSeed, 'warrior', 27);
    player.hp = 99999; // #86: a fallen hero freezes the round — survive the shell scan
    const battle = fight('e_iceling', player, candidateSeed);
    const res = round(player, battle, candidateSeed);
    if (res.lines.some((line) => line.includes('raises a Shield absorbing up to 65 damage'))) {
      seed = candidateSeed;
      break;
    }
  }
  assert(seed > 0, 'a shell seed exists');
  const player = hero(4, 'warrior', 27);
  player.hp = 99999; // #86: the expiry loop needs the hero alive through every settle
  const battle = fight('e_iceling', player, seed);
  round(player, battle, seed);
  assertEquals(battle.shield.enemy, 65, 'the shell is pool capacity, like #79 wards');
  const ward = battle.effectInstances.find((instance) =>
    instance.side === 'enemy' && instance.kind === 'shield'
  );
  assertExists(ward);
  assertEquals(ward.name, 'Frost Shell');
  // Run rounds until a non-recast round elapses; the ward must then be
  // gone (expired) with an empty pool — unless it was drained first.
  for (let roundOffset = 0; roundOffset < 6; roundOffset++) {
    const res = round(player, battle, seed + 1 + roundOffset);
    if (!res.lines.some((line) => line.includes('raises a Shield'))) break;
  }
  assertEquals(
    battle.effectInstances.some((instance) =>
      instance.side === 'enemy' && instance.kind === 'shield'
    ),
    false,
    'the ward expired',
  );
  assertEquals(battle.shield.enemy, 0);
});

Deno.test('#83: status resistance visibly resists — and sometimes fails', () => {
  let resisted = -1;
  let landed = -1;
  for (let seed = 1; seed <= 140 && (resisted < 0 || landed < 0); seed++) {
    const player = hero(700 + seed, 'warrior', 25);
    player.skills.push('sk_sunder_armor');
    player.mp = 100;
    const battle = fight('e_chronolich', player, seed);
    const res = round(player, battle, seed, { kind: 'skill', skillId: 'sk_sunder_armor' });
    const broke = battle.effectInstances.some((instance) =>
      instance.side === 'enemy' && instance.stat === 'def'
    );
    if (resisted < 0 && !broke && res.lines.some((line) => line.includes('resists Sunder Armor'))) {
      resisted = seed;
    }
    if (landed < 0 && broke) landed = seed;
  }
  assert(resisted > 0, 'a resisted application was announced, not silent');
  assert(landed > 0, 'resistance is probabilistic — applications still land');
  // Deterministic replay of the resisted seed:
  const player = hero(700 + resisted, 'warrior', 25);
  player.skills.push('sk_sunder_armor');
  player.mp = 100;
  const battle = fight('e_chronolich', player, resisted);
  const res = round(player, battle, resisted, { kind: 'skill', skillId: 'sk_sunder_armor' });
  assert(res.lines.some((line) => line.includes('resists Sunder Armor')));
  assertEquals(
    battle.effectInstances.some((instance) => instance.side === 'enemy' && instance.stat === 'def'),
    false,
  );
});

Deno.test('#83: bosses carry authored status resistance; ordinary enemies do not', () => {
  const bosses: [string, number][] = [
    ['e_aranya', 0.2],
    ['e_vosk', 0.25],
    ['e_chronolich', 0.3],
    ['e_jormunis', 0.3],
    ['e_ignivar', 0.3],
    // #88: retuned alongside their fight numbers — still authored, still
    // boss-only resistance.
    ['e_aldric', 0.3],
    ['e_warden', 0.3],
  ];
  for (const [id, resist] of bosses) {
    assertEquals(enemy(id)?.statusResist, resist, `${id} resistance`);
  }
  assertEquals(enemy('e_wolf')?.statusResist, undefined);
  assertEquals(enemy('e_sentinel')?.statusResist, undefined);
});

Deno.test('#83: enemy AI never heals at full HP — the special falls through', () => {
  let seed = -1;
  for (let candidateSeed = 1; candidateSeed <= 60; candidateSeed++) {
    const player = hero(500 + candidateSeed, 'warrior', 10);
    const battle = fight('e_aranya', player, candidateSeed);
    battle.enemy.turn = 3; // the next enemy action is the 4th — Brood Surge due
    // GUARD: the hero deals no damage, so the boss is genuinely at full HP
    // when its special comes due — the heal would restore 0.
    const res = round(player, battle, candidateSeed, { kind: 'guard' });
    if (
      !res.lines.some((line) => line.includes('recovers')) &&
      res.lines.some((line) => line.includes('damage to you'))
    ) {
      seed = candidateSeed;
      break;
    }
  }
  assert(seed > 0, 'a fall-through seed exists');
  const player = hero(6, 'warrior', 10);
  const battle = fight('e_aranya', player, seed);
  battle.enemy.turn = 3;
  const res = round(player, battle, seed, { kind: 'guard' });
  assertEquals(
    res.lines.some((line) => line.includes('recovers')),
    false,
    'Brood Surge at full HP would restore 0 — skipped',
  );
  assert(
    res.lines.some((line) => line.includes('damage to you')),
    'a real attack happened instead',
  );
});

Deno.test('#83: enemy AI skips re-warding over a live ward', () => {
  let seed = -1;
  for (let candidateSeed = 1; candidateSeed <= 120; candidateSeed++) {
    const player = hero(500 + candidateSeed, 'warrior', 18);
    const battle = fight('e_sentinel', player, candidateSeed);
    const res = round(player, battle, candidateSeed);
    if (res.lines.some((line) => line.includes('raises a Shield absorbing up to 45 damage'))) {
      seed = candidateSeed;
      break;
    }
  }
  assert(seed > 0, 'a bulwark seed exists');
  const player = hero(7, 'warrior', 18);
  const battle = fight('e_sentinel', player, seed);
  round(player, battle, seed);
  assertEquals(
    battle.effectInstances.filter((instance) =>
      instance.kind === 'shield' && instance.side === 'enemy'
    ).length,
    1,
  );
  // While the ward is live the Bulwark move is wasted — never re-cast.
  for (let roundOffset = 0; roundOffset < 2; roundOffset++) {
    const res = round(player, battle, seed + 1 + roundOffset);
    if (
      battle.effectInstances.some((instance) =>
        instance.kind === 'shield' && instance.side === 'enemy'
      )
    ) {
      assertEquals(
        res.lines.some((line) => line.includes('raises a Shield')),
        false,
        'no refresh over a live ward',
      );
    }
  }
});

Deno.test('#83: Marsh Leech Drain damages and drains — enemy-side lifesteal', () => {
  let seed = -1;
  for (let candidateSeed = 1; candidateSeed <= 120; candidateSeed++) {
    const player = hero(500 + candidateSeed, 'warrior', 11);
    const battle = fight('e_leech', player, candidateSeed);
    const res = round(player, battle, candidateSeed);
    if (res.lines.some((line) => line.includes('drains') && line.includes('from you'))) {
      seed = candidateSeed;
      break;
    }
  }
  assert(seed > 0, 'a drain seed exists');
  const player = hero(8, 'warrior', 11);
  const battle = fight('e_leech', player, seed);
  const hpBefore = player.hp;
  const res = round(player, battle, seed);
  const drain = res.lines.find((line) => line.includes('Marsh Leech drains'));
  assertExists(drain, 'the enemy-side lifesteal line');
  assert(player.hp < hpBefore, 'the strike landed before the drain');
});

Deno.test('#83: Final Silence strips an active blessing — dispel, not a new status', () => {
  const player = hero(9, 'warrior', 46);
  player.hp = 99999; // #86: a lethal Silence stops its dispel — survive the strip
  const battle = fight('e_warden', player, 7, ABYSS);
  battle.enemy.turn = 2; // the next enemy action is the 3rd — Final Silence due
  applyInstance(battle, {
    defId: 'test_bless',
    name: 'Test Blessing',
    kind: 'statmod',
    side: 'player',
    source: { kind: 'skill', id: 'test', name: 'Test' },
    stat: 'atk',
    pct: 0.1,
    duration: 5,
    timing: 'immediate',
    tags: ['beneficial'],
    stacking: 'replace',
    removable: true,
  });
  const res = round(player, battle, 7);
  assertEquals(
    battle.effectInstances.some((instance) => instance.defId === 'test_bless'),
    false,
    'the blessing was stripped',
  );
  assert(res.lines.some((line) => line.includes('beneficial effects are stripped')));
  assert(
    res.lines.some((line) => line.includes('damage to you')),
    'the special still struck — dispel is a rider, not a replacement',
  );
});

Deno.test('#83: Swamp Curse breaks wards (RES down)', () => {
  let seed = -1;
  for (let candidateSeed = 1; candidateSeed <= 120; candidateSeed++) {
    const player = hero(500 + candidateSeed, 'warrior', 13);
    const battle = fight('e_fenhag', player, candidateSeed);
    const res = round(player, battle, candidateSeed);
    if (res.lines.some((line) => line.includes('Ward Break'))) {
      seed = candidateSeed;
      break;
    }
  }
  assert(seed > 0, 'a curse seed exists');
  const player = hero(10, 'warrior', 13);
  const battle = fight('e_fenhag', player, seed);
  round(player, battle, seed);
  const wb = battle.effectInstances.find((instance) =>
    instance.side === 'player' && instance.name === 'Ward Break'
  );
  assertExists(wb);
  assertEquals(wb.stat, 'res');
  assertEquals(wb.pct, -0.25);
  assertEquals(wb.tags.includes('ward-break'), true);
});

// ── #85: enemy-side folds — debuffs must change the actual numbers ──────

function damageOf(lines: string[]): number | undefined {
  for (const line of lines) {
    const match = line.match(/for (\d+)/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

/** One basic-action strike vs e_rat under a fixed RNG stream, optionally
 * after injecting enemy-side instances. Identical seeds mean identical
 * crit/variance draws, so any damage delta comes purely from the folds. */
function strike(
  classId: ClassId,
  mods: { stat: StatKey; pct: number; defId?: string }[] = [],
): number {
  const player = hero(940, classId, 10);
  const battle = fight('e_rat', player, 4242);
  for (const modifier of mods) {
    injectMod(
      battle,
      'enemy',
      modifier.stat,
      modifier.pct,
      modifier.defId ? { defId: modifier.defId } : {},
    );
  }
  const damage = damageOf(round(player, battle, 777).lines);
  assertExists(damage, 'the strike must land and report its damage');
  return damage;
}

Deno.test('#85: enemy DEF modifiers measurably change physical player damage', () => {
  const d1 = strike('warrior');
  const d2 = strike('warrior', [{ stat: 'def', pct: -0.9 }]);
  assert(d2 > d1, `DEF −90% must raise physical damage (${d1} → ${d2})`);
});

Deno.test('#85: enemy RES modifiers measurably change magical player damage', () => {
  const d1 = strike('mage');
  const d2 = strike('mage', [{ stat: 'res', pct: -0.9 }]);
  assert(d2 > d1, `RES −90% must raise magical damage (${d1} → ${d2})`);
});

Deno.test('#85: enemy Vulnerable applies its incoming modifier exactly once', () => {
  const base = strike('warrior');
  assertEquals(
    strike('warrior', [{ stat: 'incoming', pct: 1.0 }]),
    base * 2,
    `(1 + 1.0) applied ONCE doubles ${base}; a double application would quadruple it`,
  );
});

Deno.test('#85: enemy self-buffs to DEF/RES/SPD cut player damage and mobility', () => {
  const d0 = strike('warrior');
  assert(
    strike('warrior', [{ stat: 'def', pct: 0.5 }]) < d0,
    'enemy DEF +50% must cut physical damage',
  );
  const m0 = strike('mage');
  assert(
    strike('mage', [{ stat: 'res', pct: 0.5 }]) < m0,
    'enemy RES +50% must cut magical damage',
  );
  const player = hero(941, 'rogue', 10);
  const b1 = fight('e_rat', player, 1);
  const b2 = fight('e_rat', hero(941, 'rogue', 10), 1);
  injectMod(b2, 'enemy', 'spd', 0.5);
  assert(
    effectiveEnemySpd(b2) > effectiveEnemySpd(b1),
    'enemy SPD +50% must raise its effective SPD',
  );
});

Deno.test('#85: enemy Slow cuts effective enemy SPD — dodge and flee odds inputs rise', () => {
  const player = hero(942, 'warrior', 1);
  const b1 = fight('e_rat', player, 1);
  const pSpd = effectivePlayerSpd(player, b1);
  const eSpd = effectiveEnemySpd(b1);
  const b2 = fight('e_rat', hero(942, 'warrior', 1), 1);
  injectMod(b2, 'enemy', 'spd', -0.95);
  const eSlow = effectiveEnemySpd(b2);
  assert(eSlow < eSpd, `Slow must cut effective enemy SPD (${eSpd} → ${eSlow})`);
  assert(
    dodgeChance(pSpd, eSlow) > dodgeChance(pSpd, eSpd),
    'a slowed foe is slipped more often',
  );
  const flee = (enemySpeed: number) =>
    Math.min(0.9, Math.max(0.15, 0.5 + (pSpd - enemySpeed) * 0.03));
  assert(flee(eSlow) > flee(eSpd), 'a slowed foe is escaped more easily');
});

Deno.test('#85: a slowed enemy is genuinely easier to flee (end to end)', () => {
  let found = -1;
  for (let seed = 1; seed <= 300 && found < 0; seed++) {
    const attempt = (slow: boolean) => {
      const player = hero(950 + seed, 'warrior', 1);
      const battle = fight('e_rat', player, seed);
      if (slow) injectMod(battle, 'enemy', 'spd', -0.95);
      // The flee draw is the FIRST draw of this round's stream — vary the
      // seed with s so the scan actually sweeps the chance interval.
      return round(player, battle, seed, { kind: 'flee' }).lines.some((line) =>
        line.includes('slip away')
      );
    };
    if (!attempt(false) && attempt(true)) found = seed;
  }
  assert(found > 0, 'a seed exists where Slow flips a failed flee into an escape');
});

Deno.test('#85: a slowed enemy is genuinely easier to dodge (end to end)', () => {
  let found = -1;
  for (let seed = 1; seed <= 800 && found < 0; seed++) {
    const attempt = (slow: boolean) => {
      const player = hero(1400 + seed, 'warrior', 1);
      const battle = fight('e_rat', player, seed);
      if (slow) injectMod(battle, 'enemy', 'spd', -0.95);
      return round(player, battle, seed).lines.some((line) => line.includes('💨'));
    };
    if (!attempt(false) && attempt(true)) found = seed;
  }
  assert(found > 0, 'a seed exists where Slow flips a hit into a slip');
});

Deno.test('#85: stacked breaks floor safely — mitigation and damage never invert', () => {
  // Two independent DEF breaks stack to −120%: the stat itself floors at 1.
  const one = strike('warrior', [{ stat: 'def', pct: -0.6 }]);
  const two = strike('warrior', [
    { stat: 'def', pct: -0.6, defId: 'brk1' },
    { stat: 'def', pct: -0.6, defId: 'brk2' },
  ]);
  assert(two >= one && one >= 1, `stacked DEF breaks cannot invert (one ${one}, two ${two})`);
  // Two independent mitigation-stance breaks stack to −120%: the stance
  // multiplier floors at 5%.
  const st1 = strike('warrior', [{ stat: 'mitigation', pct: -0.6 }]);
  const st2 = strike('warrior', [
    { stat: 'mitigation', pct: -0.6, defId: 'st1' },
    { stat: 'mitigation', pct: -0.6, defId: 'st2' },
  ]);
  assert(st2 >= st1 && st1 >= 1, `stance stacking cannot invert (one ${st1}, two ${st2})`);
  // Two independent incoming negatives stack to −120%: the multiplier
  // floors at −95%, so a hit can be gutted but never heals.
  const v1 = strike('warrior', [{ stat: 'incoming', pct: -0.6 }]);
  const v2 = strike('warrior', [
    { stat: 'incoming', pct: -0.6, defId: 'v1' },
    { stat: 'incoming', pct: -0.6, defId: 'v2' },
  ]);
  assert(v2 >= 1 && v2 < v1, `deep mitigation guts but never heals (one ${v1}, two ${v2})`);
});

// ── #87: semantic polarity and authored DoT families ──────────────────

Deno.test('#87: polarity follows stat meaning, not sign — table-driven', () => {
  const statmod = (stat: StatKey, pct: number): EffectSpec => ({
    kind: 'statmod',
    stat,
    pct,
    duration: 2,
    timing: 'immediate',
  });
  const cases: [StatKey, number, EffectTag][] = [
    ['atk', 0.3, 'beneficial'],
    ['atk', -0.3, 'harmful'],
    ['mag', 0.3, 'beneficial'],
    ['mag', -0.3, 'harmful'],
    ['def', 0.3, 'beneficial'],
    ['def', -0.3, 'harmful'],
    ['res', 0.3, 'beneficial'],
    ['res', -0.3, 'harmful'],
    ['spd', 0.3, 'beneficial'],
    ['spd', -0.3, 'harmful'],
    ['outgoing', 0.3, 'beneficial'],
    ['outgoing', -0.3, 'harmful'],
    ['mitigation', 0.3, 'beneficial'],
    ['mitigation', -0.3, 'harmful'],
    ['incoming', 0.3, 'harmful'], // the #87 inversion: more damage taken hurts
    ['incoming', -0.3, 'beneficial'],
  ];
  for (const [stat, pct, polarity] of cases) {
    const tags = semanticTags(statmod(stat, pct));
    assert(
      tags.includes(polarity),
      `${stat} ${pct > 0 ? '+' : ''}${pct} must be ${polarity} (got ${tags.join(',')})`,
    );
  }
});

Deno.test('#87: DoT families are authored data — never inferred from negativity', () => {
  // Scorch's burn rider: burn, never poison.
  const burn = skill('sk_scorch')!.effects.find((effect) => effect.kind === 'periodic')!;
  const burnTags = semanticTags(burn);
  assertEquals(burnTags.includes('burn'), true);
  assertEquals(burnTags.includes('poison'), false);
  // Thorn Ring's brambles: bleed, never poison.
  const bleed = item('t_9')!.triggers![0]!.effects[0]!;
  const bleedTags = semanticTags(bleed);
  assertEquals(bleedTags.includes('bleed'), true);
  assertEquals(bleedTags.includes('poison'), false);
  // Venom stays poison and keeps its shield-bypass policy.
  const venom = skill('sk_venom_cut')!.effects.find((effect) => effect.kind === 'periodic')!;
  const venomTags = semanticTags(venom);
  assertEquals(venomTags.includes('poison'), true);
  assertEquals(venomTags.includes('burn'), false);
  assertEquals(venomTags.includes('bleed'), false);
  assert(venom.kind === 'periodic' && venom.bypassShield === true, 'poison keeps bypass');
  // Renew infers only the one unambiguous family: regen.
  const renew = skill('sk_renew')!.effects.find((effect) => effect.kind === 'periodic')!;
  const renewTags = semanticTags(renew);
  assertEquals(renewTags.includes('regen'), true);
  assertEquals(renewTags.includes('beneficial'), true);
  assertEquals(renewTags.includes('harmful'), false);
});

Deno.test('#87: incoming amplification is harmful — Expose and Death Mark are never benefits', () => {
  for (const id of ['sk_expose_weakness', 'sk_death_mark'] as const) {
    const mark = skill(id)!.effects.find((effect) =>
      effect.kind === 'statmod' && effect.stat === 'incoming'
    )!;
    const tags = semanticTags(mark);
    assertEquals(tags.includes('harmful'), true, `${id} is harmful to the bearer`);
    assertEquals(tags.includes('beneficial'), false, `${id} is never beneficial`);
    assertEquals(tags.includes('vulnerable'), true, `${id} keeps its authored identity`);
  }
  // End to end: the live instance carries the same identity.
  const player = hero(60, 'rogue', 12);
  const battle = fight('e_rat', player, 3);
  applyInstance(
    battle,
    seedForSpec(
      {
        kind: 'statmod',
        target: 'opponent',
        stat: 'incoming',
        pct: 0.25,
        duration: 3,
        timing: 'immediate',
        name: 'Exposed',
      },
      'exposed_test',
      'Exposed',
      'enemy',
      { kind: 'skill', id: 'x', name: 'x' },
    ),
  );
  const inst = battle.effectInstances.find((instance) => instance.side === 'enemy')!;
  assertEquals(inst.tags.includes('harmful'), true);
  assertEquals(inst.tags.includes('beneficial'), false);
});

Deno.test('#87: cleanse strips harm, dispel strips benefit — polarity respected', () => {
  const player = hero(71, 'rogue', 12);
  const battle = fight('e_rat', player, 5);
  const exposed: EffectSpec = {
    kind: 'statmod',
    target: 'opponent',
    stat: 'incoming',
    pct: 0.25,
    duration: 3,
    timing: 'immediate',
    name: 'Exposed',
  };
  applyInstance(
    battle,
    seedForSpec(exposed, 'ex1', 'Exposed', 'enemy', { kind: 'skill', id: 'x', name: 'x' }),
  );
  // A dispel hunting enemy BENEFITS must not touch the player's debuff…
  assertEquals(removeTagged(battle, 'enemy', ['beneficial']).length, 0, 'harm is not benefit');
  // …and an enemy-side cleanse of HARM reaches it.
  assertEquals(removeTagged(battle, 'enemy', ['harmful']).length, 1, 'cleanse reaches the debuff');
});

Deno.test('#87: the tactical policy never dispels player-applied vulnerability', () => {
  const mk = (): { p: PlayerState; b: BattleState } => {
    const player = hero(72, 'mage', 40);
    player.skills.push('sk_spellbreak'); // the mage dispel (180% MAG)
    player.skills.push('sk_cataclysm'); // a strictly stronger strike (420% MAG)
    player.mp = 100;
    return { p: player, b: fight('e_rat', player, 12) };
  };
  const exposed: EffectSpec = {
    kind: 'statmod',
    target: 'opponent',
    stat: 'incoming',
    pct: 0.25,
    duration: 3,
    timing: 'immediate',
    name: 'Exposed',
  };
  // The ONLY enemy-side instance is a player-applied Exposed — harmful.
  // The dispel branch precedes the damage branch, so picking Spellbreak
  // here would mean dispelling the player's own debuff; with the branch
  // gated on semantics the policy falls through to the bigger strike.
  const exposedFixture = mk();
  applyInstance(
    exposedFixture.b,
    seedForSpec(exposed, 'ex2', 'Exposed', 'enemy', { kind: 'skill', id: 'x', name: 'x' }),
  );
  const action = chooseAction(exposedFixture.p, exposedFixture.b, POLICIES.tactical, false);
  assert(
    !(action.kind === 'skill' && action.skillId === 'sk_spellbreak'),
    `a vulnerable foe is not a dispel target (${JSON.stringify(action)})`,
  );
  // Control: a REAL enemy benefit (a live guard stance) draws the dispel
  // ahead of the damage rotation.
  const guardedFixture = mk();
  applyInstance(
    guardedFixture.b,
    seedForSpec(
      { kind: 'statmod', stat: 'mitigation', pct: 1.0, duration: 3, timing: 'immediate' },
      'ward_test',
      'Ward',
      'enemy',
      { kind: 'skill', id: 'x', name: 'x' },
    ),
  );
  const dispel = chooseAction(guardedFixture.p, guardedFixture.b, POLICIES.tactical, false);
  assertEquals(
    dispel.kind === 'skill' && dispel.skillId === 'sk_spellbreak',
    true,
    `a live enemy benefit is dispelled (${JSON.stringify(dispel)})`,
  );
});

Deno.test('#92: Petrify Gaze lands the documented Petrified slow', () => {
  let seed = -1;
  for (let candidateSeed = 1; candidateSeed <= 120; candidateSeed++) {
    const player = hero(600 + candidateSeed, 'warrior', 39);
    player.hp = 99999; // #86: survive the gaze — a felled hero stops the rider list
    const battle = fight('e_watcher', player, candidateSeed);
    const res = round(player, battle, candidateSeed);
    if (res.lines.some((line) => line.includes('The gaze sets in'))) {
      seed = candidateSeed;
      break;
    }
  }
  assert(seed > 0, 'a petrify seed exists');
  const player = hero(8, 'warrior', 39);
  player.hp = 99999; // #86: survive the gaze so the rider resolves
  const battle = fight('e_watcher', player, seed);
  round(player, battle, seed);
  const petrified = battle.effectInstances.find((instance) =>
    instance.side === 'player' && instance.name === 'Petrified'
  )!;
  assertEquals(petrified.stat, 'spd');
  assertEquals(petrified.pct, -0.25);
  assertEquals(petrified.tags.includes('slow'), true);
  assertEquals(petrified.tags.includes('harmful'), true);
  assert(statPct(battle, 'player', 'spd') < 0);
});

Deno.test('#92: enemy AI refills a broken ward, skips a near-full one, recasts after expiry', () => {
  let seed = -1;
  for (let candidateSeed = 1; candidateSeed <= 120; candidateSeed++) {
    const player = hero(700 + candidateSeed, 'warrior', 18);
    player.hp = 99999; // #86: survive the scan window
    const battle = fight('e_sentinel', player, candidateSeed);
    const res = round(player, battle, candidateSeed);
    if (res.lines.some((line) => line.includes('raises a Shield'))) {
      seed = candidateSeed;
      break;
    }
  }
  assert(seed > 0, 'a bulwark seed exists');

  // Broken ward: pool fully absorbed while the instance is still live —
  // the recast must be eligible again (#92).
  const p1 = hero(9, 'warrior', 18);
  p1.hp = 99999; // #86: the refill scan needs the hero alive through every round
  const b1 = fight('e_sentinel', p1, seed);
  round(p1, b1, seed);
  const ward = b1.effectInstances.find((instance) =>
    instance.side === 'enemy' && instance.kind === 'shield'
  )!;
  assertExists(ward);
  b1.shield.enemy = 0;
  ward.remaining = 20; // keep it live far beyond the scan window
  let refilled = false;
  for (let roundOffset = 0; roundOffset < 16 && !refilled; roundOffset++) {
    const res = round(p1, b1, seed + 10 + roundOffset, { kind: 'guard' });
    refilled = res.lines.some((line) => line.includes('raises a Shield'));
  }
  assert(refilled, 'a broken ward is refill-eligible: the AI recasts it');
  assertEquals(b1.shield.enemy, 45, 'the recast grants fresh capacity');

  // Near-full ward: pool above half the grant — still skipped.
  const p2 = hero(10, 'warrior', 18);
  p2.hp = 99999; // #86: the skip scan needs the hero alive through every round
  const b2 = fight('e_sentinel', p2, seed);
  round(p2, b2, seed);
  const ward2 = b2.effectInstances.find((instance) =>
    instance.side === 'enemy' && instance.kind === 'shield'
  )!;
  assertExists(ward2);
  b2.shield.enemy = 30;
  ward2.remaining = 20;
  for (let roundOffset = 0; roundOffset < 12; roundOffset++) {
    const res = round(p2, b2, seed + 40 + roundOffset, { kind: 'guard' });
    assertEquals(
      res.lines.some((line) => line.includes('raises a Shield')),
      false,
      'a near-full ward is never recast',
    );
  }

  // Expired ward: after the refilled ward runs out, the AI casts again.
  let sawExpired = false;
  let recastAfterExpiry = false;
  for (let roundOffset = 0; roundOffset < 40 && !recastAfterExpiry; roundOffset++) {
    const res = round(p1, b1, seed + 40 + roundOffset, { kind: 'guard' });
    if (
      b1.effectInstances.every((instance) =>
        !(instance.side === 'enemy' && instance.kind === 'shield')
      )
    ) {
      sawExpired = true;
    }
    if (sawExpired && res.lines.some((line) => line.includes('raises a Shield'))) {
      recastAfterExpiry = true;
    }
  }
  assert(sawExpired, 'the refilled ward eventually expires');
  assert(recastAfterExpiry, 'an expired ward is recast-eligible');
});

Deno.test('#92: Cleansing Tonic copy matches its real cleanse', () => {
  const description = consumableEffectLines(item('c_antidote')!.effect!).join(' ');
  assert(
    description.includes('harmful'),
    'the copy covers every removable harmful effect, not just sap',
  );
});

Deno.test('#134: generic shield-break output uses the canonical term', () => {
  // Generic factual system output states one canonical rendering —
  // "Your Shield breaks." — not authored variants.
  let seed = -1;
  let lines: string[] = [];
  for (let candidateSeed = 1; candidateSeed <= 160; candidateSeed++) {
    const player = hero(600 + candidateSeed, 'warrior', 6);
    const battle = fight('e_spider', player, candidateSeed);
    grantShield(battle, 'player', wardOf(1)); // any strike drains it to zero
    const res = round(player, battle, candidateSeed);
    if (res.lines.some((line) => line.includes('Shield breaks'))) {
      seed = candidateSeed;
      lines = res.lines;
      break;
    }
  }
  assert(seed > 0, 'a shield-breaking strike exists');
  assert(
    lines.some((line) => line.includes('🛡️ Your Shield breaks!')),
    `canonical player-side copy: ${lines.filter((line) => line.includes('🛡️'))}`,
  );
  assert(
    !lines.some((line) => line.toLowerCase().includes('shatters')),
    'the retired "shatters" copy is gone',
  );
});

Deno.test('#134: the battle row states a DoT\u2019s Shield bypass in generated copy', () => {
  const player = hero(601, 'warrior', 6);
  const battle = fight('e_spider', player, 3);
  applyInstance(battle, {
    defId: 'test_venom',
    name: 'Poison',
    kind: 'periodic',
    side: 'player',
    source: { kind: 'enemyMove', id: 'e_spider', name: 'Venom Bite' },
    perRound: -4,
    duration: 3,
    tickPhase: 'roundEnd',
    timing: 'immediate',
    tags: ['poison', 'harmful'],
    bypassShield: true,
    stacking: 'replace',
    removable: true,
  });
  const rendered = JSON.stringify(renderBattle(player));
  assert(
    rendered.includes('−4 HP/round, ignores Shield'),
    'the row derives the bypass from the instance data',
  );
});
