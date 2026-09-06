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

/** One source per entry, so a reference page can paginate without truncating directions. */
export function materialSources(id: string): string[] {
  const sources: string[] = [];
  for (const s of GATHERING_SITES) {
    const bait = Object.entries(s.baitTables ?? {}).filter(([, ys]) =>
      ys.some((y) => y.item === id)
    );
    if (!s.yields.some((y) => y.item === id) && !bait.length) continue;
    const needs = [
      s.tool ? `Tool: ${itemName(s.tool)}` : '',
      bait.length ? `Bait: ${bait.map(([id]) => itemName(id)).join(' or ')}` : '',
    ].filter(Boolean);
    sources.push(
      `${s.label}: ${zone(s.zoneId)!.name}${needs.length ? `\n${needs.join('\n')}` : ''}`,
    );
  }
  for (const z of ZONES) {
    if (z.explore.some((e) => e.kind === 'treasure' && e.item === id)) {
      sources.push(`Search / explore: ${z.name}`);
    }
    if (z.lootTable && dropTable(z.lootTable)?.entries.some((e) => e.item === id)) {
      sources.push(`Regional battle finds: ${z.name}`);
    }
    for (const [i, f] of (z.dungeon?.floors ?? []).entries()) {
      if (f.treasure?.item === id) {
        sources.push(`First-visit cache: ${z.dungeon!.name}\n${z.name} · Floor ${i + 1}`);
      }
    }
    if (z.dungeon?.firstClear?.item === id) {
      sources.push(`First-clear reward: ${z.dungeon.name}\n${z.name}`);
    }
  }
  for (const e of ENEMIES.filter((e) => (e.drops?.[id] ?? 0) > 0)) {
    sources.push(`Monster loot: ${e.name}`);
  }
  for (const shop of SHOPS.filter((s) => s.stock.some((g) => g.items.includes(id)))) {
    const places = ZONES.filter((z) => z.services?.shop === shop.id);
    for (const z of places) {
      sources.push(`Shop: ${shop.name}\n${z.name} · Local stock requirements apply`);
    }
  }
  for (const r of RECIPES.filter((r) => r.output.id === id)) {
    for (const z of r.zones) sources.push(`${r.name}: ${zone(z)!.name}`);
  }
  for (const q of QUESTS.filter((q) => q.rewards.items?.[id])) {
    sources.push(`Quest reward: ${q.name}`);
  }
  return sources;
}

export function resourceFacts(id: string): string[] {
  const def = item(id);
  if (
    !def || (def.kind !== 'material' && !RECIPES.some((r) => r.inputs.some((m) => m.id === id)))
  ) return [];
  return materialUses(id);
}
