/**
 * callback_data build/parse. Every payload stays well under Telegram's
 * 64-byte cap. Format: `<view>:<action>[:<arg>...]`.
 */

export type Cb =
  | { v: 'zone'; a: 'hm' }
  | { v: 'zone'; a: 'ex' }
  | { v: 'zone'; a: 'dg' }
  | { v: 'zone'; a: 'tv' }
  | { v: 'zone'; a: 'ch' }
  | { v: 'zone'; a: 'inv' }
  | { v: 'zone'; a: 'sk' }
  | { v: 'zone'; a: 'q' }
  | { v: 'zone'; a: 'sh' }
  | { v: 'zone'; a: 'fg' }
  | { v: 'zone'; a: 'tk'; arg: number }
  | { v: 'battle'; a: 'atk' | 'gd' | 'fl' | 'go' | 'sk' | 'it' }
  | { v: 'battle'; a: 'use'; arg: string }
  | { v: 'inventory'; a: 'p'; arg: number }
  | { v: 'inventory'; a: 'v' | 'u' | 'eq' | 'sell' | 'drop'; arg: string }
  | { v: 'inventory'; a: 'bk' }
  | { v: 'equipment'; a: 'rm'; arg: string }
  | { v: 'equipment'; a: 'open' }
  | { v: 'equipment'; a: 'bk' }
  | { v: 'skills'; a: 'bk' }
  | { v: 'quests'; a: 'open'; arg?: string }
  | { v: 'quests'; a: 'q' | 'a' | 't'; arg: string }
  | { v: 'quests'; a: 'bk' }
  | { v: 'shop'; a: 'p'; arg: number }
  | { v: 'shop'; a: 'buy' | 'sell'; arg: string }
  | { v: 'shop'; a: 'bk' }
  | { v: 'forge'; a: 'w' | 'a' | 'bk' }
  | { v: 'travel'; a: 'go'; arg: string }
  | { v: 'travel'; a: 'bk' }
  | { v: 'death'; a: 'ok' }
  | { v: 'meta'; a: 'help' | 'reset' | 'resetYes' | 'resetNo' | 'pick'; arg?: string };

const CB_RE = /^([a-z]+)(?::(\d{1,4}))?:([a-zA-Z]{1,8}):?([0-9A-Za-z_-]*)$/;

/** A decoded callback plus its render revision (#16), when the wire form
 * carried one: `<view>:<rev>:<action>[:<arg>]`. */
type DecodedCb = Cb & { rev?: number };

/** Rewrites a callback wire form to carry `rev`, replacing any stale one.
 * Every committed render stamps the buttons it renders with the new
 * revision; the router then rejects taps from earlier renders, so the
 * exact same button can never execute a mutation twice. */
export function withRev(rev: number, wire: string): string {
  const seg = wire.split(':');
  if (seg.length >= 2 && /^\d{1,4}$/.test(seg[1]!)) seg.splice(1, 1);
  seg.splice(1, 0, String(rev));
  return seg.join(':');
}

/** Serializes a Cb to its wire form. */
export function encodeCb(c: Cb): string {
  switch (c.v) {
    case 'zone':
      return `z:${c.a === 'hm' ? 'hm' : c.a}${c.a === 'tk' ? `:${c.arg}` : ''}`;
    case 'battle':
      if (c.a === 'use') return `b:us:${c.arg}`;
      return `b:${c.a}`;
    case 'inventory':
      if (c.a === 'p') return `i:pg:${c.arg}`;
      if (c.a === 'bk') return 'i:bk';
      return `i:${c.a}:${c.arg}`;
    case 'equipment':
      return c.a === 'bk' ? 'e:bk' : c.a === 'open' ? 'e:op' : `e:rm:${c.arg}`;
    case 'skills':
      return 's:bk';
    case 'quests':
      if (c.a === 'open') return `q:op${c.arg ? `:${c.arg}` : ''}`;
      if (c.a === 'bk') return 'q:bk';
      return `q:${c.a}:${c.arg}`;
    case 'shop':
      if (c.a === 'p') return `h:pg:${c.arg}`;
      if (c.a === 'bk') return 'h:bk';
      return `h:${c.a}:${c.arg}`;
    case 'forge':
      return `f:${c.a}`;
    case 'travel':
      return c.a === 'bk' ? 't:bk' : `t:go:${c.arg}`;
    case 'death':
      return 'd:ok';
    case 'meta':
      if (c.a === 'pick') return `m:pk:${c.arg}`;
      return `m:${c.a === 'resetYes' ? 'ry' : c.a === 'resetNo' ? 'rn' : c.a}`;
  }
}

function parseCbParts(v: string, a: string, arg: string): Cb | undefined {
  switch (v) {
    case 'z':
      if (a === 'tk') return { v: 'zone', a: 'tk', arg: Number(arg) };
      if (['hm', 'ex', 'dg', 'tv', 'ch', 'inv', 'sk', 'q', 'sh', 'fg'].includes(a)) {
        return {
          v: 'zone',
          a: a as 'hm' | 'ex' | 'dg' | 'tv' | 'ch' | 'inv' | 'sk' | 'q' | 'sh' | 'fg',
        };
      }
      return undefined;
    case 'b':
      if (a === 'us') return { v: 'battle', a: 'use', arg };
      if (['atk', 'gd', 'fl', 'go', 'sk', 'it'].includes(a)) {
        return { v: 'battle', a: a as 'atk' | 'gd' | 'fl' | 'go' | 'sk' | 'it' };
      }
      return undefined;
    case 'i':
      if (a === 'pg') return { v: 'inventory', a: 'p', arg: Number(arg) };
      if (a === 'bk') return { v: 'inventory', a: 'bk' };
      if (['v', 'u', 'eq', 'sell', 'drop'].includes(a)) {
        return { v: 'inventory', a: a as 'v' | 'u' | 'eq' | 'sell' | 'drop', arg };
      }
      return undefined;
    case 'e':
      if (a === 'op') return { v: 'equipment', a: 'open' };
      if (a === 'bk') return { v: 'equipment', a: 'bk' };
      if (a === 'rm') return { v: 'equipment', a: 'rm', arg };
      return undefined;
    case 's':
      if (a === 'bk') return { v: 'skills', a: 'bk' };
      return undefined;
    case 'q':
      if (a === 'op') return { v: 'quests', a: 'open', arg: arg || undefined };
      if (a === 'bk') return { v: 'quests', a: 'bk' };
      if (['q', 'a', 't'].includes(a)) return { v: 'quests', a: a as 'q' | 'a' | 't', arg };
      return undefined;
    case 'h':
      if (a === 'pg') return { v: 'shop', a: 'p', arg: Number(arg) };
      if (a === 'bk') return { v: 'shop', a: 'bk' };
      if (['buy', 'sell'].includes(a)) return { v: 'shop', a: a as 'buy' | 'sell', arg };
      return undefined;
    case 'f':
      if (['w', 'a', 'bk'].includes(a)) return { v: 'forge', a: a as 'w' | 'a' | 'bk' };
      return undefined;
    case 't':
      if (a === 'bk') return { v: 'travel', a: 'bk' };
      if (a === 'go') return { v: 'travel', a: 'go', arg };
      return undefined;
    case 'd':
      if (a === 'ok') return { v: 'death', a: 'ok' };
      return undefined;
    case 'm':
      if (a === 'pk') return { v: 'meta', a: 'pick', arg };
      if (a === 'help') return { v: 'meta', a: 'help' };
      if (a === 'reset') return { v: 'meta', a: 'reset' };
      if (a === 'ry') return { v: 'meta', a: 'resetYes' };
      if (a === 'rn') return { v: 'meta', a: 'resetNo' };
      return undefined;
    default:
      return undefined;
  }
}

/** Parses raw callback data; undefined when malformed/unknown. The optional
 * second segment carries the render revision (#16): `<view>:<rev>:<action>
 * [:<arg>]` — buttons from an earlier render of the same message are
 * rejected by the router before any mutation. */
export function decodeCb(data: string): DecodedCb | undefined {
  const m = CB_RE.exec(data);
  if (!m) return undefined;
  const cb = parseCbParts(m[1]!, m[3]!, m[4] ?? '');
  if (!cb) return undefined;
  return m[2] ? { ...cb, rev: Number(m[2]) } : cb;
}
