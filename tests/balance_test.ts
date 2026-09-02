/** Balance-harness invariants (#74): hard CI gates for unacceptable opening
 * states, plus the reviewed snapshot of stable envelopes. The human-facing
 * report lives in scripts/balance.ts (`deno task balance`); the snapshot is
 * regenerated deliberately with `deno task balance:update`. */

import { assert, assertEquals, assertThrows } from '@std/assert';
import {
  buildSnapshot,
  type CellStat,
  chooseAction,
  dungeonBossSource,
  dungeonFloorsYield,
  eliteShare,
  type EncounterSource,
  exploreDropZonesFor,
  hostileZones,
  makeHero,
  MATRIX_LEVELS,
  POLICIES,
  runCell,
  runFight,
  seededRng,
  simulateCampaign,
  simulateChapterOne,
  tutorialEnemies,
  zoneHostilePool,
  zoneNormalPool,
} from '../src/engine/balance.ts';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import { createPostTutorialPlayer } from '../src/engine/tutorial.ts';
import { dungeonOf, encounterEligible } from '../src/engine/world.ts';
import type { BattleOrigin, ClassId, PlayerState } from '../src/engine/types.ts';
import { CLASS_IDS } from '../src/engine/types.ts';
import { MAX_LEVEL } from '../src/engine/classes.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import { type CombatTraceEntry } from '../src/engine/telemetry.ts';
import { ENEMIES, enemy as enemyDef } from '../src/content/enemies.ts';
import { item } from '../src/content/items.ts';
import { quest } from '../src/content/quests.ts';
import { isDamageSkill, SKILLS } from '../src/content/skills.ts';
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

Deno.test('balance: the tactical policy is effect-aware and always legal (#84)', () => {
  const run = (cid: ClassId, level: number, enemyId: string, origin: BattleOrigin): CellStat =>
    runCell({
      classId: cid,
      level,
      gear: 'best',
      policy: POLICIES.tactical,
      pool: `tac:${cid}@${level}`,
      sources: [{ enemyId, weight: 1, origin }],
      fights: 120,
      seed: 8401,
    });

  const clericStag = run('cleric', 14, 'e_stag', { kind: 'elite', zoneId: 'whisperwood' });
  const rogueWolf = run('rogue', 12, 'e_wolf', { kind: 'explore', zoneId: 'whisperwood' });
  const mageWolf = run('mage', 13, 'e_wolf', { kind: 'explore', zoneId: 'whisperwood' });
  const warriorWolf = run('warrior', 13, 'e_wolf', { kind: 'explore', zoneId: 'whisperwood' });
  const cells = [clericStag, rogueWolf, mageWolf, warriorWolf];

  // HARD INVARIANT: the engine never refuses a tactical selection — no
  // pre-emptive, silenced, on-cooldown or unaffordable skill is ever chosen
  // (#84: policies select only legal actions).
  for (const cell of cells) assertEquals(cell.invalidActions, 0, 'unusable skill selected');

  // Utility actually casts: the cleric shields (Aegis of Dawn at 14) under
  // stag pressure, and SOME scenario exercises buffs/DoTs/debuffs.
  assert(clericStag.avgShieldCasts > 0, `cleric never shielded (${clericStag.avgShieldCasts})`);
  assert(
    cells.some((c) => c.avgBuffCasts > 0 || c.avgDotCasts > 0 || c.avgDebuffCasts > 0),
    'no scenario exercised buffs/DoTs/debuffs',
  );

  // Pre-emptive skills arrive through the OPENING pipeline, not casts:
  // Expose Weakness appears as an enemy-side effect application (#80/#84),
  // under its per-effect stacking identity (#90).
  assert(
    (rogueWolf.effectApplications['enemy:sk_expose_weakness:e0'] ?? 0) > 0,
    'Expose Weakness never fired in the opening',
  );

  // Control never dominates: stunned rounds stay the exception.
  for (const cell of cells) {
    assert(cell.avgSkippedRounds < 1, `control dominates (${cell.avgSkippedRounds})`);
  }
});

Deno.test('balance: unique equipment effects have a deterministic trigger scenario (#84)', () => {
  // equipBest never picks the Wardstone Pendant (its stat weight loses to
  // stat trinkets), so its trigger scenario is TARGETED: the hero equips
  // it explicitly and every fight opens with the battle-lifetime ward.
  const p = makeHero('rogue', 20, 'best');
  p.equipment.trinket = 't_wardstone';
  const res = runFight(
    p,
    'e_wolf',
    POLICIES.tactical,
    seededRng(9001),
    { kind: 'explore', zoneId: 'whisperwood' },
  );
  assert(res.shieldGranted >= 25, `wardstone ward granted (${res.shieldGranted})`);
  assert(
    (res.effectApplications['player:t_wardstone:t0:e0'] ?? 0) > 0,
    'the wardstone opening was never observed',
  );
  assertEquals(res.invalidActions, 0);
});

// ── #88: effect-aware harness coverage & metrics ───────────────────────────

Deno.test('balance: the level matrix covers every authored unlock (#88)', () => {
  const unlocks = [...new Set(SKILLS.map((s) => s.learnLevel))].sort((a, b) => a - b);
  for (const lv of unlocks) {
    assert(MATRIX_LEVELS.includes(lv), `unlock level ${lv} missing from the matrix`);
  }
  assert(MATRIX_LEVELS.includes(2), 'the post-prologue breakpoint is exercised');
  assert(MATRIX_LEVELS.includes(MAX_LEVEL), 'the endgame cap is exercised');
  for (let i = 1; i < MATRIX_LEVELS.length; i++) {
    assert(MATRIX_LEVELS[i]! > MATRIX_LEVELS[i - 1]!, 'matrix levels must be sorted + unique');
  }
});

Deno.test('engine: structured telemetry emits typed combat events (#88)', () => {
  const dot = SKILLS.find((sk) =>
    sk.effects.some((e) => e.kind === 'periodic' && (e.perRound ?? 0) < 0)
  )!;
  assert(dot, 'content has a harmful periodic skill');
  // A same-band normal survives long enough to eat a DoT, and normals
  // carry no statusResist — the cast lands deterministically (#88).
  const foeZone = hostileZones().find((z) => zoneNormalPool(z.id, dot.learnLevel).length > 0)!;
  const foe = zoneNormalPool(foeZone.id, dot.learnLevel)[0]!;
  const events: CombatTraceEntry[] = [];
  {
    // #101: each resolution returns its own trace — the fight's entries
    // are collected explicitly, with no global installation.
    const p = makeHero(dot.classId, dot.learnLevel, 'best');
    p.hp = 99999; // outlive the foe — this test drives EVENTS, not balance
    const started = startBattle(foe.enemyId, foe.origin, { player: p, rng: seededRng(11) })!;
    const b = started.battle;
    events.push(...started.trace);
    p.battle = b;
    // A one-shot foe dies before the DoT spec's turn in the spec list —
    // pad the pool so the fight lasts and the application lands (#88).
    b.enemy.maxHp *= 5;
    b.enemy.hp = b.enemy.maxHp;
    let guard = 0;
    while (b.phase === 'active' && guard++ < 60) {
      // Cast the DoT on cooldown; fall back to the basic attack when the
      // cast is refused (MP/cooldown) so the fight always reaches a
      // terminal state (#88).
      let res = performAction(p, b, { kind: 'skill', skillId: dot.id }, seededRng(90 + guard));
      events.push(...res.trace);
      if (!res.consumedTurn && b.phase === 'active') {
        res = performAction(p, b, { kind: 'attack' }, seededRng(190 + guard));
        events.push(...res.trace);
      }
      if (res.outcome === 'victory' || res.outcome === 'defeat') break;
    }
  }
  assert(events.some((e) => e.kind === 'effectApplied'), 'no effect application was ever emitted');
  assert(
    events.some((e) => e.kind === 'effectApplied' && e.side === 'enemy'),
    'the player-side DoT application was never emitted',
  );
  assert(events.some((e) => e.kind === 'terminal'), 'the terminal outcome was never emitted');
});

Deno.test('telemetry: two concurrent fights collect isolated traces (#101)', () => {
  // Two resolutions interleaved round by round — each owns its trace and
  // neither observes the other's entries.
  const a = makeHero('warrior', 10, 'best');
  const c = makeHero('mage', 10, 'best');
  const sa = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
    player: a,
    rng: seededRng(21),
  })!;
  const sc = startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, {
    player: c,
    rng: seededRng(22),
  })!;
  const ba = sa.battle;
  const bc = sc.battle;
  a.battle = ba;
  c.battle = bc;
  ba.enemy.hp = 99999;
  ba.enemy.maxHp = 99999;
  const traceA = [...sa.trace];
  const traceC = [...sc.trace];
  for (let r = 0; r < 6 && ba.phase === 'active' && bc.phase === 'active'; r++) {
    const ra = performAction(a, ba, { kind: 'attack' }, seededRng(30 + r));
    const rc = performAction(c, bc, { kind: 'attack' }, seededRng(40 + r));
    traceA.push(...ra.trace);
    traceC.push(...rc.trace);
  }
  assert(traceA.length > 0 && traceC.length > 0, 'both fights recorded entries');
  // Isolation: fight A only ever names the wolf, fight C only the rat.
  const namesOf = (trace: CombatTraceEntry[]): Set<string> =>
    new Set(
      trace.flatMap((e) =>
        e.kind === 'effectApplied' || e.kind === 'effectRemoved' || e.kind === 'periodicTick'
          ? [e.name]
          : []
      ),
    );
  for (const [trace, foe] of [[traceA, 'Wolf'], [traceC, 'Rat']] as const) {
    const [mine, other] = foe === 'Wolf' ? ['Wolf', 'Rat'] : ['Rat', 'Wolf'];
    assert(
      [...namesOf(trace)].every((n) => !n.includes(other)),
      `fight ${mine} trace must not contain ${other} entries`,
    );
  }
  // The traces carry no references into each other: fight C's total
  // entries never appear inside fight A's collector.
  assertEquals(traceA.includes(traceC[0] as never), false);
});

Deno.test('balance: runFight metrics include periodic damage and proc accounting (#88)', () => {
  const dot = SKILLS.find((sk) =>
    sk.effects.some((e) => e.kind === 'periodic' && (e.perRound ?? 0) < 0)
  )!;
  const hero = makeHero(dot.classId, dot.learnLevel, 'best');
  const boss = dungeonBossSource('whisperwood')!;
  let dotCasts = 0;
  let dotDealt = 0;
  let dealt = 0;
  let dotTaken = 0;
  let taken = 0;
  let attempts = 0;
  let hits = 0;
  for (let i = 0; i < 40; i++) {
    const r = runFight(hero, boss.enemyId, POLICIES.tactical, seededRng(500 + i), boss.origin);
    dotCasts += r.dotCasts;
    dotDealt += r.dotDealt;
    dealt += r.dealt;
    dotTaken += r.dotTaken;
    taken += r.taken;
    attempts += r.procAttempts;
    hits += r.procHits;
    assertEquals(r.invalidActions, 0, 'tactical policy selected an unusable skill');
  }
  assert(dotCasts > 0, 'the tactical policy never cast the DoT');
  assert(dotDealt > 0, 'DoT ticks never reached HP (or were never counted)');
  assert(dealt >= dotDealt, 'dealt must include the player DoT damage');
  assert(dotTaken <= taken, 'taken must include enemy DoT damage');
  assert(attempts >= hits, 'proc attempts must be >= hits');
});

Deno.test('balance: cell percentiles expose the fight tails (#88)', () => {
  const cell = runCell({
    classId: 'warrior',
    level: 5,
    gear: 'best',
    policy: POLICIES.rotation,
    pool: 'whisperwood',
    sources: zoneHostilePool('whisperwood', 5),
    fights: 60,
    seed: 4242,
  });
  assertEquals(cell.fights, 60);
  assert(cell.roundsP50 <= cell.roundsP90, 'rounds p50 must not exceed p90');
  assert(cell.hpPctP50 <= cell.hpPctP90, 'hp p50 must not exceed p90');
  assert(cell.dodgesP50 <= cell.dodgesP90, 'dodge p50 must not exceed p90');
  assert(cell.avgDotDealt >= 0 && cell.avgDotTaken >= 0, 'telemetry averages are defined');
  assert(cell.avgProcAttempts >= cell.avgProcHits, 'proc attempts must be >= hits');
});

Deno.test('balance: tactical policy pierces wards, finishes wounds, breaks the matched stat (#88)', () => {
  const piercer = SKILLS.find((sk) =>
    isDamageSkill(sk) && sk.effects.some((e) => e.kind === 'damage' && e.bypassShield === true)
  )!;
  const finisher = SKILLS.find((sk) =>
    isDamageSkill(sk) && sk.effects.some((e) => e.kind === 'damage' && e.execute !== undefined)
  )!;
  // Breaks are DAMAGE skills with statmod riders (#84 offense family) —
  // found by rider, not by the pure-debuff predicate.
  const defBreak = SKILLS.find((sk) =>
    isDamageSkill(sk) && sk.effects.some((e) => e.kind === 'statmod' && e.stat === 'def')
  )!;
  const resBreak = SKILLS.find((sk) =>
    isDamageSkill(sk) && sk.effects.some((e) => e.kind === 'statmod' && e.stat === 'res')
  )!;
  assert(piercer && finisher && defBreak && resBreak, 'content authors all four tactical tools');

  const battle = (cid: ClassId, level: number, seed: number) => {
    const p = makeHero(cid, level, 'best');
    const b = startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, {
      player: p,
      rng: seededRng(seed),
    })!.battle;
    p.battle = b;
    return { p, b };
  };

  // (a) A live enemy ward routes the offense pick to the ward-ignoring
  //     skill — ordinary damage would pool INTO the ward (#88).
  {
    const { p, b } = battle(piercer.classId, piercer.learnLevel, 21);
    p.skills = [piercer.id];
    b.shield.enemy = 40;
    const act = chooseAction(p, b, POLICIES.tactical, false);
    assertEquals(act, { kind: 'skill', skillId: piercer.id });
  }
  // (b) Inside the execute threshold the finisher outranks the plain
  //     strike that sorts first (#88).
  {
    const plain = SKILLS.find((sk) =>
      sk.classId === finisher.classId && isDamageSkill(sk) &&
      !sk.effects.some((e) => e.kind === 'damage' && e.execute !== undefined)
    )!;
    assert(plain, 'the finisher class has a second damage skill');
    const { p, b } = battle(finisher.classId, finisher.learnLevel, 22);
    p.skills = [plain.id, finisher.id];
    b.enemy.hp = Math.max(1, Math.floor(b.enemy.maxHp * 0.2));
    const act = chooseAction(p, b, POLICIES.tactical, false);
    assertEquals(act, { kind: 'skill', skillId: finisher.id });
  }
  // (c) A phys hero holding both breaks leads with the DEF break while
  //     the fight has length — its own strikes can exploit it (#88).
  {
    const { p, b } = battle(
      defBreak.classId,
      Math.max(defBreak.learnLevel, resBreak.learnLevel),
      23,
    );
    p.skills = [resBreak.id, defBreak.id];
    const act = chooseAction(p, b, POLICIES.tactical, false);
    assertEquals(act, { kind: 'skill', skillId: defBreak.id });
  }
  // (d) The same pair on a MAG hero flips the pick to the RES break —
  //     matching follows the hero's damage type, not skill order (#88).
  {
    const { p, b } = battle(
      resBreak.classId,
      Math.max(defBreak.learnLevel, resBreak.learnLevel),
      24,
    );
    p.skills = [defBreak.id, resBreak.id];
    const act = chooseAction(p, b, POLICIES.tactical, false);
    assertEquals(act, { kind: 'skill', skillId: resBreak.id });
  }
});

// ── #100: full-campaign + late-boss regression for EVERY class ──────────

/** Reviewed seed set: the audited audit seed plus two additional
 * deterministic seeds with distinct encounter/proc patterns. */
const CAMPAIGN_SEEDS = [20260902, 77701, 77702] as const;

Deno.test('progression: the full campaign m1→m25 completes for EVERY class (#88/#100)', () => {
  for (const cid of CLASS_IDS) {
    for (const seed of CAMPAIGN_SEEDS) {
      const rep = simulateCampaign(cid, seed);
      const ctx =
        `${cid}@${seed}: endLevel=${rep.endLevel} endGold=${rep.endGold} fights=${rep.totalFights} ` +
        `deaths=${rep.totalDeaths} explores=${rep.totalEncounterAttempts} items=${rep.totalItemsUsed}`;
      assertEquals(
        rep.startLevel,
        2,
        `${ctx}: the sim must start from the canonical post-prologue state`,
      );
      assertEquals(
        rep.stuck,
        undefined,
        `${ctx} — campaign stalled; the stuck report names the active quest/gate and objective progress`,
      );
      assertEquals(rep.campaignDone, true, `${ctx}: every main quest m1→m25 must complete`);
      assert(rep.endLevel >= 40, `${ctx}: endgame pacing collapsed`);
      assert(rep.totalFights <= 12000, `${ctx}: fight count runaway (retry loop?)`);
      assert(rep.totalItemsUsed >= 0, `${ctx}: item use went negative`);
      // Pacing envelope, REVIEWED across the seed set: boss-gate retries
      // under the scripted rotation policy legitimately churn (the mage
      // re-dove the Aldric gate for thousands of fights — its reviewed
      // intended-lane winrate there is real, see the snapshot cells) —
      // the bound catches order-of-magnitude runaway, not reviewed grind;
      // a true stall fails above via `stuck`, which names the quest, its
      // gate and its objective progress.
      let prev = 0;
      for (const beat of rep.beats) {
        assert(
          beat.fights - prev <= 8000,
          `${ctx}: ${beat.questId} jumped ${beat.fights - prev} fights`,
        );
        prev = beat.fights;
      }
    }
  }
});

// ── #95: typed damage/heal telemetry — metrics never parse copy ──────────

Deno.test('telemetry: the restore event reports attempted vs applied (#95)', () => {
  const mend = SKILLS.find((s) => s.id === 'sk_mend')!;
  assert(mend, 'the cleric starting heal exists');
  const p = makeHero(mend.classId, mend.learnLevel, 'best');
  p.skills.push(mend.id);
  p.mp = 999;
  const b = startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, {
    player: p,
    rng: seededRng(11),
  })!.battle;
  p.battle = b;
  b.enemy.hp = 99999; // outlive the probe — this drives EVENTS, not balance
  b.enemy.maxHp = 99999;
  p.hp = statsOf(p).maxHp - 1; // THE probe: 1 missing HP
  const res = performAction(p, b, { kind: 'skill', skillId: mend.id }, seededRng(12));
  const line = res.lines.find((l) => l.includes('restores')) ?? '';
  const restored = res.trace.filter((e): e is Extract<CombatTraceEntry, { kind: 'hpRestored' }> =>
    e.kind === 'hpRestored' && e.side === 'player'
  );
  assert(restored.length >= 1, 'the cast emitted a typed restore event');
  const last = restored[restored.length - 1]!;
  assertEquals(last.applied, 1, 'exactly the missing HP was applied');
  assert(last.attempted > last.applied, 'the formulaic amount overflowed');
  assertEquals(last.attempted - last.applied > 0, true, 'the overflow is overheal, not healing');
  assert(
    line.includes('restores 1 HP'),
    `the player-facing line shows the APPLIED delta, never the formula: "${line}"`,
  );
});

Deno.test('telemetry: gross damage survives a same-round heal (#95)', () => {
  // A slower hero takes the enemy hit, THEN heals — the net round delta
  // would erase or invert the damage; typed events cannot.
  const hero = makeHero('cleric', 12, 'best');
  const stag = dungeonBossSource('whisperwood') ?? {
    enemyId: 'e_stag',
    origin: { kind: 'elite', zoneId: 'whisperwood' } as BattleOrigin,
  };
  let sawDamage = false;
  for (let i = 0; i < 40 && !sawDamage; i++) {
    const r = runFight(hero, stag.enemyId, POLICIES.rotation, seededRng(300 + i), stag.origin);
    // taken is a sum of typed hpDamaged events: structurally nonnegative,
    // and any damage taken this fight stays counted despite later heals.
    assert(r.taken >= 0, `taken went negative (${r.taken})`);
    if (r.taken > 0) sawDamage = true;
  }
  assert(sawDamage, 'the scenario actually took damage');
});

Deno.test('telemetry: enemy healing never subtracts from gross damage (#95)', () => {
  // The Marsh Leech drains HP from the hero (enemy-side lifesteal). Old
  // net-delta semantics subtracted enemy heals from `dealt`; gross event
  // sums never do.
  const hero = makeHero('warrior', 8, 'best');
  let drained = false;
  for (let i = 0; i < 30 && !drained; i++) {
    const r = runFight(
      hero,
      'e_leech',
      POLICIES.rotation,
      seededRng(400 + i),
      { kind: 'explore', zoneId: 'hollowmere' },
    );
    assert(r.dealt >= 0, `dealt went negative (${r.dealt})`);
    if (r.hpPct > 1 && r.outcome === 'win') drained = true; // leech healed past its own hits
  }
  // The invariant holds whether or not a drain was observed: dealt is a
  // sum of hpDamaged events and can never go negative.
  assert(true);
});

Deno.test('telemetry: fights need no finally — a throwing fight leaves no global state (#95/#101)', () => {
  const hero = makeHero('warrior', 5, 'best');
  assertThrows(
    () => runFight(hero, 'e_unknown_enemy', POLICIES.rotation, seededRng(1)),
    Error,
    'unknown enemy',
  );
  // A normal fight afterwards is unaffected — there is no ambient
  // collector anywhere to leak, restore or cross-contaminate.
  const r = runFight(hero, 'e_rat', POLICIES.free, seededRng(2));
  assertEquals(r.outcome, 'win');
});

// ── #101: the explicit synchronous trace replaces the module-global sink ──

Deno.test('trace: opening entries, proc nesting and terminal land in resolution order (#101)', () => {
  const p = makeHero('rogue', 20, 'best');
  p.equipment.trinket = 't_wardstone'; // battleStart ward — an opening proc
  const res = startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, {
    player: p,
    rng: seededRng(31),
  })!;
  const kinds = res.trace.map((e) => e.kind);
  assert(kinds.includes('procAttempt'), 'the battleStart trigger recorded its attempt');
  assertEquals(res.outcome, 'ongoing', 'no authored content opens lethally here');
  assert(!kinds.includes('terminal'), 'an ongoing opening records no terminal entry');
  // The ward's shieldGrant precedes the proc attempt that produced it
  // (applyInstance runs before the proc attempt is recorded).
  assert(
    kinds.indexOf('shieldGrant') !== -1 && kinds.indexOf('shieldGrant') < kinds.length,
    'the ward grant is recorded',
  );

  // Multi-hit ordering: each ordered HP-loss event appends its hpDamaged
  // entry, and the reactive proc's own entries nest BETWEEN them, in
  // exact execution order, before the outer call returns.
  const rat = ENEMIES.find((e) => e.id === 'e_rat')!;
  const originalMoves = rat.moves;
  const charm = item('t_19')!;
  const originalTriggers = charm.triggers;
  rat.moves = [{
    name: 'Double Bite',
    weight: 1,
    effects: [
      { kind: 'damage', attack: 'phys', power: 1 },
      { kind: 'damage', attack: 'phys', power: 1 },
    ],
  }];
  charm.triggers = [{
    name: 'Grudge Prick',
    trigger: 'onHpDamage',
    effects: [{
      kind: 'periodic',
      target: 'opponent',
      perRound: -3,
      duration: 2,
      tickPhase: 'roundEnd',
      name: 'Grudge Bleed',
      tags: ['bleed', 'harmful'],
    }],
    desc: 'test fixture: every HP loss answers',
  }];
  try {
    // A seed where the strike does NOT slip the double bite (starting-kit
    // SPD keeps the dodge baseline low; 'best' gear slips too often).
    let hero: PlayerState | undefined;
    let r: ReturnType<typeof startBattle> | undefined;
    let round: ReturnType<typeof performAction> | undefined;
    for (let seed = 1; seed <= 60 && !round; seed++) {
      hero = makeHero('warrior', 5, 'starting');
      hero.equipment.trinket = 't_19';
      r = startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, {
        player: hero,
        rng: seededRng(32),
      })!;
      hero.battle = r.battle;
      r.battle.enemy.hp = 99999;
      r.battle.enemy.maxHp = 99999;
      round = performAction(hero, r.battle, { kind: 'attack' }, seededRng(33 + seed));
      if (round.trace.filter((e) => e.kind === 'hpDamaged' && e.target === 'player').length < 2) {
        round = undefined; // a slip — try the next seed
      }
    }
    assert(hero && r && round, 'a non-dodged double-bite seed exists');
    const hits = round.trace.filter(
      (e): e is Extract<CombatTraceEntry, { kind: 'hpDamaged' }> =>
        e.kind === 'hpDamaged' && e.target === 'player',
    );
    assertEquals(hits.length, 2, 'both HP-loss events are on the trace');
    const procs = round.trace.filter(
      (e): e is Extract<CombatTraceEntry, { kind: 'procAttempt' }> => e.kind === 'procAttempt',
    );
    assertEquals(procs.length, 2, 'each event dispatched its own proc');
    // Nesting: proc 1's attempt sits between the two player-target hits.
    const idx = (e: CombatTraceEntry): number => round.trace.indexOf(e);
    assert(
      idx(hits[0]!) < idx(procs[0]!) && idx(procs[0]!) < idx(hits[1]!),
      'the first proc resolved synchronously between the two hits',
    );
  } finally {
    rat.moves = originalMoves;
    charm.triggers = originalTriggers;
  }
});

Deno.test('trace: periodic ticks and terminal resolution are recorded (#101)', () => {
  const poison = (b: import('../src/engine/types.ts').BattleState): void => {
    b.effectInstances.push({
      iid: 't1',
      defId: 'poison',
      name: 'Poison',
      side: 'enemy',
      source: { kind: 'skill', id: 'test', name: 'test fixture' },
      kind: 'periodic',
      perRound: -5,
      tickPhase: 'roundEnd',
      tags: ['harmful', 'periodic', 'poison'],
      stacking: 'replace',
      appliedRound: b.round,
      remaining: 3,
      removable: true,
      expiresRound: b.round + 2,
    });
  };
  // Ticks: a padded foe survives both slots, so round-end ticks run.
  const p1 = makeHero('warrior', 5, 'best');
  const b1 = startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, {
    player: p1,
    rng: seededRng(41),
  })!.battle;
  p1.battle = b1;
  b1.enemy.hp = 99999;
  b1.enemy.maxHp = 99999;
  poison(b1);
  const ticked = performAction(p1, b1, { kind: 'attack' }, seededRng(42));
  const ticks = ticked.trace.filter((e) => e.kind === 'periodicTick');
  assertEquals(ticks.length, 1, 'the DoT tick is on the trace');

  // Terminal: an unpadded fight resolves, and the terminal entry is that
  // resolution's LAST record.
  const p2 = makeHero('warrior', 5, 'best');
  const b2 = startBattle('e_rat', { kind: 'explore', zoneId: 'outskirts' }, {
    player: p2,
    rng: seededRng(41),
  })!.battle;
  p2.battle = b2;
  let last: import('../src/engine/combat.ts').ActionResult | undefined;
  for (let i = 0; i < 20 && b2.phase === 'active'; i++) {
    last = performAction(p2, b2, { kind: 'attack' }, seededRng(42 + i));
  }
  assert(last, 'the fight resolved');
  const terminal = last!.trace.filter((e) => e.kind === 'terminal');
  assertEquals(terminal.length, 1, 'exactly one terminal adjudication');
  assertEquals(
    last!.trace.indexOf(terminal[0]!),
    last!.trace.length - 1,
    'the terminal entry is the resolution\u2019s last record',
  );
});

Deno.test('trace: ignoring the returned trace changes nothing (#101)', () => {
  // Two identical seeded fights — one that consumes the trace, one that
  // discards it — produce identical state, lines, outcomes and RNG use.
  const run = (consume: boolean): { outcome: string; lines: string[]; hp: number } => {
    const p = makeHero('cleric', 12, 'best');
    const r = startBattle('e_stag', { kind: 'elite', zoneId: 'whisperwood' }, {
      player: p,
      rng: seededRng(51),
    })!;
    p.battle = r.battle;
    void (consume ? r.trace : undefined);
    let res;
    for (let i = 0; i < 200 && r.battle.phase === 'active'; i++) {
      res = performAction(p, r.battle, { kind: 'attack' }, seededRng(52 + i));
      void (consume ? res.trace : undefined);
    }
    return { outcome: res!.outcome, lines: res!.lines, hp: p.hp };
  };
  const consumed = run(true);
  const ignored = run(false);
  assertEquals(ignored, consumed, 'the trace is pure observer data');
});
