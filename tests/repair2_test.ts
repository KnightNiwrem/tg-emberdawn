/** Repair-pass-2 regressions (FINDINGS.md second review): /start neutrality,
 * meta-callback safety, save migration, engine authority checks, quest
 * delivery invariants, pool clamping, shop boundaries, forage cooldown. */

import { assert, assertEquals } from '@std/assert';
import { prepareBot } from 'grammy-testing';
import type { Context } from 'grammy';
import { createBot } from '../src/bot.ts';
import { MemoryStore, type PlayerStore } from '../src/persistence/store.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { handleReset } from '../src/handlers/commands.ts';
import { withRev } from '../src/codec.ts';
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
import {
  acceptQuest,
  grantItem,
  onItemGain,
  onKill,
  syncAvailability,
  turnInQuest,
} from '../src/engine/quests.ts';
import { currentStock, tierForLevel } from '../src/engine/shops.ts';
import { explore, travel } from '../src/engine/world.ts';
import { QUESTS } from '../src/content/quests.ts';
import { item } from '../src/content/items.ts';
import { renderInventory } from '../src/render/menus.ts';
import { renderQuestDetail, renderQuests, renderResetConfirm } from '../src/render/views.ts';
import type { PlayerState } from '../src/engine/types.ts';
import { seeded } from './helpers.ts';

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
    withLock: (_id, fn) => fn(),
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
  assertEquals(p.gold, 125, 'rate pinned: ceil(xp / 8)');
  assert(lines[0]!.includes('gold'));
  assertEquals(p.xp, 0);
});

Deno.test('safe-haven forage: 3 charges, timer stamps at exhaustion, travel never helps', () => {
  const p = createPlayer(910, 'T', 'mage');
  const t0 = 1_000_000;
  // Burn the three charges.
  for (let i = 0; i < 3; i++) explore(p, seeded(13), t0 + i * 1000);
  assertEquals(p.flags['forage_emberfall'], 3);
  // The 6h recharge is stamped the MOMENT the last charge is spent (#3) —
  // not one interaction later.
  assertEquals(p.flags['forageResetAt'], t0 + 2000 + 6 * 3_600_000);
  const gold0 = p.gold;
  const inv0 = structuredClone(p.inventory);
  // Free-travel loop + explores before expiry: the faucet stays dry.
  for (let i = 0; i < 3; i++) {
    assert(travel(p, 'whisperwood').ok);
    assert(travel(p, 'emberfall').ok);
  }
  for (let i = 0; i < 60; i++) explore(p, seeded(13), t0 + 100_000);
  assertEquals(p.gold, gold0, 'exhausted haven yields no gold');
  assertEquals(p.inventory, inv0, 'exhausted haven yields no items');
  // After expiry (one rng across the loop so draws actually vary).
  const rng2 = seeded(15);
  let restored = false;
  for (let i = 0; i < 40 && !restored; i++) {
    const o = explore(p, rng2, t0 + 6 * 3_600_000 + 60_000 + i * 1000);
    if (o.kind === 'result' && o.lines.some((l) => l.includes('Found') || l.startsWith('💰'))) {
      restored = true;
    }
  }
  assert(restored, 'cooldown expiry resets the faucet');
});

Deno.test('forage: legacy exhausted save without a timer stamps from its next visit', () => {
  const p = createPlayer(911, 'T', 'mage');
  p.flags['forage_emberfall'] = 3; // pre-#3 save: no forageResetAt
  const t0 = 5_000_000;
  explore(p, seeded(17), t0);
  assertEquals(p.flags['forageResetAt'], t0 + 6 * 3_600_000);
  // And it is NOT re-stamped on subsequent visits while still charging.
  explore(p, seeded(17), t0 + 1000);
  assertEquals(p.flags['forageResetAt'], t0 + 6 * 3_600_000);
});

Deno.test('shops only stock trinkets the player can actually equip (#6)', () => {
  const p = createPlayer(35, 'T', 'mage');
  const s1 = currentStock(p);
  assert(!s1.includes('t_1'), 'Lucky Coin is level 3 — not at level 1');
  assert(!s1.includes('t_9'), 'Thorn Ring is level 5 — not at level 1');
  assert(s1.includes('w_mage_1'), 'gear tiers unchanged');
  p.level = 5;
  const s5 = currentStock(p);
  assert(s5.includes('t_1') && s5.includes('t_9'), 'Thorn Ring unlocks at its level');
  assert(!s5.includes('t_2'), 'Feather Charm is level 7');
  p.level = 7;
  assert(currentStock(p).includes('t_2'));
});

Deno.test('m25 finale rewards no equipment — t_18 already crowned the fight (#7)', () => {
  const m25 = QUESTS.find((q) => q.id === 'm25_silence')!;
  for (const id of Object.keys(m25.rewards.items ?? {})) {
    assert(item(id)!.kind !== 'trinket', `${id} would be instantly dominated by t_18`);
  }
  assert((m25.rewards.items?.m_void_fragment ?? 0) >= 3, 'forge materials keep endgame relevant');
});

Deno.test('boss first-clear trinkets are earned trophies — not sellable or droppable (#5)', () => {
  const p = createPlayer(912, 'T', 'warrior');
  grantItem(p, 't_12', 1);
  assertEquals(countOf(p, 't_12'), 1);
  assertEquals(itemAction(p, 'sell', 't_12').toast, "Can't sell that.");
  assert(itemAction(p, 'drop', 't_12').toast, 'drop must be refused');
  assertEquals(countOf(p, 't_12'), 1, 'nothing left the bag');
  // Ordinary trinkets stay disposable — the guard is not a blanket ban.
  grantItem(p, 't_1', 1);
  assertEquals(itemAction(p, 'drop', 't_1').toast, undefined);
  assertEquals(countOf(p, 't_1'), 0);
});

Deno.test('quest log keeps a ready main quest clickable — giverless m3 turns in via UI (#15)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(920, 'T', 'warrior');
  p.level = 5; // m3 requires level 3
  p.quests['m2_letter'] = { status: 'done', counts: [] };
  syncAvailability(p);
  assert(acceptQuest(p, 'm3_roots').ok);
  onKill(p, 'e_aranya'); // m3 has no giver — the log is the ONLY turn-in path
  assertEquals(p.quests['m3_roots']?.status, 'turnIn');
  p.messageId = 300; // pin the live message so both taps edit in place
  await store.set(920, p);

  // The log must keep the turnIn quest as the primary card, with a button.
  const log = JSON.stringify(renderQuests(p));
  assert(log.includes('Ready — view & turn in'), 'turnIn main stays primary');
  assert(log.includes('q:q:m3_roots'));

  // Follow ONLY buttons the UI actually renders: log → detail → turn in.
  await handleCallback(fakeCtx(920, 300, 'q:q:m3_roots'), store);
  let cur = (await store.get(920))!;
  assertEquals(cur.scene.view, 'quests');
  assertEquals(cur.scene.arg, 'm3_roots');
  const detail = JSON.stringify(renderQuestDetail(cur, 'm3_roots'));
  assert(detail.includes('🏁 Turn in'));
  assert(detail.includes('q:t:m3_roots'));

  await handleCallback(
    fakeCtx(920, 300, withRev((await store.get(920))?.uiRev ?? 0, 'q:t:m3_roots')),
    store,
  );
  cur = (await store.get(920))!;
  assertEquals(cur.quests['m3_roots'].status, 'done');
  assert(cur.gold >= 300, 'turn-in gold granted');
  assertEquals(countOf(cur, 'm_iron_chunk'), 1, 'turn-in item granted');
});

Deno.test('inventory Equipment button opens equipment; Back returns (#17)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(921, 'T', 'warrior');
  p.messageId = 400;
  p.scene = { view: 'inventory', arg: '0' };
  await store.set(921, p);

  // The rendered button must carry the OPEN action, not the back code.
  const inv = JSON.stringify(renderInventory(p, 0));
  assert(inv.includes('e:op'), 'Equipment button encodes e:op');

  await handleCallback(fakeCtx(921, 400, 'e:op'), store);
  let cur = (await store.get(921))!;
  assertEquals(cur.scene.view, 'equipment', 'Equipment opens the equipment screen');

  // Equipment's own Back still returns to the inventory — carrying the
  // revision the equipment render stamped (#16).
  await handleCallback(
    fakeCtx(921, 400, withRev((await store.get(921))?.uiRev ?? 0, 'e:bk')),
    store,
  );
  cur = (await store.get(921))!;
  assertEquals(cur.scene.view, 'inventory');
});

// ── render-revision replay guard (#16) ──────────────────────────────────

Deno.test('replayed buy callback on the same message is a no-op (#16)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(922, 'T', 'rogue');
  p.gold = 1000;
  p.messageId = 500;
  p.uiRev = 5; // a render already happened; its buttons carry rev 5
  p.scene = { view: 'shop', arg: '0' };
  await store.set(922, p);

  const staleTap = withRev(5, 'h:buy:c_minor_potion');
  await handleCallback(fakeCtx(922, 500, staleTap), store);
  let cur = (await store.get(922))!;
  assertEquals(cur.gold, 970, 'first tap buys');
  assertEquals(cur.uiRev, 6, 'the committed render bumped the revision');

  // Exact replay: same Telegram message id, revision from BEFORE the render.
  await handleCallback(fakeCtx(922, 500, staleTap), store);
  cur = (await store.get(922))!;
  assertEquals(cur.gold, 970, 'replay must not buy twice');
  assertEquals(cur.uiRev, 6);

  // A queued fresh tap (current revision) still executes normally.
  await handleCallback(fakeCtx(922, 500, withRev(6, 'h:buy:c_minor_potion')), store);
  cur = (await store.get(922))!;
  assertEquals(cur.gold, 940);
});

Deno.test('double-tapping forge cannot spend beyond the shown cost (#16)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(923, 'T', 'warrior'); // w_warrior_1 equipped
  p.gold = 5000;
  addItem(p, 'm_ember_shard', 10);
  p.messageId = 510;
  p.uiRev = 2;
  p.scene = { view: 'forge' };
  await store.set(923, p);

  const tap1 = withRev(2, 'f:w');
  await handleCallback(fakeCtx(923, 510, tap1), store);
  let cur = (await store.get(923))!;
  assertEquals(cur.flags['forge_i_w_warrior_1'], 1);
  assertEquals(cur.gold, 4800, 'first temper costs the shown 200');
  assertEquals(cur.uiRev, 3);

  await handleCallback(fakeCtx(923, 510, tap1), store); // replay
  cur = (await store.get(923))!;
  assertEquals(cur.flags['forge_i_w_warrior_1'], 1, 'no second temper');
  assertEquals(cur.gold, 4800, 'the never-shown 800g next tier was not charged');
  assertEquals(countOf(cur, 'm_ember_shard'), 9, 'no extra materials burned');
});

Deno.test('double-tapping rise-again cannot charge death twice (#16)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(924, 'T', 'warrior');
  p.gold = 1000;
  p.battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' })!;
  p.battle.phase = 'lost';
  p.scene = { view: 'death' };
  p.messageId = 520;
  p.uiRev = 4;
  await store.set(924, p);

  const tap1 = withRev(4, 'd:ok');
  await handleCallback(fakeCtx(924, 520, tap1), store);
  let cur = (await store.get(924))!;
  assertEquals(cur.stats.deaths, 1);
  assertEquals(cur.gold, 900, 'one 10% death toll');
  assertEquals(cur.scene.view, 'zone');

  await handleCallback(fakeCtx(924, 520, tap1), store); // replay
  cur = (await store.get(924))!;
  assertEquals(cur.stats.deaths, 1, 'replay must not count a second death');
  assertEquals(cur.gold, 900, 'replay must not charge a second toll');
});

// ── reset confirmation (#19) ───────────────────────────────────────────

Deno.test('/reset stages a confirmation; No preserves the whole save (#19)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(930, 'T', 'mage');
  p.level = 9;
  p.gold = 777;
  p.quests['m1_embers'] = { status: 'done', counts: [3] };
  p.messageId = 600;
  p.uiRev = 2;
  await store.set(930, p);

  await handleReset(fakeCtx(930, 600), store);
  let cur = (await store.get(930))!;
  assertEquals(cur.scene.view, 'reset', 'command stages the confirmation');
  assertEquals(cur.gold, 777, 'nothing destroyed by staging');
  assertEquals(cur.quests['m1_embers'].status, 'done');
  const stage = JSON.stringify(renderResetConfirm(cur));
  assert(stage.includes('m:ry') && stage.includes('m:rn'), 'Yes/No buttons rendered');

  // No → keep playing, save fully intact.
  await handleCallback(fakeCtx(930, 600, withRev(cur.uiRev ?? 0, 'm:rn')), store);
  cur = (await store.get(930))!;
  assertEquals(cur.scene.view, 'zone');
  assertEquals(cur.gold, 777, 'No must not touch gold');
  assertEquals(cur.quests['m1_embers'].status, 'done', 'No must not touch progress');
});

Deno.test('/reset → Yes rebuilds a fully initialized hero (#19)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(931, 'T', 'mage');
  p.level = 9;
  p.gold = 777;
  p.quests['m1_embers'] = { status: 'done', counts: [3] };
  p.messageId = 610;
  p.uiRev = 1;
  await store.set(931, p);

  await handleReset(fakeCtx(931, 610), store);
  let cur = (await store.get(931))!;
  await handleCallback(fakeCtx(931, 610, withRev(cur.uiRev ?? 0, 'm:ry')), store);
  cur = (await store.get(931))!;
  assertEquals(cur.level, 1, 'fresh hero');
  assertEquals(cur.gold, 50, 'starting purse');
  assertEquals(cur.stats.deaths, 0);
  // syncAvailability ran: the campaign is OFFERED again, not omitted — the
  // exact regression the issue described for the dormant resetYes path.
  assertEquals(cur.quests['m1_embers']?.status, 'available', 'campaign re-offered');
});

Deno.test('reach quests credit the zone you already occupy or visited (#23)', () => {
  // m5_fen (reach hollowmere) becomes available after m4 at level 9 — but
  // hollowmere unlocks at m4, so a player can legitimately be there (or
  // have been) before the quest ever exists.
  const mk = () => {
    const p = createPlayer(941, 'T', 'warrior');
    p.level = 9;
    p.quests['m4_blessing'] = { status: 'done', counts: [] };
    syncAvailability(p);
    return p;
  };

  // (1) Standing in the target when accepting: instant turn-in.
  const here = mk();
  here.unlockedZones.push('hollowmere');
  here.currentZone = 'hollowmere'; // arrived before the quest existed
  assert(acceptQuest(here, 'm5_fen').ok);
  assertEquals(here.quests['m5_fen']?.status, 'turnIn', 'already there → ready');

  // (2) Visited earlier, now elsewhere: ever-visited counts (#23 semantic).
  const visited = mk();
  visited.unlockedZones.push('hollowmere');
  assert(travel(visited, 'hollowmere').ok); // plants zone_hollowmere
  assert(travel(visited, 'emberfall').ok);
  assert(acceptQuest(visited, 'm5_fen').ok);
  assertEquals(visited.quests['m5_fen']?.status, 'turnIn', 'ever visited → ready');

  // (3) Never been there: stays active 0/1, and zone-entry progression
  // remains the authoritative trigger.
  const fresh = mk();
  fresh.unlockedZones.push('hollowmere');
  assert(acceptQuest(fresh, 'm5_fen').ok);
  assertEquals(fresh.quests['m5_fen']?.status, 'active', 'unvisited → still active');
  assertEquals(fresh.quests['m5_fen']?.counts[0], 0);
  assert(travel(fresh, 'hollowmere').ok);
  assertEquals(fresh.quests['m5_fen']?.status, 'turnIn', 'arrival completes it');
});
