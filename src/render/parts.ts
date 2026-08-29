/** Shared render fragments. */

import type { InputRichBlock } from 'grammy/types';
import type { PlayerState } from '../engine/types.ts';

/** Renders (and effectively consumes) the transient notice banner. */
export function noticesBlocks(p: PlayerState): InputRichBlock[] {
  if (p.notices.length === 0) return [];
  const blocks: InputRichBlock[] = [
    {
      type: 'blockquote',
      blocks: p.notices.slice(-8).map((n) => ({ type: 'paragraph', text: n } as const)),
    },
  ];
  p.notices = [];
  return blocks;
}
