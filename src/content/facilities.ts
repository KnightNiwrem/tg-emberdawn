/**
 * Location-scoped facilities (#161): independent shops and forges, each
 * with its own stable identity, authored stock/capabilities, and
 * condition-driven upgrades. Zones reference these by id
 * (`ZoneDef.services`) — presence is authored, never derived from
 * `safeHaven`, and neither facility implies the other.
 *
 * Economy contract:
 *  - the starter shop stays a beginner shop permanently; better stock
 *    requires reaching the region that carries it (#161/#163);
 *  - stock rules are the shelf's identity — resolution re-filters gear to
 *    the shopper's class and level, and the counter revalidates at
 *    mutation time (engine/shops.ts);
 *  - forge capability bounds where temper work can be done; mastery
 *    remains per item pattern (engine/forge.ts).
 * All lookups are pure.
 */

import type { ForgeDef, ShopDef } from './types.ts';
import { ZONES } from './zones.ts';

export const SHOPS: readonly ShopDef[] = [
  {
    id: 'shop_bram',
    name: "Bram's Forge-stall",
    desc:
      "The village smith's counter: honest beginner steel and hearth-side supplies, whatever your travels have made you.",
    stock: [
      {
        items: [
          'w_warrior_1',
          'a_warrior_1',
          'w_mage_1',
          'a_mage_1',
          'w_rogue_1',
          'a_rogue_1',
          'w_cleric_1',
          'a_cleric_1',
          't_1',
          't_9',
          'c_minor_potion',
          'c_minor_ether',
        ],
      },
      {
        // Steel for the Descent (#73): Bram's tier-2 rack opens exactly at
        // the m5_arms beat — quest progression, never level scaling.
        // (Trinkets ride the base shelf: the level filter already keeps
        // them honest.)
        when: { questStatus: { questId: 'm5_arms', is: ['active', 'turnIn', 'done'] } },
        items: [
          'w_warrior_2',
          'a_warrior_2',
          'w_mage_2',
          'a_mage_2',
          'w_rogue_2',
          'a_rogue_2',
          'w_cleric_2',
          'a_cleric_2',
          'c_potion',
          'c_ether',
          'c_antidote',
          'm_iron_chunk',
        ],
      },
      {
        items: ['t_2'],
      },
    ],
  },
  {
    id: 'shop_ferry',
    name: "The Ferryman's Post",
    desc:
      'Coin for crossing, supplies for the road: the post stocks what the mire eats through fastest.',
    stock: [
      {
        items: [
          'w_warrior_2',
          'a_warrior_2',
          'w_mage_2',
          'a_mage_2',
          'w_rogue_2',
          'a_rogue_2',
          'w_cleric_2',
          'a_cleric_2',
          'w_warrior_3',
          'a_warrior_3',
          'w_mage_3',
          'a_mage_3',
          'w_rogue_3',
          'a_rogue_3',
          'w_cleric_3',
          'a_cleric_3',
          't_3',
          't_10',
          'c_potion',
          'c_ether',
          'c_antidote',
          'c_smoke_bomb',
          'm_iron_chunk',
        ],
      },
      {
        // The Tyrant is gone; the deep-water traders run again.
        when: { questStatus: { questId: 'm7_tyrant', is: 'done' } },
        items: ['c_greater_potion', 'c_greater_ether', 'm_mystic_dust'],
      },
    ],
  },
  {
    id: 'shop_bazaar',
    name: 'The Confiscated Counter',
    desc: 'Ombra sells recovered travel supplies beneath a patched awning beside the sundials.',
    stock: [
      {
        items: [
          'w_warrior_3',
          'a_warrior_3',
          'w_mage_3',
          'a_mage_3',
          'w_rogue_3',
          'a_rogue_3',
          'w_cleric_3',
          'a_cleric_3',
          'w_warrior_4',
          'a_warrior_4',
          'w_mage_4',
          'a_mage_4',
          'w_rogue_4',
          'a_rogue_4',
          'w_cleric_4',
          'a_cleric_4',
          't_4',
          't_5',
          'c_potion',
          'c_ether',
          'c_smoke_bomb',
          'c_greater_potion',
          'm_mystic_dust',
        ],
      },
      {
        // The hour-vault stands open; the road north is provisioned.
        when: { questStatus: { questId: 'm12_chronolich', is: 'done' } },
        items: ['m_frost_core'],
      },
    ],
  },
  {
    id: 'shop_outcast',
    name: "Rho's Trading Post",
    desc: 'The Ice-Outcast trades with whoever still walks. Prices honest, conversation optional.',
    stock: [
      {
        items: [
          'w_warrior_5',
          'a_warrior_5',
          'w_mage_5',
          'a_mage_5',
          'w_rogue_5',
          'a_rogue_5',
          'w_cleric_5',
          'a_cleric_5',
          'w_warrior_6',
          'a_warrior_6',
          'w_mage_6',
          'a_mage_6',
          'w_rogue_6',
          'a_rogue_6',
          'w_cleric_6',
          'a_cleric_6',
          't_6',
          't_7',
          'c_greater_potion',
          'c_greater_ether',
          'c_smoke_bomb',
          'm_frost_core',
        ],
      },
      {
        // The wyrm sleeps; the ashward caravans trade through the pass.
        when: { questStatus: { questId: 'm15_wyrm', is: 'done' } },
        items: ['c_super_potion', 'm_cinder_heart'],
      },
    ],
  },
  {
    id: 'shop_ashcaravan',
    name: 'The Ash Caravan',
    desc:
      'Merchant wains that cross the Wastes by routes their drivers refuse to name. Crownsteel costs extra.',
    stock: [
      {
        items: [
          'w_warrior_6',
          'a_warrior_6',
          'w_mage_6',
          'a_mage_6',
          'w_rogue_6',
          'a_rogue_6',
          'w_cleric_6',
          'a_cleric_6',
          'w_warrior_7',
          'a_warrior_7',
          'w_mage_7',
          'a_mage_7',
          'w_rogue_7',
          'a_rogue_7',
          'w_cleric_7',
          'a_cleric_7',
          't_7',
          't_11',
          'c_super_potion',
          'c_greater_ether',
          'c_smoke_bomb',
          'm_cinder_heart',
        ],
      },
      {
        // Crownsteel from the King's own armories — after the Last Flame
        // is free, the caravan's drivers will talk about where it came from.
        // Clearly authored local pricing (+25%), disclosed on the shelf.
        when: { questStatus: { questId: 'm19_ignivar', is: 'done' } },
        pricePct: 1.25,
        items: [
          'w_warrior_8',
          'a_warrior_8',
          'w_mage_8',
          'a_mage_8',
          'w_rogue_8',
          'a_rogue_8',
          'w_cleric_8',
          'a_cleric_8',
          't_8',
          'c_elixir',
          'm_void_fragment',
        ],
      },
    ],
  },
];

export const FORGES: readonly ForgeDef[] = [
  {
    id: 'forge_bram',
    name: "Bram's Anvil",
    desc:
      'The village forge, older than its chimney. Bram keeps the family tools beside a map of the hearth channels.',
    capabilities: {
      slots: ['weapon', 'armor'],
      maxTemper: 5,
    },
  },
  {
    id: 'forge_ropewalk',
    name: 'The Ropewalk Forge',
    desc:
      "Boat fittings hang above Odo's anvil. The heavier tools arrive by river when the shrine's sluices run again.",
    capabilities: {
      slots: ['weapon', 'armor'],
      maxTemper: 3,
      upgrades: [
        {
          name: 'Deep-water craft',
          // The Sunken Shrine cleared: tools and techniques travel downriver.
          when: { flag: { id: 'sunkenCleared' } },
          maxTemper: 5,
        },
      ],
    },
  },
  {
    id: 'forge_warden',
    name: "The Warden's Cold Anvil",
    desc:
      'A Forge Warden still works this smithy, centuries after it burned. It hammers only what it understands.',
    capabilities: {
      slots: ['weapon'],
      maxTemper: 4,
      upgrades: [
        {
          name: 'The Warden bows',
          // Pyre Caldera cleared: the Warden acknowledges the Flame's claim.
          when: { flag: { id: 'pyreCleared' } },
          slots: ['weapon', 'armor'],
          maxTemper: 5,
        },
      ],
    },
  },
];

const SHOP_INDEX = new Map(SHOPS.map((s) => [s.id, s]));
const FORGE_INDEX = new Map(FORGES.map((f) => [f.id, f]));

export function shop(id: string): ShopDef | undefined {
  return SHOP_INDEX.get(id);
}

export function forge(id: string): ForgeDef | undefined {
  return FORGE_INDEX.get(id);
}

/** The shop AUTHORED in this zone — presence, not authorization. */
export function shopInZone(zoneId: string): ShopDef | undefined {
  const z = ZONE_SERVICES_LOOKUP.get(zoneId);
  return z?.shop ? shop(z.shop) : undefined;
}

/** The forge AUTHORED in this zone — presence, not authorization. */
export function forgeInZone(zoneId: string): ForgeDef | undefined {
  const z = ZONE_SERVICES_LOOKUP.get(zoneId);
  return z?.forge ? forge(z.forge) : undefined;
}

const ZONE_SERVICES_LOOKUP = new Map(ZONES.map((z) => [z.id, z.services ?? {}]));
