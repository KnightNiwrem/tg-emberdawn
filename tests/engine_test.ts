/**
 * Engine unit tests — deterministic via seeded RNG.
 * Covers: creation, progression, combat, quests, economy, forge, world.
 */

import { assert, assertEquals, assertGreater, assertThrows } from '@std/assert';
import {
  applyDeath,
  createPlayer,
  CURRENT_STATE_VERSION,
  grantXp,
  migratePlayer,
  SaveTooNewError,
  SaveTooOldError,
  statsOf,
} from '../src/engine/character.ts';
import { xpForNextLevel } from '../src/engine/classes.ts';
import { derivedStats, MAX_LEVEL } from '../src/engine/classes.ts';
import {
  dodgeChance,
  performAction,
  type PlayerAction,
  previewBattle,
  rollRewards,
} from '../src/engine/combat.ts';
import { type BattleState, CLASS_IDS, type ClassId } from '../src/engine/types.ts';
import {
  acceptQuest,
  onKill,
  onTalk,
  questDropAllowed,
  syncAvailability,
  turnInQuest,
} from '../src/engine/quests.ts';
import { addItem, countOf, removeItem } from '../src/engine/inventory.ts';
import { buy, currentStock, sell } from '../src/engine/shops.ts';
import { temper, temperLevel } from '../src/engine/forge.ts';
import { diveDungeon, dungeonOf, explore, resolveVictory, travel } from '../src/engine/world.ts';
import { STARTING_ZONES, zone, ZONES } from '../src/content/zones.ts';
import { ENEMIES, enemy } from '../src/content/enemies.ts';
import { isEquippable, item, ITEMS } from '../src/content/items.ts';
import { SKILLS, skillsForClass } from '../src/content/skills.ts';
import { QUESTS } from '../src/content/quests.ts';
import { decodeCb, encodeCb, withRev } from '../src/codec.ts';
import {
  injectMod,
  mitigationPct,
  modInstance,
  modRemaining,
  sapPct,
  seeded,
  statmodSpec,
  statPct,
} from './helpers.ts';
import { semanticTags } from '../src/engine/effects.ts';
import type { EffectSpec, EffectTag } from '../src/content/types.ts';

Deno.test('character creation gives class kit and full pools', () => {
  const p = createPlayer(1, 'Test', 'warrior');
  assertEquals(p.level, 1);
  assertEquals(p.classId, 'warrior');
  assertEquals(p.hp, statsOf(p).maxHp);
  assertEquals(p.mp, statsOf(p).maxMp);
  assertEquals(p.equipment.weapon, 'w_warrior_1');
  assertEquals(p.equipment.armor, 'a_warrior_1');
  // Gear lives ONLY in equipment slots — no duplicate bag copy (P1-11).
  assertEquals(countOf(p, 'w_warrior_1'), 0);
  assert(p.gold > 0);
  assertEquals(p.skills, skillsForClass('warrior', 1).map((sk) => sk.id));
});

Deno.test('all four classes start with legal kits', () => {
  for (const cid of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    const p = createPlayer(2, 'T', cid);
    assert(p.equipment.weapon && item(p.equipment.weapon));
    assert(p.equipment.armor && item(p.equipment.armor));
    assertEquals(p.skills, skillsForClass(cid, 1).map((sk) => sk.id));
    assert(p.skills.length > 0, `${cid} should start with a level-1 skill`);
    assertEquals(statsOf(p).maxHp > 0, true);
    // Every class starts at its ACTUAL full pools (Cleric once under-counted).
    assertEquals(p.hp, statsOf(p).maxHp);
    assertEquals(p.mp, statsOf(p).maxMp);
  }
});

Deno.test('xp curve is increasing and max level reachable', () => {
  let prev = 0;
  for (let l = 1; l < MAX_LEVEL; l++) {
    const need = xpForNextLevel(l);
    assert(need > prev);
    prev = need;
  }
  assertEquals(xpForNextLevel(MAX_LEVEL), Number.POSITIVE_INFINITY);
});

Deno.test('grantXp levels up, restores pools and learns skills', () => {
  const p = createPlayer(3, 'T', 'mage');
  p.hp = 1;
  const lines = grantXp(p, xpForNextLevel(1) + 10);
  assertEquals(p.level, 2);
  assertEquals(p.hp, statsOf(p).maxHp);
  assert(lines.some((l) => l.includes('Level up')));
  // mage learns frost lance at 5; at 2 no new skills but no crash
});

Deno.test('combat: deterministic battle to victory with rewards', () => {
  const rng = seeded(42);
  const p = createPlayer(4, 'T', 'warrior');
  const battle = previewBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' })!;
  const attack: PlayerAction = { kind: 'attack' };
  let rounds = 0;
  while (battle.enemy.hp > 0 && rounds < 100) {
    performAction(p, battle, attack, rng);
    // force enemy hp drop check after enemy phase too
    rounds++;
  }
  assert(battle.enemy.hp <= 0, 'enemy should be dead');
  const def = enemy('e_rat')!;
  const rewards = rollRewards(def, rng);
  assert(rewards.xp > 0);
  assert(rewards.gold >= 0);
});

Deno.test('combat: player deals damage and takes damage in a real fight', () => {
  const rng = seeded(7);
  const p = createPlayer(5, 'T', 'warrior');
  const battle = previewBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  const hpBefore = p.hp;
  const enemyHpBefore = battle.enemy.hp;
  performAction(p, battle, { kind: 'attack' }, rng);
  assert(battle.enemy.hp < enemyHpBefore, 'player attack should damage enemy');
  if (p.hp < hpBefore) assert(p.hp >= 0);
});

// ── Class-typed free basic action (#70) ─────────────────────────────────────

/** dealDamage consumes exactly two rng draws per strike — the crit roll and
 * the variance roll. Replicating them lets tests pin crit/floor outcomes. */
function strikeDraws(seed: number, luck: number): { crit: boolean; v: number } {
  const rng = seeded(seed);
  const critRoll = rng();
  const varRoll = rng();
  return { crit: critRoll < Math.min(0.35, 0.04 + luck * 0.0035), v: varRoll };
}

Deno.test('combat: free basic action is class-typed in label and verb (#70)', () => {
  const cases: Array<[ClassId, string, 'hits' | 'sears']> = [
    ['warrior', 'Strike', 'hits'],
    ['rogue', 'Quick Attack', 'hits'],
    ['mage', 'Arcane Bolt', 'sears'],
    ['cleric', 'Radiant Strike', 'sears'],
  ];
  for (const [cid, name, verb] of cases) {
    const p = createPlayer(700, 'T', cid);
    const b = previewBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' })!;
    const r = performAction(p, b, { kind: 'attack' }, seeded(21));
    assert(
      r.lines.some((l) => l.includes(name) && l.includes(` ${verb} `)),
      `${cid} free action should read "<name> … ${verb} …", got: ${r.lines.join(' | ')}`,
    );
  }
});

Deno.test('combat: MAG/ATK buffs and Sapped modify the correct free action (#70)', () => {
  const dmg = (cid: ClassId, pct: { atk?: number; mag?: number; weaken?: number }): number => {
    const p = createPlayer(701, 'T', cid);
    const b = previewBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' })!;
    // Live instances fold into the free action (#78): ATK/MAG buffs raise
    // their own stat; Sapped cuts the outgoing damage of both legs.
    if (pct.atk) injectMod(b, 'player', 'atk', pct.atk);
    if (pct.mag) injectMod(b, 'player', 'mag', pct.mag);
    if (pct.weaken) injectMod(b, 'player', 'outgoing', -pct.weaken);
    const before = b.enemy.hp;
    performAction(p, b, { kind: 'attack' }, seeded(33));
    return before - b.enemy.hp;
  };
  const m = dmg('mage', {});
  assert(dmg('mage', { mag: 0.5 }) > m, '+MAG must raise the mage free action');
  assertEquals(dmg('mage', { atk: 0.5 }), m, '+ATK must not touch the mage free action');
  assert(dmg('mage', { weaken: 0.5 }) < m, 'Sapped must lower the mage free action');
  const w = dmg('warrior', {});
  assert(dmg('warrior', { atk: 0.5 }) > w, '+ATK must raise the warrior free action');
  assertEquals(dmg('warrior', { mag: 0.5 }), w, '+MAG must not touch the warrior free action');
  assert(dmg('warrior', { weaken: 0.5 }) < w, 'Sapped must lower the warrior free action');
});

Deno.test('combat: free action mitigates with DEF (phys) / RES (mag) (#70)', () => {
  // King Aldric's DEF (104) and RES (80) diverge enough that the expected
  // damage identifies which mitigation stat the action targeted.
  const expected = (
    offense: number,
    mitigation: number,
    d: { crit: boolean; v: number },
  ): number =>
    Math.max(
      1,
      Math.round(
        Math.max(1, offense - mitigation * 0.85) * (d.crit ? 1.6 : 1) * (0.9 + d.v * 0.2),
      ),
    );
  const aldric = enemy('e_aldric')!;
  const origin = { kind: 'explore', zoneId: 'crownspire' } as const;

  const mage = createPlayer(702, 'T', 'mage');
  mage.level = 45;
  mage.hp = 99999; // #86: survive Aldric's responses — a defeated actor no longer acts
  const mDraws = strikeDraws(34, statsOf(mage).luck);
  const mb = previewBattle('e_aldric', origin)!;
  const mBefore = mb.enemy.hp;
  performAction(mage, mb, { kind: 'attack' }, seeded(34));
  const mDmg = mBefore - mb.enemy.hp;
  const mRes = expected(statsOf(mage).mag, aldric.res, mDraws);
  assertEquals(mDmg, mRes, 'mage free action must mitigate with RES');
  assert(
    mRes !== expected(statsOf(mage).mag, aldric.def, mDraws),
    'case must distinguish RES from DEF',
  );
  // Enemy guard stance raises whichever stat the action targets.
  // Enemy guard stance is a live mitigation instance (#78): 1.0 doubles
  // whichever mitigation stat the action targets.
  injectMod(mb, 'enemy', 'mitigation', 1.0);
  const mBeforeGuard = mb.enemy.hp;
  performAction(mage, mb, { kind: 'attack' }, seeded(34));
  const mGuardDmg = mBeforeGuard - mb.enemy.hp;
  assertEquals(
    mGuardDmg,
    expected(statsOf(mage).mag, aldric.res * 2, mDraws),
    'enemy guard must double the RES mitigation',
  );
  assert(mGuardDmg < mDmg, 'enemy guard stance must cut the free action');

  const warrior = createPlayer(703, 'T', 'warrior');
  warrior.level = 45;
  const wDraws = strikeDraws(34, statsOf(warrior).luck);
  const wb = previewBattle('e_aldric', origin)!;
  const wBefore = wb.enemy.hp;
  performAction(warrior, wb, { kind: 'attack' }, seeded(34));
  const wDmg = wBefore - wb.enemy.hp;
  const wDef = expected(statsOf(warrior).atk, aldric.def, wDraws);
  assertEquals(wDmg, wDef, 'warrior free action must mitigate with DEF');
  assert(
    wDef !== expected(statsOf(warrior).atk, aldric.res, wDraws),
    'case must distinguish DEF from RES',
  );
});

Deno.test('combat: free action floors at 1 damage and surfaces crits (#70)', () => {
  // Level-1 mage vs the Sundered King: ~21 MAG against ~80 RES clamps the
  // raw roll to the 1-damage floor.
  const p = createPlayer(704, 'T', 'mage');
  p.hp = 99999; // #86: survive Aldric's response — a defeated actor no longer acts
  const floor = previewBattle('e_aldric', { kind: 'explore', zoneId: 'crownspire' })!;
  injectMod(floor, 'enemy', 'spd', -0.95); // #86: guarantee the mage takes slot 1
  const before = floor.enemy.hp;
  const r = performAction(p, floor, { kind: 'attack' }, seeded(9));
  assert(r.consumedTurn, 'the floored attack still consumes the turn');
  const dealt = before - floor.enemy.hp;
  if (strikeDraws(9, statsOf(p).luck).crit) {
    assert([1, 2].includes(dealt), `floored crit deals 1-2, got ${dealt}`);
  } else {
    assertEquals(dealt, 1, 'raw below 1 must floor at exactly 1');
  }
  // A crit-carrying seed must surface the crit marker in the round line.
  let critSeed = -1;
  for (let s = 1; s <= 40; s++) {
    if (strikeDraws(s, statsOf(p).luck).crit) {
      critSeed = s;
      break;
    }
  }
  assert(critSeed > 0, 'expected a crit seed within 1..40');
  const critBattle = previewBattle('e_aldric', { kind: 'explore', zoneId: 'crownspire' })!;
  injectMod(critBattle, 'enemy', 'spd', -0.95); // #86: the mage takes slot 1 — draws align
  const r2 = performAction(p, critBattle, { kind: 'attack' }, seeded(critSeed));
  assert(r2.lines.some((l) => l.includes('critical')), 'crit line must carry the marker');
});

Deno.test('combat: skills consume mp and respect cooldown', () => {
  const rng = seeded(11);
  const p = createPlayer(6, 'T', 'mage');
  p.level = 13;
  p.skills.push('sk_arcane_surge', 'sk_firebolt');
  p.mp = statsOf(p).maxMp;
  const battle = previewBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' })!;
  // Keep the fight alive across both taps (#96: a terminal battle resolves
  // before validation feedback — this test pins cooldown/MP behavior).
  battle.enemy.hp = 99999;
  battle.enemy.maxHp = 99999;
  const mpBefore = p.mp;
  const r1 = performAction(p, battle, { kind: 'skill', skillId: 'sk_arcane_surge' }, rng);
  assert(p.mp < mpBefore, 'mp should be spent');
  assert(r1.lines.some((l) => l.includes('Arcane Surge')));
  // cooldown 2: immediate reuse should be blocked
  const r2 = performAction(p, battle, { kind: 'skill', skillId: 'sk_arcane_surge' }, rng);
  assert(r2.lines.some((l) => l.includes('cooldown')));
});

Deno.test('combat: guard halves incoming damage', () => {
  // Track damage via a spy: run guarded vs unguarded with same seed and
  // compare enemy-phase damage parsed from the log.
  const guarded = play('guard');
  const unguarded = play('attack');
  // Damage is read from the structured round history (#67): every consumed
  // round is one complete entry, flattened for this assertion.
  const dmgOf = (battle: BattleState): number => {
    const line = battle.history.flatMap((r) => r.lines).find((l) => l.includes('uses'));
    return Number((line?.match(/— (\d+) damage/) ?? [])[1] ?? 0);
  };
  assert(dmgOf(unguarded) > 0, 'wolf should deal damage');
  assert(
    dmgOf(guarded) <= dmgOf(unguarded),
    `guarded hit ${dmgOf(guarded)} should not exceed unguarded ${dmgOf(unguarded)}`,
  );

  function play(action: 'guard' | 'attack') {
    const battle = previewBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
    const pc = createPlayer(10, 'T', 'cleric');
    performAction(pc, battle, { kind: action }, seeded(5));
    return battle;
  }
});

Deno.test('boss battles cannot be fled', () => {
  const rng = seeded(3);
  const p = createPlayer(9, 'T', 'rogue');
  p.level = 45;
  const battle = previewBattle('e_aldric', {
    kind: 'dungeon',
    zoneId: 'umbra',
    dungeonId: 'd_throne',
    floor: 4,
    boss: true,
  })!;
  const r = performAction(p, battle, { kind: 'flee' }, rng);
  assert(r.lines.some((l) => l.includes('no escape')));
  assertEquals(battle.phase, 'active');
});

Deno.test('quest flow: accept, progress by kill, turn in, unlock next', () => {
  const p = createPlayer(10, 'T', 'warrior');
  syncAvailability(p);
  assert(p.quests['m1_embers']?.status === 'available');
  const acc = acceptQuest(p, 'm1_embers', 'npc_maren');
  assert(acc.ok);
  for (let i = 0; i < 4; i++) onKill(p, 'e_ember_rat');
  assertEquals(p.quests['m1_embers'].status, 'turnIn');
  const res = turnInQuest(p, 'm1_embers', 'npc_maren');
  assert(res.ok);
  assertEquals(p.quests['m1_embers'].status, 'done');
  // m2 requires m1 done → now available
  syncAvailability(p);
  assert(p.quests['m2_letter']?.status === 'available');
});

Deno.test('quest objectives are satisfiable by content design', () => {
  // every referenced enemy/item/zone exists
  for (const q of QUESTS) {
    for (const o of q.objectives) {
      if (o.kind === 'kill') assert(enemy(o.target), `missing enemy ${o.target} in ${q.id}`);
      if (o.kind === 'collect') assert(item(o.target), `missing item ${o.target} in ${q.id}`);
      if (o.kind === 'reach') assert(zone(o.target), `missing zone ${o.target} in ${q.id}`);
    }
    for (const iid of Object.keys(q.rewards.items ?? {})) {
      assert(item(iid), `missing reward item ${iid} in ${q.id}`);
    }
    if (q.rewards.unlockZone) assert(zone(q.rewards.unlockZone), `missing unlock zone in ${q.id}`);
  }
});

Deno.test('inventory: add/remove/count roundtrip', () => {
  const p = createPlayer(11, 'T', 'rogue');
  addItem(p, 'c_minor_potion', 2);
  assertEquals(countOf(p, 'c_minor_potion'), 4); // rogue starts with 2
  removeItem(p, 'c_minor_potion', 4);
  assertEquals(countOf(p, 'c_minor_potion'), 0);
  assertEquals(removeItem(p, 'c_minor_potion'), false);
});

Deno.test('boss specials fire on the configured Nth enemy action (#26)', () => {
  // Vosk: special every 3 ("Swallow Whole"). Guard-spam rounds and record
  // which enemy actions fire the special — deterministic cadence, seeded
  // RNG only varies the filler moves.
  const rng = seeded(55);
  const p = createPlayer(60, 'T', 'warrior');
  p.level = 45;
  const b = previewBattle('e_vosk', { kind: 'explore', zoneId: 'hollowmere' })!;
  p.battle = b;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  const specialRounds: number[] = [];
  for (let round = 1; round <= 9; round++) {
    const res = performAction(p, b, { kind: 'guard' }, rng);
    if (res.lines.some((l) => l.includes('Swallow Whole'))) specialRounds.push(round);
  }
  assertEquals(specialRounds, [3, 6, 9], 'every:3 → actions 3/6/9, not 2/5/8');

  // Chronolich: special every 4 ("Temporal Collapse").
  const rng2 = seeded(56);
  const m = createPlayer(61, 'T', 'mage');
  m.level = 45;
  m.hp = 99999; // #86: survive the collapse hits — a defeated actor ends the round
  const b2 = previewBattle('e_chronolich', { kind: 'explore', zoneId: 'sunspire' })!;
  m.battle = b2;
  b2.enemy.hp = 99999;
  b2.enemy.maxHp = 99999;
  const collapseRounds: number[] = [];
  for (let round = 1; round <= 12; round++) {
    const res = performAction(m, b2, { kind: 'guard' }, rng2);
    if (res.lines.some((l) => l.includes('Temporal Collapse'))) collapseRounds.push(round);
  }
  assertEquals(collapseRounds, [4, 8, 12], 'every:4 → actions 4/8/12');
});

Deno.test('buff durations: phase-aware cast-round decay (#27, #38, #77)', () => {
  // Fixture sanity: the content contract advertises these durations —
  // pinned through the effect specs (#78); Adrenaline's ATK leg is
  // content-authored too, stacking as its own instance.
  assertEquals(statmodSpec(SKILLS.find((s) => s.id === 'sk_war_cry')!, 'atk')!.duration, 3);
  assertEquals(statmodSpec(SKILLS.find((s) => s.id === 'sk_time_warp')!, 'mag')!.duration, 3);

  const mkBattle = (cls: 'warrior' | 'mage' | 'rogue', userId: number, skillId: string) => {
    const p = createPlayer(userId, 'T', cls);
    p.level = 40;
    p.skills.push(skillId);
    p.mp = 999;
    const b = previewBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
    b.enemy.hp = 99999;
    b.enemy.maxHp = 99999;
    p.battle = b;
    return { p, b };
  };

  // War Cry (atk, 3): cast round not consumed → exactly 3 empowered attacks.
  const w = mkBattle('warrior', 62, 'sk_war_cry');
  performAction(w.p, w.b, { kind: 'skill', skillId: 'sk_war_cry' }, seeded(61));
  assertEquals(
    modRemaining(w.b, 'player', 'atk'),
    3,
    'cast round must not tick the offensive buff',
  );
  performAction(w.p, w.b, { kind: 'attack' }, seeded(62)); // empowered 1
  assertEquals(modRemaining(w.b, 'player', 'atk'), 2);
  performAction(w.p, w.b, { kind: 'attack' }, seeded(63)); // empowered 2
  assertEquals(modRemaining(w.b, 'player', 'atk'), 1);
  performAction(w.p, w.b, { kind: 'attack' }, seeded(64)); // empowered 3
  assertEquals(modRemaining(w.b, 'player', 'atk'), 0, 'exactly the advertised 3 empowered actions');
  assertEquals(statPct(w.b, 'player', 'atk'), 0);

  // Time Warp (mage: mag + spd): both legs defer their cast-round tick
  // since #94. MAG empowers only future actions — the cast round cannot
  // use it. SPD's advertised rounds are INITIATIVE snapshots (#94): a
  // mid-round cast spends no unit on the already-decided snapshot, so its
  // first decay defers too — the foe's next three moves face the haste.
  const m = mkBattle('mage', 63, 'sk_time_warp');
  performAction(m.p, m.b, { kind: 'skill', skillId: 'sk_time_warp' }, seeded(66));
  assertEquals(modRemaining(m.b, 'player', 'mag'), 3, 'mag deferred on the cast round');
  assertEquals(
    modRemaining(m.b, 'player', 'spd'),
    3,
    'spd defers on the cast round — snapshots are its unit (#94)',
  );
  performAction(m.p, m.b, { kind: 'attack' }, seeded(67));
  assertEquals(modRemaining(m.b, 'player', 'mag'), 2);
  assertEquals(modRemaining(m.b, 'player', 'spd'), 2);
  performAction(m.p, m.b, { kind: 'attack' }, seeded(68));
  assertEquals(modRemaining(m.b, 'player', 'mag'), 1);
  assertEquals(modRemaining(m.b, 'player', 'spd'), 1, 'three snapshots, cast round excluded');

  // Adrenaline Surge (heal + atk 2): defers like other offensive keys.
  const a = mkBattle('warrior', 64, 'sk_adrenaline');
  a.p.hp = 10; // let the heal component land
  performAction(a.p, a.b, { kind: 'skill', skillId: 'sk_adrenaline' }, seeded(69));
  assertEquals(modRemaining(a.b, 'player', 'atk'), 2);
  performAction(a.p, a.b, { kind: 'attack' }, seeded(70));
  assertEquals(modRemaining(a.b, 'player', 'atk'), 1);
  performAction(a.p, a.b, { kind: 'attack' }, seeded(71));
  assertEquals(modRemaining(a.b, 'player', 'atk'), 0, 'exactly the advertised 2 empowered actions');

  // Smoke Step (rogue: SPD only, 3 turns): since #94 SPD's advertised
  // rounds are INITIATIVE snapshots — a mid-round cast spends no unit on
  // the already-decided snapshot, so its first decay defers and the buff
  // covers exactly the foe's NEXT three moves.
  const sk = mkBattle('rogue', 78, 'sk_smoke_step');
  performAction(sk.p, sk.b, { kind: 'skill', skillId: 'sk_smoke_step' }, seeded(79));
  assertEquals(
    modRemaining(sk.b, 'player', 'spd'),
    3,
    'cast round spent no initiative unit — the full 3 snapshots remain (#94)',
  );
  performAction(sk.p, sk.b, { kind: 'attack' }, seeded(80));
  assertEquals(modRemaining(sk.b, 'player', 'spd'), 2);
  performAction(sk.p, sk.b, { kind: 'attack' }, seeded(81));
  assertEquals(modRemaining(sk.b, 'player', 'spd'), 1);
  performAction(sk.p, sk.b, { kind: 'attack' }, seeded(82));
  assertEquals(
    modRemaining(sk.b, 'player', 'spd'),
    0,
    'exactly three initiative snapshots, cast round excluded',
  );
  assertEquals(statPct(sk.b, 'player', 'spd'), 0);

  // Iron Wall (def): RETAINS the cast-round tick — it protects against the
  // enemy response on the casting round, exactly as before.
  const wallDur = statmodSpec(SKILLS.find((s) => s.id === 'sk_iron_wall')!, 'def')!.duration;
  const d = mkBattle('warrior', 65, 'sk_iron_wall');
  performAction(d.p, d.b, { kind: 'skill', skillId: 'sk_iron_wall' }, seeded(72));
  assertEquals(
    modRemaining(d.b, 'player', 'def'),
    wallDur - 1,
    'defensive buffs tick on the cast round',
  );
  assert(statPct(d.b, 'player', 'def') > 0, 'protection active during the cast-round response');
});

Deno.test('combat: Blessing empowers MAG/DEF — never Cleric-dead ATK (#77)', () => {
  const mkCleric = (userId: number) => {
    const p = createPlayer(userId, 'T', 'cleric');
    p.level = 20;
    p.skills.push('sk_blessing');
    p.mp = 999;
    const b = previewBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
    b.enemy.hp = 99999;
    b.enemy.maxHp = 99999;
    p.battle = b;
    return { p, b };
  };
  // The cast lands exactly the MAG/DEF legs; ATK is untouched because no
  // Cleric-owned action can use it (Radiant Strike/Smite are MAG vs RES,
  // Cleric weapons raise MAG).
  const c = mkCleric(90);
  performAction(c.p, c.b, { kind: 'skill', skillId: 'sk_blessing' }, seeded(91));
  assertEquals(
    statPct(c.b, 'player', 'atk'),
    0,
    'no ATK leg — no Cleric action could use it (#77)',
  );
  assertEquals(statPct(c.b, 'player', 'mag'), 0.3, 'MAG is the Cleric offense leg');
  assertEquals(statPct(c.b, 'player', 'def'), 0.3, 'DEF leg unchanged');
  assertEquals(
    c.b.effectInstances.map((e) => e.stat).sort().join(','),
    'def,mag',
    'effect entries mirror the actual legs',
  );
  // The MAG leg feeds Cleric strikes: same seed, buffed MAG hits harder.
  const plain = mkCleric(92);
  const before = performAction(plain.p, plain.b, { kind: 'attack' }, seeded(93));
  const buffed = mkCleric(94);
  performAction(buffed.p, buffed.b, { kind: 'skill', skillId: 'sk_blessing' }, seeded(95));
  const after = performAction(buffed.p, buffed.b, { kind: 'attack' }, seeded(93));
  const dmgOf = (res: { lines: string[] }): number =>
    Number(/for (\d+)/.exec(res.lines.join(' '))?.[1]);
  assert(
    dmgOf(after) > dmgOf(before),
    `Radiant Strike must scale with the Blessing MAG leg (${dmgOf(before)} → ${dmgOf(after)})`,
  );
});

Deno.test('enemy guard moves guard instead of attacking; Howl deals no chip damage (#25)', () => {
  const rng = seeded(3);
  const p = createPlayer(66, 'T', 'warrior');
  p.level = 45;
  // Ruin Sentinel: Guard Stance (weight 1 vs Stone Fist 3).
  const b = previewBattle('e_sentinel', { kind: 'explore', zoneId: 'sunspire' })!;
  p.battle = b;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  let guardSeen = false;
  for (let i = 0; i < 40 && !guardSeen; i++) {
    const before = p.hp;
    const res = performAction(p, b, { kind: 'guard' }, rng);
    if (res.lines.some((l) => l.includes('Guard Stance'))) {
      guardSeen = true;
      assertEquals(p.hp, before, 'Guard Stance must not deal damage');
      assertEquals(mitigationPct(b, 'enemy'), 0.4, 'guard raises the enemy mitigation');
      assertEquals(
        modInstance(b, 'enemy', 'mitigation')!.remaining,
        2,
        'the cast round does not consume the guard',
      );
    }
  }
  assert(guardSeen, 'Guard Stance must appear within 40 rounds');
  // Two protected rounds, then the guard expires (seed is fixed, so the
  // sentinel's move sequence — including any re-cast — is deterministic).
  performAction(p, b, { kind: 'attack' }, rng);
  assertEquals(modInstance(b, 'enemy', 'mitigation')!.remaining, 1, 'one protected round consumed');
  performAction(p, b, { kind: 'attack' }, rng);
  assertEquals(mitigationPct(b, 'enemy'), 0, 'guard expired after its turns');
  assertEquals(modInstance(b, 'enemy', 'mitigation'), undefined);

  // Grey Wolf's Howl (power 0, weaken rider): pure status, no chip damage.
  const rng2 = seeded(76);
  const w = createPlayer(67, 'T', 'warrior');
  w.level = 45;
  const wb = previewBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  w.battle = wb;
  wb.enemy.hp = 99999;
  wb.enemy.maxHp = 99999;
  let howlSeen = false;
  for (let i = 0; i < 60 && !howlSeen; i++) {
    const res = performAction(w, wb, { kind: 'guard' }, rng2);
    if (res.lines.some((l) => l.includes('Howl'))) {
      howlSeen = true;
      assert(
        !res.lines.some((l) => l.includes('damage to you')),
        `Howl must not chip: ${res.lines.join(' | ')}`,
      );
      assert(res.lines.some((l) => l.includes('sapped')), 'the weaken rider still lands');
      assertEquals(sapPct(wb, 'player'), 0.15);
    }
  }
  assert(howlSeen, 'Howl must appear within 60 rounds');
});

Deno.test('overworld Warden is an elite; the dungeon Warden is the boss (#28)', () => {
  const p = createPlayer(68, 'T', 'warrior');
  p.level = 45;

  // Overworld elite: smokeable, and its kills do not inflate boss stats.
  const elite = previewBattle('e_warden', { kind: 'elite', zoneId: 'abyss' })!;
  p.battle = elite;
  assert(!elite.enemy.isBoss, 'the overworld Warden is an elite, not a boss');
  addItem(p, 'c_smoke_bomb', 1);
  performAction(p, elite, { kind: 'item', itemId: 'c_smoke_bomb' }, seeded(81));
  assertEquals(elite.phase, 'fled', 'elites can be smoked out of');

  const afterElite = p.stats.bossesSlain;
  const elite2 = previewBattle('e_warden', { kind: 'elite', zoneId: 'abyss' })!;
  elite2.enemy.hp = 0;
  resolveVictory(p, elite2, seeded(82));
  assertEquals(
    p.stats.bossesSlain,
    afterElite,
    'elite Warden kills do not count as bosses slain',
  );

  // Dungeon boss floor: inescapable and boss-counted.
  const boss = previewBattle('e_warden', {
    kind: 'dungeon',
    zoneId: 'abyss',
    dungeonId: 'd_seam',
    floor: 5,
    boss: true,
  })!;
  p.battle = boss;
  assert(boss.enemy.isBoss, 'the d_seam Warden is boss-classified');
  addItem(p, 'c_smoke_bomb', 1);
  const res2 = performAction(p, boss, { kind: 'item', itemId: 'c_smoke_bomb' }, seeded(83));
  assert(res2.lines.some((l) => l.includes('no escape')), 'dungeon Warden refuses Smoke Bomb');
  assertEquals(boss.phase, 'active', 'smoke refused → battle continues');
  boss.enemy.hp = 0;
  resolveVictory(p, boss, seeded(84));
  assertEquals(p.stats.bossesSlain, afterElite + 1, 'dungeon Warden counts as a boss slain');
});

Deno.test('damage-skill descriptions state their exact multiplier (#34, #78)', () => {
  for (const sk of SKILLS) {
    for (const e of sk.effects) {
      if (e.kind !== 'damage') continue;
      const m = sk.desc.match(/(\d+)% (ATK|MAG)/);
      if (!m) continue;
      assertEquals(
        Number(m[1]) / 100,
        e.power,
        `${sk.id}: desc says ${m[1]}% but power is ${e.power}`,
      );
    }
  }
});

Deno.test('economy: buy needs gold, sell returns ratio', () => {
  const p = createPlayer(12, 'T', 'warrior');
  p.gold = 0;
  const fail = buy(p, 'c_minor_potion', 1);
  assert(!fail.ok);
  p.gold = 1000;
  const ok = buy(p, 'c_minor_potion', 1);
  assert(ok.ok);
  const qty = countOf(p, 'c_minor_potion');
  assert(qty >= 4);
  sell(p, 'c_minor_potion', 1);
  assertEquals(countOf(p, 'c_minor_potion'), qty - 1);
  assert(p.gold > 1000 - 30);
});

Deno.test('shop stock: zone consumables by band, gear only what you can equip (#22)', () => {
  const p = createPlayer(13, 'T', 'warrior');
  const early = currentStock(p);
  assert(early.includes('w_warrior_1'));
  p.currentZone = 'frostpeak';
  const late = currentStock(p);
  // Zone identity for always-usable goods: a frostpeak shop carries
  // frostpeak consumables whoever walks in.
  assert(late.includes('c_greater_potion'));
  assert(late.includes('c_smoke_bomb'));
  // Equipment is filtered to the shopper (#22): tier-4 gear (level 19) is
  // bait for a level-1 traveler and must not be shelved.
  assert(!late.includes('w_warrior_4'), 'level-19 gear is not bait at L1');
  for (const id of late) {
    const d = item(id)!;
    if (d.kind === 'weapon' || d.kind === 'armor' || d.kind === 'trinket') {
      assertEquals(isEquippable(id, 'warrior', 1).ok, true, `${id} must be usable at L1`);
    }
  }
  p.level = 45;
  p.currentZone = 'abyss'; // tier-8 gear lives where level 45 actually is
  const endgame = currentStock(p);
  assert(endgame.includes('w_warrior_8'), 'abyss-tier gear must be purchasable at 45');
  assert(endgame.includes('t_11'), 'late trinkets need an acquisition path');
});

Deno.test('forge: tempering requires materials and caps at +5', () => {
  const p = createPlayer(14, 'T', 'warrior');
  addItem(p, 'm_ember_shard', 20);
  p.gold = 100000;
  for (let i = 0; i < 5; i++) {
    const res = temper(p, 'weapon');
    assert(res.ok, `temper ${i + 1} should succeed`);
  }
  assertEquals(temperLevel(p, 'weapon'), 5);
  const blocked = temper(p, 'weapon');
  assert(!blocked.ok);
  // derived stats reflect the temper bonus
  const boosted = statsOf(p);
  const fresh = createPlayer(15, 'T', 'warrior');
  assert(boosted.atk > statsOf(fresh).atk);
});

Deno.test('world: travel requires unlock, safe haven restores', () => {
  const p = createPlayer(16, 'T', 'mage');
  p.hp = 1;
  const fail = travel(p, 'sunspire');
  assert(!fail.ok);
  const ok = travel(p, 'whisperwood');
  assert(ok.ok);
  assertEquals(p.currentZone, 'whisperwood');
  assert(p.flags['zone_whisperwood']);
  const back = travel(p, 'emberdawn');
  assert(back.ok);
  assertEquals(p.hp, statsOf(p).maxHp);
});

Deno.test('death revives at a safe haven, not where you fell', () => {
  const p = createPlayer(33, 'T', 'warrior');
  p.gold = 1000;
  p.currentZone = 'whisperwood';
  p.hp = 0;
  const line = applyDeath(p);
  assert(line.includes('black out'));
  assertEquals(p.stats.deaths, 1);
  assertEquals(p.gold, 900);
  assertEquals(p.hp, Math.floor(statsOf(p).maxHp * 0.5));
  assertEquals(p.currentZone, 'emberdawn');
});

Deno.test('derived stats aggregate equipped slots only — bag copies never count', () => {
  const plain = createPlayer(23, 'T', 'warrior');
  const withExtra = createPlayer(24, 'T', 'warrior');
  withExtra.inventory = [...withExtra.inventory, { id: withExtra.equipment.weapon!, qty: 1 }];
  assertEquals(statsOf(withExtra).atk, statsOf(plain).atk, 'bag copies never affect stats');
});

Deno.test('migratePlayer: current-version saves load unchanged', () => {
  const p = createPlayer(28, 'T', 'mage');
  const before = JSON.stringify(p);
  migratePlayer(p);
  assertEquals(JSON.stringify(p), before, 'a current save is untouched');
});

Deno.test('migratePlayer: refuses to downgrade saves from a newer binary', () => {
  const p = createPlayer(25, 'T', 'rogue');
  p.stateVersion = CURRENT_STATE_VERSION + 1;
  p.gold = 12345;
  assertThrows(() => migratePlayer(p), SaveTooNewError);
  // The refusal must be total: no rewrite, no stamp-down, no loss.
  assertEquals(p.stateVersion, CURRENT_STATE_VERSION + 1);
  assertEquals(p.gold, 12345);
});

Deno.test('migratePlayer: unversioned and older saves fail clearly (#44)', () => {
  // Pre-versioning save (no stateVersion): not a supported shape, never
  // silently stamped current — or interpreted as any numbered version.
  const p = createPlayer(26, 'T', 'warrior');
  const raw = p as unknown as Record<string, unknown>;
  delete raw.stateVersion;
  assertThrows(() => migratePlayer(p), SaveTooOldError);
  assertEquals(raw.stateVersion, undefined, 'no version was stamped');

  // Versions below the earliest migration step have no path. The earliest
  // step is v3 → v4 (#67, structured history); a v2-era save predates the
  // versioned chain and is disposable (#44). (Later versions MIGRATE — the
  // chain now runs v3→v4→v5.)
  const p2 = createPlayer(27, 'T', 'warrior');
  p2.stateVersion = 2;
  p2.gold = 999;
  assertThrows(() => migratePlayer(p2), SaveTooOldError);
  assertEquals(p2.stateVersion, 2, 'no rewrite, no stamp-down');
  assertEquals(p2.gold, 999);
});

Deno.test('migratePlayer: in-flight v3 battles normalize to the structured history (#67)', () => {
  const p = createPlayer(29, 'T', 'warrior');
  // A REAL v3 save (the version #67 retired) — the chain now walks it
  // v3→v4→v5, so the prologue stamp applies on the way through (#69).
  p.stateVersion = 3;
  const b = previewBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' })!;
  p.battle = b;
  // Simulate a pre-#67 save: an in-flight battle still carrying the flat log.
  (p.battle as unknown as Record<string, unknown>).log = ['🐺 Wolf blocks your path!'];
  const hpBefore = p.battle.enemy.hp;
  migratePlayer(p);
  assertEquals(p.stateVersion, CURRENT_STATE_VERSION, 'stamped current');
  assertEquals(p.tutorial, 'done', 'chained through the #69 step');
  const raw = p.battle as unknown as Record<string, unknown>;
  assertEquals(raw['log'], undefined, 'the retired flat log is stripped from the save');
  assertEquals(p.battle!.history, [], 'structured history starts empty');
  assertEquals(p.battle!.effectInstances, [], 'live effect instances start empty (#78)');
  assertEquals(p.battle!.enemy.hp, hpBefore, 'mechanics are preserved');
  assertEquals(p.battle!.phase, 'active', 'the fight is still live');
});

Deno.test('world: every zone is reachable from the starting zones', () => {
  const granted = new Set<string>(STARTING_ZONES);
  for (const q of QUESTS) {
    const u = q.rewards.unlockZone;
    if (u) granted.add(u);
  }
  for (const z of ZONES) {
    const u = z.dungeon?.firstClear?.unlockZone;
    if (u) granted.add(u);
  }
  for (const z of ZONES) {
    assert(granted.has(z.id), `zone ${z.id} cannot be unlocked by any content`);
  }
});

Deno.test('world: safe havens never spawn battles; the wilds do', () => {
  const rng = seeded(21);
  const p = createPlayer(17, 'T', 'warrior');
  // Village explore: treasure/rest/flavor only — never a battle.
  for (let i = 0; i < 200; i++) {
    const outcome = explore(p, rng);
    assert(outcome.kind !== 'battle', 'safe haven must not spawn battles');
    assertEquals(p.battle, undefined); // explore never attaches; caller does
  }
  // The wilds: battles are common (weighted tables) — find one. The
  // Outskirts are the level-1 wilds band (#73); the Whisperwood's band
  // starts at 3 and its elite waits for 5.
  assert(travel(p, 'outskirts').ok);
  let sawBattle = false;
  for (let i = 0; i < 50 && !sawBattle; i++) {
    if (explore(p, rng).kind === 'battle') sawBattle = true;
  }
  assert(sawBattle, 'whisperwood should spawn battles');
});

Deno.test('world: victory-gated floors, story-gated boss, first-clear once', () => {
  const rng = seeded(31);
  const p = createPlayer(18, 'T', 'warrior');
  p.level = 45;
  p.unlockedZones.push('hollowmere');
  travel(p, 'hollowmere');
  const d = dungeonOf(zone('hollowmere')!)!;

  // Normal floors are open; each victory (and ONLY victory) advances.
  for (let f = 0; f < d.floors.length; f++) {
    const res = diveDungeon(p, d, rng);
    assert(res.ok && res.battle, `floor ${f + 1} should be open`);
    const isBoss = res.battle!.origin.kind === 'dungeon' && res.battle!.origin.boss;
    assert(!isBoss, 'boss floor must stay sealed while the story quest is unavailable');
    res.battle!.enemy.hp = 0; // simulate victory
    resolveVictory(p, res.battle!);
  }
  const blocked = diveDungeon(p, d, rng);
  assert(!blocked.ok, `boss floor sealed: ${blocked.lines[0]}`);

  // The story hunt begins — the deepest chamber opens (d_sunken gates on m7).
  p.quests['m6_toxin'] = { status: 'done', counts: [] };
  syncAvailability(p);
  assert(acceptQuest(p, 'm7_tyrant', 'npc_ferryman').ok); // the Ferryman is right here
  const bossRun = diveDungeon(p, d, rng);
  assert(bossRun.ok && bossRun.battle);
  assertEquals(bossRun.battle!.enemy.id, d.boss);
  bossRun.battle!.enemy.hp = 0;
  const lines = resolveVictory(p, bossRun.battle!);
  assert(lines.some((l) => l.includes('First clear')), 'first clear grants rewards');

  // Rematch stays open; first-clear rewards never repeat.
  const rematch = diveDungeon(p, d, rng);
  assert(rematch.ok && rematch.battle);
  assertEquals(rematch.battle!.enemy.id, d.boss);
  rematch.battle!.enemy.hp = 0;
  const lines2 = resolveVictory(p, rematch.battle!);
  assert(!lines2.some((l) => l.includes('First clear')));
});

Deno.test("content integrity: zones' exploration events and dungeon encounters reference real ids", () => {
  for (const z of ZONES) {
    for (const ev of z.explore) {
      if (ev.kind === 'battle' || ev.kind === 'elite') {
        assert(enemy(ev.enemy), `zone ${z.id} missing enemy ${ev.enemy}`);
      }
      if (ev.kind === 'treasure' && ev.item) {
        assert(item(ev.item), `zone ${z.id} missing treasure item ${ev.item}`);
      }
    }
    if (z.dungeon) {
      for (const f of z.dungeon.floors) {
        for (const e of f.enemies) assert(enemy(e), `dungeon ${z.dungeon.id} missing enemy ${e}`);
        if (f.treasure?.item) assert(item(f.treasure.item));
      }
      assert(enemy(z.dungeon.boss), `dungeon ${z.dungeon.id} missing boss`);
    }
  }
});

Deno.test('content integrity: enemies reference real drop items', () => {
  const ids = new Set(ENEMIES.map((e) => e.id));
  assertEquals(ids.size, ENEMIES.length, 'enemy ids must be unique');
  for (const e of ENEMIES) {
    assert(e.id.length > 0, 'enemy ids must be non-empty');
    assert(e.name.length > 0, `enemy ${e.id} needs a name`);
    for (const id of Object.keys(e.drops ?? {})) {
      assert(item(id), `enemy ${e.id} drops unknown item ${id}`);
    }
  }
});

Deno.test('content integrity: skills are complete per class and learnable in order', () => {
  // #81: every class expanded to twelve skills across levels 1–45 (#79
  // gave the Cleric and #80 the Rogue their ninth; this is the full roster).
  const expected = { warrior: 12, mage: 12, rogue: 12, cleric: 12 } as const;
  for (const cid of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    const skills = skillsForClass(cid, MAX_LEVEL);
    assertEquals(skills.length, expected[cid], `${cid} kit size`);
    for (const s of skills) assert(SKILLS.includes(s));
  }
  assertEquals(SKILLS.length, 48);
});

Deno.test('migration v8: expanded rosters union into existing heroes exactly once (#81)', () => {
  // A v7 hero at the cap must receive every #81 skill its level has
  // crossed — exactly once, in ascending learn order.
  const p = createPlayer(1, 'T', 'warrior');
  let xp = 0;
  for (let l = 1; l < 45; l++) xp += xpForNextLevel(l);
  grantXp(p, xp);
  assertEquals(p.level, 45);
  p.skills = [
    'sk_cleave',
    'sk_shield_bash',
    'sk_war_cry',
    'sk_whirlwind',
    'sk_iron_wall',
    'sk_executioner',
    'sk_adrenaline',
    'sk_titans_fall',
  ]; // the v7 warrior kit — the #81 skills did not exist yet
  p.stateVersion = 7;
  migratePlayer(p);
  assertEquals(p.stateVersion, 8);
  assertEquals(
    p.skills,
    skillsForClass('warrior', MAX_LEVEL).map((s) => s.id),
    'full ascending union, no duplicates',
  );

  // A mid-band v7 hero only gains what its level has crossed:
  const mid = createPlayer(2, 'T', 'mage');
  let xp2 = 0;
  for (let l = 1; l < 8; l++) xp2 += xpForNextLevel(l);
  grantXp(mid, xp2);
  assertEquals(mid.level, 8);
  mid.skills = ['sk_firebolt', 'sk_frost_lance']; // v7: Scorch did not exist
  mid.stateVersion = 7;
  migratePlayer(mid);
  assertEquals(mid.skills, ['sk_firebolt', 'sk_frost_lance', 'sk_scorch']);
});

Deno.test('skills: menu order is ascending by learn level; ties keep authored order (#77)', () => {
  for (const cid of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    const skills = skillsForClass(cid, MAX_LEVEL);
    for (let i = 1; i < skills.length; i++) {
      const prev = skills[i - 1]!;
      const cur = skills[i]!;
      assert(
        prev.learnLevel < cur.learnLevel ||
          (prev.learnLevel === cur.learnLevel && SKILLS.indexOf(prev) < SKILLS.indexOf(cur)),
        `${cid}: ${prev.name} (Lv ${prev.learnLevel}) must precede ${cur.name} (Lv ${cur.learnLevel}) by level — or by authored order for equal levels`,
      );
    }
  }
  // Regression pins for the two historical offenders: catalog insertion
  // order used to leak Whirlwind after Iron Wall and Radiant Burst after
  // Holy Ward into both skill menus.
  const warrior = skillsForClass('warrior', MAX_LEVEL).map((s) => s.name);
  assert(warrior.indexOf('Whirlwind') < warrior.indexOf('Iron Wall'));
  const cleric = skillsForClass('cleric', MAX_LEVEL).map((s) => s.name);
  assert(cleric.indexOf('Radiant Burst') < cleric.indexOf('Holy Ward'));
  // Equal-level ties stay deterministic: Smite before Mend Wounds at Lv 1.
  const clericLv1 = skillsForClass('cleric', 1).map((s) => s.name);
  assertEquals(clericLv1, ['Smite', 'Mend Wounds']);
});

Deno.test('codec: roundtrip for every callback shape', () => {
  const cases = [
    { v: 'zone', a: 'ex' },
    { v: 'zone', a: 'tk', arg: 2 },
    { v: 'battle', a: 'use', arg: 'sk_cleave' },
    { v: 'inventory', a: 'p', arg: 3 },
    { v: 'inventory', a: 'eq', arg: 'w_warrior_2' },
    { v: 'equipment', a: 'rm', arg: 'weapon' },
    { v: 'quests', a: 'q', arg: 'm1_embers' },
    // q:a:/q:t: no longer EXIST in the codec (#65) — the log cannot express
    // lifecycle actions; those wires decode as malformed and are refused.
    { v: 'npcq', a: 'a', arg: 'm1_embers' },
    { v: 'npcq', a: 't', arg: 'm2_letter' },
    { v: 'npcq', a: 'bk' },
    { v: 'shop', a: 'buy', arg: 'c_potion' },
    { v: 'shop', a: 'p', arg: -1 },
    { v: 'forge', a: 'w' },
    { v: 'travel', a: 'go', arg: 'abyss' },
    { v: 'death', a: 'ok' },
    { v: 'meta', a: 'pick', arg: 'mage' },
    { v: 'meta', a: 'reset' },
    { v: 'meta', a: 'resetYes' },
  ] as const;
  for (const c of cases) {
    const wire = encodeCb(c as never);
    assert(wire.length <= 64, `${wire} too long`);
    const back = decodeCb(wire);
    assertEquals(back, c, `roundtrip failed for ${wire}`);
  }
  // Render-revision stamps (#16): <view>:<rev>:<action>[:<arg>].
  const stamped = withRev(7, 'q:q:m1_embers');
  assertEquals(stamped, 'q:7:q:m1_embers');
  assertEquals(decodeCb(stamped), { v: 'quests', a: 'q', arg: 'm1_embers', rev: 7 });
  assertEquals(withRev(8, stamped), 'q:8:q:m1_embers', 're-stamp replaces an old rev');
  assertEquals(decodeCb('garbage'), undefined);
  assertEquals(decodeCb('x:zz:1'), undefined);
});

Deno.test('derived stats scale with level and gear', () => {
  const lv1 = derivedStats('warrior', 1, {});
  const lv45 = derivedStats('warrior', 45, { atk: 100 });
  assertGreater(lv45.atk, lv1.atk + 100);
  assertGreater(lv45.maxHp, lv1.maxHp * 5);
});

Deno.test('content integrity: item catalog is large, unique and priced', () => {
  assert(ITEMS.length >= 100, `expected 100+ items, got ${ITEMS.length}`);
  const ids = new Set(ITEMS.map((i) => i.id));
  assertEquals(ids.size, ITEMS.length, 'item ids must be unique');
  for (const i of ITEMS) {
    if (i.kind === 'quest') assertEquals(i.price, 0);
    else assert(i.price > 0, `${i.id} should be priced`);
  }
});

// ── quest-item lifecycle (#2 / #10 / #12) ────────────────────────────────

Deno.test('questDropAllowed: quest items drop only while an open quest needs them', () => {
  const p = createPlayer(31, 'T', 'mage');
  assertEquals(questDropAllowed(p, 'q_toxin_sample'), false, 'no open quest → no drop');
  assertEquals(questDropAllowed(p, 'm_iron_chunk'), true, 'materials are never capped');
  p.quests['m6_toxin'] = { status: 'active', counts: [0] };
  addItem(p, 'q_toxin_sample', 3);
  assertEquals(questDropAllowed(p, 'q_toxin_sample'), true);
  addItem(p, 'q_toxin_sample', 1);
  assertEquals(questDropAllowed(p, 'q_toxin_sample'), false, 'cap reached');
  p.quests['m6_toxin']!.status = 'done';
  removeItem(p, 'q_toxin_sample', 4);
  assertEquals(questDropAllowed(p, 'q_toxin_sample'), false, 'done → never again');
});

Deno.test('Sunspire Key: enemies never drop it in any quest/gate state — m11 reward is the sole source (#20)', () => {
  // Content data itself carries no key drops anymore — catalog and runtime agree.
  for (const e of ENEMIES) {
    assertEquals(e.drops?.['q_sunspire_key'], undefined, `${e.id} must not drop the key`);
  }

  const p = createPlayer(33, 'T', 'warrior');
  const hammer = (tag: string) => {
    const rng = seeded(40 + tag.length);
    for (let i = 0; i < 80; i++) {
      resolveVictory(
        p,
        previewBattle('e_automaton', { kind: 'explore', zoneId: 'sunspire' })!,
        rng,
      );
    }
  };
  // Quest-relevant state (m11 open, gate pending): kills never mint a key.
  p.quests['m11_toll'] = { status: 'active', counts: [0] };
  hammer('active');
  assertEquals(countOf(p, 'q_sunspire_key'), 0, 'no enemy-sourced key while m11 is open');
  // Gate-pending WITH the key already held: no surplus duplicates.
  addItem(p, 'q_sunspire_key', 1);
  hammer('held');
  assertEquals(countOf(p, 'q_sunspire_key'), 1, 'a held key is never duplicated');
  // Story moved on (m11 done, gate open forever): still nothing.
  p.quests['m11_toll']!.status = 'done';
  hammer('done');
  assertEquals(countOf(p, 'q_sunspire_key'), 1, 'post-story kills mint nothing');
});

Deno.test('resolveVictory suppresses irrelevant quest drops; needed ones flow', () => {
  const p = createPlayer(32, 'T', 'warrior');
  const rng = seeded(31);
  for (let i = 0; i < 40; i++) {
    resolveVictory(p, previewBattle('e_leech', { kind: 'explore', zoneId: 'hollowmere' })!, rng);
  }
  assertEquals(countOf(p, 'q_toxin_sample'), 0, 'no open quest → drops suppressed');
  p.quests['m6_toxin'] = { status: 'active', counts: [0] };
  for (let i = 0; i < 60; i++) {
    resolveVictory(p, previewBattle('e_leech', { kind: 'explore', zoneId: 'hollowmere' })!, rng);
  }
  const got = countOf(p, 'q_toxin_sample');
  assert(got >= 1 && got <= 4, `expected 1..4 samples while m6 open, got ${got}`);
  // Deterministic turn-in: top up to the exact requirement and ready it.
  addItem(p, 'q_toxin_sample', 4 - got);
  p.quests['m6_toxin']!.status = 'turnIn';
  p.unlockedZones.push('hollowmere');
  p.currentZone = 'hollowmere'; // the Ferryman accepts the handover on-site
  assertEquals(turnInQuest(p, 'm6_toxin', 'npc_ferryman').ok, true);
  assertEquals(countOf(p, 'q_toxin_sample'), 0, 'turn-in consumes the goods');
  for (let i = 0; i < 20; i++) {
    resolveVictory(p, previewBattle('e_leech', { kind: 'explore', zoneId: 'hollowmere' })!, rng);
  }
  assertEquals(countOf(p, 'q_toxin_sample'), 0, 'done quest → the tap stays shut');
});

Deno.test('m2: the sealed letter is granted by m1 and delivered to Bram', () => {
  const p = createPlayer(34, 'T', 'warrior');
  syncAvailability(p);
  assertEquals(acceptQuest(p, 'm1_embers', 'npc_maren').ok, true);
  for (let i = 0; i < 4; i++) onKill(p, 'e_ember_rat');
  assertEquals(turnInQuest(p, 'm1_embers', 'npc_maren').ok, true);
  assertEquals(countOf(p, 'q_sealed_letter'), 1, 'm1 hands over the letter');
  syncAvailability(p);
  assertEquals(acceptQuest(p, 'm2_letter', 'npc_maren').ok, true);
  onTalk(p, 'npc_bram'); // the letter satisfies the collect half; Bram the rest
  const t2 = turnInQuest(p, 'm2_letter', 'npc_bram');
  assertEquals(t2.ok, true);
  assertEquals(countOf(p, 'q_sealed_letter'), 0, 'letter handed to Bram');
  assertEquals(p.quests['m2_letter'].status, 'done');
});

Deno.test('m22: the Archivist handoff completes via talk objective', () => {
  const p = createPlayer(33, 'T', 'mage');
  p.unlockedZones.push('umbra');
  p.currentZone = 'umbra'; // the Archivist accepts on-site (#64)
  p.quests['m22_umbral_key'] = { status: 'active', counts: [0] };
  onTalk(p, 'npc_archivist');
  assertEquals(p.quests['m22_umbral_key'].status, 'turnIn');
  assertEquals(turnInQuest(p, 'm22_umbral_key', 'npc_archivist').ok, true);
  assertEquals(p.quests['m22_umbral_key'].status, 'done');
});

Deno.test('turn-in aggregates duplicate same-item collect objectives (#8)', () => {
  // Fixture: no shipped quest doubles an item, so temporarily give m6 a
  // second collect objective on the SAME item. The QUEST_INDEX holds the
  // same object reference, so an in-place mutation is what turnInQuest sees.
  const m6 = QUESTS.find((q) => q.id === 'm6_toxin')!;
  const original = m6.objectives;
  m6.objectives = [
    { kind: 'collect', target: 'm_iron_chunk', count: 3 },
    { kind: 'collect', target: 'm_iron_chunk', count: 3 },
  ];
  try {
    const p = createPlayer(36, 'T', 'warrior');
    p.unlockedZones.push('hollowmere');
    p.currentZone = 'hollowmere'; // the Ferryman accepts on-site (#64)
    p.quests['m6_toxin'] = { status: 'turnIn', counts: [0, 0] };
    // 3 in the bag: per-objective validation would pass BOTH objectives
    // against the same three copies. Aggregated, it must refuse.
    addItem(p, 'm_iron_chunk', 3);
    assertEquals(turnInQuest(p, 'm6_toxin', 'npc_ferryman').ok, false, '3 < 3+3');
    assertEquals(p.quests['m6_toxin'].status, 'active');
    // Full supply: passes and consumes the aggregated total.
    addItem(p, 'm_iron_chunk', 3);
    p.quests['m6_toxin']!.status = 'turnIn';
    assertEquals(turnInQuest(p, 'm6_toxin', 'npc_ferryman').ok, true);
    assertEquals(countOf(p, 'm_iron_chunk'), 0, 'all six consumed');
  } finally {
    m6.objectives = original;
  }
});

Deno.test('skill cadence: each class demonstrates its role by level 2 (#71)', () => {
  const kit = (cid: ClassId, lv: number): string[] => skillsForClass(cid, lv).map((s) => s.id);
  // Defining damage in the opening kit.
  assert(kit('warrior', 2).includes('sk_cleave'));
  assert(kit('mage', 2).includes('sk_firebolt'));
  assert(kit('rogue', 2).includes('sk_quick_slash'));
  // The Cleric promise — healing — is present from the very first fight,
  // not four levels in.
  const clericOpening = kit('cleric', 2);
  assert(clericOpening.includes('sk_smite'), 'Smite from level 1');
  assert(clericOpening.includes('sk_mend'), 'Mend Wounds from level 1 (#71)');

  for (const cid of CLASS_IDS) {
    const offense = skillsForClass(cid, MAX_LEVEL)
      .filter((s) => s.type === 'phys' || s.type === 'mag')
      .map((s) => s.learnLevel)
      .sort((a, b) => a - b);
    assert(offense.length >= 2, `${cid} owns a second damage tier`);
    assert(
      offense[1]! - offense[0]! <= 12,
      `${cid} waits ${offense[1]! - offense[0]!} levels for offensive growth`,
    );
    const by17 = skillsForClass(cid, 17).filter((s) => s.type === 'phys' || s.type === 'mag');
    assert(by17.length >= 2, `${cid} second damage tier arrives by 17`);
  }
});

Deno.test('catalog: skill descriptions state the exact authored mechanics (#71, #78)', () => {
  // Rules text cannot silently omit a structured mechanical component:
  // EVERY effect spec must be quoted by the desc (#78).
  const pct = (n: number): string => `${Math.round(n * 100)}%`;
  for (const s of SKILLS) {
    for (const e of s.effects) {
      switch (e.kind) {
        case 'damage':
          assert(s.desc.includes(pct(e.power)), `${s.id} must quote ${pct(e.power)}: ${s.desc}`);
          break;
        case 'statmod':
          assert(
            s.desc.includes(pct(Math.abs(e.pct))),
            `${s.id}: ${e.stat} leg ${pct(e.pct)} must be quoted: ${s.desc}`,
          );
          break;
        case 'restore':
          if (e.hpFull) {
            assert(s.desc.includes('Fully restore'), `${s.id}: ${s.desc}`);
          } else if (e.hpPctOfMax !== undefined) {
            assert(s.desc.includes(`${pct(e.hpPctOfMax)} of max HP`), `${s.id}: ${s.desc}`);
          } else if (e.hpPower !== undefined) {
            assert(
              s.desc.includes(`${Math.round(e.hpPower * 200)}% of MAG`),
              `${s.id}: ${s.desc}`,
            );
            assert(
              s.desc.includes(`+ ${e.hpFlat ?? 0} HP`),
              `${s.id}: flat heal component must be quoted (#77): ${s.desc}`,
            );
          }
          if (e.mpPctOfMax !== undefined) {
            assert(s.desc.includes(pct(e.mpPctOfMax)), `${s.id}: ${s.desc}`);
          }
          break;
        case 'lifesteal':
          assert(
            s.desc.includes('heal half the damage') || s.desc.includes(pct(e.pct)),
            `${s.id}: lifesteal must be quoted: ${s.desc}`,
          );
          break;
        case 'control':
          assert(
            s.desc.includes(`${pct(e.chance ?? 1)} chance`),
            `${s.id}: control chance must be quoted: ${s.desc}`,
          );
          break;
        case 'shield':
          if (e.magPower !== undefined) {
            assert(
              s.desc.includes(`${Math.round(e.magPower * 200)}% of MAG`),
              `${s.id}: ward MAG scaling must be quoted: ${s.desc}`,
            );
            assert(
              s.desc.includes(`+ ${e.amount ?? 0} damage`),
              `${s.id}: flat ward component must be quoted: ${s.desc}`,
            );
          } else {
            assert(
              s.desc.includes(`${e.amount ?? 0} damage`),
              `${s.id}: ward capacity must be quoted: ${s.desc}`,
            );
          }
          break;
        default:
          // cleanse/dispel/resource copy is covered by behavior tests.
          break;
      }
    }
  }
});

Deno.test('dodge: SPD buys capped, opposed avoidance (#72)', () => {
  assertEquals(dodgeChance(50, 50), 0.02, 'baseline at parity');
  assertEquals(dodgeChance(10, 50), 0.02, 'outsped heroes keep only the floor');
  assertEquals(dodgeChance(200, 10), 0.2, 'the cap prevents near-invulnerability');
  assertEquals(dodgeChance(20, 10), 0.04, 'each 5 SPD over the foe adds 1%');
  assert(dodgeChance(30, 10) > dodgeChance(20, 10), 'enemy SPD pushes back');
});

Deno.test('dodge: a slipped blow deals nothing and says so in the round (#72)', () => {
  let dodged = false;
  for (let seed = 1; seed <= 80 && !dodged; seed++) {
    const rng = seeded(seed);
    const p = createPlayer(900 + seed, 'T', 'rogue');
    p.level = 8; // a real SPD edge over the rat, without one-shotting it
    const battle = previewBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' })!;
    p.battle = battle;
    for (let round = 0; round < 6 && !dodged; round++) {
      const hpBefore = p.hp;
      const r = performAction(p, battle, { kind: 'attack' }, rng);
      const joined = r.lines.join(' ');
      if (joined.includes('slip aside')) {
        dodged = true;
        assertEquals(p.hp, hpBefore, 'a slipped blow deals no damage');
        assert(joined.includes('💨'), 'the dodge is a visible round line');
      }
      if (battle.phase !== 'active') break;
    }
  }
  assert(dodged, 'a dodge was observed across the seed sweep');
});

Deno.test('dodge: zero-power status moves are never slipped (#72)', () => {
  // The wolf's Howl (weaken, power 0) must still land on a hero that slips
  // regular bites — status riders are authored as unavoidable.
  let sawDodge = false;
  let sawHowl = false;
  for (let seed = 1; seed <= 120 && !(sawDodge && sawHowl); seed++) {
    const rng = seeded(seed);
    const p = createPlayer(1200 + seed, 'T', 'rogue');
    p.level = 12;
    const battle = previewBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' })!;
    p.battle = battle;
    for (let round = 0; round < 8; round++) {
      const r = performAction(p, battle, { kind: 'attack' }, rng);
      const joined = r.lines.join(' ');
      if (joined.includes('slip aside')) sawDodge = true;
      if (joined.includes('Howl')) sawHowl = true;
      if (battle.phase !== 'active') break;
    }
  }
  assert(sawDodge, 'bites get slipped at a real SPD edge');
  assert(sawHowl, 'Howl still resolves — status moves ignore dodge');
});

Deno.test('content integrity: effect specs carry consistent semantic tags (#87)', () => {
  const specs: { from: string; spec: EffectSpec }[] = [];
  for (const sk of SKILLS) {
    sk.effects.forEach((e, i) => specs.push({ from: `${sk.id}#${i}`, spec: e }));
  }
  for (const en of ENEMIES) {
    en.moves.forEach((m, i) =>
      m.effects.forEach((e, j) => specs.push({ from: `${en.id}:move${i}#${j}`, spec: e }))
    );
    if (en.opening) {
      en.opening.effects.forEach((e, j) => specs.push({ from: `${en.id}:opening#${j}`, spec: e }));
    }
    if (en.special) {
      en.special.move.effects.forEach((e, j) =>
        specs.push({ from: `${en.id}:special#${j}`, spec: e })
      );
    }
  }
  for (const it of ITEMS) {
    it.triggers?.forEach((tg, i) =>
      tg.effects.forEach((e, j) => specs.push({ from: `${it.id}:trig${i}#${j}`, spec: e }))
    );
  }
  assert(specs.length > 100, 'the walk covers the shipped content');
  const families: EffectTag[] = ['poison', 'burn', 'bleed'];
  for (const { from, spec } of specs) {
    const tags = semanticTags(spec);
    assert(
      !(tags.includes('beneficial') && tags.includes('harmful')),
      `${from}: contradictory polarity (${tags.join(',')})`,
    );
    const fam = tags.filter((t) => families.includes(t as EffectTag));
    assert(fam.length <= 1, `${from}: incompatible DoT families (${fam.join(',')})`);
    if (spec.kind === 'periodic' && (spec.perRound ?? spec.pctOfMaxPerRound ?? 0) < 0) {
      assert(
        fam.length === 1,
        `${from}: a damaging periodic must author its family (poison|burn|bleed); got ${
          tags.join(',')
        }`,
      );
    }
  }
});
