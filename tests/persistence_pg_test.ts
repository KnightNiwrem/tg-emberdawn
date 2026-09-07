/**
 * PgStore round-trip against a REAL Postgres.
 * Skipped unless TEST_PG_URL is set:
 *   TEST_PG_URL=postgresql://user:pass@host:5432/db deno task test:pg
 * CI runs it via a postgres service container; locally, one command
 * provisions a throwaway container, runs the suite, and tears it down:
 *   deno task test:pg:local
 */

import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import {
  assertSupportedSaveVersion,
  createPlayer,
  CURRENT_STATE_VERSION,
  SaveTooOldError,
} from '../src/engine/character.ts';
import { PgStore } from '../src/persistence/store.ts';
import { assertResolvablePersistedIds } from '../src/engine/validate.ts';
import { startBattle } from '../src/engine/combat.ts';
import { zone } from '../src/content/zones.ts';
import { route } from '../src/content/routes.ts';

const url = Deno.env.get('TEST_PG_URL');

Deno.test('PgStore: ensure schema + set/get/delete round-trip', { ignore: !url }, async () => {
  const store = await PgStore.open(url);
  try {
    // PlayerState is plain JSON → JSONB must round-trip losslessly.
    const player = createPlayer(424242, 'PgTest', 'warrior');
    player.flags.gather_whisperwood = 3;
    player.flags.gatherReset_whisperwood = 1_800_000_000_000;
    player.inventory.push({ id: 'm_pickaxe', qty: 1 }, { id: 'm_worm_bait', qty: 5 });
    player.hp = 3;
    player.gold = 12345;
    player.notices = ['the dawn you seek is still ahead'];
    player.quests = { m1_embers: { status: 'done', counts: [3] } };

    // An active journey + its paused travel battle (#159): the whole
    // nested shape — snapshotted plan, progress, provenance — must survive
    // JSONB and re-pass the persisted-identity gate on the way out.
    player.currentZone = 'whisperwood';
    player.unlockedZones.push('hollowmere');
    player.journey = {
      edgeId: 'w_whisperwood_hollowmere',
      variantId: 'base',
      fromZone: 'whisperwood',
      toZone: 'hollowmere',
      completedEvents: 1,
      totalEvents: 2,
      plan: route('w_whisperwood_hollowmere')!.events!,
      report: ['Flat water, still air.'],
    };
    player.battle = startBattle('e_boglin', {
      kind: 'travel',
      zoneId: 'whisperwood',
      edgeId: 'w_whisperwood_hollowmere',
      eventIndex: 1,
    }, { player, rng: () => 0.5 })!.battle;

    await store.set(player.userId, player);
    assertEquals(await store.get(player.userId), player);
    assertResolvablePersistedIds((await store.get(player.userId))!);

    // An active uninterrupted dungeon run survives JSONB and its identity gate.
    const delver = createPlayer(2070, 'Delver', 'warrior');
    delver.currentZone = 'whisperwood';
    delver.hp = 17;
    delver.mp = 2;
    delver.dungeonRun = {
      zoneId: 'whisperwood',
      dungeonId: zone('whisperwood')!.dungeon!.id,
      nextFloor: 1,
    };
    delver.scene = { view: 'zone' };
    await store.set(delver.userId, delver);
    const continued = (await store.get(delver.userId))!;
    assertEquals(continued, delver);
    assertResolvablePersistedIds(continued);
    await store.delete(delver.userId);

    // upsert overwrites
    player.gold = 1;
    await store.set(player.userId, player);
    assertEquals((await store.get(player.userId))?.gold, 1);

    // miss + delete paths
    assertEquals(await store.get(-1), undefined);
    await store.delete(player.userId);
    assertEquals(await store.get(player.userId), undefined);

    // #187: an inspected shop item and its return page survive JSONB;
    // the optional selection must re-pass the persisted-identity gate.
    const shopper = createPlayer(1873, 'Shopper', 'warrior');
    shopper.scene = {
      view: 'shop',
      mode: 'buy',
      page: 1,
      itemId: 'c_minor_potion',
      reference: { kind: 'sources', page: 1 },
    };
    await store.withLock(shopper.userId, () => store.set(shopper.userId, shopper));
    const restored = (await store.get(shopper.userId))!;
    assertEquals(restored, shopper);
    assertResolvablePersistedIds(restored);
    shopper.scene = {
      view: 'shop',
      mode: 'buy',
      page: 1,
      itemId: 'm_worm_bait',
      reference: { kind: 'uses', page: 1 },
    };
    await store.withLock(shopper.userId, () => store.set(shopper.userId, shopper));
    const usesRestored = (await store.get(shopper.userId))!;
    assertEquals(usesRestored, shopper);
    assertResolvablePersistedIds(usesRestored);
    shopper.scene = {
      view: 'item',
      itemId: 'c_minor_potion',
      returnTo: { kind: 'inventory', page: 2 },
      reference: { kind: 'uses', page: 1 },
    };
    await store.set(shopper.userId, shopper);
    assertEquals(await store.get(shopper.userId), shopper);
    assertResolvablePersistedIds((await store.get(shopper.userId))!);
    shopper.scene = { view: 'travel', confirmEdgeId: 'w_whisperwood_hollowmere' };
    await store.set(shopper.userId, shopper);
    assertEquals(await store.get(shopper.userId), shopper);
    assertResolvablePersistedIds((await store.get(shopper.userId))!);
    await store.delete(shopper.userId);

    // #191: the current campaign's quest objects survive JSONB; storing an
    // older checkpoint never stamps it current or repairs its payload.
    const carrier = createPlayer(1910, 'Carrier', 'rogue');
    carrier.currentZone = 'whisperwood';
    carrier.flags.forage_emberdawn = 3;
    carrier.flags.forageReset_emberdawn = 1000;
    carrier.flags.forage_mirefoot = 3;
    carrier.flags.forageReset_mirefoot = 2000;
    carrier.quests.sq_locket = { status: 'turnIn', counts: [1] };
    carrier.inventory.push({ id: 'q_pells_locket', qty: 1 }, { id: 'q_wisp_lantern', qty: 1 });
    carrier.scene = { view: 'dialogue', dialogueId: 'dlg_sq_locket_turnin', nodeId: 'ta' };
    await store.set(carrier.userId, carrier);
    const current = (await store.get(carrier.userId))!;
    assertEquals(current, carrier);
    assertEquals(current.stateVersion, CURRENT_STATE_VERSION);
    assertSupportedSaveVersion(current);
    assertResolvablePersistedIds(current);
    carrier.stateVersion = CURRENT_STATE_VERSION - 1;
    await store.set(carrier.userId, carrier);
    const retired = (await store.get(carrier.userId))!;
    assertThrows(() => assertSupportedSaveVersion(retired), SaveTooOldError);
    assertEquals(
      await store.get(carrier.userId),
      carrier,
      'refusal leaves the stored JSON untouched',
    );
    await store.delete(carrier.userId);

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
      await new Promise((resolve) => setTimeout(resolve, 20)); // widen the race window
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
    const sectionCount = 6; // more sections than clients — queued ones must also finish
    const store = await PgStore.open(url, { max: MAX });
    try {
      const users = Array.from({ length: sectionCount }, (_, i) => 5000 + i);
      for (const userId of users) {
        const player = createPlayer(userId, `U${userId}`, 'warrior');
        player.gold = 0;
        await store.set(userId, player);
      }
      let entered = 0;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => (release = resolve));
      const work = (userId: number) =>
        store.withLock(userId, async () => {
          entered++;
          if (entered === MAX) release(); // all runnable holders are in
          await barrier;
          // With every runnable holder pinned to a client, this get/set
          // MUST run on that same client — never on a starved pool.
          const player = (await store.get(userId))!;
          player.gold += 1;
          await store.set(userId, player);
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
      for (const userId of users) {
        assertEquals((await store.get(userId))?.gold, 1, `user ${userId} updated`);
      }
    } finally {
      await store.close();
    }
  },
);

Deno.test(
  'PgStore: same-user sections serialize across two store instances, no lost writes (#18, #37)',
  { ignore: !url },
  async () => {
    const firstStore = await PgStore.open(url);
    const secondStore = await PgStore.open(url);
    try {
      const seed = createPlayer(7000, 'X', 'warrior');
      seed.gold = 20;
      await firstStore.set(7000, seed);
      const earn = (store: PgStore, delta: number) =>
        store.withLock(7000, async () => {
          const cur = (await store.get(7000))!;
          await new Promise((resolve) => setTimeout(resolve, 20)); // widen the race window
          cur.gold += delta;
          await store.set(7000, cur);
        });
      await Promise.all([earn(firstStore, 10), earn(secondStore, 20)]);
      assertEquals((await firstStore.get(7000))?.gold, 50, 'both cross-instance updates survive');
    } finally {
      await firstStore.close();
      await secondStore.close();
    }
  },
);

Deno.test(
  'PgStore: a failed section rolls back atomically and never leaks the advisory lock (#37)',
  { ignore: !url },
  async () => {
    const store = await PgStore.open(url);
    try {
      const player = createPlayer(6000, 'Err', 'warrior');
      player.gold = 0;
      await store.set(6000, player);
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
