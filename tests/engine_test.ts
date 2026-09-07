/**
 * Engine unit tests — deterministic via seeded RNG.
 * Covers: creation, progression, combat, quests, economy, forge, world.
 */

import { assert, assertEquals, assertGreater, assertThrows } from '@std/assert';
import {
  applyDeath,
  assertSupportedSaveVersion,
  createPlayer,
  CURRENT_STATE_VERSION,
  grantXp,
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
  rollRewards,
  startBattle,
} from '../src/engine/combat.ts';
import { type BattleState, CLASS_IDS, type ClassId } from '../src/engine/types.ts';
import {
  acceptQuest,
  onKill,
  onStoryEvent,
  questDropAllowed,
  syncAvailability,
  turnInQuest,
} from '../src/engine/quests.ts';
import { addItem, countOf, removeItem } from '../src/engine/inventory.ts';
import { buy, resolveStock, sell } from '../src/engine/shops.ts';
import { temper, temperLevel } from '../src/engine/forge.ts';
import {
  abandonDungeon,
  diveDungeon,
  dungeonOf,
  explore,
  nextDungeonFloor,
  resolveVictory,
} from '../src/engine/world.ts';
import { startJourney } from '../src/engine/journey.ts';
import { STARTING_ZONES, zone, ZONES } from '../src/content/zones.ts';
import { ENEMIES, enemy } from '../src/content/enemies.ts';
import { isEquippable, item, ITEMS } from '../src/content/items.ts';
import { SKILLS, skillsForClass } from '../src/content/skills.ts';
import {
  consumableEffectLines,
  FOE_VOICE,
  mechanicsLines,
  mechanicsText,
} from '../src/engine/mechanics.ts';
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
  travelDirect,
} from './helpers.ts';
import { semanticTags } from '../src/engine/effects.ts';
import type { EffectSpec, EffectTag } from '../src/content/types.ts';

Deno.test('character creation gives class kit and full pools', () => {
  const player = createPlayer(1, 'Test', 'warrior');
  assertEquals(player.level, 1);
  assertEquals(player.classId, 'warrior');
  assertEquals(player.hp, statsOf(player).maxHp);
  assertEquals(player.mp, statsOf(player).maxMp);
  assertEquals(player.equipment.weapon, 'w_warrior_1');
  assertEquals(player.equipment.armor, 'a_warrior_1');
  // Gear lives ONLY in equipment slots — no duplicate bag copy (P1-11).
  assertEquals(countOf(player, 'w_warrior_1'), 0);
  assert(player.gold > 0);
  assertEquals(player.skills, skillsForClass('warrior', 1).map((skillDef) => skillDef.id));
});

Deno.test('all four classes start with legal kits', () => {
  for (const cid of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    const player = createPlayer(2, 'T', cid);
    assert(player.equipment.weapon && item(player.equipment.weapon));
    assert(player.equipment.armor && item(player.equipment.armor));
    assertEquals(player.skills, skillsForClass(cid, 1).map((skillDef) => skillDef.id));
    assert(player.skills.length > 0, `${cid} should start with a level-1 skill`);
    assertEquals(statsOf(player).maxHp > 0, true);
    // Every class starts at its ACTUAL full pools (Cleric once under-counted).
    assertEquals(player.hp, statsOf(player).maxHp);
    assertEquals(player.mp, statsOf(player).maxMp);
  }
});

Deno.test('xp curve is increasing and max level reachable', () => {
  let prev = 0;
  for (let level = 1; level < MAX_LEVEL; level++) {
    const need = xpForNextLevel(level);
    assert(need > prev);
    prev = need;
  }
  assertEquals(xpForNextLevel(MAX_LEVEL), Number.POSITIVE_INFINITY);
});

Deno.test('grantXp levels up, restores pools and learns skills', () => {
  const player = createPlayer(3, 'T', 'mage');
  player.hp = 1;
  const lines = grantXp(player, xpForNextLevel(1) + 10);
  assertEquals(player.level, 2);
  assertEquals(player.hp, statsOf(player).maxHp);
  assert(lines.some((line) => line.includes('Level up')));
  // mage learns frost lance at 5; at 2 no new skills but no crash
});

Deno.test('combat: deterministic battle to victory with rewards', () => {
  const rng = seeded(42);
  const player = createPlayer(4, 'T', 'warrior');
  const battle = startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, {
    player,
    rng,
  })!.battle;
  const attack: PlayerAction = { kind: 'attack' };
  let rounds = 0;
  while (battle.enemy.hp > 0 && rounds < 100) {
    performAction(player, battle, attack, rng);
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
  const player = createPlayer(5, 'T', 'warrior');
  const battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' }, {
    player,
    rng,
  })!.battle;
  const hpBefore = player.hp;
  const enemyHpBefore = battle.enemy.hp;
  performAction(player, battle, { kind: 'attack' }, rng);
  assert(battle.enemy.hp < enemyHpBefore, 'player attack should damage enemy');
  if (player.hp < hpBefore) assert(player.hp >= 0);
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
    const player = createPlayer(700, 'T', cid);
    const battle = startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, {
      player,
      rng: seeded(21),
    })!.battle;
    const result = performAction(player, battle, { kind: 'attack' }, seeded(21));
    assert(
      result.lines.some((line) => line.includes(name) && line.includes(` ${verb} `)),
      `${cid} free action should read "<name> … ${verb} …", got: ${result.lines.join(' | ')}`,
    );
  }
});

Deno.test('combat: MAG/ATK buffs and Sapped modify the correct free action (#70)', () => {
  const dmg = (cid: ClassId, pct: { atk?: number; mag?: number; weaken?: number }): number => {
    const player = createPlayer(701, 'T', cid);
    const battle = startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, {
      player,
      rng: seeded(22),
    })!.battle;
    // Live instances fold into the free action (#78): ATK/MAG buffs raise
    // their own stat; Sapped cuts the outgoing damage of both legs.
    if (pct.atk) injectMod(battle, 'player', 'atk', pct.atk);
    if (pct.mag) injectMod(battle, 'player', 'mag', pct.mag);
    if (pct.weaken) injectMod(battle, 'player', 'outgoing', -pct.weaken);
    const before = battle.enemy.hp;
    performAction(player, battle, { kind: 'attack' }, seeded(33));
    return before - battle.enemy.hp;
  };
  const mageBaseDamage = dmg('mage', {});
  assert(dmg('mage', { mag: 0.5 }) > mageBaseDamage, '+MAG must raise the mage free action');
  assertEquals(
    dmg('mage', { atk: 0.5 }),
    mageBaseDamage,
    '+ATK must not touch the mage free action',
  );
  assert(dmg('mage', { weaken: 0.5 }) < mageBaseDamage, 'Sapped must lower the mage free action');
  const warriorBaseDamage = dmg('warrior', {});
  assert(
    dmg('warrior', { atk: 0.5 }) > warriorBaseDamage,
    '+ATK must raise the warrior free action',
  );
  assertEquals(
    dmg('warrior', { mag: 0.5 }),
    warriorBaseDamage,
    '+MAG must not touch the warrior free action',
  );
  assert(
    dmg('warrior', { weaken: 0.5 }) < warriorBaseDamage,
    'Sapped must lower the warrior free action',
  );
});

Deno.test('combat: free action mitigates with DEF (phys) / RES (mag) (#70)', () => {
  // King Aldric's DEF (104) and RES (80) diverge enough that the expected
  // damage identifies which mitigation stat the action targeted.
  const expected = (
    offense: number,
    mitigation: number,
    draws: { crit: boolean; v: number },
  ): number =>
    Math.max(
      1,
      Math.round(
        Math.max(1, offense - mitigation * 0.85) * (draws.crit ? 1.6 : 1) * (0.9 + draws.v * 0.2),
      ),
    );
  const aldric = enemy('e_aldric')!;
  const origin = { kind: 'explore', zoneId: 'crownspire' } as const;

  const mage = createPlayer(702, 'T', 'mage');
  mage.level = 45;
  mage.hp = 99999; // #86: survive Aldric's responses — a defeated actor no longer acts
  const mDraws = strikeDraws(34, statsOf(mage).luck);
  const mb = startBattle('e_aldric', origin, { player: mage, rng: seeded(33) })!.battle;
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
  const wb = startBattle('e_aldric', origin, { player: warrior, rng: seeded(34) })!.battle;
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
  const player = createPlayer(704, 'T', 'mage');
  player.hp = 99999; // #86: survive Aldric's response — a defeated actor no longer acts
  const floor = startBattle('e_aldric', { kind: 'explore', zoneId: 'crownspire' }, {
    player,
    rng: seeded(8),
  })!.battle;
  injectMod(floor, 'enemy', 'spd', -0.95); // #86: guarantee the mage takes slot 1
  const before = floor.enemy.hp;
  const result = performAction(player, floor, { kind: 'attack' }, seeded(9));
  assert(result.consumedTurn, 'the floored attack still consumes the turn');
  const dealt = before - floor.enemy.hp;
  if (strikeDraws(9, statsOf(player).luck).crit) {
    assert([1, 2].includes(dealt), `floored crit deals 1-2, got ${dealt}`);
  } else {
    assertEquals(dealt, 1, 'raw below 1 must floor at exactly 1');
  }
  // A crit-carrying seed must surface the crit marker in the round line.
  let critSeed = -1;
  for (let seed = 1; seed <= 40; seed++) {
    if (strikeDraws(seed, statsOf(player).luck).crit) {
      critSeed = seed;
      break;
    }
  }
  assert(critSeed > 0, 'expected a crit seed within 1..40');
  const critBattle = startBattle('e_aldric', { kind: 'explore', zoneId: 'crownspire' }, {
    player,
    rng: seeded(8),
  })!.battle;
  injectMod(critBattle, 'enemy', 'spd', -0.95); // #86: the mage takes slot 1 — draws align
  const r2 = performAction(player, critBattle, { kind: 'attack' }, seeded(critSeed));
  assert(r2.lines.some((line) => line.includes('critical')), 'crit line must carry the marker');
});

Deno.test('combat: skills consume mp and respect cooldown', () => {
  const rng = seeded(11);
  const player = createPlayer(6, 'T', 'mage');
  player.level = 13;
  player.skills.push('sk_arcane_surge', 'sk_firebolt');
  player.mp = statsOf(player).maxMp;
  const battle = startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, {
    player,
    rng,
  })!.battle;
  // Keep the fight alive across both taps (#96: a terminal battle resolves
  // before validation feedback — this test pins cooldown/MP behavior).
  battle.enemy.hp = 99999;
  battle.enemy.maxHp = 99999;
  const mpBefore = player.mp;
  const r1 = performAction(player, battle, { kind: 'skill', skillId: 'sk_arcane_surge' }, rng);
  assert(player.mp < mpBefore, 'mp should be spent');
  assert(r1.lines.some((line) => line.includes('Arcane Surge')));
  // cooldown 2: immediate reuse should be blocked
  const r2 = performAction(player, battle, { kind: 'skill', skillId: 'sk_arcane_surge' }, rng);
  assert(r2.lines.some((line) => line.includes('cooldown')));
});

Deno.test('combat: guard halves incoming damage', () => {
  // Track damage via a spy: run guarded vs unguarded with same seed and
  // compare enemy-phase damage parsed from the log.
  const guarded = play('guard');
  const unguarded = play('attack');
  // Damage is read from the structured round history (#67): every consumed
  // round is one complete entry, flattened for this assertion.
  const dmgOf = (battle: BattleState): number => {
    const line = battle.history.flatMap((roundResult) => roundResult.lines).find((line) =>
      line.includes('uses')
    );
    return Number((line?.match(/— (\d+) damage/) ?? [])[1] ?? 0);
  };
  assert(dmgOf(unguarded) > 0, 'wolf should deal damage');
  assert(
    dmgOf(guarded) <= dmgOf(unguarded),
    `guarded hit ${dmgOf(guarded)} should not exceed unguarded ${dmgOf(unguarded)}`,
  );

  function play(action: 'guard' | 'attack') {
    const pc = createPlayer(10, 'T', 'cleric');
    const battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' }, {
      player: pc,
      rng: seeded(5),
    })!.battle;
    performAction(pc, battle, { kind: action }, seeded(5));
    return battle;
  }
});

Deno.test('boss battles cannot be fled', () => {
  const rng = seeded(3);
  const player = createPlayer(9, 'T', 'rogue');
  player.level = 45;
  const battle = startBattle('e_aldric', {
    kind: 'dungeon',
    zoneId: 'umbra',
    dungeonId: 'd_throne',
    floor: zone('umbra')!.dungeon!.floors.length + 1,
    boss: true,
  }, { player, rng })!.battle;
  const result = performAction(player, battle, { kind: 'flee' }, rng);
  assert(result.lines.some((line) => line.includes('no escape')));
  assertEquals(battle.phase, 'active');
});

Deno.test('quest flow: accept, progress by kill, turn in, unlock next', () => {
  const player = createPlayer(10, 'T', 'warrior');
  syncAvailability(player);
  assert(player.quests['m1_embers']?.status === 'available');
  const acc = acceptQuest(player, 'm1_embers', 'npc_maren');
  assert(acc.ok);
  for (let i = 0; i < 4; i++) onKill(player, 'e_ember_rat');
  assertEquals(player.quests['m1_embers'].status, 'turnIn');
  const res = turnInQuest(player, 'm1_embers', 'npc_maren');
  assert(res.ok);
  assertEquals(player.quests['m1_embers'].status, 'done');
  // m2 requires m1 done → now available
  syncAvailability(player);
  assert(player.quests['m2_letter']?.status === 'available');
});

Deno.test('quest objectives are satisfiable by content design', () => {
  // every referenced enemy/item/zone exists
  for (const questDef of QUESTS) {
    for (const objective of questDef.objectives) {
      if (objective.kind === 'kill') {
        assert(enemy(objective.target), `missing enemy ${objective.target} in ${questDef.id}`);
      }
      if (objective.kind === 'collect') {
        assert(item(objective.target), `missing item ${objective.target} in ${questDef.id}`);
      }
      if (objective.kind === 'reach') {
        assert(zone(objective.target), `missing zone ${objective.target} in ${questDef.id}`);
      }
    }
    for (const iid of Object.keys(questDef.rewards.items ?? {})) {
      assert(item(iid), `missing reward item ${iid} in ${questDef.id}`);
    }
    for (const zid of questDef.rewards.unlockZones ?? []) {
      assert(zone(zid), `missing unlock zone ${zid} in ${questDef.id}`);
    }
  }
});

Deno.test('inventory: add/remove/count roundtrip', () => {
  const player = createPlayer(11, 'T', 'rogue');
  addItem(player, 'c_minor_potion', 2);
  assertEquals(countOf(player, 'c_minor_potion'), 4); // rogue starts with 2
  removeItem(player, 'c_minor_potion', 4);
  assertEquals(countOf(player, 'c_minor_potion'), 0);
  assertEquals(removeItem(player, 'c_minor_potion'), false);
});

Deno.test('boss specials fire on the configured Nth enemy action (#26)', () => {
  // Vosk: special every 3 ("Swallow Whole"). Guard-spam rounds and record
  // which enemy actions fire the special — deterministic cadence, seeded
  // RNG only varies the filler moves.
  const rng = seeded(55);
  const warrior = createPlayer(60, 'T', 'warrior');
  warrior.level = 45;
  const battle = startBattle('e_vosk', { kind: 'explore', zoneId: 'hollowmere' }, {
    player: warrior,
    rng,
  })!.battle;
  warrior.battle = battle;
  battle.enemy.hp = 99999;
  battle.enemy.maxHp = 99999;
  const specialRounds: number[] = [];
  for (let round = 1; round <= 9; round++) {
    const res = performAction(warrior, battle, { kind: 'guard' }, rng);
    if (res.lines.some((line) => line.includes('Swallow Whole'))) specialRounds.push(round);
  }
  assertEquals(specialRounds, [3, 6, 9], 'every:3 → actions 3/6/9, not 2/5/8');

  // Chronolich: special every 4 ("Temporal Collapse").
  const rng2 = seeded(56);
  const mage = createPlayer(61, 'T', 'mage');
  mage.level = 45;
  mage.hp = 99999; // #86: survive the collapse hits — a defeated actor ends the round
  const b2 = startBattle('e_chronolich', { kind: 'explore', zoneId: 'sunspire' }, {
    player: mage,
    rng: rng2,
  })!.battle;
  mage.battle = b2;
  b2.enemy.hp = 99999;
  b2.enemy.maxHp = 99999;
  const collapseRounds: number[] = [];
  for (let round = 1; round <= 12; round++) {
    const res = performAction(mage, b2, { kind: 'guard' }, rng2);
    if (res.lines.some((line) => line.includes('Temporal Collapse'))) collapseRounds.push(round);
  }
  assertEquals(collapseRounds, [4, 8, 12], 'every:4 → actions 4/8/12');
});

Deno.test('buff durations: phase-aware cast-round decay (#27, #38, #77)', () => {
  // Fixture sanity: the content contract advertises these durations —
  // pinned through the effect specs (#78); Adrenaline's ATK leg is
  // content-authored too, stacking as its own instance.
  assertEquals(
    statmodSpec(SKILLS.find((skillDef) => skillDef.id === 'sk_war_cry')!, 'atk')!.duration,
    3,
  );
  assertEquals(
    statmodSpec(SKILLS.find((skillDef) => skillDef.id === 'sk_time_warp')!, 'mag')!.duration,
    3,
  );

  const mkBattle = (classId: 'warrior' | 'mage' | 'rogue', userId: number, skillId: string) => {
    const player = createPlayer(userId, 'T', classId);
    player.level = 40;
    player.skills.push(skillId);
    player.mp = 999;
    const battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' }, {
      player,
      rng: seeded(userId + 41),
    })!.battle;
    battle.enemy.hp = 99999;
    battle.enemy.maxHp = 99999;
    player.battle = battle;
    return { p: player, b: battle };
  };

  // War Cry (atk, 3): cast round not consumed → exactly 3 empowered attacks.
  const warCryFixture = mkBattle('warrior', 62, 'sk_war_cry');
  performAction(
    warCryFixture.p,
    warCryFixture.b,
    { kind: 'skill', skillId: 'sk_war_cry' },
    seeded(61),
  );
  assertEquals(
    modRemaining(warCryFixture.b, 'player', 'atk'),
    3,
    'cast round must not tick the offensive buff',
  );
  performAction(warCryFixture.p, warCryFixture.b, { kind: 'attack' }, seeded(62)); // empowered 1
  assertEquals(modRemaining(warCryFixture.b, 'player', 'atk'), 2);
  performAction(warCryFixture.p, warCryFixture.b, { kind: 'attack' }, seeded(63)); // empowered 2
  assertEquals(modRemaining(warCryFixture.b, 'player', 'atk'), 1);
  performAction(warCryFixture.p, warCryFixture.b, { kind: 'attack' }, seeded(64)); // empowered 3
  assertEquals(
    modRemaining(warCryFixture.b, 'player', 'atk'),
    0,
    'exactly the advertised 3 empowered actions',
  );
  assertEquals(statPct(warCryFixture.b, 'player', 'atk'), 0);

  // Time Warp (mage: mag + spd): both legs defer their cast-round tick
  // since #94. MAG empowers only future actions — the cast round cannot
  // use it. SPD's advertised rounds are INITIATIVE snapshots (#94): a
  // mid-round cast spends no unit on the already-decided snapshot, so its
  // first decay defers too — the foe's next three moves face the haste.
  const timeWarpFixture = mkBattle('mage', 63, 'sk_time_warp');
  performAction(
    timeWarpFixture.p,
    timeWarpFixture.b,
    { kind: 'skill', skillId: 'sk_time_warp' },
    seeded(66),
  );
  assertEquals(
    modRemaining(timeWarpFixture.b, 'player', 'mag'),
    3,
    'mag deferred on the cast round',
  );
  assertEquals(
    modRemaining(timeWarpFixture.b, 'player', 'spd'),
    3,
    'spd defers on the cast round — snapshots are its unit (#94)',
  );
  performAction(timeWarpFixture.p, timeWarpFixture.b, { kind: 'attack' }, seeded(67));
  assertEquals(modRemaining(timeWarpFixture.b, 'player', 'mag'), 2);
  assertEquals(modRemaining(timeWarpFixture.b, 'player', 'spd'), 2);
  performAction(timeWarpFixture.p, timeWarpFixture.b, { kind: 'attack' }, seeded(68));
  assertEquals(modRemaining(timeWarpFixture.b, 'player', 'mag'), 1);
  assertEquals(
    modRemaining(timeWarpFixture.b, 'player', 'spd'),
    1,
    'three snapshots, cast round excluded',
  );

  // Adrenaline Surge (heal + atk 2): defers like other offensive keys.
  const adrenalineFixture = mkBattle('warrior', 64, 'sk_adrenaline');
  adrenalineFixture.p.hp = 10; // let the heal component land
  performAction(adrenalineFixture.p, adrenalineFixture.b, {
    kind: 'skill',
    skillId: 'sk_adrenaline',
  }, seeded(69));
  assertEquals(modRemaining(adrenalineFixture.b, 'player', 'atk'), 2);
  performAction(adrenalineFixture.p, adrenalineFixture.b, { kind: 'attack' }, seeded(70));
  assertEquals(modRemaining(adrenalineFixture.b, 'player', 'atk'), 1);
  performAction(adrenalineFixture.p, adrenalineFixture.b, { kind: 'attack' }, seeded(71));
  assertEquals(
    modRemaining(adrenalineFixture.b, 'player', 'atk'),
    0,
    'exactly the advertised 2 empowered actions',
  );

  // Smoke Step (rogue: SPD only, 3 turns): since #94 SPD's advertised
  // rounds are INITIATIVE snapshots — a mid-round cast spends no unit on
  // the already-decided snapshot, so its first decay defers and the buff
  // covers exactly the foe's NEXT three moves.
  const smokeStepFixture = mkBattle('rogue', 78, 'sk_smoke_step');
  performAction(
    smokeStepFixture.p,
    smokeStepFixture.b,
    { kind: 'skill', skillId: 'sk_smoke_step' },
    seeded(79),
  );
  assertEquals(
    modRemaining(smokeStepFixture.b, 'player', 'spd'),
    3,
    'cast round spent no initiative unit — the full 3 snapshots remain (#94)',
  );
  performAction(smokeStepFixture.p, smokeStepFixture.b, { kind: 'attack' }, seeded(80));
  assertEquals(modRemaining(smokeStepFixture.b, 'player', 'spd'), 2);
  performAction(smokeStepFixture.p, smokeStepFixture.b, { kind: 'attack' }, seeded(81));
  assertEquals(modRemaining(smokeStepFixture.b, 'player', 'spd'), 1);
  performAction(smokeStepFixture.p, smokeStepFixture.b, { kind: 'attack' }, seeded(82));
  assertEquals(
    modRemaining(smokeStepFixture.b, 'player', 'spd'),
    0,
    'exactly three initiative snapshots, cast round excluded',
  );
  assertEquals(statPct(smokeStepFixture.b, 'player', 'spd'), 0);

  // Iron Wall (def): RETAINS the cast-round tick — it protects against the
  // enemy response on the casting round, exactly as before.
  const wallDur =
    statmodSpec(SKILLS.find((skillDef) => skillDef.id === 'sk_iron_wall')!, 'def')!.duration;
  const ironWallFixture = mkBattle('warrior', 65, 'sk_iron_wall');
  performAction(
    ironWallFixture.p,
    ironWallFixture.b,
    { kind: 'skill', skillId: 'sk_iron_wall' },
    seeded(72),
  );
  assertEquals(
    modRemaining(ironWallFixture.b, 'player', 'def'),
    wallDur - 1,
    'defensive buffs tick on the cast round',
  );
  assert(
    statPct(ironWallFixture.b, 'player', 'def') > 0,
    'protection active during the cast-round response',
  );
});

Deno.test('combat: Blessing empowers MAG/DEF — never Cleric-dead ATK (#77)', () => {
  const mkCleric = (userId: number) => {
    const player = createPlayer(userId, 'T', 'cleric');
    player.level = 20;
    player.skills.push('sk_blessing');
    player.mp = 999;
    const battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' }, {
      player,
      rng: seeded(userId + 41),
    })!.battle;
    battle.enemy.hp = 99999;
    battle.enemy.maxHp = 99999;
    player.battle = battle;
    return { p: player, b: battle };
  };
  // The cast lands exactly the MAG/DEF legs; ATK is untouched because no
  // Cleric-owned action can use it (Radiant Strike/Smite are MAG vs RES,
  // Cleric weapons raise MAG).
  const fixture = mkCleric(90);
  performAction(fixture.p, fixture.b, { kind: 'skill', skillId: 'sk_blessing' }, seeded(91));
  assertEquals(
    statPct(fixture.b, 'player', 'atk'),
    0,
    'no ATK leg — no Cleric action could use it (#77)',
  );
  assertEquals(statPct(fixture.b, 'player', 'mag'), 0.3, 'MAG is the Cleric offense leg');
  assertEquals(statPct(fixture.b, 'player', 'def'), 0.3, 'DEF leg unchanged');
  assertEquals(
    fixture.b.effectInstances.map((instance) => instance.stat).sort().join(','),
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
  const sentinelPlayer = createPlayer(66, 'T', 'warrior');
  sentinelPlayer.level = 45;
  // Ruin Sentinel: Guard Stance (weight 1 vs Stone Fist 3).
  const battle = startBattle('e_sentinel', { kind: 'explore', zoneId: 'sunspire' }, {
    player: sentinelPlayer,
    rng,
  })!.battle;
  sentinelPlayer.battle = battle;
  battle.enemy.hp = 99999;
  battle.enemy.maxHp = 99999;
  let guardSeen = false;
  for (let roundIndex = 0; roundIndex < 40 && !guardSeen; roundIndex++) {
    const before = sentinelPlayer.hp;
    const res = performAction(sentinelPlayer, battle, { kind: 'guard' }, rng);
    if (res.lines.some((line) => line.includes('Guard Stance'))) {
      guardSeen = true;
      assertEquals(sentinelPlayer.hp, before, 'Guard Stance must not deal damage');
      assertEquals(mitigationPct(battle, 'enemy'), 0.4, 'guard raises the enemy mitigation');
      assertEquals(
        modInstance(battle, 'enemy', 'mitigation')!.remaining,
        2,
        'the cast round does not consume the guard',
      );
    }
  }
  assert(guardSeen, 'Guard Stance must appear within 40 rounds');
  // Two protected rounds, then the guard expires (seed is fixed, so the
  // sentinel's move sequence — including any re-cast — is deterministic).
  performAction(sentinelPlayer, battle, { kind: 'attack' }, rng);
  assertEquals(
    modInstance(battle, 'enemy', 'mitigation')!.remaining,
    1,
    'one protected round consumed',
  );
  performAction(sentinelPlayer, battle, { kind: 'attack' }, rng);
  assertEquals(mitigationPct(battle, 'enemy'), 0, 'guard expired after its turns');
  assertEquals(modInstance(battle, 'enemy', 'mitigation'), undefined);

  // Grey Wolf's Howl (power 0, weaken rider): pure status, no chip damage.
  const rng2 = seeded(76);
  const wolfPlayer = createPlayer(67, 'T', 'warrior');
  wolfPlayer.level = 45;
  const wb = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' }, {
    player: wolfPlayer,
    rng: rng2,
  })!.battle;
  wolfPlayer.battle = wb;
  wb.enemy.hp = 99999;
  wb.enemy.maxHp = 99999;
  let howlSeen = false;
  for (let roundIndex = 0; roundIndex < 60 && !howlSeen; roundIndex++) {
    const res = performAction(wolfPlayer, wb, { kind: 'guard' }, rng2);
    if (res.lines.some((line) => line.includes('Howl'))) {
      howlSeen = true;
      assert(
        !res.lines.some((line) => line.includes('damage to you')),
        `Howl must not chip: ${res.lines.join(' | ')}`,
      );
      assert(res.lines.some((line) => line.includes('sapped')), 'the weaken rider still lands');
      assertEquals(sapPct(wb, 'player'), 0.15);
    }
  }
  assert(howlSeen, 'Howl must appear within 60 rounds');
});

Deno.test('overworld Warden is an elite; the dungeon Warden is the boss (#28)', () => {
  const player = createPlayer(68, 'T', 'warrior');
  player.level = 45;

  // Overworld elite: smokeable, and its kills do not inflate boss stats.
  const elite = startBattle('e_warden', { kind: 'elite', zoneId: 'abyss' }, {
    player,
    rng: seeded(81),
  })!.battle;
  player.battle = elite;
  assert(!elite.enemy.isBoss, 'the overworld Warden is an elite, not a boss');
  addItem(player, 'c_smoke_bomb', 1);
  performAction(player, elite, { kind: 'item', itemId: 'c_smoke_bomb' }, seeded(81));
  assertEquals(elite.phase, 'fled', 'elites can be smoked out of');

  const afterElite = player.stats.bossesSlain;
  const elite2 = startBattle('e_warden', { kind: 'elite', zoneId: 'abyss' }, {
    player,
    rng: seeded(82),
  })!.battle;
  elite2.enemy.hp = 0;
  resolveVictory(player, elite2, seeded(82));
  assertEquals(
    player.stats.bossesSlain,
    afterElite,
    'elite Warden kills do not count as bosses slain',
  );

  // Dungeon boss floor: inescapable and boss-counted.
  const boss = startBattle('e_warden', {
    kind: 'dungeon',
    zoneId: 'abyss',
    dungeonId: 'd_seam',
    floor: zone('abyss')!.dungeon!.floors.length + 1,
    boss: true,
  }, { player, rng: seeded(83) })!.battle;
  player.battle = boss;
  assert(boss.enemy.isBoss, 'the d_seam Warden is boss-classified');
  addItem(player, 'c_smoke_bomb', 1);
  const res2 = performAction(player, boss, { kind: 'item', itemId: 'c_smoke_bomb' }, seeded(83));
  assert(
    res2.lines.some((line) => line.includes('no escape')),
    'dungeon Warden refuses Smoke Bomb',
  );
  assertEquals(boss.phase, 'active', 'smoke refused → battle continues');
  boss.enemy.hp = 0;
  resolveVictory(player, boss, seeded(84));
  assertEquals(player.stats.bossesSlain, afterElite + 1, 'dungeon Warden counts as a boss slain');
});

Deno.test('damage-skill generated mechanics state their exact multiplier (#34, #78, #120)', () => {
  for (const skillDef of SKILLS) {
    const text = mechanicsText(skillDef.effects);
    for (const effect of skillDef.effects) {
      if (effect.kind !== 'damage') continue;
      const match = text.match(/Deals (\d+)% (ATK|MAG) damage/);
      assert(match, `${skillDef.id}: no damage sentence in "${text}"`);
      assertEquals(
        Number(match[1]) / 100,
        effect.power,
        `${skillDef.id}: mechanics say ${match[1]}% but power is ${effect.power}`,
      );
    }
  }
});

Deno.test('economy: buy needs gold, sell returns ratio', () => {
  const player = createPlayer(12, 'T', 'warrior');
  player.gold = 0;
  const fail = buy(player, 'c_minor_potion', 1);
  assert(!fail.ok);
  player.gold = 1000;
  const ok = buy(player, 'c_minor_potion', 1);
  assert(ok.ok);
  const qty = countOf(player, 'c_minor_potion');
  assert(qty >= 4);
  sell(player, 'c_minor_potion', 1);
  assertEquals(countOf(player, 'c_minor_potion'), qty - 1);
  assert(player.gold > 1000 - 30);
});

Deno.test('shop stock: local facilities, starter stays beginner, gear only usable (#22, #161)', () => {
  const player = createPlayer(13, 'T', 'warrior');
  const early = resolveStock(player).map((offering) => offering.itemId);
  assert(early.includes('w_warrior_1'));
  // The starter shop stays a beginner shop at ANY level (#161): a level-45
  // veteran back in Emberdawn still faces the hearth-side rack.
  player.level = 45;
  const veteranAtHome = resolveStock(player).map((offering) => offering.itemId);
  assert(veteranAtHome.includes('w_warrior_1'), 'beginner steel stays on the starter rack');
  assert(!veteranAtHome.some((id) => id === 'w_warrior_4' || id === 'w_warrior_5'));
  // Regional stock is regional (#161): the frostpeak post carries northern
  // supplies, and its gear is filtered to the shopper (#22).
  const lvl45 = createPlayer(14, 'T', 'warrior');
  lvl45.level = 45;
  lvl45.currentZone = 'frostpeak';
  const late = resolveStock(lvl45).map((offering) => offering.itemId);
  assert(late.includes('c_greater_potion'));
  assert(late.includes('w_warrior_6'), 'northern gear lives at the northern post');
  // Endgame crownsteel exists only through progression (#161): the ash
  // caravan's crownsteel rule opens when the Last Flame is freed.
  const atCaravan = createPlayer(15, 'T', 'warrior');
  atCaravan.level = 45;
  atCaravan.currentZone = 'cinder';
  assert(
    !resolveStock(atCaravan).some((offering) => offering.itemId === 'w_warrior_8'),
    'crownsteel is gated behind the caldera, not level',
  );
  atCaravan.quests['m19_ignivar'] = { status: 'done', counts: [1] };
  const crownsteel = resolveStock(atCaravan).map((offering) => offering.itemId);
  assert(crownsteel.includes('w_warrior_8'), 'crownsteel after the Last Flame');
  assert(crownsteel.includes('t_8'), 'late trinkets need an acquisition path');
  // And no shelf anywhere offers unusable gear (#22).
  const audited: [string[], number][] = [
    [early, 1],
    [veteranAtHome, 45],
    [late, 45],
    [crownsteel, 45],
  ];
  for (const [stock, level] of audited) {
    for (const id of stock) {
      const itemDef = item(id)!;
      if (itemDef.kind === 'weapon' || itemDef.kind === 'armor' || itemDef.kind === 'trinket') {
        assertEquals(isEquippable(id, 'warrior', level).ok, true, `${id} at L${level}`);
      }
    }
  }
});

Deno.test('forge: tempering requires materials and caps at +5', () => {
  const player = createPlayer(14, 'T', 'warrior');
  addItem(player, 'm_ember_shard', 20);
  addItem(player, 'm_hardwood', 20);
  addItem(player, 'm_plant_fiber', 20);
  player.gold = 100000;
  for (let temperLevel = 0; temperLevel < 5; temperLevel++) {
    const res = temper(player, 'weapon');
    assert(res.ok, `temper ${temperLevel + 1} should succeed`);
  }
  assertEquals(temperLevel(player, 'weapon'), 5);
  const blocked = temper(player, 'weapon');
  assert(!blocked.ok);
  // derived stats reflect the temper bonus
  const boosted = statsOf(player);
  const fresh = createPlayer(15, 'T', 'warrior');
  assert(boosted.atk > statsOf(fresh).atk);
});

Deno.test('world: journeys need adjacency+unlock; final arrival restores havens', () => {
  const player = createPlayer(16, 'T', 'mage');
  player.hp = 1;
  // An unknown or non-adjacent edge never departs, whatever the unlock set says.
  assert(!startJourney(player, 'w_nope_nada').ok);
  assert(!startJourney(player, 'w_whisperwood_hollowmere').ok, 'not adjacent from Emberdawn');
  assertEquals(player.currentZone, 'emberdawn');
  // Zero-event starter roads cross immediately.
  const ok = startJourney(player, 'w_emberdawn_outskirts');
  assert(ok.ok && ok.step.kind === 'arrived');
  assertEquals(player.currentZone, 'outskirts');
  assert(player.flags['zone_outskirts']);
  assert(!player.journey, 'zero-event crossings never persist a journey');
  // Walk the starter roads; arrival at the haven fully restores (#159).
  player.hp = 1;
  player.mp = 1;
  for (
    const edge of [
      'w_outskirts_whisperwood',
      'w_whisperwood_outskirts',
      'w_outskirts_emberdawn',
    ]
  ) {
    const step = startJourney(player, edge);
    assert(step.ok && step.step.kind === 'arrived', edge);
  }
  assertEquals(player.currentZone, 'emberdawn');
  assertEquals(player.hp, statsOf(player).maxHp);
  assertEquals(player.mp, statsOf(player).maxMp);
});

Deno.test('death revives at a safe haven, not where you fell', () => {
  const player = createPlayer(33, 'T', 'warrior');
  player.gold = 1000;
  player.currentZone = 'whisperwood';
  player.hp = 0;
  const line = applyDeath(player);
  assert(line.includes('black out'));
  assertEquals(player.stats.deaths, 1);
  assertEquals(player.gold, 900);
  // Full revive (#212): the haven full-heals on arrival anyway — the gold
  // loss and the lost position are the penalty, not a walk out and back in.
  assertEquals(player.hp, statsOf(player).maxHp);
  assertEquals(player.mp, statsOf(player).maxMp);
  assertEquals(player.currentZone, 'emberdawn');
});

Deno.test('derived stats aggregate equipped slots only — bag copies never count', () => {
  const plain = createPlayer(23, 'T', 'warrior');
  const withExtra = createPlayer(24, 'T', 'warrior');
  withExtra.inventory = [...withExtra.inventory, { id: withExtra.equipment.weapon!, qty: 1 }];
  assertEquals(statsOf(withExtra).atk, statsOf(plain).atk, 'bag copies never affect stats');
});

Deno.test('save gate: current-version saves load unchanged', () => {
  const player = createPlayer(28, 'T', 'mage');
  const before = JSON.stringify(player);
  assertSupportedSaveVersion(player);
  assertEquals(JSON.stringify(player), before, 'a current save is untouched');
});

Deno.test('save gate: refuses to downgrade saves from a newer binary', () => {
  const player = createPlayer(25, 'T', 'rogue');
  player.stateVersion = CURRENT_STATE_VERSION + 1;
  player.gold = 12345;
  assertThrows(() => assertSupportedSaveVersion(player), SaveTooNewError);
  // The refusal must be total: no rewrite, no stamp-down, no loss.
  assertEquals(player.stateVersion, CURRENT_STATE_VERSION + 1);
  assertEquals(player.gold, 12345);
});

Deno.test('save gate: unversioned and older saves fail clearly, unmutated (#44, #116)', () => {
  // Pre-versioning save (no stateVersion): not a supported shape, never
  // silently stamped current — or interpreted as any numbered version.
  const player = createPlayer(26, 'T', 'warrior');
  const raw = player as unknown as Record<string, unknown>;
  delete raw.stateVersion;
  assertThrows(() => assertSupportedSaveVersion(player), SaveTooOldError);
  assertEquals(raw.stateVersion, undefined, 'no version was stamped');

  // Any version below the current schema is refused outright (#116): older
  // development saves are disposable — no rewrite, no stamp-up.
  const p2 = createPlayer(27, 'T', 'warrior');
  p2.stateVersion = CURRENT_STATE_VERSION - 1;
  p2.gold = 999;
  assertThrows(() => assertSupportedSaveVersion(p2), SaveTooOldError);
  assertEquals(p2.stateVersion, CURRENT_STATE_VERSION - 1, 'no rewrite, no stamp-up');
  assertEquals(p2.gold, 999);
});

Deno.test('world: every zone is reachable from the starting zones', () => {
  const granted = new Set<string>(STARTING_ZONES);
  for (const questDef of QUESTS) {
    for (const uz of questDef.rewards.unlockZones ?? []) granted.add(uz);
  }
  for (const zoneDef of ZONES) {
    for (const uz of zoneDef.dungeon?.firstClear?.unlockZones ?? []) {
      assert(zone(uz), `missing first-clear unlock zone ${uz} in ${zoneDef.id}`);
      granted.add(uz);
    }
  }
  for (const zoneDef of ZONES) {
    assert(granted.has(zoneDef.id), `zone ${zoneDef.id} cannot be unlocked by any content`);
  }
});

Deno.test('world: safe havens never spawn battles; the wilds do', () => {
  const rng = seeded(21);
  const player = createPlayer(17, 'T', 'warrior');
  // Village explore: treasure/flavor only — never a battle, never a rest
  // (#211: the haven's arrival already restores both pools, so an in-haven
  // rest could only claim a heal that lands nothing).
  for (let exploreAttempt = 0; exploreAttempt < 200; exploreAttempt++) {
    const outcome = explore(player, rng);
    assert(outcome.kind !== 'battle', 'safe haven must not spawn battles');
    assert(
      outcome.kind !== 'result' || outcome.lines.every((line) => !line.startsWith('🌙')),
      'safe haven must not roll rest events',
    );
    assertEquals(player.battle, undefined); // explore never attaches; caller does
  }
  // The wilds: battles are common (weighted tables) — find one. The
  // Outskirts are the level-1 wilds band (#73); the Whisperwood's band
  // starts at 3 and its elite waits for 5.
  assert(travelDirect(player, 'outskirts').ok);
  let sawBattle = false;
  for (let exploreAttempt = 0; exploreAttempt < 50 && !sawBattle; exploreAttempt++) {
    if (explore(player, rng).kind === 'battle') sawBattle = true;
  }
  assert(sawBattle, 'whisperwood should spawn battles');
});

Deno.test('world: victory-gated floors, story-gated boss, first-clear once', () => {
  const rng = seeded(31);
  const player = createPlayer(18, 'T', 'warrior');
  player.level = 45;
  player.unlockedZones.push('hollowmere');
  travelDirect(player, 'hollowmere');
  const dungeon = dungeonOf(zone('hollowmere')!)!;

  function clearNormalFloors() {
    for (let floorIndex = 0; floorIndex < dungeon.floors.length; floorIndex++) {
      const res = diveDungeon(player, dungeon, rng);
      assert(res.ok, `floor ${floorIndex + 1} should be open`);
      if (dungeon.floors[floorIndex].discovery) {
        assert(!res.battle, 'discovery advances without a battle');
      } else {
        assert(res.battle);
        assertEquals(
          nextDungeonFloor(player, dungeon),
          floorIndex + 1,
          'entry alone never clears an encounter',
        );
        assert(res.battle.origin.kind === 'dungeon' && !res.battle.origin.boss);
        res.battle.enemy.hp = 0; // simulate victory
        resolveVictory(player, res.battle);
      }
      assertEquals(nextDungeonFloor(player, dungeon), floorIndex + 2);
    }
  }
  clearNormalFloors();
  const blocked = diveDungeon(player, dungeon, rng);
  assert(!blocked.ok, `boss floor sealed: ${blocked.lines[0]}`);
  assert(abandonDungeon(player).ok, 'leave the preparation run to speak with the Ferryman');

  // The story hunt begins — the deepest chamber opens (d_sunken gates on m7).
  player.quests['m6_toxin'] = { status: 'done', counts: [] };
  syncAvailability(player);
  assert(acceptQuest(player, 'm7_tyrant', 'npc_ferryman').ok); // the Ferryman is right here
  clearNormalFloors();
  const bossRun = diveDungeon(player, dungeon, rng);
  assert(bossRun.ok && bossRun.battle);
  assertEquals(bossRun.battle!.enemy.id, dungeon.boss);
  bossRun.battle!.enemy.hp = 0;
  const lines = resolveVictory(player, bossRun.battle!);
  assert(lines.some((line) => line.includes('First clear')), 'first clear grants rewards');

  // A rematch requires another complete run; first-clear rewards never repeat.
  clearNormalFloors();
  const rematch = diveDungeon(player, dungeon, rng);
  assert(rematch.ok && rematch.battle);
  assertEquals(rematch.battle!.enemy.id, dungeon.boss);
  rematch.battle!.enemy.hp = 0;
  const lines2 = resolveVictory(player, rematch.battle!);
  assert(!lines2.some((line) => line.includes('First clear')));
});

Deno.test("content integrity: zones' exploration events and dungeon encounters reference real ids", () => {
  for (const zoneDef of ZONES) {
    for (const event of zoneDef.explore) {
      if (event.kind === 'battle' || event.kind === 'elite') {
        assert(enemy(event.enemy), `zone ${zoneDef.id} missing enemy ${event.enemy}`);
      }
      if (event.kind === 'treasure' && event.item) {
        assert(item(event.item), `zone ${zoneDef.id} missing treasure item ${event.item}`);
      }
    }
    // Safe havens author no battle, elite or rest events (#211): arrival at
    // a haven already restores both pools fully, so an in-haven rest would
    // only ever roll against full pools and claim a heal that lands nothing.
    if (zoneDef.safeHaven) {
      assert(
        zoneDef.explore.every((event) => event.kind === 'treasure' || event.kind === 'flavor'),
        `safe haven ${zoneDef.id} authors a battle/elite/rest explore event`,
      );
    }
    if (zoneDef.dungeon) {
      for (const floor of zoneDef.dungeon.floors) {
        for (const enemyId of floor.enemies) {
          assert(enemy(enemyId), `dungeon ${zoneDef.dungeon.id} missing enemy ${enemyId}`);
        }
        if (floor.treasure?.item) assert(item(floor.treasure.item));
      }
      assert(enemy(zoneDef.dungeon.boss), `dungeon ${zoneDef.dungeon.id} missing boss`);
    }
  }
});

Deno.test('content integrity: enemies reference real drop items', () => {
  const ids = new Set(ENEMIES.map((enemyDef) => enemyDef.id));
  assertEquals(ids.size, ENEMIES.length, 'enemy ids must be unique');
  for (const enemyDef of ENEMIES) {
    assert(enemyDef.id.length > 0, 'enemy ids must be non-empty');
    assert(enemyDef.name.length > 0, `enemy ${enemyDef.id} needs a name`);
    for (const id of Object.keys(enemyDef.drops ?? {})) {
      assert(item(id), `enemy ${enemyDef.id} drops unknown item ${id}`);
    }
  }
});

Deno.test('content integrity: every consumable effect flag is disclosed by the generated mechanics (#98, #120)', () => {
  // Every mechanical flag on a consumable must appear in the GENERATED
  // player-facing rules text (#92/#98/#120): no hidden cleanses, escapes,
  // heals, resources or revives. Flavor is never the disclosure channel.
  for (const it of ITEMS) {
    if (!it.effect) continue;
    const effect = it.effect;
    const mech = consumableEffectLines(effect).join(' ');
    assert(mech.length > 0, `${it.id}: the generated mechanics are empty`);
    if (effect.healHp !== undefined) {
      assert(
        mech.includes(`${effect.healHp} HP`),
        `${it.id}: healHp is not disclosed ("${mech}")`,
      );
    }
    if (effect.healMp !== undefined) {
      assert(
        mech.includes(`${effect.healMp} MP`),
        `${it.id}: healMp is not disclosed ("${mech}")`,
      );
    }
    if (effect.cureStatus) {
      assert(
        /harmful effects/i.test(mech),
        `${it.id}: cureStatus is not disclosed ("${mech}")`,
      );
    }
    if (effect.flee) {
      assert(/escape/i.test(mech), `${it.id}: flee is not disclosed ("${mech}")`);
    }
    if (effect.revivePct !== undefined) {
      assert(
        mech.includes(`${effect.revivePct}% HP`),
        `${it.id}: revivePct is not disclosed ("${mech}")`,
      );
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
    for (const skillDef of skills) assert(SKILLS.includes(skillDef));
  }
  assertEquals(SKILLS.length, 48);
});

Deno.test('level-ups accumulate the full class roster in learn order (#81)', () => {
  // Current-constructor coverage of the expanded rosters: a hero grown from
  // creation to the cap through the real XP path ends knowing every class
  // skill, exactly once, in ascending learn order.
  const player = createPlayer(1, 'T', 'warrior');
  let xp = 0;
  for (let level = 1; level < MAX_LEVEL; level++) xp += xpForNextLevel(level);
  grantXp(player, xp);
  assertEquals(player.level, MAX_LEVEL);
  assertEquals(
    player.skills,
    skillsForClass('warrior', MAX_LEVEL).map((skillDef) => skillDef.id),
    'full ascending roster, no duplicates',
  );

  // A mid-band hero only knows what its level has crossed:
  const mid = createPlayer(2, 'T', 'mage');
  let xp2 = 0;
  for (let level = 1; level < 8; level++) xp2 += xpForNextLevel(level);
  grantXp(mid, xp2);
  assertEquals(mid.level, 8);
  assertEquals(mid.skills, ['sk_firebolt', 'sk_frost_lance', 'sk_scorch']);
});

Deno.test('skills: menu order is ascending by learn level; ties keep authored order (#77)', () => {
  for (const cid of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    const skills = skillsForClass(cid, MAX_LEVEL);
    for (let skillIndex = 1; skillIndex < skills.length; skillIndex++) {
      const prev = skills[skillIndex - 1]!;
      const cur = skills[skillIndex]!;
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
  const warrior = skillsForClass('warrior', MAX_LEVEL).map((skillDef) => skillDef.name);
  assert(warrior.indexOf('Whirlwind') < warrior.indexOf('Iron Wall'));
  const cleric = skillsForClass('cleric', MAX_LEVEL).map((skillDef) => skillDef.name);
  assert(cleric.indexOf('Radiant Burst') < cleric.indexOf('Holy Ward'));
  // Equal-level ties stay deterministic: Smite before Mend Wounds at Lv 1.
  const clericLv1 = skillsForClass('cleric', 1).map((skillDef) => skillDef.name);
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
    { v: 'npc', a: 'q', arg: 'm1_embers' },
    { v: 'dlg', a: 'ch', arg: 'accept' },
    { v: 'npc', a: 'bk' },
    { v: 'shop', a: 'buy', arg: 'c_potion' },
    { v: 'shop', a: 'p', arg: -1 },
    { v: 'forge', a: 'w' },
    { v: 'travel', a: 'go', arg: 'abyss' },
    { v: 'death', a: 'ok' },
    { v: 'meta', a: 'pick', arg: 'mage' },
    { v: 'meta', a: 'reset' },
    { v: 'meta', a: 'resetYes' },
  ] as const;
  for (const callback of cases) {
    const wire = encodeCb(callback as never);
    assert(wire.length <= 64, `${wire} too long`);
    const back = decodeCb(wire);
    assertEquals(back, callback, `roundtrip failed for ${wire}`);
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
  const ids = new Set(ITEMS.map((itemDef) => itemDef.id));
  assertEquals(ids.size, ITEMS.length, 'item ids must be unique');
  for (const itemDef of ITEMS) {
    if (itemDef.kind === 'quest') assertEquals(itemDef.price, 0);
    else assert(itemDef.price > 0, `${itemDef.id} should be priced`);
  }
});

// ── quest-item lifecycle (#2 / #10 / #12) ────────────────────────────────

Deno.test('questDropAllowed: quest items drop only while an open quest needs them', () => {
  const player = createPlayer(31, 'T', 'mage');
  assertEquals(questDropAllowed(player, 'q_toxin_sample'), false, 'no open quest → no drop');
  assertEquals(questDropAllowed(player, 'm_iron_chunk'), true, 'materials are never capped');
  player.quests['m6_toxin'] = { status: 'active', counts: [0] };
  addItem(player, 'q_toxin_sample', 3);
  assertEquals(questDropAllowed(player, 'q_toxin_sample'), true);
  addItem(player, 'q_toxin_sample', 1);
  assertEquals(questDropAllowed(player, 'q_toxin_sample'), false, 'cap reached');
  player.quests['m6_toxin']!.status = 'done';
  removeItem(player, 'q_toxin_sample', 4);
  assertEquals(questDropAllowed(player, 'q_toxin_sample'), false, 'done → never again');
});

Deno.test('Sunspire Key: enemies never drop it in any quest/gate state — m11 reward is the sole source (#20)', () => {
  // Content data itself carries no key drops anymore — catalog and runtime agree.
  for (const enemyDef of ENEMIES) {
    assertEquals(
      enemyDef.drops?.['q_sunspire_key'],
      undefined,
      `${enemyDef.id} must not drop the key`,
    );
  }

  const player = createPlayer(33, 'T', 'warrior');
  const hammer = (tag: string) => {
    const rng = seeded(40 + tag.length);
    for (let killCount = 0; killCount < 80; killCount++) {
      resolveVictory(
        player,
        startBattle('e_automaton', { kind: 'explore', zoneId: 'sunspire' }, {
          player,
          rng,
        })!.battle,
        rng,
      );
    }
  };
  // Quest-relevant state (m11 open, gate pending): kills never mint a key.
  player.quests['m11_toll'] = { status: 'active', counts: [0] };
  hammer('active');
  assertEquals(countOf(player, 'q_sunspire_key'), 0, 'no enemy-sourced key while m11 is open');
  // Gate-pending WITH the key already held: no surplus duplicates.
  addItem(player, 'q_sunspire_key', 1);
  hammer('held');
  assertEquals(countOf(player, 'q_sunspire_key'), 1, 'a held key is never duplicated');
  // Story moved on (m11 done, gate open forever): still nothing.
  player.quests['m11_toll']!.status = 'done';
  hammer('done');
  assertEquals(countOf(player, 'q_sunspire_key'), 1, 'post-story kills mint nothing');
});

Deno.test('resolveVictory suppresses irrelevant quest drops; needed ones flow', () => {
  const player = createPlayer(32, 'T', 'warrior');
  const rng = seeded(31);
  for (let killCount = 0; killCount < 40; killCount++) {
    resolveVictory(
      player,
      startBattle('e_leech', { kind: 'explore', zoneId: 'hollowmere' }, { player, rng })!.battle,
      rng,
    );
  }
  assertEquals(countOf(player, 'q_toxin_sample'), 0, 'no open quest → drops suppressed');
  player.quests['m6_toxin'] = { status: 'active', counts: [0] };
  for (let killCount = 0; killCount < 60; killCount++) {
    resolveVictory(
      player,
      startBattle('e_leech', { kind: 'explore', zoneId: 'hollowmere' }, { player, rng })!.battle,
      rng,
    );
  }
  const got = countOf(player, 'q_toxin_sample');
  assert(got >= 1 && got <= 4, `expected 1..4 samples while m6 open, got ${got}`);
  // Deterministic turn-in: top up to the exact requirement and ready it.
  addItem(player, 'q_toxin_sample', 4 - got);
  player.quests['m6_toxin']!.status = 'turnIn';
  player.unlockedZones.push('hollowmere');
  player.currentZone = 'hollowmere'; // the Ferryman accepts the handover on-site
  assertEquals(turnInQuest(player, 'm6_toxin', 'npc_ferryman').ok, true);
  assertEquals(countOf(player, 'q_toxin_sample'), 0, 'turn-in consumes the goods');
  for (let killCount = 0; killCount < 20; killCount++) {
    resolveVictory(
      player,
      startBattle('e_leech', { kind: 'explore', zoneId: 'hollowmere' }, { player, rng })!.battle,
      rng,
    );
  }
  assertEquals(countOf(player, 'q_toxin_sample'), 0, 'done quest → the tap stays shut');
});

Deno.test('m2: the sealed letter is granted by m1 and delivered to Bram', () => {
  const player = createPlayer(34, 'T', 'warrior');
  syncAvailability(player);
  assertEquals(acceptQuest(player, 'm1_embers', 'npc_maren').ok, true);
  for (let i = 0; i < 4; i++) onKill(player, 'e_ember_rat');
  assertEquals(turnInQuest(player, 'm1_embers', 'npc_maren').ok, true);
  assertEquals(countOf(player, 'q_sealed_letter'), 1, 'm1 hands over the letter');
  syncAvailability(player);
  assertEquals(acceptQuest(player, 'm2_letter', 'npc_maren').ok, true);
  onStoryEvent(player, 'heard_bram_reading'); // the letter satisfies the collect half; Bram's reading the rest
  const t2 = turnInQuest(player, 'm2_letter', 'npc_bram');
  assertEquals(t2.ok, true);
  assertEquals(countOf(player, 'q_sealed_letter'), 0, 'letter handed to Bram');
  assertEquals(player.quests['m2_letter'].status, 'done');
});

Deno.test('m22: the Archivist handoff completes via talk objective', () => {
  const player = createPlayer(33, 'T', 'mage');
  player.unlockedZones.push('umbra');
  player.currentZone = 'umbra'; // the Archivist accepts on-site (#64)
  player.quests['m22_umbral_key'] = { status: 'active', counts: [0] };
  onStoryEvent(player, 'heard_archivists_counsel');
  assertEquals(player.quests['m22_umbral_key'].status, 'turnIn');
  assertEquals(turnInQuest(player, 'm22_umbral_key', 'npc_archivist').ok, true);
  assertEquals(player.quests['m22_umbral_key'].status, 'done');
});

Deno.test('turn-in aggregates duplicate same-item collect objectives (#8)', () => {
  // Fixture: no shipped quest doubles an item, so temporarily give m6 a
  // second collect objective on the SAME item. The QUEST_INDEX holds the
  // same object reference, so an in-place mutation is what turnInQuest sees.
  const m6 = QUESTS.find((questDef) => questDef.id === 'm6_toxin')!;
  const original = m6.objectives;
  m6.objectives = [
    { kind: 'collect', target: 'm_iron_chunk', count: 3 },
    { kind: 'collect', target: 'm_iron_chunk', count: 3 },
  ];
  try {
    const player = createPlayer(36, 'T', 'warrior');
    player.unlockedZones.push('hollowmere');
    player.currentZone = 'hollowmere'; // the Ferryman accepts on-site (#64)
    player.quests['m6_toxin'] = { status: 'turnIn', counts: [0, 0] };
    // 3 in the bag: per-objective validation would pass BOTH objectives
    // against the same three copies. Aggregated, it must refuse.
    addItem(player, 'm_iron_chunk', 3);
    assertEquals(turnInQuest(player, 'm6_toxin', 'npc_ferryman').ok, false, '3 < 3+3');
    assertEquals(player.quests['m6_toxin'].status, 'active');
    // Full supply: passes and consumes the aggregated total.
    addItem(player, 'm_iron_chunk', 3);
    player.quests['m6_toxin']!.status = 'turnIn';
    assertEquals(turnInQuest(player, 'm6_toxin', 'npc_ferryman').ok, true);
    assertEquals(countOf(player, 'm_iron_chunk'), 0, 'all six consumed');
  } finally {
    m6.objectives = original;
  }
});

Deno.test('skill cadence: each class demonstrates its role by level 2 (#71)', () => {
  const kit = (cid: ClassId, lv: number): string[] =>
    skillsForClass(cid, lv).map((skillDef) => skillDef.id);
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
      .filter((skillDef) => skillDef.type === 'phys' || skillDef.type === 'mag')
      .map((skillDef) => skillDef.learnLevel)
      .sort((leftValue, rightValue) => leftValue - rightValue);
    assert(offense.length >= 2, `${cid} owns a second damage tier`);
    assert(
      offense[1]! - offense[0]! <= 12,
      `${cid} waits ${offense[1]! - offense[0]!} levels for offensive growth`,
    );
    const by17 = skillsForClass(cid, 17).filter((skillDef) =>
      skillDef.type === 'phys' || skillDef.type === 'mag'
    );
    assert(by17.length >= 2, `${cid} second damage tier arrives by 17`);
  }
});

Deno.test('generated mechanics state every skill effect exactly (#120)', () => {
  // The mechanical summary derives FROM the effect specs, so numbers
  // cannot drift — but the generator must DISCLOSE each field. Every
  // effect spec's key numbers must appear in its generated rules text.
  const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`;
  for (const skillDef of SKILLS) {
    const text = mechanicsText(skillDef.effects);
    assert(text.length > 0, `${skillDef.id} generated no mechanics`);
    for (const effect of skillDef.effects) {
      switch (effect.kind) {
        case 'damage':
          assert(
            text.includes(`${pct(effect.power)} ATK`) || text.includes(`${pct(effect.power)} MAG`),
            `${skillDef.id} must disclose ${pct(effect.power)} damage: ${text}`,
          );
          if (effect.execute) {
            assert(
              text.includes(
                `(+${pct(effect.execute.bonusPct)} against targets below ${
                  pct(effect.execute.belowPct)
                } HP)`,
              ),
              `${skillDef.id} execute window must be disclosed: ${text}`,
            );
          }
          if (effect.bypassShield) {
            assert(
              text.includes('Ignores Shield.'),
              `${skillDef.id} bypass must be disclosed: ${text}`,
            );
          }
          break;
        case 'statmod':
          assert(
            text.includes(`${pct(Math.abs(effect.pct))}`),
            `${skillDef.id}: ${effect.stat} leg ${pct(effect.pct)} must be disclosed: ${text}`,
          );
          assert(
            text.includes(`for ${effect.duration} rounds`),
            `${skillDef.id}: statmod duration must be disclosed: ${text}`,
          );
          break;
        case 'restore':
          if (effect.hpFull) {
            assert(text.includes('Fully restores HP.'), `${skillDef.id}: ${text}`);
          } else if (effect.hpPctOfMax !== undefined) {
            assert(
              text.includes(`Restores ${pct(effect.hpPctOfMax)} of max HP`),
              `${skillDef.id}: ${text}`,
            );
          } else if (effect.hpPower !== undefined) {
            assert(
              text.includes(
                `Restores ${pct(effect.hpPower * 2)} of MAG + ${effect.hpFlat ?? 0} HP`,
              ),
              `${skillDef.id}: ${text}`,
            );
          }
          if (effect.mpPctOfMax !== undefined) {
            assert(text.includes(pct(effect.mpPctOfMax)), `${skillDef.id}: ${text}`);
          }
          break;
        case 'lifesteal':
          assert(
            text.includes(`Restores ${pct(effect.pct)} of the damage dealt as HP.`),
            `${skillDef.id}: lifesteal must be disclosed: ${text}`,
          );
          break;
        case 'control':
          assert(
            text.includes(`${pct(effect.chance ?? 1)} chance to stun`),
            `${skillDef.id}: control chance must be disclosed: ${text}`,
          );
          break;
        case 'shield': {
          if (effect.magPower !== undefined) {
            assert(
              text.includes(`${pct(effect.magPower * 2)} MAG`),
              `${skillDef.id}: Shield MAG scaling must be disclosed: ${text}`,
            );
          }
          if (effect.defPower !== undefined) {
            assert(
              text.includes(`${pct(effect.defPower * 2)} DEF`),
              `${skillDef.id}: Shield DEF scaling must be disclosed: ${text}`,
            );
          }
          assert(
            text.includes(`+ ${effect.amount ?? 0}`) ||
              text.includes(`equal to ${effect.amount ?? 0}`),
            `${skillDef.id}: flat Shield component must be disclosed: ${text}`,
          );
          assert(
            effect.lifetime === 'battle'
              ? text.includes('for the rest of the battle')
              : text.includes(`for ${effect.duration} rounds`),
            `${skillDef.id}: Shield duration must be disclosed: ${text}`,
          );
          assert(text.includes('Shield'), `${skillDef.id}: the pool must be named Shield: ${text}`);
          break;
        }
        default:
          // cleanse/dispel/resource copy is covered by the shape tests in
          // mechanics_test.ts and the behavior tests.
          break;
      }
    }
  }
});

Deno.test('generated mechanics use canonical vocabulary, never flavor synonyms (#120)', () => {
  // Rules text standardizes on Shield / rounds / action / harmful /
  // beneficial. Creative words such as "ward" live in names and flavor
  // only — the generator's output must not use them, and this check does
  // NOT scan flavor for vocabulary.
  for (const skillDef of SKILLS) {
    const text = mechanicsText(skillDef.effects);
    assert(
      !/\bward\b/i.test(text),
      `${skillDef.id}: generated rules text must say Shield, not "ward": ${text}`,
    );
    assert(!/\bturns\b/i.test(text), `${skillDef.id}: durations are stated in rounds: ${text}`);
  }
  for (const it of ITEMS) {
    for (const tg of it.triggers ?? []) {
      const text = mechanicsLines(tg.effects, { opponent: FOE_VOICE }).join(' ');
      assert(!/\bturns\b/i.test(text), `${it.id}: durations are stated in rounds: ${text}`);
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
    const player = createPlayer(900 + seed, 'T', 'rogue');
    player.level = 8; // a real SPD edge over the rat, without one-shotting it
    const battle = startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, {
      player,
      rng,
    })!.battle;
    player.battle = battle;
    for (let round = 0; round < 6 && !dodged; round++) {
      const hpBefore = player.hp;
      const result = performAction(player, battle, { kind: 'attack' }, rng);
      const joined = result.lines.join(' ');
      if (joined.includes('slip aside')) {
        dodged = true;
        assertEquals(player.hp, hpBefore, 'a slipped blow deals no damage');
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
    const player = createPlayer(1200 + seed, 'T', 'rogue');
    player.level = 12;
    const battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
      player,
      rng,
    })!.battle;
    player.battle = battle;
    for (let round = 0; round < 8; round++) {
      const result = performAction(player, battle, { kind: 'attack' }, rng);
      const joined = result.lines.join(' ');
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
  for (const skillDef of SKILLS) {
    skillDef.effects.forEach((effect, effectIndex) =>
      specs.push({ from: `${skillDef.id}#${effectIndex}`, spec: effect })
    );
  }
  for (const en of ENEMIES) {
    en.moves.forEach((move, moveIndex) =>
      move.effects.forEach((effect, effectIndex) =>
        specs.push({ from: `${en.id}:move${moveIndex}#${effectIndex}`, spec: effect })
      )
    );
    if (en.opening) {
      en.opening.effects.forEach((effect, effectIndex) =>
        specs.push({ from: `${en.id}:opening#${effectIndex}`, spec: effect })
      );
    }
    if (en.special) {
      en.special.move.effects.forEach((effect, effectIndex) =>
        specs.push({ from: `${en.id}:special#${effectIndex}`, spec: effect })
      );
    }
  }
  for (const it of ITEMS) {
    it.triggers?.forEach((tg, triggerIndex) =>
      tg.effects.forEach((effect, effectIndex) =>
        specs.push({ from: `${it.id}:trig${triggerIndex}#${effectIndex}`, spec: effect })
      )
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
    const fam = tags.filter((tag) => families.includes(tag as EffectTag));
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
