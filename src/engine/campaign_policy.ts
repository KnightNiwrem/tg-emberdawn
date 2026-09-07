/** Read-only campaign shopping decisions. Execution stays in driveQuests. */
import type { PlayerState } from './types.ts';
import { isEquippable, item as itemDef } from '../content/items.ts';
import { shopInZone } from '../content/facilities.ts';
import { ZONES } from '../content/zones.ts';
import { findRoutePath } from './pathfinding.ts';
import { resolveStock, type ShopOffering } from './shops.ts';

export function statWeight(itemId: string): number {
  const stats = itemDef(itemId)?.stats ?? {};
  return (stats.atk ?? 0) + (stats.def ?? 0) + (stats.mag ?? 0) + (stats.res ?? 0) +
    (stats.spd ?? 0) +
    (stats.luck ?? 0) + (stats.hp ?? 0) / 4 + (stats.mp ?? 0) / 2;
}

/** Equal-distance counters retain catalog order, which is part of seeded policy. */
function nearestShop(
  player: PlayerState,
  acceptsStock: (stock: readonly ShopOffering[]) => boolean,
): string | undefined {
  let nearest: { zoneId: string; distance: number } | undefined;
  for (const zone of ZONES) {
    if (!player.unlockedZones.includes(zone.id) || !shopInZone(zone.id)) continue;
    const stock = resolveStock({ ...player, currentZone: zone.id });
    if (!acceptsStock(stock)) continue;
    const path = findRoutePath(player, (zoneId) => zoneId === zone.id);
    if (!path) continue;
    if (!nearest || path.length < nearest.distance) {
      nearest = { zoneId: zone.id, distance: path.length };
    }
  }
  return nearest?.zoneId;
}

export function nearestSupplyShop(
  player: PlayerState,
  healingItems: readonly string[],
): string | undefined {
  return nearestShop(
    player,
    (stock) => stock.some((offering) => healingItems.includes(offering.itemId)),
  );
}

/** An upgrade must leave 30 gold for supplies. Only its existence affects the trip. */
export function nearestUpgradeShop(player: PlayerState): string | undefined {
  const currentWeights = {
    weapon: statWeight(player.equipment.weapon ?? ''),
    armor: statWeight(player.equipment.armor ?? ''),
  };
  return nearestShop(player, (stock) =>
    stock.some((offering) => {
      const itemId = offering.itemId;
      const kind = itemId.startsWith('w_')
        ? 'weapon'
        : itemId.startsWith('a_')
        ? 'armor'
        : undefined;
      return kind !== undefined && offering.price <= player.gold - 30 &&
        isEquippable(itemId, player.classId, player.level).ok &&
        statWeight(itemId) > currentWeights[kind];
    }));
}
