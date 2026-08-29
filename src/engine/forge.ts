/**
 * The Forge: temper equipped weapon/armor for permanent stat boosts.
 * Temper level 0..MAX; tracked in player flags. Costs gold + a material
 * appropriate to the player's progression.
 */

import type { PlayerState } from './types.ts';
import { removeItem } from './inventory.ts';
import { itemName } from '../content/items.ts';
import { zoneTier } from '../content/zones.ts';

export const MAX_TEMPER = 5;

const TEMPER_PCT = 0.08; // +8% of the item's base stats per temper level

const TIER_MATERIALS = [
  'm_ember_shard',
  'm_iron_chunk',
  'm_mystic_dust',
  'm_frost_core',
  'm_cinder_heart',
  'm_void_fragment',
] as const;

export function temperLevel(p: PlayerState, slot: 'weapon' | 'armor'): number {
  const v = p.flags[`forge_${slot}`];
  return typeof v === 'number' ? v : 0;
}

export function forgeMaterial(p: PlayerState): string {
  const tier = Math.min(TIER_MATERIALS.length, Math.max(1, zoneTier(p.currentZone))) - 1;
  return TIER_MATERIALS[tier]!;
}

export function temperCost(
  p: PlayerState,
  slot: 'weapon' | 'armor',
): { gold: number; material: string; materialQty: number } | undefined {
  const lvl = temperLevel(p, slot);
  if (lvl >= MAX_TEMPER) return undefined;
  return {
    gold: 200 * (lvl + 1) * (lvl + 1),
    material: forgeMaterial(p),
    materialQty: lvl + 1,
  };
}

export function temper(
  p: PlayerState,
  slot: 'weapon' | 'armor',
): { ok: boolean; lines: string[] } {
  const equipped = p.equipment[slot];
  if (!equipped) return { ok: false, lines: ['Nothing equipped in that slot.'] };
  const lvl = temperLevel(p, slot);
  if (lvl >= MAX_TEMPER) {
    return { ok: false, lines: [`⚒️ Your ${slot} is fully tempered (+${MAX_TEMPER}).`] };
  }
  const cost = temperCost(p, slot);
  if (!cost) return { ok: false, lines: ['The forge refuses.'] };
  if (p.gold < cost.gold) return { ok: false, lines: [`💰 Needs ${cost.gold} gold.`] };
  if (!removeItem(p, cost.material, cost.materialQty)) {
    return { ok: false, lines: [`🧱 Needs ${cost.materialQty}× ${itemName(cost.material)}.`] };
  }
  p.gold -= cost.gold;
  p.flags[`forge_${slot}`] = lvl + 1;
  return {
    ok: true,
    lines: [
      `⚒️ ${slot === 'weapon' ? 'Weapon' : 'Armor'} tempered to +${lvl + 1}!`,
      `Cost: ${cost.gold} gold · ${cost.materialQty}× ${itemName(cost.material)}`,
    ],
  };
}

/** Forge stat bonuses applied in derived stats. */
export function forgeBonus(p: PlayerState, slot: 'weapon' | 'armor'): number {
  return temperLevel(p, slot) * TEMPER_PCT;
}
