/**
 * PgStore round-trip against a REAL Postgres.
 * Skipped unless TEST_PG_URL is set:
 *   TEST_PG_URL=postgresql://user:pass@host:5432/db deno task test:pg
 * CI runs it via a postgres service container.
 */

import { assert, assertEquals } from '@std/assert';
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

    // ── cross-instance serialization (#18) ────────────────────────────────
    // Two concurrent withLock sections must NOT interleave: a passthrough
    // (broken) lock would let both bodies run before either finishes —
    // events would interleave and one +gold update would be lost.
    const events: string[] = [];
    const seed = createPlayer(424243, 'Locks', 'warrior');
    seed.gold = 20; // 20 + 10 + 20 = 50 when BOTH updates survive
    await store.set(424243, seed);
    const earn = (delta: number, tag: string) => async () => {
      events.push(`${tag}:load`);
      const cur = (await store.get(424243))!;
      await new Promise((r) => setTimeout(r, 20)); // widen the race window
      cur.gold += delta;
      await store.set(424243, cur);
      events.push(`${tag}:save`);
    };
    await Promise.all([
      store.withLock(424243, earn(10, 'A')),
      store.withLock(424243, earn(20, 'B')),
    ]);
    const seq = events.join(',');
    assert(
      seq === 'A:load,A:save,B:load,B:save' || seq === 'B:load,B:save,A:load,A:save',
      `lock sections must not interleave, got: ${seq}`,
    );
    assertEquals((await store.get(424243))?.gold, 50, 'both updates survive (20+10+20)');
  } finally {
    await store.close();
  }
});
