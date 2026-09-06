import { assert, assertEquals } from '@std/assert';
import { GATHERING_SITES, gatheringSites } from '../src/content/gathering.ts';
import { item } from '../src/content/items.ts';
import { zone, ZONES } from '../src/content/zones.ts';
import { createPlayer } from '../src/engine/character.ts';
import { gather, GATHERING_COOLDOWN_MS, gatheringOptions } from '../src/engine/gathering.ts';
import { addItem, countOf } from '../src/engine/inventory.ts';
import { startBattle } from '../src/engine/combat.ts';

Deno.test('gathering catalogs: ecology, identities and useful bounded yields', () => {
  const keys = new Set<string>();
  for (const site of GATHERING_SITES) {
    assert(zone(site.zoneId));
    const key = `${site.zoneId}:${site.activity}`;
    assert(!keys.has(key), key);
    keys.add(key);
    if (site.tool) assertEquals(item(site.tool)?.kind, 'material');
    const pools = site.baitTables
      ? Object.entries(site.baitTables)
      : [[undefined, site.yields]] as const;
    for (const [bait, pool] of pools) {
      if (bait) assertEquals(item(bait)?.kind, 'material');
      assert(pool.length > 0);
      for (const result of pool) {
        const def = item(result.item);
        assert(def, result.item);
        assert(def.kind === 'material' || def.id === 'c_wild_berry' || def.id === 'c_bitterleaf');
        assert(result.weight > 0 && result.min > 0 && result.max >= result.min);
        assert(Number.isInteger(result.min) && Number.isInteger(result.max));
      }
    }
  }
  for (const z of ZONES) assert(gatheringSites(z.id).length > 0, z.id);
  for (const id of ['sunspire', 'frostpeak', 'cinder', 'umbra', 'abyss']) {
    assert(!gatheringSites(id).some((s) => s.activity === 'fish'), id);
  }
  for (const z of ZONES) {
    for (const ev of z.explore) {
      if (ev.kind === 'treasure') {
        assertEquals(
          ev.gold,
          undefined,
          'Routine exploration finds resources rather than gold hoards',
        );
        assert(
          !ev.item || !item(ev.item)?.effect || ['c_wild_berry', 'c_bitterleaf'].includes(ev.item),
        );
      }
    }
  }
});

Deno.test('gathering: tool and forged activity refusals preserve state and random stream', () => {
  const p = createPlayer(700, 'Gatherer', 'warrior');
  p.currentZone = 'outskirts';
  const before = structuredClone(p);
  const never = () => {
    throw new Error('Refusal must not roll');
  };
  assert(!gather(p, 'mine', never, 1000).ok);
  assert(!gather(p, 'fish', never, 1000).ok);
  assert(!gather(p, 'forage', never, 1000, 'm_worm_bait').ok);
  assertEquals(p, before);
  addItem(p, 'm_pickaxe');
  assert(gather(p, 'mine', () => 0, 1000).ok);
  assertEquals(countOf(p, 'm_pickaxe'), 1);
  assertEquals(countOf(p, 'm_copper_ore'), 1);
});

Deno.test('gathering: local shared allowance and recharge cannot be bypassed by travel or activity', () => {
  const p = createPlayer(701, 'Gatherer', 'warrior');
  p.currentZone = 'outskirts';
  addItem(p, 'm_pickaxe');
  assert(gather(p, 'forage', () => 0, 1000).ok);
  assert(gather(p, 'mine', () => 0, 2000).ok);
  assert(gather(p, 'forage', () => 0, 3000).ok);
  assertEquals(p.flags.gatherReset_outskirts, 3000 + GATHERING_COOLDOWN_MS);
  p.currentZone = 'emberdawn';
  assert(gather(p, 'forage', () => 0, 4000).ok);
  p.currentZone = 'outskirts';
  const before = structuredClone(p);
  assert(!gather(p, 'mine', () => 0, 3000 + GATHERING_COOLDOWN_MS - 1).ok);
  assertEquals(p, before);
  assertEquals(gatheringOptions(p)[0]?.remaining, 0);
  assertEquals(gatheringOptions(p, 3000 + GATHERING_COOLDOWN_MS)[0]?.remaining, 3);
  assertEquals(p, before, 'Projection never performs recharge mutations');
  assert(gather(p, 'mine', () => 0, 3000 + GATHERING_COOLDOWN_MS).ok);
  assertEquals(p.flags.gather_outskirts, 1);
  assertEquals(p.flags.gatherReset_outskirts, undefined);
});

Deno.test('gathering: fishing validates bait and consumes one only after acceptance', () => {
  const p = createPlayer(702, 'Gatherer', 'warrior');
  p.currentZone = 'whisperwood';
  addItem(p, 'm_fishing_rod');
  addItem(p, 'm_worm_bait', 2);
  const before = structuredClone(p);
  assert(!gather(p, 'fish', () => 0, 1000, 'm_pickaxe').ok);
  assert(!gather(p, 'fish', () => 0, 1000, 'm_grub_bait').ok);
  assertEquals(p, before);
  assert(gather(p, 'fish', () => 0, 1000, 'm_worm_bait').ok);
  assertEquals(countOf(p, 'm_worm_bait'), 1);
  assertEquals(countOf(p, 'm_fishing_rod'), 1);
  assertEquals(countOf(p, 'm_river_trout'), 1);
  addItem(p, 'm_grub_bait');
  assert(gather(p, 'fish', () => 0.5, 1000, 'm_grub_bait').ok);
  assertEquals(countOf(p, 'm_grub_bait'), 0);
  assertEquals(countOf(p, 'm_river_trout'), 3);
});

Deno.test('gathering: battle and journey guards precede mutation', () => {
  const p = createPlayer(703, 'Gatherer', 'warrior');
  p.battle =
    startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, { player: p, rng: () => 0.5 })!
      .battle;
  let before = structuredClone(p);
  assert(!gather(p, 'forage', () => 0, 1000).ok);
  assertEquals(p, before);
  delete p.battle;
  // Only presence matters to this guard; real journey construction is
  // covered in journey engine tests.
  p.journey = {} as NonNullable<typeof p.journey>;
  before = structuredClone(p);
  assert(!gather(p, 'forage', () => 0, 1000).ok);
  assertEquals(p, before);
});

Deno.test('gathering: ore gain completes live collection objectives immediately', () => {
  const p = createPlayer(704, 'Gatherer', 'warrior');
  p.currentZone = 'outskirts';
  p.quests.m5_arms = { status: 'active', counts: [0] };
  addItem(p, 'm_pickaxe');
  addItem(p, 'm_iron_chunk');
  const yields = gatheringSites('outskirts').find((s) => s.activity === 'mine')!.yields;
  const index = yields.findIndex((y) => y.item === 'm_iron_chunk');
  assert(index >= 0);
  const total = yields.reduce((sum, y) => sum + y.weight, 0);
  const before = yields.slice(0, index).reduce((sum, y) => sum + y.weight, 0);
  const rolls = [(before + yields[index].weight / 2) / total, 0];
  const out = gather(p, 'mine', () => rolls.shift()!, 1000);
  assert(out.ok);
  assertEquals(countOf(p, 'm_iron_chunk'), 2);
  assertEquals(p.quests.m5_arms.status, 'turnIn');
  assert(out.lines.some((line) => line.includes('ready to turn in')));
});
