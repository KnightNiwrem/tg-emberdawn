/** Menu renderers: inventory, item detail, equipment, skills. */

import type { InputRichBlock, InputRichMessage, RichText } from 'grammy/types';
import type { EquipSlot, PlayerState } from '../engine/types.ts';
import { item, itemName } from '../content/items.ts';
import { isEquippable } from '../content/items.ts';
import { skillsForClass } from '../content/skills.ts';
import { MAX_LEVEL } from '../engine/classes.ts';
import { buttonsRow, cbBtn, heading, para } from './rich.ts';
import { encodeCb } from '../codec.ts';
import { noticesBlocks } from './parts.ts';

const INV_PAGE_SIZE = 8;

export function renderInventory(p: PlayerState, page: number): InputRichMessage {
  const pages = Math.max(1, Math.ceil(p.inventory.length / INV_PAGE_SIZE));
  const pg = Math.min(Math.max(0, page), pages - 1);
  const slice = p.inventory.slice(pg * INV_PAGE_SIZE, (pg + 1) * INV_PAGE_SIZE);
  const blocks: InputRichBlock[] = [
    heading('🎒 Inventory', 4),
    para(`${p.inventory.length} kinds of items · 💰 ${p.gold} gold`),
    ...noticesBlocks(p),
  ];
  if (p.inventory.length === 0) blocks.push(para("Empty. A hero's bag awaits."));
  for (const entry of slice) {
    const def = item(entry.id);
    const tag = def?.kind === 'weapon'
      ? '🗡️'
      : def?.kind === 'armor'
      ? '🛡️'
      : def?.kind === 'trinket'
      ? '💍'
      : def?.kind === 'consumable'
      ? '🧪'
      : def?.kind === 'material'
      ? '🧱'
      : '📜';
    blocks.push(
      buttonsRow([
        cbBtn(
          `${tag} ${def?.name ?? entry.id} ×${entry.qty}`,
          encodeCb({ v: 'inventory', a: 'v', arg: entry.id }),
        ),
      ], 'left'),
    );
  }
  const nav = [];
  if (pg > 0) nav.push(cbBtn('⬅️ Prev', encodeCb({ v: 'inventory', a: 'p', arg: pg - 1 })));
  nav.push(cbBtn(`📄 ${pg + 1}/${pages}`, encodeCb({ v: 'inventory', a: 'p', arg: pg })));
  if (pg < pages - 1) nav.push(cbBtn('Next ➡️', encodeCb({ v: 'inventory', a: 'p', arg: pg + 1 })));
  if (nav.length > 0) blocks.push(buttonsRow(nav));
  blocks.push(buttonsRow([
    cbBtn('🛠️ Equipment', encodeCb({ v: 'equipment', a: 'open' })),
    cbBtn('⬅️ Back', encodeCb({ v: 'inventory', a: 'bk' })),
  ]));
  return { blocks };
}

export function renderItemDetail(p: PlayerState, itemId: string): InputRichMessage {
  const def = item(itemId);
  const qty = p.inventory.find((e) => e.id === itemId)?.qty ?? 0;
  const blocks: InputRichBlock[] = [];
  if (!def || qty === 0) {
    blocks.push(para('That item has vanished from your bag.'));
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'inventory', a: 'bk' }))]));
    return { blocks };
  }
  blocks.push(heading(`${def.name} ×${qty}`, 4));
  blocks.push(...noticesBlocks(p));
  if (def.stats) {
    const lines = Object.entries(def.stats)
      .map(([k, v]) => `${statEmoji(k)} +${v} ${k.toUpperCase()}`)
      .join('\n');
    blocks.push(para(lines));
  }
  if (def.effect) {
    const e = def.effect;
    const parts = [];
    if (e.healHp) parts.push(`Restores ${e.healHp} HP`);
    if (e.healMp) parts.push(`Restores ${e.healMp} MP`);
    if (e.cureStatus) parts.push('Cures debuffs');
    if (e.revivePct) parts.push(`Auto-revive at ${e.revivePct}% HP`);
    blocks.push(para(parts.join(' · ')));
  }
  if (def.desc) blocks.push(para([{ type: 'italic', text: def.desc } as RichText]));
  if (def.level > 1 && (def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'trinket')) {
    blocks.push(para(`Requires level ${def.level}.`));
  }

  const row = [];
  const eq = isEquippable(itemId, p.classId, p.level);
  if (eq.ok) {
    row.push(cbBtn('⚔️ Equip', encodeCb({ v: 'inventory', a: 'eq', arg: itemId }), 'success'));
  }
  // Use only when it does something out of battle (#35): pure battle tools
  // (Antidote's cleanse, Smoke Bomb's flee) and the auto-trigger Cinder
  // would just burn the item on 'Nothing happened.' from the bag.
  if (def.kind === 'consumable' && (def.effect?.healHp || def.effect?.healMp)) {
    row.push(cbBtn('🧪 Use', encodeCb({ v: 'inventory', a: 'u', arg: itemId }), 'success'));
  }
  if (!def.unique && def.kind !== 'quest') {
    row.push(
      cbBtn(
        `💱 Sell (${Math.floor(def.price * 0.4)}g)`,
        encodeCb({ v: 'inventory', a: 'sell', arg: itemId }),
      ),
    );
  }
  // Quest items and earned trophies have no Drop (#35) — the handler was
  // already refusing them; now the button agrees.
  if (!def.unique && def.kind !== 'quest') {
    row.push(cbBtn('🗑️ Drop', encodeCb({ v: 'inventory', a: 'drop', arg: itemId }), 'danger'));
  }
  // Optional action row (#39): an actionless item (quest items, earned
  // trophies) renders an informational view with the Back row only — an
  // empty buttons block fails Telegram's 1–8 button validation.
  if (row.length > 0) blocks.push(buttonsRow(row, 'left'));
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'inventory', a: 'bk' }))]));
  return { blocks };
}

function statEmoji(k: string): string {
  switch (k) {
    case 'atk':
      return '⚔️';
    case 'def':
      return '🛡️';
    case 'mag':
      return '🔮';
    case 'res':
      return '✨';
    case 'spd':
      return '💨';
    case 'hp':
      return '❤️';
    case 'mp':
      return '💧';
    case 'luck':
      return '🍀';
    default:
      return '•';
  }
}

export function renderEquipment(p: PlayerState): InputRichMessage {
  const slots: { slot: EquipSlot; label: string }[] = [
    { slot: 'weapon', label: '🗡️ Weapon' },
    { slot: 'armor', label: '🛡️ Armor' },
    { slot: 'trinket', label: '💍 Trinket' },
  ];
  const blocks: InputRichBlock[] = [
    heading('🛠️ Equipment', 4),
    ...noticesBlocks(p),
  ];
  for (const { slot, label } of slots) {
    const id = p.equipment[slot];
    const name = id ? itemName(id) : '— empty —';
    const lvl = slot !== 'trinket' && id ? temperText(p, slot) : '';
    blocks.push(para(`${label}: ${name}${lvl}`));
    if (id) {
      blocks.push(
        buttonsRow([
          cbBtn(`Unequip ${label.slice(2)}`, encodeCb({ v: 'equipment', a: 'rm', arg: slot })),
        ], 'left'),
      );
    }
  }
  // Owned equippables by slot
  const owned = p.inventory.filter((e) => {
    const d = item(e.id);
    return d && (d.kind === 'weapon' || d.kind === 'armor' || d.kind === 'trinket') &&
      e.id !== p.equipment.weapon && e.id !== p.equipment.armor && e.id !== p.equipment.trinket;
  });
  if (owned.length > 0) {
    blocks.push(para('In your bag:'));
    for (const entry of owned) {
      blocks.push(
        buttonsRow([
          cbBtn(
            `${item(entry.id)!.name} ×${entry.qty}`,
            encodeCb({ v: 'inventory', a: 'v', arg: entry.id }),
          ),
        ], 'left'),
      );
    }
  }
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'inventory', a: 'bk' }))]));
  return { blocks };
}

import { temperLevel } from '../engine/forge.ts';
function temperText(p: PlayerState, slot: 'weapon' | 'armor'): string {
  const t = temperLevel(p, slot);
  return t > 0 ? ` +${t}` : '';
}

export function renderSkills(p: PlayerState): InputRichMessage {
  const learned = new Set(p.skills);
  const all = skillsForClass(p.classId, MAX_LEVEL);
  const blocks: InputRichBlock[] = [
    heading('✨ Skills', 4),
    ...noticesBlocks(p),
  ];
  for (const sk of all) {
    const have = learned.has(sk.id);
    blocks.push(para([
      {
        type: 'bold',
        text: `${have ? '✅' : `🔒 Lv ${sk.learnLevel}`} ${sk.name} — ${sk.mpCost} MP${
          sk.cooldown ? ` · CD ${sk.cooldown}` : ''
        }${sk.preEmptive ? ' · ⚡ battle open' : ''}`,
      } as RichText,
      { type: 'italic', text: `\n${sk.desc}` } as RichText,
    ]));
  }
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'skills', a: 'bk' }))]));
  return { blocks };
}
