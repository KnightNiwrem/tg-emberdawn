/**
 * #169 — structured campaign travel telemetry: every road event counted
 * exactly once by structured kind (never from prose), totals derived and
 * internally consistent, arrival conditions sampled pre-heal with tested
 * means, and contextual grants measured from structured grants.
 */

import { assert, assertEquals } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { battleAction } from '../src/handlers/battle.ts';
import { advanceJourney, type JourneyEventRecord, startJourney } from '../src/engine/journey.ts';
import { simulateCampaign } from '../src/engine/balance.ts';
import { dropTable } from '../src/content/loot.ts';
import { route } from '../src/content/routes.ts';
import type { TravelEvent } from '../src/content/types.ts';

function stub(...values: number[]): () => number {
  let drawIndex = 0;
  return () => values[Math.min(drawIndex++, values.length - 1)]!;
}

function walker(id: number, at: string, to: string) {
  const player = createPlayer(id, 'Walker', 'warrior');
  player.tutorial = 'done';
  player.level = 30;
  player.currentZone = at;
  player.unlockedZones.push(to);
  return player;
}

/** Drives one full crossing through the real coordinator, collecting its
 * structured telemetry records. Won road fights complete their event at
 * the ONE owned point, then the coordinator continues. */
function cross(
  id: number,
  from: string,
  to: string,
  rng: () => number,
): { records: JourneyEventRecord[] } {
  const player = walker(id, from, to);
  const records: JourneyEventRecord[] = [];
  const sink = (event: JourneyEventRecord): void => void records.push(event);
  const res = startJourney(player, `w_${from}_${to}`, rng, sink);
  assert(res.ok, 'the crossing starts');
  let step = res.step;
  let guard = 0;
  while (step.kind === 'battle' && guard++ < 20) {
    player.battle!.enemy.hp = 0;
    battleAction(player, { v: 'battle', a: 'atk' }); // victory completes the event
    player.battle = undefined; // the won fight drops, like the live Continue
    const next = advanceJourney(player, rng, sink);
    if (next.kind === 'arrived') return { records };
    assert(next.kind === 'battle', 'the crossing continues into its next roll');
    step = next;
  }
  assert(step.kind === 'arrived', 'the crossing arrived');
  return { records };
}

Deno.test('telemetry: every resolved road event emits exactly one structured record', () => {
  // w_sunspire_frostpeak: 2 events; the stub resolves flavor then battle.
  const { records } = cross(1690, 'sunspire', 'frostpeak', stub(0.7, 0.1));
  assertEquals(records.length, 2, 'one record per resolved roll');
  assertEquals(records[0], { edgeId: 'w_sunspire_frostpeak', index: 0, kind: 'flavor' });
  assertEquals(
    records[1],
    { edgeId: 'w_sunspire_frostpeak', index: 1, kind: 'battle', enemy: 'e_marauder' },
    'the battle record names the enemy and its plan position',
  );
});

Deno.test('telemetry: contextual grants ride the record, measured from the structured grant', () => {
  // Patch the Landing Trail's treasure event to also roll a contextual
  // table, run the crossing, and read the granted ids off the record.
  const routeDef = route('w_whisperwood_mirefoot')!;
  const treasureEvent = routeDef.events![4] as Extract<TravelEvent, { kind: 'treasure' }>;
  const original = treasureEvent.dropTable;
  treasureEvent.dropTable = 'dt_ember_fields';
  try {
    const player = walker(1691, 'whisperwood', 'mirefoot');
    const records: JourneyEventRecord[] = [];
    const res = startJourney(
      player,
      'w_whisperwood_mirefoot',
      stub(0.95, 0.26),
      (event) => void records.push(event),
    );
    assert(res.ok && res.step.kind === 'arrived', 'the treasure roll lands and arrives');
    const treasure = records.find((event) => event.kind === 'treasure');
    assert(treasure, 'the treasure event emitted a record');
    // The stable roll straddles authored chances: some finds grant and others miss.
    const entries = dropTable('dt_ember_fields')!.entries;
    const expected = entries.filter((entry) => entry.chance > 0.26);
    assert(
      expected.length > 0 && expected.length < entries.length,
      'fixture includes hits and misses',
    );
    assertEquals(
      treasure!.granted,
      expected.map((entry) => entry.item),
      'the granted list is the structured post-filter grant, not prose',
    );
    for (const entry of entries) {
      assertEquals(
        countInBag(player, entry.item),
        entry.chance > 0.26 ? entry.qty ?? 1 : 0,
        `${entry.item}: only successful grants enter the bag`,
      );
    }
  } finally {
    if (original === undefined) delete treasureEvent.dropTable;
    else treasureEvent.dropTable = original;
  }
});

function countInBag(player: ReturnType<typeof createPlayer>, id: string): number {
  return player.inventory.find((entry) => entry.id === id)?.qty ?? 0;
}

Deno.test('telemetry: changing narrative text cannot change telemetry', () => {
  const routeDef = route('w_sunspire_frostpeak')!;
  const flavor = routeDef.events![3] as Extract<TravelEvent, { kind: 'flavor' }>;
  const original = flavor.text;
  const run = (): JourneyEventRecord[] =>
    cross(1692, 'sunspire', 'frostpeak', stub(0.7, 0.7)).records;
  const before = run();
  flavor.text = 'COMPLETELY DIFFERENT PROSE THAT NO PARSER HAS EVER SEEN';
  const after = run();
  flavor.text = original;
  assertEquals(after, before, 'records are identical — prose is presentation only');
});

Deno.test('campaign: totals are derived sums and can never undershoot road battles', () => {
  const report = simulateCampaign('warrior', 20260905);
  const metrics = report.travel;
  const sum = Object.values(metrics.eventOutcomes).reduce(
    (totalCount, count) => totalCount + count,
    0,
  );
  assertEquals(metrics.totalRoadEvents, sum, 'totalRoadEvents IS the structured sum');
  const byEdgeSum = Object.values(metrics.eventOutcomesByEdge)
    .flatMap((kinds) => Object.values(kinds))
    .reduce((totalCount, count) => totalCount + count, 0);
  assertEquals(byEdgeSum, sum, 'the per-edge breakdown mirrors the global one');
  assert(
    metrics.totalRoadEvents >= metrics.travelBattles,
    `events ${metrics.totalRoadEvents} >= road battles ${metrics.travelBattles}`,
  );
  assertEquals(
    metrics.eventOutcomes.battle ?? 0,
    metrics.travelBattles,
    'every road fight corresponds to exactly one battle record',
  );
  assert(metrics.travelBattles > 0, 'the campaign actually fought road battles');
});

Deno.test('campaign: arrival means are pre-arrival, documented, and in range', () => {
  const report = simulateCampaign('warrior', 20260905);
  const metrics = report.travel;
  assert(metrics.arrivalSamples > 0, 'the campaign arrived somewhere');
  for (const mean of [metrics.hpPctOnArrival, metrics.mpPctOnArrival]) {
    assert(mean >= 0 && mean <= 1, `mean in [0,1]: ${mean}`);
  }
  // The means are real means: the sum fields divide exactly by the
  // sample count.
  assertEquals(
    metrics.hpPctOnArrival,
    metrics.hpArrivalSumPct / metrics.arrivalSamples,
  );
  assertEquals(
    metrics.mpPctOnArrival,
    metrics.mpArrivalSumPct / metrics.arrivalSamples,
  );
  // PRE-arrival semantics: the road's condition, before any safe-haven
  // full heal. A campaign hero takes road damage, so the mean HP on
  // arrival is strictly below one — the old post-heal sum (1000+ over
  // ~1000 samples) could never satisfy this.
  assert(
    metrics.hpPctOnArrival < 1,
    `pre-heal arrival condition is sampled: ${metrics.hpPctOnArrival}`,
  );
});

Deno.test('campaign: contextual grants arrive from structured grants only', () => {
  const report = simulateCampaign('mage', 77);
  // Zone loot (#165) is active for travel battles; road treasures may
  // also grant — the count comes from the structured grants, so a
  // campaign with road fights always measures some.
  assert(
    report.travel.contextualDrops > 0,
    `structured contextual grants measured: ${report.travel.contextualDrops}`,
  );
});

Deno.test('telemetry: the seeded harness is deterministic across runs', () => {
  const firstMetrics = simulateCampaign('warrior', 424242).travel;
  const secondMetrics = simulateCampaign('warrior', 424242).travel;
  assertEquals(secondMetrics, firstMetrics, 'same seed, same telemetry');
});
