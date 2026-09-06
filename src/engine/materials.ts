/** Resource directions and uses derived from the live catalogs. */
import { RECIPES } from '../content/crafting.ts';
import { ENEMIES } from '../content/enemies.ts';
import { SHOPS } from '../content/facilities.ts';
import { GATHERING_SITES } from '../content/gathering.ts';
import { item, itemName } from '../content/items.ts';
import { QUESTS } from '../content/quests.ts';
import { dropTable } from '../content/loot.ts';
import { zone, ZONES } from '../content/zones.ts';
import { temperMaterialsForTier } from './forge.ts';

export function materialUses(id: string): string[] {
  const uses: string[] = [];
  const tools = GATHERING_SITES.filter((site) => site.tool === id);
  if (tools.length) {
    uses.push(
      `Reusable gathering tool: ${
        [...new Set(tools.map((site) => site.activity))].join(', ')
      }. Keep it in your bag.`,
    );
  }
  if (GATHERING_SITES.some((site) => site.baitTables && Object.hasOwn(site.baitTables, id))) {
    uses.push(
      'Fishing bait: one is consumed per cast. Choose bait at a fishing site to see its catch table.',
    );
  }
  const recipes = RECIPES.filter((recipe) => recipe.inputs.some((input) => input.id === id));
  if (recipes.length) uses.push(`Recipes: ${recipes.map((recipe) => recipe.name).join(', ')}.`);
  const tiers = Array.from({ length: 8 }, (_, i) => i + 1).filter((tier) =>
    (['weapon', 'armor'] as const).some((slot) => temperMaterialsForTier(tier, slot).includes(id))
  );
  if (tiers.length) uses.push(`Tempering material for equipment tiers ${tiers.join(', ')}.`);
  if (!uses.length && item(id)?.kind === 'material') {
    uses.push('Trade good: no current workshop or tempering use.');
  }
  return uses;
}

/** One source per entry, so a reference page can paginate without truncating directions. */
export function materialSources(id: string): string[] {
  const sources: string[] = [];
  for (const site of GATHERING_SITES) {
    const bait = Object.entries(site.baitTables ?? {}).filter(([, dropList]) =>
      dropList.some((drop) => drop.item === id)
    );
    if (!site.yields.some((drop) => drop.item === id) && !bait.length) continue;
    const needs = [
      site.tool ? `Tool: ${itemName(site.tool)}` : '',
      bait.length ? `Bait: ${bait.map(([baitId]) => itemName(baitId)).join(' or ')}` : '',
    ].filter(Boolean);
    sources.push(
      `${site.label}: ${zone(site.zoneId)!.name}${needs.length ? `\n${needs.join('\n')}` : ''}`,
    );
  }
  for (const zoneDef of ZONES) {
    if (
      zoneDef.explore.some((encounter) => encounter.kind === 'treasure' && encounter.item === id)
    ) {
      sources.push(`Search / explore: ${zoneDef.name}`);
    }
    if (
      zoneDef.lootTable && dropTable(zoneDef.lootTable)?.entries.some((entry) => entry.item === id)
    ) {
      sources.push(`Regional battle finds: ${zoneDef.name}`);
    }
    for (const [floorIndex, floor] of (zoneDef.dungeon?.floors ?? []).entries()) {
      if (floor.treasure?.item === id) {
        sources.push(
          `First-visit cache: ${zoneDef.dungeon!.name}\n${zoneDef.name} · Floor ${floorIndex + 1}`,
        );
      }
    }
    if (zoneDef.dungeon?.firstClear?.item === id) {
      sources.push(`First-clear reward: ${zoneDef.dungeon.name}\n${zoneDef.name}`);
    }
  }
  for (const enemyDef of ENEMIES.filter((enemyDef) => (enemyDef.drops?.[id] ?? 0) > 0)) {
    sources.push(`Monster loot: ${enemyDef.name}`);
  }
  for (
    const shop of SHOPS.filter((shopDef) => shopDef.stock.some((group) => group.items.includes(id)))
  ) {
    const places = ZONES.filter((zoneDef) => zoneDef.services?.shop === shop.id);
    for (const place of places) {
      sources.push(`Shop: ${shop.name}\n${place.name} · Local stock requirements apply`);
    }
  }
  for (const recipe of RECIPES.filter((r) => r.output.id === id)) {
    for (const zoneId of recipe.zones) sources.push(`${recipe.name}: ${zone(zoneId)!.name}`);
  }
  for (const questDef of QUESTS.filter((q) => q.rewards.items?.[id])) {
    sources.push(`Quest reward: ${questDef.name}`);
  }
  return sources;
}

export function resourceFacts(id: string): string[] {
  const def = item(id);
  if (
    !def ||
    (def.kind !== 'material' &&
      !RECIPES.some((recipe) => recipe.inputs.some((input) => input.id === id)))
  ) return [];
  return materialUses(id);
}

export interface ItemUseGroup {
  title: string;
  description?: string;
  entries: { title: string; detail?: string }[];
}

/** Production and gathering roles, kept structured for sectioned reference pages. */
export function itemUseGroups(id: string): ItemUseGroup[] {
  const groups: ItemUseGroup[] = [];
  const recipes = RECIPES.filter((recipe) => recipe.inputs.some((input) => input.id === id));
  if (recipes.length) {
    groups.push({
      title: 'Recipes',
      entries: recipes.map((recipe) => ({
        title: recipe.name,
        detail: `Consumes ${
          recipe.inputs.filter((input) => input.id === id).reduce(
            (sum, input) => sum + input.qty,
            0,
          )
        } per batch\nProduces: ${
          itemName(recipe.output.id)
        } ×${recipe.output.qty}\nRequired level: ${recipe.level}`,
      })),
    });
  }
  const tiers = Array.from({ length: 8 }, (_, i) => i + 1).flatMap((tier) => {
    const slots = (['weapon', 'armor'] as const).filter((slot) =>
      temperMaterialsForTier(tier, slot).includes(id)
    );
    return slots.length
      ? [{
        title: `Tier ${tier}`,
        detail: slots.length === 2
          ? 'Weapons and armor'
          : slots[0] === 'weapon'
          ? 'Weapons'
          : 'Armor',
      }]
      : [];
  });
  if (tiers.length) {
    groups.push({
      title: 'Tempering',
      description: 'Consumed at a forge. Quantity depends on the temper level.',
      entries: tiers,
    });
  }
  for (
    const [activity, title] of [['fish', 'Fishing'], ['mine', 'Mining'], [
      'forage',
      'Foraging',
    ]] as const
  ) {
    const sites = GATHERING_SITES.filter((site) =>
      site.activity === activity && (site.tool === id || Object.hasOwn(site.baitTables ?? {}, id))
    );
    if (!sites.length) continue;
    const reusable = sites.every((site) => site.tool === id);
    groups.push({
      title,
      description: reusable ? 'Reusable tool. Keep it in your bag.' : 'Bait: 1 consumed per cast.',
      entries: sites.map((site) => ({
        title: zone(site.zoneId)!.name,
        detail: site.tool === id
          ? undefined
          : site.tool
          ? `Tool: ${itemName(site.tool)}`
          : undefined,
      })),
    });
  }
  if (!groups.length && item(id)?.kind === 'material') {
    groups.push({
      title: 'Trading',
      entries: [{ title: 'Trade good', detail: 'Sell at a shop.' }],
    });
  }
  return groups;
}
