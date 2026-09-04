/** Repair-pass-2 regressions: /start neutrality, meta-callback safety, the
 * save-version gate, engine authority checks, quest delivery invariants, pool
 * clamping, shop boundaries, forage cooldown. */

import { assert, assertEquals, assertThrows } from '@std/assert';
import { prepareBot } from 'grammy-testing';
import { createBot } from '../src/bot.ts';
import { MemoryStore, type PlayerStore } from '../src/persistence/store.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { handleReset, handleStart } from '../src/handlers/commands.ts';
import { INCOMPATIBLE_SAVE_REPLY } from '../src/handlers/session.ts';
import { withRev } from '../src/codec.ts';
import { battleAction, itemAction } from '../src/handlers/battle.ts';
import {
  assertSupportedSaveVersion,
  clampPools,
  createPlayer,
  CURRENT_STATE_VERSION,
  grantXp,
  SaveTooOldError,
  statsOf,
  xpToGoldAtCap,
} from '../src/engine/character.ts';
import { CLASSES, MAX_LEVEL, xpForNextLevel } from '../src/engine/classes.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { temper, temperLevel } from '../src/engine/forge.ts';
import { addItem, countOf, removeItem } from '../src/engine/inventory.ts';
import {
  acceptQuest,
  grantItem,
  levelLockedMain,
  onItemGain,
  onKill,
  onStoryEvent,
  syncAvailability,
  turnInQuest,
} from '../src/engine/quests.ts';
import { buy, resolveStock, sell } from '../src/engine/shops.ts';
import { npcAction, shopAction, zoneAction } from '../src/handlers/hub.ts';
import { npcTopics } from '../src/engine/npc.ts';
import { explore, resolveVictory, travel } from '../src/engine/world.ts';
import {
  npc,
  quest,
  questFinisher,
  QUESTS,
  questStarter,
  zoneOfNpc,
} from '../src/content/quests.ts';
import { STARTING_ZONES } from '../src/content/zones.ts';
import { isEquippable, item, ITEMS } from '../src/content/items.ts';
import {
  renderEquippedItemDetail,
  renderInventory,
  renderItemDetail,
} from '../src/render/menus.ts';
import { renderBattle, renderItemMenu } from '../src/render/battle.ts';
import { renderQuestDetail, renderQuests, renderResetConfirm } from '../src/render/views.ts';
import { CLASS_IDS } from '../src/engine/types.ts';
import type { PlayerState } from '../src/engine/types.ts';
import {
  fakeCtx,
  fakeCtxCapture,
  injectMod,
  mitigationPct,
  modRemaining,
  seeded,
  statPct,
} from './helpers.ts';

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
  p0.battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
    player: p0,
    rng: seeded(70),
  })!.battle;
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
  // The tap must carry its stamped revision to be adoptable (#43).
  await handleCallback(fakeCtx(900, 101, withRev(0, 'i:bk')), store);
  const after = await store.get(900);
  assertEquals(after?.messageId, 101, 'adoption must persist through the save');
});

Deno.test('revisionless gameplay callbacks are rejected; class picking is not (#43)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(932, 'T', 'warrior');
  p.gold = 500;
  p.messageId = 620;
  p.uiRev = 3;
  p.scene = { view: 'zone' };
  await store.set(932, p);

  // A rev-less gameplay button is obsolete wire junk — never executed.
  await handleCallback(fakeCtx(932, 620, 'z:sh'), store);
  let cur = (await store.get(932))!;
  assertEquals(cur.scene.view, 'zone', 'rev-less zone tap is rejected');
  assertEquals(cur.gold, 500, 'no mutation ran');
  assertEquals(cur.uiRev, 3, 'no render revision advanced');

  // A rev-less tap on a NEWER copy proves nothing — not adoptable either.
  await handleCallback(fakeCtx(932, 621, 'z:sh'), store);
  cur = (await store.get(932))!;
  assertEquals(cur.messageId, 620, 'rev-less newer taps are not adopted');
  assertEquals(cur.scene.view, 'zone');

  // The stamped version still works end to end.
  await handleCallback(fakeCtx(932, 620, withRev(3, 'z:sh')), store);
  cur = (await store.get(932))!;
  assertEquals(cur.scene.view, 'shop', 'stamped gameplay taps keep working');
  assertEquals(cur.uiRev, 4);
});

Deno.test('the class picker stays revisionless (#43)', async () => {
  const store = new MemoryStore();
  // m:pk is rendered before a player exists — no revision to carry.
  await handleCallback(fakeCtx(933, 630, 'm:pk:warrior'), store);
  const cur = await store.get(933);
  assert(cur, 'rev-less class pick still creates the hero');
  assertEquals(cur.classId, 'warrior');
  assertEquals(cur.scene.view, 'zone');
  assertEquals(cur.uiRev >= 1, true, 'the first committed render stamped a revision');
});

// ── save-version gate (P0-3 / P0-4 / #116) ──────────────────────────────

Deno.test('save gate: unversioned saves fail instead of being repaired (#44)', () => {
  const p = createPlayer(901, 'T', 'warrior');
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
    player: p,
    rng: seeded(90),
  })!.battle;
  p.battle = b;
  // An unversioned save is NOT interpreted as any numbered version: it stays
  // unversioned and throws (#44) — no sniffing, no stamping.
  const raw = p as unknown as Record<string, unknown>;
  delete raw.stateVersion;
  assertThrows(() => assertSupportedSaveVersion(p), SaveTooOldError);
  // The refused save is untouched — no stamping, no battle normalization.
  assertEquals(raw.stateVersion, undefined);
  assertEquals(b.origin, { kind: 'explore', zoneId: 'whisperwood' });

  // Current battles carry the full required shape from startBattle: combat
  // stays finite with no runtime backfill.
  const p2 = createPlayer(904, 'T', 'warrior');
  const b2 = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
    player: p2,
    rng: seeded(91),
  })!.battle;
  assertEquals(b2.phoenixUsed, false);
  assertEquals(mitigationPct(b2, 'enemy'), 0);
  assertEquals(b2.effectInstances, []);
  p2.battle = b2;
  performAction(p2, b2, { kind: 'attack' }, seeded(9));
  assert(Number.isFinite(p2.hp), 'player hp finite');
  assert(Number.isFinite(b2.enemy.hp), 'enemy hp finite');
});

Deno.test('stateVersion stamps fresh saves', () => {
  const p = createPlayer(902, 'T', 'rogue');
  assertSupportedSaveVersion(p);
  assertEquals(p.stateVersion, CURRENT_STATE_VERSION);
});

Deno.test('incompatible pre-launch saves: /start and callbacks refuse without writing (#116)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(940, 'T', 'warrior');
  p.gold = 555;
  p.messageId = 700;
  p.uiRev = 1;
  p.stateVersion = CURRENT_STATE_VERSION - 1; // retired development format
  await store.set(940, p);
  const storedBefore = JSON.stringify(await store.get(940));

  // /start explains the /reset path and never rewrites the save.
  const start = fakeCtxCapture(940);
  await handleStart(start.ctx, store);
  assert(
    start.sends.length + start.edits.length === 0,
    '/start must not render the game for an unloadable save',
  );
  assert(
    start.replies.some((r) => r === INCOMPATIBLE_SAVE_REPLY),
    '/start points the playtester at /reset with accurate pre-launch wording',
  );
  assert(
    INCOMPATIBLE_SAVE_REPLY.includes('pre-launch') && INCOMPATIBLE_SAVE_REPLY.includes('/reset'),
    'the shared refusal states the pre-launch schema reason and the /reset path',
  );

  // A gameplay callback on the old save is refused the same way — no
  // mutation, no render, no persistence.
  const tap = fakeCtxCapture(940, 700, withRev(1, 'z:sh'));
  await handleCallback(tap.ctx, store);
  assert(
    tap.replies.some((r) => r === INCOMPATIBLE_SAVE_REPLY),
    'the refused callback explains the /reset path with the same wording',
  );
  assertEquals(tap.edits.length + tap.sends.length, 0, 'no game render is committed');
  const after = await store.get(940);
  assertEquals(JSON.stringify(after), storedBefore, 'the stored save is untouched');
  assertEquals(after!.gold, 555, 'no mutation ran');
  assertEquals(after!.uiRev, 1, 'no render revision advanced');
});

Deno.test('/reset deletes an incompatible pre-launch save and presents the class picker (#116)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(941, 'T', 'mage');
  p.stateVersion = CURRENT_STATE_VERSION - 1; // unloadable dev save
  await store.set(941, p);

  // The explicit command is the exception (#44): no Yes/No staging is
  // possible on an unloadable save — /reset drops it and offers the picker.
  const reset = fakeCtxCapture(941);
  await handleReset(reset.ctx, store);
  assertEquals(await store.get(941), undefined, 'the unloadable save is deleted');
  assert(
    JSON.stringify(reset.sends[0]).includes('Choose who you will be'),
    'the stateless class picker is delivered',
  );

  // A fresh hero can be picked through the normal no-player path.
  await handleCallback(fakeCtx(941, 610, 'm:pk:cleric'), store);
  const fresh = (await store.get(941))!;
  assertEquals(fresh.classId, 'cleric');
  assertEquals(fresh.stateVersion, CURRENT_STATE_VERSION, 'the new save is on the current schema');
  assertEquals(fresh.tutorial, 'maren', 'the new hero enters the prologue');
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
  const b = startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, {
    player: p,
    rng,
  })!.battle;
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
  const finZone = zoneOfNpc(q.finishNpc)!.id;
  p.unlockedZones.push(finZone);
  p.currentZone = finZone; // the finisher accepts on-site (#64)
  p.quests[q.id] = { status: 'turnIn', counts: [need] };

  // Goods spent after the quest readied → turn-in refused, quest reverts.
  addItem(p, obj.target, need);
  removeItem(p, obj.target, need);
  const res = turnInQuest(p, q.id, q.finishNpc);
  assertEquals(res.ok, false);
  assertEquals(p.quests[q.id]!.status, 'active', 'quest stays open');

  // Goods back in the bag: re-acquisition flips the quest ready again
  // (the same path a purchase/drop uses), then the counter accepts.
  addItem(p, obj.target, need);
  assertEquals(onItemGain(p).includes(q.id), true, 're-ready via item gain');
  const res2 = turnInQuest(p, q.id, q.finishNpc);
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
  // Each turn-in happens at ITS finisher, on-site (#64).
  const finA = zoneOfNpc(qa!.finishNpc)!.id;
  p.unlockedZones.push(finA);
  p.currentZone = finA;
  const ra = turnInQuest(p, qa!.id, qa!.finishNpc);
  assertEquals(ra.ok, true);
  const left = countOf(p, 'm_ember_shard');
  const finB = zoneOfNpc(qb!.finishNpc)!.id;
  if (!p.unlockedZones.includes(finB)) p.unlockedZones.push(finB);
  p.currentZone = finB;
  const rb = turnInQuest(p, qb!.id, qb!.finishNpc);
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

Deno.test('gear tier law: tier t is equippable exactly from level 1+(t-1)*6', () => {
  // The economy's level math lives in the ITEMS catalog itself now (#161):
  // authored stock carries items, and isEquippable gates them by level.
  const t1 = ITEMS.find((i) => i.id === 'w_warrior_1')!;
  const t2 = ITEMS.find((i) => i.id === 'w_warrior_2')!;
  const t3 = ITEMS.find((i) => i.id === 'w_warrior_3')!;
  const t8 = ITEMS.find((i) => i.id === 'w_warrior_8')!;
  assertEquals([t1.level, t2.level, t3.level, t8.level], [1, 7, 13, 43]);
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
  assertEquals(p.flags['forage_emberdawn'], 3);
  // The 6h recharge is stamped the MOMENT the last charge is spent (#3) —
  // not one interaction later.
  assertEquals(p.flags['forageResetAt'], t0 + 2000 + 6 * 3_600_000);
  const gold0 = p.gold;
  const inv0 = structuredClone(p.inventory);
  // Free-travel loop + explores before expiry: the faucet stays dry.
  for (let i = 0; i < 3; i++) {
    assert(travel(p, 'whisperwood').ok);
    assert(travel(p, 'emberdawn').ok);
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

Deno.test('shops only stock trinkets the player can actually equip (#6)', () => {
  const p = createPlayer(35, 'T', 'mage');
  const s1 = resolveStock(p).map((o) => o.itemId);
  assert(!s1.includes('t_1'), 'Lucky Coin is level 3 — not at level 1');
  assert(!s1.includes('t_9'), 'Thorn Ring is level 5 — not at level 1');
  assert(s1.includes('w_mage_1'), 'gear tiers unchanged');
  p.level = 5;
  const s5 = resolveStock(p).map((o) => o.itemId);
  assert(s5.includes('t_1') && s5.includes('t_9'), 'Thorn Ring unlocks at its level');
  assert(!s5.includes('t_2'), 'Feather Charm is level 7');
  p.level = 7;
  assert(resolveStock(p).some((o) => o.itemId === 't_2'));
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
  // Selling happens only at a shop's counter now (#161), and earned
  // trophies refuse it there too.
  const res = sell(p, 't_12', 1);
  assert(!res.ok);
  assert(res.lines[0]!.includes("can't be sold"));
  assert(itemAction(p, 'drop', 't_12').toast, 'drop must be refused');
  assertEquals(countOf(p, 't_12'), 1, 'nothing left the bag');
  // Ordinary trinkets stay disposable — the guard is not a blanket ban.
  grantItem(p, 't_1', 1);
  assertEquals(itemAction(p, 'drop', 't_1').toast, undefined);
  assertEquals(countOf(p, 't_1'), 0);
});

Deno.test('ready main quest: the log detail refuses; the NPC interaction completes (#15, #64)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(920, 'T', 'warrior');
  p.level = 7; // m3_roots requires level 7 (#73)
  // The reworked chapter-one chain (#73): m3_roots unlocks behind m5_arms.
  for (const id of ['m1_embers', 'm2_letter', 'm3_wolves', 'm4_floors', 'm5_arms']) {
    p.quests[id] = { status: 'done', counts: [] };
  }
  syncAvailability(p);
  assert(acceptQuest(p, 'm3_roots', 'npc_bram').ok);
  onKill(p, 'e_aranya');
  assertEquals(p.quests['m3_roots']?.status, 'turnIn');
  p.messageId = 300; // pin the live message so all taps edit in place
  await store.set(920, p);

  // The log keeps the ready quest as the primary card with a View button.
  const log = JSON.stringify(renderQuests(p));
  assert(log.includes('Ready — view details'), 'turnIn main stays primary (#65 neutral label)');
  assert(log.includes('q:q:m3_roots'));

  // Log detail opens — but it is a read-only journal now (#65): no lifecycle
  // button renders and the old wire form is dead.
  await handleCallback(fakeCtx(920, 300, withRev(0, 'q:q:m3_roots')), store);
  let cur = (await store.get(920))!;
  assertEquals(cur.scene.view, 'quests');
  assertEquals(cur.scene.arg, 'm3_roots');
  const goldBefore = cur.gold;
  await handleCallback(
    fakeCtx(920, 300, withRev(cur.uiRev ?? 0, 'q:t:m3_roots')),
    store,
  );
  cur = (await store.get(920))!;
  assertEquals(cur.quests['m3_roots'].status, 'turnIn', 'the log cannot turn in');
  assertEquals(cur.gold, goldBefore, 'no rewards from the log');

  // The REAL path: back to the zone, talk to Bram (the finisher), pick the
  // ready quest's topic (#123), walk the turn-in dialogue and hand over.
  await handleCallback(fakeCtx(920, 300, withRev(cur.uiRev ?? 0, 'q:bk')), store);
  cur = (await store.get(920))!;
  await handleCallback(fakeCtx(920, 300, withRev(cur.uiRev ?? 0, 'z:tk:1')), store); // Bram
  cur = (await store.get(920))!;
  assertEquals(cur.scene.view, 'npc', 'talk opens the topic menu');
  await handleCallback(fakeCtx(920, 300, withRev(cur.uiRev ?? 0, 'npc:q:m3_roots')), store);
  cur = (await store.get(920))!;
  assertEquals(cur.scene.view, 'dialogue', 'the topic opens the turn-in dialogue');
  assertEquals(cur.scene.arg, 'dlg_m3_roots_turnin');
  await handleCallback(fakeCtx(920, 300, withRev(cur.uiRev ?? 0, 'dlg:nx:ta')), store);
  cur = (await store.get(920))!;
  await handleCallback(fakeCtx(920, 300, withRev(cur.uiRev ?? 0, 'dlg:ch:handover')), store);
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

  await handleCallback(fakeCtx(921, 400, withRev(0, 'e:op')), store);
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

// ── equipped-item inspection flow (#112) ─────────────────────────────────

Deno.test('Inventory → Equipment → Inspect equipped → Back → Equipment (#112)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(930, 'T', 'warrior');
  p.equipment.trinket = 't_15'; // triggered gear, equipped (absent from the bag)
  p.messageId = 600;
  p.uiRev = 0;
  p.scene = { view: 'inventory', arg: '2' };
  await store.set(930, p);

  // 1. Inventory → Equipment.
  await handleCallback(fakeCtx(930, 600, withRev(0, 'e:op')), store);
  let cur = (await store.get(930))!;
  assertEquals(cur.scene.view, 'equipment');

  // 2. Inspect the equipped trinket — slot-addressed, rev-stamped.
  await handleCallback(fakeCtx(930, 600, withRev(cur.uiRev ?? 0, 'e:vi:trinket')), store);
  cur = (await store.get(930))!;
  assertEquals(cur.scene.view, 'equippedItem');
  assertEquals(cur.scene.arg, 'trinket');

  // 3. The delivered view carries the exact trigger mechanics and the
  // equipped state — never a bag quantity or bag-only controls.
  const player = cur;
  const detail = JSON.stringify(renderEquippedItemDetail(player, 'trinket'));
  assert(detail.includes('⚡ Battle start'), 'the detail discloses the trigger');
  assert(detail.includes('Equipped'), 'the detail names the equipped state');
  assert(!detail.includes('Sell'), 'no bag-only Sell on the equipped copy');

  // 4. Back from the equipped detail returns to Equipment.
  await handleCallback(fakeCtx(930, 600, withRev(cur.uiRev ?? 0, 'e:op')), store);
  cur = (await store.get(930))!;
  assertEquals(cur.scene.view, 'equipment', 'Back returns to Equipment');
});

Deno.test('unequip from the equipped detail returns a copy and clears the slot (#112)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(931, 'T', 'warrior');
  p.gold = 100000;
  addItem(p, 'w_warrior_2', 1); // one copy in the bag; a SECOND copy equipped
  p.equipment.weapon = 'w_warrior_2';
  p.hp = statsOf(p).maxHp;
  p.messageId = 610;
  p.uiRev = 0;
  p.scene = { view: 'equippedItem', arg: 'weapon' };
  await store.set(931, p);
  const bagBefore = countOf(p, 'w_warrior_2');

  await handleCallback(fakeCtx(931, 610, withRev(0, 'e:rm:weapon')), store);
  const cur = (await store.get(931))!;
  assertEquals(cur.equipment.weapon, undefined, 'the slot cleared');
  assertEquals(
    countOf(cur, 'w_warrior_2'),
    bagBefore + 1,
    'exactly ONE copy returned to the bag',
  );
  assertEquals(cur.scene.view, 'equipment', 'Back on the Equipment overview');
  assert(
    cur.hp <= statsOf(cur).maxHp,
    'pools clamp after the equipment change',
  );
});

Deno.test('forged inspect/unequip taps cannot mutate a slot they do not own (#112)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(934, 'T', 'warrior');
  delete p.equipment.trinket; // nothing equipped there
  p.messageId = 620;
  p.uiRev = 0;
  p.scene = { view: 'equipment' };
  await store.set(934, p);

  // A forged SLOT TOKEN never changes the scene.
  await handleCallback(fakeCtx(934, 620, withRev(0, 'e:vi:dagger')), store);
  let cur = (await store.get(934))!;
  assertEquals(cur.scene.view, 'equipment', 'unknown slot token is a no-op');

  // Inspecting an EMPTY slot is safe: the view explains, nothing mutates.
  await handleCallback(fakeCtx(934, 620, withRev(cur.uiRev ?? 0, 'e:vi:trinket')), store);
  cur = (await store.get(934))!;
  assertEquals(cur.scene.view, 'equippedItem');
  assertEquals(cur.equipment.trinket, undefined);
  const safe = JSON.stringify(renderEquippedItemDetail(cur, 'trinket'));
  assert(safe.includes('slot is empty'), 'the safe explanatory state renders');

  // Unequipping an empty slot is a harmless no-op (existing validated path).
  await handleCallback(fakeCtx(934, 620, withRev(cur.uiRev ?? 0, 'e:rm:trinket')), store);
  cur = (await store.get(934))!;
  assertEquals(cur.equipment.trinket, undefined, 'no phantom item entered the bag');
  assertEquals(cur.scene.view, 'equipment');
});

Deno.test('Back from an inventory detail returns to the SAME page (#112)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(935, 'T', 'warrior');
  p.gold = 1000;
  addItem(p, 'c_minor_potion', 2);
  p.messageId = 630;
  p.uiRev = 0;
  p.scene = { view: 'inventory', arg: '1' };
  await store.set(935, p);

  // Tap the item on page 1 — the detail records the origin page.
  await handleCallback(fakeCtx(935, 630, withRev(0, 'i:v:c_minor_potion')), store);
  let cur = (await store.get(935))!;
  assertEquals(cur.scene.view, 'item');
  assertEquals(cur.scene.arg, 'c_minor_potion');
  assertEquals(cur.scene.arg2, '1', 'the origin page is captured');

  // The rendered Back button re-opens page 1, and tapping it does.
  assert(
    JSON.stringify(renderItemDetail(cur, 'c_minor_potion', cur.scene.arg2)).includes('i:pg:1'),
    'the Back button encodes the origin page',
  );
  await handleCallback(fakeCtx(935, 630, withRev(cur.uiRev ?? 0, 'i:pg:1')), store);
  cur = (await store.get(935))!;
  assertEquals(cur.scene.view, 'inventory');
  assertEquals(cur.scene.arg, '1', 'Back returned to the SAME page, not the zone or page 0');
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
  p.battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
    player: p,
    rng: seeded(92),
  })!.battle;
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

  await handleReset(fakeCtx(930, 600, 'i:bk'), store);
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

Deno.test('/reset → Yes deletes the save and returns to the stateless class picker (#62)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(931, 'T', 'mage');
  p.level = 9;
  p.gold = 777;
  p.quests['m1_embers'] = { status: 'done', counts: [3] };
  p.messageId = 610;
  p.uiRev = 1;
  await store.set(931, p);

  await handleReset(fakeCtx(931, 610, 'i:bk'), store);
  const staged = (await store.get(931))!;
  assertEquals(staged.gold, 777, 'staging still destroys nothing (#19)');
  const confirmRev = staged.uiRev ?? 0;

  // Confirmed Yes: the save is DELETED outright, and the class picker
  // replaces the confirmation message in place — nothing is persisted.
  const del = fakeCtxCapture(931, 610, withRev(confirmRev, 'm:ry'));
  await handleCallback(del.ctx, store);
  assertEquals(await store.get(931), undefined, 'confirmed reset deletes the save outright');
  assertEquals(del.edits.length, 1, 'picker delivered by editing the confirmation');
  assert(
    JSON.stringify(del.edits[0]).includes('Choose who you will be'),
    'the class picker is what was delivered',
  );

  // Redelivery of the same confirmation after deletion: harmless no-op.
  await handleCallback(fakeCtx(931, 610, withRev(confirmRev, 'm:ry')), store);
  assertEquals(await store.get(931), undefined, 'redelivered Yes stays a no-op');

  // /start while the picker is pending: character creation again, still
  // nothing persisted.
  const start = fakeCtxCapture(931);
  await handleStart(start.ctx, store);
  assert(
    JSON.stringify(start.sends[0]).includes('Choose who you will be'),
    '/start presents character creation',
  );
  assertEquals(await store.get(931), undefined, '/start must not persist while picking');

  // Picking a class DIFFERENT from the deleted hero builds a fresh hero
  // through the normal no-player path.
  await handleCallback(fakeCtx(931, 610, 'm:pk:warrior'), store);
  const fresh = (await store.get(931))!;
  assertEquals(fresh.classId, 'warrior', 'previous class not carried across deletion');
  assertEquals(fresh.level, 1, 'fresh hero');
  assertEquals(fresh.gold, 50, 'starting purse');
  assertEquals(fresh.stats.deaths, 0);
  // syncAvailability ran: the campaign is OFFERED again, not omitted — the
  // exact regression the issue described for the dormant resetYes path.
  assertEquals(fresh.quests['m1_embers']?.status, 'available', 'campaign re-offered');

  // An old confirmation callback can no longer touch the new hero: the
  // revision guard rejects it (the pick commit re-keyed the revision).
  await handleCallback(fakeCtx(931, 610, withRev(confirmRev, 'm:ry')), store);
  const after = (await store.get(931))!;
  assertEquals(after.classId, 'warrior', 'stale Yes must not delete the new hero');
  assertEquals(after.quests['m1_embers']?.status, 'available', 'progress untouched');
});

Deno.test('character menu 🗑️ Delete hero → Yes deletes the save too (#62)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(934, 'T', 'rogue');
  p.messageId = 640;
  p.uiRev = 3;
  await store.set(934, p);

  // The menu entry stages the SAME confirmation scene as /reset.
  await handleCallback(fakeCtx(934, 640, withRev(3, 'm:reset')), store);
  const staged = (await store.get(934))!;
  assertEquals(staged.scene.view, 'reset', 'menu entry stages the same confirmation');

  const del = fakeCtxCapture(934, 640, withRev(staged.uiRev ?? 0, 'm:ry'));
  await handleCallback(del.ctx, store);
  assertEquals(await store.get(934), undefined, 'Delete hero → Yes deletes the save');
  assertEquals(del.edits.length, 1, 'class picker replaces the confirmation');
});

Deno.test('reach quests record the journey; the starter starts, the finisher finishes (#23, #66)', () => {
  // m5_fen (reach hollowmere) STARTS with Bram in Emberdawn and FINISHES
  // with the Ferryman in Hollowmere (#66): the quest motivates the journey
  // instead of being acceptable only after arriving.
  const mk = () => {
    const p = createPlayer(941, 'T', 'warrior');
    p.level = 9;
    p.quests['m4_blessing'] = { status: 'done', counts: [] };
    syncAvailability(p);
    return p;
  };

  // (1) Accepted at the starter, target never seen: stays active 0/1, and
  // zone-entry remains the authoritative trigger.
  const fresh = mk();
  assert(acceptQuest(fresh, 'm5_fen', 'npc_bram').ok); // Bram stands in Emberdawn
  assertEquals(fresh.quests['m5_fen']?.status, 'active', 'unvisited → still active');
  assertEquals(fresh.quests['m5_fen']?.counts[0], 0);
  fresh.unlockedZones.push('hollowmere');
  assert(travel(fresh, 'hollowmere').ok);
  assertEquals(fresh.quests['m5_fen']?.status, 'turnIn', 'arrival completes it');
  // The Ferryman (finisher) stands right there — the handover is on-site.
  assert(turnInQuest(fresh, 'm5_fen', 'npc_ferryman').ok);
  assertEquals(fresh.quests['m5_fen']?.status, 'done');

  // (2) Visited earlier, back at the starter: the ever-visited flag (#23)
  // marks the objective the moment Bram hands the quest over.
  const visited = mk();
  visited.unlockedZones.push('hollowmere');
  assert(travel(visited, 'hollowmere').ok); // plants zone_hollowmere
  assert(travel(visited, 'emberdawn').ok);
  assert(acceptQuest(visited, 'm5_fen', 'npc_bram').ok);
  assertEquals(visited.quests['m5_fen']?.status, 'turnIn', 'ever visited → ready');

  // (3) Physical authority holds across the restructure (#64): the Ferryman
  // no longer starts this quest — accepting from him refuses, non-mutating.
  const wrongSite = mk();
  wrongSite.unlockedZones.push('hollowmere');
  wrongSite.currentZone = 'hollowmere';
  const refused = acceptQuest(wrongSite, 'm5_fen', 'npc_ferryman');
  assertEquals(refused.ok, false, 'the Ferryman starts nothing now');
  assert(refused.msg.includes('Bram'), `guidance names the starter: ${refused.msg}`);
  assertEquals(wrongSite.quests['m5_fen']?.status, 'available');
});

Deno.test('shop stocks only the shopping class, only immediately usable gear (#22)', () => {
  // Each authored shop, probed at a level where its higher tier would be
  // bait: the level-locked tier stays hidden, the usable one is shelved —
  // and no shelf ever shows another class's gear.
  const probes: { level: number; zoneId: string; shelved: string; bait: string }[] = [
    { level: 4, zoneId: 'emberdawn', shelved: 'w_warrior_1', bait: 'w_warrior_2' },
    { level: 9, zoneId: 'hollowmere', shelved: 'w_warrior_2', bait: 'w_warrior_3' },
    { level: 16, zoneId: 'sunspire', shelved: 'w_warrior_3', bait: 'w_warrior_4' },
    { level: 29, zoneId: 'frostpeak', shelved: 'w_warrior_5', bait: 'w_warrior_6' },
    { level: 33, zoneId: 'cinder', shelved: 'w_warrior_6', bait: 'w_warrior_7' },
  ];
  for (const cls of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    for (const probe of probes) {
      const p = createPlayer(950, 'T', cls);
      p.level = probe.level;
      p.currentZone = probe.zoneId;
      const stock = resolveStock(p).map((o) => o.itemId);
      for (const other of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
        if (other === cls) continue;
        assert(
          !stock.some((id) => id.startsWith(`w_${other}_`) || id.startsWith(`a_${other}_`)),
          `${other} gear must not sit on a ${cls}'s shelf (L${probe.level} ${probe.zoneId})`,
        );
      }
      for (const id of stock) {
        const d = item(id)!;
        if (d.kind === 'weapon' || d.kind === 'armor' || d.kind === 'trinket') {
          assertEquals(
            isEquippable(id, cls, probe.level).ok,
            true,
            `${id} must be usable at L${probe.level} in ${probe.zoneId}`,
          );
        }
      }
      // Tier pins per probe: the bait tier is gone, the usable one shelved.
      const shelvedId = probe.shelved.replace('warrior', cls);
      const baitId = probe.bait.replace('warrior', cls);
      assert(stock.includes(shelvedId), `${shelvedId} is shelved at L${probe.level}`);
      assert(!stock.includes(baitId), `${baitId} is not bait at L${probe.level}`);
    }
  }

  // The counter revalidates before charging (#22/#161): gear the shelf
  // does not offer this shopper is refused with the purse untouched.
  const mage = createPlayer(953, 'T', 'mage');
  mage.gold = 100;
  const r = buy(mage, 'w_warrior_1', 1);
  assertEquals(r.ok, false);
  assertEquals(mage.gold, 100, 'no charge on a refused sale');
});

Deno.test('temper is item-pattern mastery: reacquired copies carry the forge-work (#24)', () => {
  const p = createPlayer(960, 'T', 'warrior');
  p.level = 10;
  addItem(p, 'm_ember_shard', 30);
  p.gold = 100000;
  assert(temper(p, 'weapon').ok); // w_warrior_1, equipped at creation
  assert(temper(p, 'weapon').ok);
  assertEquals(temperLevel(p, 'weapon'), 2);
  const boostedAtk = statsOf(p).atk;

  // Dispose of the physical copy, then reacquire the same pattern. The
  // real unequip route returns the copy to the bag; mirror it here.
  p.equipment.weapon = undefined;
  addItem(p, 'w_warrior_1', 1);
  assertEquals(itemAction(p, 'drop', 'w_warrior_1').toast, undefined);
  assertEquals(countOf(p, 'w_warrior_1'), 0);
  grantItem(p, 'w_warrior_1', 1);
  assertEquals(itemAction(p, 'eq', 'w_warrior_1').toast, undefined);
  // Mastery is bound to the pattern (#24): the replacement is born +2.
  assertEquals(temperLevel(p, 'weapon'), 2);
  assertEquals(statsOf(p).atk, boostedAtk);

  // A different pattern never inherited it.
  addItem(p, 'w_warrior_2', 1);
  assertEquals(itemAction(p, 'eq', 'w_warrior_2').toast, undefined);
  assertEquals(temperLevel(p, 'weapon'), 0);
});

Deno.test('shop buy/sell surface success lines and quest readiness (#30)', () => {
  const p = createPlayer(961, 'T', 'warrior');
  p.level = 9;
  p.currentZone = 'hollowmere'; // tier ≥ 2: m_iron_chunk on the shelf
  p.gold = 5000;
  // sq_ore active at 2/3 iron: one purchase completes it (collect
  // objectives read the bag live).
  p.quests['sq_ore'] = { status: 'active', counts: [2] };
  addItem(p, 'm_iron_chunk', 2);
  const buyRes = shopAction(p, { v: 'shop', a: 'buy', arg: 'm_iron_chunk' });
  assertEquals(buyRes.toast, undefined, 'a successful buy is not a failure toast');
  assert(p.notices.some((l) => l.includes('Bought')), 'purchase confirmation surfaces');
  assert(
    p.notices.some((l) => l.includes('ready to turn in')),
    'quest readiness from the purchase is visible',
  );
  assertEquals(p.quests['sq_ore']?.status, 'turnIn');

  // Sell success surfaces too.
  const sellRes = shopAction(p, { v: 'shop', a: 'sell', arg: 'm_iron_chunk' });
  assertEquals(sellRes.toast, undefined);
  assert(p.notices.some((l) => l.includes('Sold')), 'sale confirmation surfaces');

  // Failure remains a non-mutating toast.
  const broke = createPlayer(962, 'T', 'mage');
  broke.level = 9;
  broke.currentZone = 'hollowmere';
  broke.gold = 0;
  const failRes = shopAction(broke, { v: 'shop', a: 'buy', arg: 'm_iron_chunk' });
  assertEquals(failRes.toast, '💰 Not enough gold.');
  assertEquals(broke.notices.length, 0, 'failure keeps notices untouched');
});

Deno.test('battle round lines render once — the log is authoritative (#32)', () => {
  const p = createPlayer(963, 'T', 'warrior');
  p.level = 20;
  const b =
    startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, { player: p, rng: seeded(93) })!
      .battle;
  p.battle = b;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;

  battleAction(p, { v: 'battle', a: 'atk' });
  const line = b.history.flatMap((r) => r.lines).find((l) => l.includes('Strike hits'))!;
  assert(line, 'the attack reached the structured round history');
  const rendered = JSON.stringify(renderBattle(p));
  assertEquals(
    rendered.split(line).length - 1,
    1,
    'the round line must render exactly once',
  );

  // Invalid actions (no turn consumed, never logged) keep their feedback.
  battleAction(p, { v: 'battle', a: 'use', arg: 'sk_cataclysm' });
  assert(
    p.notices.some((l) => l.includes("haven't learned")),
    'invalid-action feedback is preserved',
  );
});

Deno.test('battle button labels the class free action from engine metadata (#70)', () => {
  for (const cid of CLASS_IDS) {
    const p = createPlayer(964, 'T', cid);
    p.battle = startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, {
      player: p,
      rng: seeded(93),
    })!.battle;
    const msg = renderBattle(p);
    const labels = (msg.blocks ?? []).flatMap((b) =>
      b.type === 'buttons' ? b.buttons.map((btn) => btn.text) : []
    );
    const basic = CLASSES[cid].basicAction;
    assert(
      labels.includes(`${basic.icon} ${basic.name}`),
      `${cid} battle button must read from CLASSES metadata (${basic.icon} ${basic.name}); got: ${
        labels.join(', ')
      }`,
    );
  }
});

Deno.test('battle screen: Round 1 renders immediately, intro shown once (#67)', () => {
  const p = createPlayer(981, 'T', 'warrior');
  const b =
    startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, { player: p, rng: seeded(93) })!
      .battle;
  p.battle = b;
  p.notices = ['🐀 A wild Giant Rat appears!'];
  const rendered = JSON.stringify(renderBattle(p));
  assert(rendered.includes('⚔️ Battle · Round 1'), 'Round 1 is visible on the initial render');
  assert(!rendered.includes('blocks your path'), 'the flat intro line is gone from history');
  assertEquals(
    rendered.split('A wild Giant Rat appears!').length - 1,
    1,
    'the encounter introduction renders exactly once',
  );
  assert(rendered.includes('Your move'), 'a fresh battle opens with the move prompt');
});

Deno.test('battle screen: labelled sections with separated resource lines (#67)', () => {
  const p = createPlayer(982, 'T', 'warrior');
  const b =
    startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, { player: p, rng: seeded(93) })!
      .battle;
  p.battle = b;
  const msg = renderBattle(p);
  const rendered = JSON.stringify(msg);
  assert(rendered.includes('"ENEMY"'), 'the enemy side is labelled');
  assert(rendered.includes('YOU ·'), 'the player side is labelled with class and level');
  assert(rendered.includes('"type":"divider"'), 'combatants are separated by a divider');
  // No paragraph mixes a resource value with a bar — values and shortened
  // bars live on separate lines (#67).
  const texts: string[] = [];
  for (const blk of msg.blocks ?? []) {
    if (blk.type === 'paragraph') texts.push(String(blk.text));
  }
  for (const t of texts) {
    assert(
      !(t.includes('▰') && /\d+\/\d+/.test(t)),
      `value and bar must not share a line: ${t}`,
    );
  }
  assert(texts.some((t) => t.includes('▰')), 'bars render');
  assert(texts.some((t) => /\d+\/\d+/.test(t)), 'resource values render');
});

Deno.test('battle screen: effects rows carry identity, duration, and details (#67)', () => {
  const p = createPlayer(983, 'T', 'cleric');
  p.level = 10;
  p.skills.push('sk_blessing');
  p.mp = statsOf(p).maxMp;
  const b =
    startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, { player: p, rng: seeded(93) })!
      .battle;
  p.battle = b;
  performAction(p, b, { kind: 'skill', skillId: 'sk_blessing' }, seeded(41));
  const rendered = JSON.stringify(renderBattle(p));
  assert(rendered.includes('Effects: none'), 'the unbuffed combatant shows an empty row');
  assert(rendered.includes('🔆 Blessing'), 'effects keep their identity, not just a delta');
  // Blessing legs diverge on the cast round: DEF ticked (2 left), MAG
  // deferred (3 left). With #90 per-effect identity each leg is its own row
  // and discloses its exact duration — no merged range to misread.
  assert(rendered.includes('3 rounds remaining'), 'the deferred MAG leg discloses 3');
  assert(rendered.includes('2 rounds remaining'), 'the ticked DEF leg discloses 2');
  assert(rendered.includes('"type":"details"'), 'effects expand via a native details block');
  assert(rendered.includes('+30% MAG'), 'magnitude is shown (MAG leg, not unused ATK)');
  assert(!rendered.includes('+30% ATK'), 'the dead ATK leg is gone (#77)');
  assert(rendered.includes('fades end of round'), 'expiry round is shown');
  // Engine and display agree: one entry per covered stat key.
  assertEquals(b.effectInstances.length, 2, 'one instance per covered stat leg');
  assertEquals(modRemaining(b, 'player', 'mag'), 3, 'off-buff defers its first decay');
  assertEquals(modRemaining(b, 'player', 'def'), 2, 'def buff ticks on the cast round');
  assertEquals(statPct(b, 'player', 'atk'), 0, 'Blessing never buffs the unusable ATK stat (#77)');
});

Deno.test('battle screen: only the latest round expands; earlier rounds collapse in order (#67)', () => {
  const p = createPlayer(984, 'T', 'warrior');
  p.level = 30;
  const b =
    startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, { player: p, rng: seeded(93) })!
      .battle;
  b.enemy.maxHp = 99999;
  b.enemy.hp = 99999;
  p.battle = b;
  for (let i = 0; i < 4; i++) performAction(p, b, { kind: 'attack' }, seeded(51 + i));
  const rendered = JSON.stringify(renderBattle(p).blocks);
  assert(rendered.includes('Round 4 result'), 'the newest completed round is expanded');
  assert(
    rendered.indexOf('Round 4 result') < rendered.indexOf('Earlier battle history'),
    'the recap precedes the collapsed history',
  );
  const detStart = rendered.indexOf('"summary":"Earlier battle history"');
  const detEnd = rendered.indexOf('"type":"buttons"', detStart);
  assert(detStart > 0 && detEnd > detStart, 'the history block is a collapsed details block');
  const det = rendered.slice(detStart, detEnd);
  assert(det.includes('Round 1') && det.includes('Round 3'), 'earlier rounds are present');
  assert(!det.includes('Round 4'), 'the newest round is NOT collapsed');
  const i1 = det.indexOf('Round 1');
  const i2 = det.indexOf('Round 2');
  const i3 = det.indexOf('Round 3');
  assert(i1 < i2 && i2 < i3, 'earlier rounds read oldest-to-newest');
});

Deno.test('battle history truncation keeps complete rounds and discloses omission (#67)', () => {
  const p = createPlayer(985, 'T', 'warrior');
  const b =
    startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, { player: p, rng: seeded(93) })!
      .battle;
  b.enemy.maxHp = 99999;
  b.enemy.hp = 99999;
  p.battle = b;
  b.history = Array.from({ length: 12 }, (_, i) => ({
    round: i + 1,
    lines: [`r${i + 1}-a`, `r${i + 1}-b`],
  }));
  const rendered = JSON.stringify(renderBattle(p).blocks);
  assert(rendered.includes('… 1 earlier round omitted.'), 'omission is explicitly disclosed');
  assert(!rendered.includes('r1-a'), 'the omitted round is gone entirely');
  for (let r = 2; r <= 12; r++) {
    assert(
      rendered.includes(`r${r}-a`) && rendered.includes(`r${r}-b`),
      `round ${r} renders COMPLETE — never split mid-round`,
    );
  }
  assert(rendered.includes('Round 12 result'), 'the newest round stays expanded');
});

Deno.test('victory screen orders recap, outcome, spoils, and history — no duplicates (#67)', () => {
  const p = createPlayer(986, 'T', 'warrior');
  p.level = 20;
  const b =
    startBattle('e_rat', { kind: 'explore', zoneId: 'emberdawn' }, { player: p, rng: seeded(93) })!
      .battle;
  b.enemy.maxHp = 99999;
  b.enemy.hp = 99999;
  p.battle = b;
  // One warm-up round so the victory screen has BOTH a final round and
  // collapsed earlier history to order.
  performAction(p, b, { kind: 'attack' }, seeded(61));
  assertEquals(b.round, 2);
  b.enemy.hp = 1; // one clean killing blow
  battleAction(p, { v: 'battle', a: 'atk' });
  assertEquals(b.phase, 'won');
  const rendered = JSON.stringify(renderBattle(p).blocks);
  const iV = rendered.indexOf('🏆 Victory · 2 rounds');
  const iR = rendered.indexOf('Round 2 result');
  const iD = rendered.indexOf('is defeated');
  const iS = rendered.indexOf('Spoils');
  const iH = rendered.indexOf('Earlier battle history');
  assert(iV >= 0, 'the victory heading carries the round count');
  assert(iR > iV, 'the final-round recap follows the heading');
  assert(iD > iR, 'the defeat outcome follows the recap');
  assert(iS > iD, 'one authoritative Spoils line follows the outcome');
  assert(iH > iS, 'collapsed history follows the spoils');
  // The collapsed history holds the earlier round, complete and ordered.
  const det = rendered.slice(iH, rendered.indexOf('"type":"buttons"', iH));
  assert(det.includes('Round 1'), 'the earlier round is collapsed');
  assert(!det.includes('Round 2'), 'the terminal round is NOT collapsed');
  // Duplicate suppression (#67): rewards appear ONLY as Spoils.
  assertEquals(rendered.split('Spoils').length - 1, 1, 'exactly one Spoils presentation');
  assert(!rendered.includes('💰 +'), 'no XP/gold headline repeated in the outcome lines');
  // The terminal round is regular history.
  assertEquals(b.history.length, 2, 'every consumed round was recorded');
  assertEquals(b.history[1].round, 2);
});

Deno.test('quest log names the level-locked next quest during grind gaps (#33)', () => {
  // Level gap: the chapter-one chain is done, level 8 → m5_fen (req 9) is
  // story-unlocked but locked. (Partial chains keep an 'available' card on
  // the log and never reach the gap branch.)
  const p = createPlayer(964, 'T', 'warrior');
  p.level = 8;
  for (
    const id of [
      'm1_embers',
      'm2_letter',
      'm3_wolves',
      'm4_floors',
      'm5_arms',
      'm3_roots',
      'm4_blessing',
    ]
  ) {
    p.quests[id] = { status: 'done', counts: [] };
  }
  syncAvailability(p);
  const log = JSON.stringify(renderQuests(p));
  assert(log.includes('Into the Fen'), 'the next quest is named');
  assert(log.includes('Requires level 9'), 'the requirement is shown');
  assert(log.includes('you are 8'), 'the current level is shown');
  assert(!log.includes('q:a:m5_fen'), 'no accept path for a locked quest');

  // Story still gated: with m21 live, m22 is never revealed.
  const mid = createPlayer(966, 'T', 'warrior');
  mid.level = 45;
  for (
    const id of [
      'm1_embers',
      'm2_letter',
      'm3_roots',
      'm4_blessing',
      'm5_fen',
      'm6_toxin',
      'm7_tyrant',
      'm8_passage',
      'm9_spire',
      'm10_cult',
      'm11_toll',
      'm12_chronolich',
      'm13_pass',
      'm14_emblem',
      'm15_wyrm',
      'm16_ashes',
      'm17_plea',
      'm18_sigil',
      'm19_ignivar',
      'm20_seam',
    ]
  ) {
    mid.quests[id] = { status: 'done', counts: [] };
  }
  mid.quests['m21_loyalty'] = { status: 'active', counts: [3] };
  assertEquals(levelLockedMain(mid), undefined, 'm22 stays hidden while m21 is live');
  const midLog = JSON.stringify(renderQuests(mid));
  assert(!midLog.includes('The Unlocked Door'), 'm22 is not named');
  assert(midLog.includes('Give Them Rest'), 'the live main stays the primary card');

  // Campaign complete: the log says so instead of dangling a fake target.
  const done = createPlayer(967, 'T', 'warrior');
  done.level = 45;
  for (const q of QUESTS.filter((x) => x.main)) done.quests[q.id] = { status: 'done', counts: [] };
  const doneLog = JSON.stringify(renderQuests(done));
  assert(doneLog.includes('story is complete'), 'post-campaign message');
});

Deno.test('level-45 rewards show the conversion; level-44 stays nominal (#36)', () => {
  const p44 = createPlayer(968, 'T', 'warrior');
  p44.level = 44;
  const b44 = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' }, {
    player: p44,
    rng: seeded(94),
  })!.battle;
  b44.enemy.hp = 0;
  const r44 = resolveVictory(p44, b44, seeded(91));
  // Battle rewards no longer repeat inside the resolution lines (#67): the
  // staged record is the single source, rendered once as Spoils.
  assertEquals(b44.rewards!.xpConvertedGold, undefined, 'pre-cap grant stays nominal');
  assert(b44.rewards!.xp > 0, 'pre-cap grant stages XP');
  assert(!r44.some((l) => l.includes('converts your valor')), 'no conversion line at 44');

  const p45 = createPlayer(969, 'T', 'warrior');
  p45.level = 45;
  const b45 = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' }, {
    player: p45,
    rng: seeded(95),
  })!.battle;
  b45.enemy.hp = 0;
  resolveVictory(p45, b45, seeded(92));
  assertEquals(
    b45.rewards!.xpConvertedGold,
    xpToGoldAtCap(b45.rewards!.xp),
    'cap grant stages the conversion',
  );

  // Quest turn-in at cap explains the conversion too.
  const pq = createPlayer(970, 'T', 'warrior');
  pq.level = 45;
  pq.quests['sq_rats'] = { status: 'turnIn', counts: [6] };
  const tq = turnInQuest(pq, 'sq_rats', 'npc_lyra'); // Lyra offers and accepts it (#64)
  assertEquals(tq.ok, true);
  assert(tq.lines.some((l) => l.includes('XP → +')), 'turn-in shows the conversion');

  // Spoils renderer: converted at cap, nominal pre-cap.
  b45.phase = 'won';
  pq.battle = b45;
  assert(JSON.stringify(renderBattle(pq)).includes('→ +'), 'spoils show converted gold at cap');
  b44.phase = 'won';
  p44.battle = b44;
  assert(!JSON.stringify(renderBattle(p44)).includes('→ +'), 'spoils stay nominal pre-cap');
});

Deno.test('44→45 victory never advertises unawarded conversion gold (#40)', () => {
  // One XP short of the summit: the kill itself reaches level 45, but the
  // reward was granted pre-cap — nominal XP spoils, no phantom gold.
  const p = createPlayer(973, 'T', 'warrior');
  p.level = 44;
  p.xp = xpForNextLevel(44) - 1;
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' }, {
    player: p,
    rng: seeded(96),
  })!.battle;
  b.enemy.hp = 0;
  const goldBefore = p.gold;
  const lines = resolveVictory(p, b, seeded(93));
  assertEquals(p.level, 45, 'the kill itself reaches the summit');
  assert(!lines.some((l) => l.includes('→')), 'headline claims no conversion');
  assertEquals(b.rewards!.xpConvertedGold, undefined, 'no conversion stamped pre-grant');
  assertEquals(p.gold, goldBefore + b.rewards!.gold, 'no conversion gold was granted');
  b.phase = 'won';
  p.battle = b;
  const spoils = JSON.stringify(renderBattle(p));
  assert(!spoils.includes('→ +'), '44→45 spoils must not show unawarded gold');

  // A victory begun at the cap shows exactly the gold actually granted.
  const p45 = createPlayer(974, 'T', 'warrior');
  p45.level = 45;
  const b45 = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' }, {
    player: p45,
    rng: seeded(97),
  })!.battle;
  b45.enemy.hp = 0;
  const g45 = p45.gold;
  resolveVictory(p45, b45, seeded(94));
  const converted = xpToGoldAtCap(b45.rewards!.xp);
  assertEquals(b45.rewards!.xpConvertedGold, converted, 'grant outcome stamped');
  assertEquals(p45.gold, g45 + b45.rewards!.gold + converted, 'conversion actually paid');
  b45.phase = 'won';
  p45.battle = b45;
  assert(
    JSON.stringify(renderBattle(p45)).includes(`XP → +${converted} gold`),
    'spoils match the granted conversion',
  );
});

Deno.test('every level-cap reward surface shows the conversion (#42)', () => {
  // Quest detail preview: nominal pre-cap, converted at the summit.
  const pre = createPlayer(977, 'T', 'warrior');
  pre.level = 44;
  const preDetail = JSON.stringify(renderQuestDetail(pre, 'sq_rats'));
  assert(preDetail.includes('+90 XP'), 'pre-cap quest preview keeps nominal XP');
  assert(!preDetail.includes('→'), 'pre-cap quest preview claims no conversion');

  const cap = createPlayer(978, 'T', 'warrior');
  cap.level = 45;
  const capDetail = JSON.stringify(renderQuestDetail(cap, 'sq_rats'));
  assert(
    capDetail.includes(`90 XP → +${xpToGoldAtCap(90)} gold`),
    'level-45 quest preview shows the converted amount',
  );

  // Dungeon first-clear headline: same shared economy (#42).
  const pd = createPlayer(979, 'T', 'warrior');
  pd.level = 45;
  const b = startBattle('e_aranya', {
    kind: 'dungeon',
    zoneId: 'whisperwood',
    dungeonId: 'd_rootbound',
    floor: 4,
    boss: true,
  }, { player: pd, rng: seeded(98) })!.battle;
  b.enemy.hp = 0;
  const lines = resolveVictory(pd, b, seeded(95));
  assert(
    lines.some((l) => l.includes(`400 XP → +${xpToGoldAtCap(400)} gold`)),
    'level-45 first-clear headline shows the converted amount',
  );
});

Deno.test('44→45 dungeon first clear remains nominal (#42)', () => {
  const p = createPlayer(980, 'T', 'warrior');
  p.level = 44;
  // The kill rewards alone must NOT reach the summit; the first-clear grant
  // (400 XP) is what crosses 44→45 — so its headline must stay nominal.
  p.xp = xpForNextLevel(44) - 2151 - 100;
  const b = startBattle('e_aranya', {
    kind: 'dungeon',
    zoneId: 'whisperwood',
    dungeonId: 'd_rootbound',
    floor: 4,
    boss: true,
  }, { player: p, rng: seeded(99) })!.battle;
  b.enemy.hp = 0;
  const goldBefore = p.gold;
  const lines = resolveVictory(p, b, seeded(96));
  assertEquals(p.level, 45, 'the first-clear reward itself reaches the summit');
  assert(
    lines.some((l) => l.includes('+250 gold · ✨ +400 XP')),
    'first-clear headline stays nominal for a pre-cap grant',
  );
  assert(!lines.some((l) => l.includes('→')), 'no unawarded conversion is claimed');
  b.phase = 'won';
  p.battle = b;
  const spoils = JSON.stringify(renderBattle(p));
  assert(!spoils.includes('→ +'), 'staged spoils stay nominal too');
  // Direct first-clear gold + battle gold only — no conversion gold.
  assertEquals(p.gold, goldBefore + b.rewards!.gold + 250);
});

Deno.test('item menus only advertise actions that can succeed (#35)', () => {
  const p = createPlayer(971, 'T', 'warrior');
  p.level = 10;
  grantItem(p, 'q_sealed_letter', 1);
  grantItem(p, 'c_minor_potion', 1);
  grantItem(p, 'c_smoke_bomb', 1);
  grantItem(p, 'c_antidote', 1);
  grantItem(p, 'c_phoenix_feather', 1);

  // Quest items: no Drop, no Sell — the handler refused both already.
  const questDetail = JSON.stringify(renderItemDetail(p, 'q_sealed_letter'));
  assert(!questDetail.includes('i:drop:q_sealed_letter'), 'quest items render no Drop');
  assert(!questDetail.includes('i:sell:q_sealed_letter'), 'quest items render no Sell');

  // Out-of-battle Use only for consumables it actually helps with.
  const potion = JSON.stringify(renderItemDetail(p, 'c_minor_potion'));
  assert(potion.includes('i:u:c_minor_potion'), 'healing consumables keep Use');
  const smoke = JSON.stringify(renderItemDetail(p, 'c_smoke_bomb'));
  assert(!smoke.includes('i:u:c_smoke_bomb'), 'Smoke Bomb has no out-of-battle Use');
  const anti = JSON.stringify(renderItemDetail(p, 'c_antidote'));
  assert(!anti.includes('i:u:c_antidote'), 'Antidote has no out-of-battle Use');
  const cinder = JSON.stringify(renderItemDetail(p, 'c_phoenix_feather'));
  assert(!cinder.includes('i:u:c_phoenix_feather'), 'the Cinder stays auto-trigger-only');

  // Battle menu context: Smoke Bomb disabled vs a boss; Antidote disabled
  // with nothing to cleanse; both usable in a normal debuffed fight.
  // (Wire form: the codec shortens battle-use to 'b:us:<id>'. Boss origin:
  // per #28, only dungeon-boss origins set isBoss — explore spawns flee.)
  const boss = startBattle('e_vosk', {
    kind: 'dungeon',
    zoneId: 'umbra',
    dungeonId: 'd_throne',
    floor: 4,
    boss: true,
  }, { player: p, rng: seeded(100) })!.battle;
  p.battle = boss;
  const bossMenu = JSON.stringify(renderItemMenu(p));
  assert(!bossMenu.includes('b:us:c_smoke_bomb'), 'no Smoke Bomb button vs a boss');
  assert(bossMenu.includes('no use here'), 'inapplicable items render disabled');

  const wolf = startBattle('e_wolf', { kind: 'explore', zoneId: 'emberdawn' }, {
    player: p,
    rng: seeded(101),
  })!.battle;
  injectMod(wolf, 'player', 'outgoing', -0.2, { defId: 'sap', name: 'Sapped' });
  p.battle = wolf;
  const wolfMenu = JSON.stringify(renderItemMenu(p));
  assert(wolfMenu.includes('b:us:c_antidote'), 'Antidote usable when a debuff is active');
  assert(wolfMenu.includes('b:us:c_smoke_bomb'), 'Smoke Bomb usable vs a normal enemy');
});

Deno.test('quest contacts resolve to real, placed NPCs — starter and finisher independent (#63)', () => {
  for (const q of QUESTS) {
    assert(npc(q.startNpc), `${q.id}: starter ${q.startNpc} must be a real NPC`);
    assert(npc(q.finishNpc), `${q.id}: finisher ${q.finishNpc} must be a real NPC`);
    const sz = zoneOfNpc(q.startNpc);
    const fz = zoneOfNpc(q.finishNpc);
    assert(sz, `${q.id}: starter ${q.startNpc} must be placed in a zone`);
    assert(fz, `${q.id}: finisher ${q.finishNpc} must be placed in a zone`);
    // Canonical resolvers agree with the raw fields.
    assertEquals(questStarter(q.id)?.npc.id, q.startNpc);
    assertEquals(questFinisher(q.id)?.npc.id, q.finishNpc);
  }
});

Deno.test("quest contacts are reachable at the quest's point in the progression (#66)", () => {
  // A quest's starter AND finisher must stand in zones the player can reach
  // by the time the quest is offered: starting zones, or zones unlocked by
  // any strictly earlier quest (catalog order = progression order).
  const unlocked = new Set(STARTING_ZONES);
  for (const q of QUESTS) {
    const sz = zoneOfNpc(q.startNpc)!.id;
    const fz = zoneOfNpc(q.finishNpc)!.id;
    assert(unlocked.has(sz), `${q.id}: starter zone ${sz} is unreachable at its point`);
    assert(unlocked.has(fz), `${q.id}: finisher zone ${fz} is unreachable at its point`);
    if (q.rewards.unlockZone) unlocked.add(q.rewards.unlockZone);
  }
});

Deno.test('dialogue quests: acceptance is the talk — one event, no second interaction (#66, #127)', () => {
  // m8_passage is offered BY the Ferryman and its objective is hearing the
  // Ferryman out. Under the authored model the OFFER conversation IS that
  // conversation: its accept choice deliberately emits the stable event,
  // so one mutation accepts AND readies — never a second identical tap.
  const p = createPlayer(948, 'T', 'warrior');
  p.level = 13;
  p.unlockedZones.push('hollowmere');
  p.currentZone = 'hollowmere'; // the Ferryman stands here
  for (
    const id of [
      'm1_embers',
      'm2_letter',
      'm3_roots',
      'm4_blessing',
      'm5_fen',
      'm6_toxin',
      'm7_tyrant',
    ]
  ) {
    p.quests[id] = { status: 'done', counts: [] };
  }
  syncAvailability(p);
  // Bare acceptance no longer completes the conversation (#127).
  assert(acceptQuest(p, 'm8_passage', 'npc_ferryman').ok);
  assertEquals(
    p.quests['m8_passage']?.status,
    'active',
    'acceptance alone ticks nothing',
  );
  // The authored accept choice emits the event — readiness, exactly once.
  const offered = onStoryEvent(p, 'heard_ferrymans_word');
  assertEquals(offered, ['m8_passage']);
  assertEquals(
    p.quests['m8_passage']?.status,
    'turnIn',
    'the conversation event readies it at the Ferryman',
  );
});

Deno.test('m2_letter is a Maren → Bram delivery — finisher never inferred from talk objectives (#63)', () => {
  const q = quest('m2_letter')!;
  assertEquals(q.startNpc, 'npc_maren');
  assertEquals(q.finishNpc, 'npc_bram');
  assert(q.startNpc !== q.finishNpc, 'the delivery case has distinct contacts');
  // Resolution is independent per role, each anchored to a real zone.
  const start = questStarter('m2_letter')!;
  const fin = questFinisher('m2_letter')!;
  assertEquals(start.npc.name, 'Elder Maren');
  assertEquals(fin.npc.name, 'Blacksmith Bram');
  assertEquals(start.zone.id, 'emberdawn');
  assertEquals(fin.zone.id, 'emberdawn');
  // The conversation objective keys on Bram's reading event, but the model
  // did NOT derive the finisher from it — the finisher is the explicit
  // field (#127: talk objectives became stable story events).
  assert(
    q.objectives.some((o) => o.kind === 'storyEvent' && o.target === 'heard_bram_reading'),
  );
  assertEquals(questFinisher('m2_letter')!.npc.id, q.finishNpc);
});

Deno.test('NPC talk opens their authored quest (#31, #123)', () => {
  const p = createPlayer(972, 'T', 'warrior');
  p.level = 7;
  // The chain (#73): after m4_floors, Bram offers the m5_arms preparation.
  for (const id of ['m2_letter', 'm3_wolves', 'm4_floors']) {
    p.quests[id] = { status: 'done', counts: [] };
  }
  syncAvailability(p);
  // Bram is the second NPC of Emberdawn Village (maren, bram, lyra).
  zoneAction(p, { v: 'zone', a: 'tk', arg: 1 });
  assertEquals(p.scene.view, 'npc');
  assertEquals(p.scene.arg, 'npc_bram');
  // The offer is enumerated as a topic; selecting it routes to the
  // authoritative interaction.
  assert(npcTopics(p, 'npc_bram').some((t) => t.id === 'm5_arms' && t.kind === 'questOffer'));
  npcAction(p, { v: 'npc', a: 'q', arg: 'm5_arms' });
  assertEquals(p.scene.view, 'dialogue', "the topic opens the giver's offer dialogue");
  assertEquals(p.scene.arg, 'dlg_m5_arms_offer');
});

Deno.test('actionless item details render no empty button rows (#39)', () => {
  const p = createPlayer(975, 'T', 'warrior');
  p.level = 10;
  grantItem(p, 'q_sealed_letter', 1);
  const view = renderItemDetail(p, 'q_sealed_letter');
  // Telegram requires 1–8 buttons per block; an actionless quest item must
  // still open a valid informational view — Back row only, no empty rows.
  const blocks = view.blocks ?? [];
  const rows = blocks.filter((b) => b.type === 'buttons');
  assert(rows.length >= 1, 'the Back row remains');
  for (const r of rows) {
    const n = (r as { buttons: unknown[] }).buttons.length;
    assert(n >= 1 && n <= 8, `button row holds 1–8 buttons (got ${n})`);
  }
  assert(!JSON.stringify(view).includes('"buttons":[]'), 'no empty button rows emitted');
});

Deno.test('renderer invariant: every catalog item detail has only valid button rows (#39)', () => {
  const p = createPlayer(976, 'T', 'warrior');
  p.level = 45; // maximum equip eligibility
  for (const def of ITEMS) {
    addItem(p, def.id, 1);
    const view = renderItemDetail(p, def.id);
    const blocks = view.blocks ?? [];
    for (const block of blocks) {
      if (block.type !== 'buttons') continue;
      const n = block.buttons.length;
      assert(
        n >= 1 && n <= 8,
        `${def.id} detail rendered a ${n}-button row (must be 1–8)`,
      );
    }
  }
});
