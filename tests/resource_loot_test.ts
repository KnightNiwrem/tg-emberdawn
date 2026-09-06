import { assert, assertEquals } from '@std/assert';
import { enemy } from '../src/content/enemies.ts';
import { item } from '../src/content/items.ts';
import { GATHERING_SITES } from '../src/content/gathering.ts';
import { ZONES } from '../src/content/zones.ts';
import { DROP_TABLES } from '../src/content/loot.ts';

Deno.test('resource ecology: regional battle finds are raw materials, not prepared supplies', () => {
  const valuables = new Set(['m_silver_brooch', 'm_sun_medallion', 'm_royal_signet']);
  for (const table of DROP_TABLES) {
    assert(table.entries.length >= 3, table.id);
    for (const entry of table.entries) {
      assertEquals(item(entry.item)?.kind, 'material', `${table.id}: ${entry.item}`);
      assert(!valuables.has(entry.item), 'Personal valuables belong to authored enemy salvage');
    }
  }
});

Deno.test('resource ecology: creature salvage follows anatomy and quest drops stay available', () => {
  assertEquals(enemy('e_wolf')!.drops, { m_hide: 0.4, m_bone: 0.25 });
  assertEquals(enemy('e_spider')!.drops, { m_spider_silk: 0.5, q_pells_locket: 0.25 });
  assertEquals(enemy('e_leech')!.drops, { q_toxin_sample: 0.55 });
  assertEquals(enemy('e_frostwraith')!.drops?.q_frost_emblem, 0.4);
  assertEquals(enemy('e_revenant')!.drops?.q_cinder_sigil, 0.35);
  assert(enemy('e_mycelid')!.drops!.m_iron_chunk > 0, 'Bram still has a forest ore source');
});

Deno.test('resource ecology: raw plants restore less than the first processed recovery items', () => {
  assert(item('c_wild_berry')!.effect!.healHp! < item('c_minor_potion')!.effect!.healHp!);
  assert(item('c_bitterleaf')!.effect!.healMp! < item('c_minor_ether')!.effect!.healMp!);
  for (const id of ['m_pickaxe', 'm_fishing_rod', 'm_grub_bait', 'm_worm_bait']) {
    const def = item(id)!;
    assertEquals(def.kind, 'material');
    assertEquals(def.effect, undefined);
    assert(def.price > 0);
  }
});

Deno.test('resource ecology: personal valuables never appear in gathering or exploration finds', () => {
  const valuables = new Set(['m_silver_brooch', 'm_sun_medallion', 'm_royal_signet']);
  for (const site of GATHERING_SITES) {
    const yields = [...site.yields, ...Object.values(site.baitTables ?? {}).flat()];
    for (const entry of yields) assert(!valuables.has(entry.item), site.zoneId);
  }
  for (const zone of ZONES) {
    for (const event of zone.explore) {
      if (event.kind === 'treasure' && event.item !== undefined) {
        assert(!valuables.has(event.item), zone.id);
      }
    }
  }
});

Deno.test('resource ecology: ordinary animals never carry processed recovery supplies', () => {
  for (
    const id of [
      'e_rat',
      'e_boar',
      'e_wolf',
      'e_spider',
      'e_stag',
      'e_leech',
      'e_mireclaw',
      'e_serpent',
      'e_scarab',
      'e_vulture',
      'e_spirelynx',
      'e_icebat',
      'e_bristlehorn',
      'e_yeti',
    ]
  ) {
    for (const drop of Object.keys(enemy(id)!.drops ?? {})) {
      assert(item(drop)?.kind !== 'consumable', `${id}: ${drop}`);
    }
  }
});

Deno.test('resource ecology: the early shard quest retains forest and quarry supplies', () => {
  const forest = DROP_TABLES.find((table) => table.id === 'dt_whisper_roots')!;
  const shard = forest.entries.find((entry) => entry.item === 'm_ember_shard');
  assert(shard && shard.chance >= 0.3, 'forest victories must keep the six-shard quest supplied');
  const quarry = GATHERING_SITES.find((site) =>
    site.zoneId === 'outskirts' && site.activity === 'mine'
  );
  assert(quarry?.yields.some((entry) => entry.item === 'm_ember_shard' && entry.weight > 0));
});
