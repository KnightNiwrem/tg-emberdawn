/** Menu renderers: inventory, item detail, equipment, skills. */

import type { InputRichBlock, InputRichMessage, RichText } from 'grammy/types';
import type { EquipSlot, PlayerState } from '../engine/types.ts';
import type { ItemDef } from '../content/types.ts';
import { isEquippable, item } from '../content/items.ts';
import { skillsForClass } from '../content/skills.ts';
import { MAX_LEVEL } from '../engine/classes.ts';
import { temperBonusOf, temperLevel } from '../engine/forge.ts';
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

/** Exact-mechanics disclosure lines for equipment triggers (#82). Derived
 * from the trigger data — chance, limits and cooldown come from the
 * fields; magnitude wording from the authored desc. Shared by the
 * inventory detail, equipment, shop and forge views. */
export function triggerDisclosure(def: ItemDef | undefined): string[] {
  if (!def?.triggers?.length) return [];
  return def.triggers.map((tg) => {
    const bits: string[] = [];
    if (tg.chance !== undefined) bits.push(`${Math.round(tg.chance * 100)}% chance`);
    if (tg.maxProcs !== undefined) bits.push(`up to ${tg.maxProcs}×/battle`);
    // #89: cooldown N makes N complete intervening rounds unavailable —
    // stated as the frequency it guarantees (a proc on R re-arms on R+N+1).
    if (tg.cooldown !== undefined) {
      bits.push(`at most once every ${tg.cooldown + 1} rounds`);
    }
    const when = tg.trigger === 'battleStart'
      ? 'Battle start'
      : tg.trigger === 'onEnemyActionHpDamage'
      ? 'When an enemy action damages you'
      : tg.trigger === 'onHpDamage'
      ? 'On taking any HP loss'
      : 'On guard';
    return `⚡ ${when}: ${tg.desc}${bits.length ? ` (${bits.join(' · ')})` : ''}`;
  });
}

/** Where a detail view was opened FROM (#112) — the Back button returns to
 * the origin (the same inventory page, or the Equipment screen) instead of
 * a hardcoded zone. */
export type ItemDetailOrigin =
  | { kind: 'inventory'; page: number }
  | { kind: 'equipment' }
  | { kind: 'zone' };

/** Parses the scene's origin marker (#112): a digit string is the inventory
 * page, 'eq' the Equipment screen, anything else the legacy zone fallback. */
export function itemDetailOrigin(arg2: string | undefined): ItemDetailOrigin {
  if (arg2 === 'eq') return { kind: 'equipment' };
  if (arg2 !== undefined && /^\d+$/.test(arg2)) return { kind: 'inventory', page: Number(arg2) };
  return { kind: 'zone' };
}

function detailBackRow(origin: ItemDetailOrigin): InputRichBlock {
  const btn = origin.kind === 'equipment'
    ? cbBtn('⬅️ Equipment', encodeCb({ v: 'equipment', a: 'open' }))
    : origin.kind === 'inventory'
    ? cbBtn('⬅️ Back', encodeCb({ v: 'inventory', a: 'p', arg: origin.page }))
    : cbBtn('⬅️ Back', encodeCb({ v: 'inventory', a: 'bk' }));
  return buttonsRow([btn]);
}

/** Shared static item facts (#112): stats, consumable effect, trigger
 * mechanics, flavor, requirement. Bag and equipped detail wrappers layer
 * their own headings and actions over this so the two detail pages cannot
 * drift. */
function itemFactBlocks(def: ItemDef): InputRichBlock[] {
  const blocks: InputRichBlock[] = [];
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
  if (def.triggers?.length) {
    blocks.push(para(triggerDisclosure(def).join('\n')));
  }
  if (def.desc) blocks.push(para([{ type: 'italic', text: def.desc } as RichText]));
  if (def.level > 1 && (def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'trinket')) {
    blocks.push(para(`Requires level ${def.level}.`));
  }
  return blocks;
}

export function renderItemDetail(
  p: PlayerState,
  itemId: string,
  originArg2?: string,
): InputRichMessage {
  const def = item(itemId);
  const qty = p.inventory.find((e) => e.id === itemId)?.qty ?? 0;
  const blocks: InputRichBlock[] = [];
  const origin = itemDetailOrigin(originArg2);
  if (!def || qty === 0) {
    blocks.push(para('That item has vanished from your bag.'));
    blocks.push(detailBackRow(origin));
    return { blocks };
  }
  blocks.push(heading(`${def.name} ×${qty}`, 4));
  blocks.push(...noticesBlocks(p));
  blocks.push(...itemFactBlocks(def));

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
  blocks.push(detailBackRow(origin));
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

const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: '🗡️ Weapon',
  armor: '🛡️ Armor',
  trinket: '💍 Trinket',
};

const SLOT_NAMES: Record<EquipSlot, string> = {
  weapon: 'weapon',
  armor: 'armor',
  trinket: 'trinket',
};

/** The Equipment screen: a COMPACT slot overview (#112) — slot, item name,
 * temper marker, and a `⚡ Combat effect` indicator where triggers exist.
 * The full multi-line trigger disclosure lives on each equipped item's
 * detail view (slot-addressed), so the overview no longer uniquely expands
 * triggered gear while omitting everyone else's stats. */
export function renderEquipment(p: PlayerState): InputRichMessage {
  const slots: EquipSlot[] = ['weapon', 'armor', 'trinket'];
  const blocks: InputRichBlock[] = [
    heading('🛠️ Equipment', 4),
    ...noticesBlocks(p),
  ];
  for (const slot of slots) {
    const id = p.equipment[slot];
    const def = id ? item(id) : undefined;
    if (!id || !def) {
      blocks.push(para(`${SLOT_LABELS[slot]}: — empty —`));
      continue; // an empty slot exposes no inspection route (#112)
    }
    const lvl = slot !== 'trinket' ? temperText(p, slot) : '';
    const eff = def.triggers?.length ? ' ⚡ Combat effect' : '';
    blocks.push(para(`${SLOT_LABELS[slot]}: ${def.name}${lvl}${eff}`));
    blocks.push(
      buttonsRow([
        cbBtn(`🔍 Details`, encodeCb({ v: 'equipment', a: 'view', arg: slot })),
        cbBtn(`Unequip ${SLOT_NAMES[slot]}`, encodeCb({ v: 'equipment', a: 'rm', arg: slot })),
      ], 'left'),
    );
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

/** The EQUIPPED item's detail view (#112), addressed BY SLOT — the slot is
 * re-resolved from player state at render time, so forged or stale ids can
 * never inspect an item that is no longer equipped. Shows the same factual
 * information as the bag detail (stats, description, requirements, exact
 * trigger mechanics, temper level and its effective contribution) with the
 * equipped state instead of a bag quantity, and NO bag-only controls: the
 * only actions are Unequip (the validated operation, returning exactly one
 * copy to the bag) and Back to Equipment. */
export function renderEquippedItemDetail(p: PlayerState, slot: EquipSlot): InputRichMessage {
  const blocks: InputRichBlock[] = [];
  const id = p.equipment[slot];
  const def = id ? item(id) : undefined;
  if (!id || !def) {
    // Safe explanatory state (#112): an empty slot — or a def that went
    // missing — never claims the item "vanished from your bag".
    blocks.push(para(`That ${SLOT_NAMES[slot]} slot is empty.`));
    blocks.push(buttonsRow([cbBtn('⬅️ Equipment', encodeCb({ v: 'equipment', a: 'open' }))]));
    return { blocks };
  }
  const temper = slot !== 'trinket' ? temperLevel(p, slot) : 0;
  const temperMark = temper > 0 ? ` +${temper}` : '';
  blocks.push(heading(`${def.name}${temperMark}`, 4));
  blocks.push(...noticesBlocks(p));
  blocks.push(para(`Equipped: ${SLOT_LABELS[slot]}. This piece is worn, not carried.`));
  if (temper > 0) {
    const pct = Math.round(temperBonusOf(p, id) * 100);
    blocks.push(para(`🔧 Forge-tempered +${temper} — +${pct}% to this item's own stats.`));
  }
  blocks.push(...itemFactBlocks(def));
  blocks.push(
    buttonsRow([
      cbBtn('🔓 Unequip', encodeCb({ v: 'equipment', a: 'rm', arg: slot }), 'danger'),
      cbBtn('⬅️ Equipment', encodeCb({ v: 'equipment', a: 'open' })),
    ], 'left'),
  );
  return { blocks };
}

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
    // #91: pre-emptive skills never render a payable MP/CD label — they
    // fire automatically, once, as the battle opens, costing nothing.
    const head = sk.preEmptive
      ? `${
        have ? '✅' : `🔒 Lv ${sk.learnLevel}`
      } ${sk.name} — ⚡ automatic at battle open (once per battle) · no MP or cooldown cost`
      : `${have ? '✅' : `🔒 Lv ${sk.learnLevel}`} ${sk.name} — ${sk.mpCost} MP${
        sk.cooldown ? ` · CD ${sk.cooldown}` : ''
      }`;
    blocks.push(para([
      { type: 'bold', text: head } as RichText,
      { type: 'italic', text: `\n${sk.desc}` } as RichText,
    ]));
  }
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'skills', a: 'bk' }))]));
  return { blocks };
}
