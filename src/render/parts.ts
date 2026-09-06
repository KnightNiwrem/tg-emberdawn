/** Shared render fragments. */

import type { InputRichBlock } from 'grammy/types';
import type { PlayerState } from '../engine/types.ts';

/** Pure: renders pending notices WITHOUT clearing them. commit() drains
 * p.notices only after the message is actually delivered, so rendering can
 * never mutate state (double renders stay identical). */
export function noticesBlocks(player: PlayerState): InputRichBlock[] {
  if (player.notices.length === 0) return [];
  return [
    {
      type: 'blockquote',
      blocks: player.notices.slice(-8).map((
        notice,
      ) => ({ type: 'paragraph', text: notice } as const)),
    },
  ];
}
