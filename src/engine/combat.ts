/**
 * Turn-based combat engine. Pure: mutates PlayerState + BattleState, returns
 * log lines. Zero grammY imports. Buffs/debuffs live on the battle so they
 * survive across messages.
 */

import type { BattlePhase, BattleState, CombatBuffs, PlayerState } from './types.ts';
import type { EnemyDef, EnemyMove, SkillDef } from '../content/types.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { skill } from '../content/skills.ts';
import { item as itemDefLookup } from '../content/items.ts';
import { statsOf } from './character.ts';
import { chance, defaultRng, randInt, type Rng, variance } from './rng.ts';

export function newBuffs(): CombatBuffs {
  return {
    atkPct: 0,
    defPct: 0,
    resPct: 0,
    magPct: 0,
    spdPct: 0,
    durations: {},
    weakenedPct: 0,
    weakenTurns: 0,
    stunnedTurns: 0,
    stunnedEnemy: false,
  };
}

export function startBattle(enemyId: string, origin: string): BattleState | undefined {
  const def = enemyDef(enemyId);
  if (!def) return undefined;
  const battle: BattleState = {
    enemy: {
      id: def.id,
      name: def.name,
      hp: def.hp,
      maxHp: def.hp,
      isBoss: def.boss === true,
      turn: 0,
    },
    phase: 'active',
    round: 1,
    cooldowns: {},
    guarding: false,
    buffs: newBuffs(),
    log: [`${def.emoji} ${def.name} blocks your path!`],
    origin,
  };
  return battle;
}

function effStat(base: number, pct: number): number {
  return Math.max(1, Math.round(base * (1 + pct)));
}

function playerEffectiveAtk(p: PlayerState, buffs: CombatBuffs): number {
  return effStat(statsOf(p).atk * (1 - buffs.weakenedPct), buffs.atkPct);
}

function playerEffectiveMag(p: PlayerState, buffs: CombatBuffs): number {
  return effStat(statsOf(p).mag * (1 - buffs.weakenedPct), buffs.magPct);
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
}

function enemyChooseMove(def: EnemyDef, e: BattleState['enemy'], rng: Rng): EnemyMove {
  const t = e.turn + 1;
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

function tickBuffTurns(buffs: CombatBuffs): void {
  for (const key of ['atk', 'def', 'res', 'mag', 'spd'] as const) {
    const d = buffs.durations[key];
    if (d === undefined) continue;
    if (d <= 1) {
      buffs.durations[key] = 0;
      buffs[`${key}Pct`] = 0;
    } else {
      buffs.durations[key] = d - 1;
    }
  }
  if (buffs.weakenTurns > 0) {
    buffs.weakenTurns--;
    if (buffs.weakenTurns === 0) buffs.weakenedPct = 0;
  }
}

/** Applies the player's action, then the enemy's response. Mutates state. */
interface PlayerPhaseResult {
  lines: string[];
  skipped: boolean;
}

/** Player half of a round: stun check, then the chosen action. */
function playerPhase(
  p: PlayerState,
  battle: BattleState,
  action: PlayerAction,
  rng: Rng,
): PlayerPhaseResult {
  const buffs = battle.buffs;
  const lines: string[] = [];
  let skipped = false;
  if (buffs.stunnedTurns > 0) {
    buffs.stunnedTurns--;
    lines.push('💫 You are stunned and lose your turn!');
    skipped = true;
  } else {
    lines.push(...applyPlayerAction(p, battle, action, rng));
  }
  return { lines, skipped };
}

export function performAction(
  p: PlayerState,
  battle: BattleState,
  action: PlayerAction,
  rng: Rng = defaultRng,
): ActionResult {
  const def = enemyDef(battle.enemy.id);
  if (!def || battle.phase !== 'active') return { battle, lines: [], skipped: false };

  const phase = playerPhase(p, battle, action, rng);
  const lines = [...phase.lines];
  let skipped = phase.skipped;
  const buffs = battle.buffs;

  // Player won without retaliation (enemy felled by the action)…
  if (battle.enemy.hp <= 0) return { battle, lines, skipped };
  // …or escaped cleanly (no parting shot after a successful flee).
  if ((battle.phase as BattlePhase) === 'fled') return { battle, lines, skipped };

  // ── Enemy phase ─────────────────────────────────────────────────────
  battle.enemy.turn++;
  if (buffs.stunnedEnemy) {
    buffs.stunnedEnemy = false;
    lines.push(`😵 ${battle.enemy.name} is stunned and cannot act!`);
  } else {
    const move = enemyChooseMove(def, battle.enemy, rng);
    lines.push(...enemyAct(p, battle, def, move, rng));
  }

  // ── End of round bookkeeping ────────────────────────────────────────
  battle.guarding = false;
  battle.round++;
  tickBuffTurns(buffs);
  for (const [k, v] of Object.entries(battle.cooldowns)) {
    if (v <= 1) delete battle.cooldowns[k];
    else battle.cooldowns[k] = v - 1;
  }
  battle.log.push(...lines);
  if (battle.log.length > 12) battle.log.splice(0, battle.log.length - 12);
  return { battle, lines, skipped };
}

/** Shared physical/magical strike: damage roll, crit text, stun roll. */
function strike(
  p: PlayerState,
  battle: BattleState,
  sk: SkillDef,
  rng: Rng,
  kind: 'phys' | 'mag',
): { lines: string[]; dmg: number } {
  const def = enemyDef(battle.enemy.id);
  if (!def) return { lines: [], dmg: 0 };
  const buffs = battle.buffs;
  const offense = kind === 'phys' ? playerEffectiveAtk(p, buffs) : playerEffectiveMag(p, buffs);
  const mitigation = kind === 'phys' ? def.def : def.res;
  const res = dealDamage(sk.power, offense, mitigation, rng, statsOf(p).luck);
  battle.enemy.hp = Math.max(0, battle.enemy.hp - res.dmg);
  const verb = kind === 'phys' ? 'hits' : 'sears';
  const lines = [
    `${sk.name} ${verb} ${battle.enemy.name} for ${res.dmg}${res.crit ? ' — critical!' : ''}!`,
  ];
  if (sk.stunChance && battle.enemy.hp > 0 && chance(rng, sk.stunChance)) {
    buffs.stunnedEnemy = true;
    lines.push(`💫 ${battle.enemy.name} is stunned!`);
  }
  return { lines, dmg: res.dmg };
}

/** Applies one player action (attack/skill/item/guard/flee). */
function applyPlayerAction(
  p: PlayerState,
  battle: BattleState,
  action: PlayerAction,
  rng: Rng,
): string[] {
  const lines: string[] = [];
  const def = enemyDef(battle.enemy.id);
  if (!def) return lines;
  const buffs = battle.buffs;
  switch (action.kind) {
    case 'attack': {
      const res = dealDamage(1.0, playerEffectiveAtk(p, buffs), def.def, rng, statsOf(p).luck);
      battle.enemy.hp = Math.max(0, battle.enemy.hp - res.dmg);
      lines.push(
        `⚔️ You strike ${battle.enemy.name} for ${res.dmg}${res.crit ? ' — critical hit!' : ''}`,
      );
      break;
    }
    case 'skill': {
      const sk = skill(action.skillId);
      if (!sk) {
        lines.push('…nothing happens.');
        break;
      }
      if ((battle.cooldowns[sk.id] ?? 0) > 0) {
        lines.push('⏳ That skill is still on cooldown.');
        break;
      }
      if (p.mp < sk.mpCost) {
        lines.push('💧 Not enough MP.');
        break;
      }
      p.mp -= sk.mpCost;
      if (sk.cooldown > 0) battle.cooldowns[sk.id] = sk.cooldown + 1;
      lines.push(...applySkill(p, battle, sk, rng));
      break;
    }
    case 'item': {
      const consumed = consumeItem(p, action.itemId);
      if (!consumed) {
        lines.push('You rummage through your bag and find nothing useful.');
        break;
      }
      lines.push(...consumed);
      break;
    }
    case 'guard': {
      battle.guarding = true;
      p.mp = Math.min(statsOf(p).maxMp, p.mp + Math.ceil(statsOf(p).maxMp * 0.08));
      lines.push('🛡️ You brace behind your guard (+MP).');
      break;
    }
    case 'flee': {
      const s = statsOf(p);
      if (battle.enemy.isBoss) {
        lines.push('🚫 There is no escape from this fight.');
      } else if (chance(rng, Math.min(0.9, Math.max(0.15, 0.5 + (s.spd - def.spd) * 0.03)))) {
        battle.phase = 'fled';
        lines.push('🏃 You slip away safely.');
      } else {
        lines.push('🚫 You try to flee — but the way is blocked!');
      }
      break;
    }
  }

  return lines;
}

function applySkill(p: PlayerState, battle: BattleState, sk: SkillDef, rng: Rng): string[] {
  const lines: string[] = [];
  const def = enemyDef(battle.enemy.id);
  if (!def) return lines;
  const buffs = battle.buffs;
  const s = statsOf(p);
  switch (sk.type) {
    case 'phys': {
      lines.push(...strike(p, battle, sk, rng, 'phys').lines);
      break;
    }
    case 'mag': {
      const res = strike(p, battle, sk, rng, 'mag');
      lines.push(...res.lines);
      if (sk.id === 'sk_drain_life' && res.dmg > 0) {
        const heal = Math.floor(res.dmg * (sk.potency ?? 0.5));
        p.hp = Math.min(s.maxHp, p.hp + heal);
        lines.push(`🩸 You drain ${heal} HP.`);
      }
      break;
    }
    case 'heal': {
      if (sk.id === 'sk_miracle') {
        p.hp = s.maxHp;
        buffs.weakenedPct = 0;
        buffs.weakenTurns = 0;
        lines.push('✨ Miracle! HP fully restored, debuffs cleansed.');
      } else if (sk.id === 'sk_adrenaline') {
        const heal = Math.floor(s.maxHp * (sk.potency ?? 0.3));
        p.hp = Math.min(s.maxHp, p.hp + heal);
        buffs.atkPct += 0.2;
        buffs.durations.atk = Math.max(buffs.durations.atk ?? 0, 2);
        lines.push(`🩹 You recover ${heal} HP and feel the rush (+20% ATK).`);
      } else {
        const heal = Math.round(playerEffectiveMag(p, buffs) * sk.power * 2.0 + 20);
        p.hp = Math.min(s.maxHp, p.hp + heal);
        lines.push(`💚 ${sk.name} restores ${heal} HP.`);
      }
      break;
    }
    case 'buff': {
      const potency = sk.potency ?? 0.3;
      const dur = sk.duration ?? 3;
      const apply = (key: 'atk' | 'def' | 'res' | 'mag' | 'spd', pct: number): void => {
        buffs[`${key}Pct`] = pct;
        buffs.durations[key] = dur;
      };
      if (sk.id === 'sk_war_cry') apply('atk', potency);
      else if (sk.id === 'sk_iron_wall') apply('def', potency);
      else if (sk.id === 'sk_barrier') {
        apply('def', potency);
        apply('res', potency);
      } else if (sk.id === 'sk_time_warp') {
        apply('mag', potency);
        apply('spd', potency);
      } else if (sk.id === 'sk_smoke_step') apply('spd', potency);
      else if (sk.id === 'sk_blessing') {
        apply('atk', potency);
        apply('def', potency);
      } else if (sk.id === 'sk_holy_ward') apply('res', potency);
      lines.push(`🔆 ${sk.name}! ${sk.desc}`);
      break;
    }
    case 'debuff': {
      const res = strike(p, battle, sk, rng, 'phys');
      lines.push(...res.lines);
      if (sk.potency) {
        buffs.weakenedPct = sk.potency;
        buffs.weakenTurns = sk.duration ?? 3;
        lines.push(`🩸 ${battle.enemy.name} is weakened by ${Math.round(sk.potency * 100)}%.`);
      }
      break;
    }
  }
  return lines;
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
    const buffs = p.battle?.buffs;
    if (buffs) {
      buffs.weakenedPct = 0;
      buffs.weakenTurns = 0;
    }
    lines.push(`🧴 ${itemDef.name} clears your debuffs.`);
  }
  entry.qty--;
  if (entry.qty <= 0) p.inventory = p.inventory.filter((e) => e.id !== itemId);
  return [`You use ${itemDef.name}.`, ...lines];
}

function enemyAct(
  p: PlayerState,
  battle: BattleState,
  def: EnemyDef,
  move: EnemyMove,
  rng: Rng,
): string[] {
  const lines: string[] = [];
  const buffs = battle.buffs;
  if (move.selfHealPct) {
    const heal = Math.floor(battle.enemy.maxHp * move.selfHealPct);
    battle.enemy.hp = Math.min(battle.enemy.maxHp, battle.enemy.hp + heal);
    lines.push(`💚 ${battle.enemy.name} uses ${move.name} and recovers ${heal} HP!`);
    return lines;
  }
  const s = statsOf(p);
  const offense = move.kind === 'phys' ? def.atk : def.mag;
  const guard = battle.guarding ? 0.5 : 1;
  const mitig = move.kind === 'phys'
    ? effStat(s.def, buffs.defPct) * 0.85
    : effStat(s.res, buffs.resPct) * 0.85;
  const raw = Math.max(1, (offense * move.power - mitig) * guard);
  const dmg = variance(rng, raw);
  p.hp = Math.max(0, p.hp - dmg);
  lines.push(`💥 ${battle.enemy.name} uses ${move.name} — ${dmg} damage to you!`);
  if (move.weakenPct) {
    buffs.weakenedPct = move.weakenPct;
    buffs.weakenTurns = 2;
    lines.push('🩸 Your strength is sapped!');
  }
  if (p.hp <= 0) {
    // Phoenix Cinder auto-revive
    const feather = p.inventory.find((e) => e.id === 'c_phoenix_feather');
    if (feather) {
      feather.qty--;
      if (feather.qty <= 0) p.inventory = p.inventory.filter((e) => e.id !== feather.id);
      p.hp = Math.floor(s.maxHp * 0.5);
      lines.push('🔥 The Phoenix Cinder blazes — you rise again at half health!');
    }
  }
  return lines;
}

/** Rolls battle rewards from the enemy definition. Mutates nothing. */
export function rollRewards(
  def: EnemyDef,
  rng: Rng = defaultRng,
): { xp: number; gold: number; drops: string[] } {
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
