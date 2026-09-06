import { assert, assertEquals, assertThrows } from '@std/assert';
import { ZONES } from '../src/content/zones.ts';
import { applyDeath, createPlayer, grantXp } from '../src/engine/character.ts';
import { performAction } from '../src/engine/combat.ts';
import { assertResolvablePersistedIds } from '../src/engine/validate.ts';
import {
  abandonDungeon,
  arriveAt,
  diveDungeon,
  explore,
  nextDungeonFloor,
  resolveVictory,
} from '../src/engine/world.ts';

const z = ZONES.find((z) => z.dungeon)!;
const d = z.dungeon!;
function hero() {
  const p = createPlayer(1, 'Tester', 'warrior');
  p.tutorial = 'done';
  p.currentZone = z.id;
  p.level = 45;
  p.hp = 20;
  p.mp = 3;
  if (d.bossGate) p.quests[d.bossGate.quest] = { status: 'done', counts: [] };
  return p;
}

Deno.test('dungeon runs restart at floor one after leaving and keep floor caches one-time', () => {
  const p = hero();
  const first = diveDungeon(p, d, () => 0);
  assert(first.battle);
  first.battle.phase = 'won';
  first.battle.enemy.hp = 0;
  resolveVictory(p, first.battle, () => 0.99);
  assertEquals(nextDungeonFloor(p, d), 2);
  assertEquals(p.hp, 20);
  assert(abandonDungeon(p).ok);
  assertEquals(nextDungeonFloor(p, d), 1);
  const replay = diveDungeon(p, d, () => 0);
  assert(replay.battle);
  const lines = resolveVictory(p, replay.battle, () => 0.99);
  assert(!lines.some((line) => line.includes('Floor cache')));
  assertEquals(nextDungeonFloor(p, d), 2);
});

Deno.test('dungeon discovery advances without recovery and boss completion ends run', () => {
  const p = hero();
  for (let floor = 1; floor <= d.floors.length + 1; floor++) {
    const result = diveDungeon(p, d, () => 0);
    assert(result.ok, result.lines.join('\n'));
    if (result.battle) {
      result.battle.phase = 'won';
      result.battle.enemy.hp = 0;
      resolveVictory(p, result.battle, () => 0.99);
    } else {
      assert(d.floors[floor - 1].discovery);
      assertEquals(p.hp, 20);
      assertEquals(p.mp, 3);
    }
  }
  assertEquals(p.dungeonRun, undefined);
  assertEquals(nextDungeonFloor(p, d), 1);
  assertEquals(diveDungeon(p, d, () => 0).battle?.origin.kind, 'dungeon');
  assertEquals(p.dungeonRun?.nextFloor, 1);
});

Deno.test('dungeon authorities refuse remote entry, live battle, travel and outside recovery', () => {
  const p = hero();
  const other = ZONES.find((other) => other.dungeon && other.id !== z.id)!.dungeon!;
  const before = JSON.stringify(p);
  assert(!diveDungeon(p, other).ok);
  assertEquals(JSON.stringify(p), before);
  const result = diveDungeon(p, d, () => 0);
  p.battle = result.battle;
  const active = JSON.stringify(p);
  assert(!diveDungeon(p, d).ok);
  assert(!abandonDungeon(p).ok);
  arriveAt(p, 'emberdawn');
  explore(p);
  assertEquals(JSON.stringify(p), active);
});

Deno.test('dungeon flee and defeat discard run at combat terminal resolution', () => {
  for (const death of [false, true]) {
    const p = hero();
    const result = diveDungeon(p, d, () => 0);
    assert(result.battle);
    if (death) p.hp = 0;
    const outcome = performAction(
      p,
      result.battle,
      death ? { kind: 'attack' } : { kind: 'flee' },
      () => 0,
    );
    assertEquals(outcome.outcome, death ? 'defeat' : 'fled');
    assertEquals(p.dungeonRun, undefined);
  }
  const p = hero();
  diveDungeon(p, d);
  applyDeath(p);
  assertEquals(p.dungeonRun, undefined);
});

Deno.test('dungeon state survives JSON and refuses invalid persisted run identities and floors', () => {
  const p = hero();
  const result = diveDungeon(p, d, () => 0);
  p.battle = result.battle;
  assertResolvablePersistedIds(JSON.parse(JSON.stringify(p)));
  for (
    const patch of [{ zoneId: 'missing' }, { dungeonId: 'missing' }, { nextFloor: 0 }, {
      nextFloor: 99,
    }]
  ) {
    const corrupt = structuredClone(p);
    Object.assign(corrupt.dungeonRun!, patch);
    assertThrows(() => assertResolvablePersistedIds(corrupt));
  }
});

Deno.test('level gains during a descent improve stats without refilling resources', () => {
  const p = hero();
  p.level = 1;
  diveDungeon(p, d, () => 0);
  const hp = p.hp;
  const mp = p.mp;
  grantXp(p, 500);
  assert(p.level > 1);
  assertEquals(p.hp, hp);
  assertEquals(p.mp, mp);
});

Deno.test('locked boss permits preliminary rooms but refusing the gate cannot advance the run', () => {
  const p = hero();
  if (!d.bossGate) return;
  delete p.quests[d.bossGate.quest];
  for (let floor = 1; floor <= d.floors.length; floor++) {
    const result = diveDungeon(p, d, () => 0);
    assert(result.ok);
    if (result.battle) resolveVictory(p, result.battle, () => 0.99);
  }
  const before = JSON.stringify(p);
  assert(!diveDungeon(p, d).ok);
  assertEquals(JSON.stringify(p), before);
  assert(abandonDungeon(p).ok);
  assertEquals(nextDungeonFloor(p, d), 1);
});

Deno.test('won floor save resumes next room and corrupt reward flags refuse without repair', () => {
  const p = hero();
  const result = diveDungeon(p, d, () => 0);
  assert(result.battle);
  p.battle = result.battle;
  p.battle.phase = 'won';
  resolveVictory(p, p.battle, () => 0.99);
  const restored = JSON.parse(JSON.stringify(p));
  assertResolvablePersistedIds(restored);
  const missingRun = structuredClone(restored);
  delete missingRun.dungeonRun;
  assertThrows(() => assertResolvablePersistedIds(missingRun));
  delete restored.battle;
  assertEquals(nextDungeonFloor(restored, d), 2);
  assert(diveDungeon(restored, d, () => 0).ok);
  p.flags.dgn_unknown_cache_1 = true;
  const before = JSON.stringify(p);
  assertThrows(() => assertResolvablePersistedIds(p));
  assertEquals(JSON.stringify(p), before);
});

Deno.test('dungeon identity gate binds enemies and boss classification to authored combat floors', () => {
  const p = hero();
  p.battle = diveDungeon(p, d, () => 0).battle;
  assert(p.battle);
  assert(p.battle.origin.kind === 'dungeon');
  const cases = [structuredClone(p), structuredClone(p), structuredClone(p), structuredClone(p)];
  const falseBoss = cases[0].battle!;
  assert(falseBoss.origin.kind === 'dungeon');
  falseBoss.origin.boss = true;
  falseBoss.enemy.isBoss = true;
  cases[1].battle!.enemy.id = d.boss;
  cases[2].battle!.enemy.isBoss = true;
  const discovery = d.floors.findIndex((floor) => floor.discovery) + 1;
  assert(discovery > 0);
  cases[3].dungeonRun!.nextFloor = discovery;
  const discoveryOrigin = cases[3].battle!.origin;
  assert(discoveryOrigin.kind === 'dungeon');
  discoveryOrigin.floor = discovery;
  for (const corrupt of cases) {
    const before = JSON.stringify(corrupt);
    assertThrows(() => assertResolvablePersistedIds(corrupt));
    assertEquals(JSON.stringify(corrupt), before);
  }
  const boss = hero();
  boss.dungeonRun = { zoneId: z.id, dungeonId: d.id, nextFloor: d.floors.length + 1 };
  boss.battle = diveDungeon(boss, d, () => 0).battle;
  assert(boss.battle);
  assertResolvablePersistedIds(boss);
  const bossOrigin = boss.battle.origin;
  assert(bossOrigin.kind === 'dungeon');
  bossOrigin.boss = false;
  boss.battle.enemy.isBoss = false;
  assertThrows(() => assertResolvablePersistedIds(boss));
});
