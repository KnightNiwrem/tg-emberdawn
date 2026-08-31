/** Battle screen renderer: labelled combatant sections, structured effects,
 * round history, action buttons (#67). */

import type { InputRichBlock, InputRichMessage, RichText } from 'grammy/types';
import type { ActiveEffect, BattleState, PlayerState } from '../engine/types.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { item } from '../content/items.ts';
import { CLASSES } from '../engine/classes.ts';
import { statsOf } from '../engine/character.ts';
import { consumables } from '../engine/inventory.ts';
import { skillsForClass } from '../content/skills.ts';
import { bar, buttonsRow, cbBtn, disabledBtn, heading, para } from './rich.ts';
import { encodeCb } from '../codec.ts';
import { noticesBlocks } from './parts.ts';

/** Glyph per effect slot — buffs glow, saps bleed, guards brace, stuns daze. */
const EFFECT_EMOJI: Record<string, string> = {
  atk: '🔆',
  def: '🔆',
  res: '🔆',
  mag: '🔆',
  spd: '🔆',
  weaken: '🩸',
  enemyWeaken: '🩸',
  guard: '🛡️',
  enemyStun: '💫',
};

/** Earlier rounds shown inside the collapsed history block; anything older
 * is omitted WITH an explicit disclosure (#67) — never truncated silently. */
const MAX_SHOWN_EARLIER_ROUNDS = 10;

function turnsLabel(n: number): string {
  return `${n} round${n === 1 ? '' : 's'}`;
}

interface EffectGroup {
  effect: ActiveEffect;
  /** Magnitudes of every live slot this identity covers, e.g. Blessing's
   * ATK and DEF legs. */
  magnitudes: string[];
  minTurns: number;
  maxTurns: number;
  expiresRound: number;
}

/** Groups one combatant's live effects by identity (#67), application order
 * preserved. Entries whose mechanical slot already expired are skipped —
 * the engine prunes each round, this is a belt-and-braces filter. */
function effectGroups(b: BattleState, side: 'player' | 'enemy'): EffectGroup[] {
  const groups: EffectGroup[] = [];
  for (const e of b.effects) {
    if (e.side !== side) continue;
    const turns = e.expiresRound - b.round + 1;
    if (turns <= 0) continue;
    const g = groups.find((x) => x.effect.id === e.id);
    if (g) {
      g.magnitudes.push(e.magnitude);
      g.minTurns = Math.min(g.minTurns, turns);
      g.maxTurns = Math.max(g.maxTurns, turns);
      g.expiresRound = Math.max(g.expiresRound, e.expiresRound);
    } else {
      groups.push({
        effect: e,
        magnitudes: [e.magnitude],
        minTurns: turns,
        maxTurns: turns,
        expiresRound: e.expiresRound,
      });
    }
  }
  return groups;
}

function turnsRangeLabel(g: EffectGroup): string {
  return g.minTurns === g.maxTurns ? turnsLabel(g.minTurns) : `${g.minTurns}–${g.maxTurns} rounds`;
}

/** One combatant's stable effects area (#67): `Effects: none`, or a native
 * details block — expandable in the client, no bot callback — whose summary
 * names the active effects and whose body explains source, numerical
 * effect, target, remaining duration and when each expires. */
function effectsBlocks(b: BattleState, side: 'player' | 'enemy'): InputRichBlock[] {
  const groups = effectGroups(b, side);
  if (groups.length === 0) return [para('Effects: none')];
  const target = side === 'player' ? 'You' : b.enemy.name;
  const summary = `Effects: ${
    groups
      .map((g) => `${EFFECT_EMOJI[g.effect.key] ?? '✨'} ${g.effect.name} · ${turnsRangeLabel(g)}`)
      .join(', ')
  }`;
  return [{
    type: 'details',
    summary,
    blocks: groups.map((g) =>
      para(
        `${EFFECT_EMOJI[g.effect.key] ?? '✨'} ${g.effect.name} — ${g.magnitudes.join(' · ')}` +
          ` (${g.effect.source}). ${target} · ${turnsLabel(g.maxTurns)} remaining` +
          ` · fades end of round ${g.expiresRound}.`,
      )
    ),
  }];
}

function bold(text: string): RichText {
  return { type: 'bold', text };
}

/** A titled quote panel: the round-recap container (#67). */
function roundPanel(title: string, lines: string[]): InputRichBlock {
  return {
    type: 'blockquote',
    blocks: [
      { type: 'paragraph', text: bold(title) },
      ...lines.map((l) => ({ type: 'paragraph', text: l } as const)),
    ],
  };
}

/** The single expanded panel of an active battle (#67): the most recently
 * completed round. While round 1 is untouched there IS no completed round —
 * the opening prompt carries the encounter introduction (which lives in the
 * notices, exactly once — never as accumulated history). */
function activeRecapBlock(p: PlayerState, b: BattleState): InputRichBlock {
  const latest = b.history[b.history.length - 1];
  if (latest) return roundPanel(`Round ${latest.round} result`, latest.lines);
  return roundPanel('Your move', p.notices.slice(-8));
}

/** Collapsed earlier history (#67): complete rounds, oldest-to-newest, with
 * an explicit omission disclosure when the display cap cuts in. */
function earlierHistoryBlocks(b: BattleState): InputRichBlock[] {
  const earlier = b.history.slice(0, -1);
  if (earlier.length === 0) return [];
  const shown = earlier.slice(-MAX_SHOWN_EARLIER_ROUNDS);
  const omitted = earlier.length - shown.length;
  const blocks: InputRichBlock[] = [];
  if (omitted > 0) {
    blocks.push(para(`… ${omitted} earlier round${omitted === 1 ? '' : 's'} omitted.`));
  }
  for (const r of shown) {
    blocks.push(roundPanel(`Round ${r.round}`, r.lines));
  }
  return [{ type: 'details', summary: 'Earlier battle history', blocks }];
}

export function renderBattle(p: PlayerState): InputRichMessage {
  const b = p.battle!;
  const s = statsOf(p);
  const eDef = enemyDef(b.enemy.id);
  const blocks: InputRichBlock[] = [];

  if (b.phase === 'active') {
    // Round 1 is ALWAYS visible (#67) — the label no longer waits for the
    // first completed round.
    blocks.push(heading(`⚔️ Battle · Round ${b.round}`, 4));
    // Notices render as a banner only once rounds exist; on an untouched
    // battle they ARE the opening prompt's content (shown exactly once).
    if (b.history.length > 0) blocks.push(...noticesBlocks(p));
    // ENEMY section — labelled, with value and bar on separate lines (#67).
    blocks.push(para(bold('ENEMY')));
    blocks.push(para(
      `${eDef?.emoji ?? '❔'} ${b.enemy.name} · Lv ${eDef?.level ?? '?'}${
        b.enemy.isBoss ? ' 👑 BOSS' : ''
      }`,
    ));
    blocks.push(para(`❤️ ${b.enemy.hp}/${b.enemy.maxHp}`));
    blocks.push(para(bar(b.enemy.hp, b.enemy.maxHp)));
    blocks.push(...effectsBlocks(b, 'enemy'));
    blocks.push({ type: 'divider' });
    // YOU section — never visually continuous with the enemy's bars (#67).
    const cls = CLASSES[p.classId];
    blocks.push(para(bold(`YOU · ${cls.emoji} ${cls.name} Lv ${p.level}`)));
    blocks.push(para(`❤️ ${p.hp}/${s.maxHp}`));
    blocks.push(para(bar(p.hp, s.maxHp)));
    blocks.push(para(`💧 ${p.mp}/${s.maxMp}`));
    blocks.push(para(bar(p.mp, s.maxMp)));
    if (b.guarding) blocks.push(para('🛡️ Guarding'));
    blocks.push(...effectsBlocks(b, 'player'));
    // Latest completed round expanded; everything older collapsed (#67).
    blocks.push(activeRecapBlock(p, b));
    blocks.push(...earlierHistoryBlocks(b));
    blocks.push(buttonsRow([
      cbBtn(
        `${cls.basicAction.icon} ${cls.basicAction.name}`,
        encodeCb({ v: 'battle', a: 'atk' }),
        'primary',
      ),
      cbBtn('🛡️ Guard', encodeCb({ v: 'battle', a: 'gd' })),
      cbBtn('🏃 Flee', encodeCb({ v: 'battle', a: 'fl' })),
    ]));
    blocks.push(buttonsRow([
      cbBtn('✨ Skills', encodeCb({ v: 'battle', a: 'sk' }), 'primary'),
      cbBtn('🎒 Items', encodeCb({ v: 'battle', a: 'it' })),
    ]));
    return { blocks };
  }

  // Battle over — victory orders recap → outcome → Spoils → history (#67).
  const won = b.phase === 'won';
  blocks.push(
    heading(
      won ? `🏆 Victory · ${turnsLabel(b.round)}` : b.phase === 'fled' ? '🏃 Escaped' : '💀 Defeat',
      3,
    ),
  );
  // The terminal round is regular history (#67): recap the kill round like
  // any other round, then the resolution outcome, then ONE authoritative
  // Spoils presentation — never the same XP/gold twice.
  const latest = b.history[b.history.length - 1];
  if (latest) blocks.push(roundPanel(`Round ${latest.round} result`, latest.lines));
  blocks.push(...noticesBlocks(p));
  if (won && b.rewards) {
    // One authoritative reward outcome (#40): conversion is what the
    // engine actually granted, stamped pre-grant — never re-inferred from
    // the player's (possibly just-leveled) current level.
    blocks.push(para(
      b.rewards.xpConvertedGold !== undefined
        ? `🎁 Spoils: ✨ ${b.rewards.xp} XP → +${b.rewards.xpConvertedGold} gold · 💰 ${b.rewards.gold} gold`
        : `🎁 Spoils: ✨ ${b.rewards.xp} XP · 💰 ${b.rewards.gold} gold`,
    ));
  }
  blocks.push(...earlierHistoryBlocks(b));
  blocks.push(buttonsRow([cbBtn('➡️ Continue', encodeCb({ v: 'battle', a: 'go' }), 'success')]));
  return { blocks };
}

export function renderSkillMenu(p: PlayerState): InputRichMessage {
  const b = p.battle!;
  const learned = new Set(p.skills);
  const all = skillsForClass(p.classId, 999);
  const blocks: InputRichBlock[] = [
    heading('✨ Skills', 4),
    para(`💧 MP ${p.mp}/${statsOf(p).maxMp}`),
  ];
  const usable = all.filter((sk) => learned.has(sk.id));
  for (const sk of usable) {
    const cd = b.cooldowns[sk.id] ?? 0;
    const ready = cd === 0 && p.mp >= sk.mpCost; // invalid taps never cost a turn
    const label = `${sk.name} — ${sk.mpCost} MP${cd > 0 ? ` (CD ${cd})` : ''}`;
    blocks.push(para([{ type: 'italic', text: sk.desc } as RichText]));
    blocks.push(
      buttonsRow([
        ready ? cbBtn(label, encodeCb({ v: 'battle', a: 'use', arg: sk.id })) : disabledBtn(label),
      ], 'left'),
    );
  }
  if (usable.length === 0) {
    blocks.push(para('No skills learned yet — level up!'));
  }
  blocks.push(
    buttonsRow([cbBtn('⬅️ Back to battle', encodeCb({ v: 'battle', a: 'go' }), 'danger')]),
  );
  return { blocks };
}

export function renderItemMenu(p: PlayerState): InputRichMessage {
  const b = p.battle!;
  // Auto-trigger items (Phoenix Cinder) are never manually usable.
  const manual = (id: string): boolean => {
    const eff = item(id)?.effect;
    if (!eff) return true;
    return Boolean(eff.healHp || eff.healMp || eff.cureStatus || eff.flee);
  };
  // Context checks (#35): a button that cannot do anything renders
  // disabled instead of promising an action the handler must refuse.
  const applicable = (id: string): boolean => {
    const eff = item(id)?.effect;
    if (!eff) return true;
    if (eff.flee) return !b.enemy.isBoss; // Smoke Bomb never touches bosses
    if (eff.cureStatus && !eff.healHp && !eff.healMp) return b.buffs.weakenTurns > 0;
    return true;
  };
  const items = consumables(p).filter((e) => manual(e.id));
  const blocks: InputRichBlock[] = [heading('🎒 Battle items', 4)];
  if (!items.some((e) => applicable(e.id))) {
    blocks.push(para(
      items.length > 0
        ? 'Nothing in your bag helps right now.'
        : 'Your bag is empty of usable items.',
    ));
  }
  for (const entry of items) {
    const def = item(entry.id)!;
    const ok = applicable(def.id);
    blocks.push(para(`${def.name} ×${entry.qty}`));
    blocks.push(
      buttonsRow([
        ok
          ? cbBtn(`Use ${def.name}`, encodeCb({ v: 'battle', a: 'use', arg: def.id }), 'success')
          : disabledBtn(`${def.name} — no use here`),
      ], 'left'),
    );
  }
  blocks.push(
    buttonsRow([cbBtn('⬅️ Back to battle', encodeCb({ v: 'battle', a: 'go' }), 'danger')]),
  );
  return { blocks };
}
