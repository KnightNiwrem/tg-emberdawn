/**
 * callback_data build/parse. Every payload stays well under Telegram's
 * 64-byte cap. Format: `<view>:<action>[:<arg>...]`.
 */

export type Cb =
  | { v: 'sources'; a: 'p'; arg: number }
  | { v: 'sources'; a: 'bk' }
  | { v: 'uses'; a: 'p'; arg: number }
  | { v: 'uses'; a: 'bk' }
  | { v: 'zone'; a: 'hm' }
  | { v: 'zone'; a: 'ex' }
  | { v: 'zone'; a: 'ga' | 'cr'; arg: string }
  | { v: 'zone'; a: 'gp' }
  | { v: 'zone'; a: 'cp'; arg: number }
  | { v: 'zone'; a: 'dg' }
  | { v: 'zone'; a: 'dx' }
  | { v: 'zone'; a: 'dgb' }
  | { v: 'zone'; a: 'tv' }
  | { v: 'zone'; a: 'ch' }
  | { v: 'zone'; a: 'inv' }
  | { v: 'zone'; a: 'sk' }
  | { v: 'zone'; a: 'q' }
  | { v: 'zone'; a: 'sh' }
  | { v: 'zone'; a: 'fg' }
  | { v: 'zone'; a: 'tk'; arg: number }
  | { v: 'npc'; a: 'op'; arg: string }
  | { v: 'npc'; a: 'q' | 'lore'; arg: string }
  | { v: 'npc'; a: 'bk' }
  | { v: 'dlg'; a: 'nx'; arg: string }
  | { v: 'dlg'; a: 'ch' | 'cf'; arg: string }
  | { v: 'dlg'; a: 'cc' }
  | { v: 'dlg'; a: 'bk' }
  | { v: 'battle'; a: 'atk' | 'gd' | 'fl' | 'go' | 'sk' | 'it' }
  | { v: 'battle'; a: 'use'; arg: string }
  | { v: 'inventory'; a: 'p'; arg: number }
  | { v: 'inventory'; a: 'v' | 'u' | 'eq' | 'drop'; arg: string }
  | { v: 'inventory'; a: 'bk' }
  | { v: 'equipment'; a: 'rm'; arg: string }
  | { v: 'equipment'; a: 'view'; arg: string }
  | { v: 'equipment'; a: 'open' }
  | { v: 'equipment'; a: 'bk' }
  | { v: 'skills'; a: 'bk' }
  | { v: 'quests'; a: 'open'; arg?: string }
  | { v: 'quests'; a: 'q'; arg: string }
  | { v: 'quests'; a: 'p'; arg: number }
  | { v: 'quests'; a: 'bk' }
  | { v: 'shop'; a: 'p'; arg: number }
  | { v: 'shop'; a: 'buy' | 'sell' | 'view'; arg: string }
  | { v: 'shop'; a: 'bk' }
  | { v: 'forge'; a: 'w' | 'a' | 'bk' }
  | { v: 'travel'; a: 'go'; arg: string }
  | { v: 'travel'; a: 'bk' }
  | { v: 'journey'; a: 'go' | 'rt' }
  | { v: 'death'; a: 'ok' }
  | { v: 'tut'; a: 'maren' | 'out' | 'face' }
  | { v: 'meta'; a: 'pick'; arg?: string }
  | { v: 'meta'; a: 'help' }
  | { v: 'meta'; a: 'reset' }
  | { v: 'meta'; a: 'resetYes' }
  | { v: 'meta'; a: 'resetNo' };

const CB_RE = /^([a-z]+)(?::(\d{1,4}))?:([a-zA-Z]{1,8}):?([0-9A-Za-z_-]*)$/;

/** A decoded callback plus its render revision (#16), when the wire form
 * carried one: `<view>:<rev>:<action>[:<arg>]`. */
type DecodedCb = Cb & { rev?: number };

/** Rewrites a callback wire form to carry `rev`, replacing any stale one.
 * Every committed render stamps the buttons it renders with the new
 * revision; the router then rejects taps from earlier renders, so the
 * exact same button can never execute a mutation twice. */
export function withRev(rev: number, wire: string): string {
  const segments = wire.split(':');
  if (segments.length >= 2 && /^\d{1,4}$/.test(segments[1]!)) segments.splice(1, 1);
  segments.splice(1, 0, String(rev));
  return segments.join(':');
}

/** Serializes a Cb to its wire form. */
export function encodeCb(callback: Cb): string {
  switch (callback.v) {
    case 'uses':
      return callback.a === 'bk' ? 'uses:bk' : `uses:pg:${callback.arg}`;
    case 'sources':
      return callback.a === 'bk' ? 'src:bk' : `src:pg:${callback.arg}`;
    case 'zone':
      return `z:${callback.a === 'hm' ? 'hm' : callback.a}${
        'arg' in callback ? `:${callback.arg}` : ''
      }`;
    case 'npc':
      // #123 topic menu: open (by NPC id), quest-business/lore selection,
      // and leave. Revalidation of NPC/zone/state lives in the handler.
      return callback.a === 'bk' ? 'npc:bk' : `npc:${callback.a}:${callback.arg}`;
    case 'dlg':
      // #124/#126 dialogue scene: Continue carries the TARGET node id (the
      // handler revalidates it against the live scene's current node);
      // choice selection/confirmation carry the choice id — consequence
      // data never rides the wire; cc cancels a staged confirmation; bk
      // leaves for the NPC topic menu.
      if (callback.a === 'bk') return 'dlg:bk';
      if (callback.a === 'cc') return 'dlg:cc';
      return `dlg:${callback.a}:${callback.arg}`;
    case 'battle':
      if (callback.a === 'use') return `b:us:${callback.arg}`;
      return `b:${callback.a}`;
    case 'inventory':
      if (callback.a === 'p') return `i:pg:${callback.arg}`;
      if (callback.a === 'bk') return 'i:bk';
      return `i:${callback.a}:${callback.arg}`;
    case 'equipment':
      // #112: `vi` inspects the EQUIPPED item by SLOT — the slot is the
      // authoritative ownership check, never an arbitrary item id.
      return callback.a === 'bk'
        ? 'e:bk'
        : callback.a === 'open'
        ? 'e:op'
        : callback.a === 'view'
        ? `e:vi:${callback.arg}`
        : `e:rm:${callback.arg}`;
    case 'skills':
      return 's:bk';
    case 'quests':
      // Navigation only (#65): the log cannot express lifecycle actions —
      // accept/turn-in live solely on the npcq interaction surface.
      if (callback.a === 'open') return `q:op${callback.arg ? `:${callback.arg}` : ''}`;
      if (callback.a === 'p') return `q:pg:${callback.arg}`;
      if (callback.a === 'bk') return 'q:bk';
      return `q:q:${callback.arg}`;
    case 'shop':
      if (callback.a === 'p') return `h:pg:${callback.arg}`;
      if (callback.a === 'bk') return 'h:bk';
      return `h:${callback.a}:${callback.arg}`;
    case 'forge':
      return `f:${callback.a}`;
    case 'travel':
      // #159: `go` carries the compact ROUTE INTENT (the stable edge id) —
      // counts, tables, rewards and conditions resolve server-side.
      return callback.a === 'bk' ? 't:bk' : `t:go:${callback.arg}`;
    case 'journey':
      // #159: continue resolves the next roll(s) server-side; retreat
      // aborts back to the origin. No plan data ever rides the wire.
      return `j:${callback.a}`;
    case 'death':
      return 'd:ok';
    case 'tut':
      return `u:${callback.a}`;
    case 'meta':
      if (callback.a === 'pick') return `m:pk:${callback.arg}`;
      return `m:${callback.a === 'resetYes' ? 'ry' : callback.a === 'resetNo' ? 'rn' : callback.a}`;
  }
}

/** Typed wire-action guard: narrows `action` to one of a view's known action
 * tokens, else undefined — replaces per-case `.includes` + cast blocks. */
function act<A extends string>(action: string, known: readonly A[]): A | undefined {
  return (known as readonly string[]).includes(action) ? (action as A) : undefined;
}

function parseCbParts(view: string, action: string, arg: string): Cb | undefined {
  switch (view) {
    case 'uses':
      if (action === 'bk' && !arg) return { v: 'uses', a: 'bk' };
      return action === 'pg' && /^\d{1,6}$/.test(arg)
        ? { v: 'uses', a: 'p', arg: Number(arg) }
        : undefined;
    case 'src':
      if (action === 'bk' && !arg) return { v: 'sources', a: 'bk' };
      return action === 'pg' && /^\d{1,6}$/.test(arg)
        ? { v: 'sources', a: 'p', arg: Number(arg) }
        : undefined;
    case 'z': {
      if (action === 'ga' || action === 'cr') {
        return arg ? { v: 'zone', a: action, arg } : undefined;
      }
      if (action === 'cp') {
        return /^\d+$/.test(arg) ? { v: 'zone', a: action, arg: Number(arg) } : undefined;
      }
      if (action === 'tk') return { v: 'zone', a: 'tk', arg: Number(arg) };
      const zoneAction = act(
        action,
        ['hm', 'ex', 'dg', 'dx', 'dgb', 'tv', 'ch', 'inv', 'sk', 'q', 'sh', 'fg', 'gp'] as const,
      );
      return zoneAction ? { v: 'zone', a: zoneAction } : undefined;
    }
    case 'b': {
      if (action === 'us') return { v: 'battle', a: 'use', arg };
      const battleAction = act(action, ['atk', 'gd', 'fl', 'go', 'sk', 'it'] as const);
      return battleAction ? { v: 'battle', a: battleAction } : undefined;
    }
    case 'i': {
      if (action === 'pg') return { v: 'inventory', a: 'p', arg: Number(arg) };
      if (action === 'bk') return { v: 'inventory', a: 'bk' };
      // #161: selling left the generic inventory — it happens only at a
      // shop's own counter (shopAction), never remotely from the bag.
      const inventoryAction = act(action, ['v', 'u', 'eq', 'drop'] as const);
      return inventoryAction ? { v: 'inventory', a: inventoryAction, arg } : undefined;
    }
    case 'e':
      if (action === 'op') return { v: 'equipment', a: 'open' };
      if (action === 'bk') return { v: 'equipment', a: 'bk' };
      if (action === 'vi') return { v: 'equipment', a: 'view', arg };
      if (action === 'rm') return { v: 'equipment', a: 'rm', arg };
      return undefined;
    case 's':
      if (action === 'bk') return { v: 'skills', a: 'bk' };
      return undefined;
    case 'q': {
      if (action === 'op') return { v: 'quests', a: 'open', arg: arg || undefined };
      if (action === 'pg') return { v: 'quests', a: 'p', arg: Number(arg) };
      if (action === 'bk') return { v: 'quests', a: 'bk' };
      const questAction = act(action, ['q'] as const);
      return questAction ? { v: 'quests', a: questAction, arg } : undefined;
    }
    case 'npc': {
      // #123 topic menu navigation. Every action revalidates the live
      // scene, zone, NPC presence and current availability in the handler.
      if (action === 'bk') return { v: 'npc', a: 'bk' };
      const npcAction = act(action, ['op', 'q', 'lore'] as const);
      return npcAction ? { v: 'npc', a: npcAction, arg } : undefined;
    }
    case 'dlg': {
      // #124/#126 dialogue scene controls.
      if (action === 'bk') return { v: 'dlg', a: 'bk' };
      if (action === 'cc') return { v: 'dlg', a: 'cc' };
      const dialogueAction = act(action, ['nx', 'ch', 'cf'] as const);
      return dialogueAction ? { v: 'dlg', a: dialogueAction, arg } : undefined;
    }
    case 'h': {
      if (action === 'pg') return { v: 'shop', a: 'p', arg: Number(arg) };
      if (action === 'bk') return { v: 'shop', a: 'bk' };
      const shopAction = act(action, ['buy', 'sell', 'view'] as const);
      return shopAction ? { v: 'shop', a: shopAction, arg } : undefined;
    }
    case 'f': {
      const forgeAction = act(action, ['w', 'a', 'bk'] as const);
      return forgeAction ? { v: 'forge', a: forgeAction } : undefined;
    }
    case 't':
      if (action === 'bk') return { v: 'travel', a: 'bk' };
      if (action === 'go') return { v: 'travel', a: 'go', arg };
      return undefined;
    case 'j': {
      const journeyAction = act(action, ['go', 'rt'] as const);
      return journeyAction ? { v: 'journey', a: journeyAction } : undefined;
    }
    case 'd':
      if (action === 'ok') return { v: 'death', a: 'ok' };
      return undefined;
    case 'u': {
      // Guided prologue controls (#69) — same guarded surface as everything
      // else: rev-stamped, routed through dispatch.
      const tutorialAction = act(action, ['maren', 'out', 'face'] as const);
      return tutorialAction ? { v: 'tut', a: tutorialAction } : undefined;
    }
    case 'm':
      if (action === 'pk') return { v: 'meta', a: 'pick', arg };
      if (action === 'help') return { v: 'meta', a: 'help' };
      if (action === 'reset') return { v: 'meta', a: 'reset' };
      if (action === 'ry') return { v: 'meta', a: 'resetYes' };
      if (action === 'rn') return { v: 'meta', a: 'resetNo' };
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
  const match = CB_RE.exec(data);
  if (!match) return undefined;
  const cb = parseCbParts(match[1]!, match[3]!, match[4] ?? '');
  if (!cb) return undefined;
  return match[2] ? { ...cb, rev: Number(match[2]) } : cb;
}
