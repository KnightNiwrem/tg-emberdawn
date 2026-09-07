/** Local processing catalogs. Recipes turn gathered supplies into road provisions. */
export interface MaterialCost {
  id: string;
  qty: number;
}

export interface RecipeDef {
  id: string;
  name: string;
  station: 'brew' | 'cook' | 'smelt';
  level: number;
  zones: readonly string[];
  inputs: readonly MaterialCost[];
  output: MaterialCost;
  gold: number;
}

const HEARTHS = ['emberdawn', 'mirefoot', 'hollowmere', 'sunspire', 'frostpeak', 'cinder'];
const BREWERS = ['emberdawn', 'hollowmere', 'sunspire', 'frostpeak', 'cinder'];
const ANVILS = ['emberdawn', 'mirefoot', 'cinder'];

export const RECIPES: readonly RecipeDef[] = [
  {
    id: 'fishing_rod',
    name: 'Make Fishing Rod',
    station: 'smelt',
    level: 1,
    zones: ANVILS,
    inputs: [{ id: 'm_hardwood', qty: 1 }, { id: 'm_plant_fiber', qty: 2 }, {
      id: 'm_bone',
      qty: 1,
    }],
    output: { id: 'm_fishing_rod', qty: 1 },
    gold: 3,
  },
  {
    id: 'pickaxe',
    name: 'Make Pickaxe',
    station: 'smelt',
    level: 1,
    zones: ANVILS,
    inputs: [{ id: 'm_iron_ingot', qty: 1 }, { id: 'm_hardwood', qty: 1 }],
    output: { id: 'm_pickaxe', qty: 1 },
    gold: 5,
  },
  {
    id: 'charcoal',
    name: 'Fire charcoal',
    station: 'smelt',
    level: 1,
    zones: ANVILS,
    inputs: [{ id: 'm_charred_wood', qty: 2 }, { id: 'm_clay', qty: 1 }],
    output: { id: 'm_coal', qty: 2 },
    gold: 2,
  },
  {
    id: 'grilled_trout',
    name: 'Grill trout',
    station: 'cook',
    level: 1,
    zones: HEARTHS,
    inputs: [{ id: 'm_river_trout', qty: 1 }, { id: 'm_hardwood', qty: 1 }],
    output: { id: 'c_grilled_trout', qty: 1 },
    gold: 2,
  },
  {
    id: 'eel_stew',
    name: 'Simmer eel stew',
    station: 'cook',
    level: 8,
    zones: HEARTHS,
    inputs: [{ id: 'm_mire_eel', qty: 1 }, { id: 'm_glowcap', qty: 1 }, { id: 'm_salt', qty: 1 }],
    output: { id: 'c_eel_stew', qty: 1 },
    gold: 4,
  },
  {
    id: 'minor_potion',
    name: 'Brew Minor Potion',
    station: 'brew',
    level: 1,
    zones: BREWERS,
    inputs: [{ id: 'c_wild_berry', qty: 3 }, { id: 'c_bitterleaf', qty: 1 }],
    output: { id: 'c_minor_potion', qty: 1 },
    gold: 3,
  },
  {
    id: 'minor_ether',
    name: 'Brew Minor Ether',
    station: 'brew',
    level: 1,
    zones: BREWERS,
    inputs: [{ id: 'c_bitterleaf', qty: 3 }, { id: 'm_resin', qty: 1 }],
    output: { id: 'c_minor_ether', qty: 1 },
    gold: 4,
  },
  {
    id: 'potion',
    name: 'Brew Potion',
    station: 'brew',
    level: 8,
    zones: ['hollowmere', 'sunspire', 'frostpeak', 'cinder'],
    inputs: [{ id: 'c_wild_berry', qty: 3 }, { id: 'm_glowcap', qty: 2 }],
    output: { id: 'c_potion', qty: 1 },
    gold: 8,
  },
  {
    id: 'ether',
    name: 'Brew Ether',
    station: 'brew',
    level: 10,
    zones: ['hollowmere', 'sunspire', 'frostpeak', 'cinder'],
    inputs: [{ id: 'c_bitterleaf', qty: 3 }, { id: 'm_glowcap', qty: 2 }],
    output: { id: 'c_ether', qty: 1 },
    gold: 10,
  },
  {
    id: 'tonic',
    name: 'Brew Cleansing Tonic',
    station: 'brew',
    level: 5,
    zones: BREWERS,
    inputs: [{ id: 'c_bitterleaf', qty: 2 }, { id: 'm_salt', qty: 1 }],
    output: { id: 'c_antidote', qty: 1 },
    gold: 6,
  },
  {
    id: 'greater_potion',
    name: 'Brew Greater Potion',
    station: 'brew',
    level: 18,
    zones: ['frostpeak', 'cinder'],
    inputs: [{ id: 'm_frost_lichen', qty: 3 }, { id: 'm_glowcap', qty: 2 }],
    output: { id: 'c_greater_potion', qty: 1 },
    gold: 18,
  },
  {
    id: 'greater_ether',
    name: 'Brew Greater Ether',
    station: 'brew',
    level: 22,
    zones: ['frostpeak', 'cinder'],
    inputs: [{ id: 'm_frost_lichen', qty: 3 }, { id: 'm_mystic_dust', qty: 1 }],
    output: { id: 'c_greater_ether', qty: 1 },
    gold: 24,
  },
  {
    id: 'smoke_bomb',
    name: 'Pack Smoke Bomb',
    station: 'smelt',
    level: 29,
    zones: ANVILS,
    inputs: [{ id: 'm_coal', qty: 2 }, { id: 'm_clay', qty: 1 }, { id: 'm_sulfur', qty: 1 }],
    output: { id: 'c_smoke_bomb', qty: 1 },
    gold: 10,
  },
  {
    id: 'iron_ingot',
    name: 'Smelt iron',
    station: 'smelt',
    level: 1,
    zones: ANVILS,
    inputs: [{ id: 'm_iron_chunk', qty: 2 }, { id: 'm_coal', qty: 1 }],
    output: { id: 'm_iron_ingot', qty: 1 },
    gold: 5,
  },
  {
    id: 'bog_ingot',
    name: 'Smelt bog iron',
    station: 'smelt',
    level: 1,
    zones: ANVILS,
    inputs: [{ id: 'm_bog_iron', qty: 2 }, { id: 'm_coal', qty: 1 }],
    output: { id: 'm_iron_ingot', qty: 1 },
    gold: 5,
  },
];

export function recipe(id: string): RecipeDef | undefined {
  return RECIPES.find((recipe) => recipe.id === id);
}
