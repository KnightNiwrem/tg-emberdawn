/**
 * Deterministic balance harness (#74): drives the REAL combat engine
 * (startBattle → performAction → resolveVictory) over seeded fights, so
 * pacing decisions rest on distributions instead of one lucky battle.
 *
 * Pure: engine + content only — no grammy, no wall clock (explore's `now`
 * is injected), no Math.random, and no production-content mutation. The
 * printed report lives in scripts/balance.ts (`deno task balance`); the CI
 * invariants and the reviewed snapshot live in tests/balance_test.ts +
 * tests/balance_snapshot.json. Balance changes must refresh the snapshot
 * with an explanation in the commit message.
 */

import type { BattleOrigin, BattleState, ClassId, PlayerState } from './types.ts';
import { CLASS_IDS } from './types.ts';
import type { EnemyDef, SkillDef, ZoneDef } from '../content/types.ts';
import { xpForNextLevel } from './classes.ts';
import { applyDeath, createPlayer, grantXp, statsOf } from './character.ts';
import { performAction, type PlayerAction, startBattle } from './combat.ts';
import { resolveVictory } from './world.ts';
import { buy, currentStock } from './shops.ts';
import { countOf, removeItem } from './inventory.ts';
import { acceptQuest, onTalk, syncAvailability, turnInQuest } from './quests.ts';
import { clampPools } from './character.ts';
import { diveDungeon, dungeonOf, explore, travel } from './world.ts';
import { ENEMIES } from '../content/enemies.ts';
import { isEquippable, item as itemDef, ITEMS } from '../content/items.ts';
import { quest, zoneOfNpc } from '../content/quests.ts';
import { skill as skillDef } from '../content/skills.ts';
import { zone as zoneDef, ZONES } from '../content/zones.ts';
import { type Rng } from './rng.ts';

// ── Heroes ──────────────────────────────────────────────────────────────

/** Gear the simulation hero wears: `starting` = the level-1 class kit
 * (doubles as the deliberately under-geared case at higher levels);
 * `best` = the best normally obtainable, equippable catalog pieces. */
export type GearProfile = 'starting' | 'best';

/** A hero leveled through the REAL grantXp curve (skills/pools canonical),
 * then equipped per profile. Never used in production play. */
export function makeHero(classId: ClassId, level: number, gear: GearProfile): PlayerState {
  const p = createPlayer(0, 'Sim', classId);
  let xp = 0;
  for (let l = 1; l < level; l++) xp += xpForNextLevel(l);
  grantXp(p, xp);
  if (gear === 'best') equipBest(p);
  const s = statsOf(p);
  p.hp = s.maxHp;
  p.mp = s.maxMp;
  return p;
}

function statWeight(id: string): number {
  const s = itemDef(id)?.stats ?? {};
  return (s.atk ?? 0) + (s.def ?? 0) + (s.mag ?? 0) + (s.res ?? 0) + (s.spd ?? 0) +
    (s.luck ?? 0) + (s.hp ?? 0) / 4 + (s.mp ?? 0) / 2;
}

/** Equips the best equippable catalog gear (class + level legal, never
 * unique trophies) — approximates "current best normally obtainable gear". */
function equipBest(p: PlayerState): void {
  for (const kind of ['weapon', 'armor', 'trinket'] as const) {
    const candidates = ITEMS.filter((it) =>
      it.kind === kind && !it.unique && isEquippable(it.id, p.classId, p.level).ok
    );
    const best = candidates.sort((a, b) =>
      statWeight(b.id) - statWeight(a.id) || b.level - a.level
    )[0];
    if (best && statWeight(best.id) > statWeight(p.equipment[kind] ?? '')) {
      p.equipment[kind] = best.id;
    }
  }
  clampPools(p);
}

// ── Policies ────────────────────────────────────────────────────────────

export interface Policy {
  /** `free` — only the class free action. `skill` — best damage skill when
   * it pays MP, else free. `rotation` — heal when hurt, best skill when
   * affordable, guard to recover MP when starved, else free. */
  name: 'free' | 'skill' | 'rotation';
  items: boolean;
}

export const POLICIES = {
  free: { name: 'free', items: false } as Policy,
  skill: { name: 'skill', items: false } as Policy,
  rotation: { name: 'rotation', items: false } as Policy,
  rotationWithItems: { name: 'rotation', items: true } as Policy,
};

const HEAL_ITEMS = ['c_super_potion', 'c_greater_potion', 'c_potion', 'c_minor_potion'];
const MP_ITEMS = ['c_greater_ether', 'c_ether', 'c_minor_ether'];

function chooseAction(
  p: PlayerState,
  b: BattleState,
  policy: Policy,
  lastWasGuard: boolean,
): PlayerAction {
  if (policy.name === 'free') return { kind: 'attack' };
  const s = statsOf(p);
  const learned = p.skills
    .map((id) => skillDef(id))
    .filter((sk): sk is SkillDef => Boolean(sk));
  const usable = (sk: SkillDef): boolean => (b.cooldowns[sk.id] ?? 0) === 0 && p.mp >= sk.mpCost;
  const offense = learned
    .filter((sk) => sk.type === 'phys' || sk.type === 'mag' || sk.type === 'debuff')
    .sort((a, z) => z.power - a.power);
  const heals = learned.filter((sk) => sk.type === 'heal').sort((a, z) => z.power - a.power);

  if (policy.name === 'skill') {
    const sk = offense.find(usable);
    return sk ? { kind: 'skill', skillId: sk.id } : { kind: 'attack' };
  }

  // rotation — a sensibly played hero.
  const hurting = p.hp < s.maxHp * 0.5;
  if (hurting && policy.items && p.hp < s.maxHp * 0.35) {
    const potion = HEAL_ITEMS.find((id) => countOf(p, id) > 0);
    if (potion) return { kind: 'item', itemId: potion };
  }
  if (hurting) {
    const heal = heals.find(usable);
    if (heal) return { kind: 'skill', skillId: heal.id };
  }
  const sk = offense.find(usable);
  if (sk) return { kind: 'skill', skillId: sk.id };
  const cheapest = offense.map((x) => x.mpCost).sort((a, z) => a - z)[0] ?? 0;
  if (policy.items && p.mp < cheapest) {
    const ether = MP_ITEMS.find((id) => countOf(p, id) > 0);
    if (ether) return { kind: 'item', itemId: ether };
  }
  // Starved and hurting: alternate guard (mitigate + recover MP) with the
  // free action so a stalled rotation still deals damage.
  if (p.hp < s.maxHp * 0.4 && p.mp < cheapest && !lastWasGuard) return { kind: 'guard' };
  return { kind: 'attack' };
}

// ── Fights ──────────────────────────────────────────────────────────────

export interface FightResult {
  outcome: 'win' | 'lose' | 'timeout';
  rounds: number;
  hpPct: number;
  mpPct: number;
  dealt: number;
  taken: number;
  itemsUsed: number;
  guardRounds: number;
  mpFromGuard: number;
  crits: number;
  dodges: number;
  healDone: number;
  overheal: number;
}

const STRIKE = /(?:hits|sears) .* for (\d+)/;
const TAKEN = /— (\d+) damage to you/;
const CRIT = '— critical';
const DODGE = 'slip aside';
const ENEMY_HEAL = /recovers (\d+) HP/;

/** Expected heal of a heal-type skill (mirrors combat.ts formulas). */
function expectedSkillHeal(p: PlayerState, sk: SkillDef): number {
  const s = statsOf(p);
  if (sk.id === 'sk_miracle') return s.maxHp;
  if (sk.potency && sk.power === 0) return Math.floor(s.maxHp * sk.potency);
  const buffs = p.battle?.buffs;
  const magPct = buffs ? buffs.magPct : 0;
  const weakened = buffs ? buffs.weakenedPct : 0;
  const mag = Math.max(1, Math.round(s.mag * (1 - weakened) * (1 + magPct)));
  return Math.round(mag * sk.power * 2.0 + 20);
}

/** Runs ONE real fight on a cloned hero. Never mutates the passed hero and
 * never bypasses combat: victory routes through resolveVictory, defeat
 * through the lethal-hit path. */
export function runFight(
  hero: PlayerState,
  enemyId: string,
  policy: Policy,
  rng: Rng,
  origin: BattleOrigin = { kind: 'explore', zoneId: 'whisperwood' },
): FightResult {
  const p = structuredClone(hero) as PlayerState;
  const b = startBattle(enemyId, origin);
  if (!b) throw new Error(`balance harness: unknown enemy ${enemyId}`);
  p.battle = b;
  let rounds = 0;
  let lastWasGuard = false;
  const result: FightResult = {
    outcome: 'timeout',
    rounds: 0,
    hpPct: 0,
    mpPct: 0,
    dealt: 0,
    taken: 0,
    itemsUsed: 0,
    guardRounds: 0,
    mpFromGuard: 0,
    crits: 0,
    dodges: 0,
    healDone: 0,
    overheal: 0,
  };
  while (b.phase === 'active' && rounds < 200) {
    const action = chooseAction(p, b, policy, lastWasGuard);
    lastWasGuard = action.kind === 'guard';
    const hpBefore = p.hp;
    const mpBefore = p.mp;
    const res = performAction(p, b, action, rng);
    rounds++;
    for (const line of res.lines) {
      const strike = STRIKE.exec(line);
      if (strike) result.dealt += Number(strike[1]);
      const taken = TAKEN.exec(line);
      if (taken) result.taken += Number(taken[1]);
      if (line.includes(CRIT)) result.crits++;
      if (line.includes(DODGE)) result.dodges++;
      const eh = ENEMY_HEAL.exec(line);
      if (eh) result.dealt -= Number(eh[1]);
    }
    if (action.kind === 'guard') {
      result.guardRounds++;
      result.mpFromGuard += Math.max(0, p.mp - mpBefore);
    }
    if (action.kind === 'item') result.itemsUsed++;
    // Heals: actual applied HP (excluding damage taken this round) and
    // overheal against the formulaic expectation.
    if (action.kind === 'skill') {
      const sk = skillDef(action.skillId);
      if (sk?.type === 'heal') {
        const applied = Math.max(0, p.hp - hpBefore + result.taken);
        result.healDone += applied;
        result.overheal += Math.max(0, expectedSkillHeal(p, sk) - applied);
      }
    } else if (action.kind === 'item') {
      const eff = itemDef(action.itemId)?.effect;
      if (eff?.healHp) {
        const applied = Math.max(0, p.hp - hpBefore + result.taken);
        result.healDone += applied;
        result.overheal += Math.max(0, eff.healHp - applied);
      }
    }
    if (b.enemy.hp <= 0) {
      resolveVictory(p, b, rng);
      result.outcome = 'win';
      break;
    }
    if (p.hp <= 0) {
      result.outcome = 'lose';
      break;
    }
  }
  if (result.outcome === 'timeout') result.outcome = 'timeout';
  const s = statsOf(p);
  result.rounds = rounds;
  result.hpPct = s.maxHp > 0 ? p.hp / s.maxHp : 0;
  result.mpPct = s.maxMp > 0 ? p.mp / s.maxMp : 0;
  return result;
}

// ── Encounter pools ─────────────────────────────────────────────────────

export interface EncounterSource {
  enemyId: string;
  weight: number;
  origin: BattleOrigin;
}

/** A zone's ordinary battle table (no elites). */
export function zoneNormalPool(zoneId: string): EncounterSource[] {
  const z = zoneDef(zoneId);
  if (!z) return [];
  return z.explore
    .filter((e) => e.kind === 'battle')
    .map((e) => ({ enemyId: e.enemy, weight: e.weight, origin: { kind: 'explore', zoneId } }));
}

/** Battle + elite table, exactly as explore() rolls it. */
export function zoneHostilePool(zoneId: string): EncounterSource[] {
  const z = zoneDef(zoneId);
  if (!z) return [];
  return z.explore
    .filter((e) => e.kind === 'battle' || e.kind === 'elite')
    .map((e) => ({
      enemyId: e.enemy,
      weight: e.weight,
      origin: { kind: e.kind === 'elite' ? 'elite' : 'explore', zoneId } as BattleOrigin,
    }));
}

/** Share of HOSTILE explores (battle+elite) that roll the elite. */
export function eliteShare(zoneId: string): number {
  const z = zoneDef(zoneId);
  if (!z) return 0;
  const hostile = z.explore.filter((e) => e.kind === 'battle' || e.kind === 'elite');
  const total = hostile.reduce((a, e) => a + e.weight, 0);
  const elite = hostile.filter((e) => e.kind === 'elite').reduce((a, e) => a + e.weight, 0);
  return total > 0 ? elite / total : 0;
}

export function dungeonBossSource(zoneId: string): EncounterSource | undefined {
  const z = zoneDef(zoneId);
  if (!z?.dungeon) return undefined;
  const d = z.dungeon;
  return {
    enemyId: d.boss,
    weight: 1,
    origin: {
      kind: 'dungeon',
      zoneId: z.id,
      dungeonId: d.id,
      floor: d.floors.length + 1,
      boss: true,
    },
  };
}

export function dungeonFloorSources(zoneId: string): EncounterSource[] {
  const z = zoneDef(zoneId);
  if (!z?.dungeon) return [];
  return z.dungeon.floors.flatMap((f) =>
    f.enemies.map((enemyId) => ({
      enemyId,
      weight: 1,
      origin: {
        kind: 'dungeon',
        zoneId: z.id,
        dungeonId: z.dungeon!.id,
        floor: z.dungeon!.floors.indexOf(f) + 1,
        boss: false,
      } as BattleOrigin,
    }))
  );
}

// ── Cells (aggregate many seeded fights) ────────────────────────────────

export interface CellSpec {
  classId: ClassId;
  level: number;
  gear: GearProfile;
  policy: Policy;
  /** Zone id the sources came from (labels + seeds), or a synthetic pool id. */
  pool: string;
  sources: EncounterSource[];
  fights: number;
  seed: number;
}

export interface CellStat {
  classId: ClassId;
  level: number;
  gear: GearProfile;
  policy: string;
  items: boolean;
  pool: string;
  fights: number;
  winRate: number;
  lossRate: number;
  timeoutRate: number;
  avgRoundsWin: number;
  avgHpPctEnd: number;
  avgMpPctEnd: number;
  avgDealt: number;
  avgTaken: number;
  avgItems: number;
  guardFreq: number;
  critsPerFight: number;
  dodgesPerFight: number;
  healPerFight: number;
  overhealPerFight: number;
}

const r4 = (n: number): number => Math.round(n * 10000) / 10000;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

export function runCell(spec: CellSpec): CellStat {
  const hero = makeHero(spec.classId, spec.level, spec.gear);
  const total = spec.sources.reduce((a, s) => a + s.weight, 0);
  const acc = {
    wins: 0,
    losses: 0,
    timeouts: 0,
    roundsWin: 0,
    hpPct: 0,
    mpPct: 0,
    dealt: 0,
    taken: 0,
    items: 0,
    guard: 0,
    crits: 0,
    dodges: 0,
    heals: 0,
    overheal: 0,
  };
  const rng = (() => {
    let a = spec.seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  for (let i = 0; i < spec.fights; i++) {
    const roll = rng() * total;
    let acc2 = 0;
    let src = spec.sources[0]!;
    for (const s of spec.sources) {
      acc2 += s.weight;
      if (roll < acc2) {
        src = s;
        break;
      }
    }
    const res = runFight(hero, src.enemyId, spec.policy, rng, src.origin);
    if (res.outcome === 'win') acc.wins++;
    else if (res.outcome === 'lose') acc.losses++;
    else acc.timeouts++;
    if (res.outcome === 'win') acc.roundsWin += res.rounds;
    acc.hpPct += res.hpPct;
    acc.mpPct += res.mpPct;
    acc.dealt += res.dealt;
    acc.taken += res.taken;
    acc.items += res.itemsUsed;
    acc.guard += res.guardRounds;
    acc.crits += res.crits;
    acc.dodges += res.dodges;
    acc.heals += res.healDone;
    acc.overheal += res.overheal;
  }
  const f = spec.fights;
  const wins = acc.wins;
  return {
    classId: spec.classId,
    level: spec.level,
    gear: spec.gear,
    policy: spec.policy.name,
    items: spec.policy.items,
    pool: spec.pool,
    fights: f,
    winRate: r4(wins / f),
    lossRate: r4(acc.losses / f),
    timeoutRate: r4(acc.timeouts / f),
    avgRoundsWin: wins > 0 ? r2(acc.roundsWin / wins) : 0,
    avgHpPctEnd: r4(acc.hpPct / f),
    avgMpPctEnd: r4(acc.mpPct / f),
    avgDealt: r2(acc.dealt / f),
    avgTaken: r2(acc.taken / f),
    avgItems: r3(acc.items / f),
    guardFreq: r3(acc.guard / f),
    critsPerFight: r3(acc.crits / f),
    dodgesPerFight: r3(acc.dodges / f),
    healPerFight: r2(acc.heals / f),
    overhealPerFight: r2(acc.overheal / f),
  };
}

// ── Standard matrices ───────────────────────────────────────────────────

/** Levels the issue names, then representative gear/zone breakpoints. */
export const MATRIX_LEVELS = [1, 2, 4, 7, 9, 13, 16, 22, 31, 45] as const;
export const MATRIX_FIGHTS = 120;

/** Hostile zones with at least one ordinary battle. */
export function hostileZones(): ZoneDef[] {
  return ZONES.filter((z) => !z.safeHaven && zoneNormalPool(z.id).length > 0);
}

/** The full class/level/zone matrix (script report). */
export function runMatrix(fights = MATRIX_FIGHTS, seedBase = 9100): CellStat[] {
  const cells: CellStat[] = [];
  let i = 0;
  for (const cid of CLASS_IDS) {
    for (const z of hostileZones()) {
      const [lo, hi] = z.levels;
      for (const level of MATRIX_LEVELS) {
        if (level < lo - 2 || level > hi + 2) continue;
        cells.push(
          runCell({
            classId: cid,
            level,
            gear: 'best',
            policy: POLICIES.rotation,
            pool: z.id,
            sources: zoneHostilePool(z.id),
            fights,
            seed: seedBase + i++,
          }),
        );
        if (level <= 9) {
          cells.push(
            runCell({
              classId: cid,
              level,
              gear: 'best',
              policy: POLICIES.free,
              pool: `${z.id}:normal`,
              sources: zoneNormalPool(z.id),
              fights,
              seed: seedBase + i++,
            }),
          );
        }
      }
    }
    // Bosses at their band top and one gear tier later (the +6 cliff).
    for (const z of ZONES) {
      const boss = dungeonBossSource(z.id);
      if (!boss) continue;
      for (const level of [z.levels[1], Math.min(MAX_LEVEL_SIM, z.levels[1] + 6)]) {
        cells.push(
          runCell({
            classId: cid,
            level,
            gear: 'best',
            policy: POLICIES.rotation,
            pool: `boss:${boss.enemyId}`,
            sources: [boss],
            fights,
            seed: seedBase + i++,
          }),
        );
      }
    }
  }
  return cells;
}

const MAX_LEVEL_SIM = 45;

// ── Snapshot (reviewed balance envelopes) ───────────────────────────────

export const SNAPSHOT_FIGHTS = 200;

export interface BalanceSnapshot {
  fightsPerCell: number;
  note: string;
  eliteShare: Record<string, number>;
  cells: CellStat[];
}

/** The reviewed snapshot: opening band, per-enemy level-1 table, free-action
 * viability, the Aranya gear cliff, and elite exposure. Regenerate with
 * `deno task balance:update`; a deliberate balance change must refresh it
 * with an explanation. */
export function buildSnapshot(): BalanceSnapshot {
  const cells: CellStat[] = [];
  let i = 0;
  const nextSeed = (): number => 7100 + i++;
  const push = (c: Omit<CellSpec, 'seed' | 'fights'> & { fights?: number }): void => {
    cells.push(runCell({ ...c, fights: c.fights ?? SNAPSHOT_FIGHTS, seed: nextSeed() }));
  };
  // 1. Opening band: rotation (no items) across Whisperwood's hostile table.
  for (const cid of CLASS_IDS) {
    for (const level of [1, 2, 4, 7, 9]) {
      push({
        classId: cid,
        level,
        gear: 'best',
        policy: POLICIES.rotation,
        pool: 'whisperwood',
        sources: zoneHostilePool('whisperwood'),
      });
    }
    // 2. Free-action viability at level 1 (weakest enemy + normal pool).
    push({
      classId: cid,
      level: 1,
      gear: 'starting',
      policy: POLICIES.free,
      pool: 'solo:e_rat',
      sources: [{
        enemyId: 'e_rat',
        weight: 1,
        origin: { kind: 'explore', zoneId: 'whisperwood' },
      }],
    });
    push({
      classId: cid,
      level: 1,
      gear: 'starting',
      policy: POLICIES.free,
      pool: 'whisperwood:normal',
      sources: zoneNormalPool('whisperwood'),
    });
  }
  // 3. Per-enemy level-1 table (rotation, no items) — the class-mechanics
  //    table behind the onboarding redesign.
  for (const src of zoneHostilePool('whisperwood')) {
    for (const cid of CLASS_IDS) {
      push({
        classId: cid,
        level: 1,
        gear: 'starting',
        policy: POLICIES.rotation,
        pool: `solo:${src.enemyId}`,
        sources: [src],
      });
    }
  }
  // 4. The Aranya gear cliff: tier-1 vs tier-2 breakpoint.
  const aranya = dungeonBossSource('whisperwood')!;
  for (const cid of CLASS_IDS) {
    for (const [level, gear] of [[6, 'starting'], [7, 'best'], [9, 'best']] as const) {
      push({
        classId: cid,
        level,
        gear,
        policy: POLICIES.rotation,
        pool: `boss:${aranya.enemyId}@${gear === 'best' ? 't2' : 't1'}`,
        sources: [aranya],
      });
    }
  }
  const eliteShareRecord: Record<string, number> = {};
  for (const z of hostileZones()) {
    const share = eliteShare(z.id);
    if (share > 0) eliteShareRecord[z.id] = r4(share);
  }
  return {
    fightsPerCell: SNAPSHOT_FIGHTS,
    note:
      'Reviewed balance envelopes (#74). Regenerate with deno task balance:update; a deliberate balance change must refresh this file with an explanation in its commit message.',
    eliteShare: eliteShareRecord,
    cells,
  };
}

// ── Chapter-one progression simulation ──────────────────────────────────

export interface ProgressionBeat {
  questId: string;
  level: number;
  gold: number;
  deaths: number;
  fights: number;
  grindFights: number;
  itemsUsed: number;
}

export interface ProgressionReport {
  classId: ClassId;
  seed: number;
  beats: ProgressionBeat[];
  endLevel: number;
  endGold: number;
  totalDeaths: number;
  totalFights: number;
  totalGrindFights: number;
  totalItemsUsed: number;
  chapter1Done: boolean;
  aranyaLevel: number;
  aranyaGearTier: number;
  aranyaDeathsBefore: number;
  stuck?: string;
}

const CH1 = [
  'm1_embers',
  'm2_letter',
  'm3_wolves',
  'm4_floors',
  'm5_arms',
  'm3_roots',
  'm4_blessing',
] as const;

function weaponTier(p: PlayerState): number {
  return p.equipment.weapon ? itemDef(p.equipment.weapon)?.tier ?? 0 : 0;
}

/** Chapter 1 from a fresh level-1 hero with REAL combat, rewards, shops and
 * deaths. Reveals when story beats unlock, how much grinding the curve
 * demands, and what gear the boss actually needed. */
export function simulateChapterOne(classId: ClassId, seed: number): ProgressionReport {
  const rng: Rng = seededRng(seed);
  const p = createPlayer(0, 'Sim', classId);
  p.tutorial = 'done'; // the sim models a player past the prologue (#69)
  syncAvailability(p);
  let deaths = 0;
  let fights = 0;
  let grind = 0;
  let itemsUsed = 0;
  const beats: ProgressionBeat[] = [];
  const report: ProgressionReport = {
    classId,
    seed,
    beats,
    endLevel: 1,
    endGold: 0,
    totalDeaths: 0,
    totalFights: 0,
    totalGrindFights: 0,
    totalItemsUsed: 0,
    chapter1Done: false,
    aranyaLevel: 0,
    aranyaGearTier: 0,
    aranyaDeathsBefore: 0,
  };
  const healCount = (): number => HEAL_ITEMS.reduce((n, id) => n + countOf(p, id), 0);

  /** One real fight. 'death' applies the real death flow (revive at the
   * safe haven, −10% gold); 'retreat' is a timeout — heal up, no death. */
  const fight = (b: BattleState): 'win' | 'death' | 'retreat' => {
    fights++;
    const before = healCount();
    let rounds = 0;
    let lastWasGuard = false;
    while (b.phase === 'active' && rounds < 200) {
      const action = chooseAction(p, b, POLICIES.rotationWithItems, lastWasGuard);
      lastWasGuard = action.kind === 'guard';
      performAction(p, b, action, rng);
      rounds++;
      if (b.enemy.hp <= 0) {
        resolveVictory(p, b, rng);
        itemsUsed += before - healCount();
        return 'win';
      }
      if (p.hp <= 0) {
        applyDeath(p);
        deaths++;
        itemsUsed += before - healCount();
        return 'death';
      }
    }
    itemsUsed += before - healCount();
    return 'retreat';
  };

  const goto = (zoneId: string): void => {
    if (p.currentZone !== zoneId) travel(p, zoneId);
  };

  /** Death recovery: re-entering the safe haven fully heals (free travel,
   * by design); then shop while there. */
  const restock = (): void => {
    if (p.currentZone !== 'emberdawn') {
      travel(p, 'emberdawn');
    } else {
      travel(p, 'whisperwood');
      travel(p, 'emberdawn');
    }
    shop();
  };

  const equipFromBag = (id: string): void => {
    const kind = itemDef(id)?.kind;
    if (kind !== 'weapon' && kind !== 'armor' && kind !== 'trinket') return;
    if (!removeItem(p, id, 1)) return;
    p.equipment[kind] = id;
    clampPools(p);
  };

  function shopHere(): void {
    const stock = currentStock(p);
    for (const kind of ['weapon', 'armor'] as const) {
      const cur = p.equipment[kind] ?? '';
      const curW = statWeight(cur);
      const better = stock
        .filter((id) =>
          (kind === 'weapon' ? id.startsWith('w_') : id.startsWith('a_')) &&
          isEquippable(id, p.classId, p.level).ok &&
          statWeight(id) > curW &&
          (itemDef(id)?.price ?? 0) <= p.gold - 30 // keep a potion buffer
        )
        .sort((a, b) => statWeight(b) - statWeight(a))[0];
      if (better && buy(p, better).ok) {
        equipFromBag(better);
      }
    }
    // Best trinket already in the bag.
    const trinket = p.inventory
      .map((e) => e.id)
      .filter((id) => itemDef(id)?.kind === 'trinket' && isEquippable(id, p.classId, p.level).ok)
      .sort((a, b) => statWeight(b) - statWeight(a))[0];
    if (trinket && statWeight(trinket) > statWeight(p.equipment.trinket ?? '')) {
      equipFromBag(trinket);
    }
    const potion = 'c_minor_potion';
    while (countOf(p, potion) < 3) {
      if (!buy(p, potion).ok) break;
    }
  }

  /** Shops every unlocked rack (#73): the village band stocks tier-2 steel
   * at the m5_arms beat, and the Whisperwood's band carries it too — a real
   * shopper compares both. Ends wherever the better rack was. */
  function shop(): void {
    shopHere();
    if (p.unlockedZones.includes('whisperwood') && p.currentZone !== 'whisperwood') {
      travel(p, 'whisperwood');
      shopHere();
    }
  }

  /** Explore-farm until the level rises; returns fights spent. */
  const grindOneLevel = (): number => {
    const start = p.level;
    // Farm where the level band has live hostiles (#73): the Outskirts for
    // levels 1–2, the Whisperwood from 3.
    const farmZone = p.level < 3 ? 'outskirts' : 'whisperwood';
    let n = 0;
    while (p.level === start && n < 300) {
      n++;
      grind++;
      goto(farmZone);
      const out = explore(p, rng, 0);
      if (out.kind === 'battle' && fight(out.battle) !== 'win') restock();
    }
    return n;
  };

  const questCount = (qid: string, idx: number): number => p.quests[qid]?.counts[idx] ?? 0;

  /** First unlocked zone whose hostile table spawns the enemy (#73) — the
   * Outskirts come before the Whisperwood for shared early spawns. */
  const zoneOfEnemy = (enemyId: string): string | undefined => {
    for (const z of ZONES) {
      if (!p.unlockedZones.includes(z.id)) continue;
      if (
        z.explore.some((e) => (e.kind === 'battle' || e.kind === 'elite') && e.enemy === enemyId)
      ) {
        return z.id;
      }
    }
    return undefined;
  };

  const farmKills = (qid: string, objIdx: number, enemyId: string, need: number): boolean => {
    const zid = zoneOfEnemy(enemyId);
    if (!zid) return false;
    let local = 0;
    while (questCount(qid, objIdx) < need) {
      if (++local > 400) return false;
      goto(zid);
      const out = explore(p, rng, 0);
      if (out.kind === 'battle') {
        if (fight(out.battle) !== 'win') restock();
      }
    }
    return true;
  };

  const farmCollect = (target: string, need: number): boolean => {
    let local = 0;
    while (countOf(p, target) < need) {
      // Shop fallback (#73): some collect targets are primarily SOLD
      // (m_iron_chunk) rather than wild-dropped — buy when stocked and
      // affordable instead of grinding a pool that can never drop it.
      const price = itemDef(target)?.price ?? 0;
      if (currentStock(p).includes(target) && p.gold >= price + 20 && buy(p, target).ok) continue;
      if (++local > 400) return false;
      goto('outskirts');
      const out = explore(p, rng, 0);
      if (out.kind === 'battle' && fight(out.battle) !== 'win') restock();
    }
    return true;
  };

  /** Dive with real fights until the dungeon boss falls. */
  const clearBoss = (zoneId: string): boolean => {
    let attempts = 0;
    let bossDeaths = 0;
    while (attempts++ < 80) {
      const d = dungeonOf(zoneDef(zoneId)!);
      if (!d) return false;
      goto(zoneId);
      const res = diveDungeonLocal(p, d, rng);
      if (!res.ok || !res.battle) {
        restock();
        continue;
      }
      const isBoss = res.battle.origin.kind === 'dungeon' && res.battle.origin.boss;
      if (isBoss && report.aranyaLevel === 0 && zoneId === 'whisperwood') {
        report.aranyaLevel = p.level;
        report.aranyaGearTier = weaponTier(p);
        report.aranyaDeathsBefore = deaths;
      }
      const out = fight(res.battle);
      if (out === 'win') {
        if (isBoss) {
          report.aranyaDeathsBefore = deaths - report.aranyaDeathsBefore;
          return true;
        }
        continue;
      }
      restock();
      if (isBoss) {
        bossDeaths++;
        // A repeated boss wall demands real growth — grind a level.
        if (bossDeaths % 2 === 0) grindOneLevel();
      }
    }
    return false;
  };

  const turnInReady = (): void => {
    syncAvailability(p);
    for (const qid of CH1) {
      if (p.quests[qid]?.status !== 'turnIn') continue;
      const q = quest(qid);
      if (!q) continue;
      const zid = zoneOfNpc(q.finishNpc)?.id;
      if (!zid) continue;
      goto(zid);
      onTalk(p, q.finishNpc);
      if (p.quests[qid]?.status === 'turnIn' && turnInQuest(p, qid, q.finishNpc).ok) {
        beats.push({
          questId: qid,
          level: p.level,
          gold: p.gold,
          deaths,
          fights,
          grindFights: grind,
          itemsUsed,
        });
      }
    }
  };

  const acceptAvailable = (): void => {
    syncAvailability(p);
    for (const qid of CH1) {
      if (p.quests[qid]?.status !== 'available') continue;
      const q = quest(qid);
      if (!q) continue;
      const zid = zoneOfNpc(q.startNpc)?.id;
      if (!zid) continue;
      goto(zid);
      onTalk(p, q.startNpc);
      if (p.quests[qid]?.status === 'available') acceptQuest(p, qid, q.startNpc);
    }
  };

  let guard = 0;
  const statusOf = (qid: string): string | undefined => p.quests[qid]?.status;
  while (statusOf('m4_blessing') !== 'done' && ++guard < 300) {
    turnInReady();
    if (statusOf('m4_blessing') === 'done') break;
    acceptAvailable();
    const active = CH1.find((id) => p.quests[id]?.status === 'active');
    if (!active) {
      grindOneLevel();
      continue;
    }
    const q = quest(active)!;
    let progressed = false;
    for (let i = 0; i < q.objectives.length; i++) {
      const obj = q.objectives[i]!;
      const need = obj.count ?? 1;
      const have = obj.kind === 'collect' ? countOf(p, obj.target) : questCount(active, i);
      if (have >= need) continue;
      if (obj.kind === 'kill') {
        progressed = active === 'm3_roots'
          ? clearBoss('whisperwood')
          : farmKills(active, i, obj.target, need);
      } else if (obj.kind === 'collect') {
        progressed = farmCollect(obj.target, need);
      } else if (obj.kind === 'talk') {
        const zid = zoneOfNpc(obj.target)?.id;
        if (zid) {
          goto(zid);
          onTalk(p, obj.target);
        }
        progressed = questCount(active, i) >= need;
      } else if (obj.kind === 'reach') {
        travel(p, obj.target);
        progressed = true;
      }
      if (!progressed) break;
    }
    if (!progressed) grindOneLevel();
  }
  if (p.quests['m4_blessing']?.status !== 'done') report.stuck = 'guard limit reached';
  report.chapter1Done = p.quests['m4_blessing']?.status === 'done';
  report.endLevel = p.level;
  report.endGold = p.gold;
  report.totalDeaths = deaths;
  report.totalFights = fights;
  report.totalGrindFights = grind;
  report.totalItemsUsed = itemsUsed;
  return report;
}

// Local shims so the progression sim never imports handler code. These
// re-export the pure engine entry points under stable local names.
function diveDungeonLocal(
  p: PlayerState,
  d: NonNullable<ZoneDef['dungeon']>,
  rng: Rng,
): { ok: boolean; battle?: BattleState; lines: string[] } {
  return diveDungeon(p, d, rng);
}

function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Enemies explicitly flagged as tutorial fixtures (#69). */
export function tutorialEnemies(): EnemyDef[] {
  return ENEMIES.filter((e) => e.tutorial === true);
}
