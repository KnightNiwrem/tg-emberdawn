/** Battle screen renderer: enemy panel, log, action buttons. */

import type { InputRichBlock, InputRichMessage, RichText } from 'grammy/types';
import type { PlayerState } from '../engine/types.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { item } from '../content/items.ts';
import { statsOf } from '../engine/character.ts';
import { consumables } from '../engine/inventory.ts';
import { skillsForClass } from '../content/skills.ts';
import { bar, buttonsRow, cbBtn, disabledBtn, heading, para } from './rich.ts';
import { encodeCb } from '../codec.ts';
import { noticesBlocks } from './parts.ts';

export function renderBattle(p: PlayerState): InputRichMessage {
  const b = p.battle!;
  const s = statsOf(p);
  const eDef = enemyDef(b.enemy.id);
  const blocks: InputRichBlock[] = [];

  if (b.phase === 'active') {
    blocks.push(heading(`⚔️ ${b.enemy.name}`, 4));
    blocks.push(...noticesBlocks(p));
    blocks.push(para(
      `${eDef?.emoji ?? '❔'} ${b.enemy.name} (Lv ${eDef?.level ?? '?'})${
        b.enemy.isBoss ? ' 👑 BOSS' : ''
      }\n` +
        `❤️ ${b.enemy.hp}/${b.enemy.maxHp} ${bar(b.enemy.hp, b.enemy.maxHp)}`,
    ));
    blocks.push(para(
      `❤️ ${p.hp}/${s.maxHp} ${bar(p.hp, s.maxHp)}\n` +
        `💧 ${p.mp}/${s.maxMp} ${bar(p.mp, s.maxMp)}` +
        (b.guarding ? '\n🛡️ Guarding' : '') +
        (b.round > 1 ? `\n— round ${b.round} —` : ''),
    ));
    // Combat log (last 5)
    const recent = b.log.slice(-5);
    if (recent.length > 0) {
      blocks.push({
        type: 'blockquote',
        blocks: recent.map((l) => ({ type: 'paragraph', text: l } as const)),
      });
    }
    blocks.push(buttonsRow([
      cbBtn('⚔️ Attack', encodeCb({ v: 'battle', a: 'atk' }), 'primary'),
      cbBtn('🛡️ Guard', encodeCb({ v: 'battle', a: 'gd' })),
      cbBtn('🏃 Flee', encodeCb({ v: 'battle', a: 'fl' })),
    ]));
    blocks.push(buttonsRow([
      cbBtn('✨ Skills', encodeCb({ v: 'battle', a: 'sk' }), 'primary'),
      cbBtn('🎒 Items', encodeCb({ v: 'battle', a: 'it' })),
    ]));
    return { blocks };
  }

  // Battle over
  const won = b.phase === 'won';
  blocks.push(heading(won ? '🏆 Victory!' : b.phase === 'fled' ? '🏃 Escaped' : '💀 Defeat', 3));
  blocks.push(...noticesBlocks(p));
  const recent = b.log.slice(-7);
  if (recent.length > 0) {
    blocks.push({
      type: 'blockquote',
      blocks: recent.map((l) => ({ type: 'paragraph', text: l } as const)),
    });
  }
  if (won && b.rewards) {
    blocks.push(para(`🎁 Spoils: ✨ ${b.rewards.xp} XP · 💰 ${b.rewards.gold} gold`));
  }
  blocks.push(buttonsRow([cbBtn('➡️ Continue', encodeCb({ v: 'battle', a: 'go' }), 'success')]));
  return { blocks };
}

export function renderSkillMenu(p: PlayerState): InputRichMessage {
  const b = p.battle!;
  const learned = new Set(p.skills);
  const all = skillsForClass(p.classId, 999);
  const blocks: InputRichBlock[] = [
    heading('✨ Skills', 4),
    para(`💧 MP ${p.mp}/${statsOf(p).maxMp}`),
  ];
  const usable = all.filter((sk) => learned.has(sk.id));
  for (const sk of usable) {
    const cd = b.cooldowns[sk.id] ?? 0;
    const ready = cd === 0 && p.mp >= sk.mpCost; // invalid taps never cost a turn
    const label = `${sk.name} — ${sk.mpCost} MP${cd > 0 ? ` (CD ${cd})` : ''}`;
    blocks.push(para([{ type: 'italic', text: sk.desc } as RichText]));
    blocks.push(
      buttonsRow([
        ready ? cbBtn(label, encodeCb({ v: 'battle', a: 'use', arg: sk.id })) : disabledBtn(label),
      ], 'left'),
    );
  }
  if (usable.length === 0) {
    blocks.push(para('No skills learned yet — level up!'));
  }
  blocks.push(
    buttonsRow([cbBtn('⬅️ Back to battle', encodeCb({ v: 'battle', a: 'go' }), 'danger')]),
  );
  return { blocks };
}

export function renderItemMenu(p: PlayerState): InputRichMessage {
  const b = p.battle!;
  void b;
  // Auto-trigger items (Phoenix Cinder) are never manually usable.
  const manual = (id: string): boolean => {
    const eff = item(id)?.effect;
    if (!eff) return true;
    return Boolean(eff.healHp || eff.healMp || eff.cureStatus || eff.flee);
  };
  const items = consumables(p).filter((e) => manual(e.id));
  const blocks: InputRichBlock[] = [heading('🎒 Battle items', 4)];
  if (items.length === 0) {
    blocks.push(para('Your bag is empty of usable items.'));
  }
  for (const entry of items) {
    const def = item(entry.id)!;
    blocks.push(para(`${def.name} ×${entry.qty}`));
    blocks.push(
      buttonsRow([
        cbBtn(`Use ${def.name}`, encodeCb({ v: 'battle', a: 'use', arg: def.id }), 'success'),
      ], 'left'),
    );
  }
  blocks.push(
    buttonsRow([cbBtn('⬅️ Back to battle', encodeCb({ v: 'battle', a: 'go' }), 'danger')]),
  );
  return { blocks };
}
