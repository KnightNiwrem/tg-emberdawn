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

const zoneDef = ZONES.find((zoneDef) => zoneDef.dungeon)!;
const dungeon = zoneDef.dungeon!;
function hero() {
  const player = createPlayer(1, 'Tester', 'warrior');
  player.tutorial = 'done';
  player.currentZone = zoneDef.id;
  player.level = 45;
  player.hp = 20;
  player.mp = 3;
  if (dungeon.bossGate) player.quests[dungeon.bossGate.quest] = { status: 'done', counts: [] };
  return player;
}

Deno.test('dungeon runs restart at floor one after leaving and keep floor caches one-time', () => {
  const player = hero();
  const first = diveDungeon(player, dungeon, () => 0);
  assert(first.battle);
  first.battle.phase = 'won';
  first.battle.enemy.hp = 0;
  resolveVictory(player, first.battle, () => 0.99);
  assertEquals(nextDungeonFloor(player, dungeon), 2);
  assertEquals(player.hp, 20);
  assert(abandonDungeon(player).ok);
  assertEquals(nextDungeonFloor(player, dungeon), 1);
  const replay = diveDungeon(player, dungeon, () => 0);
  assert(replay.battle);
  const lines = resolveVictory(player, replay.battle, () => 0.99);
  assert(!lines.some((line) => line.includes('Floor cache')));
  assertEquals(nextDungeonFloor(player, dungeon), 2);
});

Deno.test('dungeon discovery advances without recovery and boss completion ends run', () => {
  const player = hero();
  for (let floor = 1; floor <= dungeon.floors.length + 1; floor++) {
    const result = diveDungeon(player, dungeon, () => 0);
    assert(result.ok, result.lines.join('\n'));
    if (result.battle) {
      result.battle.phase = 'won';
      result.battle.enemy.hp = 0;
      resolveVictory(player, result.battle, () => 0.99);
    } else {
      assert(dungeon.floors[floor - 1].discovery);
      assertEquals(player.hp, 20);
      assertEquals(player.mp, 3);
    }
  }
  assertEquals(player.dungeonRun, undefined);
  assertEquals(nextDungeonFloor(player, dungeon), 1);
  assertEquals(diveDungeon(player, dungeon, () => 0).battle?.origin.kind, 'dungeon');
  assertEquals(player.dungeonRun?.nextFloor, 1);
});

Deno.test('dungeon authorities refuse remote entry, live battle, travel and outside recovery', () => {
  const player = hero();
  const other = ZONES.find((other) => other.dungeon && other.id !== zoneDef.id)!.dungeon!;
  const before = JSON.stringify(player);
  assert(!diveDungeon(player, other).ok);
  assertEquals(JSON.stringify(player), before);
  const result = diveDungeon(player, dungeon, () => 0);
  player.battle = result.battle;
  const active = JSON.stringify(player);
  assert(!diveDungeon(player, dungeon).ok);
  assert(!abandonDungeon(player).ok);
  arriveAt(player, 'emberdawn');
  explore(player);
  assertEquals(JSON.stringify(player), active);
});

Deno.test('dungeon flee and defeat discard run at combat terminal resolution', () => {
  for (const death of [false, true]) {
    const player = hero();
    const result = diveDungeon(player, dungeon, () => 0);
    assert(result.battle);
    if (death) player.hp = 0;
    const outcome = performAction(
      player,
      result.battle,
      death ? { kind: 'attack' } : { kind: 'flee' },
      () => 0,
    );
    assertEquals(outcome.outcome, death ? 'defeat' : 'fled');
    assertEquals(player.dungeonRun, undefined);
  }
  const player = hero();
  diveDungeon(player, dungeon);
  applyDeath(player);
  assertEquals(player.dungeonRun, undefined);
});

Deno.test('dungeon state survives JSON and refuses invalid persisted run identities and floors', () => {
  const player = hero();
  const result = diveDungeon(player, dungeon, () => 0);
  player.battle = result.battle;
  assertResolvablePersistedIds(JSON.parse(JSON.stringify(player)));
  for (
    const patch of [{ zoneId: 'missing' }, { dungeonId: 'missing' }, { nextFloor: 0 }, {
      nextFloor: 99,
    }]
  ) {
    const corrupt = structuredClone(player);
    Object.assign(corrupt.dungeonRun!, patch);
    assertThrows(() => assertResolvablePersistedIds(corrupt));
  }
});

Deno.test('level gains during a descent improve stats without refilling resources', () => {
  const player = hero();
  player.level = 1;
  diveDungeon(player, dungeon, () => 0);
  const hp = player.hp;
  const mp = player.mp;
  grantXp(player, 500);
  assert(player.level > 1);
  assertEquals(player.hp, hp);
  assertEquals(player.mp, mp);
});

Deno.test('locked boss permits preliminary rooms but refusing the gate cannot advance the run', () => {
  const player = hero();
  if (!dungeon.bossGate) return;
  delete player.quests[dungeon.bossGate.quest];
  for (let floor = 1; floor <= dungeon.floors.length; floor++) {
    const result = diveDungeon(player, dungeon, () => 0);
    assert(result.ok);
    if (result.battle) resolveVictory(player, result.battle, () => 0.99);
  }
  const before = JSON.stringify(player);
  assert(!diveDungeon(player, dungeon).ok);
  assertEquals(JSON.stringify(player), before);
  assert(abandonDungeon(player).ok);
  assertEquals(nextDungeonFloor(player, dungeon), 1);
});

Deno.test('won floor save resumes next room and corrupt reward flags refuse without repair', () => {
  const player = hero();
  const result = diveDungeon(player, dungeon, () => 0);
  assert(result.battle);
  player.battle = result.battle;
  player.battle.phase = 'won';
  resolveVictory(player, player.battle, () => 0.99);
  const restored = JSON.parse(JSON.stringify(player));
  assertResolvablePersistedIds(restored);
  const missingRun = structuredClone(restored);
  delete missingRun.dungeonRun;
  assertThrows(() => assertResolvablePersistedIds(missingRun));
  delete restored.battle;
  assertEquals(nextDungeonFloor(restored, dungeon), 2);
  assert(diveDungeon(restored, dungeon, () => 0).ok);
  player.flags.dgn_unknown_cache_1 = true;
  const before = JSON.stringify(player);
  assertThrows(() => assertResolvablePersistedIds(player));
  assertEquals(JSON.stringify(player), before);
});

Deno.test('dungeon identity gate binds enemies and boss classification to authored combat floors', () => {
  const player = hero();
  player.battle = diveDungeon(player, dungeon, () => 0).battle;
  assert(player.battle);
  assert(player.battle.origin.kind === 'dungeon');
  const cases = [
    structuredClone(player),
    structuredClone(player),
    structuredClone(player),
    structuredClone(player),
  ];
  const falseBoss = cases[0].battle!;
  assert(falseBoss.origin.kind === 'dungeon');
  falseBoss.origin.boss = true;
  falseBoss.enemy.isBoss = true;
  cases[1].battle!.enemy.id = dungeon.boss;
  cases[2].battle!.enemy.isBoss = true;
  const discovery = dungeon.floors.findIndex((floor) => floor.discovery) + 1;
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
  boss.dungeonRun = {
    zoneId: zoneDef.id,
    dungeonId: dungeon.id,
    nextFloor: dungeon.floors.length + 1,
  };
  boss.battle = diveDungeon(boss, dungeon, () => 0).battle;
  assert(boss.battle);
  assertResolvablePersistedIds(boss);
  const bossOrigin = boss.battle.origin;
  assert(bossOrigin.kind === 'dungeon');
  bossOrigin.boss = false;
  boss.battle.enemy.isBoss = false;
  assertThrows(() => assertResolvablePersistedIds(boss));
});
