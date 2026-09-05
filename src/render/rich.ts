/**
 * Typed builders for rich-message blocks. All game UI buttons live in the
 * message BODY (rich blocks) — this bot never uses reply_markup.
 */

import type { InputRichBlock, RichMessageButton, RichText } from 'grammy/types';

export function para(text: RichText): InputRichBlock {
  return { type: 'paragraph', text };
}

export function heading(text: RichText, size: 1 | 2 | 3 | 4 | 5 | 6 = 3): InputRichBlock {
  return { type: 'heading', text, size };
}

export function divider(): InputRichBlock {
  return { type: 'divider' };
}

export function footer(text: RichText): InputRichBlock {
  return { type: 'footer', text };
}

export function details(summary: RichText, blocks: InputRichBlock[]): InputRichBlock {
  return { type: 'details', summary, blocks };
}

export function list(items: InputRichBlock[][]): InputRichBlock {
  return { type: 'list', items: items.map((blocks) => ({ blocks })) };
}

export function buttonsRow(
  buttons: RichMessageButton[],
  align: 'left' | 'center' | 'right' = 'center',
): InputRichBlock {
  return { type: 'buttons', buttons, align };
}

export type BtnStyle = 'danger' | 'success' | 'primary' | 'link';

export function cbBtn(text: string, callback_data: string, style?: BtnStyle): RichMessageButton {
  return style === undefined ? { text, callback_data } : { text, callback_data, style };
}

export function disabledBtn(text: string): RichMessageButton {
  return { text, disabled: {} };
}

export function banner(text: string): InputRichBlock {
  return {
    type: 'blockquote',
    blocks: [{ type: 'paragraph', text: { type: 'bold', text } }],
  };
}

export function quote(text: RichText): InputRichBlock {
  return { type: 'blockquote', blocks: [{ type: 'paragraph', text }] };
}

/** HP/MP/XP bar as ▰▰▰▱▱… */
export function bar(current: number, max: number, width = 10): string {
  const filled = max <= 0 ? 0 : Math.max(0, Math.min(width, Math.round((current / max) * width)));
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

export function pct(current: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.round((current / max) * 100)}%`;
}
