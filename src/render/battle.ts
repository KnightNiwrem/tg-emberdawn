/** Battle screen renderer: labelled combatant sections, structured effects,
 * round history, action buttons (#67). Effect rows are DERIVED from the live
 * mechanical instances (#78) — there is no second presentational state to
 * drift during cleanse/expiry. */

import type { InputRichBlock, InputRichMessage, RichText } from 'grammy/types';
import type { BattleState, EffectInstance, PlayerState } from '../engine/types.ts';
import type { StatKey } from '../content/types.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { item } from '../content/items.ts';
import { CLASSES } from '../engine/classes.ts';
import { statsOf } from '../engine/character.ts';
import { consumables } from '../engine/inventory.ts';
import { hasRemovableTagged, maxShield } from '../engine/effects.ts';
import { skillsForClass } from '../content/skills.ts';
import { mechanicsText } from '../engine/mechanics.ts';
import { bar, buttonsRow, cbBtn, disabledBtn, heading, para } from './rich.ts';
import { encodeCb } from '../codec.ts';
import { noticesBlocks } from './parts.ts';

/** Glyph per effect shape — buffs glow, saps bleed, guards brace, stuns
 * daze, periodic effects drip. */
function effectEmoji(i: EffectInstance): string {
  switch (i.kind) {
    case 'control':
      return '💫';
    case 'periodic':
      return (i.perRound ?? 0) < 0 || (i.pctOfMaxPerRound ?? 0) < 0 ? '🩸' : '💚';
    case 'shield':
      return '🛡️';
    case 'statmod':
      if (i.stat === 'mitigation') return '🛡️';
      if (i.stat === 'outgoing' && (i.pct ?? 0) < 0) return '🩸';
      return '🔆';
  }
}

function statLabel(stat: StatKey): string {
  switch (stat) {
    case 'outgoing':
      return 'Offense';
    case 'incoming':
      return 'damage taken';
    case 'mitigation':
      return 'mitigation';
    default:
      return stat.toUpperCase();
  }
}

/** Human magnitude derived from the instance's own mechanical data. */
function describeMagnitude(i: EffectInstance): string {
  switch (i.kind) {
    case 'statmod': {
      const pct = Math.round((i.pct ?? 0) * 100);
      return `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}% ${statLabel(i.stat!)}`;
    }
    case 'control':
      return i.control === 'stun' ? 'loses next action' : 'restricted';
    case 'periodic': {
      const per = i.perRound ?? Math.round((i.pctOfMaxPerRound ?? 0) * 100);
      const unit = i.pctOfMaxPerRound !== undefined ? '% HP/round' : ' HP/round';
      // Generated mechanical disclosure (#134): a Shield-bypassing DoT
      // states so in the row, from the instance's own data — never from
      // authored narration.
      return `${per >= 0 ? '+' : '−'}${Math.abs(per)}${unit}${
        i.bypassShield ? ', ignores Shield' : ''
      }`;
    }
    case 'shield':
      return `${i.shieldAmount ?? 0} absorb`;
  }
}

/** Earlier rounds shown inside the collapsed history block; anything older
 * is omitted WITH an explicit disclosure (#67) — never truncated silently. */
const MAX_SHOWN_EARLIER_ROUNDS = 10;

function turnsLabel(n: number): string {
  return `${n} round${n === 1 ? '' : 's'}`;
}

interface EffectGroup {
  defId: string;
  name: string;
  emoji: string;
  /** Magnitudes of every live instance this identity covers, e.g.
   * Blessing's MAG and DEF legs. */
  magnitudes: string[];
  minTurns: number;
  maxTurns: number;
  expiresRound: number;
  source: string;
  /** Any member lasts the whole battle (#80) — never shows a countdown. */
  battleLifetime: boolean;
}

/** Groups one combatant's live effect instances by identity (#78),
 * application order preserved. Expired instances are skipped — the engine
 * prunes each round, this is a belt-and-braces filter. */
function effectGroups(b: BattleState, side: 'player' | 'enemy'): EffectGroup[] {
  const groups: EffectGroup[] = [];
  for (const i of b.effectInstances) {
    if (i.side !== side) continue;
    const turns = i.kind === 'control' ? Math.max(1, i.actions ?? 1) : i.remaining;
    if (turns <= 0) continue;
    const g = groups.find((x) => x.defId === i.defId);
    if (g) {
      g.magnitudes.push(describeMagnitude(i));
      g.minTurns = Math.min(g.minTurns, turns);
      g.maxTurns = Math.max(g.maxTurns, turns);
      g.expiresRound = Math.max(g.expiresRound, i.expiresRound);
      g.battleLifetime = g.battleLifetime || i.battleLifetime === true;
    } else {
      groups.push({
        defId: i.defId,
        name: i.name,
        emoji: effectEmoji(i),
        magnitudes: [describeMagnitude(i)],
        minTurns: turns,
        maxTurns: turns,
        expiresRound: i.expiresRound,
        source: i.source.name,
        battleLifetime: i.battleLifetime === true,
      });
    }
  }
  return groups;
}

function turnsRangeLabel(g: EffectGroup): string {
  if (g.battleLifetime) return 'whole battle';
  return g.minTurns === g.maxTurns ? turnsLabel(g.minTurns) : `${g.minTurns}–${g.maxTurns} rounds`;
}

/** One combatant's stable effects area (#67/#78): `Effects: none`, or a
 * native details block — expandable in the client, no bot callback — whose
 * summary names the active effects and whose body explains source, numerical
 * effect, target, remaining duration and when each expires. Everything is
 * derived from the live mechanical instances. */
function effectsBlocks(b: BattleState, side: 'player' | 'enemy'): InputRichBlock[] {
  const groups = effectGroups(b, side);
  if (groups.length === 0) return [para('Effects: none')];
  const target = side === 'player' ? 'You' : b.enemy.name;
  const summary = `Effects: ${
    groups
      .map((g) => `${g.emoji} ${g.name} · ${turnsRangeLabel(g)}`)
      .join(', ')
  }`;
  return [{
    type: 'details',
    summary,
    blocks: groups.map((g) =>
      para(
        `${g.emoji} ${g.name} — ${g.magnitudes.join(' · ')} (${g.source}). ${target} · ` +
          (g.battleLifetime
            ? 'lasts the whole battle.'
            : `${turnsLabel(g.maxTurns)} remaining · fades end of round ${g.expiresRound}.`),
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
    // Resolved opening (#80): expanded on the untouched round-1 screen,
    // collapsed (but always available) once rounds exist. Never faked as a
    // completed combat round — its own structured panel.
    if (b.opening?.lines.length) {
      blocks.push({
        type: 'details',
        summary: '⚔️ Battle opening',
        // is_open is true-only: expanded on the untouched round-1 screen,
        // omitted (collapsed default) once rounds exist.
        ...(b.history.length === 0 ? { is_open: true as const } : {}),
        blocks: b.opening.lines.map((line) => para(line)),
      });
    }
    // ENEMY section — labelled, with value and bar on separate lines (#67).
    blocks.push(para(bold('ENEMY')));
    blocks.push(para(
      `${eDef?.emoji ?? '❔'} ${b.enemy.name} · Lv ${eDef?.level ?? '?'}${
        b.enemy.isBoss ? ' 👑 BOSS' : ''
      }`,
    ));
    blocks.push(para(`❤️ ${b.enemy.hp}/${b.enemy.maxHp}`));
    blocks.push(para(bar(b.enemy.hp, b.enemy.maxHp)));
    const eShieldMax = maxShield(b, 'enemy');
    if (eShieldMax > 0) {
      blocks.push(para(
        `🛡️ Shield ${b.shield.enemy}/${eShieldMax}${b.shield.enemy === 0 ? ' (depleted)' : ''}`,
      ));
      blocks.push(para(bar(b.shield.enemy, eShieldMax)));
    }
    blocks.push(...effectsBlocks(b, 'enemy'));
    blocks.push({ type: 'divider' });
    // YOU section — never visually continuous with the enemy's bars (#67).
    const cls = CLASSES[p.classId];
    blocks.push(para(bold(`YOU · ${cls.emoji} ${cls.name} Lv ${p.level}`)));
    blocks.push(para(`❤️ ${p.hp}/${s.maxHp}`));
    blocks.push(para(bar(p.hp, s.maxHp)));
    blocks.push(para(`💧 ${p.mp}/${s.maxMp}`));
    blocks.push(para(bar(p.mp, s.maxMp)));
    const pShieldMax = maxShield(b, 'player');
    if (pShieldMax > 0) {
      blocks.push(para(
        `🛡️ Shield ${b.shield.player}/${pShieldMax}${b.shield.player === 0 ? ' (depleted)' : ''}`,
      ));
      blocks.push(para(bar(b.shield.player, pShieldMax)));
    }
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
  // Pre-emptive skills (#80) fire in the opening phase — not castable, so
  // they never appear in the battle skill menu.
  const usable = all.filter((sk) => learned.has(sk.id) && !sk.preEmptive);
  for (const sk of usable) {
    const cd = b.cooldowns[sk.id] ?? 0;
    const ready = cd === 0 && p.mp >= sk.mpCost; // invalid taps never cost a turn
    const label = `${sk.name} — ${sk.mpCost} MP${cd > 0 ? ` (CD ${cd})` : ''}`;
    // #120: the in-battle picker shows the GENERATED mechanical block —
    // exact rules only; flavor stays on the Skills screen.
    blocks.push(para(mechanicsText(sk.effects)));
    blocks.push(
      buttonsRow([
        ready ? cbBtn(label, encodeCb({ v: 'battle', a: 'use', arg: sk.id })) : disabledBtn(label),
      ], 'left'),
    );
  }
  // Pre-emptive skills (#80/#81) never render as cast buttons — labeled
  // info rows only, so the activation type is explicit.
  for (const sk of all) {
    if (!learned.has(sk.id) || !sk.preEmptive) continue;
    blocks.push(para([{
      type: 'italic',
      text: `⚡ ${sk.name} — automatic at battle open (once per battle; no MP or cooldown). ${
        mechanicsText(sk.effects)
      }`,
    } as RichText]));
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
  // disabled instead of promising an action the engine must refuse.
  const applicable = (id: string): boolean => {
    const eff = item(id)?.effect;
    if (!eff) return true;
    if (eff.flee) return !b.enemy.isBoss; // Smoke Bomb never touches bosses
    // Real tagged cleanse (#78): usable when any removable harmful effect
    // is live (today: the sapped-strength family).
    if (eff.cureStatus && !eff.healHp && !eff.healMp) {
      return hasRemovableTagged(b, 'player', ['harmful']);
    }
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
