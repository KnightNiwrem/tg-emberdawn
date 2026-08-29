/** Shared render fragments. */

import type { InputRichBlock } from 'grammy/types';
import type { PlayerState } from '../engine/types.ts';

/** Renders (and effectively consumes) the transient notice banner. */
/** Pure: renders pending notices WITHOUT clearing them. commit() drains
 * p.notices only after the message is actually delivered, so rendering can
 * never mutate state (double renders stay identical). */
export function noticesBlocks(p: PlayerState): InputRichBlock[] {
  if (p.notices.length === 0) return [];
  return [
    {
      type: 'blockquote',
      blocks: p.notices.slice(-8).map((n) => ({ type: 'paragraph', text: n } as const)),
    },
  ];
}
