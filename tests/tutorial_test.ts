/** Guided prologue (#69): creation → Maren's brief → the controlled first
 * battle → deterministic level-2 reward → release into the real hub.
 * Covers the full tap flow through the real router for EVERY class — every
 * lesson beat (basic → skill → guard → item) shown AND acted upon before
 * victory, with no coach bypasses and no manual HP — plus the crit-seed
 * sweep, resume, replay rejection and reward idempotency. */

import { assert, assertEquals } from '@std/assert';
import { prepareBot } from 'grammy-testing';
import { createBot } from '../src/bot.ts';
import { MemoryStore, type PlayerStore } from '../src/persistence/store.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { handleStart } from '../src/handlers/commands.ts';
import { withRev } from '../src/codec.ts';
import { fakeCtxCapture, seeded } from './helpers.ts';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
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
  const player = await store.get(userId);
  assert(player, 'player must exist before tapping');
  const { ctx, edits, sends, toasts } = fakeCtxCapture(userId, msgId, withRev(player.uiRev, wire));
  await handleCallback(ctx, store);
  return { json: JSON.stringify([...edits, ...sends]), toasts };
}

async function pickedHero(store: PlayerStore, userId = 301): Promise<PlayerState> {
  const { ctx } = fakeCtxCapture(userId, 555, 'm:pk:warrior');
  await handleCallback(ctx, store);
  const player = await store.get(userId);
  assert(player);
  return player;
}

Deno.test('prologue: a fresh hero is directed to Maren and the hub is gated (#69)', async () => {
  const store = freshStore();
  await prepareBot(createBot({ token: '123456…ESTS', store }));
  const player = await pickedHero(store);
  assertEquals(player.tutorial, 'maren', 'class pick starts the prologue');
  assertEquals(player.level, 1);

  const { json } = await tap(store, 301, 'z:hm'); // re-open the hub
  assert(json.includes('Speak with Elder Maren'), 'the sole directed action is present');
  assert(json.includes('Your tale begins'), 'the prologue banner shows');
  assert(!json.includes('🚶 Travel'), 'travel is withheld during the prologue');
  assert(!json.includes('🧭 Explore'), 'explore is withheld during the prologue');
  assert(!json.includes('🏪 Shop'), 'shop is withheld during the prologue');
  assert(
    !json.includes('🧭 Search'),
    'haven searches are withheld during the prologue',
  );
  assert(!json.includes('🧺 Gather'), 'gathering is withheld during the prologue');
  assert(!json.includes('🛠️ Craft'), 'workshops are withheld during the prologue');
  assert(!json.includes('Ranger Pell'), 'no NPC list during the prologue');
});

Deno.test('prologue: Maren brief → ember → the controlled battle (#69)', async () => {
  const store = freshStore();
  await prepareBot(createBot({ token: '123456…ESTS', store }));
  await pickedHero(store);

  const brief = await tap(store, 301, 'u:maren');
  let player = await store.get(301);
  assertEquals(player!.tutorial, 'maren', 'brief is a sub-view, not a step');
  assert(brief.json.includes('Take the ember'), 'the brief offers the send-off');
  assert(brief.json.includes('Elder Maren'), 'Maren speaks');

  const out = await tap(store, 301, 'u:out');
  player = await store.get(301);
  assertEquals(player!.tutorial, 'outskirts', 'ember accepted → outskirts step');
  assert(out.json.includes('Face the cinder mite'), 'the outskirts panel offers the fight');

  const face = await tap(store, 301, 'u:face');
  player = await store.get(301);
  assertEquals(player!.tutorial, 'fight', 'the prologue battle step');
  assertEquals(player!.battle?.enemy.id, 'e_cinder_mite');
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

    let player = await store.get(301);
    const potionsBefore = player!.inventory.find((entry) => entry.id === 'c_minor_potion')?.qty ??
      0;
    assert(potionsBefore >= 1, `${cid} starts with a healing item`);

    // Beat 1 — the free action; the coach hands over to the skill.
    const atk = await tap(store, 301, 'b:atk');
    player = await store.get(301)!;
    assertEquals(player!.battle!.tutorialStep, 'skill', `${cid}: basic performed`);
    assert(player!.battle!.enemy.hp >= 1, `${cid}: the mite survives the opener`);
    assert(atk.json.includes('Skills'), `${cid}: the skill lesson shows`);

    // Beat 2 — the starting skill through the real skills panel.
    const skillId = player!.skills[0]!;
    await tap(store, 301, 'b:sk');
    const cast = await tap(store, 301, `b:us:${skillId}`);
    player = await store.get(301)!;
    assertEquals(player!.battle!.tutorialStep, 'guard', `${cid}: skill performed`);
    assert(player!.battle!.enemy.hp >= 1, `${cid}: the mite survives the skill`);
    assert(cast.json.includes('Guard'), `${cid}: the guard lesson shows`);

    // Beat 3 — Guard; the scripted teaching hit lands below the threshold.
    const guard = await tap(store, 301, 'b:gd');
    player = await store.get(301)!;
    assertEquals(player!.battle!.tutorialStep, 'item', `${cid}: guard performed`);
    assert(
      player!.hp < statsOf(player!).maxHp * 0.7,
      `${cid}: the scripted hit lands below the item threshold`,
    );
    assert(guard.json.includes('Items'), `${cid}: the item lesson shows`);

    // Beat 4 — use the healing item through the real items panel.
    const hpBefore = player!.hp;
    await tap(store, 301, 'b:it');
    await tap(store, 301, 'b:us:c_minor_potion');
    player = await store.get(301)!;
    assertEquals(player!.battle!.tutorialStep, 'cleared', `${cid}: item performed`);
    assert(player!.hp > hpBefore, `${cid}: the potion actually healed`);

    // The gate lifts — the next hits end the fight, and only now.
    for (let roundIndex = 0; roundIndex < 10; roundIndex++) {
      const cur = await store.get(301);
      if (cur!.battle!.phase !== 'active') break;
      await tap(store, 301, 'b:atk');
    }
    player = await store.get(301)!;
    assertEquals(player!.battle!.phase, 'won', `${cid}: the controlled fight is won`);
    assertEquals(player!.flags['tut_reward'], 1, `${cid}: the ember reward fired once`);

    const release = await tap(store, 301, 'b:go');
    player = await store.get(301)!;
    assertEquals(player!.tutorial, 'done', `${cid}: Continue ends the prologue`);
    assertEquals(player!.battle, undefined, `${cid}: the fight is cleared`);
    assertEquals(player!.level, 2, `${cid}: deterministic level-2 exit`);
    const potionsAfter = player!.inventory.find((entry) => entry.id === 'c_minor_potion')?.qty ?? 0;
    assertEquals(
      potionsAfter,
      potionsBefore,
      `${cid}: the reward replaces the lesson's potion`,
    );
    // #74: the live outcome IS the canonical constructor state — the WHOLE
    // inventory, not just the potion count.
    assertEquals(player!.inventory, createPostTutorialPlayer(301, 'T', cid).inventory);
    assert(release.json.includes('Talk to Elder Maren'), `${cid}: next contact surfaced`);
    assert(release.json.includes('choose Sparks of Trouble'), `${cid}: exact next topic surfaced`);
    assert(release.json.includes('Whisperwood'), `${cid}: next destination surfaced`);
    assert(release.json.includes('Flee'), `${cid}: fleeing taught before exploration`);
    assert(release.json.includes('🧭 Search'), `${cid}: the real hub is open again`);
    assert(release.json.includes('🧺 Gather'), `${cid}: gathering unlocked`);
    assert(release.json.includes('🛠️ Craft'), `${cid}: workshops unlocked`);
    assert(release.json.includes('🚶 Travel'), `${cid}: travel unlocked`);
  }
});

Deno.test('prologue: no damage roll can skip or end the lesson beats (#69)', () => {
  for (const cid of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    for (let seed = 1; seed <= 25; seed++) {
      const rng = seeded(seed);
      const player = createPlayer(2000 + seed, 'T', cid);
      // #99: the guided fight constructs through the REAL pipeline — the
      // tutorial provenance suppresses openings at startBattle itself.
      const battle = startBattle('e_cinder_mite', { kind: 'explore', zoneId: 'outskirts' }, {
        player,
        rng,
        tutorial: true,
      })!.battle;
      player.battle = battle;
      assertEquals(battle.tutorialStep, 'basic', `${cid}/${seed}: construction phase-gates`);
      performAction(player, battle, { kind: 'attack' }, rng);
      assertEquals(battle.tutorialStep, 'skill', `${cid}/${seed}: basic advances`);
      assert(battle.enemy.hp >= 1, `${cid}/${seed}: the mite survives the opener`);
      performAction(player, battle, { kind: 'skill', skillId: player.skills[0]! }, rng);
      assertEquals(battle.tutorialStep, 'guard', `${cid}/${seed}: skill advances`);
      assert(battle.enemy.hp >= 1, `${cid}/${seed}: the mite survives the skill`);
      assertEquals(battle.phase, 'active', `${cid}/${seed}: the fight cannot end early`);
      performAction(player, battle, { kind: 'guard' }, rng);
      assertEquals(battle.tutorialStep, 'item', `${cid}/${seed}: guard advances`);
      assert(
        player.hp < statsOf(player).maxHp * 0.7,
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
    stale.toasts.some((toast) => toast?.includes('stale')),
    'a same-rev replay is rejected by the router',
  );
  assertEquals((await store.get(301))!.tutorial, 'outskirts', 'no double transition');

  // A CURRENT-rev tap for a step already left is refused by the handler.
  const movedOn = await tap(store, 301, 'u:out');
  assert(
    movedOn.toasts.some((toast) => toast?.includes('moved on')),
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
  const player = await store.get(301)!;
  assertEquals(player!.tutorial, 'outskirts', 'the step survives /start');
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
  for (let fleeAttempt = 0; fleeAttempt < 15 && !fled; fleeAttempt++) {
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
  const player = await store.get(301);
  assertEquals(player!.tutorial, 'fight', 'fleeing does not complete the prologue');
  const { json } = await tap(store, 301, 'z:hm');
  assert(json.includes('Face it again'), 'the re-face panel offers the fight');
});

Deno.test('prologue: the ember reward is idempotent at the engine level (#69)', () => {
  const player = createPlayer(310, 'T', 'cleric');
  assertEquals(player.tutorial, 'maren', 'fresh heroes start the prologue');
  const first = grantTutorialReward(player);
  assert(first.length > 0);
  assertEquals(player.level, 2, 'deterministic level-2 exit');
  assertEquals(grantTutorialReward(player), [], 'a second call is a no-op');
  assertEquals(player.level, 2);
});
