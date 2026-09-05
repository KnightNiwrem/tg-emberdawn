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
  const q = quest('m4_blessing')!;
  const original = q.rewards.unlockZones;
  assert(original);
  assertEquals(
    original,
    ['hollowmere', 'mirefoot'],
    'the regional reward includes both destinations',
  );
  q.rewards.unlockZones = [...original, 'hollowmere', 'emberdawn'];
  try {
    for (const alreadyVisited of [false, true]) {
      const p = createPlayer(1750, 'Traveler', 'warrior');
      p.level = q.level;
      p.quests['m3_roots'] = { status: 'done', counts: [1] };
      if (alreadyVisited) p.unlockedZones.push('hollowmere');
      const before = [...p.unlockedZones];
      addItem(p, 'm_ember_shard', 6);
      syncAvailability(p);
      assert(acceptQuest(p, q.id, q.startNpc).ok);
      const result = turnInQuest(p, q.id, q.finishNpc);
      assert(result.ok);
      const granted = alreadyVisited ? ['mirefoot'] : ['hollowmere', 'mirefoot'];
      assertEquals(p.unlockedZones, [...before, ...granted]);
      assertEquals(
        unlockNotices(result.lines),
        granted.map((id) => `🗺️ New area unlocked: ${zone(id)!.name}`),
      );
      assert(!turnInQuest(p, q.id, q.finishNpc).ok, 'completed quests do not grant again');
      assertEquals(p.unlockedZones, [...before, ...granted]);
    }
  } finally {
    q.rewards.unlockZones = original;
  }
});

Deno.test('dungeon first-clear rewards: all zone entries resolve once in authored order', () => {
  const d = zone('whisperwood')!.dungeon!;
  const original = d.firstClear;
  d.firstClear = {
    ...original!,
    unlockZones: ['hollowmere', 'mirefoot', 'hollowmere', 'emberdawn'],
  };
  try {
    const p = createPlayer(1751, 'Traveler', 'warrior');
    p.level = 45;
    const before = [...p.unlockedZones];
    const win = (): string[] => {
      const b = startBattle(d.boss, {
        kind: 'dungeon',
        zoneId: 'whisperwood',
        dungeonId: d.id,
        floor: d.floors.length + 1,
        boss: true,
      }, { player: p, rng: seeded(1751) })!.battle;
      b.enemy.hp = 0;
      return resolveVictory(p, b, seeded(1752));
    };
    assertEquals(
      unlockNotices(win()),
      ['hollowmere', 'mirefoot'].map((id) => `🗺️ New area unlocked: ${zone(id)!.name}`),
    );
    assertEquals(p.unlockedZones, [...before, 'hollowmere', 'mirefoot']);
    assertEquals(unlockNotices(win()), [], 'a boss rematch does not repeat first-clear unlocks');
    assertEquals(p.unlockedZones, [...before, 'hollowmere', 'mirefoot']);
  } finally {
    d.firstClear = original;
  }
});
