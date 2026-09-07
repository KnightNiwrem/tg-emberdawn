/**
 * `deno task balance` — prints the deterministic combat/progression balance
 * report (#74). Everything runs through the pure harness in
 * src/engine/balance.ts: real performAction() mechanics, fixed seeds, no
 * production-content mutation.
 *
 * `--update-snapshot` regenerates tests/balance_snapshot.json. A deliberate
 * balance change must refresh that file with an explanation in the commit
 * message; the reviewed snapshot is asserted in tests/balance_test.ts.
 */

import {
  buildSnapshot,
  type CellStat,
  dungeonBossSource,
  eliteShare,
  hostileZones,
  MATRIX_FIGHTS,
  MATRIX_LEVELS,
  runMatrix,
  simulateChapterOne,
  tutorialEnemies,
} from '../src/engine/balance.ts';
import { CLASS_IDS } from '../src/engine/types.ts';
import { enemy as enemyDef } from '../src/content/enemies.ts';

const pct = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

function cellLine(cell: CellStat): string {
  return [
    cell.classId.padEnd(8),
    `Lv${String(cell.level).padStart(2)}`,
    cell.gear === 'best' ? 'best' : 'strt',
    cell.policy.padEnd(8),
    `${pct(cell.winRate).padStart(6)}`,
    `lose ${pct(cell.lossRate).padStart(5)}`,
    `ttk ${String(cell.avgRoundsWin).padStart(5)}`,
    `hp ${pct(cell.avgHpPctEnd).padStart(5)}`,
    `dmg ${String(cell.avgDealt).padStart(6)}`,
    `took ${String(cell.avgTaken).padStart(6)}`,
    `items ${cell.avgItems.toFixed(2)}`,
    `guard ${cell.guardFreq.toFixed(2)}`,
    `crit ${cell.critsPerFight.toFixed(2)}`,
    `skip ${cell.avgSkippedRounds.toFixed(2)}`,
    `util ${cell.avgBuffCasts.toFixed(2)}/${cell.avgShieldCasts.toFixed(2)}/${
      cell.avgDotCasts.toFixed(2)
    }`,
  ].join(' · ');
}

/** The source-attributed effect observation for one cell (#84) — the top
 * few live effects by uptime, with their applying source. */
function effectLine(cell: CellStat): string {
  return Object.entries(cell.effectRounds)
    .sort((leftEffect, rightEffect) => rightEffect[1] - leftEffect[1])
    .slice(0, 4)
    .map(([effectKey, rounds]) =>
      `${effectKey} [${cell.effectSources[effectKey] ?? '?'}] ${rounds.toFixed(1)}r`
    )
    .join(' · ');
}

function header(title: string): void {
  console.log(`\n━━ ${title} ${'━'.repeat(Math.max(2, 70 - title.length))}`);
}

console.log('Emberdawn balance report (#74/#84) — seeded, real-engine simulation');
console.log(`classes: ${CLASS_IDS.join(', ')} · matrix levels: ${MATRIX_LEVELS.join('/')}`);

// ── 1. Matrix ───────────────────────────────────────────────────────────
const matrix = runMatrix(MATRIX_FIGHTS);
for (const zone of hostileZones()) {
  header(
    `Zone ${zone.id} (band ${zone.levels[0]}–${
      zone.levels[1]
    }) · rotation, best gear, ${MATRIX_FIGHTS} fights/cell`,
  );
  for (const cell of matrix.filter((cell) => cell.pool === zone.id)) console.log(cellLine(cell));
  const free = matrix.filter((cell) => cell.pool === `${zone.id}:normal`);
  if (free.length > 0) {
    console.log(`— free-action policy (level ≤ 9, normals only) —`);
    for (const cell of free) console.log(cellLine(cell));
  }
  // #84: the effect-aware policy beside the plain rotation — the reviewed
  // before/after pair for #81–#83 balance evidence.
  const tactical = matrix.filter((cell) => cell.pool === `${zone.id}:tactical`);
  if (tactical.length > 0) {
    console.log(`— tactical policy (effect-aware, #84) —`);
    for (const cell of tactical) {
      console.log(cellLine(cell));
      const effectSummary = effectLine(cell);
      if (effectSummary) console.log(`         effects: ${effectSummary}`);
    }
  }
}

// Class outlier ratios per zone/level (rotation cells).
header('Class outliers per zone/level (max/min winRate)');
for (const zone of hostileZones()) {
  const byLevel = new Map<number, CellStat[]>();
  for (const cell of matrix) {
    if (cell.pool !== zone.id || cell.policy !== 'rotation') continue;
    byLevel.set(cell.level, [...(byLevel.get(cell.level) ?? []), cell]);
  }
  for (const [level, cells] of byLevel) {
    const rates = cells.map((cell) => cell.winRate).filter((winRate) => winRate > 0);
    if (rates.length < 2) continue;
    const highestWinRate = Math.max(...rates);
    const lowestWinRate = Math.min(...rates);
    const bestCell = cells.find((cell) => cell.winRate === highestWinRate)!;
    const worstCell = cells.find((cell) => cell.winRate === lowestWinRate)!;
    console.log(
      `${zone.id} Lv${level}: best ${bestCell.classId} ${
        pct(highestWinRate)
      } · worst ${worstCell.classId} ${pct(lowestWinRate)} · ratio ${
        (highestWinRate / Math.max(lowestWinRate, 0.001)).toFixed(2)
      }x`,
    );
  }
}

// ── 2. Gear cliff ───────────────────────────────────────────────────────
header('Boss gear cliff — Aranya (tier-1 starting kit vs tier-2 breakpoint)');
for (
  const cell of matrix.filter((cell) =>
    cell.pool.startsWith('boss:') && !cell.pool.endsWith(':tactical')
  )
) {
  const bossId = cell.pool.slice(5);
  console.log(`${bossId.padEnd(10)} ${cellLine(cell)}`);
}

// ── 3. Tutorial safety registry ─────────────────────────────────────────
const tutors = tutorialEnemies();
header('Tutorial-flagged encounters (harness-invariant #74)');
if (tutors.length === 0) {
  console.log('none yet — the guided prologue (#69) will flag its controlled enemy');
} else {
  for (const enemyDef of tutors) console.log(`${enemyDef.id} ${enemyDef.name} Lv${enemyDef.level}`);
}

// ── 4. Progression simulation ───────────────────────────────────────────
header('Chapter-one progression — post-tutorial hero (Lv 2), real combat/rewards');
for (const cid of CLASS_IDS) {
  const rep = simulateChapterOne(cid, 4100 + ['warrior', 'mage', 'rogue', 'cleric'].indexOf(cid));
  const beatStr = rep.beats
    .map((beat) => `${beat.questId}@Lv${beat.level}(${beat.deaths}d/${beat.fights}f)`)
    .join(' → ');
  console.log(
    `${cid.padEnd(8)} ${
      rep.chapter1Done ? '✅ chapter 1 done' : `⛔ stuck${rep.stuck ? `: ${rep.stuck}` : ''}`
    }`,
  );
  console.log(`         beats: ${beatStr || 'none'}`);
  console.log(
    `         start Lv${rep.startLevel} · end Lv${rep.endLevel} · ${rep.endGold}g · fights ${rep.totalFights} (objective ${rep.totalObjectiveFights} / grind ${rep.totalGrindFights}) · explores ${rep.totalEncounterAttempts} · deaths ${rep.totalDeaths} · items ${rep.totalItemsUsed}`,
  );
  if (rep.aranyaLevel > 0) {
    console.log(
      `         Aranya first faced at Lv${rep.aranyaLevel} (gear tier ${rep.aranyaGearTier}, ${rep.aranyaDeathsBefore} deaths before first win)`,
    );
  }
}

// ── 5. Elite exposure ───────────────────────────────────────────────────
header('Elite exposure in hostile tables (live share at the levels that matter, #74)');
for (const zoneDef of hostileZones()) {
  for (const event of zoneDef.explore) {
    if (event.kind !== 'elite') continue;
    const locked = event.minPlayerLevel ?? 1;
    const upperLevel = Math.min(zoneDef.levels[1], Math.max(locked, zoneDef.levels[0]));
    const at = (lv: number): string => `${pct(eliteShare(zoneDef.id, lv))} @Lv${lv}`;
    console.log(
      `${zoneDef.id}: ${event.enemy} (${enemyDef(event.enemy)?.name}) — ${
        at(zoneDef.levels[0])
      } · ${at(upperLevel)}`,
    );
  }
}
const boss = dungeonBossSource('whisperwood');
if (boss) {
  console.log(`whisperwood boss gate: ${boss.enemyId} behind m3_roots (requireDone: false)`);
}

// ── 6. Snapshot ─────────────────────────────────────────────────────────
if (Deno.args.includes('--update-snapshot')) {
  const snap = buildSnapshot();
  const path = new URL('../tests/balance_snapshot.json', import.meta.url);
  await Deno.writeTextFile(path, JSON.stringify(snap, null, 2) + '\n');
  console.log(
    `\n✅ snapshot written: ${path.pathname} (${snap.cells.length} cells × ${snap.fightsPerCell} fights)`,
  );
} else {
  console.log(
    '\n(snapshot unchanged — regenerate deliberately with: deno task balance:update)',
  );
}
