/**
 * Callback-acknowledgment policy (#75): `answerCallbackQuery` is BEST
 * EFFORT. Every test here makes every acknowledgment reject with the
 * canonical expired-query `GrammyError` and proves the update still
 * completes — gameplay mutations land, onboarding flows deliver, refusals
 * answer — so a failed acknowledgment can never wedge a webhook into a
 * Telegram redelivery loop. Control tests prove failures of ESSENTIAL
 * operations (game-message delivery, persistence) still propagate.
 */

import { assert, assertEquals, assertRejects } from '@std/assert';
import { GrammyError } from 'grammy';
import type { Bot, Context } from 'grammy';
import { prepareBot } from 'grammy-testing';
import { createBot } from '../src/bot.ts';
import { withRev } from '../src/codec.ts';
import { createPlayer } from '../src/engine/character.ts';
import type { PlayerState } from '../src/engine/types.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';

const TOKEN = '123456:TEST-TOKEN-FOR-TESTS';
const EXPIRED = 'Bad Request: query is too old and response timeout expired or query ID is invalid';

/** Rejects every `answerCallbackQuery` exactly the way an expired callback
 * query fails at the Bot API; all other methods pass through. Installed
 * BEFORE prepareBot(): the harness re-installs pre-existing transformers
 * ahead of its stub, so this one runs first and short-circuits it. */
function failEveryAck(bot: Bot<Context>): void {
  bot.api.config.use((prev, method, payload) => {
    if (method === 'answerCallbackQuery') {
      return Promise.reject(
        new GrammyError(
          `Call to '${method}' failed with error '${EXPIRED}'`,
          { ok: false, error_code: 400, description: EXPIRED },
          method,
          payload,
        ),
      );
    }
    return prev(method, payload);
  });
}

async function setup() {
  const store = new MemoryStore();
  const bot = createBot({ token: TOKEN, store });
  failEveryAck(bot);
  const { chats } = await prepareBot(bot);
  const user = chats.newUser({ id: 4242, first_name: 'Tester' });
  return { store, user, chats };
}

/** Taps a button the way a real client does: carrying the render revision
 * currently on screen (the store tracks it per player). `messageId` selects
 * the tapped message id — pass 1 to tap a message the harness actually
 * registered (e.g. the /start class picker) so in-place edits are captured. */
async function tap(
  store: MemoryStore,
  user: {
    id: number;
    sendCallbackQuery: (
      data: string,
      options?: { message?: { message_id?: number } },
    ) => Promise<void>;
  },
  data: string,
  messageId?: number,
): Promise<void> {
  const rev = (await store.get(user.id))?.uiRev ?? 0;
  await user.sendCallbackQuery(withRev(rev, data), { message: { message_id: messageId } });
}

Deno.test('expired ack: class picking still creates and persists the hero (#75)', async () => {
  const { store, user } = await setup();
  await user.sendCommand('/start');
  await tap(store, user, 'm:pk:warrior');
  const p = await store.get(4242);
  assert(p, 'hero persisted even though the acknowledgment rejected');
  assertEquals(p.classId, 'warrior');
  assertEquals(p.scene.view, 'zone');
  assert(p.messageId, 'live-message pointer captured');
});

Deno.test('expired ack: gameplay taps still commit and persist (#75)', async () => {
  const { store, user } = await setup();
  await user.sendCommand('/start');
  await tap(store, user, 'm:pk:warrior');
  await tap(store, user, 'z:tv');
  assertEquals(
    (await store.get(4242))!.scene.view,
    'travel',
    'mutation landed despite the failed acknowledgment',
  );
});

Deno.test('expired ack: unknown controls complete without looping (#75)', async () => {
  const { store, user } = await setup();
  // Undecodable callback data → 'Unknown control.' — a refusal that needs
  // no game mutation, yet used to loop forever on an expired query.
  await user.sendCallbackQuery('zz:nonsense');
  assertEquals(await store.get(4242), undefined);
});

Deno.test('expired ack: callbacks without a player complete without looping (#75)', async () => {
  const { store, user } = await setup();
  await user.sendCallbackQuery(withRev(0, 'z:tv')); // gameplay path, no player
  await user.sendCallbackQuery(withRev(0, 'm:rn')); // meta path, no player
  assertEquals(await store.get(4242), undefined);
});

Deno.test('expired ack: revision-mismatched taps complete without looping (#75)', async () => {
  const { store, user } = await setup();
  await user.sendCommand('/start');
  await tap(store, user, 'm:pk:warrior');
  // Tap the LIVE copy (same message id) with a revision it never rendered.
  const p = (await store.get(4242))!;
  await user.sendCallbackQuery(withRev(p.uiRev + 1, 'z:tv'), {
    message: { message_id: p.messageId! },
  });
  assertEquals((await store.get(4242))!.scene.view, 'zone', 'mismatched tap mutated nothing');
});

Deno.test('expired ack: taps on stale message copies complete without looping (#75)', async () => {
  const { store, user } = await setup();
  await user.sendCommand('/start');
  await tap(store, user, 'm:pk:warrior');
  // Track the live message FAR ahead of the tapped copy → every tap stale.
  const p = (await store.get(4242))!;
  p.messageId = 999_999;
  await store.set(4242, p);
  const rev = (await store.get(4242))!.uiRev;
  await user.sendCallbackQuery(withRev(rev, 'z:tv'));
  assertEquals((await store.get(4242))!.scene.view, 'zone', 'stale tap mutated nothing');
});

Deno.test('expired ack: confirmed reset still deletes the save without looping (#75)', async () => {
  const { store, user } = await setup();
  await user.sendCommand('/start');
  await tap(store, user, 'm:pk:warrior');
  await tap(store, user, 'm:reset'); // stage the confirmation
  assertEquals((await store.get(4242))!.scene.view, 'reset');
  await tap(store, user, 'm:ry'); // confirm — the acknowledgment rejects
  assertEquals(await store.get(4242), undefined, 'save deleted despite the failed ack');
  // A redelivered confirmation after deletion is a harmless no-op — and
  // must not loop either (#62, #75).
  await user.sendCallbackQuery(withRev(1, 'm:ry'));
  assertEquals(await store.get(4242), undefined, 'still nothing to delete or persist');
});

Deno.test('expired ack: confirmed reset still delivers the class picker (#75, handler level)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(4242, 'Tester', 'warrior');
  p.scene = { view: 'reset' }; // confirmation staged
  p.uiRev = 7;
  p.messageId = 555;
  await store.set(4242, p);

  // A capturing context whose acknowledgments ALWAYS reject with the
  // canonical expired-query GrammyError — the harness cannot observe
  // in-place edits, so delivery is asserted against the captured API calls.
  const edits: unknown[] = [];
  const sends: unknown[] = [];
  const toasts: (string | undefined)[] = [];
  const ctx = {
    from: { id: 4242, first_name: 'Tester' },
    chat: { id: 4242 },
    update: { update_id: 1 },
    callbackQuery: { data: withRev(7, 'm:ry'), message: { message_id: 555 } },
    answerCallbackQuery: (arg?: { text?: string }) => {
      toasts.push(arg?.text);
      return Promise.reject(
        new GrammyError(
          `Call to 'answerCallbackQuery' failed with error '${EXPIRED}'`,
          { ok: false, error_code: 400, description: EXPIRED },
          'answerCallbackQuery',
          {},
        ),
      );
    },
    api: {
      editMessageText: (_chatId: number, _msgId: number, msg: unknown) => {
        edits.push(msg);
        return Promise.resolve();
      },
      sendRichMessage: (_chatId: number, msg: unknown) => {
        sends.push(msg);
        return Promise.resolve({ message_id: 999 });
      },
    },
    replyWithRichMessage: () => Promise.resolve({ message_id: 999 }),
  } as unknown as Context;

  await handleCallback(ctx, store); // must not throw

  assert(toasts.includes('Hero deleted. A new tale awaits.'));
  assertEquals(await store.get(4242), undefined, 'save deleted');
  const delivered = [...edits, ...sends];
  assertEquals(delivered.length, 1, 'exactly one screen delivered — the class picker');
  assert(
    JSON.stringify(delivered[0]).includes('m:pk:'),
    'the delivered screen carries the stateless class-picker buttons',
  );
});

Deno.test('ack failures are logged without secrets or request payloads (#75)', async () => {
  const { store, user } = await setup();
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = ((...args: unknown[]) => warnings.push(args)) as typeof console.warn;
  try {
    await user.sendCommand('/start');
    await tap(store, user, 'm:pk:warrior');
  } finally {
    console.warn = original;
  }
  assert(warnings.length > 0, 'the failed acknowledgment is logged');
  const flat = JSON.stringify(warnings);
  assert(flat.includes('callback acknowledgment failed'));
  assert(flat.includes(EXPIRED), 'the safe Telegram description survives for debugging');
  assert(!flat.includes('TEST-TOKEN'), 'the bot token never appears in ack logs');
  assert(!flat.includes('callback_query_id'), 'request payloads are never dumped');
});

Deno.test('control: a genuine game-message delivery failure still rejects the update (#75)', async () => {
  const store = new MemoryStore();
  const bot = createBot({ token: TOKEN, store });
  // Acks succeed; the game message itself cannot be delivered (a content
  // error that is NOT a resendable edit failure — commit() must surface it).
  bot.api.config.use((prev, method, payload) => {
    if (method === 'editMessageText') {
      const description = 'Bad Request: message is too long';
      return Promise.reject(
        new GrammyError(
          `Call to '${method}' failed with error '${description}'`,
          { ok: false, error_code: 400, description },
          method,
          payload,
        ),
      );
    }
    return prev(method, payload);
  });
  const { chats } = await prepareBot(bot);
  const user = chats.newUser({ id: 4242, first_name: 'Tester' });
  await user.sendCommand('/start');
  // Class picking delivers the zone view BEFORE persisting: the delivery
  // failure must propagate (webhook 5xx → Telegram retries the action).
  const err = await assertRejects(() => tap(store, user, 'm:pk:warrior'));
  const cause = (err as { error?: unknown }).error ?? err;
  assert(
    cause instanceof GrammyError && cause.description === 'Bad Request: message is too long',
    'the delivery failure itself propagates',
  );
  assertEquals(await store.get(4242), undefined, 'nothing persisted when delivery fails');
});

class FlakyStore extends MemoryStore {
  fail = false;
  override async set(userId: number, state: PlayerState): Promise<void> {
    if (this.fail) throw new Error('db down');
    await super.set(userId, state);
  }
}

Deno.test('control: persistence failures still reject the update (#75)', async () => {
  const store = new FlakyStore();
  const bot = createBot({ token: TOKEN, store });
  const { chats } = await prepareBot(bot);
  const user = chats.newUser({ id: 4242, first_name: 'Tester' });
  await user.sendCommand('/start');
  await tap(store, user, 'm:pk:warrior'); // baseline: everything works
  store.fail = true;
  const err = await assertRejects(() => tap(store, user, 'z:tv'));
  const cause = (err as { error?: unknown }).error ?? err;
  assert(
    cause instanceof Error && cause.message === 'db down',
    'the store failure itself propagates — Telegram should retry the action',
  );
});
