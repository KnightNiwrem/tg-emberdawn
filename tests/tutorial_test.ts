/** Guided prologue (#69): creation → Maren's brief → the controlled first
 * battle → deterministic level-2 reward → release into the real hub.
 * Covers the full tap flow through the real router for EVERY class — every
 * lesson beat (basic → skill → guard → item) shown AND acted upon before
 * victory, with no coach bypasses and no manual HP — plus the crit-seed
 * sweep, resume, replay rejection, reward idempotency and the v4→v5
 * migration decision. */

import { assert, assertEquals } from '@std/assert';
import { prepareBot } from 'grammy-testing';
import { createBot } from '../src/bot.ts';
import { MemoryStore, type PlayerStore } from '../src/persistence/store.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { handleStart } from '../src/handlers/commands.ts';
import { withRev } from '../src/codec.ts';
import { fakeCtxCapture, seeded } from './helpers.ts';
import {
  createPlayer,
  CURRENT_STATE_VERSION,
  migratePlayer,
  statsOf,
} from '../src/engine/character.ts';
import { performAction, previewBattle } from '../src/engine/combat.ts';
import { createPostTutorialPlayer } from '../src/engine/tutorial.ts';
import { grantTutorialReward } from '../src/handlers/tutorial.ts';
import { enemy } from '../src/content/enemies.ts';
import type { PlayerState } from '../src/engine/types.ts';

function freshStore(): PlayerStore {
  return new MemoryStore();
}

/** Taps a wire callback with the player's CURRENT render revision, using a
 * stable live-message id. Returns outgoing messages + callback toasts. */
async function tap(store: PlayerStore, userId: number, wire: string, msgId = 555) {
  const p = await store.get(userId);
  assert(p, 'player must exist before tapping');
  const { ctx, edits, sends, toasts } = fakeCtxCapture(userId, msgId, withRev(p.uiRev, wire));
  await handleCallback(ctx, store);
  return { json: JSON.stringify([...edits, ...sends]), toasts };
}

async function pickedHero(store: PlayerStore, userId = 301): Promise<PlayerState> {
  const { ctx } = fakeCtxCapture(userId, 555, 'm:pk:warrior');
  await handleCallback(ctx, store);
  const p = await store.get(userId);
  assert(p);
  return p;
}

Deno.test('prologue: a fresh hero is directed to Maren and the hub is gated (#69)', async () => {
  const store = freshStore();
  await prepareBot(createBot({ token: '123456…ESTS', store }));
  const p = await pickedHero(store);
  assertEquals(p.tutorial, 'maren', 'class pick starts the prologue');
  assertEquals(p.level, 1);

  const { json } = await tap(store, 301, 'z:hm'); // re-open the hub
  assert(json.includes('Speak with Elder Maren'), 'the sole directed action is present');
  assert(json.includes('Your tale begins'), 'the prologue banner shows');
  assert(!json.includes('🚶 Travel'), 'travel is withheld during the prologue');
  assert(!json.includes('🧭 Explore'), 'explore is withheld during the prologue');
  assert(!json.includes('🏪 Shop'), 'shop is withheld during the prologue');
  assert(!json.includes('Forage'), 'forage is withheld during the prologue');
  assert(!json.includes('Ranger Pell'), 'no NPC list during the prologue');
});

Deno.test('prologue: Maren brief → ember → the controlled battle (#69)', async () => {
  const store = freshStore();
  await prepareBot(createBot({ token: '123456…ESTS', store }));
  await pickedHero(store);

  const brief = await tap(store, 301, 'u:maren');
  let p = await store.get(301);
  assertEquals(p!.tutorial, 'maren', 'brief is a sub-view, not a step');
  assert(brief.json.includes('Take the ember'), 'the brief offers the send-off');
  assert(brief.json.includes('Elder Maren'), 'Maren speaks');

  const out = await tap(store, 301, 'u:out');
  p = await store.get(301);
  assertEquals(p!.tutorial, 'outskirts', 'ember accepted → outskirts step');
  assert(out.json.includes('Face the cinder mite'), 'the outskirts panel offers the fight');

  const face = await tap(store, 301, 'u:face');
  p = await store.get(301);
  assertEquals(p!.tutorial, 'fight', 'the prologue battle step');
  assertEquals(p!.battle?.enemy.id, 'e_cinder_mite');
  assertEquals(enemy('e_cinder_mite')?.level, 1, 'the fixture is level 1');
  assertEquals(enemy('e_cinder_mite')?.tutorial, true, 'harness-flagged');
  assert(face.json.includes('Lv 1'), 'the level display is taught');
  assert(face.json.includes('free and always ready'), 'the free action is taught first');
});

Deno.test('prologue: every class reaches every lesson through real play (#69)', async () => {
  for (const cid of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    const store = freshStore();
    await prepareBot(createBot({ token: '123456…ESTS', store }));
    const pick = fakeCtxCapture(301, 555, `m:pk:${cid}`);
    await handleCallback(pick.ctx, store);
    await tap(store, 301, 'u:maren');
    await tap(store, 301, 'u:out');
    await tap(store, 301, 'u:face');

    let p = await store.get(301);
    const potionsBefore = p!.inventory.find((e) => e.id === 'c_minor_potion')?.qty ?? 0;
    assert(potionsBefore >= 1, `${cid} starts with a healing item`);

    // Beat 1 — the free action; the coach hands over to the skill.
    const atk = await tap(store, 301, 'b:atk');
    p = await store.get(301)!;
    assertEquals(p!.battle!.tutorialStep, 'skill', `${cid}: basic performed`);
    assert(p!.battle!.enemy.hp >= 1, `${cid}: the mite survives the opener`);
    assert(atk.json.includes('Skills'), `${cid}: the skill lesson shows`);

    // Beat 2 — the starting skill through the real skills panel.
    const sk = p!.skills[0]!;
    await tap(store, 301, 'b:sk');
    const cast = await tap(store, 301, `b:us:${sk}`);
    p = await store.get(301)!;
    assertEquals(p!.battle!.tutorialStep, 'guard', `${cid}: skill performed`);
    assert(p!.battle!.enemy.hp >= 1, `${cid}: the mite survives the skill`);
    assert(cast.json.includes('Guard'), `${cid}: the guard lesson shows`);

    // Beat 3 — Guard; the scripted teaching hit lands below the threshold.
    const guard = await tap(store, 301, 'b:gd');
    p = await store.get(301)!;
    assertEquals(p!.battle!.tutorialStep, 'item', `${cid}: guard performed`);
    assert(
      p!.hp < statsOf(p!).maxHp * 0.7,
      `${cid}: the scripted hit lands below the item threshold`,
    );
    assert(guard.json.includes('Items'), `${cid}: the item lesson shows`);

    // Beat 4 — use the healing item through the real items panel.
    const hpBefore = p!.hp;
    await tap(store, 301, 'b:it');
    await tap(store, 301, 'b:us:c_minor_potion');
    p = await store.get(301)!;
    assertEquals(p!.battle!.tutorialStep, 'cleared', `${cid}: item performed`);
    assert(p!.hp > hpBefore, `${cid}: the potion actually healed`);

    // The gate lifts — the next hits end the fight, and only now.
    for (let i = 0; i < 10; i++) {
      const cur = await store.get(301);
      if (cur!.battle!.phase !== 'active') break;
      await tap(store, 301, 'b:atk');
    }
    p = await store.get(301)!;
    assertEquals(p!.battle!.phase, 'won', `${cid}: the controlled fight is won`);
    assertEquals(p!.flags['tut_reward'], 1, `${cid}: the ember reward fired once`);

    const release = await tap(store, 301, 'b:go');
    p = await store.get(301)!;
    assertEquals(p!.tutorial, 'done', `${cid}: Continue ends the prologue`);
    assertEquals(p!.battle, undefined, `${cid}: the fight is cleared`);
    assertEquals(p!.level, 2, `${cid}: deterministic level-2 exit`);
    const potionsAfter = p!.inventory.find((e) => e.id === 'c_minor_potion')?.qty ?? 0;
    assertEquals(
      potionsAfter,
      potionsBefore,
      `${cid}: the reward replaces the lesson's potion`,
    );
    // #74: the live outcome IS the canonical constructor state — the WHOLE
    // inventory, not just the potion count.
    assertEquals(p!.inventory, createPostTutorialPlayer(301, 'T', cid).inventory);
    assert(release.json.includes("Maren's board has work"), `${cid}: next contact surfaced`);
    assert(release.json.includes('Whisperwood'), `${cid}: next destination surfaced`);
    assert(release.json.includes('Flee'), `${cid}: fleeing taught before exploration`);
    assert(release.json.includes('🌾 Forage'), `${cid}: the real hub is open again`);
    assert(release.json.includes('🚶 Travel'), `${cid}: travel unlocked`);
  }
});

Deno.test('prologue: no damage roll can skip or end the lesson beats (#69)', () => {
  for (const cid of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    for (let seed = 1; seed <= 25; seed++) {
      const rng = seeded(seed);
      const p = createPlayer(2000 + seed, 'T', cid);
      const b = previewBattle('e_cinder_mite', { kind: 'explore', zoneId: 'outskirts' })!;
      b.tutorial = true;
      b.tutorialStep = 'basic';
      p.battle = b;
      performAction(p, b, { kind: 'attack' }, rng);
      assertEquals(b.tutorialStep, 'skill', `${cid}/${seed}: basic advances`);
      assert(b.enemy.hp >= 1, `${cid}/${seed}: the mite survives the opener`);
      performAction(p, b, { kind: 'skill', skillId: p.skills[0]! }, rng);
      assertEquals(b.tutorialStep, 'guard', `${cid}/${seed}: skill advances`);
      assert(b.enemy.hp >= 1, `${cid}/${seed}: the mite survives the skill`);
      assertEquals(b.phase, 'active', `${cid}/${seed}: the fight cannot end early`);
      performAction(p, b, { kind: 'guard' }, rng);
      assertEquals(b.tutorialStep, 'item', `${cid}/${seed}: guard advances`);
      assert(
        p.hp < statsOf(p).maxHp * 0.7,
        `${cid}/${seed}: the scripted teaching hit lands`,
      );
    }
  }
});

Deno.test('prologue: replays and stale taps never duplicate progress (#69)', async () => {
  const store = freshStore();
  await prepareBot(createBot({ token: '123456…ESTS', store }));
  await pickedHero(store);

  // Take the ember, then replay the SAME wire form with the SAME revision.
  await tap(store, 301, 'u:maren');
  const p0 = await store.get(301);
  const staleWire = withRev(p0!.uiRev, 'u:out');
  await tap(store, 301, 'u:out');
  const afterFirst = await store.get(301);
  assertEquals(afterFirst!.tutorial, 'outskirts');
  const stale = await tapRaw(store, 301, staleWire);
  assert(
    stale.toasts.some((t) => t?.includes('stale')),
    'a same-rev replay is rejected by the router',
  );
  assertEquals((await store.get(301))!.tutorial, 'outskirts', 'no double transition');

  // A CURRENT-rev tap for a step already left is refused by the handler.
  const movedOn = await tap(store, 301, 'u:out');
  assert(
    movedOn.toasts.some((t) => t?.includes('moved on')),
    'the handler revalidates the step',
  );
  assertEquals((await store.get(301))!.tutorial, 'outskirts');
});

/** Taps without stamping (raw wire) — for replay assertions. */
async function tapRaw(store: PlayerStore, userId: number, wire: string, msgId = 555) {
  const { ctx, edits, sends, toasts } = fakeCtxCapture(userId, msgId, wire);
  await handleCallback(ctx, store);
  return { json: JSON.stringify([...edits, ...sends]), toasts };
}

Deno.test('prologue: /start resumes the current step (#69)', async () => {
  const store = freshStore();
  const bot = createBot({ token: '123456…ESTS', store });
  await prepareBot(bot);
  await pickedHero(store);
  await tap(store, 301, 'u:maren');
  await tap(store, 301, 'u:out');

  const { ctx, sends } = fakeCtxCapture(301);
  await handleStart(ctx, store);
  const p = await store.get(301)!;
  assertEquals(p!.tutorial, 'outskirts', 'the step survives /start');
  assert(JSON.stringify(sends).includes('Face the cinder mite'), 'the same step re-renders');
  assertEquals((await store.get(301))!.battle, undefined);
});

Deno.test('prologue: a fled fight returns to the re-face panel (#69)', async () => {
  const store = freshStore();
  await prepareBot(createBot({ token: '123456…ESTS', store }));
  await pickedHero(store);
  await tap(store, 301, 'u:maren');
  await tap(store, 301, 'u:out');
  await tap(store, 301, 'u:face');

  // Flee until it lands (it can fail — retry within the cap).
  let fled = false;
  for (let i = 0; i < 15 && !fled; i++) {
    const p0 = await store.get(301);
    if (p0!.battle?.phase !== 'active') {
      fled = p0!.battle?.phase === 'fled';
      break;
    }
    await tap(store, 301, 'b:fl');
    const p1 = await store.get(301);
    fled = p1!.battle === undefined && p1!.tutorial === 'fight';
  }
  assert(fled, 'the hero escaped the lesson');
  const p = await store.get(301);
  assertEquals(p!.tutorial, 'fight', 'fleeing does not complete the prologue');
  const { json } = await tap(store, 301, 'z:hm');
  assert(json.includes('Face it again'), 'the re-face panel offers the fight');
});

Deno.test('prologue: the ember reward is idempotent at the engine level (#69)', () => {
  const p = createPlayer(310, 'T', 'cleric');
  const first = grantTutorialReward(p);
  assert(first.length > 0);
  assertEquals(p.level, 2, 'deterministic level-2 exit');
  assertEquals(grantTutorialReward(p), [], 'a second call is a no-op');
  assertEquals(p.level, 2);
});

Deno.test('prologue: pre-launch v4 saves skip it via explicit migration (#69)', () => {
  const p = createPlayer(311, 'T', 'mage');
  assertEquals(p.tutorial, 'maren', 'fresh heroes start the prologue');
  const old = JSON.parse(JSON.stringify(p)) as PlayerState;
  delete (old as { tutorial?: unknown }).tutorial;
  old.stateVersion = 4;
  migratePlayer(old);
  assertEquals(old.stateVersion, CURRENT_STATE_VERSION);
  assertEquals(old.tutorial, 'done', 'pre-launch heroes explicitly skip the prologue');
});
