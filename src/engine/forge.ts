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

import { DUNGEON_BLOCK } from './dungeon_run.ts';
import type { MaterialCost } from '../content/crafting.ts';
import type { PlayerState } from './types.ts';
import type { ForgeDef } from '../content/types.ts';
import { forgeInZone } from '../content/facilities.ts';
import { countOf, removeItem } from './inventory.ts';
import { item, itemName } from '../content/items.ts';
import { evalCondition } from './conditions.ts';
import { JOURNEY_BLOCK } from './routes.ts';

export const MAX_TEMPER = 5;

const TEMPER_PCT = 0.08; // +8% of the item's own stats per temper level

/** Inputs follow the equipment tier even when working at an earlier forge. */
export function temperMaterialsForTier(tier: number, slot: 'weapon' | 'armor'): string[] {
  const materials = [
    ['m_ember_shard', slot === 'weapon' ? 'm_hardwood' : 'm_plant_fiber'],
    ['m_iron_ingot', 'm_hide'],
    ['m_mystic_dust', slot === 'weapon' ? 'm_reed' : 'm_spider_silk'],
    ['m_mystic_dust', slot === 'weapon' ? 'm_sunstone' : 'm_quartz'],
    ['m_frost_core', slot === 'weapon' ? 'm_silver_ore' : 'm_thick_fur'],
    ['m_cinder_heart', 'm_obsidian'],
    ['m_cinder_heart', 'm_night_silk'],
    ['m_void_fragment', 'm_black_iron'],
  ];
  return materials[Math.min(8, Math.max(1, tier)) - 1]!;
}

function temperKey(itemId: string): string {
  return `forge_i_${itemId}`;
}

/** Temper level bound to a specific item id (not a slot). */
function temperLevelOf(player: PlayerState, itemId: string | undefined): number {
  if (!itemId) return 0;
  const level = player.flags[temperKey(itemId)];
  return typeof level === 'number' ? level : 0;
}

/** Temper level of whatever is equipped in the slot (for UI). */
export function temperLevel(player: PlayerState, slot: 'weapon' | 'armor'): number {
  return temperLevelOf(player, player.equipment[slot]);
}

/** Stat multiplier contribution of an item's temper level. */
export function temperBonusOf(player: PlayerState, itemId: string | undefined): number {
  return temperLevelOf(player, itemId) * TEMPER_PCT;
}

/** The forge authored at the player's current zone, if any. */
export function forgeAt(player: PlayerState): ForgeDef | undefined {
  return forgeInZone(player.currentZone);
}

/** Resolved capability of the CURRENT forge for THIS player: base limits
 * with every passing upgrade applied in authored order (#161). */
export function forgeCapability(
  player: PlayerState,
  at?: ForgeDef,
): { slots: Set<'weapon' | 'armor'>; maxTemper: number } | undefined {
  const def = at ?? forgeAt(player);
  if (!def) return undefined;
  const caps = def.capabilities;
  const slots = new Set(caps.slots);
  let maxTemper = caps.maxTemper;
  for (const up of caps.upgrades ?? []) {
    if (!evalCondition(player, up.when)) continue;
    if (up.slots) { for (const slot of up.slots) slots.add(slot); }
    if (up.maxTemper !== undefined) maxTemper = Math.max(maxTemper, up.maxTemper);
  }
  return { slots, maxTemper: Math.min(MAX_TEMPER, maxTemper) };
}

export interface TemperCost {
  gold: number;
  materials: MaterialCost[];
}

export type TemperQuote =
  | { ok: false; refusal: string }
  | { ok: true; itemId: string; level: number; cost: TemperCost };

/** Resolve the equipped pattern, local capability, and next cost together.
 * Renderers may share their freshly resolved capability across slots. Mutations
 * call this with live state, never with a quote or capability from the UI. */
export function temperQuote(
  player: PlayerState,
  slot: 'weapon' | 'armor',
  capability = forgeCapability(player),
): TemperQuote {
  const refuse = (refusal: string): TemperQuote => ({ ok: false, refusal });
  if (!capability) return refuse('There is no forge here.');
  if (!capability.slots.has(slot)) {
    return refuse(
      slot === 'weapon'
        ? "⚒️ This forge doesn't work weapons."
        : "⚒️ This forge doesn't work armor.",
    );
  }
  const itemId = player.equipment[slot];
  if (!itemId) return refuse('Nothing equipped in that slot.');
  const level = temperLevelOf(player, itemId);
  if (level >= capability.maxTemper) {
    return refuse(
      level >= MAX_TEMPER
        ? `⚒️ ${itemName(itemId)} is fully tempered (+${MAX_TEMPER}).`
        : `⚒️ ${itemName(itemId)} is beyond this forge's craft (+${capability.maxTemper} here).`,
    );
  }
  const tier = item(itemId)!.tier;
  return {
    ok: true,
    itemId,
    level,
    cost: {
      gold: 15 * tier * (level + 1),
      materials: temperMaterialsForTier(tier, slot).map((id, index) => ({
        id,
        qty: level + 1 + index,
      })),
    },
  };
}

/** Refusal-only projection for callers that need guidance. */
export function temperBlock(player: PlayerState, slot: 'weapon' | 'armor'): string | undefined {
  const quote = temperQuote(player, slot);
  return quote.ok ? undefined : quote.refusal;
}

/** Cost-only projection for callers that need a preview. */
export function temperCost(player: PlayerState, slot: 'weapon' | 'armor'): TemperCost | undefined {
  const quote = temperQuote(player, slot);
  return quote.ok ? quote.cost : undefined;
}

export function temper(
  player: PlayerState,
  slot: 'weapon' | 'armor',
): { ok: boolean; lines: string[] } {
  // Server-side authority (#161): facility, capability, item, cost and
  // materials are all revalidated here — never trusted from a render.
  // A fight forbids the anvil, and so does a live crossing (#166 —
  // enforced at the central mutation, not only in the handler).
  if (player.battle) return { ok: false, lines: ['⚔️ Finish the fight first.'] };
  if (player.dungeonRun) return { ok: false, lines: [DUNGEON_BLOCK] };
  if (player.journey) return { ok: false, lines: [JOURNEY_BLOCK] };
  const quote = temperQuote(player, slot);
  if (!quote.ok) return { ok: false, lines: [quote.refusal] };
  const { itemId, level, cost } = quote;
  if (player.gold < cost.gold) return { ok: false, lines: [`💰 Needs ${cost.gold} gold.`] };
  const missing = cost.materials.filter((mat) => countOf(player, mat.id) < mat.qty);
  if (missing.length) {
    return {
      ok: false,
      lines: [`🧱 Needs ${missing.map((mat) => `${mat.qty}× ${itemName(mat.id)}`).join(' · ')}.`],
    };
  }
  for (const mat of cost.materials) removeItem(player, mat.id, mat.qty);
  player.gold -= cost.gold;
  player.flags[temperKey(itemId)] = level + 1;
  return {
    ok: true,
    lines: [
      `⚒️ ${itemName(itemId)} tempered to +${level + 1}!`,
      `Cost: ${cost.gold} gold · ${
        cost.materials.map((mat) => `${mat.qty}× ${itemName(mat.id)}`).join(' · ')
      }`,
    ],
  };
}
