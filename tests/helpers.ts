import type { Context } from 'grammy';
import type { BattleState, EffectInstance } from '../src/engine/types.ts';
import type { SkillDef, StatKey } from '../src/content/types.ts';
import { statPct } from '../src/engine/effects.ts';

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

// ── Effect-instance fixtures (#78) ──────────────────────────────────────

/** Injects a live statmod instance — the test-fixture replacement for the
 * old direct CombatBuffs slot pokes. */
export function injectMod(
  b: BattleState,
  side: 'player' | 'enemy',
  stat: StatKey,
  pct: number,
  opts: {
    remaining?: number;
    defer?: boolean;
    defId?: string;
    name?: string;
    removable?: boolean;
  } = {},
): EffectInstance {
  b.effectSeq++;
  const remaining = opts.remaining ?? 9;
  const inst: EffectInstance = {
    iid: `test${b.effectSeq}`,
    defId: opts.defId ?? `test:${stat}`,
    name: opts.name ?? `Test ${stat.toUpperCase()}`,
    side,
    source: { kind: 'legacy', id: 'test', name: 'test fixture' },
    kind: 'statmod',
    stat,
    pct,
    // #87 semantic polarity: incoming-damage mods are inverted — more
    // damage taken is harmful to the bearer.
    tags: (stat === 'incoming' ? pct > 0 : pct < 0) ? ['harmful'] : ['beneficial'],
    stacking: 'replace',
    appliedRound: b.round,
    remaining,
    deferFirstTick: opts.defer ?? false,
    removable: opts.removable ?? true,
    expiresRound: b.round + remaining - (opts.defer ? 0 : 1),
  };
  b.effectInstances.push(inst);
  return inst;
}

/** Max remaining rounds among live statmods of one stat on one side. */
export function modRemaining(
  b: BattleState,
  side: 'player' | 'enemy',
  stat: StatKey,
): number {
  let max = 0;
  for (const i of b.effectInstances) {
    if (i.side === side && i.kind === 'statmod' && i.stat === stat) {
      max = Math.max(max, i.remaining);
    }
  }
  return max;
}

/** First live statmod instance of one stat on one side (undefined if none). */
export function modInstance(
  b: BattleState,
  side: 'player' | 'enemy',
  stat: StatKey,
): EffectInstance | undefined {
  return b.effectInstances.find((i) => i.side === side && i.kind === 'statmod' && i.stat === stat);
}

/** A skill's statmod effect for one stat (undefined when it has none) —
 * lets tests pin content durations through the effect contract (#78). */
export function statmodSpec(
  sk: SkillDef,
  stat: StatKey,
): { pct: number; duration: number; timing: 'defer' | 'immediate' } | undefined {
  for (const e of sk.effects) {
    if (e.kind === 'statmod' && e.stat === stat) {
      return { pct: e.pct, duration: e.duration, timing: e.timing };
    }
  }
  return undefined;
}

/** Folded live magnitude of one stat (sum of statmod instances). */
export { statPct };
export { mitigationPct, sapPct } from '../src/engine/effects.ts';

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
