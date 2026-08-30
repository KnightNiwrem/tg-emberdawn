/** Repair-pass-2 regressions (FINDINGS.md second review): /start neutrality,
 * meta-callback safety, save migration, engine authority checks, quest
 * delivery invariants, pool clamping, shop boundaries, forage cooldown. */

import { assert, assertEquals } from '@std/assert';
import { prepareBot } from 'grammy-testing';
import type { Context } from 'grammy';
import { createBot } from '../src/bot.ts';
import { MemoryStore, type PlayerStore } from '../src/persistence/store.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { itemAction } from '../src/handlers/battle.ts';
import {
  clampPools,
  createPlayer,
  CURRENT_STATE_VERSION,
  grantXp,
  migratePlayer,
  statsOf,
} from '../src/engine/character.ts';
import { MAX_LEVEL } from '../src/engine/classes.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { addItem, countOf, removeItem } from '../src/engine/inventory.ts';
import { grantItem, onItemGain, turnInQuest } from '../src/engine/quests.ts';
import { tierForLevel } from '../src/engine/shops.ts';
import { explore, travel } from '../src/engine/world.ts';
import { QUESTS } from '../src/content/quests.ts';
import type { PlayerState } from '../src/engine/types.ts';

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

/** Minimal grammy Context stand-in: edits succeed, sends return a fresh id. */
function fakeCtx(userId: number, tapped?: number, data?: string): Context {
  return {
    from: { id: userId, first_name: 'T' },
    chat: { id: userId },
    callbackQuery: tapped === undefined
      ? undefined
      : { data: data ?? 'i:bk', message: { message_id: tapped } },
    answerCallbackQuery: () => Promise.resolve(),
    api: {
      editMessageText: () => Promise.resolve(),
      sendRichMessage: () => Promise.resolve({ message_id: 424242 }),
    },
  } as unknown as Context;
}

// ── /start is pure re-centering (P0-2) ───────────────────────────────────

Deno.test('/start re-centers without touching gameplay state', async () => {
  const store = new MemoryStore();
  const bot = createBot({ token: '123456:TEST-TOKEN-FOR-TESTS', store });
  const { chats } = await prepareBot(bot);
  const user = chats.newUser({ id: 5150, first_name: 'V' });
  await user.sendCommand('/start');
  await user.sendCallbackQuery('m:pk:warrior');
  const p0 = (await store.get(5150))!;
  p0.unlockedZones.push('whisperwood');
  p0.currentZone = 'whisperwood';
  p0.gold = 777;
  p0.battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' })!;
  await store.set(5150, p0);

  await user.sendCommand('/start');
  const p1 = (await store.get(5150))!;
  assert(p1.battle, 'battle preserved');
  assertEquals(p1.battle!.enemy.id, 'e_wolf');
  assertEquals(p1.battle!.phase, 'active');
  assertEquals(p1.gold, 777, 'no gold penalty');
  assertEquals(p1.stats.deaths, 0, 'no death counted');
  assertEquals(p1.currentZone, 'whisperwood', 'no forced travel');

  // A won battle awaiting Continue also survives.
  p1.battle!.phase = 'won';
  await store.set(5150, p1);
  await user.sendCommand('/start');
  assertEquals((await store.get(5150))!.battle?.phase, 'won');
});

// ── meta callbacks obey staleness + existing-character guard (P0-5) ──────

Deno.test('stale class picker cannot overwrite an existing character', async () => {
  const store = new MemoryStore();
  const bot = createBot({ token: '123456:TEST-TOKEN-FOR-TESTS', store });
  const { chats } = await prepareBot(bot);
  const user = chats.newUser({ id: 5151, first_name: 'W' });
  await user.sendCommand('/start');
  await user.sendCallbackQuery('m:pk:mage');
  const before = (await store.get(5151))!;
  assertEquals(before.classId, 'mage');

  // A stale/forged picker tap must be refused outright.
  await user.sendCallbackQuery('m:pk:warrior');
  const after = await store.get(5151);
  assertEquals(after!.classId, 'mage', 'existing character untouched');
  assertEquals(after!.level, 1);
  assertEquals(after!.hp, before.hp);
});

Deno.test('newer-message adoption survives clone-on-read stores (P0-7)', async () => {
  // Clone-on-read reproduces Postgres: every get() returns fresh JSON.
  const backing = new Map<number, PlayerState>();
  const store: PlayerStore = {
    get: (id) => Promise.resolve(backing.has(id) ? structuredClone(backing.get(id)!) : undefined),
    set: (id, s) => {
      backing.set(id, structuredClone(s));
      return Promise.resolve();
    },
    delete: (id) => {
      backing.delete(id);
      return Promise.resolve();
    },
  };
  const p = createPlayer(900, 'T', 'warrior');
  p.messageId = 100;
  await store.set(900, p);

  // Tap lands on a copy NEWER than our pointer → adopted as live, persisted.
  await handleCallback(fakeCtx(900, 101), store);
  const after = await store.get(900);
  assertEquals(after?.messageId, 101, 'adoption must persist through the save');
});

// ── save migration (P0-3 / P0-4) ─────────────────────────────────────────

Deno.test('migratePlayer: legacy battle gains neutral buffs; combat stays finite', () => {
  const p = createPlayer(901, 'T', 'warrior');
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' })!;
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
  performAction(p, b, { kind: 'attack' }, seeded(9));
  assert(Number.isFinite(p.hp), 'player hp finite');
  assert(Number.isFinite(b.enemy.hp), 'enemy hp finite');
});

Deno.test('stateVersion stamps fresh saves', () => {
  const p = createPlayer(902, 'T', 'rogue');
  migratePlayer(p);
  assertEquals(p.stateVersion, CURRENT_STATE_VERSION);
});

// ── engine authority (P1-4 / P1-5 / P1-6) ────────────────────────────────

Deno.test('equip verifies ownership; stale double-tap fails cleanly', () => {
  const p = createPlayer(903, 'T', 'warrior');
  p.level = 7;
  addItem(p, 'w_warrior_2', 1);
  const r1 = itemAction(p, 'eq', 'w_warrior_2');
  assertEquals(r1.toast, undefined);
  assertEquals(p.equipment.weapon, 'w_warrior_2');
  assertEquals(countOf(p, 'w_warrior_2'), 0);
  const r2 = itemAction(p, 'eq', 'w_warrior_2');
  assertEquals(r2.toast, "You don't have that.", 'second tap must not re-equip');
  assert(!p.inventory.some((e) => e.id === 'w_warrior_2'));
  assertEquals(p.equipment.weapon, 'w_warrior_2', 'original equip stays');
});

Deno.test('combat refuses unlearned and wrong-class skills', () => {
  const rng = seeded(11);
  const p = createPlayer(904, 'T', 'warrior');
  const b = startBattle('e_rat', { kind: 'explore', zoneId: 'emberfall' })!;
  const hp0 = b.enemy.hp;
  const r1 = performAction(p, b, { kind: 'skill', skillId: 'sk_cataclysm' }, rng);
  assert(r1.lines.some((l) => l.includes("haven't learned")), 'wrong class refused');
  assertEquals(b.enemy.hp, hp0, 'no enemy phase on a forged tap');
  assertEquals(b.round, 1, 'no turn consumed');
  const r2 = performAction(p, b, { kind: 'skill', skillId: 'sk_executioner' }, rng);
  assert(r2.lines.some((l) => l.includes("haven't learned")), 'unlearned same-class refused');
  assertEquals(b.round, 1);
});

Deno.test('pools clamp to derived maxima after equipment changes', () => {
  const p = createPlayer(905, 'T', 'warrior');
  p.hp = statsOf(p).maxHp + 500;
  p.mp = statsOf(p).maxMp + 500;
  clampPools(p);
  assertEquals(p.hp, statsOf(p).maxHp);
  assertEquals(p.mp, statsOf(p).maxMp);
});

// ── quest delivery invariants (P1-1) ─────────────────────────────────────

Deno.test('collect turn-in revalidates goods atomically at the counter', () => {
  const q = QUESTS.find((x) => x.objectives.length === 1 && x.objectives[0]!.kind === 'collect')!;
  const obj = q.objectives[0]!;
  const need = obj.count ?? 1;
  const p = createPlayer(906, 'T', 'warrior');
  p.quests[q.id] = { status: 'turnIn', counts: [need] };

  // Goods spent after the quest readied → turn-in refused, quest reverts.
  addItem(p, obj.target, need);
  removeItem(p, obj.target, need);
  const res = turnInQuest(p, q.id);
  assertEquals(res.ok, false);
  assertEquals(p.quests[q.id]!.status, 'active', 'quest stays open');

  // Goods back in the bag: re-acquisition flips the quest ready again
  // (the same path a purchase/drop uses), then the counter accepts.
  addItem(p, obj.target, need);
  assertEquals(onItemGain(p).includes(q.id), true, 're-ready via item gain');
  const res2 = turnInQuest(p, q.id);
  assertEquals(res2.ok, true);
  assertEquals(countOf(p, obj.target), 0, 'goods are handed over');
});

Deno.test('quests sharing materials cannot both turn in beyond supply', () => {
  const qs = QUESTS.filter((x) =>
    x.objectives.some((o) => o.kind === 'collect' && o.target === 'm_ember_shard')
  );
  assert(qs.length >= 2, 'fixture: at least two ember-shard quests');
  const [qa, qb] = qs;
  const needA = qa!.objectives.find((o) => o.target === 'm_ember_shard')!.count ?? 1;
  const needB = qb!.objectives.find((o) => o.target === 'm_ember_shard')!.count ?? 1;
  const p = createPlayer(907, 'T', 'warrior');
  p.quests[qa!.id] = { status: 'turnIn', counts: qa!.objectives.map(() => 0) };
  p.quests[qb!.id] = { status: 'turnIn', counts: qb!.objectives.map(() => 0) };
  // Enough for exactly ONE quest's worth of shards.
  addItem(p, 'm_ember_shard', Math.max(needA, needB));
  const ra = turnInQuest(p, qa!.id);
  assertEquals(ra.ok, true);
  const left = countOf(p, 'm_ember_shard');
  const rb = turnInQuest(p, qb!.id);
  if (left < needB) {
    assertEquals(rb.ok, false, 'second quest must not complete without goods');
    assertEquals(p.quests[qb!.id]!.status, 'active');
  } else {
    assertEquals(rb.ok, true);
  }
});

Deno.test('grantItem centralizes acquisition → collect readiness', () => {
  const q = QUESTS.find((x) => x.objectives.length === 1 && x.objectives[0]!.kind === 'collect')!;
  const obj = q.objectives[0]!;
  const need = obj.count ?? 1;
  assert(need >= 2, 'fixture: multi-count collect quest');
  const p = createPlayer(908, 'T', 'warrior');
  p.quests[q.id] = { status: 'active', counts: [0] };
  for (let i = 0; i < need - 1; i++) grantItem(p, obj.target, 1);
  assertEquals(p.quests[q.id]!.status, 'active', 'not ready below the threshold');
  grantItem(p, obj.target, 1); // the final item, from ANY source
  assertEquals(p.quests[q.id]!.status, 'turnIn', 'final grant readies the quest');
});

// ── economy & pacing ─────────────────────────────────────────────────────

Deno.test('shop tier unlocks exactly when gear becomes equippable', () => {
  assertEquals(tierForLevel(1), 1);
  assertEquals(tierForLevel(6), 1);
  assertEquals(tierForLevel(7), 2);
  assertEquals(tierForLevel(12), 2);
  assertEquals(tierForLevel(13), 3);
  assertEquals(tierForLevel(43), 8);
  assertEquals(tierForLevel(45), 8);
});

Deno.test('postgame XP converts to gold instead of vanishing', () => {
  const p = createPlayer(909, 'T', 'warrior');
  p.level = MAX_LEVEL;
  p.gold = 0;
  const lines = grantXp(p, 1000);
  assert(p.gold > 0, 'valor pays out');
  assert(lines[0]!.includes('gold'));
  assertEquals(p.xp, 0);
});

Deno.test('safe-haven forage ignores free travel until its cooldown', () => {
  const p = createPlayer(910, 'T', 'mage');
  p.flags['forage_emberfall'] = 3; // exhausted
  p.flags['forageResetAt'] = Date.now() + 3_600_000; // still recharging
  const gold0 = p.gold;
  const inv0 = structuredClone(p.inventory);
  // Free-travel loop: away and back, over and over.
  for (let i = 0; i < 3; i++) {
    assert(travel(p, 'whisperwood').ok);
    assert(travel(p, 'emberfall').ok);
  }
  for (let i = 0; i < 60; i++) explore(p, seeded(13));
  assertEquals(p.gold, gold0, 'exhausted haven yields no gold');
  assertEquals(p.inventory, inv0, 'exhausted haven yields no items');
  // Cooldown expiry restores the faucet (one rng across the loop so the
  // weighted draw actually varies between explores).
  p.flags['forageResetAt'] = Date.now() - 1;
  const rng2 = seeded(15);
  let restored = false;
  for (let i = 0; i < 40 && !restored; i++) {
    const o = explore(p, rng2);
    if (o.kind === 'result' && o.lines.some((l) => l.includes('Found') || l.startsWith('💰'))) {
      restored = true;
    }
  }
  assert(restored, 'cooldown expiry resets the faucet');
});
