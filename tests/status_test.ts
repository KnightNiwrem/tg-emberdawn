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
import { chooseAction, POLICIES } from '../src/engine/balance.ts';
import { injectMod, seeded } from './helpers.ts';
import type { EffectSpec, EffectTag, StatKey } from '../src/content/types.ts';

const ORIGIN = { kind: 'explore', zoneId: 'whisperwood' } as const;
const ABYSS = { kind: 'explore', zoneId: 'abyss' } as const;

function hero(id: number, classId: ClassId, level: number): PlayerState {
  const p = createPlayer(id, 'T', classId);
  p.level = level;
  return p;
}

function fight(
  enemyId: string,
  p: PlayerState,
  seed: number,
  origin: BattleOrigin = ORIGIN,
): BattleState {
  const b = startBattle(enemyId, origin, { player: p, rng: seeded(seed) })!.battle;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;
  return b;
}

function round(
  p: PlayerState,
  b: BattleState,
  seed: number,
  action: PlayerAction = { kind: 'attack' },
) {
  return performAction(p, b, action, seeded(seed));
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
  let s = -1;
  for (let t = 1; t <= 120; t++) {
    const p = hero(500 + t, 'warrior', 6);
    const b = fight('e_spider', p, t);
    const res = round(p, b, t);
    if (
      res.lines.some((l) => l.includes('The venom bites in')) &&
      b.effectInstances.some((i) => i.side === 'player' && i.name === 'Poison')
    ) {
      s = t;
      break;
    }
  }
  assert(s > 0, 'a venom seed exists');
  const p = hero(1, 'warrior', 6);
  const b = fight('e_spider', p, s);
  round(p, b, s);
  const poison = b.effectInstances.find((i) => i.side === 'player' && i.name === 'Poison');
  assertExists(poison);
  assertEquals(poison.defId, 'Venom Bite:e1');
  assertEquals(poison.bypassShield, true, 'Poison is the ONLY bypassing DoT');
  assertEquals(poison.perRound, -4);
  assertEquals(poison.tags?.includes('poison'), true);
  assertEquals(poison.tags?.includes('harmful'), true);
  // A fresh ward does not stop the next tick — Poison bites HP directly.
  grantShield(b, 'player', wardOf(500));
  const hpBefore = p.hp;
  round(p, b, s + 1);
  assert(p.hp < hpBefore, 'the poison tick ignored the ward');
});

Deno.test('#83: player poison shares the bypass identity', () => {
  const venom = skill('sk_venom_cut')!.effects.find((e) => e.kind === 'periodic')!;
  assert(venom.kind === 'periodic');
  assertEquals(venom.bypassShield, true);
  assertEquals(venom.tags?.includes('poison'), true);
  const ambush = skill('sk_ambush')!.effects.find((e) => e.kind === 'periodic')!;
  assert(ambush.kind === 'periodic');
  assertEquals(ambush.bypassShield, true);
});

Deno.test('#83: Burn routes through the ward like ordinary damage', () => {
  let s = -1;
  for (let t = 1; t <= 120; t++) {
    const p = hero(500 + t, 'warrior', 33);
    p.hp = 99999; // #86: a lethal hit stops its riders — survive to watch the burn land
    const b = fight('e_cinderhound', p, t);
    const res = round(p, b, t);
    if (res.lines.some((l) => l.includes('Burning — 8 damage/round'))) {
      s = t;
      break;
    }
  }
  assert(s > 0, 'a burn seed exists');
  const p = hero(2, 'warrior', 33);
  p.hp = 99999; // #86: same survival for the deterministic replay
  const b = fight('e_cinderhound', p, s);
  round(p, b, s);
  const burn = b.effectInstances.find((i) => i.side === 'player' && i.name === 'Burn');
  assertExists(burn);
  assertEquals(burn.bypassShield, undefined, 'Burn is ward-routed, unlike Poison');
  grantShield(b, 'player', wardOf(500));
  const hpBefore = p.hp;
  round(p, b, s + 1);
  assertEquals(p.hp, hpBefore, 'the ward absorbed strike and burn alike');
  assert(b.shield.player < 500, 'the ward paid for them');
});

Deno.test('#83: Web Snare slows — SPD and therefore dodge fall', () => {
  let s = -1;
  for (let t = 1; t <= 120; t++) {
    const p = hero(500 + t, 'warrior', 6);
    const b = fight('e_spider', p, t);
    const res = round(p, b, t);
    if (res.lines.some((l) => l.includes('The webbing binds'))) {
      s = t;
      break;
    }
  }
  assert(s > 0, 'a snare seed exists');
  const p = hero(3, 'warrior', 6);
  const b = fight('e_spider', p, s);
  round(p, b, s);
  const webbed = b.effectInstances.find((i) => i.side === 'player' && i.name === 'Webbed');
  assertExists(webbed);
  assertEquals(webbed.stat, 'spd');
  assertEquals(webbed.pct, -0.25);
  assertEquals(webbed.tags.includes('slow'), true);
  assert(statPct(b, 'player', 'spd') < 0);
});

Deno.test('#83: Frost Shell is a real expiring ward, not a mitigation stance', () => {
  let s = -1;
  for (let t = 1; t <= 120; t++) {
    const p = hero(500 + t, 'warrior', 27);
    p.hp = 99999; // #86: a fallen hero freezes the round — survive the shell scan
    const b = fight('e_iceling', p, t);
    const res = round(p, b, t);
    if (res.lines.some((l) => l.includes('raises a ward absorbing up to 65 damage'))) {
      s = t;
      break;
    }
  }
  assert(s > 0, 'a shell seed exists');
  const p = hero(4, 'warrior', 27);
  p.hp = 99999; // #86: the expiry loop needs the hero alive through every settle
  const b = fight('e_iceling', p, s);
  round(p, b, s);
  assertEquals(b.shield.enemy, 65, 'the shell is pool capacity, like #79 wards');
  const ward = b.effectInstances.find((i) => i.side === 'enemy' && i.kind === 'shield');
  assertExists(ward);
  assertEquals(ward.name, 'Frost Shell');
  // Run rounds until a non-recast round elapses; the ward must then be
  // gone (expired) with an empty pool — unless it was drained first.
  for (let r = 0; r < 6; r++) {
    const res = round(p, b, s + 1 + r);
    if (!res.lines.some((l) => l.includes('raises a ward'))) break;
  }
  assertEquals(
    b.effectInstances.some((i) => i.side === 'enemy' && i.kind === 'shield'),
    false,
    'the ward expired',
  );
  assertEquals(b.shield.enemy, 0);
});

Deno.test('#83: status resistance visibly resists — and sometimes fails', () => {
  let resisted = -1;
  let landed = -1;
  for (let s = 1; s <= 140 && (resisted < 0 || landed < 0); s++) {
    const p = hero(700 + s, 'warrior', 25);
    p.skills.push('sk_sunder_armor');
    p.mp = 100;
    const b = fight('e_chronolich', p, s);
    const res = round(p, b, s, { kind: 'skill', skillId: 'sk_sunder_armor' });
    const broke = b.effectInstances.some((i) => i.side === 'enemy' && i.stat === 'def');
    if (resisted < 0 && !broke && res.lines.some((l) => l.includes('resists Sunder Armor'))) {
      resisted = s;
    }
    if (landed < 0 && broke) landed = s;
  }
  assert(resisted > 0, 'a resisted application was announced, not silent');
  assert(landed > 0, 'resistance is probabilistic — applications still land');
  // Deterministic replay of the resisted seed:
  const p = hero(700 + resisted, 'warrior', 25);
  p.skills.push('sk_sunder_armor');
  p.mp = 100;
  const b = fight('e_chronolich', p, resisted);
  const res = round(p, b, resisted, { kind: 'skill', skillId: 'sk_sunder_armor' });
  assert(res.lines.some((l) => l.includes('resists Sunder Armor')));
  assertEquals(
    b.effectInstances.some((i) => i.side === 'enemy' && i.stat === 'def'),
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
  let s = -1;
  for (let t = 1; t <= 60; t++) {
    const p = hero(500 + t, 'warrior', 10);
    const b = fight('e_aranya', p, t);
    b.enemy.turn = 3; // the next enemy action is the 4th — Brood Surge due
    // GUARD: the hero deals no damage, so the boss is genuinely at full HP
    // when its special comes due — the heal would restore 0.
    const res = round(p, b, t, { kind: 'guard' });
    if (
      !res.lines.some((l) => l.includes('recovers')) &&
      res.lines.some((l) => l.includes('damage to you'))
    ) {
      s = t;
      break;
    }
  }
  assert(s > 0, 'a fall-through seed exists');
  const p = hero(6, 'warrior', 10);
  const b = fight('e_aranya', p, s);
  b.enemy.turn = 3;
  const res = round(p, b, s, { kind: 'guard' });
  assertEquals(
    res.lines.some((l) => l.includes('recovers')),
    false,
    'Brood Surge at full HP would restore 0 — skipped',
  );
  assert(res.lines.some((l) => l.includes('damage to you')), 'a real attack happened instead');
});

Deno.test('#83: enemy AI skips re-warding over a live ward', () => {
  let s = -1;
  for (let t = 1; t <= 120; t++) {
    const p = hero(500 + t, 'warrior', 18);
    const b = fight('e_sentinel', p, t);
    const res = round(p, b, t);
    if (res.lines.some((l) => l.includes('raises a ward absorbing up to 45 damage'))) {
      s = t;
      break;
    }
  }
  assert(s > 0, 'a bulwark seed exists');
  const p = hero(7, 'warrior', 18);
  const b = fight('e_sentinel', p, s);
  round(p, b, s);
  assertEquals(
    b.effectInstances.filter((i) => i.kind === 'shield' && i.side === 'enemy').length,
    1,
  );
  // While the ward is live the Bulwark move is wasted — never re-cast.
  for (let r = 0; r < 2; r++) {
    const res = round(p, b, s + 1 + r);
    if (b.effectInstances.some((i) => i.kind === 'shield' && i.side === 'enemy')) {
      assertEquals(
        res.lines.some((l) => l.includes('raises a ward')),
        false,
        'no refresh over a live ward',
      );
    }
  }
});

Deno.test('#83: Marsh Leech Drain damages and drains — enemy-side lifesteal', () => {
  let s = -1;
  for (let t = 1; t <= 120; t++) {
    const p = hero(500 + t, 'warrior', 11);
    const b = fight('e_leech', p, t);
    const res = round(p, b, t);
    if (res.lines.some((l) => l.includes('drains') && l.includes('from you'))) {
      s = t;
      break;
    }
  }
  assert(s > 0, 'a drain seed exists');
  const p = hero(8, 'warrior', 11);
  const b = fight('e_leech', p, s);
  const hpBefore = p.hp;
  const res = round(p, b, s);
  const drain = res.lines.find((l) => l.includes('Marsh Leech drains'));
  assertExists(drain, 'the enemy-side lifesteal line');
  assert(p.hp < hpBefore, 'the strike landed before the drain');
});

Deno.test('#83: Final Silence strips an active blessing — dispel, not a new status', () => {
  const p = hero(9, 'warrior', 46);
  p.hp = 99999; // #86: a lethal Silence stops its dispel — survive the strip
  const b = fight('e_warden', p, 7, ABYSS);
  b.enemy.turn = 2; // the next enemy action is the 3rd — Final Silence due
  applyInstance(b, {
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
  const res = round(p, b, 7);
  assertEquals(
    b.effectInstances.some((i) => i.defId === 'test_bless'),
    false,
    'the blessing was stripped',
  );
  assert(res.lines.some((l) => l.includes('benefits are stripped')));
  assert(
    res.lines.some((l) => l.includes('damage to you')),
    'the special still struck — dispel is a rider, not a replacement',
  );
});

Deno.test('#83: Swamp Curse breaks wards (RES down)', () => {
  let s = -1;
  for (let t = 1; t <= 120; t++) {
    const p = hero(500 + t, 'warrior', 13);
    const b = fight('e_fenhag', p, t);
    const res = round(p, b, t);
    if (res.lines.some((l) => l.includes('Ward Break'))) {
      s = t;
      break;
    }
  }
  assert(s > 0, 'a curse seed exists');
  const p = hero(10, 'warrior', 13);
  const b = fight('e_fenhag', p, s);
  round(p, b, s);
  const wb = b.effectInstances.find((i) => i.side === 'player' && i.name === 'Ward Break');
  assertExists(wb);
  assertEquals(wb.stat, 'res');
  assertEquals(wb.pct, -0.25);
  assertEquals(wb.tags.includes('ward-break'), true);
});

// ── #85: enemy-side folds — debuffs must change the actual numbers ──────

function damageOf(lines: string[]): number | undefined {
  for (const l of lines) {
    const m = l.match(/for (\d+)/);
    if (m) return Number(m[1]);
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
  const p = hero(940, classId, 10);
  const b = fight('e_rat', p, 4242);
  for (const m of mods) injectMod(b, 'enemy', m.stat, m.pct, m.defId ? { defId: m.defId } : {});
  const d = damageOf(round(p, b, 777).lines);
  assertExists(d, 'the strike must land and report its damage');
  return d;
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
  const p = hero(941, 'rogue', 10);
  const b1 = fight('e_rat', p, 1);
  const b2 = fight('e_rat', hero(941, 'rogue', 10), 1);
  injectMod(b2, 'enemy', 'spd', 0.5);
  assert(
    effectiveEnemySpd(b2) > effectiveEnemySpd(b1),
    'enemy SPD +50% must raise its effective SPD',
  );
});

Deno.test('#85: enemy Slow cuts effective enemy SPD — dodge and flee odds inputs rise', () => {
  const p = hero(942, 'warrior', 1);
  const b1 = fight('e_rat', p, 1);
  const pSpd = effectivePlayerSpd(p, b1);
  const eSpd = effectiveEnemySpd(b1);
  const b2 = fight('e_rat', hero(942, 'warrior', 1), 1);
  injectMod(b2, 'enemy', 'spd', -0.95);
  const eSlow = effectiveEnemySpd(b2);
  assert(eSlow < eSpd, `Slow must cut effective enemy SPD (${eSpd} → ${eSlow})`);
  assert(
    dodgeChance(pSpd, eSlow) > dodgeChance(pSpd, eSpd),
    'a slowed foe is slipped more often',
  );
  const flee = (e: number) => Math.min(0.9, Math.max(0.15, 0.5 + (pSpd - e) * 0.03));
  assert(flee(eSlow) > flee(eSpd), 'a slowed foe is escaped more easily');
});

Deno.test('#85: a slowed enemy is genuinely easier to flee (end to end)', () => {
  let found = -1;
  for (let s = 1; s <= 300 && found < 0; s++) {
    const attempt = (slow: boolean) => {
      const p = hero(950 + s, 'warrior', 1);
      const b = fight('e_rat', p, s);
      if (slow) injectMod(b, 'enemy', 'spd', -0.95);
      // The flee draw is the FIRST draw of this round's stream — vary the
      // seed with s so the scan actually sweeps the chance interval.
      return round(p, b, s, { kind: 'flee' }).lines.some((l) => l.includes('slip away'));
    };
    if (!attempt(false) && attempt(true)) found = s;
  }
  assert(found > 0, 'a seed exists where Slow flips a failed flee into an escape');
});

Deno.test('#85: a slowed enemy is genuinely easier to dodge (end to end)', () => {
  let found = -1;
  for (let s = 1; s <= 800 && found < 0; s++) {
    const attempt = (slow: boolean) => {
      const p = hero(1400 + s, 'warrior', 1);
      const b = fight('e_rat', p, s);
      if (slow) injectMod(b, 'enemy', 'spd', -0.95);
      return round(p, b, s).lines.some((l) => l.includes('💨'));
    };
    if (!attempt(false) && attempt(true)) found = s;
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
  const burn = skill('sk_scorch')!.effects.find((e) => e.kind === 'periodic')!;
  const burnTags = semanticTags(burn);
  assertEquals(burnTags.includes('burn'), true);
  assertEquals(burnTags.includes('poison'), false);
  // Thorn Ring's brambles: bleed, never poison.
  const bleed = item('t_9')!.triggers![0]!.effects[0]!;
  const bleedTags = semanticTags(bleed);
  assertEquals(bleedTags.includes('bleed'), true);
  assertEquals(bleedTags.includes('poison'), false);
  // Venom stays poison and keeps its shield-bypass policy.
  const venom = skill('sk_venom_cut')!.effects.find((e) => e.kind === 'periodic')!;
  const venomTags = semanticTags(venom);
  assertEquals(venomTags.includes('poison'), true);
  assertEquals(venomTags.includes('burn'), false);
  assertEquals(venomTags.includes('bleed'), false);
  assert(venom.kind === 'periodic' && venom.bypassShield === true, 'poison keeps bypass');
  // Renew infers only the one unambiguous family: regen.
  const renew = skill('sk_renew')!.effects.find((e) => e.kind === 'periodic')!;
  const renewTags = semanticTags(renew);
  assertEquals(renewTags.includes('regen'), true);
  assertEquals(renewTags.includes('beneficial'), true);
  assertEquals(renewTags.includes('harmful'), false);
});

Deno.test('#87: incoming amplification is harmful — Expose and Death Mark are never benefits', () => {
  for (const id of ['sk_expose_weakness', 'sk_death_mark'] as const) {
    const mark = skill(id)!.effects.find((e) => e.kind === 'statmod' && e.stat === 'incoming')!;
    const tags = semanticTags(mark);
    assertEquals(tags.includes('harmful'), true, `${id} is harmful to the bearer`);
    assertEquals(tags.includes('beneficial'), false, `${id} is never beneficial`);
    assertEquals(tags.includes('vulnerable'), true, `${id} keeps its authored identity`);
  }
  // End to end: the live instance carries the same identity.
  const p = hero(60, 'rogue', 12);
  const b = fight('e_rat', p, 3);
  applyInstance(
    b,
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
  const inst = b.effectInstances.find((i) => i.side === 'enemy')!;
  assertEquals(inst.tags.includes('harmful'), true);
  assertEquals(inst.tags.includes('beneficial'), false);
});

Deno.test('#87: cleanse strips harm, dispel strips benefit — polarity respected', () => {
  const p = hero(71, 'rogue', 12);
  const b = fight('e_rat', p, 5);
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
    b,
    seedForSpec(exposed, 'ex1', 'Exposed', 'enemy', { kind: 'skill', id: 'x', name: 'x' }),
  );
  // A dispel hunting enemy BENEFITS must not touch the player's debuff…
  assertEquals(removeTagged(b, 'enemy', ['beneficial']).length, 0, 'harm is not benefit');
  // …and an enemy-side cleanse of HARM reaches it.
  assertEquals(removeTagged(b, 'enemy', ['harmful']).length, 1, 'cleanse reaches the debuff');
});

Deno.test('#87: the tactical policy never dispels player-applied vulnerability', () => {
  const mk = (): { p: PlayerState; b: BattleState } => {
    const p = hero(72, 'mage', 40);
    p.skills.push('sk_spellbreak'); // the mage dispel (180% MAG)
    p.skills.push('sk_cataclysm'); // a strictly stronger strike (420% MAG)
    p.mp = 100;
    return { p, b: fight('e_rat', p, 12) };
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
  const a = mk();
  applyInstance(
    a.b,
    seedForSpec(exposed, 'ex2', 'Exposed', 'enemy', { kind: 'skill', id: 'x', name: 'x' }),
  );
  const action = chooseAction(a.p, a.b, POLICIES.tactical, false);
  assert(
    !(action.kind === 'skill' && action.skillId === 'sk_spellbreak'),
    `a vulnerable foe is not a dispel target (${JSON.stringify(action)})`,
  );
  // Control: a REAL enemy benefit (a live guard stance) draws the dispel
  // ahead of the damage rotation.
  const c = mk();
  applyInstance(
    c.b,
    seedForSpec(
      { kind: 'statmod', stat: 'mitigation', pct: 1.0, duration: 3, timing: 'immediate' },
      'ward_test',
      'Ward',
      'enemy',
      { kind: 'skill', id: 'x', name: 'x' },
    ),
  );
  const dispel = chooseAction(c.p, c.b, POLICIES.tactical, false);
  assertEquals(
    dispel.kind === 'skill' && dispel.skillId === 'sk_spellbreak',
    true,
    `a live enemy benefit is dispelled (${JSON.stringify(dispel)})`,
  );
});

Deno.test('#92: Petrify Gaze lands the documented Petrified slow', () => {
  let s = -1;
  for (let t = 1; t <= 120; t++) {
    const p = hero(600 + t, 'warrior', 39);
    p.hp = 99999; // #86: survive the gaze — a felled hero stops the rider list
    const b = fight('e_watcher', p, t);
    const res = round(p, b, t);
    if (res.lines.some((l) => l.includes('The gaze sets in'))) {
      s = t;
      break;
    }
  }
  assert(s > 0, 'a petrify seed exists');
  const p = hero(8, 'warrior', 39);
  p.hp = 99999; // #86: survive the gaze so the rider resolves
  const b = fight('e_watcher', p, s);
  round(p, b, s);
  const petrified = b.effectInstances.find((i) => i.side === 'player' && i.name === 'Petrified')!;
  assertEquals(petrified.stat, 'spd');
  assertEquals(petrified.pct, -0.25);
  assertEquals(petrified.tags.includes('slow'), true);
  assertEquals(petrified.tags.includes('harmful'), true);
  assert(statPct(b, 'player', 'spd') < 0);
});

Deno.test('#92: enemy AI refills a broken ward, skips a near-full one, recasts after expiry', () => {
  let s = -1;
  for (let t = 1; t <= 120; t++) {
    const p = hero(700 + t, 'warrior', 18);
    p.hp = 99999; // #86: survive the scan window
    const b = fight('e_sentinel', p, t);
    const res = round(p, b, t);
    if (res.lines.some((l) => l.includes('raises a ward'))) {
      s = t;
      break;
    }
  }
  assert(s > 0, 'a bulwark seed exists');

  // Broken ward: pool fully absorbed while the instance is still live —
  // the recast must be eligible again (#92).
  const p1 = hero(9, 'warrior', 18);
  p1.hp = 99999; // #86: the refill scan needs the hero alive through every round
  const b1 = fight('e_sentinel', p1, s);
  round(p1, b1, s);
  const ward = b1.effectInstances.find((i) => i.side === 'enemy' && i.kind === 'shield')!;
  assertExists(ward);
  b1.shield.enemy = 0;
  ward.remaining = 20; // keep it live far beyond the scan window
  let refilled = false;
  for (let r = 0; r < 16 && !refilled; r++) {
    const res = round(p1, b1, s + 10 + r, { kind: 'guard' });
    refilled = res.lines.some((l) => l.includes('raises a ward'));
  }
  assert(refilled, 'a broken ward is refill-eligible: the AI recasts it');
  assertEquals(b1.shield.enemy, 45, 'the recast grants fresh capacity');

  // Near-full ward: pool above half the grant — still skipped.
  const p2 = hero(10, 'warrior', 18);
  p2.hp = 99999; // #86: the skip scan needs the hero alive through every round
  const b2 = fight('e_sentinel', p2, s);
  round(p2, b2, s);
  const ward2 = b2.effectInstances.find((i) => i.side === 'enemy' && i.kind === 'shield')!;
  assertExists(ward2);
  b2.shield.enemy = 30;
  ward2.remaining = 20;
  for (let r = 0; r < 12; r++) {
    const res = round(p2, b2, s + 40 + r, { kind: 'guard' });
    assertEquals(
      res.lines.some((l) => l.includes('raises a ward')),
      false,
      'a near-full ward is never recast',
    );
  }

  // Expired ward: after the refilled ward runs out, the AI casts again.
  let sawExpired = false;
  let recastAfterExpiry = false;
  for (let r = 0; r < 40 && !recastAfterExpiry; r++) {
    const res = round(p1, b1, s + 40 + r, { kind: 'guard' });
    if (b1.effectInstances.every((i) => !(i.side === 'enemy' && i.kind === 'shield'))) {
      sawExpired = true;
    }
    if (sawExpired && res.lines.some((l) => l.includes('raises a ward'))) {
      recastAfterExpiry = true;
    }
  }
  assert(sawExpired, 'the refilled ward eventually expires');
  assert(recastAfterExpiry, 'an expired ward is recast-eligible');
});

Deno.test('#92: Cleansing Tonic copy matches its real cleanse', () => {
  const d = item('c_antidote')!.desc!;
  assert(d.includes('harmful'), 'the copy covers every removable harmful effect, not just sap');
});
