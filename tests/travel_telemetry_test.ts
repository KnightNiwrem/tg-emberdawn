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
import { route } from '../src/content/routes.ts';
import type { TravelEvent } from '../src/content/types.ts';

function stub(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

function walker(id: number, at: string, to: string) {
  const p = createPlayer(id, 'Walker', 'warrior');
  p.tutorial = 'done';
  p.level = 30;
  p.currentZone = at;
  p.unlockedZones.push(to);
  return p;
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
  const p = walker(id, from, to);
  const records: JourneyEventRecord[] = [];
  const sink = (e: JourneyEventRecord): void => void records.push(e);
  const res = startJourney(p, `w_${from}_${to}`, rng, sink);
  assert(res.ok, 'the crossing starts');
  let step = res.step;
  let guard = 0;
  while (step.kind === 'battle' && guard++ < 20) {
    p.battle!.enemy.hp = 0;
    battleAction(p, { v: 'battle', a: 'atk' }); // victory completes the event
    p.battle = undefined; // the won fight drops, like the live Continue
    const next = advanceJourney(p, rng, sink);
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
  const r = route('w_whisperwood_mirefoot')!;
  const ev = r.events![4] as Extract<TravelEvent, { kind: 'treasure' }>;
  const original = ev.dropTable;
  ev.dropTable = 'dt_ember_fields';
  try {
    const p = walker(1691, 'whisperwood', 'mirefoot');
    const records: JourneyEventRecord[] = [];
    const res = startJourney(
      p,
      'w_whisperwood_mirefoot',
      stub(0.95, 0.1),
      (e) => void records.push(e),
    );
    assert(res.ok && res.step.kind === 'arrived', 'the treasure roll lands and arrives');
    const treasure = records.find((e) => e.kind === 'treasure');
    assert(treasure, 'the treasure event emitted a record');
    // The stub rolls 0.1 twice: the shard (chance .25) hits, the potion
    // (.08) misses — the granted list is exactly what entered the bag.
    assertEquals(
      treasure!.granted,
      ['m_ember_shard'],
      'the granted list is the structured post-filter grant, not prose',
    );
    assertEquals(countInBag(p, 'm_ember_shard'), 1, 'the grant actually landed');
  } finally {
    if (original === undefined) delete ev.dropTable;
    else ev.dropTable = original;
  }
});

function countInBag(p: ReturnType<typeof createPlayer>, id: string): number {
  return p.inventory.find((e) => e.id === id)?.qty ?? 0;
}

Deno.test('telemetry: changing narrative text cannot change telemetry', () => {
  const r = route('w_sunspire_frostpeak')!;
  const flavor = r.events![3] as Extract<TravelEvent, { kind: 'flavor' }>;
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
  const t = report.travel;
  const sum = Object.values(t.eventOutcomes).reduce((a, n) => a + n, 0);
  assertEquals(t.totalRoadEvents, sum, 'totalRoadEvents IS the structured sum');
  const byEdgeSum = Object.values(t.eventOutcomesByEdge)
    .flatMap((kinds) => Object.values(kinds))
    .reduce((a, n) => a + n, 0);
  assertEquals(byEdgeSum, sum, 'the per-edge breakdown mirrors the global one');
  assert(
    t.totalRoadEvents >= t.travelBattles,
    `events ${t.totalRoadEvents} >= road battles ${t.travelBattles}`,
  );
  assertEquals(
    t.eventOutcomes.battle ?? 0,
    t.travelBattles,
    'every road fight corresponds to exactly one battle record',
  );
  assert(t.travelBattles > 0, 'the campaign actually fought road battles');
});

Deno.test('campaign: arrival means are pre-arrival, documented, and in range', () => {
  const report = simulateCampaign('warrior', 20260905);
  const t = report.travel;
  assert(t.arrivalSamples > 0, 'the campaign arrived somewhere');
  for (const mean of [t.hpPctOnArrival, t.mpPctOnArrival]) {
    assert(mean >= 0 && mean <= 1, `mean in [0,1]: ${mean}`);
  }
  // The means are real means: the sum fields divide exactly by the
  // sample count.
  assertEquals(
    t.hpPctOnArrival,
    t.hpArrivalSumPct / t.arrivalSamples,
  );
  assertEquals(
    t.mpPctOnArrival,
    t.mpArrivalSumPct / t.arrivalSamples,
  );
  // PRE-arrival semantics: the road's condition, before any safe-haven
  // full heal. A campaign hero takes road damage, so the mean HP on
  // arrival is strictly below one — the old post-heal sum (1000+ over
  // ~1000 samples) could never satisfy this.
  assert(
    t.hpPctOnArrival < 1,
    `pre-heal arrival condition is sampled: ${t.hpPctOnArrival}`,
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
  const a = simulateCampaign('warrior', 424242).travel;
  const b = simulateCampaign('warrior', 424242).travel;
  assertEquals(b, a, 'same seed, same telemetry');
});
