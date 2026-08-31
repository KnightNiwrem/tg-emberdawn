/** Guided prologue (#69): creation → Maren's brief → the controlled first
 * battle → deterministic level-2 reward → release into the real hub.
 * Covers the full tap flow through the real router, resume, replay
 * rejection, reward idempotency and the v4→v5 migration decision. */

import { assert, assertEquals } from '@std/assert';
import { prepareBot } from 'grammy-testing';
import { createBot } from '../src/bot.ts';
import { MemoryStore, type PlayerStore } from '../src/persistence/store.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { handleStart } from '../src/handlers/commands.ts';
import { withRev } from '../src/codec.ts';
import { fakeCtxCapture } from './helpers.ts';
import {
  createPlayer,
  CURRENT_STATE_VERSION,
  migratePlayer,
  statsOf,
} from '../src/engine/character.ts';
import { coachTutorial, grantTutorialReward } from '../src/handlers/tutorial.ts';
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

const last = (arr: unknown[]): string => JSON.stringify(arr[arr.length - 1] ?? {});

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

Deno.test('prologue: coaching beats — free action, then skill/MP, then Guard (#69)', async () => {
  const store = freshStore();
  await prepareBot(createBot({ token: '123456…ESTS', store }));
  await pickedHero(store);
  await tap(store, 301, 'u:maren');
  await tap(store, 301, 'u:out');
  await tap(store, 301, 'u:face');

  // Round 1: the free action; the coach then hands over to the skill.
  const atk = await tap(store, 301, 'b:atk');
  assert(atk.json.includes('Strike'), 'the free action resolved (warrior Strike)');
  assert(
    atk.json.includes('MP') && atk.json.includes('Cleave'),
    'the next lesson is the starting skill and MP',
  );
  const p = await store.get(301);
  assertEquals(p!.flags['tut_skill'], undefined, 'the lesson is advice, not a gate');

  // The full chain, unit-level: a fast kill may end the live fight before
  // every lesson fires (good play, not a bug) — so coach directly.
  coachTutorial(p!, { kind: 'skill', skillId: 'sk_cleave' });
  assertEquals(p!.flags['tut_skill'], 1);
  assert(p!.notices[0]?.includes('Guard'), 'next lesson: Guard');
  coachTutorial(p!, { kind: 'guard' });
  assertEquals(p!.flags['tut_guard'], 1);
  p!.hp = Math.floor(statsOf(p!).maxHp * 0.5);
  coachTutorial(p!, { kind: 'attack' });
  assert(p!.notices[0]?.includes('Items'), 'next lesson: Items when the hurt is real');
});

Deno.test('prologue: victory guarantees level 2 and releases the hub (#69)', async () => {
  const store = freshStore();
  await prepareBot(createBot({ token: '123456…ESTS', store }));
  await pickedHero(store);
  await tap(store, 301, 'u:maren');
  await tap(store, 301, 'u:out');
  await tap(store, 301, 'u:face');

  // Win through the REAL engine — the mite cannot win (harness-invariant),
  // so free-action spam is a correct play.
  for (let i = 0; i < 30; i++) {
    const p0 = await store.get(301);
    if (p0!.battle!.phase !== 'active') break;
    await tap(store, 301, 'b:atk');
  }
  let p = await store.get(301);
  assertEquals(p!.battle!.phase, 'won', 'the controlled fight is won');
  assertEquals(p!.flags['tut_reward'], 1, 'the ember reward fired exactly once');
  assert(p!.level >= 2, 'the deterministic reward reaches level 2');

  const release = await tap(store, 301, 'b:go');
  p = await store.get(301);
  assertEquals(p!.tutorial, 'done', 'Continue ends the prologue');
  assertEquals(p!.battle, undefined);
  assert(release.json.includes("Maren's board has work"), 'the next contact is surfaced');
  assert(release.json.includes('Whisperwood'), 'the next destination is surfaced');
  assert(release.json.includes('Flee'), 'fleeing is taught before ordinary exploration');
  assert(release.json.includes('🌾 Forage'), 'the real hub is open again (safe haven)');
  assert(release.json.includes('🚶 Travel'), 'travel is unlocked after the prologue');
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
