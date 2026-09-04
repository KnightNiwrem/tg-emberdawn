/**
 * Mechanical summary renderer (#120): derives exact player-facing rules
 * text from structured EffectSpec data. The single source of mechanical
 * truth is the effect spec; this module only formats it. Canonical rules
 * vocabulary: Shield (the absorbable pool drained before HP), DEF/RES,
 * round (the duration/tick unit), action (one actor's opportunity to
 * act), and the beneficial/harmful effect categories. Names and flavor
 * are NOT inputs here — they may be nonliteral; this text may not.
 *
 * Pure content-shape formatting: no grammy, no state, deterministic.
 */

import type { EffectSpec, ItemDef } from '../content/types.ts';

/** Target-naming voice for one caster perspective. `poss` is possessive
 * ("your"), `subj` the subject pronoun/noun ("you"), `obj` the object
 * form ("you" / "the foe"). Skills default to you/the target; equipment
 * triggers pass the foe forms. */
export interface MechVoice {
  poss: string;
  subj: string;
  obj: string;
}

export const PLAYER_VOICE: MechVoice = { poss: 'your', subj: 'you', obj: 'you' };
export const TARGET_VOICE: MechVoice = {
  poss: "the target's",
  subj: 'the target',
  obj: 'the target',
};
export const FOE_VOICE: MechVoice = { poss: "the foe's", subj: 'the foe', obj: 'the foe' };

export interface MechOpts {
  /** Naming for self-referencing effects (default: you). */
  self?: MechVoice;
  /** Naming for opponent-referencing effects (default: the target). */
  opponent?: MechVoice;
}

const voice = (opts: MechOpts | undefined): { self: MechVoice; opponent: MechVoice } => ({
  self: opts?.self ?? PLAYER_VOICE,
  opponent: opts?.opponent ?? TARGET_VOICE,
});

const pct = (n: number): number => Math.round(n * 100);

const rounds = (n: number): string => (n === 1 ? '1 round' : `${n} rounds`);

/** Canonical display noun for an effect tag in rules text. */
function tagName(tag: string): string {
  switch (tag) {
    case 'harmful':
      return 'harmful';
    case 'beneficial':
      return 'beneficial';
    case 'poison':
      return 'Poison';
    case 'burn':
      return 'Burn';
    case 'bleed':
      return 'Bleed';
    case 'regen':
      return 'Regeneration';
    case 'slow':
      return 'Slow';
    case 'vulnerable':
      return 'Vulnerable';
    case 'mark':
      return 'Mark';
    case 'control':
      return 'control';
    case 'weaken':
      return 'weaken';
    case 'periodic':
      return 'periodic';
    case 'armor-break':
      return 'armor-break';
    case 'ward-break':
      return 'ward-break';
    default:
      return tag;
  }
}

/** Scope phrase and agreeing noun for cleanse/dispel rules text (#134):
 * a cap of 1 is singular ("up to 1 … effect"); "all removable" (and any
 * plural cap) takes "effects". */
function cleanseScope(max: number | undefined): { scope: string; noun: string } {
  if (max === undefined) return { scope: 'all removable ', noun: 'effects' };
  return { scope: `up to ${max} `, noun: max === 1 ? 'effect' : 'effects' };
}

function tagList(tags: readonly string[]): string {
  return tags.map(tagName).join(' or ');
}

/** Non-default same-source reapplication policy, stated in rules text. */
function stackingText(stacking: string | undefined): string | undefined {
  switch (stacking) {
    case 'refresh':
      return 'Recasts renew the duration.';
    case 'stack':
      return 'Applications stack.';
    case 'strongest':
      return 'Only the strongest application counts.';
    default:
      return undefined; // 'replace' is the unremarkable default
  }
}

/** Duration suffix shared by round-counted effects. */
function durationText(spec: { duration?: number; lifetime?: 'battle' }): string {
  return spec.lifetime === 'battle'
    ? 'for the rest of the battle'
    : `for ${rounds(spec.duration ?? 0)}`;
}

/** Rider conditions that gate an effect on the preceding strike. */
function riderConditions(spec: EffectSpec): string[] {
  const out: string[] = [];
  if ('requireSurvivor' in spec && spec.requireSurvivor) {
    out.push('Only if the target survives the strike.');
  }
  if ('requireHpDamage' in spec && spec.requireHpDamage) {
    out.push('Only if the strike deals HP damage.');
  }
  return out;
}

function statmodSentence(
  spec: Extract<EffectSpec, { kind: 'statmod' }>,
  voices: { self: MechVoice; opponent: MechVoice },
): string {
  const val = pct(Math.abs(spec.pct));
  const dur = durationText(spec);
  const toSelf = spec.target !== 'opponent';
  const v = toSelf ? voices.self : voices.opponent;
  const takes = v.subj === 'you' ? 'you take' : `${v.subj} takes`;
  const deals = v.subj === 'you' ? 'you deal' : `${v.subj} deals`;
  switch (spec.stat) {
    case 'incoming':
      // pct > 0 amplifies damage taken; < 0 reduces it.
      return spec.pct >= 0
        ? `Increases the damage ${takes} by ${val}% ${dur}.`
        : `Reduces the damage ${takes} by ${val}% ${dur}.`;
    case 'outgoing':
      return spec.pct >= 0
        ? `Increases the damage ${deals} by ${val}% ${dur}.`
        : `Reduces the damage ${deals} by ${val}% ${dur}.`;
    case 'mitigation':
      return `${
        spec.pct >= 0 ? 'Raises' : 'Lowers'
      } ${v.poss} damage mitigation by ${val}% ${dur}.`;
    default:
      return `${
        spec.pct >= 0 ? 'Raises' : 'Lowers'
      } ${v.poss} ${spec.stat.toUpperCase()} by ${val}% ${dur}.`;
  }
}

function shieldCapacity(spec: Extract<EffectSpec, { kind: 'shield' }>): string {
  const parts: string[] = [];
  if (spec.magPower !== undefined) parts.push(`${pct(spec.magPower * 2)}% MAG`);
  if (spec.defPower !== undefined) parts.push(`${pct(spec.defPower * 2)}% DEF`);
  const joined = parts.join(' + ');
  if (joined && spec.amount) return `${joined} + ${spec.amount}`;
  if (joined) return joined;
  return `${spec.amount ?? 0}`;
}

/** One sentence (or sentence group) per effect spec, in authored order. */
export function mechanicsLines(specs: readonly EffectSpec[], opts?: MechOpts): string[] {
  const voices = voice(opts);
  const out: string[] = [];
  for (const spec of specs) {
    const chance = 'chance' in spec && spec.chance !== undefined
      ? `${pct(spec.chance)}% chance: `
      : '';
    const stacking = stackingText(spec.stacking);
    const lines: string[] = [];
    switch (spec.kind) {
      case 'damage': {
        let s = `Deals ${pct(spec.power)}% ${spec.attack === 'phys' ? 'ATK' : 'MAG'} damage`;
        if (spec.execute) {
          s += ` (+${pct(spec.execute.bonusPct)}% against targets below ${
            pct(spec.execute.belowPct)
          }% HP)`;
        }
        s += '.';
        lines.push(s);
        if (spec.bypassShield) lines.push('Ignores Shield.');
        break;
      }
      case 'restore': {
        if (spec.hpFull) lines.push('Fully restores HP.');
        else if (spec.hpPower !== undefined) {
          lines.push(`Restores ${pct(spec.hpPower * 2)}% of MAG + ${spec.hpFlat ?? 0} HP.`);
        } else if (spec.hpPctOfMax !== undefined) {
          lines.push(`Restores ${pct(spec.hpPctOfMax)}% of max HP.`);
        }
        if (spec.mpPctOfMax !== undefined) {
          lines.push(`Restores ${pct(spec.mpPctOfMax)}% of max MP.`);
        }
        break;
      }
      case 'lifesteal':
        lines.push(`Restores ${pct(spec.pct)}% of the damage dealt as HP.`);
        break;
      case 'statmod':
        lines.push(chance + statmodSentence(spec, voices));
        break;
      case 'control': {
        const acts = spec.actions ?? 1;
        const loss = acts === 1 ? 'its next action' : `its next ${acts} actions`;
        lines.push(
          (spec.chance !== undefined ? `${pct(spec.chance)}% chance to stun` : 'Stuns') +
            ` the target: it loses ${loss}.`,
        );
        break;
      }
      case 'periodic': {
        const phase = spec.tickPhase === 'playerTurnStart'
          ? 'at the start of its turn'
          : 'at the end of each round';
        const dur = `for ${rounds(spec.duration)}`;
        if ((spec.perRound ?? 0) < 0 || (spec.pctOfMaxPerRound ?? 0) < 0) {
          const amount = spec.perRound !== undefined
            ? `${Math.abs(spec.perRound)} damage`
            : `${pct(Math.abs(spec.pctOfMaxPerRound ?? 0))}% of max HP damage`;
          lines.push(chance + `Inflicts ${spec.name}: ${amount} ${phase} ${dur}.`);
          if (spec.bypassShield) lines.push(`${spec.name} ignores Shield.`);
        } else {
          const amount = spec.perRound !== undefined
            ? `${spec.perRound} HP`
            : `${pct(spec.pctOfMaxPerRound ?? 0)}% of max HP`;
          lines.push(chance + `Restores ${amount} ${phase} ${dur}.`);
        }
        break;
      }
      case 'cleanse': {
        const s = cleanseScope(spec.max);
        lines.push(chance + `Removes ${s.scope}${tagList(spec.tags)} ${s.noun}.`);
        break;
      }
      case 'dispel': {
        const s = cleanseScope(spec.max);
        lines.push(
          chance +
            `Removes ${s.scope}${tagList(spec.tags)} ${s.noun} from ${
              spec.target === 'opponent' ? voices.opponent.obj : voices.self.obj
            }.`,
        );
        break;
      }
      case 'resource':
        if (spec.mpPctOfMax !== undefined) {
          lines.push(chance + `Restores ${pct(spec.mpPctOfMax)}% of max MP.`);
        }
        break;
      case 'shield': {
        const onTarget = spec.target === 'opponent' ? ` (on ${voices.opponent.obj})` : '';
        lines.push(
          chance +
            `Grants Shield equal to ${shieldCapacity(spec)} ${durationText(spec)}${onTarget}.`,
        );
        break;
      }
    }
    if (stacking) lines.push(stacking);
    lines.push(...riderConditions(spec));
    out.push(...lines);
  }
  return out;
}

/** The full mechanical summary as one text block (sentences joined). */
export function mechanicsText(specs: readonly EffectSpec[], opts?: MechOpts): string {
  return mechanicsLines(specs, opts).join(' ');
}

/** Mechanical disclosure for a consumable's bag effect (#98): derived
 * from the effect fields — never re-typed by content. */
export function consumableEffectLines(effect: NonNullable<ItemDef['effect']>): string[] {
  const lines: string[] = [];
  if (effect.healHp) lines.push(`Restores ${effect.healHp} HP.`);
  if (effect.healMp) lines.push(`Restores ${effect.healMp} MP.`);
  if (effect.cureStatus) lines.push('Removes all removable harmful effects.');
  if (effect.revivePct) lines.push(`Auto-revives you at ${effect.revivePct}% HP when felled.`);
  if (effect.flee) lines.push('Guaranteed escape from normal fights.');
  return lines;
}
