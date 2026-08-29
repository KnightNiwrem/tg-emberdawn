/**
 * PgStore round-trip against a REAL Postgres.
 * Skipped unless TEST_PG_URL is set:
 *   TEST_PG_URL=postgresql://user:pass@host:5432/db deno task test:pg
 * CI runs it via a postgres service container.
 */

import { assertEquals } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { PgStore } from '../src/persistence/store.ts';

const url = Deno.env.get('TEST_PG_URL');

Deno.test('PgStore: ensure schema + set/get/delete round-trip', { ignore: !url }, async () => {
  const store = await PgStore.open(url);
  try {
    // PlayerState is plain JSON → JSONB must round-trip losslessly.
    const p = createPlayer(424242, 'PgTest', 'warrior');
    p.hp = 3;
    p.gold = 12345;
    p.notices = ['the dawn you seek is still ahead'];
    p.quests = { m1_embers: { status: 'done', counts: [3] } };

    await store.set(p.userId, p);
    assertEquals(await store.get(p.userId), p);

    // upsert overwrites
    p.gold = 1;
    await store.set(p.userId, p);
    assertEquals((await store.get(p.userId))?.gold, 1);

    // miss + delete paths
    assertEquals(await store.get(-1), undefined);
    await store.delete(p.userId);
    assertEquals(await store.get(p.userId), undefined);
  } finally {
    await store.close();
  }
});
