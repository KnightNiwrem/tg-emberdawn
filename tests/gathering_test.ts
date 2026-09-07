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
  for (const zoneDef of ZONES) assert(gatheringSites(zoneDef.id).length > 0, zoneDef.id);
  for (const id of ['sunspire', 'frostpeak', 'cinder', 'umbra', 'abyss']) {
    assert(!gatheringSites(id).some((site) => site.activity === 'fish'), id);
  }
  for (const zoneDef of ZONES) {
    for (const event of zoneDef.explore) {
      if (event.kind === 'treasure') {
        assertEquals(
          event.gold,
          undefined,
          'Routine exploration finds resources rather than gold hoards',
        );
        assert(
          !event.item || !item(event.item)?.effect ||
            ['c_wild_berry', 'c_bitterleaf'].includes(event.item),
        );
      }
    }
  }
});

Deno.test('gathering: tool and forged activity refusals preserve state and random stream', () => {
  const player = createPlayer(700, 'Gatherer', 'warrior');
  player.currentZone = 'outskirts';
  const before = structuredClone(player);
  const never = () => {
    throw new Error('Refusal must not roll');
  };
  assert(!gather(player, 'mine', never, 1000).ok);
  assert(!gather(player, 'fish', never, 1000).ok);
  assert(!gather(player, 'forage', never, 1000, 'm_worm_bait').ok);
  assertEquals(player, before);
  addItem(player, 'm_pickaxe');
  assert(gather(player, 'mine', () => 0, 1000).ok);
  assertEquals(countOf(player, 'm_pickaxe'), 1);
  assertEquals(countOf(player, 'm_copper_ore'), 1);
});

Deno.test('gathering: local shared allowance and recharge cannot be bypassed by travel or activity', () => {
  const player = createPlayer(701, 'Gatherer', 'warrior');
  player.currentZone = 'outskirts';
  addItem(player, 'm_pickaxe');
  assert(gather(player, 'forage', () => 0, 1000).ok);
  assert(gather(player, 'mine', () => 0, 2000).ok);
  assert(gather(player, 'forage', () => 0, 3000).ok);
  assertEquals(player.flags.gatherReset_outskirts, 3000 + GATHERING_COOLDOWN_MS);
  player.currentZone = 'emberdawn';
  assert(gather(player, 'forage', () => 0, 4000).ok);
  player.currentZone = 'outskirts';
  const before = structuredClone(player);
  assert(!gather(player, 'mine', () => 0, 3000 + GATHERING_COOLDOWN_MS - 1).ok);
  assertEquals(player, before);
  assertEquals(gatheringOptions(player)[0]?.remaining, 0);
  assertEquals(gatheringOptions(player, 3000 + GATHERING_COOLDOWN_MS)[0]?.remaining, 3);
  assertEquals(player, before, 'Projection never performs recharge mutations');
  assert(gather(player, 'mine', () => 0, 3000 + GATHERING_COOLDOWN_MS).ok);
  assertEquals(player.flags.gather_outskirts, 1);
  assertEquals(player.flags.gatherReset_outskirts, undefined);
});

Deno.test('gathering: fishing validates bait and consumes one only after acceptance', () => {
  const player = createPlayer(702, 'Gatherer', 'warrior');
  player.currentZone = 'whisperwood';
  addItem(player, 'm_fishing_rod');
  addItem(player, 'm_worm_bait', 2);
  const before = structuredClone(player);
  assert(!gather(player, 'fish', () => 0, 1000, 'm_pickaxe').ok);
  assert(!gather(player, 'fish', () => 0, 1000, 'm_grub_bait').ok);
  assertEquals(player, before);
  assert(gather(player, 'fish', () => 0, 1000, 'm_worm_bait').ok);
  assertEquals(countOf(player, 'm_worm_bait'), 1);
  assertEquals(countOf(player, 'm_fishing_rod'), 1);
  assertEquals(countOf(player, 'm_river_trout'), 1);
  addItem(player, 'm_grub_bait');
  assert(gather(player, 'fish', () => 0.5, 1000, 'm_grub_bait').ok);
  assertEquals(countOf(player, 'm_grub_bait'), 0);
  assertEquals(countOf(player, 'm_river_trout'), 3);
});

Deno.test('gathering: battle and journey guards precede mutation', () => {
  const player = createPlayer(703, 'Gatherer', 'warrior');
  player.battle =
    startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, { player, rng: () => 0.5 })!
      .battle;
  let before = structuredClone(player);
  assert(!gather(player, 'forage', () => 0, 1000).ok);
  assertEquals(player, before);
  delete player.battle;
  // Only presence matters to this guard; real journey construction is
  // covered in journey engine tests.
  player.journey = {} as NonNullable<typeof player.journey>;
  before = structuredClone(player);
  assert(!gather(player, 'forage', () => 0, 1000).ok);
  assertEquals(player, before);
});

Deno.test('gathering: ore gain completes live collection objectives immediately', () => {
  const player = createPlayer(704, 'Gatherer', 'warrior');
  player.currentZone = 'outskirts';
  player.quests.m5_arms = { status: 'active', counts: [0] };
  addItem(player, 'm_pickaxe');
  addItem(player, 'm_iron_chunk');
  const yields = gatheringSites('outskirts').find((site) => site.activity === 'mine')!.yields;
  const index = yields.findIndex((gatheringYield) => gatheringYield.item === 'm_iron_chunk');
  assert(index >= 0);
  const total = yields.reduce((sum, gatheringYield) => sum + gatheringYield.weight, 0);
  const before = yields.slice(0, index).reduce(
    (sum, gatheringYield) => sum + gatheringYield.weight,
    0,
  );
  const rolls = [(before + yields[index].weight / 2) / total, 0];
  const out = gather(player, 'mine', () => rolls.shift()!, 1000);
  assert(out.ok);
  assertEquals(countOf(player, 'm_iron_chunk'), 2);
  assertEquals(player.quests.m5_arms.status, 'turnIn');
  assert(out.lines.some((line) => line.includes('ready to turn in')));
});
