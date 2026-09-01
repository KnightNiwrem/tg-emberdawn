/** #83 shared status vocabulary — enemy adoption: Poison is the only
 * shield-bypassing DoT, Burn routes through wards, Slow (Chill/Web/Ageing
 * flavors) cuts SPD, shells are real expiring wards under #79 semantics,
 * bosses carry authored status resistance with visible "resists" feedback,
 * and the enemy AI never wastes heals/wards/buffs. Silence as an
 * action-status is deliberately NOT shipped. */

import { assert, assertEquals, assertExists } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { performAction, type PlayerAction, startBattle } from '../src/engine/combat.ts';
import { applyInstance, grantShield, statPct } from '../src/engine/effects.ts';
import type { InstanceSeed } from '../src/engine/effects.ts';
import type { BattleOrigin, BattleState, ClassId, PlayerState } from '../src/engine/types.ts';
import { skill } from '../src/content/skills.ts';
import { enemy } from '../src/content/enemies.ts';
import { seeded } from './helpers.ts';

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
  const b = startBattle(enemyId, origin, { player: p, rng: seeded(seed) })!;
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
  assertEquals(poison.defId, 'Venom Bite');
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
    const b = fight('e_cinderhound', p, t);
    const res = round(p, b, t);
    if (res.lines.some((l) => l.includes('Burning — 8 damage/round'))) {
      s = t;
      break;
    }
  }
  assert(s > 0, 'a burn seed exists');
  const p = hero(2, 'warrior', 33);
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
    const b = fight('e_iceling', p, t);
    const res = round(p, b, t);
    if (res.lines.some((l) => l.includes('raises a ward absorbing up to 65 damage'))) {
      s = t;
      break;
    }
  }
  assert(s > 0, 'a shell seed exists');
  const p = hero(4, 'warrior', 27);
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
    ['e_aldric', 0.4],
    ['e_warden', 0.4],
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
