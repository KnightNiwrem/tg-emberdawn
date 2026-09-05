/**
 * The Forge: temper the EQUIPPED weapon/armor. Ownership model (#24, made
 * explicit): temper is ITEM-PATTERN MASTERY — state lives in flags
 * `forge_i_<itemId>`, keyed by CATALOG id, so every copy of that pattern
 * shares it. Tempering one sword to +5 means every future copy of the same
 * pattern (bought, looted, re-forged) fights at +5: the forge is a bounded
 * per-pattern sink, and replacement loot inherits your forge-work.
 * Material tier derives from the ITEM's tier — no more tempering endgame
 * gear with cheap chapter-1 shards after a quick trip back to the village.
 *
 * Facility authority (#161): tempering happens AT a forge — the current
 * zone must author one, its capability (slots, temper ceiling, upgrades)
 * is resolved from live state, and everything revalidates at mutation
 * time. Local capability bounds WHERE work can be done, never what the
 * work is worth.
 */

import type { PlayerState } from './types.ts';
import type { ForgeDef } from '../content/types.ts';
import { forgeInZone } from '../content/facilities.ts';
import { removeItem } from './inventory.ts';
import { item, itemName } from '../content/items.ts';
import { evalCondition } from './conditions.ts';
import { JOURNEY_BLOCK } from './routes.ts';

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

/** The forge authored at the player's current zone, if any. */
export function forgeAt(p: PlayerState): ForgeDef | undefined {
  return forgeInZone(p.currentZone);
}

/** Resolved capability of the CURRENT forge for THIS player: base limits
 * with every passing upgrade applied in authored order (#161). */
export function forgeCapability(
  p: PlayerState,
  at?: ForgeDef,
): { slots: Set<'weapon' | 'armor'>; maxTemper: number } | undefined {
  const def = at ?? forgeAt(p);
  if (!def) return undefined;
  const caps = def.capabilities;
  const slots = new Set(caps.slots);
  let maxTemper = caps.maxTemper;
  for (const up of caps.upgrades ?? []) {
    if (!evalCondition(p, up.when)) continue;
    if (up.slots) { for (const s of up.slots) slots.add(s); }
    if (up.maxTemper !== undefined) maxTemper = Math.max(maxTemper, up.maxTemper);
  }
  return { slots, maxTemper: Math.min(MAX_TEMPER, maxTemper) };
}

/** Why the current forge cannot temper this slot right now — for UI copy
 * and for the engine's own revalidation. undefined = the work may proceed. */
export function temperBlock(
  p: PlayerState,
  slot: 'weapon' | 'armor',
): string | undefined {
  const caps = forgeCapability(p);
  if (!caps) return 'There is no forge here.';
  if (!caps.slots.has(slot)) {
    return slot === 'weapon'
      ? "⚒️ This forge doesn't work weapons."
      : "⚒️ This forge doesn't work armor.";
  }
  const equipped = p.equipment[slot];
  if (!equipped) return 'Nothing equipped in that slot.';
  if (temperLevelOf(p, equipped) >= caps.maxTemper) {
    return temperLevelOf(p, equipped) >= MAX_TEMPER
      ? `⚒️ ${itemName(equipped)} is fully tempered (+${MAX_TEMPER}).`
      : `⚒️ ${itemName(equipped)} is beyond this forge's craft (+${caps.maxTemper} here).`;
  }
  return undefined;
}

function materialForItem(itemId: string): string {
  const tier = item(itemId)?.tier ?? 1;
  const idx = TIER_MATERIAL_INDEX[Math.min(8, Math.max(1, tier)) - 1]!;
  return TIER_MATERIALS[idx]!;
}

/** Cost of the NEXT temper at the current forge — undefined when the
 * forge cannot (or need not) temper the slot further. */
export function temperCost(
  p: PlayerState,
  slot: 'weapon' | 'armor',
): { gold: number; material: string; materialQty: number } | undefined {
  if (temperBlock(p, slot)) return undefined;
  const equipped = p.equipment[slot]!;
  const lvl = temperLevelOf(p, equipped);
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
  // Server-side authority (#161): facility, capability, item, cost and
  // materials are all revalidated here — never trusted from a render.
  // A fight forbids the anvil, and so does a live crossing (#166 —
  // enforced at the central mutation, not only in the handler).
  if (p.battle) return { ok: false, lines: ['⚔️ Finish the fight first.'] };
  if (p.journey) return { ok: false, lines: [JOURNEY_BLOCK] };
  const block = temperBlock(p, slot);
  if (block) return { ok: false, lines: [block] };
  const equipped = p.equipment[slot]!;
  const cost = temperCost(p, slot);
  if (!cost) return { ok: false, lines: ['The forge refuses.'] };
  if (p.gold < cost.gold) return { ok: false, lines: [`💰 Needs ${cost.gold} gold.`] };
  if (!removeItem(p, cost.material, cost.materialQty)) {
    return { ok: false, lines: [`🧱 Needs ${cost.materialQty}× ${itemName(cost.material)}.`] };
  }
  p.gold -= cost.gold;
  const lvl = temperLevelOf(p, equipped);
  p.flags[temperKey(equipped)] = lvl + 1;
  return {
    ok: true,
    lines: [
      `⚒️ ${itemName(equipped)} tempered to +${lvl + 1}!`,
      `Cost: ${cost.gold} gold · ${cost.materialQty}× ${itemName(cost.material)}`,
    ],
  };
}
