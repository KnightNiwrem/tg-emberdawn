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
  hostileZones,
  MATRIX_FIGHTS,
  MATRIX_LEVELS,
  runMatrix,
  simulateChapterOne,
  tutorialEnemies,
} from '../src/engine/balance.ts';
import { CLASS_IDS } from '../src/engine/types.ts';
import { enemy as enemyDef } from '../src/content/enemies.ts';

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

function cellLine(c: CellStat): string {
  return [
    c.classId.padEnd(8),
    `Lv${String(c.level).padStart(2)}`,
    c.gear === 'best' ? 'best' : 'strt',
    c.policy.padEnd(8),
    `${pct(c.winRate).padStart(6)}`,
    `lose ${pct(c.lossRate).padStart(5)}`,
    `ttk ${String(c.avgRoundsWin).padStart(5)}`,
    `hp ${pct(c.avgHpPctEnd).padStart(5)}`,
    `dmg ${String(c.avgDealt).padStart(6)}`,
    `took ${String(c.avgTaken).padStart(6)}`,
    `items ${c.avgItems.toFixed(2)}`,
    `guard ${c.guardFreq.toFixed(2)}`,
    `crit ${c.critsPerFight.toFixed(2)}`,
  ].join(' · ');
}

function header(title: string): void {
  console.log(`\n━━ ${title} ${'━'.repeat(Math.max(2, 70 - title.length))}`);
}

console.log('Emberdawn balance report (#74) — seeded, real-engine simulation');
console.log(`classes: ${CLASS_IDS.join(', ')} · matrix levels: ${MATRIX_LEVELS.join('/')}`);

// ── 1. Matrix ───────────────────────────────────────────────────────────
const matrix = runMatrix(MATRIX_FIGHTS);
for (const zone of hostileZones()) {
  header(
    `Zone ${zone.id} (band ${zone.levels[0]}–${
      zone.levels[1]
    }) · rotation, best gear, ${MATRIX_FIGHTS} fights/cell`,
  );
  for (const c of matrix.filter((x) => x.pool === zone.id)) console.log(cellLine(c));
  const free = matrix.filter((x) => x.pool === `${zone.id}:normal`);
  if (free.length > 0) {
    console.log(`— free-action policy (level ≤ 9, normals only) —`);
    for (const c of free) console.log(cellLine(c));
  }
}

// Class outlier ratios per zone/level (rotation cells).
header('Class outliers per zone/level (max/min winRate)');
for (const zone of hostileZones()) {
  const byLevel = new Map<number, CellStat[]>();
  for (const c of matrix) {
    if (c.pool !== zone.id || c.policy !== 'rotation') continue;
    byLevel.set(c.level, [...(byLevel.get(c.level) ?? []), c]);
  }
  for (const [level, cells] of byLevel) {
    const rates = cells.map((c) => c.winRate).filter((r) => r > 0);
    if (rates.length < 2) continue;
    const hi = Math.max(...rates);
    const lo = Math.min(...rates);
    const bestC = cells.find((c) => c.winRate === hi)!;
    const worstC = cells.find((c) => c.winRate === lo)!;
    console.log(
      `${zone.id} Lv${level}: best ${bestC.classId} ${pct(hi)} · worst ${worstC.classId} ${
        pct(lo)
      } · ratio ${(hi / Math.max(lo, 0.001)).toFixed(2)}x`,
    );
  }
}

// ── 2. Gear cliff ───────────────────────────────────────────────────────
header('Boss gear cliff — Aranya (tier-1 starting kit vs tier-2 breakpoint)');
for (const c of matrix.filter((x) => x.pool.startsWith('boss:'))) {
  const bossId = c.pool.slice(5);
  console.log(`${bossId.padEnd(10)} ${cellLine(c)}`);
}

// ── 3. Tutorial safety registry ─────────────────────────────────────────
const tutors = tutorialEnemies();
header('Tutorial-flagged encounters (harness-invariant #74)');
if (tutors.length === 0) {
  console.log('none yet — the guided prologue (#69) will flag its controlled enemy');
} else {
  for (const t of tutors) console.log(`${t.id} ${t.name} Lv${t.level}`);
}

// ── 4. Progression simulation ───────────────────────────────────────────
header('Chapter-one progression — fresh level-1 hero, real combat/rewards');
for (const cid of CLASS_IDS) {
  const rep = simulateChapterOne(cid, 4100 + ['warrior', 'mage', 'rogue', 'cleric'].indexOf(cid));
  const beatStr = rep.beats
    .map((b) => `${b.questId}@Lv${b.level}(${b.deaths}d/${b.fights}f)`)
    .join(' → ');
  console.log(
    `${cid.padEnd(8)} ${
      rep.chapter1Done ? '✅ chapter 1 done' : `⛔ stuck${rep.stuck ? `: ${rep.stuck}` : ''}`
    }`,
  );
  console.log(`         beats: ${beatStr || 'none'}`);
  console.log(
    `         end Lv${rep.endLevel} · ${rep.endGold}g · fights ${rep.totalFights} (grind ${rep.totalGrindFights}) · deaths ${rep.totalDeaths} · items ${rep.totalItemsUsed}`,
  );
  if (rep.aranyaLevel > 0) {
    console.log(
      `         Aranya first faced at Lv${rep.aranyaLevel} (gear tier ${rep.aranyaGearTier}, ${rep.aranyaDeathsBefore} deaths before first win)`,
    );
  }
}

// ── 5. Elite exposure ───────────────────────────────────────────────────
header('Elite exposure in hostile tables (weight share of hostile explores)');
for (const z of hostileZones()) {
  for (const ev of z.explore) {
    if (ev.kind !== 'elite') continue;
    console.log(
      `${z.id}: ${ev.enemy} (${enemyDef(ev.enemy)?.name}) — elite share recorded in snapshot`,
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
