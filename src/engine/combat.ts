/** Turn-based combat engine. Pure: mutates PlayerState + BattleState, returns
 * log lines. Zero grammY imports. Live effect instances (#78) are the
 * authoritative combat state — skills, enemy moves, equipment and encounter
 * openings share one typed effect vocabulary, executed by the generic
 * resolver in this file. No content-id branches. */

import type {
  BattleOrigin,
  BattleState,
  EffectInstance,
  EffectSource,
  PlayerState,
  TutorialBeat,
} from './types.ts';
import type { EffectSpec, EnemyDef, EnemyMove, SkillDef, StatKey } from '../content/types.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { skill } from '../content/skills.ts';
import { item as itemDefLookup } from '../content/items.ts';
import { statsOf } from './character.ts';
import { CLASSES } from './classes.ts';
import {
  absorbShield,
  applyInstance,
  applyShieldExpiry,
  consumeStun,
  effectDefId,
  gatherRoundEndTicks,
  gatherTurnStartTicks,
  grantShield,
  incomingAmpPct,
  mitigationPct,
  type PeriodicTick,
  removeTagged,
  sapPct,
  seedForSpec,
  semanticTags,
  settleEndOfRound,
  settleTurnStart,
  statPct,
} from './effects.ts';
import { chance, defaultRng, randInt, type Rng, variance } from './rng.ts';
import { type CombatTraceEntry, type DamageCause, recordCombatEvent } from './telemetry.ts';

/** Applies a stat-modifier percentage to a base stat. The result floors
 * at 1 (#85): stacked breaks can shrink a stat to almost nothing but never
 * invert it, so every downstream formula stays sign-safe. */
function effStat(base: number, pct: number): number {
  return Math.max(1, Math.round(base * (1 + pct)));
}

/** Effective player offense of one damage kind: base stat sapped by live
 * `outgoing` instances, then buffed by the stat's own instances (#78). */
function playerOffense(p: PlayerState, battle: BattleState, kind: 'phys' | 'mag'): number {
  const s = statsOf(p);
  const base = kind === 'phys' ? s.atk : s.mag;
  return effStat(
    base * (1 - sapPct(battle, 'player')),
    statPct(battle, 'player', kind === 'phys' ? 'atk' : 'mag'),
  );
}

/** Effective player mitigation stat (DEF/RES) with its instances folded. */
function playerMitigation(p: PlayerState, battle: BattleState, kind: 'phys' | 'mag'): number {
  const s = statsOf(p);
  return effStat(
    kind === 'phys' ? s.def : s.res,
    statPct(battle, 'player', kind === 'phys' ? 'def' : 'res'),
  );
}

/** Mitigation-stance multiplier (#85): live mitigation instances scale the
 * side's mitigation, floored at 5% so stacked armor/ward breaks can slow
 * damage growth but never invert the damage formula. */
function stanceMul(battle: BattleState, side: 'player' | 'enemy'): number {
  return Math.max(0.05, 1 + mitigationPct(battle, side));
}

/** Effective player SPD (#85): live SPD instances folded — the single
 * authority for dodge, flee and (from #86) initiative inputs. */
export function effectivePlayerSpd(p: PlayerState, battle: BattleState): number {
  return effStat(statsOf(p).spd, statPct(battle, 'player', 'spd'));
}

/** Effective enemy SPD (#85): enemy Slow/self-SPD instances folded, so a
 * slowed foe is easier to dodge and escape — and a hasted one harder. */
export function effectiveEnemySpd(battle: BattleState): number {
  const def = enemyDef(battle.enemy.id);
  return def ? effStat(def.spd, statPct(battle, 'enemy', 'spd')) : 0;
}

/** Effective enemy offense of one damage kind (#85 symmetry with
 * playerOffense): base stat sapped by live `outgoing` instances, then
 * buffed by the stat's own instances. */
function enemyOffense(battle: BattleState, kind: 'phys' | 'mag'): number {
  const def = enemyDef(battle.enemy.id);
  if (!def) return 0;
  const base = (kind === 'phys' ? def.atk : def.mag) * (1 - sapPct(battle, 'enemy'));
  return effStat(base, statPct(battle, 'enemy', kind === 'phys' ? 'atk' : 'mag'));
}

/** Effective enemy mitigation stat (#85 symmetry with playerMitigation):
 * DEF/RES with the enemy's live stat modifiers folded, then mitigation-
 * stance instances. The stat floors at 1 (effStat) and the stance
 * multiplier at 5% — stacked breaks can never invert mitigation. */
function enemyMitigation(battle: BattleState, kind: 'phys' | 'mag'): number {
  const def = enemyDef(battle.enemy.id);
  if (!def) return 0;
  const base = effStat(
    kind === 'phys' ? def.def : def.res,
    statPct(battle, 'enemy', kind === 'phys' ? 'def' : 'res'),
  );
  return base * stanceMul(battle, 'enemy');
}

function dealDamage(
  power: number,
  offense: number,
  defense: number,
  rng: Rng,
  critLuck = 0,
): { dmg: number; crit: boolean } {
  const critChance = Math.min(0.35, 0.04 + critLuck * 0.0035);
  const crit = chance(rng, critChance);
  const raw = Math.max(1, (offense * power - defense * 0.85) * (crit ? 1.6 : 1));
  return { dmg: variance(rng, raw), crit };
}

/** Authoritative context for battle construction (#80): the opening phase
 * resolves INSIDE `startBattle`, so the caller supplies the fighting hero
 * and the seeded RNG. Openings persist in the returned battle state (shield
 * pool, effect instances, opening log) and are never rerolled on
 * save/load/rerender — this pipeline is the only place they run. */
export interface StartBattleOpts {
  /** The fighting hero (#91: MANDATORY) — enemy-global openings, equipped
   * battle-start triggers and learned pre-emptive skills all need a
   * stat/target owner, so a playable battle cannot be constructed without
   * one. A hero-less battle container must go through previewBattle. */
  player: PlayerState;
  /** Seeded RNG for opening chance rolls — one draw per authored chance,
   * outcome-only persistence afterwards. Explicit by contract: opening
   * resolution is never left to ambient randomness. */
  rng: Rng;
  /** Guided-prologue provenance (#69/#80): suppresses EVERY opening source
   * and phase-gates the fight at construction. The tutorial must never
   * depend on post-construction marking that runs too late. */
  tutorial?: boolean;
}

export function startBattle(
  enemyId: string,
  origin: BattleOrigin,
  opts: StartBattleOpts,
): StartBattleResult | undefined {
  const def = enemyDef(enemyId);
  if (!def) return undefined;
  // Boss semantics are decided by the ENCOUNTER, not the catalog (#28):
  // the Abyss presents e_warden as a farmable overworld elite, so only a
  // dungeon boss floor confers boss classification (inescapable, Smoke
  // Bomb-proof, counted in bossesSlain). Quest provenance was already
  // origin-based; combat and statistics now agree with it.
  const isBoss = origin.kind === 'dungeon' && origin.boss === true;
  const battle: BattleState = {
    enemy: {
      id: def.id,
      name: def.name,
      hp: def.hp,
      maxHp: def.hp,
      isBoss,
      turn: 0,
    },
    phase: 'active',
    round: 1,
    cooldowns: {},
    guarding: false,
    effectInstances: [],
    effectSeq: 0,
    shield: { player: 0, enemy: 0 },
    // Structured history starts EMPTY (#67): the encounter introduction is
    // the zone/explore notice, not accumulated battle history — the battle
    // screen shows it once inside the opening "Your move" panel.
    history: [],
    phoenixUsed: false,
    origin,
    // Tutorial provenance lands AT construction (#80): the guided prologue
    // controls its battle before any opening could ever resolve.
    ...(opts.tutorial ? { tutorial: true, tutorialStep: 'basic' as TutorialBeat } : {}),
  };
  // Battle-opening phase (#80): resolved exactly ONCE, in explicit stable
  // order — (1) encounter boss ward, (2) enemy-global opening move,
  // (3) equipped items in slot order, (4) learned pre-emptive skills in
  // p.skills order. Openings consume no round (round stays 1), no MP, no
  // item charges, no cooldowns; chance rolls draw the injected RNG exactly
  // once and only the outcomes persist.
  const opening: string[] = [];
  // #101: the construction owns its trace — every opening entry (ward,
  // opening move, procs, pre-emptives, terminal adjudication) appends here
  // in exact synchronous resolution order.
  const trace: CombatTraceEntry[] = [];
  // #96: the opening is an ORDERED RESOLUTION PHASE under the same
  // terminal invariant as a round (#86) — after every HP-changing effect
  // the state is checked, and the first 0-HP transition stops all later
  // sources, chance rolls, riders and procs. The adjudicated outcome is
  // returned explicitly on StartBattleResult; no global clamp fakes a
  // minimum HP (the tutorial's teaching floor is the ONLY floor, and it
  // lives in the damage resolver).
  let outcome: BattleOutcome = 'ongoing';
  if (!opts.tutorial) {
    const opRng = opts.rng;
    const p = opts.player;
    const terminalNow = (): boolean => terminalHp(p, battle);
    const adjudicate = (): BattleOutcome =>
      battle.enemy.hp <= 0 ? 'victory' : p.hp <= 0 ? 'defeat' : 'ongoing';
    // 1. Pre-emptive boss ward (#79): ONLY on boss-provenance encounters —
    // the same enemy id faced outside the boss floor never opens with it.
    // One-time capacity, no regeneration, not dispellable.
    if (isBoss && def.openingShield) {
      const ward = def.openingShield;
      grantShield(battle, 'enemy', {
        defId: `opening:${def.id}`,
        name: ward.name ?? 'Opening Ward',
        kind: 'shield',
        side: 'enemy',
        source: { kind: 'encounter', id: def.id, name: def.name },
        shieldAmount: ward.amount,
        tags: ['beneficial'],
        stacking: 'replace',
        duration: ward.duration,
        timing: 'immediate',
        removable: false,
      }, trace);
      opening.push(
        `🛡️ ${ward.name ?? 'Opening Ward'} — ${def.name} absorbs up to ${ward.amount} damage!`,
      );
    }
    // 2. Enemy-global opening move (#80): fires for this enemy in every
    // provenance, through the shared resolver.
    if (def.opening) {
      opening.push(`🌀 ${def.name} opens with ${def.opening.name}!`);
      opening.push(...runOpening(
        battle,
        p,
        opRng,
        'enemy',
        { kind: 'enemyMove', id: def.id, name: def.opening.name },
        def.opening.name,
        def.opening.effects,
        'opening',
        false,
        undefined,
        trace,
      ));
    }
    // 3. Equipped-item triggers (#82): stable slot order — weapon, armor,
    // trinket — then authored order within the item. battleStart procs
    // resolve exactly ONCE here: one injected-RNG draw per authored
    // chance, with success AND failure recorded in the opening log.
    // Each item is its own source, so different items coexist;
    // same-source reapplication follows the authored stacking policy.
    // #96: a terminal transition stops the loop before the next chance
    // draw — nothing after the first 0-HP resolves.
    for (const slot of ['weapon', 'armor', 'trinket'] as const) {
      if (terminalNow()) break;
      const itemId = p.equipment[slot];
      const it = itemId ? itemDefLookup(itemId) : undefined;
      if (!it?.triggers?.length) continue;
      for (const [ti, tg] of it.triggers.entries()) {
        if (terminalNow()) break;
        if (tg.trigger !== 'battleStart') continue;
        if (tg.chance !== undefined && !chance(opRng, tg.chance)) {
          recordCombatEvent(trace, {
            kind: 'procAttempt',
            round: battle.round,
            item: it.name,
            trigger: tg.name,
            success: false,
          });
          opening.push(
            `💤 ${it.name}: ${tg.name} does not wake this time (${
              Math.round(tg.chance * 100)
            }% roll missed).`,
          );
          continue;
        }
        recordCombatEvent(trace, {
          kind: 'procAttempt',
          round: battle.round,
          item: it.name,
          trigger: tg.name,
          success: true,
        });
        opening.push(...runOpening(
          battle,
          p,
          opRng,
          'player',
          { kind: 'item', id: it.id, name: it.name },
          tg.name,
          tg.effects,
          // #89: a battleStart trigger IS a reactive proc — its damage
          // is proc-produced and never re-triggers equipment.
          'proc',
          true,
          ti,
          trace,
        ));
      }
    }
    // 4. Learned pre-emptive skills (#80): stable `p.skills` order. No MP
    // or cooldown cost — the opening never charges resources.
    for (const id of p.skills) {
      if (terminalNow()) break;
      const sk = skill(id);
      if (!sk?.preEmptive) continue;
      opening.push(...applySkill(p, battle, sk, opRng, 'opening', false, false, trace));
    }
    // #96: explicit opening adjudication — a lethal strike in either
    // direction ends the fight before round 1 exists.
    outcome = adjudicate();
    if (outcome === 'victory' || outcome === 'defeat') {
      recordCombatEvent(trace, { kind: 'terminal', round: battle.round, outcome });
    }
  }
  if (opening.length > 0) battle.opening = { lines: opening };
  return { battle, outcome, trace };
}

/** A deliberately context-free battle CONTAINER (#99): raw enemy
 * construction ONLY — it resolves NO opening at all (not even the boss
 * ward) and is STRUCTURALLY UNPLAYABLE: its `phase: 'preview'` is not a
 * BattlePhase, so a preview is not assignable to the `BattleState` that
 * performAction, the renderer, persistence (PlayerState.battle) and
 * victory resolution all accept. For content inspection and bare
 * effect-state fixtures (effects.ts operates on the structural EffectArena
 * slice, which a preview satisfies). Playable fights MUST go through
 * startBattle, which requires the fighting hero and an explicit RNG — the
 * compiler now enforces it. */
export type BattlePreview = Omit<BattleState, 'phase'> & { phase: 'preview' };

export function previewBattle(
  enemyId: string,
  origin: BattleOrigin,
): BattlePreview | undefined {
  const def = enemyDef(enemyId);
  if (!def) return undefined;
  const isBoss = origin.kind === 'dungeon' && origin.boss === true;
  return {
    enemy: {
      id: def.id,
      name: def.name,
      hp: def.hp,
      maxHp: def.hp,
      isBoss,
      turn: 0,
    },
    // #99: 'preview' is not a BattlePhase — the container cannot be played,
    // rendered, persisted or resolved as a live battle.
    phase: 'preview',
    round: 1,
    cooldowns: {},
    guarding: false,
    effectInstances: [],
    effectSeq: 0,
    shield: { player: 0, enemy: 0 },
    history: [],
    phoenixUsed: false,
    origin,
  };
}

/** Runs one opening spec list through the shared resolver (#80). Openings
 * are ordinary one-shot applications at round 1 — same vocabulary, same
 * stacking policies, same default lines — just resolved before the first
 * player action exists. Provenance is explicit (#89): the enemy's opening
 * move is cause `opening`; battleStart item triggers are reactive procs. */
function runOpening(
  battle: BattleState,
  p: PlayerState,
  rng: Rng,
  actor: 'player' | 'enemy',
  source: EffectSource,
  displayName: string,
  specs: readonly EffectSpec[],
  cause: DamageCause,
  procProduced: boolean,
  triggerIndex?: number,
  trace?: CombatTraceEntry[],
): string[] {
  const ctx: ExecCtx = {
    p,
    battle,
    rng,
    actor,
    source,
    displayName,
    lastDamage: 0,
    targetFelled: false,
    hpDamaged: false,
    cause,
    procProduced,
    triggerIndex,
    afterSnapshot: false, // the opening resolves BEFORE round 1's snapshot (#94)
    trace,
  };
  return executeSpecs(ctx, specs);
}

/** #103: the terminal invariant, centralized — either combatant at 0 HP
 * ends resolution synchronously. The winner is already decided, so no
 * later trigger may be inspected: skipped triggers consume no RNG draw
 * and write no trace, text, effects or proc bookkeeping. */
function terminalHp(p: PlayerState, battle: BattleState): boolean {
  return p.hp <= 0 || battle.enemy.hp <= 0;
}

/** Scans equipped items for reactive triggers (#82, #89). Slot order, then
 * authored order. Damage scans carry the HP-loss cause and match
 * declaratively: `onEnemyActionHpDamage` answers ONLY direct enemy-action
 * damage; `onHpDamage` answers EVERY HP loss (enemy actions, periodic
 * ticks, opening strikes, future reflect/environment causes); proc-
 * produced damage never reaches a scan at all, so equipment recursion is
 * structurally bounded. `onGuard` answers only the guard scan. Gates:
 * maxProcs (successful procs per battle), cooldown N (N complete
 * intervening rounds unavailable — a success on round R re-arms on
 * R + N + 1), chance (one injected draw per attempt — a miss consumes
 * neither budget nor cooldown, and gated attempts draw nothing at all).
 * Lines carry a ⚡ prefix for source attribution in the log and metrics.
 * #103: the scan is a breakable resolver loop under the terminal
 * invariant — the first trigger that leaves either side at 0 HP (after
 * any permitted immediate-revival window) stops the scan BEFORE the next
 * trigger's eligibility/chance evaluation. */
function runReactiveTriggers(
  p: PlayerState,
  battle: BattleState,
  rng: Rng,
  scan: 'onGuard' | { cause: DamageCause },
  afterSnapshot = true,
  trace?: CombatTraceEntry[],
): string[] {
  const lines: string[] = [];
  const procs = battle.procs ??= {};
  for (const slot of ['weapon', 'armor', 'trinket'] as const) {
    if (terminalHp(p, battle)) break;
    const itemId = p.equipment[slot];
    const it = itemId ? itemDefLookup(itemId) : undefined;
    if (!it?.triggers?.length) continue;
    for (const [ti, tg] of it.triggers.entries()) {
      // #103: checked BEFORE eligibility/chance — a terminal state means
      // this trigger is never inspected at all (no roll, no attempt entry).
      if (terminalHp(p, battle)) break;
      if (scan === 'onGuard') {
        if (tg.trigger !== 'onGuard') continue;
      } else {
        if (tg.trigger !== 'onHpDamage' && tg.trigger !== 'onEnemyActionHpDamage') continue;
        if (tg.trigger === 'onEnemyActionHpDamage' && scan.cause !== 'enemyAction') continue;
      }
      const key = `${it.id}:${ti}`;
      const st = procs[key] ?? { count: 0, round: 0 };
      if (tg.maxProcs !== undefined && st.count >= tg.maxProcs) continue;
      // Cooldown N (#89): N complete intervening rounds are unavailable —
      // a success on round R blocks R+1 … R+N and re-arms on R+N+1.
      // st.round > 0 guards that a fresh battle never inherits a phantom
      // cooldown.
      if (tg.cooldown !== undefined && st.round > 0 && battle.round - st.round <= tg.cooldown) {
        continue;
      }
      if (tg.chance !== undefined && !chance(rng, tg.chance)) {
        recordCombatEvent(trace, {
          kind: 'procAttempt',
          round: battle.round,
          item: it.name,
          trigger: tg.name,
          success: false,
        });
        continue;
      }
      const ctx: ExecCtx = {
        p,
        battle,
        rng,
        actor: 'player',
        source: { kind: 'item', id: it.id, name: it.name },
        displayName: tg.name,
        lastDamage: 0,
        targetFelled: false,
        hpDamaged: false,
        cause: 'proc',
        procProduced: true,
        triggerIndex: ti,
        afterSnapshot,
        trace,
      };
      recordCombatEvent(trace, {
        kind: 'procAttempt',
        round: battle.round,
        item: it.name,
        trigger: tg.name,
        success: true,
      });
      lines.push(...executeSpecs(ctx, tg.effects).map((l) => `⚡ ${l}`));
      st.count++;
      st.round = battle.round;
      procs[key] = st;
      // #103: a nested lethal effect ends the scan immediately — the next
      // trigger is never considered once the winner is decided.
      if (terminalHp(p, battle)) break;
    }
  }
  return lines;
}

export type PlayerAction =
  | { kind: 'attack' }
  | { kind: 'skill'; skillId: string }
  | { kind: 'item'; itemId: string }
  | { kind: 'guard' }
  | { kind: 'flee' };

/** Explicit terminal adjudication (#86): the ENGINE decides the outcome at
 * the first 0-HP transition — handlers and the balance harness consume this
 * instead of re-deriving from HP. Mutual KO is structurally impossible:
 * resolution stops at the first terminal state, so the second actor never
 * writes HP after the first falls. */
export type BattleOutcome = 'ongoing' | 'victory' | 'defeat' | 'fled';

/** The result of playable battle construction (#96): the battle plus the
 * explicit adjudication of its OPENING phase. The opening is an ordered
 * resolution phase governed by the same terminal invariant as a round —
 * the first 0-HP transition (a lethal pre-emptive strike, a lethal enemy
 * opening) ends the battle before any round runs, and `outcome` carries
 * that adjudication so callers can resolve victory/defeat immediately
 * without faking a round-one action. */
export interface StartBattleResult {
  battle: BattleState;
  outcome: BattleOutcome;
  /** #101: every entry recorded during THIS construction — the opening
   * phase, its procs and its terminal adjudication, in resolution order.
   * Caller-owned plain data; ignoring it changes nothing. */
  trace: CombatTraceEntry[];
}

export interface ActionResult {
  battle: BattleState;
  lines: string[];
  /** True when the player was stunned and lost the turn. */
  skipped: boolean;
  /** False when the action was invalid (cooldown/MP/unusable item): no
   * enemy phase ran and the lines are NOT in the battle log — handlers
   * must surface them via notices (#32). */
  consumedTurn: boolean;
  /** Terminal result of the round (#86). */
  outcome: BattleOutcome;
  /** #101: every entry recorded during THIS resolution — player slot,
   * enemy slot, procs, ticks and the terminal adjudication — in exact
   * synchronous execution order. Caller-owned plain data; ignoring it
   * changes no state, line, outcome or RNG draw. */
  trace: CombatTraceEntry[];
}

function enemyChooseMove(def: EnemyDef, battle: BattleState, rng: Rng): EnemyMove {
  // e.turn is ALREADY the count of enemy actions taken (performAction
  // increments before the phase) — `every: N` fires on the Nth action:
  // 3, 6, 9… with no extra offset (#26; it used to fire on 2, 5, 8…).
  // Stunned turns advance the counter — time passes — but choose no move,
  // so a stun never fires a special.
  const due = def.special && battle.enemy.turn % def.special.every === 0
    ? def.special.move
    : undefined;
  // #83 AI legality: obviously wasted moves (healing at full HP,
  // re-warding over a live ward, refreshing a live same-source buff) are
  // skipped; the special cadence is preserved — a wasted special falls
  // through to the legal ordinary moves and retries next window.
  if (due && !wastedMove(due, battle)) return due;
  const pool = def.moves.filter((m) => !wastedMove(m, battle));
  const list = pool.length > 0 ? pool : def.moves;
  const idx = pickWeighted(list.map((m) => m.weight), rng);
  return list[idx] ?? list[0]!;
}

/** A move is WASTED when every effect it would apply is already satisfied —
 * ordinary damage, control and debuffs are never wasted (#83). */
function wastedMove(m: EnemyMove, battle: BattleState): boolean {
  return m.effects.length > 0 && m.effects.every((sp) => wastedEffect(sp, battle, m));
}

function wastedEffect(sp: EffectSpec, battle: BattleState, move: EnemyMove): boolean {
  // #90 identity: instances carry DERIVED defIds ('Move:eN', or the shared
  // 'sap' slot) — match by the same derivation, never the raw move name
  // (a raw name never equals a derived id, which left the old checks dead).
  const defId = effectDefId(move.name, undefined, move.effects.indexOf(sp), sp);
  switch (sp.kind) {
    case 'restore':
      // Healing at full HP restores 0 — wasted.
      return battle.enemy.hp >= battle.enemy.maxHp;
    case 'shield': {
      // Refill policy (#92): a recast only makes sense when it grants fresh
      // capacity — mirror grantShield's authored refill rule (#79).
      // Refresh-style wards renew the clock WITHOUT refilling, and an
      // equal-or-weaker strongest-wins recast grants nothing — both stay
      // wasted while live. Replace-style wards are wasted only while the
      // pool still holds at least half of the ward's grant: a broken or
      // meaningfully depleted ward is eligible to refill. (Pool-vs-grant is
      // exact for single-ward enemies — the authored norm; overlapping
      // wards attribute the shared pool conservatively to this grant.)
      const grant = sp.amount ?? 0;
      const existing = battle.effectInstances.find((i) =>
        i.side === 'enemy' && i.kind === 'shield' && i.defId === defId &&
        (i.shieldAmount ?? 0) >= grant &&
        (i.battleLifetime || i.remaining > 0)
      );
      if (existing === undefined) return false;
      const refills = sp.stacking !== 'refresh' &&
        !(sp.stacking === 'strongest' && grant <= (existing.shieldAmount ?? 0));
      if (!refills) return true;
      return battle.shield.enemy * 2 >= grant;
    }
    case 'statmod':
      if (sp.target === 'opponent') return false;
      // Refreshing a live same-source self-buff with an equal-or-shorter
      // duration is wasted.
      return battle.effectInstances.some((i) =>
        i.side === 'enemy' && i.kind === 'statmod' && i.defId === defId &&
        i.remaining >= sp.duration
      );
    default:
      return false;
  }
}

function pickWeighted(weights: number[], rng: Rng): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

function maxHpOf(battle: BattleState, p: PlayerState) {
  return (side: 'player' | 'enemy'): number =>
    side === 'player' ? statsOf(p).maxHp : battle.enemy.maxHp;
}

/** #69/#86: the guided fight cannot end before every lesson beat has been
 * performed — the fixture's HP floors at 1 instead of reaching a terminal
 * transition. Never a post-zero revival: 0 HP is never observed. */
function tutorialEnemyFloor(b: BattleState): number {
  return b.tutorial && b.tutorialStep !== 'cleared' ? 1 : 0;
}

/** The ONE synchronous player-targeted HP-loss transition (#104): every
 * damage family — direct, opening, periodic, bypass-shield, self/recoil,
 * proc-produced — runs this explicit order after its own shield/HP formula:
 *   2. the hpDamaged trace (shield-only absorbs emit nothing — #89);
 *   3. at 0 HP, the single immediate lethal-hit/revival interception;
 *   4. still 0 ⇒ terminal — nothing later resolves: no reactions, no
 *      riders, no bookkeeping (the caller's terminal checks adjudicate);
 *   5. otherwise the revived survivor's applicable reactive triggers
 *      dispatch synchronously for THIS event — never in tutorial fights,
 *      never for proc-produced damage (the recursion bound, #89);
 *   6. terminal/non-terminal status returns to the caller.
 * Step 1 (mitigation/ward rules) stays in each family's own resolver, but
 * everything AFTER the HP delta is shared here, so a lethal hit and a
 * lethal tick behave identically — same revival order, same reaction
 * window, same trace shape (#105). */
function resolvePlayerHpLoss(
  p: PlayerState,
  battle: BattleState,
  rng: Rng | undefined,
  loss: {
    /** HP that actually left the player (post-shield, post-floor). */
    hpDmg: number;
    attacker: 'player' | 'enemy' | null;
    cause: DamageCause;
    procProduced: boolean;
    trace?: CombatTraceEntry[];
  },
  lines: string[],
): 'ongoing' | 'terminal' {
  if (loss.hpDmg > 0) {
    recordCombatEvent(loss.trace, {
      kind: 'hpDamaged',
      round: battle.round,
      cause: loss.cause,
      attacker: loss.attacker,
      target: 'player',
      amount: loss.hpDmg,
      procProduced: loss.procProduced,
    });
  }
  if (p.hp <= 0) lines.push(...onLethalHit(p, battle, loss.trace));
  if (p.hp <= 0) return 'terminal';
  if (loss.hpDmg > 0 && !battle.tutorial && !loss.procProduced && rng) {
    lines.push(
      ...runReactiveTriggers(p, battle, rng, { cause: loss.cause }, true, loss.trace),
    );
  }
  return 'ongoing';
}

/** Validates the queued command WITHOUT charging resources (#86): an
 * invalid command consumes no round, ticks nothing, and never reaches the
 * enemy's slot. Execution re-checks at the player's slot (defense in
 * depth) — nothing between validation and execution can invalidate these
 * checks (the enemy drains no MP, adds no cooldowns, removes no items). */
function validatePlayerAction(
  p: PlayerState,
  battle: BattleState,
  action: PlayerAction,
): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  switch (action.kind) {
    case 'attack':
    case 'guard':
    case 'flee':
      return { ok: true, lines };
    case 'skill': {
      const sk = skill(action.skillId);
      if (!sk) {
        lines.push('…nothing happens.');
        return { ok: false, lines };
      }
      if (sk.classId !== p.classId || !p.skills.includes(sk.id)) {
        lines.push("You haven't learned that skill.");
        return { ok: false, lines };
      }
      if (sk.preEmptive) {
        lines.push('⚡ That skill fires on its own as the battle opens.');
        return { ok: false, lines };
      }
      if ((battle.cooldowns[sk.id] ?? 0) > 0) {
        lines.push('⏳ That skill is still on cooldown.');
        return { ok: false, lines };
      }
      if (p.mp < sk.mpCost) {
        lines.push('💧 Not enough MP.');
        return { ok: false, lines };
      }
      return { ok: true, lines };
    }
    case 'item': {
      const it = itemDefLookup(action.itemId);
      const entry = p.inventory.find((e) => e.id === action.itemId);
      if (!it?.effect || !entry || entry.qty <= 0) {
        lines.push('You rummage through your bag and find nothing useful.');
        return { ok: false, lines };
      }
      const eff = it.effect;
      // Auto-trigger-only items (Phoenix Cinder) can never be spent by hand.
      if (eff.revivePct && !eff.healHp && !eff.healMp && !eff.cureStatus && !eff.flee) {
        lines.push('🔥 The Cinder smolders — it will spark on its own when you fall.');
        return { ok: false, lines };
      }
      // Smoke Bomb is never wasted on a boss.
      if (eff.flee && battle.enemy.isBoss) {
        lines.push('🚫 No smoke clouds this fight — there is no escape.');
        return { ok: false, lines };
      }
      return { ok: true, lines };
    }
  }
}

/** The trace this resolution records into (#101): owned by performAction,
 * returned on its result — no ambient installation anywhere. */
export function performAction(
  p: PlayerState,
  battle: BattleState,
  action: PlayerAction,
  rng: Rng = defaultRng,
): ActionResult {
  const trace: CombatTraceEntry[] = [];
  const def = enemyDef(battle.enemy.id);
  if (!def || battle.phase !== 'active') {
    return { battle, lines: [], skipped: false, consumedTurn: false, outcome: 'ongoing', trace };
  }
  // #96 defensive entry check: a pre-existing terminal state (an opening
  // that already ended the fight, or a battle resumed past 0 HP) resolves
  // immediately — no round runs, no enemy phase, no bookkeeping.
  if (battle.enemy.hp <= 0 || p.hp <= 0) {
    const outcome: BattleOutcome = battle.enemy.hp <= 0 ? 'victory' : 'defeat';
    recordCombatEvent(trace, { kind: 'terminal', round: battle.round, outcome });
    return { battle, lines: [], skipped: false, consumedTurn: false, outcome, trace };
  }

  const actedRound = battle.round;

  // #86 step 1 — validate WITHOUT charging: an invalid command consumes no
  // round, ticks nothing, and hands the enemy nothing. Its lines stay
  // handler feedback only (never in the battle log — #67/#32).
  const check = validatePlayerAction(p, battle, action);
  if (!check.ok) {
    return {
      battle,
      lines: check.lines,
      skipped: false,
      consumedTurn: false,
      outcome: 'ongoing',
      trace,
    };
  }

  const lines: string[] = [];
  let skipped = false;
  const terminalNow = (): boolean => terminalHp(p, battle);

  // #86 step 2 — initiative snapshot: effective SPD after opening and
  // start-of-round modifiers. Ties keep the documented player-first rule;
  // SPD changes DURING the round wait for the next round's snapshot.
  const playerFirst = effectivePlayerSpd(p, battle) >= effectiveEnemySpd(battle);

  /** The player's slot (#86 steps 3–4): turn-start periodics, stun check,
   * then the action — with a terminal stop after every HP-changing unit. */
  const runPlayerSlot = (): 'continue' | 'terminal' | 'fled' => {
    // Turn-start periodic effects (#78) tick at the player's slot, one at
    // a time — poison does not care whether you can act, but a lethal tick
    // ends the round BEFORE the action and before any later tick (#86).
    const started = gatherTurnStartTicks(battle, maxHpOf(battle, p));
    for (const t of started) {
      lines.push(...applyPeriodicTick(p, battle, t, rng, trace));
      if (terminalNow()) return 'terminal';
    }
    for (const loss of settleTurnStart(battle, started, trace)) {
      lines.push(`🛡️ ${loss.lost} shield capacity fades.`);
    }
    if (terminalNow()) return 'terminal';
    if (consumeStun(battle, 'player', trace)) {
      lines.push('💫 You are stunned and lose your turn!');
      skipped = true;
      return 'continue';
    }
    const res = applyPlayerAction(p, battle, action, rng, trace);
    lines.push(...res.lines);
    // #69 rework: the guided fight advances its lesson beats only on the
    // intended action kinds, in order — the beats cannot be skipped or
    // reordered, whatever the damage rolls do.
    if (battle.tutorial && res.consumedTurn) {
      const step = battle.tutorialStep;
      if (step === 'basic' && action.kind === 'attack') battle.tutorialStep = 'skill';
      else if (step === 'skill' && action.kind === 'skill') battle.tutorialStep = 'guard';
      else if (step === 'guard' && action.kind === 'guard') battle.tutorialStep = 'item';
      else if (step === 'item' && action.kind === 'item') battle.tutorialStep = 'cleared';
    }
    if (battle.phase === 'fled') return 'fled';
    return terminalNow() ? 'terminal' : 'continue';
  };

  /** The enemy's slot (#86): turn counter, stun check, then the move (or
   * the prologue's scripted teaching hit). The guard brace covers exactly
   * ONE enemy action — wherever SPD places it in the round. */
  const runEnemySlot = (): 'continue' | 'terminal' => {
    battle.enemy.turn++;
    if (consumeStun(battle, 'enemy', trace)) {
      // The stun is consumed the moment the enemy loses its action (#78);
      // was the stunnedEnemy flag. A stunned turn advances the counter —
      // time passes — but chooses no move (#26).
      lines.push(`😵 ${battle.enemy.name} is stunned and cannot act!`);
      return 'continue';
    }
    const s = statsOf(p);
    if (
      battle.tutorial && battle.tutorialStep === 'item' &&
      p.hp > Math.floor(s.maxHp * 0.7)
    ) {
      // #69 rework: the scripted teaching hit — deterministic, nonlethal,
      // lands the hero clearly below the item-lesson threshold, so the
      // lesson is always reachable through real play no matter how the
      // damage rolls go.
      const target = Math.max(1, Math.floor(s.maxHp * 0.45));
      const dmg = Math.max(1, p.hp - target);
      p.hp = Math.max(1, p.hp - dmg);
      lines.push(`💥 ${battle.enemy.name} flares with old hearth-fire — ${dmg} damage to you!`);
      if (battle.guarding) {
        lines.push('🛡️ Your guard blunted it — a real hit still gets through.');
      }
      // #104: even the deterministic teaching hit resolves its HP loss
      // through the shared transition (trace → revival → terminal →
      // reactions); its floor keeps the hero above 0, so the interception
      // never fires — and tutorial fights never scan reactions.
      resolvePlayerHpLoss(p, battle, rng, {
        hpDmg: dmg,
        attacker: 'enemy',
        cause: 'enemyAction',
        procProduced: false,
        trace,
      }, lines);
    } else {
      const move = enemyChooseMove(def, battle, rng);
      lines.push(...enemyAct(p, battle, move, rng, trace));
    }
    battle.guarding = false;
    return terminalNow() ? 'terminal' : 'continue';
  };

  /** One round, recorded exactly once (#67/#86) — terminal rounds included,
   * with the engine's explicit adjudication. */
  const finish = (): ActionResult => {
    battle.history.push({ round: actedRound, lines });
    const outcome: BattleOutcome = battle.phase === 'fled'
      ? 'fled'
      : battle.enemy.hp <= 0
      ? 'victory'
      : p.hp <= 0
      ? 'defeat'
      : 'ongoing';
    if (outcome === 'victory' || outcome === 'defeat') {
      recordCombatEvent(trace, { kind: 'terminal', round: actedRound, outcome });
    }
    return { battle, lines, skipped, consumedTurn: true, outcome, trace };
  };

  // #86 steps 3–5 — resolve up to two slots in initiative order; the first
  // terminal state ends the round immediately: the defeated actor never
  // takes its queued action, no riders/procs follow, and end-of-round work
  // never runs.
  if (playerFirst) {
    if (runPlayerSlot() !== 'continue') return finish();
    if (runEnemySlot() === 'terminal') return finish();
  } else {
    if (runEnemySlot() === 'terminal') return finish();
    if (runPlayerSlot() !== 'continue') return finish();
  }

  // #86 step 6 — end-of-round bookkeeping only when BOTH actors survived
  // BOTH slots. Ticks land one at a time; the first terminal state stops
  // the remaining queue and all later bookkeeping (expiry, cooldown decay).
  battle.round++;
  const eor = gatherRoundEndTicks(battle, maxHpOf(battle, p));
  let ended = false;
  for (const t of eor) {
    lines.push(...applyPeriodicTick(p, battle, t, rng, trace));
    if (terminalNow()) {
      ended = true;
      break;
    }
  }
  if (!ended) {
    const expired = settleEndOfRound(battle, trace);
    for (const loss of applyShieldExpiry(battle, expired)) {
      lines.push(`🛡️ ${loss.lost} shield capacity fades.`);
    }
    for (const [k, v] of Object.entries(battle.cooldowns)) {
      if (v <= 1) delete battle.cooldowns[k];
      else battle.cooldowns[k] = v - 1;
    }
  }
  return finish();
}

/** Applies one periodic tick (#78): heal or damage the target side, with
 * lethal handling for the player. Enemy-death from ticks leaves hp <= 0
 * for the normal victory resolution. #97: a player-side HP loss dispatches
 * reactive equipment for THIS event (broad onHpDamage triggers only —
 * there is no attacker for the narrow enemy-action ones to blame). */
function applyPeriodicTick(
  p: PlayerState,
  battle: BattleState,
  t: PeriodicTick,
  rng?: Rng,
  trace?: CombatTraceEntry[],
): string[] {
  const lines: string[] = [];
  if (t.amount >= 0) {
    if (t.side === 'player') {
      const max = statsOf(p).maxHp;
      const heal = Math.min(t.amount, max - p.hp);
      p.hp = Math.min(max, p.hp + t.amount);
      recordCombatEvent(trace, {
        kind: 'periodicTick',
        round: battle.round,
        side: t.side,
        name: t.name,
        amount: t.amount,
        applied: heal,
      });
      if (heal > 0) lines.push(`💚 You recover ${heal} HP (${t.name}).`);
    } else {
      const heal = Math.min(t.amount, battle.enemy.maxHp - battle.enemy.hp);
      battle.enemy.hp = Math.min(battle.enemy.maxHp, battle.enemy.hp + t.amount);
      recordCombatEvent(trace, {
        kind: 'periodicTick',
        round: battle.round,
        side: t.side,
        name: t.name,
        amount: t.amount,
        applied: heal,
      });
      if (heal > 0) lines.push(`💚 ${battle.enemy.name} recovers ${heal} HP (${t.name}).`);
    }
    return lines;
  }
  const dmg = -t.amount;
  // Periodic damage routes through the target's ward like any other
  // damage (#79); the spec opts out with bypassShield. The pool takes the
  // full tick first; only overflow reaches HP.
  let hpDmg = dmg;
  let absorbed = 0;
  let broke = false;
  if (!t.instance.bypassShield) {
    // #105: periodic absorption feeds the same resolution trace as direct
    // damage — a ward broken by a tick emits its shieldBreak in order.
    const a = absorbShield(battle, t.side, dmg, trace);
    absorbed = a.absorbed;
    hpDmg = a.hpDamage;
    broke = a.broke;
  }
  if (t.side === 'player') {
    // #104: the periodic family runs the ONE shared player-targeted HP-loss
    // transition — trace, then the immediate revival interception, then the
    // terminal stop, then a revived survivor's reactions — exactly like a
    // direct hit. #89: periodic HP loss is its own cause — broad onHpDamage
    // triggers answer it; there is no attacker for the narrow one to blame.
    const hpBefore = p.hp;
    p.hp = Math.max(0, p.hp - hpDmg);
    recordCombatEvent(trace, {
      kind: 'periodicTick',
      round: battle.round,
      side: t.side,
      name: t.name,
      amount: t.amount,
      applied: p.hp - hpBefore,
    });
    lines.push(
      `☠️ You take ${hpDmg} damage (${t.name}).${absorbed > 0 ? ` (🛡️ ${absorbed} absorbed)` : ''}`,
    );
    if (broke) lines.push('🛡️ Your shield shatters!');
    resolvePlayerHpLoss(p, battle, rng, {
      hpDmg: hpBefore - p.hp,
      attacker: null,
      cause: 'periodic',
      procProduced: false,
      trace,
    }, lines);
  } else {
    // #69/#86: the tutorial floor applies to periodic damage too — the
    // fixture can never be felled before its lessons clear.
    const floor = tutorialEnemyFloor(battle);
    const wouldFell = battle.enemy.hp - hpDmg <= 0;
    const hpBefore = battle.enemy.hp;
    battle.enemy.hp = Math.max(floor, battle.enemy.hp - hpDmg);
    recordCombatEvent(trace, {
      kind: 'periodicTick',
      round: battle.round,
      side: t.side,
      name: t.name,
      amount: t.amount,
      applied: battle.enemy.hp - hpBefore,
    });
    if (battle.enemy.hp < hpBefore) {
      recordCombatEvent(trace, {
        kind: 'hpDamaged',
        round: battle.round,
        cause: 'periodic',
        attacker: null,
        target: 'enemy',
        amount: hpBefore - battle.enemy.hp,
        procProduced: false,
      });
    }
    lines.push(
      `☠️ ${battle.enemy.name} takes ${hpDmg} damage (${t.name}).${
        absorbed > 0 ? ` (🛡️ ${absorbed} absorbed)` : ''
      }`,
    );
    if (broke) lines.push(`🛡️ ${battle.enemy.name}'s shield shatters!`);
    if (wouldFell && floor === 1) {
      lines.push(
        `🕯️ ${battle.enemy.name} staggers but holds on — this fight isn't finished teaching.`,
      );
    }
  }
  return lines;
}

// ── The generic effect resolver (#78) ───────────────────────────────────

interface ExecCtx {
  p: PlayerState;
  battle: BattleState;
  rng: Rng;
  /** Who is applying the specs: skills cast as the player; enemy moves as
   * the enemy. Equipment/encounter sources (later issues) reuse this. */
  actor: 'player' | 'enemy';
  source: EffectSource;
  /** Display name for default log lines (skill or move name). */
  displayName: string;
  /** Damage dealt by the most recent damage effect in this list (for
   * lifesteal). */
  lastDamage: number;
  /** True when the last damage effect felled its target — later riders
   * with requireSurvivor skip. */
  targetFelled: boolean;
  /** True when the last damage effect actually reduced its target's HP —
   * fully-shielded hits never trigger `requireHpDamage` riders (#79). */
  hpDamaged: boolean;
  /** #89 damage-event provenance: what this spec list belongs to — powers
   * hpDamaged telemetry without parsing presentation text. */
  cause: DamageCause;
  /** #89: true inside a reactive-proc resolution — HP damage this list
   * produces is proc-produced and never re-triggers equipment. */
  procProduced: boolean;
  /** #90 authored trigger index for equipment-trigger specs — part of the
   * stacking identity, so distinct triggers on one item never collide. */
  triggerIndex?: number;
  /** #94: true when this application happens AFTER the current round's
   * initiative snapshot (any mid-round slot). SPD statmods applied then
   * defer their first decay — they never spent a unit on a snapshot that
   * already happened, so an advertised N-turn SPD effect always covers N
   * eligible initiative snapshots. Opening applications run before round
   * 1's snapshot and keep their authored timing. */
  afterSnapshot: boolean;
  /** #101: the resolution's trace — every emission appends here, in
   * synchronous execution order, before the outer call returns. */
  trace?: CombatTraceEntry[];
}

function other(side: 'player' | 'enemy'): 'player' | 'enemy' {
  return side === 'player' ? 'enemy' : 'player';
}

/** Caster-relative target resolution (#78): damage/control/periodic/dispel
 * default to the opponent; the rest default to the caster. Lifesteal always
 * feeds the caster. */
function targetSideOf(spec: EffectSpec, actor: 'player' | 'enemy'): 'player' | 'enemy' {
  if (spec.kind === 'lifesteal') return actor;
  if (spec.target) return spec.target === 'self' ? actor : other(actor);
  switch (spec.kind) {
    case 'damage':
    case 'control':
    case 'periodic':
    case 'dispel':
      return other(actor);
    default:
      return actor;
  }
}

/** Executes an ordered effect-spec list generically (#78). No content-id
 * branches: every behavior comes from the spec data. */
function executeSpecs(ctx: ExecCtx, specs: readonly EffectSpec[]): string[] {
  const lines: string[] = [];
  // SPD avoidance (#72): an enemy move with real damage behind it draws ONE
  // dodge roll before any spec — a slip skips the strike AND the move's
  // remaining riders (#25-era parity). Guard casts and zero-power status
  // moves never draw. The roll lives here rather than inside the damage
  // executor so the rng stream matches the pre-#78 resolver draw-for-draw.
  if (ctx.actor === 'enemy' && specs.some((sp) => sp.kind === 'damage' && sp.power > 0)) {
    // Both sides read EFFECTIVE SPD (#85): a slowed enemy is slipped more
    // often; a hasted one is harder to slip.
    if (
      chance(
        ctx.rng,
        dodgeChance(effectivePlayerSpd(ctx.p, ctx.battle), effectiveEnemySpd(ctx.battle)),
      )
    ) {
      lines.push(
        `💨 ${ctx.battle.enemy.name} uses ${ctx.displayName} — you slip aside, untouched!`,
      );
      return lines;
    }
  }
  for (let ei = 0; ei < specs.length; ei++) {
    const spec = specs[ei]!;
    // #86: terminal state stops the ordered spec list — no rider, drain or
    // proc resolves after an unrevived actor reached 0 HP. Phoenix already
    // ran synchronously inside the damage path (a successful revival means
    // combat is NOT terminal); the tutorial floor keeps the fixture alive
    // before its lessons clear, so it never blocks tutorial riders.
    if (ctx.battle.enemy.hp <= 0 || ctx.p.hp <= 0) break;
    // Riders never land on a corpse — checked BEFORE the chance draw so a
    // felled target never consumes a roll (long-standing rng parity).
    if (spec.requireSurvivor && ctx.targetFelled) continue;
    // Riders gated on real HP damage (#79): a fully-shielded hit never
    // triggered the on-flesh effect. Checked BEFORE the chance draw.
    if (spec.requireHpDamage && !ctx.hpDamaged) continue;
    const side = targetSideOf(spec, ctx.actor);
    // #83/#87 status resistance: HARMFUL statuses — semantic polarity, not
    // kind alone — applied BY THE PLAYER to a resistant enemy fail outright
    // with visible "resists" feedback — authored resistance, never blanket
    // immunity. One injected draw; deterministic. Benign kinds
    // (damage/heal/shield/cleanse/dispel), beneficial applications and
    // enemy self-effects are never resisted.
    if (
      ctx.actor === 'player' && side === 'enemy' &&
      (spec.kind === 'statmod' || spec.kind === 'control' || spec.kind === 'periodic') &&
      semanticTags(spec).includes('harmful')
    ) {
      const resist = enemyDef(ctx.battle.enemy.id)?.statusResist ?? 0;
      if (resist > 0 && !chance(ctx.rng, 1 - resist)) {
        lines.push(`✨ ${ctx.battle.enemy.name} resists ${ctx.displayName}!`);
        continue;
      }
    }
    if (spec.chance !== undefined && !chance(ctx.rng, spec.chance)) continue;
    switch (spec.kind) {
      case 'damage': {
        lines.push(...applyDamageEffect(ctx, spec));
        break;
      }
      case 'restore': {
        lines.push(...applyRestoreEffect(ctx, spec, side));
        break;
      }
      case 'lifesteal': {
        // Lifesteal always feeds the CASTER (#78) — enemy-side drains heal
        // the enemy (#83: first enemy-side user is the Marsh Leech's Drain).
        if (ctx.lastDamage > 0) {
          const heal = Math.floor(ctx.lastDamage * spec.pct);
          if (heal > 0) {
            if (ctx.actor === 'player') {
              const max = statsOf(ctx.p).maxHp;
              ctx.p.hp = Math.min(max, ctx.p.hp + heal);
              lines.push(`🩸 You drain ${heal} HP.`);
            } else {
              const maxHp = ctx.battle.enemy.maxHp;
              ctx.battle.enemy.hp = Math.min(maxHp, ctx.battle.enemy.hp + heal);
              lines.push(`🩸 ${ctx.battle.enemy.name} drains ${heal} HP from you!`);
            }
          }
        }
        break;
      }
      case 'shield': {
        // Capacity formula (heal parity): MAG-scaled when magPower is set,
        // DEF-scaled when defPower is set (#81 — warrior wards scale off
        // the stat the class actually has), flat otherwise. The caster's
        // own sap scales it like any offense stat (#79).
        const base = ctx.actor === 'player'
          ? playerOffense(ctx.p, ctx.battle, 'mag')
          : enemyOffense(ctx.battle, 'mag');
        const defBase = ctx.actor === 'player' ? playerMitigation(ctx.p, ctx.battle, 'phys') : 0;
        const amount = Math.round(
          base * (spec.magPower ?? 0) * 2 + defBase * (spec.defPower ?? 0) * 2 +
            (spec.amount ?? 0),
        );
        const seed = seedForSpec(
          spec,
          instanceDefId(ctx, spec, ei),
          ctx.displayName,
          side,
          ctx.source,
          amount,
        );
        const grant = grantShield(ctx.battle, side, seed, ctx.trace);
        const line = defaultInstanceLine(ctx, spec, side, amount);
        if (line) lines.push(line);
        if (grant.wasted > 0) lines.push(`🛡️ ${grant.wasted} over capacity — wasted.`);
        if (grant.lost > 0) lines.push(`🛡️ ${grant.lost} shield capacity fades.`);
        break;
      }
      case 'statmod':
      case 'control':
      case 'periodic': {
        const defId = instanceDefId(ctx, spec, ei);
        const seed = seedForSpec(
          spec,
          defId,
          // All saps share one named condition (#77 copy) regardless of
          // which move or skill sapped it.
          defId === 'sap' ? 'Sapped' : ctx.displayName,
          side,
          ctx.source,
        );
        // #94: SPD's advertised rounds are INITIATIVE snapshots. An SPD
        // statmod applied after this round's snapshot already happened
        // spends no unit on it — its first decay defers, so an N-turn
        // effect always covers N eligible snapshots (its dodge/flee value
        // simply follows liveness, documented in AGENTS.md #72). Opening
        // applications precede round 1's snapshot and keep their authored
        // timing, so they still cover round 1..N.
        if (spec.kind === 'statmod' && spec.stat === 'spd' && ctx.afterSnapshot) {
          seed.timing = 'defer';
        }
        applyInstance(ctx.battle, seed, ctx.trace);
        const line = defaultInstanceLine(ctx, spec, side);
        if (line) lines.push(line);
        break;
      }
      case 'cleanse': {
        const removed = removeTagged(
          ctx.battle,
          side,
          spec.tags,
          spec.max,
          'cleansed',
          ctx.trace,
          // #105: the removal names its initiator — the skill, enemy move,
          // or equipment trigger whose spec list is resolving.
          ctx.source,
        );
        if (removed.length > 0 && !spec.quiet) {
          const line = spec.line?.replace('{n}', String(removed.length)) ??
            (side === 'player' ? '✨ Harmful effects are cleansed.' : undefined);
          if (line) lines.push(line);
        }
        // A removed ward contribution's capacity leaves the pool (#79).
        for (const loss of applyShieldExpiry(ctx.battle, removed)) {
          lines.push(`🛡️ ${loss.lost} shield capacity fades.`);
        }
        break;
      }
      case 'dispel': {
        const removed = removeTagged(
          ctx.battle,
          side,
          spec.tags,
          spec.max,
          'dispelled',
          ctx.trace,
          ctx.source, // #105: the dispel names the stripping skill/move/trigger
        );
        if (removed.length > 0 && !spec.quiet) {
          lines.push(
            spec.line?.replace('{n}', String(removed.length)) ??
              (side === 'player'
                ? '✨ Your benefits are stripped away!'
                : `✨ ${ctx.battle.enemy.name}'s benefits are stripped.`),
          );
        }
        // A stripped ward contribution's capacity leaves the pool (#79).
        for (const loss of applyShieldExpiry(ctx.battle, removed)) {
          lines.push(`🛡️ ${loss.lost} shield capacity fades.`);
        }
        break;
      }
      case 'resource': {
        const max = statsOf(ctx.p).maxMp;
        const target = side === 'player' ? ctx.p : null;
        if (target && spec.mpPctOfMax) {
          const before = target.mp;
          target.mp = Math.min(max, target.mp + Math.floor(max * spec.mpPctOfMax));
          if (target.mp > before && !spec.quiet) {
            lines.push(
              spec.line?.replace('{n}', String(target.mp - before)) ??
                `💧 You restore ${target.mp - before} MP.`,
            );
          }
        }
        break;
      }
    }
  }
  return lines;
}

/** Stacking identity (#90): delegated to effectDefId — source id + the
 * equipment trigger index + the effect's position; all saps share the
 * generic `sap` slot (strongest wins). */
function instanceDefId(ctx: ExecCtx, spec: EffectSpec, effectIndex: number): string {
  return effectDefId(ctx.source.id, ctx.triggerIndex, effectIndex, spec);
}

/** Default success lines, reproducing the long-standing copy per effect
 * shape. Content may override via spec.line or suppress via quiet. */
function defaultInstanceLine(
  ctx: ExecCtx,
  spec: EffectSpec,
  side: 'player' | 'enemy',
  amount?: number,
): string | undefined {
  if (spec.quiet) return undefined;
  if (spec.line) {
    const n = amount ?? primaryAmount(spec);
    return spec.line.replace('{n}', String(n));
  }
  const enemyName = ctx.battle.enemy.name;
  switch (spec.kind) {
    case 'statmod': {
      if (spec.stat === 'mitigation') {
        return `🛡️ ${enemyName} braces behind ${ctx.displayName}!`;
      }
      if (spec.stat === 'outgoing' && (spec.pct ?? 0) < 0) {
        return side === 'player'
          ? '🩸 Your strength is sapped!'
          : `🩸 ${enemyName} is weakened by ${Math.round(-(spec.pct ?? 0) * 100)}%!`;
      }
      if (side === 'player' && ctx.actor === 'player') return undefined; // the 🔆 intro carries it
      return undefined;
    }
    case 'control':
      return side === 'player' ? '💫 You are stunned!' : `💫 ${enemyName} is stunned!`;
    case 'periodic':
      return side === 'player'
        ? `⏳ You are afflicted with ${spec.name}.`
        : `⏳ ${enemyName} is afflicted with ${spec.name}.`;
    case 'shield': {
      const cap = amount ?? spec.amount ?? 0;
      return side === 'player'
        ? `🛡️ A ward settles over you — absorbing up to ${cap} damage!`
        : `🛡️ ${enemyName} raises a ward absorbing up to ${cap} damage!`;
    }
    default:
      return undefined;
  }
}

function primaryAmount(spec: EffectSpec): number {
  switch (spec.kind) {
    case 'restore':
      return spec.hpPctOfMax ?? spec.mpPctOfMax ?? 0;
    case 'statmod':
      return Math.abs(Math.round((spec.pct ?? 0) * 100));
    case 'shield':
      return spec.amount ?? 0;
    default:
      return 0;
  }
}

/** One damage effect: attacker rolls, target mitigates, HP resolves — the
 * single authoritative damage path for skills and enemy moves (#78). */
function applyDamageEffect(
  ctx: ExecCtx,
  spec: Extract<EffectSpec, { kind: 'damage' }>,
): string[] {
  const { p, battle, rng } = ctx;
  const def = enemyDef(battle.enemy.id);
  if (!def) return [];
  const lines: string[] = [];
  if (ctx.actor === 'player') {
    // Player strike: crit (luck) + variance; the target's mitigation is the
    // EFFECTIVE enemy DEF/RES (#85) — Sunder/Crushed Guard/Condemned and
    // enemy DEF/RES self-buffs all land — then stance modifiers.
    let dealt = dealDamage(
      spec.power,
      playerOffense(p, battle, spec.attack),
      enemyMitigation(battle, spec.attack),
      rng,
      statsOf(p).luck,
    );
    // Execute window (#81): a wounded target takes the bonus strike.
    const exec = spec.execute;
    if (exec && battle.enemy.hp / battle.enemy.maxHp < exec.belowPct) {
      dealt = { ...dealt, dmg: Math.round(dealt.dmg * (1 + exec.bonusPct)) };
    }
    // Vulnerable et al. (#85): the target side's incoming modifier applies
    // EXACTLY ONCE — after crit/variance/execute, before shield routing.
    // The multiplier floors at 0.05 (deep mitigation can gut a hit but a
    // hit never heals), so stacked negatives cannot invert damage.
    dealt = {
      ...dealt,
      dmg: Math.max(1, Math.round(dealt.dmg * (1 + incomingAmpPct(battle, 'enemy')))),
    };
    // Shield routing (#79): normal damage pools into the target's ward
    // before HP; bypassShield lands on HP directly. lastDamage stays the
    // FULL resolved damage — lifesteal drains what was dealt.
    let hpDmg = dealt.dmg;
    let absorbed = 0;
    let broke = false;
    if (!spec.bypassShield) {
      const a = absorbShield(battle, 'enemy', dealt.dmg, ctx.trace);
      absorbed = a.absorbed;
      hpDmg = a.hpDamage;
      broke = a.broke;
    }
    // #69/#86: the guided fight cannot end before every lesson beat has
    // been performed — a killing blow STAGGERS the fixture at 1 HP instead
    // of reaching a terminal transition (never a post-zero revival).
    const floor = tutorialEnemyFloor(battle);
    const wouldFell = battle.enemy.hp - hpDmg <= 0;
    battle.enemy.hp = Math.max(floor, battle.enemy.hp - hpDmg);
    ctx.lastDamage = dealt.dmg;
    ctx.hpDamaged = hpDmg > 0;
    ctx.targetFelled = battle.enemy.hp <= 0;
    // #89: structured HP-damage provenance — shield-only absorbs emit
    // nothing.
    if (hpDmg > 0) {
      recordCombatEvent(ctx.trace, {
        kind: 'hpDamaged',
        round: battle.round,
        cause: ctx.cause,
        attacker: 'player',
        target: 'enemy',
        amount: hpDmg,
        procProduced: ctx.procProduced,
      });
    }
    const verb = spec.attack === 'phys' ? 'hits' : 'sears';
    const critSuffix = dealt.crit ? (spec.critText ?? ' — critical!') : '';
    const body = spec.line
      ? spec.line
        .replace('{n}', String(hpDmg))
        .replace('{verb}', verb)
        .replace('{crit}', critSuffix)
      : `${ctx.displayName} ${verb} ${battle.enemy.name} for ${hpDmg}${critSuffix}!`;
    lines.push(absorbed > 0 ? `${body} (🛡️ ${absorbed} absorbed)` : body);
    if (broke) lines.push(`🛡️ ${battle.enemy.name}'s shield shatters!`);
    if (wouldFell && floor === 1) {
      lines.push(
        `🕯️ ${battle.enemy.name} staggers but holds on — this fight isn't finished teaching.`,
      );
    }
    return lines;
  }
  // #85: the enemy's offense folds its own live ATK/MAG instances (sap
  // first, then stat buffs); the player's mitigation folds DEF/RES
  // instances and mitigation stances, floored sign-safe.
  const offense = enemyOffense(battle, spec.attack);
  const guard = battle.guarding ? 0.5 : 1;
  const mitig = playerMitigation(p, battle, spec.attack) * stanceMul(battle, 'player') * 0.85;
  const raw = Math.max(
    1,
    (offense * spec.power - mitig) * guard * (1 + incomingAmpPct(battle, 'player')),
  );
  const dmg = variance(rng, raw);
  // Shield routing (#79): mitigation first, ward second, HP last.
  let hpDmg = dmg;
  let absorbed = 0;
  let broke = false;
  if (!spec.bypassShield) {
    const a = absorbShield(battle, 'player', dmg, ctx.trace);
    absorbed = a.absorbed;
    hpDmg = a.hpDamage;
    broke = a.broke;
  }
  p.hp = Math.max(0, p.hp - hpDmg);
  ctx.lastDamage = dmg;
  ctx.hpDamaged = hpDmg > 0;
  ctx.targetFelled = p.hp <= 0;
  lines.push(
    `💥 ${battle.enemy.name} uses ${ctx.displayName} — ${hpDmg} damage to you!${
      absorbed > 0 ? ` (🛡️ ${absorbed} absorbed)` : ''
    }`,
  );
  if (broke) lines.push('🛡️ Your shield shatters!');
  // #104: the direct family runs the ONE shared player-targeted HP-loss
  // transition. #97: the authoritative HP-loss event dispatches the
  // wearer's triggers SYNCHRONOUSLY, once per actual HP loss — a two-hit
  // move answers twice, a damage-then-heal move keeps its damage
  // opportunity, and shield-only absorption never dispatches. The revival
  // interception runs BEFORE the reaction scan, so a synchronously revived
  // wearer still answers the lethal event; an unrecovered terminal hit
  // (hp 0) procs nothing. Proc-produced damage never dispatches — the
  // recursion boundary is structural (#89).
  resolvePlayerHpLoss(p, battle, rng, {
    hpDmg,
    attacker: 'enemy',
    cause: ctx.cause,
    procProduced: ctx.procProduced,
    trace: ctx.trace,
  }, lines);
  return lines;
}

/** One restore effect: MAG-scaled, flat, max-HP-fraction or full. #95:
 * the line AND the typed hpRestored event report the APPLIED delta —
 * overflow above the target's max is overheal, never phantom applied
 * healing in copy or metrics. */
function applyRestoreEffect(
  ctx: ExecCtx,
  spec: Extract<EffectSpec, { kind: 'restore' }>,
  side: 'player' | 'enemy',
): string[] {
  const { p, battle } = ctx;
  const lines: string[] = [];
  const source = `${ctx.source.kind}:${ctx.source.name}`;
  if (side === 'player') {
    const max = statsOf(p).maxHp;
    let attempted = 0;
    if (spec.hpFull) attempted = max;
    else if (spec.hpPctOfMax !== undefined) attempted = Math.floor(max * spec.hpPctOfMax);
    else if (spec.hpPower !== undefined) {
      attempted = Math.round(
        playerOffense(p, battle, 'mag') * spec.hpPower * 2.0 + (spec.hpFlat ?? 0),
      );
    }
    // Full restores announce even at full HP (Miracle parity) — with the
    // applied amount, which is honestly 0 there.
    if (spec.hpFull || attempted > 0) {
      const before = p.hp;
      p.hp = Math.min(max, p.hp + attempted);
      const applied = p.hp - before;
      recordCombatEvent(ctx.trace, {
        kind: 'hpRestored',
        round: battle.round,
        side,
        source,
        cause: ctx.cause,
        attempted,
        applied,
      });
      lines.push(
        spec.line?.replace('{n}', String(applied)) ??
          (ctx.actor === 'enemy'
            ? `💚 ${battle.enemy.name} uses ${ctx.displayName} and recovers ${applied} HP!`
            : `💚 ${ctx.displayName} restores ${applied} HP.`),
      );
    }
    if (spec.mpPctOfMax) {
      const maxMp = statsOf(p).maxMp;
      const before = p.mp;
      p.mp = Math.min(maxMp, p.mp + Math.floor(maxMp * spec.mpPctOfMax));
      if (p.mp > before) lines.push(`💧 You restore ${p.mp - before} MP.`);
    }
  } else {
    const max = battle.enemy.maxHp;
    let attempted = 0;
    if (spec.hpFull) attempted = max - battle.enemy.hp;
    else if (spec.hpPctOfMax !== undefined) attempted = Math.floor(max * spec.hpPctOfMax);
    if (attempted > 0) {
      const before = battle.enemy.hp;
      battle.enemy.hp = Math.min(max, battle.enemy.hp + attempted);
      const applied = battle.enemy.hp - before;
      recordCombatEvent(ctx.trace, {
        kind: 'hpRestored',
        round: battle.round,
        side,
        source,
        cause: ctx.cause,
        attempted,
        applied,
      });
      lines.push(
        spec.line?.replace('{n}', String(applied)) ??
          `💚 ${battle.enemy.name} uses ${ctx.displayName} and recovers ${applied} HP!`,
      );
    }
  }
  return lines;
}

function applySkill(
  p: PlayerState,
  battle: BattleState,
  sk: SkillDef,
  rng: Rng,
  cause: DamageCause,
  procProduced: boolean,
  afterSnapshot: boolean,
  trace?: CombatTraceEntry[],
): string[] {
  const lines: string[] = [];
  // Buff-style skills announce ONCE with their full rules text (#67 copy,
  // #78 mechanics): the statmods themselves stay quiet.
  const selfBuff = sk.effects.some((e) =>
    e.kind === 'statmod' && targetSideOf(e, 'player') === 'player' && !e.quiet
  );
  if (selfBuff) lines.push(`🔆 ${sk.name}! ${sk.desc}`);
  const ctx: ExecCtx = {
    p,
    battle,
    rng,
    actor: 'player',
    source: { kind: 'skill', id: sk.id, name: sk.name },
    displayName: sk.name,
    lastDamage: 0,
    targetFelled: false,
    hpDamaged: false,
    cause,
    procProduced,
    afterSnapshot,
    trace,
  };
  lines.push(...executeSpecs(ctx, sk.effects));
  return lines;
}

/** Applies one player action (attack/skill/item/guard/flee). Returns the
 * log lines plus whether the action actually consumed the turn — invalid
 * actions (cooldown/MP/unusable item) never do, so they never hand the
 * enemy a free round. */
function applyPlayerAction(
  p: PlayerState,
  battle: BattleState,
  action: PlayerAction,
  rng: Rng,
  trace: CombatTraceEntry[],
): { lines: string[]; consumedTurn: boolean } {
  const lines: string[] = [];
  const def = enemyDef(battle.enemy.id);
  if (!def) return { lines, consumedTurn: false };
  switch (action.kind) {
    case 'attack': {
      // The free basic action is class-typed (#70): Warrior/Rogue swing ATK
      // vs DEF, Mage/Cleric channel MAG vs RES — read from the class
      // catalog so button labels, history text and mechanics agree.
      const basic = CLASSES[p.classId].basicAction;
      const ctx: ExecCtx = {
        p,
        battle,
        rng,
        actor: 'player',
        source: { kind: 'skill', id: 'basic', name: basic.name },
        displayName: basic.name,
        lastDamage: 0,
        targetFelled: false,
        hpDamaged: false,
        cause: 'playerAction',
        procProduced: false,
        afterSnapshot: true,
        trace,
      };
      lines.push(...executeSpecs(ctx, [{
        kind: 'damage',
        attack: basic.kind,
        power: basic.power,
        line: `${basic.icon} ${basic.name} {verb} ${battle.enemy.name} for {n}{crit}`,
        critText: ' — critical hit!',
      }]));
      return { lines, consumedTurn: true };
    }
    case 'skill': {
      const sk = skill(action.skillId);
      if (!sk) {
        lines.push('…nothing happens.');
        return { lines, consumedTurn: false };
      }
      // Engine-side authority: only learned, class-owned skills may fire.
      // The UI hides the rest; forged or stale taps must not cast them.
      if (sk.classId !== p.classId || !p.skills.includes(sk.id)) {
        lines.push("You haven't learned that skill.");
        return { lines, consumedTurn: false };
      }
      // Pre-emptive skills (#80) fire in the opening phase; they are never
      // manual casts (the battle menu hides them too).
      if (sk.preEmptive) {
        lines.push('⚡ That skill fires on its own as the battle opens.');
        return { lines, consumedTurn: false };
      }
      if ((battle.cooldowns[sk.id] ?? 0) > 0) {
        lines.push('⏳ That skill is still on cooldown.');
        return { lines, consumedTurn: false };
      }
      if (p.mp < sk.mpCost) {
        lines.push('💧 Not enough MP.');
        return { lines, consumedTurn: false };
      }
      p.mp -= sk.mpCost;
      if (sk.cooldown > 0) battle.cooldowns[sk.id] = sk.cooldown + 1;
      lines.push(...applySkill(p, battle, sk, rng, 'playerAction', false, true, trace));
      return { lines, consumedTurn: true };
    }
    case 'item': {
      const eff = itemDefLookup(action.itemId)?.effect;
      // Auto-trigger-only items (Phoenix Cinder) can never be spent by hand.
      if (eff?.revivePct && !eff.healHp && !eff.healMp && !eff.cureStatus && !eff.flee) {
        lines.push('🔥 The Cinder smolders — it will spark on its own when you fall.');
        return { lines, consumedTurn: false };
      }
      // Smoke Bomb: guaranteed escape from non-boss fights (never wasted).
      if (eff?.flee) {
        if (battle.enemy.isBoss) {
          lines.push('🚫 No smoke clouds this fight — there is no escape.');
          return { lines, consumedTurn: false };
        }
        const used = consumeItem(p, action.itemId, battle, trace);
        if (!used) {
          lines.push('You rummage through your bag and find nothing useful.');
          return { lines, consumedTurn: false };
        }
        battle.phase = 'fled';
        lines.push(...used, '💨 Smoke floods the field — you slip away safely!');
        return { lines, consumedTurn: true };
      }
      const consumed = consumeItem(p, action.itemId, battle, trace);
      if (!consumed) {
        lines.push('You rummage through your bag and find nothing useful.');
        return { lines, consumedTurn: false };
      }
      lines.push(...consumed);
      return { lines, consumedTurn: true };
    }
    case 'guard': {
      battle.guarding = true;
      p.mp = Math.min(statsOf(p).maxMp, p.mp + Math.ceil(statsOf(p).maxMp * 0.08));
      lines.push('🛡️ You brace behind your guard (+MP).');
      if (!battle.tutorial) {
        lines.push(...runReactiveTriggers(p, battle, rng, 'onGuard', true, trace));
      }
      return { lines, consumedTurn: true };
    }
    case 'flee': {
      // Effective SPD both sides (#85) drives escape odds — Rogue identity,
      // and enemy Slows now genuinely open the way out.
      const spd = effectivePlayerSpd(p, battle);
      const foeSpd = effectiveEnemySpd(battle);
      if (battle.enemy.isBoss) {
        lines.push('🚫 There is no escape from this fight.');
      } else if (chance(rng, Math.min(0.9, Math.max(0.15, 0.5 + (spd - foeSpd) * 0.03)))) {
        battle.phase = 'fled';
        lines.push('🏃 You slip away safely.');
      } else {
        lines.push('🚫 You try to flee — but the way is blocked!');
      }
      return { lines, consumedTurn: true };
    }
  }
}

/** Consumes a battle-usable item (#105): the active battle and the
 * resolution trace arrive EXPLICITLY — never recovered from optional
 * player state, so round numbers and removal events are exact. Caller
 * validates kind. */
function consumeItem(
  p: PlayerState,
  itemId: string,
  battle: BattleState,
  trace?: CombatTraceEntry[],
): string[] | undefined {
  const entry = p.inventory.find((e) => e.id === itemId);
  if (!entry || entry.qty <= 0) return undefined;
  const itemDef = itemDefLookup(itemId);
  if (!itemDef?.effect) return undefined;
  const s = statsOf(p);
  const lines: string[] = [];
  const eff = itemDef.effect;
  if (eff.healHp) {
    const before = p.hp;
    p.hp = Math.min(s.maxHp, p.hp + eff.healHp);
    recordCombatEvent(trace, {
      kind: 'hpRestored',
      round: battle.round,
      side: 'player',
      source: `item:${itemDef.name}`,
      cause: 'item',
      attempted: eff.healHp,
      applied: p.hp - before,
    });
    lines.push(`🧪 ${itemDef.name} restores ${p.hp - before} HP.`);
  }
  if (eff.healMp) {
    const before = p.mp;
    p.mp = Math.min(s.maxMp, p.mp + eff.healMp);
    lines.push(`💧 ${itemDef.name} restores ${p.mp - before} MP.`);
  }
  if (eff.cureStatus) {
    // Real tagged cleanse (#78): removes every removable harmful instance —
    // today that is the sapped-strength family; tomorrow it is whatever the
    // shared vocabulary ships. #105: each removal records its typed
    // effectRemoved entry with the real round, the cause AND the consumable
    // that performed the cleanse.
    const removed = removeTagged(battle, 'player', ['harmful'], undefined, 'cleansed', trace, {
      kind: 'item',
      id: itemDef.id,
      name: itemDef.name,
    });
    if (removed.length > 0) lines.push(`🧴 ${itemDef.name} cleanses your harmful effects.`);
  }
  entry.qty--;
  if (entry.qty <= 0) p.inventory = p.inventory.filter((e) => e.id !== itemId);
  return [`You use ${itemDef.name}.`, ...lines];
}

/** #72: SPD's combat payoff — capped avoidance. Every class keeps a 2%
 * baseline; out-sprinting the foe adds up to 18 more points, and enemy SPD
 * pushes the odds back down. Both inputs are EFFECTIVE SPD (#85): live
 * instances on either side fold in. Damaging moves only: status/heal/guard
 * moves are never dodged — the policy is structural (this roll lives only
 * in the damaging branch of the resolver) and test-enforced. */
export function dodgeChance(playerSpd: number, enemySpd: number): number {
  return Math.min(0.2, Math.max(0.02, 0.02 + (playerSpd - enemySpd) * 0.002));
}

/** Enemy-side execution of one move through the shared resolver (#78).
 * Pure status moves (no damage, no heal, no guard stance) announce with the
 * 🌀 intro (#25 parity: never any implicit chip damage, and heal/guard
 * moves carry their own headline lines). */
function enemyAct(
  p: PlayerState,
  battle: BattleState,
  move: EnemyMove,
  rng: Rng,
  trace: CombatTraceEntry[],
): string[] {
  const lines: string[] = [];
  const announcesIntro = !move.effects.some((e) =>
    e.kind === 'damage' || e.kind === 'restore' ||
    (e.kind === 'statmod' && e.stat === 'mitigation')
  );
  if (announcesIntro) lines.push(`🌀 ${battle.enemy.name} uses ${move.name}.`);
  const ctx: ExecCtx = {
    p,
    battle,
    rng,
    actor: 'enemy',
    source: { kind: 'enemyMove', id: move.name, name: move.name },
    displayName: move.name,
    lastDamage: 0,
    targetFelled: false,
    hpDamaged: false,
    cause: 'enemyAction',
    procProduced: false,
    afterSnapshot: true,
    trace,
  };
  lines.push(...executeSpecs(ctx, move.effects));
  return lines;
}

/** Lethal-hit handling (#104): the ONE immediate revival interception.
 * Phoenix Cinder auto-revives ONCE per battle, then defeat stands no matter
 * how many Cinders are left in the bag. #105: the transition records a
 * `revived` trace entry (attempted formula, applied delta) in the same
 * caller-owned resolution trace — before any later reaction resolves. */
export function onLethalHit(
  p: PlayerState,
  battle: BattleState,
  trace?: CombatTraceEntry[],
): string[] {
  const feather = p.inventory.find((e) => e.id === 'c_phoenix_feather');
  if (!feather || battle.phoenixUsed) return [];
  battle.phoenixUsed = true;
  feather.qty--;
  if (feather.qty <= 0) p.inventory = p.inventory.filter((e) => e.id !== feather.id);
  const attempted = Math.floor(statsOf(p).maxHp * 0.5);
  const before = p.hp;
  p.hp = attempted;
  recordCombatEvent(trace, {
    kind: 'revived',
    round: battle.round,
    source: 'item:Phoenix Cinder',
    attempted,
    applied: p.hp - before,
  });
  return ['🔥 The Phoenix Cinder blazes — you rise again at half health!'];
}

/** Rolls battle rewards from the enemy definition. Mutates nothing. */
export function rollRewards(
  def: EnemyDef,
  rng: Rng = defaultRng,
): { xp: number; gold: number; drops: string[]; xpConvertedGold?: number } {
  const drops: string[] = [];
  for (const [id, dropChance] of Object.entries(def.drops ?? {})) {
    if (chance(rng, dropChance)) drops.push(id);
  }
  return {
    xp: randInt(rng, Math.floor(def.xp * 0.9), Math.ceil(def.xp * 1.1)),
    gold: randInt(rng, Math.floor(def.gold * 0.8), Math.ceil(def.gold * 1.2)),
    drops,
  };
}

/** UI/test helper: live instances on one side (render derives from these). */
export function liveEffects(b: BattleState, side: 'player' | 'enemy'): EffectInstance[] {
  return b.effectInstances.filter((i) => i.side === side);
}

/** Re-export for balance metrics consumers. */
export { mitigationPct as foldedMitigationPct, sapPct as foldedSapPct, statPct as foldedStatPct };
export type { StatKey };
