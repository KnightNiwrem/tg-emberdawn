/**
 * Turn-based combat engine. Pure: mutates PlayerState + BattleState, returns
 * log lines. Zero grammY imports. Buffs/debuffs live on the battle so they
 * survive across messages.
 */

import type { BattleOrigin, BattlePhase, BattleState, CombatBuffs, PlayerState } from './types.ts';
import type { EnemyDef, EnemyMove, SkillDef } from '../content/types.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { skill } from '../content/skills.ts';
import { item as itemDefLookup } from '../content/items.ts';
import { statsOf } from './character.ts';
import { CLASSES } from './classes.ts';
import { chance, defaultRng, randInt, type Rng, variance } from './rng.ts';

function newBuffs(): CombatBuffs {
  return {
    atkPct: 0,
    defPct: 0,
    resPct: 0,
    magPct: 0,
    spdPct: 0,
    durations: {},
    weakenedPct: 0,
    weakenTurns: 0,
    enemyWeakenedPct: 0,
    enemyWeakenTurns: 0,
    stunnedTurns: 0,
    stunnedEnemy: false,
  };
}

/** Slots a structured effect entry (#67) can occupy: the five stat buffs plus
 * the side-specific bookkeeping keys (player sapped, enemy sapped, enemy
 * guard stance, enemy stunned). */
type EffectKey =
  | 'atk'
  | 'def'
  | 'res'
  | 'mag'
  | 'spd'
  | 'weaken'
  | 'enemyWeaken'
  | 'guard'
  | 'enemyStun';

/** Off-buff keys defer their first decay on the cast round (#27/#38) — their
 * expiry sits one round later than defensive keys. Since #72 made SPD drive
 * enemy-response avoidance, SPD defends the cast round itself and now uses
 * the DEF/RES treatment (#77): a three-turn SPD buff covers at most three
 * enemy responses INCLUDING the casting round's. Only ATK and MAG — pure
 * offense keys that empower nothing on the round they're cast — defer. */
const SKIPS_FIRST_DECAY: Record<EffectKey, boolean> = {
  atk: true,
  mag: true,
  spd: false,
  guard: true,
  def: false,
  res: false,
  weaken: false,
  enemyWeaken: false,
  enemyStun: false,
};

/** Records (or replaces) the structured display metadata for one effect slot
 * (#67). Mechanics stay on CombatBuffs/BattleState; entries mirror them with
 * identity so the UI can name `Blessing` with magnitude and remaining
 * duration instead of surfacing only aggregate percentages. */
function applyEffect(
  battle: BattleState,
  key: EffectKey,
  id: string,
  name: string,
  side: 'player' | 'enemy',
  magnitude: string,
  source: string,
  turns: number,
): void {
  battle.effects = battle.effects.filter((e) => !(e.key === key && e.side === side));
  battle.effects.push({
    key,
    id,
    name,
    side,
    magnitude,
    source,
    expiresRound: battle.round + turns - (SKIPS_FIRST_DECAY[key] ? 0 : 1),
  });
}

/** Enemy weaken riders (Howl et al., #25): saps the PLAYER's offense. */
function sapPlayer(battle: BattleState, moveName: string, weakenPct: number): string[] {
  const buffs = battle.buffs;
  buffs.weakenedPct = weakenPct;
  buffs.weakenTurns = 2;
  applyEffect(
    battle,
    'weaken',
    `weaken:${moveName}`,
    'Sapped',
    'player',
    `−${Math.round(weakenPct * 100)}% Offense`,
    moveName,
    2,
  );
  return ['🩸 Your strength is sapped!'];
}

export function startBattle(enemyId: string, origin: BattleOrigin): BattleState | undefined {
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
    phoenixUsed: false,
    enemyGuardPct: 0,
    enemyGuardTurns: 0,
    buffs: newBuffs(),
    // Structured history starts EMPTY (#67): the encounter introduction is
    // the zone/explore notice, not accumulated battle history — the battle
    // screen shows it once inside the opening "Your move" panel.
    history: [],
    effects: [],
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

/** End-of-round decay. `skipOffense` carries the keys applied THIS round
 * whose effect cannot help the cast round itself (#27, #38): offensive ATK/
 * MAG empower only future actions, so deferring their first decay delivers
 * exactly the advertised number of useful actions. Defensive DEF/RES/SPD
 * tick on the cast round — SPD (since #72) shields that round's enemy
 * response through avoidance, so it counts the response it protects (#77). */
function tickBuffTurns(buffs: CombatBuffs, skipOffense?: Set<'atk' | 'mag'>): void {
  for (const key of ['atk', 'def', 'res', 'mag', 'spd'] as const) {
    if ((key === 'atk' || key === 'mag') && skipOffense?.has(key)) continue;
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
  if (buffs.enemyWeakenTurns > 0) {
    buffs.enemyWeakenTurns--;
    if (buffs.enemyWeakenTurns === 0) buffs.enemyWeakenedPct = 0;
  }
}

/** Applies the player's action, then the enemy's response. Mutates state. */
interface PlayerPhaseResult {
  lines: string[];
  skipped: boolean;
  /** False when the action was invalid (cooldown/MP/unusable) — no enemy phase. */
  consumedTurn: boolean;
}

/** Player half of a round: stun check, then the chosen action. */
function playerPhase(
  p: PlayerState,
  battle: BattleState,
  action: PlayerAction,
  rng: Rng,
  freshBuffs: Set<'atk' | 'mag'>,
): PlayerPhaseResult {
  const buffs = battle.buffs;
  const lines: string[] = [];
  if (buffs.stunnedTurns > 0) {
    buffs.stunnedTurns--;
    lines.push('💫 You are stunned and lose your turn!');
    return { lines, skipped: true, consumedTurn: true };
  }
  const res = applyPlayerAction(p, battle, action, rng, freshBuffs);
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
  const freshBuffs = new Set<'atk' | 'mag'>();
  const phase = playerPhase(p, battle, action, rng, freshBuffs);
  const lines = [...phase.lines];
  const skipped = phase.skipped;
  const buffs = battle.buffs;

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
  let guardCast = false;
  if (buffs.stunnedEnemy) {
    buffs.stunnedEnemy = false;
    // The stun is consumed the moment the enemy loses its action (#67).
    battle.effects = battle.effects.filter((e) => !(e.key === 'enemyStun' && e.side === 'enemy'));
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
      const acted = enemyAct(p, battle, def, move, rng);
      lines.push(...acted.lines);
      guardCast = acted.guardCast;
    }
  }

  // ── End of round bookkeeping ────────────────────────────────────────
  battle.guarding = false;
  // Enemy guard (#25): the casting round doesn't consume it — it shields
  // the NEXT `guardTurns` rounds of player attacks.
  if (!guardCast && battle.enemyGuardTurns > 0) {
    battle.enemyGuardTurns--;
    if (battle.enemyGuardTurns === 0) battle.enemyGuardPct = 0;
  }
  battle.round++;
  tickBuffTurns(buffs, freshBuffs);
  for (const [k, v] of Object.entries(battle.cooldowns)) {
    if (v <= 1) delete battle.cooldowns[k];
    else battle.cooldowns[k] = v - 1;
  }
  // Complete-round history (#67): every consumed turn records exactly one
  // round — the whole player action + enemy response, never truncated here.
  battle.history.push({ round: actedRound, lines });
  // Retire display entries whose mechanical slot expired with the round (#67).
  battle.effects = battle.effects.filter((e) => e.expiresRound >= battle.round);
  return { battle, lines, skipped, consumedTurn: true };
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
  const mitigation = (kind === 'phys' ? def.def : def.res) *
    (1 + battle.enemyGuardPct);
  const res = dealDamage(sk.power, offense, mitigation, rng, statsOf(p).luck);
  battle.enemy.hp = Math.max(0, battle.enemy.hp - res.dmg);
  const verb = kind === 'phys' ? 'hits' : 'sears';
  const lines = [
    `${sk.name} ${verb} ${battle.enemy.name} for ${res.dmg}${res.crit ? ' — critical!' : ''}!`,
  ];
  if (sk.stunChance && battle.enemy.hp > 0 && chance(rng, sk.stunChance)) {
    buffs.stunnedEnemy = true;
    applyEffect(
      battle,
      'enemyStun',
      'stunned',
      'Stunned',
      'enemy',
      'loses next action',
      sk.name,
      1,
    );
    lines.push(`💫 ${battle.enemy.name} is stunned!`);
  }
  return { lines, dmg: res.dmg };
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
  freshBuffs: Set<'atk' | 'mag'>,
): { lines: string[]; consumedTurn: boolean } {
  const lines: string[] = [];
  const def = enemyDef(battle.enemy.id);
  if (!def) return { lines, consumedTurn: false };
  const buffs = battle.buffs;
  switch (action.kind) {
    case 'attack': {
      // The free basic action is class-typed (#70): Warrior/Rogue swing ATK
      // vs DEF, Mage/Cleric channel MAG vs RES — read from the class
      // catalog so button labels, history text and mechanics agree.
      const basic = CLASSES[p.classId].basicAction;
      const offense = basic.kind === 'phys'
        ? playerEffectiveAtk(p, buffs)
        : playerEffectiveMag(p, buffs);
      const mitigation = (basic.kind === 'phys' ? def.def : def.res) *
        (1 + battle.enemyGuardPct);
      const res = dealDamage(
        basic.power,
        offense,
        mitigation,
        rng,
        statsOf(p).luck,
      );
      battle.enemy.hp = Math.max(0, battle.enemy.hp - res.dmg);
      lines.push(
        `${basic.icon} ${basic.name} ${
          basic.kind === 'phys' ? 'hits' : 'sears'
        } ${battle.enemy.name} for ${res.dmg}${res.crit ? ' — critical hit!' : ''}`,
      );
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
      lines.push(...applySkill(p, battle, sk, rng, freshBuffs));
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
      // Effective SPD (buffs included) drives escape odds — Rogue identity.
      const spd = effStat(statsOf(p).spd, buffs.spdPct);
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

function applySkill(
  p: PlayerState,
  battle: BattleState,
  sk: SkillDef,
  rng: Rng,
  freshBuffs: Set<'atk' | 'mag'>,
): string[] {
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
        // Cleanse removes the matching display entries too (#67).
        battle.effects = battle.effects.filter((e) => !(e.key === 'weaken' && e.side === 'player'));
        lines.push('✨ Miracle! HP fully restored, sapped strength lifted.');
      } else if (sk.id === 'sk_adrenaline') {
        const heal = Math.floor(s.maxHp * (sk.potency ?? 0.3));
        p.hp = Math.min(s.maxHp, p.hp + heal);
        buffs.atkPct += 0.2;
        buffs.durations.atk = Math.max(buffs.durations.atk ?? 0, 2);
        freshBuffs.add('atk'); // cast round doesn't consume it (#27)
        // Effect identity tracks the STACKED total (#67): Adrenaline Surge
        // adds onto any ATK buff already running, so the entry shows the
        // combined magnitude under the longest-running label.
        const atkEffect = battle.effects.find((e) => e.key === 'atk' && e.side === 'player');
        if (atkEffect) {
          atkEffect.magnitude = `+${Math.round(buffs.atkPct * 100)}% ATK`;
          atkEffect.expiresRound = Math.max(atkEffect.expiresRound, battle.round + 2);
        } else {
          applyEffect(
            battle,
            'atk',
            'sk_adrenaline',
            'Adrenaline Surge',
            'player',
            `+${Math.round(buffs.atkPct * 100)}% ATK`,
            sk.name,
            2,
          );
        }
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
        // Keys whose effect cannot help the cast round skip their first
        // decay (#27, #38): ATK/MAG empower only future actions. SPD no
        // longer defers (#77): since #72 it shapes the enemy RESPONSE via
        // avoidance, so — like DEF/RES — it defends the cast round itself
        // and ticks immediately.
        if (key === 'atk' || key === 'mag') freshBuffs.add(key);
        // Structured identity for the battle screen (#67): the effect is
        // named for the skill that cast it, not just its stat delta.
        applyEffect(
          battle,
          key,
          sk.id,
          sk.name,
          'player',
          `+${Math.round(pct * 100)}% ${key.toUpperCase()}`,
          sk.name,
          dur,
        );
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
        // #77: Blessing empowers the Cleric's ACTUAL offense. Every Cleric
        // damage action is MAG vs RES (Radiant Strike, Smite, …) and Cleric
        // weapons raise MAG — an ATK leg could never affect any class-owned
        // action, so the buff targets MAG/DEF instead.
        apply('mag', potency);
        apply('def', potency);
      } else if (sk.id === 'sk_holy_ward') apply('res', potency);
      lines.push(`🔆 ${sk.name}! ${sk.desc}`);
      break;
    }
    case 'debuff': {
      const res = strike(p, battle, sk, rng, 'phys');
      lines.push(...res.lines);
      // Player-applied debuffs weaken the ENEMY's offense (P1-6), never the
      // caster. Skipped if the strike already felled the target.
      if (sk.potency && battle.enemy.hp > 0) {
        buffs.enemyWeakenedPct = sk.potency;
        buffs.enemyWeakenTurns = sk.duration ?? 3;
        applyEffect(
          battle,
          'enemyWeaken',
          sk.id,
          sk.name,
          'enemy',
          `−${Math.round(sk.potency * 100)}% Offense`,
          sk.name,
          sk.duration ?? 3,
        );
        lines.push(`🩸 ${battle.enemy.name} is weakened by ${Math.round(sk.potency * 100)}%!`);
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
    if (p.battle) {
      p.battle.effects = p.battle.effects.filter((e) =>
        !(e.key === 'weaken' && e.side === 'player')
      );
    }
    lines.push(`🧴 ${itemDef.name} lifts sapped strength.`);
  }
  entry.qty--;
  if (entry.qty <= 0) p.inventory = p.inventory.filter((e) => e.id !== itemId);
  return [`You use ${itemDef.name}.`, ...lines];
}

/** #72: SPD's combat payoff — capped avoidance. Every class keeps a 2%
 * baseline; out-sprinting the foe adds up to 18 more points, and enemy SPD
 * pushes the odds back down. Damaging moves only: self-heals, enemy guard
 * stances, and zero-power status moves are never dodged — the policy is
 * structural (this roll lives only in the damaging branch of enemyAct) and
 * test-enforced. */
export function dodgeChance(playerSpd: number, enemySpd: number): number {
  return Math.min(0.2, Math.max(0.02, 0.02 + (playerSpd - enemySpd) * 0.002));
}

function enemyAct(
  p: PlayerState,
  battle: BattleState,
  def: EnemyDef,
  move: EnemyMove,
  rng: Rng,
): { lines: string[]; guardCast: boolean } {
  const lines: string[] = [];
  const buffs = battle.buffs;
  if (move.selfHealPct) {
    const heal = Math.floor(battle.enemy.maxHp * move.selfHealPct);
    battle.enemy.hp = Math.min(battle.enemy.maxHp, battle.enemy.hp + heal);
    lines.push(`💚 ${battle.enemy.name} uses ${move.name} and recovers ${heal} HP!`);
    return { lines, guardCast: false };
  }
  // Defensive moves actually defend (#25): they raise the enemy's own
  // mitigation for the next few rounds instead of swinging.
  if (move.guardPct) {
    battle.enemyGuardPct = move.guardPct;
    battle.enemyGuardTurns = move.guardTurns ?? 2;
    // Named guard stance on the ENEMY side of the effects row (#67); the
    // casting round doesn't consume one (#25), so expiry skips a decay.
    applyEffect(
      battle,
      'guard',
      `guard:${move.name}`,
      move.name,
      'enemy',
      `+${Math.round(move.guardPct * 100)}% DEF`,
      move.name,
      move.guardTurns ?? 2,
    );
    lines.push(`🛡️ ${battle.enemy.name} braces behind ${move.name}!`);
    return { lines, guardCast: true };
  }
  if (move.power <= 0) {
    // Zero-power status moves carry only their rider (#25) — no implicit
    // chip damage from the min-1 strike clamp below.
    lines.push(`🌀 ${battle.enemy.name} uses ${move.name}.`);
    if (move.weakenPct) lines.push(...sapPlayer(battle, move.name, move.weakenPct));
    return { lines, guardCast: false };
  }
  const s = statsOf(p);
  // SPD avoidance (#72): damaging moves can be slipped entirely. Player SPD
  // includes buffs (Smoke Step / Time Warp); enemy SPD pushes back. One
  // draw, before mitigation/variance — deterministic order.
  if (chance(rng, dodgeChance(effStat(s.spd, buffs.spdPct), def.spd))) {
    lines.push(`💨 ${battle.enemy.name} uses ${move.name} — you slip aside, untouched!`);
    return { lines, guardCast: false };
  }
  // Player-applied weaken (Venom Cut et al.) cuts ENEMY offense.
  const offense = (move.kind === 'phys' ? def.atk : def.mag) *
    (1 - buffs.enemyWeakenedPct);
  const guard = battle.guarding ? 0.5 : 1;
  const mitig = move.kind === 'phys'
    ? effStat(s.def, buffs.defPct) * 0.85
    : effStat(s.res, buffs.resPct) * 0.85;
  const raw = Math.max(1, (offense * move.power - mitig) * guard);
  const dmg = variance(rng, raw);
  p.hp = Math.max(0, p.hp - dmg);
  lines.push(`💥 ${battle.enemy.name} uses ${move.name} — ${dmg} damage to you!`);
  if (move.weakenPct) lines.push(...sapPlayer(battle, move.name, move.weakenPct));
  if (p.hp <= 0) lines.push(...onLethalHit(p, battle));
  return { lines, guardCast: false };
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
