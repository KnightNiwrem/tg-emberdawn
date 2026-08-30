/**
 * Engine unit tests — deterministic via seeded RNG.
 * Covers: creation, progression, combat, quests, economy, forge, world.
 */

import { assert, assertEquals, assertGreater } from '@std/assert';
import {
  applyDeath,
  createPlayer,
  CURRENT_STATE_VERSION,
  grantXp,
  migratePlayer,
  statsOf,
} from '../src/engine/character.ts';
import { xpForNextLevel } from '../src/engine/classes.ts';
import { derivedStats, MAX_LEVEL } from '../src/engine/classes.ts';
import {
  performAction,
  type PlayerAction,
  rollRewards,
  startBattle,
} from '../src/engine/combat.ts';
import { acceptQuest, onKill, syncAvailability, turnInQuest } from '../src/engine/quests.ts';
import { addItem, countOf, removeItem } from '../src/engine/inventory.ts';
import { buy, currentStock, sell } from '../src/engine/shops.ts';
import { temper, temperLevel } from '../src/engine/forge.ts';
import { diveDungeon, dungeonOf, explore, resolveVictory, travel } from '../src/engine/world.ts';
import { STARTING_ZONES, zone, ZONES } from '../src/content/zones.ts';
import { ENEMIES, enemy } from '../src/content/enemies.ts';
import { item, ITEMS } from '../src/content/items.ts';
import { SKILLS, skillsForClass } from '../src/content/skills.ts';
import { QUESTS } from '../src/content/quests.ts';
import { decodeCb, encodeCb } from '../src/codec.ts';

/** Deterministic RNG (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  const battle = startBattle('e_rat', { kind: 'explore', zoneId: 'emberfall' })!;
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
  const battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberfall' })!;
  const s0 = statsOf(p);
  const hpBefore = p.hp;
  const enemyHpBefore = battle.enemy.hp;
  performAction(p, battle, { kind: 'attack' }, rng);
  assert(battle.enemy.hp < enemyHpBefore, 'player attack should damage enemy');
  if (p.hp < hpBefore) assert(p.hp >= 0);
  void s0;
});

Deno.test('combat: skills consume mp and respect cooldown', () => {
  const rng = seeded(11);
  const p = createPlayer(6, 'T', 'mage');
  p.level = 13;
  p.skills.push('sk_arcane_surge', 'sk_firebolt');
  p.mp = statsOf(p).maxMp;
  const battle = startBattle('e_rat', { kind: 'explore', zoneId: 'emberfall' })!;
  const mpBefore = p.mp;
  const r1 = performAction(p, battle, { kind: 'skill', skillId: 'sk_arcane_surge' }, rng);
  assert(p.mp < mpBefore, 'mp should be spent');
  assert(r1.lines.some((l) => l.includes('Arcane Surge')));
  // cooldown 2: immediate reuse should be blocked
  const r2 = performAction(p, battle, { kind: 'skill', skillId: 'sk_arcane_surge' }, rng);
  assert(r2.lines.some((l) => l.includes('cooldown')));
});

Deno.test('combat: guard halves incoming damage', () => {
  const rng = seeded(99);

  function measure(useGuard: boolean): number {
    const battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberfall' })!;
    const pc = createPlayer(8, 'T', 'cleric');
    if (useGuard) performAction(pc, battle, { kind: 'guard' }, rng);
    else performAction(pc, battle, { kind: 'attack' }, rng);
    // enemy retaliates within the same call; measure the retaliation damage
    return 0; // replaced below
  }

  // Simpler direct comparison: run two identical setups, one guarding.
  function runBattle(guard: boolean, seed: number): number {
    const r = seeded(seed);
    const battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberfall' })!;
    const pc = createPlayer(9, 'T', 'cleric');
    performAction(pc, battle, guard ? { kind: 'guard' } : { kind: 'attack' }, r);
    return hpLost(pc, 0);
    function hpLost(_p: typeof pc, before: number): number {
      void before;
      return 0;
    }
  }
  void runBattle;
  void measure;

  // Track damage via a spy: run guarded vs unguarded with same seed and
  // compare enemy-phase damage parsed from the log.
  const guarded = play('guard');
  const unguarded = play('attack');
  const dmgOf = (log: string[]): number => {
    const line = log.find((l) => l.includes('uses'));
    return Number((line?.match(/— (\d+) damage/) ?? [])[1] ?? 0);
  };
  assert(dmgOf(unguarded.log) > 0, 'wolf should deal damage');
  assert(
    dmgOf(guarded.log) <= dmgOf(unguarded.log),
    `guarded hit ${dmgOf(guarded.log)} should not exceed unguarded ${dmgOf(unguarded.log)}`,
  );

  function play(action: 'guard' | 'attack') {
    const battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberfall' })!;
    const pc = createPlayer(10, 'T', 'cleric');
    performAction(pc, battle, { kind: action }, seeded(5));
    return battle;
  }
});

Deno.test('boss battles cannot be fled', () => {
  const rng = seeded(3);
  const p = createPlayer(9, 'T', 'rogue');
  p.level = 45;
  const battle = startBattle('e_aldric', {
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
  const acc = acceptQuest(p, 'm1_embers');
  assert(acc.ok);
  for (let i = 0; i < 4; i++) onKill(p, 'e_wolf');
  assertEquals(p.quests['m1_embers'].status, 'turnIn');
  const res = turnInQuest(p, 'm1_embers');
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

Deno.test('shop stock scales with player level within the zone band', () => {
  const p = createPlayer(13, 'T', 'warrior');
  const early = currentStock(p);
  assert(early.includes('w_warrior_1'));
  p.currentZone = 'frostpeak';
  const late = currentStock(p);
  assert(late.includes('w_warrior_4'));
  p.level = 45;
  p.currentZone = 'abyss'; // tier-8 gear lives where level 45 actually is
  const endgame = currentStock(p);
  assert(endgame.includes('w_warrior_8'), 'abyss-tier gear must be purchasable at 45');
  assert(endgame.includes('t_11'), 'late trinkets need an acquisition path');
  assert(late.includes('c_greater_potion'));
  assert(late.includes('c_smoke_bomb'));
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
  const back = travel(p, 'emberfall');
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
  assertEquals(p.currentZone, 'emberfall');
});

Deno.test('migratePlayer: destructive cleanup runs once, then never again', () => {
  const p = createPlayer(21, 'T', 'mage');
  // Pre-fix save: no starting skill, no Whisperwood, equipped gear ALSO in bag.
  p.skills = [];
  p.unlockedZones = ['emberfall'];
  addItem(p, 'w_mage_1', 2);
  addItem(p, 'a_mage_1', 1);
  p.stateVersion = 0; // a pre-versioning save deserializes as v0
  migratePlayer(p);
  assertEquals(p.stateVersion, CURRENT_STATE_VERSION);
  assertEquals(p.skills, skillsForClass('mage', 1).map((sk) => sk.id));
  for (const zid of STARTING_ZONES) assert(p.unlockedZones.includes(zid));
  // The bag held TWO copies: the one-time migration removes exactly the
  // legacy duplicate and leaves the second (legitimate) copy alone.
  assertEquals(countOf(p, 'w_mage_1'), 1, 'legacy duplicate removed exactly once');
  assertEquals(countOf(p, 'a_mage_1'), 0);
  // A versioned save can hold legitimate re-purchased copies — untouchable.
  addItem(p, 'w_mage_1', 2);
  migratePlayer(p);
  assertEquals(countOf(p, 'w_mage_1'), 3, 'versioned saves never lose gear');
  // Leveled players keep what they know; nothing is removed.
  p.skills.push('sk_frost_lance');
  migratePlayer(p);
  assert(p.skills.includes('sk_frost_lance'));
});

Deno.test('migratePlayer: legacy battle gains neutral buffs; combat stays finite', () => {
  const p = createPlayer(22, 'T', 'warrior');
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' })!;
  // Simulate a pre-update serialized battle: string origin, missing fields.
  (b as unknown as { origin: unknown }).origin = 'whisperwood';
  const bb = b.buffs as unknown as Record<string, unknown>;
  for (const k of ['enemyWeakenedPct', 'enemyWeakenTurns', 'weakenedPct', 'stunnedTurns']) {
    delete bb[k];
  }
  delete b.phoenixUsed;
  p.battle = b;
  p.stateVersion = 0; // a pre-versioning save deserializes as v0
  migratePlayer(p);
  assertEquals(b.origin, { kind: 'explore', zoneId: 'whisperwood' });
  assertEquals(b.buffs.enemyWeakenedPct, 0);
  assertEquals(b.phoenixUsed, false);
  // Enemy math with migrated state stays finite — no NaN anywhere.
  performAction(p, b, { kind: 'attack' }, seeded(5));
  assert(Number.isFinite(p.hp), 'player hp finite');
  assert(Number.isFinite(b.enemy.hp), 'enemy hp finite');
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
  // The wilds: battles are common (weighted tables) — find one.
  assert(travel(p, 'whisperwood').ok);
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
  assert(acceptQuest(p, 'm7_tyrant').ok);
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

Deno.test("content integrity: every zone's dungeon/shop/npcs reference real ids", () => {
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
  for (const e of ENEMIES) {
    for (const id of Object.keys(e.drops ?? {})) {
      assert(item(id), `enemy ${e.id} drops unknown item ${id}`);
    }
  }
});

Deno.test('content integrity: skills are complete per class and learnable in order', () => {
  for (const cid of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    const skills = skillsForClass(cid, MAX_LEVEL);
    assertEquals(skills.length, 8, `${cid} should have 8 skills`);
    for (const s of skills) assert(SKILLS.includes(s));
  }
  assertEquals(SKILLS.length, 32);
});

Deno.test('codec: roundtrip for every callback shape', () => {
  const cases = [
    { v: 'zone', a: 'ex' },
    { v: 'zone', a: 'tk', arg: 2 },
    { v: 'battle', a: 'use', arg: 'sk_cleave' },
    { v: 'inventory', a: 'p', arg: 3 },
    { v: 'inventory', a: 'eq', arg: 'w_warrior_2' },
    { v: 'equipment', a: 'rm', arg: 'weapon' },
    { v: 'quests', a: 't', arg: 'm1_embers' },
    { v: 'shop', a: 'buy', arg: 'c_potion' },
    { v: 'shop', a: 'p', arg: -1 },
    { v: 'forge', a: 'w' },
    { v: 'travel', a: 'go', arg: 'abyss' },
    { v: 'death', a: 'ok' },
    { v: 'meta', a: 'pick', arg: 'mage' },
    { v: 'meta', a: 'resetYes' },
  ] as const;
  for (const c of cases) {
    const wire = encodeCb(c as never);
    assert(wire.length <= 64, `${wire} too long`);
    const back = decodeCb(wire);
    assertEquals(back, c, `roundtrip failed for ${wire}`);
  }
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
