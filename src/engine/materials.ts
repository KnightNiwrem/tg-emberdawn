/** Resource directions and uses derived from the live catalogs. */
import { RECIPES } from '../content/crafting.ts';
import { ENEMIES } from '../content/enemies.ts';
import { SHOPS } from '../content/facilities.ts';
import { GATHERING_SITES } from '../content/gathering.ts';
import { item, sellPrice } from '../content/items.ts';
import { dropTable } from '../content/loot.ts';
import { zone, ZONES } from '../content/zones.ts';
import { temperMaterialsForTier } from './forge.ts';

export function materialUses(id: string): string[] {
  const uses: string[] = [];
  const tools = GATHERING_SITES.filter((s) => s.tool === id);
  if (tools.length) {
    uses.push(
      `Reusable gathering tool: ${
        [...new Set(tools.map((s) => s.activity))].join(', ')
      }. Keep it in your bag.`,
    );
  }
  if (GATHERING_SITES.some((s) => s.baitTables && Object.hasOwn(s.baitTables, id))) {
    uses.push(
      'Fishing bait: one is consumed per cast. Choose bait at a fishing site to see its catch table.',
    );
  }
  const recipes = RECIPES.filter((r) => r.inputs.some((m) => m.id === id));
  if (recipes.length) uses.push(`Recipes: ${recipes.map((r) => r.name).join(', ')}.`);
  const tiers = Array.from({ length: 8 }, (_, i) => i + 1).filter((tier) =>
    (['weapon', 'armor'] as const).some((slot) => temperMaterialsForTier(tier, slot).includes(id))
  );
  if (tiers.length) uses.push(`Tempering material for equipment tiers ${tiers.join(', ')}.`);
  if (!uses.length && item(id)?.kind === 'material') {
    uses.push('Trade good: no current workshop or tempering use.');
  }
  return uses;
}

export function materialSources(id: string): string[] {
  const sources: string[] = [];
  const gathered = GATHERING_SITES.filter((s) =>
    s.yields.some((y) => y.item === id) ||
    Object.values(s.baitTables ?? {}).some((ys) => ys.some((y) => y.item === id))
  );
  for (const s of gathered) sources.push(`${s.label}: ${zone(s.zoneId)!.name}`);
  const explored = ZONES.filter((z) =>
    z.explore.some((e) => e.kind === 'treasure' && e.item === id)
  );
  if (explored.length) sources.push(`Search / explore: ${explored.map((z) => z.name).join(', ')}`);
  const enemies = ENEMIES.filter((e) => Object.hasOwn(e.drops ?? {}, id));
  if (enemies.length) sources.push(`Monster loot: ${enemies.map((e) => e.name).join(', ')}`);
  const local = ZONES.filter((z) =>
    z.lootTable && dropTable(z.lootTable)?.entries.some((e) => e.item === id)
  );
  if (local.length) sources.push(`Regional battle finds: ${local.map((z) => z.name).join(', ')}`);
  const shops = SHOPS.filter((s) => s.stock.some((g) => g.items.includes(id)));
  if (shops.length) {
    sources.push(`Shops (local stock requirements apply): ${shops.map((s) => s.name).join(', ')}`);
  }
  for (const r of RECIPES.filter((r) => r.output.id === id)) {
    sources.push(`${r.name}: ${r.zones.map((z) => zone(z)!.name).join(', ')}`);
  }
  return sources;
}

export function resourceFacts(id: string): string[] {
  const def = item(id);
  if (
    !def || (def.kind !== 'material' && !RECIPES.some((r) => r.inputs.some((m) => m.id === id)))
  ) return [];
  return [
    ...materialUses(id),
    `Sells for ${sellPrice(id)}g each at a shop.`,
    ...materialSources(id),
  ];
}
