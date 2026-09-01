/** Turn-based combat engine. Pure: mutates PlayerState + BattleState, returns
 * log lines. Zero grammY imports. Live effect instances (#78) are the
 * authoritative combat state — skills, enemy moves, equipment and encounter
 * openings share one typed effect vocabulary, executed by the generic
 * resolver in this file. No content-id branches. */

import type {
  BattleOrigin,
  BattlePhase,
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
  grantShield,
  incomingAmpPct,
  mitigationPct,
  type PeriodicTick,
  removeTagged,
  sapPct,
  seedForSpec,
  statPct,
  tickEndOfRound,
  tickPlayerTurnStart,
} from './effects.ts';
import { chance, defaultRng, randInt, type Rng, variance } from './rng.ts';

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
  /** The fighting hero. Required for enemy openings, equipment effects and
   * pre-emptive skills (the resolver needs a stat/target owner); omitted
   * calls resolve the encounter boss ward only. */
  player?: PlayerState;
  /** Seeded RNG for opening chance rolls — one draw per authored chance,
   * outcome-only persistence afterwards. */
  rng?: Rng;
  /** Guided-prologue provenance (#69/#80): suppresses EVERY opening source
   * and phase-gates the fight at construction. The tutorial must never
   * depend on post-construction marking that runs too late. */
  tutorial?: boolean;
}

export function startBattle(
  enemyId: string,
  origin: BattleOrigin,
  opts: StartBattleOpts = {},
): BattleState | undefined {
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
  if (!opts.tutorial) {
    const opRng = opts.rng ?? defaultRng;
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
      });
      opening.push(
        `🛡️ ${ward.name ?? 'Opening Ward'} — ${def.name} absorbs up to ${ward.amount} damage!`,
      );
    }
    const p = opts.player;
    if (p) {
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
        ));
      }
      // 3. Equipped-item effects (#80): stable slot order — weapon, armor,
      // trinket. Each item is its own source, so different items coexist;
      // same-source reapplication follows the authored stacking policy.
      for (const slot of ['weapon', 'armor', 'trinket'] as const) {
        const itemId = p.equipment[slot];
        const it = itemId ? itemDefLookup(itemId) : undefined;
        if (!it?.effects?.length) continue;
        opening.push(...runOpening(
          battle,
          p,
          opRng,
          'player',
          { kind: 'item', id: it.id, name: it.name },
          it.name,
          it.effects,
        ));
      }
      // 4. Learned pre-emptive skills (#80): stable `p.skills` order. No MP
      // or cooldown cost — the opening never charges resources.
      for (const id of p.skills) {
        const sk = skill(id);
        if (!sk?.preEmptive) continue;
        opening.push(...applySkill(p, battle, sk, opRng));
      }
      // An opening can wound but never end the fight before it begins.
      battle.enemy.hp = Math.max(1, battle.enemy.hp);
    }
  }
  if (opening.length > 0) battle.opening = { lines: opening };
  return battle;
}

/** Runs one opening spec list through the shared resolver (#80). Openings
 * are ordinary one-shot applications at round 1 — same vocabulary, same
 * stacking policies, same default lines — just resolved before the first
 * player action exists. */
function runOpening(
  battle: BattleState,
  p: PlayerState,
  rng: Rng,
  actor: 'player' | 'enemy',
  source: EffectSource,
  displayName: string,
  specs: readonly EffectSpec[],
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
  };
  return executeSpecs(ctx, specs);
}

export type PlayerAction =
  | { kind: 'attack' }
  | { kind: 'skill'; skillId: string }
  | { kind: 'item'; itemId: string }
  | { kind: 'guard' }
  | { kind: 'flee' };

export interface ActionResult {
  battle: BattleState;
  lines: string[];
  /** True when the player was stunned and lost the turn. */
  skipped: boolean;
  /** False when the action was invalid (cooldown/MP/unusable item): no
   * enemy phase ran and the lines are NOT in the battle log — handlers
   * must surface them via notices (#32). */
  consumedTurn: boolean;
}

function enemyChooseMove(def: EnemyDef, e: BattleState['enemy'], rng: Rng): EnemyMove {
  // e.turn is ALREADY the count of enemy actions taken (performAction
  // increments before the phase) — `every: N` fires on the Nth action:
  // 3, 6, 9… with no extra offset (#26; it used to fire on 2, 5, 8…).
  // Stunned turns advance the counter — time passes — but choose no move,
  // so a stun never fires a special.
  const t = e.turn;
  if (def.special && t % def.special.every === 0) return def.special.move;
  const idx = pickWeighted(def.moves.map((m) => m.weight), rng);
  return def.moves[idx] ?? def.moves[0]!;
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

/** Applies the player's action, then the enemy's response. Mutates state. */
interface PlayerPhaseResult {
  lines: string[];
  skipped: boolean;
  /** False when the action was invalid (cooldown/MP/unusable) — no enemy phase. */
  consumedTurn: boolean;
}

function maxHpOf(battle: BattleState, p: PlayerState) {
  return (side: 'player' | 'enemy'): number =>
    side === 'player' ? statsOf(p).maxHp : battle.enemy.maxHp;
}

/** Player half of a round: turn-start periodic ticks (#78), stun check,
 * then the chosen action. */
function playerPhase(
  p: PlayerState,
  battle: BattleState,
  action: PlayerAction,
  rng: Rng,
): PlayerPhaseResult {
  const lines: string[] = [];
  // Turn-start periodic effects (#78) tick before anything else — poison
  // does not care whether you can act. Expiring shield contributions cap
  // the pool on the same beat (#79).
  const started = tickPlayerTurnStart(battle, maxHpOf(battle, p));
  for (const t of started.ticks) lines.push(...applyPeriodicTick(p, battle, t));
  for (const loss of started.shieldLosses) lines.push(`🛡️ ${loss.lost} shield capacity fades.`);
  if (consumeStun(battle, 'player')) {
    lines.push('💫 You are stunned and lose your turn!');
    return { lines, skipped: true, consumedTurn: true };
  }
  const res = applyPlayerAction(p, battle, action, rng);
  return { lines: res.lines, skipped: false, consumedTurn: res.consumedTurn };
}

export function performAction(
  p: PlayerState,
  battle: BattleState,
  action: PlayerAction,
  rng: Rng = defaultRng,
): ActionResult {
  const def = enemyDef(battle.enemy.id);
  if (!def || battle.phase !== 'active') {
    return { battle, lines: [], skipped: false, consumedTurn: false };
  }

  // The round these lines belong to: the one in which the player acted —
  // captured before end-of-round bookkeeping advances the counter (#67).
  const actedRound = battle.round;
  const phase = playerPhase(p, battle, action, rng);
  const lines = [...phase.lines];
  const skipped = phase.skipped;

  // #69 rework: the guided fight advances its lesson beats only on the
  // intended action kinds, in order — the beats cannot be skipped or
  // reordered, whatever the damage rolls do.
  if (battle.tutorial && phase.consumedTurn) {
    const step = battle.tutorialStep;
    if (step === 'basic' && action.kind === 'attack') battle.tutorialStep = 'skill';
    else if (step === 'skill' && action.kind === 'skill') battle.tutorialStep = 'guard';
    else if (step === 'guard' && action.kind === 'guard') battle.tutorialStep = 'item';
    else if (step === 'item' && action.kind === 'item') battle.tutorialStep = 'cleared';
  }

  // Player won without retaliation (enemy felled by the action)…
  if (battle.enemy.hp <= 0) {
    // #69 rework: the guided fight cannot end before every lesson beat has
    // been performed — a killing blow merely staggers the fixture.
    if (battle.tutorial && battle.tutorialStep !== 'cleared') {
      battle.enemy.hp = 1;
      lines.push(
        `🕯️ ${battle.enemy.name} staggers but holds on — this fight isn't finished teaching.`,
      );
    } else {
      // The terminal round follows the SAME history model as every other
      // consumed action (#67): kill rounds are recorded, never dropped.
      battle.history.push({ round: actedRound, lines });
      return { battle, lines, skipped, consumedTurn: true };
    }
  }
  // Invalid action (cooldown/MP/unusable item): no turn consumed, no enemy
  // phase, and NO history round (#67) — the lines stay handler feedback only.
  if (!phase.consumedTurn) return { battle, lines, skipped, consumedTurn: false };
  // …or escaped cleanly (no parting shot after a successful flee).
  if ((battle.phase as BattlePhase) === 'fled') {
    battle.history.push({ round: actedRound, lines });
    return { battle, lines, skipped, consumedTurn: true };
  }

  // ── Enemy phase ─────────────────────────────────────────────────────
  battle.enemy.turn++;
  if (consumeStun(battle, 'enemy')) {
    // The stun is consumed the moment the enemy loses its action (#78;
    // was the stunnedEnemy flag).
    lines.push(`😵 ${battle.enemy.name} is stunned and cannot act!`);
  } else {
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
    } else {
      const move = enemyChooseMove(def, battle.enemy, rng);
      lines.push(...enemyAct(p, battle, move, rng));
    }
  }

  // ── End of round bookkeeping ────────────────────────────────────────
  battle.guarding = false;
  battle.round++;
  const { ticks, shieldLosses } = tickEndOfRound(battle, maxHpOf(battle, p));
  for (const t of ticks) lines.push(...applyPeriodicTick(p, battle, t));
  for (const loss of shieldLosses) lines.push(`🛡️ ${loss.lost} shield capacity fades.`);
  for (const [k, v] of Object.entries(battle.cooldowns)) {
    if (v <= 1) delete battle.cooldowns[k];
    else battle.cooldowns[k] = v - 1;
  }
  // Complete-round history (#67): every consumed turn records exactly one
  // round — the whole player action + enemy response, never truncated here.
  battle.history.push({ round: actedRound, lines });
  return { battle, lines, skipped, consumedTurn: true };
}

/** Applies one periodic tick (#78): heal or damage the target side, with
 * lethal handling for the player. Enemy-death from ticks leaves hp <= 0
 * for the normal victory resolution. */
function applyPeriodicTick(
  p: PlayerState,
  battle: BattleState,
  t: PeriodicTick,
): string[] {
  const lines: string[] = [];
  if (t.amount >= 0) {
    if (t.side === 'player') {
      const max = statsOf(p).maxHp;
      const heal = Math.min(t.amount, max - p.hp);
      p.hp = Math.min(max, p.hp + t.amount);
      if (heal > 0) lines.push(`💚 You recover ${heal} HP (${t.name}).`);
    } else {
      const heal = Math.min(t.amount, battle.enemy.maxHp - battle.enemy.hp);
      battle.enemy.hp = Math.min(battle.enemy.maxHp, battle.enemy.hp + t.amount);
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
    const a = absorbShield(battle, t.side, dmg);
    absorbed = a.absorbed;
    hpDmg = a.hpDamage;
    broke = a.broke;
  }
  if (t.side === 'player') {
    p.hp = Math.max(0, p.hp - hpDmg);
    lines.push(
      `☠️ You take ${hpDmg} damage (${t.name}).${absorbed > 0 ? ` (🛡️ ${absorbed} absorbed)` : ''}`,
    );
    if (broke) lines.push('🛡️ Your shield shatters!');
    if (p.hp <= 0) lines.push(...onLethalHit(p, battle));
  } else {
    battle.enemy.hp = Math.max(0, battle.enemy.hp - hpDmg);
    lines.push(
      `☠️ ${battle.enemy.name} takes ${hpDmg} damage (${t.name}).${
        absorbed > 0 ? ` (🛡️ ${absorbed} absorbed)` : ''
      }`,
    );
    if (broke) lines.push(`🛡️ ${battle.enemy.name}'s shield shatters!`);
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
    const s = statsOf(ctx.p);
    const def = enemyDef(ctx.battle.enemy.id);
    if (
      def &&
      chance(ctx.rng, dodgeChance(effStat(s.spd, statPct(ctx.battle, 'player', 'spd')), def.spd))
    ) {
      lines.push(
        `💨 ${ctx.battle.enemy.name} uses ${ctx.displayName} — you slip aside, untouched!`,
      );
      return lines;
    }
  }
  for (const spec of specs) {
    // Riders never land on a corpse — checked BEFORE the chance draw so a
    // felled target never consumes a roll (long-standing rng parity).
    if (spec.requireSurvivor && ctx.targetFelled) continue;
    // Riders gated on real HP damage (#79): a fully-shielded hit never
    // triggered the on-flesh effect. Checked BEFORE the chance draw.
    if (spec.requireHpDamage && !ctx.hpDamaged) continue;
    if (spec.chance !== undefined && !chance(ctx.rng, spec.chance)) continue;
    const side = targetSideOf(spec, ctx.actor);
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
        if (ctx.lastDamage > 0) {
          const heal = Math.floor(ctx.lastDamage * spec.pct);
          if (heal > 0) {
            const max = statsOf(ctx.p).maxHp;
            ctx.p.hp = Math.min(max, ctx.p.hp + heal);
            lines.push(`🩸 You drain ${heal} HP.`);
          }
        }
        break;
      }
      case 'shield': {
        // Capacity formula (heal parity): MAG-scaled when magPower is set,
        // flat otherwise. The caster's own sap scales it like any offense
        // stat (#79).
        const base = ctx.actor === 'player'
          ? playerOffense(ctx.p, ctx.battle, 'mag')
          : (enemyDef(ctx.battle.enemy.id)?.mag ?? 0) * (1 - sapPct(ctx.battle, 'enemy'));
        const amount = Math.round(base * (spec.magPower ?? 0) * 2 + (spec.amount ?? 0));
        const seed = seedForSpec(
          spec,
          instanceDefId(ctx, spec),
          ctx.displayName,
          side,
          ctx.source,
          amount,
        );
        const grant = grantShield(ctx.battle, side, seed);
        const line = defaultInstanceLine(ctx, spec, side, amount);
        if (line) lines.push(line);
        if (grant.wasted > 0) lines.push(`🛡️ ${grant.wasted} over capacity — wasted.`);
        if (grant.lost > 0) lines.push(`🛡️ ${grant.lost} shield capacity fades.`);
        break;
      }
      case 'statmod':
      case 'control':
      case 'periodic': {
        const defId = instanceDefId(ctx, spec);
        const seed = seedForSpec(
          spec,
          defId,
          // All saps share one named condition (#77 copy) regardless of
          // which move or skill sapped it.
          defId === 'sap' ? 'Sapped' : ctx.displayName,
          side,
          ctx.source,
        );
        applyInstance(ctx.battle, seed);
        const line = defaultInstanceLine(ctx, spec, side);
        if (line) lines.push(line);
        break;
      }
      case 'cleanse': {
        const removed = removeTagged(ctx.battle, side, spec.tags, spec.max);
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
        const removed = removeTagged(ctx.battle, side, spec.tags, spec.max);
        if (removed.length > 0 && !spec.quiet) {
          lines.push(
            spec.line?.replace('{n}', String(removed.length)) ??
              `✨ ${ctx.battle.enemy.name}'s benefits are stripped.`,
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

/** Stacking identity: all saps share the generic `sap` slot (strongest
 * wins), everything else keys on the applying content id. */
function instanceDefId(ctx: ExecCtx, spec: EffectSpec): string {
  if (spec.kind === 'statmod' && spec.stat === 'outgoing' && (spec.pct ?? 0) < 0) return 'sap';
  return ctx.source.id;
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
    // Player strike: crit (luck) + variance; enemy guard stance is a live
    // mitigation instance (#78).
    const mitigation = (spec.attack === 'phys' ? def.def : def.res) *
      (1 + mitigationPct(battle, 'enemy'));
    const res = dealDamage(
      spec.power,
      playerOffense(p, battle, spec.attack),
      mitigation,
      rng,
      statsOf(p).luck,
    );
    // Shield routing (#79): normal damage pools into the target's ward
    // before HP; bypassShield lands on HP directly. lastDamage stays the
    // FULL resolved damage — lifesteal drains what was dealt.
    let hpDmg = res.dmg;
    let absorbed = 0;
    let broke = false;
    if (!spec.bypassShield) {
      const a = absorbShield(battle, 'enemy', res.dmg);
      absorbed = a.absorbed;
      hpDmg = a.hpDamage;
      broke = a.broke;
    }
    battle.enemy.hp = Math.max(0, battle.enemy.hp - hpDmg);
    ctx.lastDamage = res.dmg;
    ctx.hpDamaged = hpDmg > 0;
    ctx.targetFelled = battle.enemy.hp <= 0;
    const verb = spec.attack === 'phys' ? 'hits' : 'sears';
    const critSuffix = res.crit ? (spec.critText ?? ' — critical!') : '';
    const body = spec.line
      ? spec.line
        .replace('{n}', String(hpDmg))
        .replace('{verb}', verb)
        .replace('{crit}', critSuffix)
      : `${ctx.displayName} ${verb} ${battle.enemy.name} for ${hpDmg}${critSuffix}!`;
    lines.push(absorbed > 0 ? `${body} (🛡️ ${absorbed} absorbed)` : body);
    if (broke) lines.push(`🛡️ ${battle.enemy.name}'s shield shatters!`);
    return lines;
  }
  const offense = (spec.attack === 'phys' ? def.atk : def.mag) * (1 - sapPct(battle, 'enemy'));
  const guard = battle.guarding ? 0.5 : 1;
  const mitig = playerMitigation(p, battle, spec.attack) * 0.85;
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
    const a = absorbShield(battle, 'player', dmg);
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
  if (p.hp <= 0) lines.push(...onLethalHit(p, battle));
  return lines;
}

/** One restore effect: MAG-scaled, flat, max-HP-fraction or full. */
function applyRestoreEffect(
  ctx: ExecCtx,
  spec: Extract<EffectSpec, { kind: 'restore' }>,
  side: 'player' | 'enemy',
): string[] {
  const { p, battle } = ctx;
  const lines: string[] = [];
  if (side === 'player') {
    const max = statsOf(p).maxHp;
    let heal = 0;
    if (spec.hpFull) heal = max;
    else if (spec.hpPctOfMax !== undefined) heal = Math.floor(max * spec.hpPctOfMax);
    else if (spec.hpPower !== undefined) {
      heal = Math.round(playerOffense(p, battle, 'mag') * spec.hpPower * 2.0 + (spec.hpFlat ?? 0));
    }
    // Full restores announce even at full HP (Miracle parity); computed
    // heals show their formulaic amount, clamped on apply (#78).
    if (spec.hpFull || heal > 0) {
      p.hp = Math.min(max, p.hp + heal);
      lines.push(
        spec.line?.replace('{n}', String(heal)) ??
          (ctx.actor === 'enemy'
            ? `💚 ${battle.enemy.name} uses ${ctx.displayName} and recovers ${heal} HP!`
            : `💚 ${ctx.displayName} restores ${heal} HP.`),
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
    let heal = 0;
    if (spec.hpFull) heal = max - battle.enemy.hp;
    else if (spec.hpPctOfMax !== undefined) heal = Math.floor(max * spec.hpPctOfMax);
    if (heal > 0) {
      battle.enemy.hp = Math.min(max, battle.enemy.hp + heal);
      lines.push(
        spec.line?.replace('{n}', String(heal)) ??
          `💚 ${battle.enemy.name} uses ${ctx.displayName} and recovers ${heal} HP!`,
      );
    }
  }
  return lines;
}

function applySkill(p: PlayerState, battle: BattleState, sk: SkillDef, rng: Rng): string[] {
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
      lines.push(...applySkill(p, battle, sk, rng));
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
        const used = consumeItem(p, action.itemId);
        if (!used) {
          lines.push('You rummage through your bag and find nothing useful.');
          return { lines, consumedTurn: false };
        }
        battle.phase = 'fled';
        lines.push(...used, '💨 Smoke floods the field — you slip away safely!');
        return { lines, consumedTurn: true };
      }
      const consumed = consumeItem(p, action.itemId);
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
      return { lines, consumedTurn: true };
    }
    case 'flee': {
      // Effective SPD (live instances folded) drives escape odds — Rogue identity.
      const spd = effStat(statsOf(p).spd, statPct(battle, 'player', 'spd'));
      if (battle.enemy.isBoss) {
        lines.push('🚫 There is no escape from this fight.');
      } else if (chance(rng, Math.min(0.9, Math.max(0.15, 0.5 + (spd - def.spd) * 0.03)))) {
        battle.phase = 'fled';
        lines.push('🏃 You slip away safely.');
      } else {
        lines.push('🚫 You try to flee — but the way is blocked!');
      }
      return { lines, consumedTurn: true };
    }
  }
}

/** Consumes a battle-usable item. Caller validates kind. */
function consumeItem(p: PlayerState, itemId: string): string[] | undefined {
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
    // shared vocabulary ships.
    const removed = p.battle ? removeTagged(p.battle, 'player', ['harmful']) : [];
    if (removed.length > 0) lines.push(`🧴 ${itemDef.name} cleanses your harmful effects.`);
  }
  entry.qty--;
  if (entry.qty <= 0) p.inventory = p.inventory.filter((e) => e.id !== itemId);
  return [`You use ${itemDef.name}.`, ...lines];
}

/** #72: SPD's combat payoff — capped avoidance. Every class keeps a 2%
 * baseline; out-sprinting the foe adds up to 18 more points, and enemy SPD
 * pushes the odds back down. Damaging moves only: status/heal/guard moves
 * are never dodged — the policy is structural (this roll lives only in the
 * damaging branch of the resolver) and test-enforced. */
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
  };
  lines.push(...executeSpecs(ctx, move.effects));
  return lines;
}

/** Lethal-hit handling: Phoenix Cinder auto-revives ONCE per battle, then
 * defeat stands no matter how many Cinders are left in the bag. */
export function onLethalHit(p: PlayerState, battle: BattleState): string[] {
  const feather = p.inventory.find((e) => e.id === 'c_phoenix_feather');
  if (!feather || battle.phoenixUsed) return [];
  battle.phoenixUsed = true;
  feather.qty--;
  if (feather.qty <= 0) p.inventory = p.inventory.filter((e) => e.id !== feather.id);
  p.hp = Math.floor(statsOf(p).maxHp * 0.5);
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
