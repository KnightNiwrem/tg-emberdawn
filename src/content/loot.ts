/**
 * Contextual loot tables (#158). Zones and routes reference these by
 * stable id to award region-specific resources IN ADDITION to ordinary
 * enemy rewards — without cloning complete enemy definitions.
 *
 * Rules of the model:
 *  - enemy-global base drops stay authoritative for ordinary enemy loot;
 *  - contextual rolls are pure data (engine/loot.ts) resolved with the
 *    injected rng;
 *  - quest-kind drops remain subject to the central relevance filter
 *    (questDropAllowed) at every grant site — relevance is never decided
 *    here.
 * All lookups are pure.
 */

import type { DropTableDef } from './types.ts';

export const DROP_TABLES: readonly DropTableDef[] = [
  {
    id: 'dt_ember_fields',
    entries: [
      { item: 'm_ember_shard', chance: 0.25 },
      { item: 'c_minor_potion', chance: 0.08 },
    ],
  },
  {
    id: 'dt_whisper_roots',
    entries: [
      { item: 'm_iron_chunk', chance: 0.2 },
      { item: 'c_minor_ether', chance: 0.08 },
    ],
  },
  {
    id: 'dt_mire_roads',
    entries: [
      { item: 'm_iron_chunk', chance: 0.25 },
      { item: 'c_antidote', chance: 0.1 },
    ],
  },
  {
    id: 'dt_sun_flats',
    entries: [
      { item: 'm_mystic_dust', chance: 0.25 },
      { item: 'c_potion', chance: 0.08 },
    ],
  },
  {
    id: 'dt_high_pass',
    entries: [
      { item: 'm_frost_core', chance: 0.25 },
      { item: 'c_greater_potion', chance: 0.08 },
    ],
  },
  {
    id: 'dt_ash_road',
    entries: [
      { item: 'm_cinder_heart', chance: 0.25 },
      { item: 'c_super_potion', chance: 0.08 },
    ],
  },
  {
    id: 'dt_night_roads',
    entries: [
      { item: 'm_void_fragment', chance: 0.25 },
      { item: 'c_elixir', chance: 0.06 },
    ],
  },
];

const DROP_INDEX = new Map(DROP_TABLES.map((t) => [t.id, t]));

export function dropTable(id: string): DropTableDef | undefined {
  return DROP_INDEX.get(id);
}
