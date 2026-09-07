/** Ordered, deduplicated zone rewards for quests and dungeon first-clears (#175). */

import { assert, assertEquals } from '@std/assert';
import { quest } from '../src/content/quests.ts';
import { zone } from '../src/content/zones.ts';
import { createPlayer } from '../src/engine/character.ts';
import { startBattle } from '../src/engine/combat.ts';
import { addItem } from '../src/engine/inventory.ts';
import { acceptQuest, syncAvailability, turnInQuest } from '../src/engine/quests.ts';
import { resolveVictory } from '../src/engine/world.ts';
import { seeded } from './helpers.ts';

const unlockNotices = (lines: string[]): string[] =>
  lines.filter((line) => line.startsWith('🗺️ New area unlocked:'));

Deno.test('quest rewards: zone arrays preserve order and suppress existing/duplicate grants', () => {
  const questDef = quest('m4_blessing')!;
  const original = questDef.rewards.unlockZones;
  assert(original);
  assertEquals(
    original,
    ['hollowmere', 'mirefoot'],
    'the regional reward includes both destinations',
  );
  questDef.rewards.unlockZones = [...original, 'hollowmere', 'emberdawn'];
  try {
    for (const alreadyVisited of [false, true]) {
      const player = createPlayer(1750, 'Traveler', 'warrior');
      player.level = questDef.level;
      player.quests['m3_roots'] = { status: 'done', counts: [1] };
      if (alreadyVisited) player.unlockedZones.push('hollowmere');
      const before = [...player.unlockedZones];
      addItem(player, 'm_ember_shard', 6);
      syncAvailability(player);
      assert(acceptQuest(player, questDef.id, questDef.startNpc).ok);
      const result = turnInQuest(player, questDef.id, questDef.finishNpc);
      assert(result.ok);
      const granted = alreadyVisited ? ['mirefoot'] : ['hollowmere', 'mirefoot'];
      assertEquals(player.unlockedZones, [...before, ...granted]);
      assertEquals(
        unlockNotices(result.lines),
        granted.map((id) => `🗺️ New area unlocked: ${zone(id)!.name}`),
      );
      assert(
        !turnInQuest(player, questDef.id, questDef.finishNpc).ok,
        'completed quests do not grant again',
      );
      assertEquals(player.unlockedZones, [...before, ...granted]);
    }
  } finally {
    questDef.rewards.unlockZones = original;
  }
});

Deno.test('dungeon first-clear rewards: all zone entries resolve once in authored order', () => {
  const dungeon = zone('whisperwood')!.dungeon!;
  const original = dungeon.firstClear;
  dungeon.firstClear = {
    ...original!,
    unlockZones: ['hollowmere', 'mirefoot', 'hollowmere', 'emberdawn'],
  };
  try {
    const player = createPlayer(1751, 'Traveler', 'warrior');
    player.level = 45;
    const before = [...player.unlockedZones];
    const win = (): string[] => {
      player.currentZone = 'whisperwood';
      player.dungeonRun = {
        zoneId: player.currentZone,
        dungeonId: dungeon.id,
        nextFloor: dungeon.floors.length + 1,
      };
      const battle = startBattle(dungeon.boss, {
        kind: 'dungeon',
        zoneId: 'whisperwood',
        dungeonId: dungeon.id,
        floor: dungeon.floors.length + 1,
        boss: true,
      }, { player, rng: seeded(1751) })!.battle;
      battle.enemy.hp = 0;
      return resolveVictory(player, battle, seeded(1752));
    };
    assertEquals(
      unlockNotices(win()),
      ['hollowmere', 'mirefoot'].map((id) => `🗺️ New area unlocked: ${zone(id)!.name}`),
    );
    assertEquals(player.unlockedZones, [...before, 'hollowmere', 'mirefoot']);
    assertEquals(unlockNotices(win()), [], 'a boss rematch does not repeat first-clear unlocks');
    assertEquals(player.unlockedZones, [...before, 'hollowmere', 'mirefoot']);
  } finally {
    dungeon.firstClear = original;
  }
});
