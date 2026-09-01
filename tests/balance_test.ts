/** Balance-harness invariants (#74): hard CI gates for unacceptable opening
 * states, plus the reviewed snapshot of stable envelopes. The human-facing
 * report lives in scripts/balance.ts (`deno task balance`); the snapshot is
 * regenerated deliberately with `deno task balance:update`. */

import { assert, assertEquals } from '@std/assert';
import {
  buildSnapshot,
  type CellStat,
  dungeonFloorsYield,
  eliteShare,
  type EncounterSource,
  exploreDropZonesFor,
  hostileZones,
  POLICIES,
  runCell,
  simulateChapterOne,
  tutorialEnemies,
  zoneHostilePool,
  zoneNormalPool,
} from '../src/engine/balance.ts';
import { createPlayer } from '../src/engine/character.ts';
import { createPostTutorialPlayer } from '../src/engine/tutorial.ts';
import { dungeonOf, encounterEligible } from '../src/engine/world.ts';
import { CLASS_IDS } from '../src/engine/types.ts';
import { enemy as enemyDef } from '../src/content/enemies.ts';
import { item } from '../src/content/items.ts';
import { quest } from '../src/content/quests.ts';
import { zone as zoneDef, ZONES } from '../src/content/zones.ts';

const FIGHTS = 300;

function solo(enemyId: string, zoneId: string): EncounterSource[] {
  return [{ enemyId, weight: 1, origin: { kind: 'explore', zoneId } }];
}

Deno.test('balance: every class has a viable free action (#74)', () => {
  // The prominent free button must actually work: vs the weakest opening
  // normal, a full-health level-1 hero mashing it should nearly always win.
  for (const cid of CLASS_IDS) {
    const cell = runCell({
      classId: cid,
      level: 1,
      gear: 'starting',
      policy: POLICIES.free,
      pool: 'solo:e_rat',
      sources: solo('e_rat', 'outskirts'),
      fights: FIGHTS,
      seed: 1101,
    });
    assert(
      cell.winRate >= 0.85,
      `${cid} free action vs Giant Rat winRate ${cell.winRate} < 0.85 — the free button is not viable`,
    );
  }
});

Deno.test('balance: the opening normals do not require consumables (#74)', () => {
  // A correctly played hero without spending items should reliably beat the
  // two weakest opening normals (rotation policy, no item use).
  for (const cid of CLASS_IDS) {
    for (const eid of ['e_rat', 'e_boar']) {
      const cell = runCell({
        classId: cid,
        level: 1,
        gear: 'starting',
        policy: POLICIES.rotation,
        pool: `solo:${eid}`,
        sources: solo(eid, 'outskirts'),
        fights: FIGHTS,
        seed: 1201,
      });
      assert(
        cell.winRate >= 0.85,
        `${cid} vs ${eid} without consumables: winRate ${cell.winRate} < 0.85`,
      );
    }
  }
});

Deno.test('balance: boss gates and readiness metadata resolve to real content (#74)', () => {
  for (const z of ZONES) {
    const d = z.dungeon;
    if (!d) continue;
    assert(enemyDef(d.boss), `${z.id}: boss ${d.boss} does not exist`);
    d.floors.forEach((f, i) => {
      for (const eid of f.enemies) {
        assert(enemyDef(eid), `${z.id} floor ${i + 1}: enemy ${eid} does not exist`);
      }
      if (f.treasure?.item) {
        assert(
          item(f.treasure.item),
          `${z.id} floor ${i + 1}: treasure ${f.treasure.item} missing`,
        );
      }
    });
    if (d.bossGate) {
      assert(quest(d.bossGate.quest), `${z.id}: gate quest ${d.bossGate.quest} does not exist`);
      if (d.bossGate.item) {
        assert(item(d.bossGate.item), `${z.id}: gate key ${d.bossGate.item} does not exist`);
      }
    }
    if (d.firstClear?.item) {
      assert(item(d.firstClear.item), `${z.id}: first-clear item ${d.firstClear.item} missing`);
    }
  }
});

Deno.test('balance: tutorial encounters cannot fell a correctly acting hero (#74)', () => {
  // Vacuously green until #69 flags its controlled enemy; the invariant is
  // wired so the guaranteed tutorial is covered the moment it exists.
  const tutors = tutorialEnemies();
  for (const t of tutors) {
    for (const cid of CLASS_IDS) {
      const cell = runCell({
        classId: cid,
        level: 1,
        gear: 'starting',
        policy: POLICIES.rotation,
        pool: `tutorial:${t.id}`,
        sources: solo(t.id, 'emberdawn'),
        fights: 200,
        seed: 1301,
      });
      assertEquals(cell.lossRate, 0, `${cid} lost to tutorial enemy ${t.id}`);
    }
  }
});

Deno.test('balance: reviewed snapshot matches the harness (#74)', () => {
  const path = new URL('./balance_snapshot.json', import.meta.url);
  let raw: string;
  try {
    raw = Deno.readTextFileSync(path);
  } catch {
    throw new Error(
      'tests/balance_snapshot.json is missing — regenerate deliberately with: deno task balance:update',
    );
  }
  const snap = JSON.parse(raw);
  assertEquals(
    buildSnapshot(),
    snap,
    'balance snapshot drifted — if this is a deliberate balance change, run deno task balance:update and explain the shift in the commit message',
  );
});

Deno.test('rotation metrics: healing identity and MP economy stay class-distinct (#71)', () => {
  const ratSrc: EncounterSource[] = [
    { enemyId: 'e_rat', weight: 1, origin: { kind: 'explore', zoneId: 'outskirts' } },
  ];
  const wolfSrc: EncounterSource[] = [
    { enemyId: 'e_wolf', weight: 1, origin: { kind: 'explore', zoneId: 'whisperwood' } },
  ];
  // A foe that actually pressures the healer: the Whisperwood elite hits
  // hard enough to drive the cleric under the rotation's heal threshold
  // (an ordinary wolf never does — healing identity needs real damage).
  const stagSrc: EncounterSource[] = [
    { enemyId: 'e_stag', weight: 1, origin: { kind: 'elite', zoneId: 'whisperwood' } },
  ];

  // Every class plays a viable, non-stalling rotation at the opening
  // breakpoint: MP is actually spent (skills over free actions) and the
  // guard-recovery loop means no fight times out.
  for (const cid of CLASS_IDS) {
    const cell = runCell({
      classId: cid,
      level: 1,
      gear: 'starting',
      policy: POLICIES.rotation,
      pool: 'test-rat',
      sources: ratSrc,
      fights: 120,
      seed: 7100,
    });
    assert(cell.winRate >= 0.85, `${cid} rotation vs e_rat wins (${cell.winRate})`);
    assertEquals(cell.timeoutRate, 0, `${cid} never stalls`);
    assert(cell.avgMpPctEnd < 1, `${cid} rotation spends MP (${cell.avgMpPctEnd})`);
  }

  // Sustain is the Cleric's to demonstrate: under real pressure the
  // rotation heals with Mend Wounds, while the warrior — no heal skill
  // until 28 — never heals at all.
  const cleric = runCell({
    classId: 'cleric',
    level: 4,
    gear: 'starting',
    policy: POLICIES.rotation,
    pool: 'test-stag',
    sources: stagSrc,
    fights: 120,
    seed: 7101,
  });
  const warriorStag = runCell({
    classId: 'warrior',
    level: 4,
    gear: 'starting',
    policy: POLICIES.rotation,
    pool: 'test-stag',
    sources: stagSrc,
    fights: 120,
    seed: 7101,
  });
  assert(cleric.healPerFight > 0, `cleric sustains (${cleric.healPerFight})`);
  assertEquals(warriorStag.healPerFight, 0, 'warrior has no heal skill at 4');

  // The second damage tier shows up as kill time, not just coefficients:
  // the Whirlwind-era warrior clears the same wolf strictly faster.
  // Kill time on a fair foe: the Whirlwind-era warrior clears the same
  // wolf strictly faster than the level-4 Cleave era.
  const warrior = runCell({
    classId: 'warrior',
    level: 4,
    gear: 'starting',
    policy: POLICIES.rotation,
    pool: 'test-wolf',
    sources: wolfSrc,
    fights: 120,
    seed: 7101,
  });
  const w13 = runCell({
    classId: 'warrior',
    level: 13,
    gear: 'starting',
    policy: POLICIES.rotation,
    pool: 'test-wolf',
    sources: wolfSrc,
    fights: 120,
    seed: 7102,
  });
  assert(w13.avgRoundsWin > 0, 'level-13 warrior wins some fights');
  assert(
    w13.avgRoundsWin < warrior.avgRoundsWin,
    `Whirlwind era kills faster (${w13.avgRoundsWin} < ${warrior.avgRoundsWin})`,
  );
});

Deno.test('spd curve: the rogue slips measurably more without flipping identities (#72)', () => {
  // Same rule the matrix uses: the first hostile zone whose band holds the
  // level. Every class fights the SAME pool with the SAME seed per level —
  // a paired comparison, so rng noise can't fake the gap.
  const zoneFor = (level: number): string => {
    const z = hostileZones().find((h) => level >= h.levels[0] - 2 && level <= h.levels[1] + 2);
    assert(z, `a hostile zone covers level ${level}`);
    return z!.id;
  };
  const cells = new Map<string, CellStat>();
  for (const level of [1, 7, 16, 31, 45]) {
    const zid = zoneFor(level);
    for (const cid of ['warrior', 'mage', 'rogue'] as const) {
      cells.set(
        `${cid}:${level}`,
        runCell({
          classId: cid,
          level,
          gear: 'best',
          policy: POLICIES.rotation,
          pool: zid,
          sources: zoneHostilePool(zid, level),
          fights: 200,
          seed: 7300 + level,
        }),
      );
    }
  }
  // The payoff is avoidance itself: the rogue slips blows at every real SPD
  // gap (levels 7+), where the warrior barely does. Raw avgTaken conflates
  // dodge with mitigation — the warrior's armor keeps it competitive there,
  // which is the intended division (#72: punished more when actually hit).
  for (const level of [7, 16, 31, 45]) {
    assert(
      cells.get(`rogue:${level}`)!.dodgesPerFight > cells.get(`warrior:${level}`)!.dodgesPerFight,
      `rogue slips more than the warrior at ${level}`,
    );
  }
  // The opening deficit is gone: a level-1 rogue holds its own in the
  // opening wilds (the #74 invariant band) now that SPD pays off in-fight.
  assert(
    cells.get('rogue:1')!.winRate >= 0.85,
    `rogue opening winrate (${cells.get('rogue:1')!.winRate})`,
  );
  // Identities hold: the mage stays the fragile one; nobody collapses.
  assert(cells.get('mage:31')!.avgTaken > cells.get('rogue:31')!.avgTaken);
  for (const cid of ['warrior', 'mage', 'rogue'] as const) {
    for (const level of [1, 7, 16, 31, 45]) {
      assert(
        cells.get(`${cid}:${level}`)!.winRate > 0,
        `${cid} still fights at ${level}`,
      );
    }
  }
});

Deno.test('balance: harness fidelity — shared eligibility, real tutorial start, sane counters (#74)', () => {
  // ONE eligibility rule everywhere: every pool source the harness builds
  // is an encounter live explore() could actually roll at that level.
  for (const z of ZONES) {
    for (let level = 1; level <= 45; level++) {
      for (const src of zoneNormalPool(z.id, level)) {
        const ev = z.explore.find((x) => x.kind === 'battle' && x.enemy === src.enemyId);
        assert(ev && encounterEligible(ev, level), `${z.id}@${level}: ${src.enemyId} ineligible`);
      }
    }
  }
  // The impossible state the old report measured is gone: a level-1/2 hero
  // finds NO Whisperwood hostiles — exactly like live play.
  assertEquals(zoneHostilePool('whisperwood', 1).length, 0);
  assertEquals(zoneHostilePool('whisperwood', 2).length, 0);
  assert(zoneHostilePool('whisperwood', 3).length > 0, 'band start has live hostiles');

  // The chapter sim starts from the REAL tutorial outcome and stays sane:
  // nonnegative item use, tier-2 steel before Aranya, bounded objective
  // farming, and no unexplained fight discontinuities between beats.
  for (const cid of CLASS_IDS) {
    const rep = simulateChapterOne(cid, 4100 + ['warrior', 'mage', 'rogue', 'cleric'].indexOf(cid));
    assert(rep.startLevel >= 2, `${cid}: post-tutorial start at Lv ${rep.startLevel}`);
    assert(rep.totalItemsUsed >= 0, `${cid}: item use went negative`);
    assert(rep.chapter1Done, `${cid}: chapter one completes`);
    assert(rep.aranyaGearTier >= 2, `${cid}: Aranya met in gear tier ${rep.aranyaGearTier}`);
    assert(
      rep.totalObjectiveFights <= 250,
      `${cid}: ${rep.totalObjectiveFights} objective fights (unbounded?)`,
    );
    let prev = 0;
    for (const b of rep.beats) {
      assert(b.fights - prev <= 150, `${cid}: ${b.questId} jumped ${b.fights - prev} fights`);
      prev = b.fights;
    }
  }
});

Deno.test('balance: the reviewed opening band follows the authored bands (#74)', () => {
  const snap = buildSnapshot();
  for (const cid of CLASS_IDS) {
    for (const level of [1, 2]) {
      const cell = snap.cells.find((c) =>
        c.classId === cid && c.level === level && c.policy === POLICIES.rotation.name &&
        c.gear === 'best'
      );
      assertEquals(cell?.pool, 'outskirts', `${cid}@${level}`);
    }
    for (const level of [4, 7, 9]) {
      const cell = snap.cells.find((c) =>
        c.classId === cid && c.level === level && c.policy === POLICIES.rotation.name &&
        c.gear === 'best'
      );
      assertEquals(cell?.pool, 'whisperwood', `${cid}@${level}`);
    }
  }
  // Elite exposure recorded AT the reviewed levels, level-aware (#74):
  assertEquals(snap.eliteShare['whisperwood@3'], 0); // the stag is band-locked out
  assert((snap.eliteShare['whisperwood@7'] ?? 0) > 0);
  assertEquals('whisperwood' in snap.eliteShare, false); // flat key retired
});

Deno.test('balance: elite exposure is level-aware (#74)', () => {
  assertEquals(eliteShare('whisperwood', 3), 0);
  assertEquals(eliteShare('whisperwood', 4), 0);
  assert(eliteShare('whisperwood', 5) > 0);
  assertEquals(eliteShare('outskirts', 1), 0); // no elite authored at all
});

Deno.test('balance: the canonical post-tutorial state is the fresh class kit (#74)', () => {
  for (const cid of CLASS_IDS) {
    const canon = createPostTutorialPlayer(1, 'T', cid);
    assertEquals(canon.level, 2, `${cid}: exits the prologue at level 2`);
    const fresh = createPlayer(1, 'T', cid);
    assertEquals(
      canon.inventory,
      fresh.inventory,
      `${cid}: kit untouched (the lesson spends and the reward replaces)`,
    );
    assertEquals(canon.equipment, fresh.equipment, `${cid}: gear untouched`);
  }
});

Deno.test('balance: the collection planner sees explore AND dungeon-floor sources (#74)', () => {
  // Iron Chunks have NO wild source at any level — they live in the Hollow.
  assertEquals(
    exploreDropZonesFor('m_iron_chunk', ['emberdawn', 'outskirts', 'whisperwood'], 6),
    [],
  );
  const d = dungeonOf(zoneDef('whisperwood')!);
  assert(d, 'the Whisperwood authors a dungeon');
  assert(dungeonFloorsYield('m_iron_chunk', d, 1), '#73 caches on floors 1-2');
  assert(dungeonFloorsYield('m_iron_chunk', d, 3), 'Mycelids still roam floor 3');
  assert(!dungeonFloorsYield('m_iron_chunk', d, 4), 'fully cleared → no source');
  // Wild drops still resolve through eligibility: rats drop ember shards.
  assert(exploreDropZonesFor('m_ember_shard', ['outskirts'], 1).includes('outskirts'));
});

Deno.test('balance: broad progression envelope holds across seeds (#74)', () => {
  for (const cid of CLASS_IDS) {
    for (let s = 0; s < 25; s++) {
      const rep = simulateChapterOne(cid, 21000 + s * 37);
      assert(rep.chapter1Done, `${cid}@${s}: chapter one completes`);
      assertEquals(rep.startLevel, 2, `${cid}@${s}: canonical start`);
      assert(rep.totalItemsUsed >= 0, `${cid}@${s}: item use nonnegative`);
      assert(rep.aranyaGearTier >= 2, `${cid}@${s}: tier-2 steel before Aranya`);
      assert(rep.totalFights <= 140, `${cid}@${s}: ${rep.totalFights} fights (unbounded?)`);
      assert(
        rep.totalEncounterAttempts <= 500,
        `${cid}@${s}: ${rep.totalEncounterAttempts} explores (no-op loops?)`,
      );
      let prev = 0;
      for (const b of rep.beats) {
        assert(b.fights - prev <= 80, `${cid}@${s}: ${b.questId} jumped ${b.fights - prev}`);
        prev = b.fights;
      }
    }
  }
});
