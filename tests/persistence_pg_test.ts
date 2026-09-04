/**
 * PgStore round-trip against a REAL Postgres.
 * Skipped unless TEST_PG_URL is set:
 *   TEST_PG_URL=postgresql://user:pass@host:5432/db deno task test:pg
 * CI runs it via a postgres service container; locally, one command
 * provisions a throwaway container, runs the suite, and tears it down:
 *   deno task test:pg:local
 */

import { assert, assertEquals, assertRejects } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { PgStore } from '../src/persistence/store.ts';
import { assertResolvablePersistedIds } from '../src/engine/validate.ts';
import { startBattle } from '../src/engine/combat.ts';
import { route } from '../src/content/routes.ts';

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

    // An active journey + its paused travel battle (#159): the whole
    // nested shape — snapshotted plan, progress, provenance — must survive
    // JSONB and re-pass the persisted-identity gate on the way out.
    p.currentZone = 'whisperwood';
    p.unlockedZones.push('hollowmere');
    p.journey = {
      edgeId: 'w_whisperwood_hollowmere',
      variantId: 'base',
      fromZone: 'whisperwood',
      toZone: 'hollowmere',
      completedEvents: 1,
      totalEvents: 2,
      plan: route('w_whisperwood_hollowmere')!.events!,
      report: ['Flat water, still air.'],
    };
    p.battle = startBattle('e_boglin', {
      kind: 'travel',
      zoneId: 'whisperwood',
      edgeId: 'w_whisperwood_hollowmere',
      eventIndex: 1,
    }, { player: p, rng: () => 0.5 })!.battle;

    await store.set(p.userId, p);
    assertEquals(await store.get(p.userId), p);
    assertResolvablePersistedIds((await store.get(p.userId))!);

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

Deno.test(
  'PgStore: pool.max concurrent distinct-user updates never starve (#37)',
  { ignore: !url },
  async () => {
    // A tiny pool: every client is precious. The barrier lets pool.max lock
    // holders enter BEFORE any of them performs its first state query — the
    // pre-#37 code deadlocked exactly here: each holder pinned a client and
    // then waited for `pool.query` on a pool with zero free clients.
    const MAX = 2;
    const N = 6; // more sections than clients — queued ones must also finish
    const store = await PgStore.open(url, { max: MAX });
    try {
      const users = Array.from({ length: N }, (_, i) => 5000 + i);
      for (const u of users) {
        const p = createPlayer(u, `U${u}`, 'warrior');
        p.gold = 0;
        await store.set(u, p);
      }
      let entered = 0;
      let release!: () => void;
      const barrier = new Promise<void>((r) => (release = r));
      const work = (u: number) =>
        store.withLock(u, async () => {
          entered++;
          if (entered === MAX) release(); // all runnable holders are in
          await barrier;
          // With every runnable holder pinned to a client, this get/set
          // MUST run on that same client — never on a starved pool.
          const p = (await store.get(u))!;
          p.gold += 1;
          await store.set(u, p);
        });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(users.map(work)),
          new Promise<never>((_, rej) => {
            timer = setTimeout(
              () => rej(new Error('pool starvation: lock sections never completed')),
              15_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      for (const u of users) assertEquals((await store.get(u))?.gold, 1, `user ${u} updated`);
    } finally {
      await store.close();
    }
  },
);

Deno.test(
  'PgStore: same-user sections serialize across two store instances, no lost writes (#18, #37)',
  { ignore: !url },
  async () => {
    const a = await PgStore.open(url);
    const b = await PgStore.open(url);
    try {
      const seed = createPlayer(7000, 'X', 'warrior');
      seed.gold = 20;
      await a.set(7000, seed);
      const earn = (store: PgStore, delta: number) =>
        store.withLock(7000, async () => {
          const cur = (await store.get(7000))!;
          await new Promise((r) => setTimeout(r, 20)); // widen the race window
          cur.gold += delta;
          await store.set(7000, cur);
        });
      await Promise.all([earn(a, 10), earn(b, 20)]);
      assertEquals((await a.get(7000))?.gold, 50, 'both cross-instance updates survive');
    } finally {
      await a.close();
      await b.close();
    }
  },
);

Deno.test(
  'PgStore: a failed section rolls back atomically and never leaks the advisory lock (#37)',
  { ignore: !url },
  async () => {
    const store = await PgStore.open(url);
    try {
      const p = createPlayer(6000, 'Err', 'warrior');
      p.gold = 0;
      await store.set(6000, p);
      // fn throws AFTER its save: the transaction must undo the write and
      // end without the lock — nothing half-applied, nothing leaked.
      await assertRejects(() =>
        store.withLock(6000, async () => {
          const cur = (await store.get(6000))!;
          cur.gold += 5;
          await store.set(6000, cur);
          throw new Error('boom after save');
        })
      );
      assertEquals((await store.get(6000))?.gold, 0, 'failed section rolled back');
      // The lock is gone: a follow-up section on the same user acquires
      // promptly (a leaked session lock would hang here forever).
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const gold = await Promise.race([
          store.withLock(6000, async () => (await store.get(6000))!.gold),
          new Promise<never>((_, rej) => {
            timer = setTimeout(() => rej(new Error('advisory lock leaked')), 5000);
          }),
        ]);
        assertEquals(gold, 0);
      } finally {
        clearTimeout(timer);
      }
    } finally {
      await store.close();
    }
  },
);
