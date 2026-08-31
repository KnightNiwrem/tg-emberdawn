import type { Context } from 'grammy';

/** Deterministic RNG (mulberry32) — shared by the engine test suites. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minimal grammy Context stand-in shared by the handler suites: edits
 * succeed, sends return a fresh id. `tapped` sets the tapped message id;
 * `data` defaults to a quest back-tap. */
export function fakeCtx(userId: number, tapped?: number, data?: string): Context {
  return {
    from: { id: userId, first_name: 'T' },
    chat: { id: userId },
    callbackQuery: tapped === undefined
      ? undefined
      : { data: data ?? 'q:bk', message: { message_id: tapped } },
    answerCallbackQuery: () => Promise.resolve(),
    api: {
      editMessageText: () => Promise.resolve(),
      sendRichMessage: () => Promise.resolve({ message_id: 424242 }),
    },
    replyWithRichMessage: () => Promise.resolve({ message_id: 424242 }),
  } as unknown as Context;
}

/** Like fakeCtx, but records every outgoing rich message (in-place edits,
 * fresh sends, command replies) AND callback toasts so tests can assert
 * WHAT was delivered and not just what was persisted. */
export function fakeCtxCapture(userId: number, tapped?: number, data?: string) {
  const edits: unknown[] = [];
  const sends: unknown[] = [];
  const toasts: (string | undefined)[] = [];
  const ctx = {
    from: { id: userId, first_name: 'T' },
    chat: { id: userId },
    callbackQuery: tapped === undefined
      ? undefined
      : { data: data ?? 'q:bk', message: { message_id: tapped } },
    answerCallbackQuery: (arg?: string | { text?: string }) => {
      toasts.push(typeof arg === 'string' ? arg : arg?.text);
      return Promise.resolve();
    },
    api: {
      editMessageText: (_chatId: number, _msgId: number, msg: unknown) => {
        edits.push(msg);
        return Promise.resolve();
      },
      sendRichMessage: (_chatId: number, msg: unknown) => {
        sends.push(msg);
        return Promise.resolve({ message_id: 424242 });
      },
    },
    replyWithRichMessage: (msg: unknown) => {
      sends.push(msg);
      return Promise.resolve({ message_id: 424242 });
    },
  } as unknown as Context;
  return { ctx, edits, sends, toasts };
}
