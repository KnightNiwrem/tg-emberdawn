/**
 * The Forge: temper the EQUIPPED weapon/armor. Ownership model (#24, made
 * explicit): temper is ITEM-PATTERN MASTERY — state lives in flags
 * `forge_i_<itemId>`, keyed by CATALOG id, so every copy of that pattern
 * shares it. Tempering one sword to +5 means every future copy of the same
 * pattern (bought, looted, re-forged) fights at +5: the forge is a bounded
 * per-pattern sink, and replacement loot inherits your forge-work.
 * Material tier derives from the ITEM's tier — no more tempering endgame
 * gear with cheap chapter-1 shards after a quick trip back to the village.
 */

import type { PlayerState } from './types.ts';
import { removeItem } from './inventory.ts';
import { item, itemName } from '../content/items.ts';

export const MAX_TEMPER = 5;

const TEMPER_PCT = 0.08; // +8% of the item's own stats per temper level

const TIER_MATERIALS = [
  'm_ember_shard', // gear tier 1
  'm_iron_chunk', // tier 2
  'm_mystic_dust', // tiers 3-4
  'm_frost_core', // tier 5
  'm_cinder_heart', // tiers 6-7
  'm_void_fragment', // tier 8
] as const;

const TIER_MATERIAL_INDEX = [0, 1, 2, 2, 3, 4, 4, 5] as const; // gear tier 1..8

function temperKey(itemId: string): string {
  return `forge_i_${itemId}`;
}

/** Temper level bound to a specific item id (not a slot). */
function temperLevelOf(p: PlayerState, itemId: string | undefined): number {
  if (!itemId) return 0;
  const v = p.flags[temperKey(itemId)];
  return typeof v === 'number' ? v : 0;
}

/** Temper level of whatever is equipped in the slot (for UI). */
export function temperLevel(p: PlayerState, slot: 'weapon' | 'armor'): number {
  return temperLevelOf(p, p.equipment[slot]);
}

/** Stat multiplier contribution of an item's temper level. */
export function temperBonusOf(p: PlayerState, itemId: string | undefined): number {
  return temperLevelOf(p, itemId) * TEMPER_PCT;
}

function materialForItem(itemId: string): string {
  const tier = item(itemId)?.tier ?? 1;
  const idx = TIER_MATERIAL_INDEX[Math.min(8, Math.max(1, tier)) - 1]!;
  return TIER_MATERIALS[idx]!;
}

export function temperCost(
  p: PlayerState,
  slot: 'weapon' | 'armor',
): { gold: number; material: string; materialQty: number } | undefined {
  const equipped = p.equipment[slot];
  if (!equipped) return undefined;
  const lvl = temperLevelOf(p, equipped);
  if (lvl >= MAX_TEMPER) return undefined;
  return {
    gold: 200 * (lvl + 1) * (lvl + 1),
    material: materialForItem(equipped),
    materialQty: lvl + 1,
  };
}

export function temper(
  p: PlayerState,
  slot: 'weapon' | 'armor',
): { ok: boolean; lines: string[] } {
  const equipped = p.equipment[slot];
  if (!equipped) return { ok: false, lines: ['Nothing equipped in that slot.'] };
  const lvl = temperLevelOf(p, equipped);
  if (lvl >= MAX_TEMPER) {
    return { ok: false, lines: [`⚒️ ${itemName(equipped)} is fully tempered (+${MAX_TEMPER}).`] };
  }
  const cost = temperCost(p, slot);
  if (!cost) return { ok: false, lines: ['The forge refuses.'] };
  if (p.gold < cost.gold) return { ok: false, lines: [`💰 Needs ${cost.gold} gold.`] };
  if (!removeItem(p, cost.material, cost.materialQty)) {
    return { ok: false, lines: [`🧱 Needs ${cost.materialQty}× ${itemName(cost.material)}.`] };
  }
  p.gold -= cost.gold;
  p.flags[temperKey(equipped)] = lvl + 1;
  return {
    ok: true,
    lines: [
      `⚒️ ${itemName(equipped)} tempered to +${lvl + 1}!`,
      `Cost: ${cost.gold} gold · ${cost.materialQty}× ${itemName(cost.material)}`,
    ],
  };
}
