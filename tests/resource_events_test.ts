import { assert, assertEquals } from '@std/assert';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import { applyQuietEvent } from '../src/engine/event_rewards.ts';
import { explore } from '../src/engine/world.ts';

Deno.test('haven forage deadlines expire independently across visits', () => {
  const player = createPlayer(228, 'Forager', 'warrior');
  const hour = 3_600_000;
  for (let attempt = 0; attempt < 3; attempt++) explore(player, () => 0, 0);
  player.currentZone = 'mirefoot';
  for (let attempt = 0; attempt < 3; attempt++) explore(player, () => 0, hour);
  assertEquals(player.flags.forageReset_emberdawn, 6 * hour);
  assertEquals(player.flags.forageReset_mirefoot, 7 * hour);

  player.currentZone = 'emberdawn';
  explore(player, () => 0, 6 * hour);
  assertEquals(player.flags.forage_emberdawn, 1);
  assertEquals(player.flags.forageReset_emberdawn, undefined);
  assertEquals(player.flags.forageReset_mirefoot, 7 * hour);

  player.currentZone = 'mirefoot';
  explore(player, () => 0, 6 * hour);
  assertEquals(player.flags.forage_mirefoot, 3, 'revisiting does not recharge early');
  explore(player, () => 0, 7 * hour);
  assertEquals(player.flags.forage_mirefoot, 1, 'its own deadline still recharges');
  assertEquals(player.flags.forage_emberdawn, 1, 'the other haven remains unchanged');
});

Deno.test('quiet rests disclose applied recovery at full, partial, and low pools', () => {
  for (const missing of [0, 2, 30]) {
    const player = createPlayer(229, 'Resting', 'warrior');
    const stats = statsOf(player);
    player.hp = stats.maxHp - missing;
    player.mp = stats.maxMp - missing;
    const beforeHp = player.hp;
    const beforeMp = player.mp;
    const result = applyQuietEvent(player, {
      kind: 'rest',
      weight: 1,
      healPct: 0.2,
      text: 'A sheltered bank.',
    }, () => {
      throw new Error('Rest must not draw randomness');
    });
    const expectedHp = missing === 0 ? 0 : missing === 2 ? 2 : 13;
    const expectedMp = missing === 0 ? 0 : missing === 2 ? 2 : 6;
    assertEquals(player.hp - beforeHp, expectedHp);
    assertEquals(player.mp - beforeMp, expectedMp);
    assert(result.lines.includes(`💚 +${expectedHp} HP · 💧 +${expectedMp} MP`));
  }
});
