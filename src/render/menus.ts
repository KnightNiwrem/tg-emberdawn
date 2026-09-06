/** Menu renderers: inventory, item detail, equipment, skills. */

import type { InputRichBlock, InputRichMessage, RichText } from 'grammy/types';
import type { EquipSlot, PlayerState } from '../engine/types.ts';
import { renderItemReference } from './item_reference.ts';
import { itemReferenceRow } from './item_uses.ts';
import type { ItemDef } from '../content/types.ts';
import { isEquippable, item, sellPrice } from '../content/items.ts';
import { skillsForClass } from '../content/skills.ts';
import { CLASSES, MAX_LEVEL } from '../engine/classes.ts';
import {
  consumableEffectLines,
  FOE_VOICE,
  mechanicsLines,
  mechanicsText,
} from '../engine/mechanics.ts';
import { temperBonusOf, temperLevel } from '../engine/forge.ts';
import { buttonsRow, cbBtn, heading, para } from './rich.ts';
import { encodeCb } from '../codec.ts';
import { noticesBlocks } from './parts.ts';

const INV_PAGE_SIZE = 8;

export function renderInventory(player: PlayerState, page: number): InputRichMessage {
  const pages = Math.max(1, Math.ceil(player.inventory.length / INV_PAGE_SIZE));
  const pageIndex = Math.min(Math.max(0, page), pages - 1);
  const slice = player.inventory.slice(
    pageIndex * INV_PAGE_SIZE,
    (pageIndex + 1) * INV_PAGE_SIZE,
  );
  const blocks: InputRichBlock[] = [
    heading('🎒 Inventory', 4),
    para(`${player.inventory.length} kinds of items · 💰 ${player.gold} gold`),
    ...noticesBlocks(player),
  ];
  if (player.inventory.length === 0) blocks.push(para("Empty. A hero's bag awaits."));
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
  if (pageIndex > 0) {
    nav.push(cbBtn('⬅️ Prev', encodeCb({ v: 'inventory', a: 'p', arg: pageIndex - 1 })));
  }
  nav.push(
    cbBtn(`📄 ${pageIndex + 1}/${pages}`, encodeCb({ v: 'inventory', a: 'p', arg: pageIndex })),
  );
  if (pageIndex < pages - 1) {
    nav.push(cbBtn('Next ➡️', encodeCb({ v: 'inventory', a: 'p', arg: pageIndex + 1 })));
  }
  if (nav.length > 0) blocks.push(buttonsRow(nav));
  blocks.push(buttonsRow([
    cbBtn('🛠️ Equipment', encodeCb({ v: 'equipment', a: 'open' })),
    cbBtn('⬅️ Back', encodeCb({ v: 'inventory', a: 'bk' })),
  ]));
  return { blocks };
}

/** Exact-mechanics disclosure lines for equipment triggers (#82, #120).
 * Chance, limits and cooldown come from the trigger fields; the effect
 * wording is GENERATED from the trigger's effect specs by the shared
 * mechanical renderer — content never re-types its own numbers. Shared by
 * the inventory detail, equipment, shop and forge views. */
export function triggerDisclosure(def: ItemDef | undefined): string[] {
  if (!def?.triggers?.length) return [];
  return def.triggers.map((trigger) => {
    const bits: string[] = [];
    if (trigger.chance !== undefined) bits.push(`${Math.round(trigger.chance * 100)}% chance`);
    if (trigger.maxProcs !== undefined) bits.push(`up to ${trigger.maxProcs}×/battle`);
    // #89: cooldown N makes N complete intervening rounds unavailable —
    // stated as the frequency it guarantees (a proc on R re-arms on R+N+1).
    if (trigger.cooldown !== undefined) {
      bits.push(`at most once every ${trigger.cooldown + 1} rounds`);
    }
    const when = trigger.trigger === 'battleStart'
      ? 'Battle start'
      : trigger.trigger === 'onEnemyActionHpDamage'
      ? 'When an enemy action damages you'
      : trigger.trigger === 'onHpDamage'
      ? 'On taking any HP loss'
      : 'On guard';
    const mech = mechanicsLines(trigger.effects, { opponent: FOE_VOICE }).join(' ');
    return `⚡ ${when}: ${mech}${bits.length ? ` (${bits.join(' · ')})` : ''}`;
  });
}

/** Generated effect disclosure for an item (#120): bag effect for
 * consumables plus every equipment trigger — all generated from
 * structured data. */
export function itemMechanicsLines(def: ItemDef): string[] {
  const lines: string[] = [];
  if (def.effect) lines.push(...consumableEffectLines(def.effect));
  if (def.triggers?.length) lines.push(...triggerDisclosure(def));
  return lines;
}

/** Where a detail view was opened FROM (#112) — the Back button returns to
 * the origin (the same inventory page, or the Equipment screen) instead of
 * a hardcoded zone. */
export type ItemDetailOrigin =
  | { kind: 'inventory'; page: number }
  | { kind: 'equipment' }
  | { kind: 'journey' }
  | { kind: 'zone' };

/** Parses the scene's origin marker (#112): a digit string is the inventory
 * page, 'eq' the Equipment screen, 'j' an active journey (#159), anything
 * else the legacy zone fallback. */
export function itemDetailOrigin(arg2: string | undefined): ItemDetailOrigin {
  if (arg2 === 'eq') return { kind: 'equipment' };
  if (arg2 === 'j') return { kind: 'journey' };
  if (arg2 !== undefined && /^\d+$/.test(arg2)) return { kind: 'inventory', page: Number(arg2) };
  return { kind: 'zone' };
}

function detailBackRow(origin: ItemDetailOrigin): InputRichBlock {
  const btn = origin.kind === 'equipment'
    ? cbBtn('⬅️ Equipment', encodeCb({ v: 'equipment', a: 'open' }))
    : origin.kind === 'journey'
    // The journey handler routes i:bk back to the crossing (#159).
    ? cbBtn('⬅️ Back to the road', encodeCb({ v: 'inventory', a: 'bk' }))
    : origin.kind === 'inventory'
    ? cbBtn('⬅️ Back', encodeCb({ v: 'inventory', a: 'p', arg: origin.page }))
    : cbBtn('⬅️ Back', encodeCb({ v: 'inventory', a: 'bk' }));
  return buttonsRow([btn]);
}

/** The class-restriction fact line for an equipment detail (#113): canonical
 * display names from the class definitions, ordered by declaration, `null`
 * when the piece is unrestricted. Kept as a pure item fact — never derived
 * from the viewer's own eligibility. */
export function classRequirementText(def: ItemDef): string | null {
  if (!def.classes || (def.kind !== 'weapon' && def.kind !== 'armor' && def.kind !== 'trinket')) {
    return null;
  }
  const names = Object.values(CLASSES)
    .filter((classDef) => def.classes!.includes(classDef.id))
    .map((classDef) => classDef.name);
  if (names.length === 0) return null;
  return names.length === 1 ? `Class: ${names[0]}` : `Classes: ${names.join(', ')}`;
}

/** Shared static item facts (#112, #120): stats, GENERATED mechanical
 * disclosure (bag effect + triggers), then optional flavor prose,
 * requirement. Bag, equipped and shop detail wrappers layer their own headings
 * and actions over this so the detail pages cannot drift. Flavor and
 * mechanics are visibly separate blocks; mechanics alone carry every
 * number. */
export function itemFactBlocks(def: ItemDef): InputRichBlock[] {
  const blocks: InputRichBlock[] = [];
  if (def.stats) {
    const lines = Object.entries(def.stats)
      .map(([statKey, value]) => `${statEmoji(statKey)} +${value} ${statKey.toUpperCase()}`)
      .join('\n');
    blocks.push(para(lines));
  }
  const mech = itemMechanicsLines(def);
  if (mech.length > 0) blocks.push(para(mech.join('\n')));
  if (def.desc) blocks.push(para([{ type: 'italic', text: def.desc } as RichText]));
  // Requirements are item FACTS (#113), shown regardless of the viewer's own
  // eligibility — a missing Equip button must never be the only signal.
  const classReq = classRequirementText(def);
  if (classReq) blocks.push(para(classReq));
  if (def.level > 1 && (def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'trinket')) {
    blocks.push(para(`Requires level ${def.level}.`));
  }
  blocks.push(para(`Sell value: ${def.unique ? '-' : `${sellPrice(def.id)}g`}`));
  return blocks;
}

export function renderItemDetail(
  player: PlayerState,
  itemId: string,
  originArg2?: string,
): InputRichMessage {
  const def = item(itemId);
  const qty = player.inventory.find((entry) => entry.id === itemId)?.qty ?? 0;
  const blocks: InputRichBlock[] = [];
  const origin = itemDetailOrigin(originArg2);
  if (!def || qty === 0) {
    blocks.push(para('That item has vanished from your bag.'));
    blocks.push(detailBackRow(origin));
    return { blocks };
  }
  const reference = renderItemReference(def.id, player.scene.arg3);
  if (reference) return reference;
  blocks.push(heading(`${def.name} ×${qty}`, 4));
  blocks.push(...noticesBlocks(player));
  blocks.push(...itemFactBlocks(def));

  const row = [];
  const equippable = isEquippable(itemId, player.classId, player.level);
  if (equippable.ok) {
    row.push(cbBtn('⚔️ Equip', encodeCb({ v: 'inventory', a: 'eq', arg: itemId }), 'success'));
  }
  // Use only when it does something out of battle (#35): pure battle tools
  // (Antidote's cleanse, Smoke Bomb's flee) and the auto-trigger Cinder
  // would just burn the item on 'Nothing happened.' from the bag.
  if (def.kind === 'consumable' && (def.effect?.healHp || def.effect?.healMp)) {
    row.push(cbBtn('🧪 Use', encodeCb({ v: 'inventory', a: 'u', arg: itemId }), 'success'));
  }
  // Selling left the generic inventory (#161): it happens only at a shop's
  // own counter, where a merchant actually stands. Dropping stays a bag
  // operation (#35): quest items and earned trophies refuse it.
  if (!def.unique && def.kind !== 'quest') {
    row.push(cbBtn('🗑️ Drop', encodeCb({ v: 'inventory', a: 'drop', arg: itemId }), 'danger'));
  }
  if (row.length) blocks.push(buttonsRow(row));
  blocks.push(itemReferenceRow(def.id));
  blocks.push(detailBackRow(origin));
  return { blocks };
}

function statEmoji(statKey: string): string {
  switch (statKey) {
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
export function renderEquipment(player: PlayerState): InputRichMessage {
  const slots: EquipSlot[] = ['weapon', 'armor', 'trinket'];
  const blocks: InputRichBlock[] = [
    heading('🛠️ Equipment', 4),
    ...noticesBlocks(player),
  ];
  for (const slot of slots) {
    const equippedId = player.equipment[slot];
    const itemDef = equippedId ? item(equippedId) : undefined;
    if (!equippedId || !itemDef) {
      blocks.push(para(`${SLOT_LABELS[slot]}: — empty —`));
      continue; // an empty slot exposes no inspection route (#112)
    }
    const temperStr = slot !== 'trinket' ? temperText(player, slot) : '';
    const effectIndicator = itemDef.triggers?.length ? ' ⚡ Combat effect' : '';
    blocks.push(para(`${SLOT_LABELS[slot]}: ${itemDef.name}${temperStr}${effectIndicator}`));
    blocks.push(
      buttonsRow([
        cbBtn(`🔍 Details`, encodeCb({ v: 'equipment', a: 'view', arg: slot })),
        cbBtn(`Unequip ${SLOT_NAMES[slot]}`, encodeCb({ v: 'equipment', a: 'rm', arg: slot })),
      ], 'left'),
    );
  }
  // Owned equippables by slot
  const owned = player.inventory.filter((entry) => {
    const itemDef = item(entry.id);
    return itemDef &&
      (itemDef.kind === 'weapon' || itemDef.kind === 'armor' || itemDef.kind === 'trinket') &&
      entry.id !== player.equipment.weapon && entry.id !== player.equipment.armor &&
      entry.id !== player.equipment.trinket;
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
 * controls are Sources, Unequip (the validated operation, returning exactly
 * one copy to the bag), and Back to Equipment. */
export function renderEquippedItemDetail(player: PlayerState, slot: EquipSlot): InputRichMessage {
  const blocks: InputRichBlock[] = [];
  const equippedId = player.equipment[slot];
  const itemDef = equippedId ? item(equippedId) : undefined;
  if (!equippedId || !itemDef) {
    // Safe explanatory state (#112): an empty slot — or a def that went
    // missing — never claims the item "vanished from your bag".
    blocks.push(para(`That ${SLOT_NAMES[slot]} slot is empty.`));
    blocks.push(buttonsRow([cbBtn('⬅️ Equipment', encodeCb({ v: 'equipment', a: 'open' }))]));
    return { blocks };
  }
  const reference = renderItemReference(itemDef.id, player.scene.arg3);
  if (reference) return reference;
  const temper = slot !== 'trinket' ? temperLevel(player, slot) : 0;
  const temperMark = temper > 0 ? ` +${temper}` : '';
  blocks.push(heading(`${itemDef.name}${temperMark}`, 4));
  blocks.push(...noticesBlocks(player));
  blocks.push(para(`Equipped: ${SLOT_LABELS[slot]}.`));
  if (temper > 0) {
    const pct = Math.round(temperBonusOf(player, equippedId) * 100);
    blocks.push(para(`🔧 Forge-tempered +${temper} — +${pct}% to this item's own stats.`));
  }
  blocks.push(...itemFactBlocks(itemDef));
  blocks.push(buttonsRow([
    cbBtn('🔓 Unequip', encodeCb({ v: 'equipment', a: 'rm', arg: slot }), 'danger'),
  ]));
  blocks.push(itemReferenceRow(itemDef.id));
  blocks.push(buttonsRow([
    cbBtn('⬅️ Equipment', encodeCb({ v: 'equipment', a: 'open' })),
  ]));
  return { blocks };
}

function temperText(player: PlayerState, slot: 'weapon' | 'armor'): string {
  const temper = temperLevel(player, slot);
  return temper > 0 ? ` +${temper}` : '';
}

export function renderSkills(player: PlayerState): InputRichMessage {
  const learned = new Set(player.skills);
  const all = skillsForClass(player.classId, MAX_LEVEL);
  const blocks: InputRichBlock[] = [
    heading('✨ Skills', 4),
    ...noticesBlocks(player),
  ];
  for (const skill of all) {
    const have = learned.has(skill.id);
    // #91: pre-emptive skills never render a payable MP/CD label — they
    // fire automatically, once, as the battle opens, costing nothing.
    const head = skill.preEmptive
      ? `${
        have ? '✅' : `🔒 Lv ${skill.learnLevel}`
      } ${skill.name} — ⚡ automatic at battle open (once per battle) · no MP or cooldown cost`
      : `${have ? '✅' : `🔒 Lv ${skill.learnLevel}`} ${skill.name} — ${skill.mpCost} MP${
        skill.cooldown ? ` · CD ${skill.cooldown}` : ''
      }`;
    blocks.push(para([{ type: 'bold', text: head } as RichText]));
    // #120: flavor first, then the GENERATED mechanical block — visibly
    // separate; every number lives only in the mechanics.
    if (skill.flavor) blocks.push(para([{ type: 'italic', text: skill.flavor } as RichText]));
    blocks.push(para(mechanicsText(skill.effects)));
  }
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'skills', a: 'bk' }))]));
  return { blocks };
}
