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
function effectEmoji(instance: EffectInstance): string {
  switch (instance.kind) {
    case 'control':
      return '💫';
    case 'periodic':
      return (instance.perRound ?? 0) < 0 || (instance.pctOfMaxPerRound ?? 0) < 0 ? '🩸' : '💚';
    case 'shield':
      return '🛡️';
    case 'statmod':
      if (instance.stat === 'mitigation') return '🛡️';
      if (instance.stat === 'outgoing' && (instance.pct ?? 0) < 0) return '🩸';
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
function describeMagnitude(instance: EffectInstance): string {
  switch (instance.kind) {
    case 'statmod': {
      const pct = Math.round((instance.pct ?? 0) * 100);
      return `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}% ${statLabel(instance.stat!)}`;
    }
    case 'control':
      return instance.control === 'stun' ? 'loses next action' : 'restricted';
    case 'periodic': {
      const per = instance.perRound ?? Math.round((instance.pctOfMaxPerRound ?? 0) * 100);
      const unit = instance.pctOfMaxPerRound !== undefined ? '% HP/round' : ' HP/round';
      // Generated mechanical disclosure (#134): a Shield-bypassing DoT
      // states so in the row, from the instance's own data — never from
      // authored narration.
      return `${per >= 0 ? '+' : '−'}${Math.abs(per)}${unit}${
        instance.bypassShield ? ', ignores Shield' : ''
      }`;
    }
    case 'shield':
      return `${instance.shieldAmount ?? 0} absorb`;
  }
}

/** Earlier rounds shown inside the collapsed history block; anything older
 * is omitted WITH an explicit disclosure (#67) — never truncated silently. */
const MAX_SHOWN_EARLIER_ROUNDS = 10;

function turnsLabel(roundsCount: number): string {
  return `${roundsCount} round${roundsCount === 1 ? '' : 's'}`;
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
function effectGroups(battle: BattleState, side: 'player' | 'enemy'): EffectGroup[] {
  const groups: EffectGroup[] = [];
  for (const instance of battle.effectInstances) {
    if (instance.side !== side) continue;
    const turns = instance.kind === 'control'
      ? Math.max(1, instance.actions ?? 1)
      : instance.remaining;
    if (turns <= 0) continue;
    const existingGroup = groups.find((grp) => grp.defId === instance.defId);
    if (existingGroup) {
      existingGroup.magnitudes.push(describeMagnitude(instance));
      existingGroup.minTurns = Math.min(existingGroup.minTurns, turns);
      existingGroup.maxTurns = Math.max(existingGroup.maxTurns, turns);
      existingGroup.expiresRound = Math.max(existingGroup.expiresRound, instance.expiresRound);
      existingGroup.battleLifetime = existingGroup.battleLifetime ||
        instance.battleLifetime === true;
    } else {
      groups.push({
        defId: instance.defId,
        name: instance.name,
        emoji: effectEmoji(instance),
        magnitudes: [describeMagnitude(instance)],
        minTurns: turns,
        maxTurns: turns,
        expiresRound: instance.expiresRound,
        source: instance.source.name,
        battleLifetime: instance.battleLifetime === true,
      });
    }
  }
  return groups;
}

function turnsRangeLabel(group: EffectGroup): string {
  if (group.battleLifetime) return 'whole battle';
  return group.minTurns === group.maxTurns
    ? turnsLabel(group.minTurns)
    : `${group.minTurns}–${group.maxTurns} rounds`;
}

/** One combatant's stable effects area (#67/#78): `Effects: none`, or a
 * native details block — expandable in the client, no bot callback — whose
 * summary names the active effects and whose body explains source, numerical
 * effect, target, remaining duration and when each expires. Everything is
 * derived from the live mechanical instances. */
function effectsBlocks(battle: BattleState, side: 'player' | 'enemy'): InputRichBlock[] {
  const groups = effectGroups(battle, side);
  if (groups.length === 0) return [para('Effects: none')];
  const target = side === 'player' ? 'You' : battle.enemy.name;
  const summary = `Effects: ${
    groups
      .map((group) => `${group.emoji} ${group.name} · ${turnsRangeLabel(group)}`)
      .join(', ')
  }`;
  return [{
    type: 'details',
    summary,
    blocks: groups.map((group) =>
      para(
        `${group.emoji} ${group.name} — ${
          group.magnitudes.join(' · ')
        } (${group.source}). ${target} · ` +
          (group.battleLifetime
            ? 'lasts the whole battle.'
            : `${
              turnsLabel(group.maxTurns)
            } remaining · fades end of round ${group.expiresRound}.`),
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
      ...lines.map((line) => ({ type: 'paragraph', text: line } as const)),
    ],
  };
}

/** The single expanded panel of an active battle (#67): the most recently
 * completed round. While round 1 is untouched there IS no completed round —
 * the opening prompt carries the encounter introduction (which lives in the
 * notices, exactly once — never as accumulated history). */
function activeRecapBlock(player: PlayerState, battle: BattleState): InputRichBlock {
  const latest = battle.history[battle.history.length - 1];
  if (latest) return roundPanel(`Round ${latest.round} result`, latest.lines);
  return roundPanel('Your move', player.notices.slice(-8));
}

/** Collapsed earlier history (#67): complete rounds, oldest-to-newest, with
 * an explicit omission disclosure when the display cap cuts in. */
function earlierHistoryBlocks(battle: BattleState): InputRichBlock[] {
  const earlier = battle.history.slice(0, -1);
  if (earlier.length === 0) return [];
  const shown = earlier.slice(-MAX_SHOWN_EARLIER_ROUNDS);
  const omitted = earlier.length - shown.length;
  const blocks: InputRichBlock[] = [];
  if (omitted > 0) {
    blocks.push(para(`… ${omitted} earlier round${omitted === 1 ? '' : 's'} omitted.`));
  }
  for (const round of shown) {
    blocks.push(roundPanel(`Round ${round.round}`, round.lines));
  }
  return [{ type: 'details', summary: 'Earlier battle history', blocks }];
}

export function renderBattle(player: PlayerState): InputRichMessage {
  const battle = player.battle!;
  const stats = statsOf(player);
  const enemyDefinition = enemyDef(battle.enemy.id);
  const blocks: InputRichBlock[] = [];

  if (battle.phase === 'active') {
    // Round 1 is ALWAYS visible (#67) — the label no longer waits for the
    // first completed round.
    blocks.push(heading(`⚔️ Battle · Round ${battle.round}`, 4));
    // Notices render as a banner only once rounds exist; on an untouched
    // battle they ARE the opening prompt's content (shown exactly once).
    if (battle.history.length > 0) blocks.push(...noticesBlocks(player));
    // Resolved opening (#80): expanded on the untouched round-1 screen,
    // collapsed (but always available) once rounds exist. Never faked as a
    // completed combat round — its own structured panel.
    if (battle.opening?.lines.length) {
      blocks.push({
        type: 'details',
        summary: '⚔️ Battle opening',
        // is_open is true-only: expanded on the untouched round-1 screen,
        // omitted (collapsed default) once rounds exist.
        ...(battle.history.length === 0 ? { is_open: true as const } : {}),
        blocks: battle.opening.lines.map((line) => para(line)),
      });
    }
    // ENEMY section — labelled, with value and bar on separate lines (#67).
    blocks.push(para(bold('ENEMY')));
    blocks.push(para(
      `${enemyDefinition?.emoji ?? '❔'} ${battle.enemy.name} · Lv ${
        enemyDefinition?.level ?? '?'
      }${battle.enemy.isBoss ? ' 👑 BOSS' : ''}`,
    ));
    blocks.push(para(`❤️ ${battle.enemy.hp}/${battle.enemy.maxHp}`));
    blocks.push(para(bar(battle.enemy.hp, battle.enemy.maxHp)));
    const enemyShieldMax = maxShield(battle, 'enemy');
    if (enemyShieldMax > 0) {
      blocks.push(para(
        `🛡️ Shield ${battle.shield.enemy}/${enemyShieldMax}${
          battle.shield.enemy === 0 ? ' (depleted)' : ''
        }`,
      ));
      blocks.push(para(bar(battle.shield.enemy, enemyShieldMax)));
    }
    blocks.push(...effectsBlocks(battle, 'enemy'));
    blocks.push({ type: 'divider' });
    // YOU section — never visually continuous with the enemy's bars (#67).
    const classDef = CLASSES[player.classId];
    blocks.push(para(bold(`YOU · ${classDef.emoji} ${classDef.name} Lv ${player.level}`)));
    blocks.push(para(`❤️ ${player.hp}/${stats.maxHp}`));
    blocks.push(para(bar(player.hp, stats.maxHp)));
    blocks.push(para(`💧 ${player.mp}/${stats.maxMp}`));
    blocks.push(para(bar(player.mp, stats.maxMp)));
    const playerShieldMax = maxShield(battle, 'player');
    if (playerShieldMax > 0) {
      blocks.push(para(
        `🛡️ Shield ${battle.shield.player}/${playerShieldMax}${
          battle.shield.player === 0 ? ' (depleted)' : ''
        }`,
      ));
      blocks.push(para(bar(battle.shield.player, playerShieldMax)));
    }
    if (battle.guarding) blocks.push(para('🛡️ Guarding'));
    blocks.push(...effectsBlocks(battle, 'player'));
    // Latest completed round expanded; everything older collapsed (#67).
    blocks.push(activeRecapBlock(player, battle));
    blocks.push(...earlierHistoryBlocks(battle));
    blocks.push(buttonsRow([
      cbBtn(
        `${classDef.basicAction.icon} ${classDef.basicAction.name}`,
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
  const won = battle.phase === 'won';
  blocks.push(
    heading(
      won
        ? `🏆 Victory · ${turnsLabel(battle.round)}`
        : battle.phase === 'fled'
        ? '🏃 Escaped'
        : '💀 Defeat',
      3,
    ),
  );
  // The terminal round is regular history (#67): recap the kill round like
  // any other round, then the resolution outcome, then ONE authoritative
  // Spoils presentation — never the same XP/gold twice.
  const latest = battle.history[battle.history.length - 1];
  if (latest) blocks.push(roundPanel(`Round ${latest.round} result`, latest.lines));
  blocks.push(...noticesBlocks(player));
  if (won && battle.rewards) {
    // One authoritative reward outcome (#40): conversion is what the
    // engine actually granted, stamped pre-grant — never re-inferred from
    // the player's (possibly just-leveled) current level.
    blocks.push(para(
      battle.rewards.xpConvertedGold !== undefined
        ? `🎁 Spoils: ✨ ${battle.rewards.xp} XP → +${battle.rewards.xpConvertedGold} gold · 💰 ${battle.rewards.gold} gold`
        : `🎁 Spoils: ✨ ${battle.rewards.xp} XP · 💰 ${battle.rewards.gold} gold`,
    ));
  }
  blocks.push(...earlierHistoryBlocks(battle));
  blocks.push(buttonsRow([cbBtn('➡️ Continue', encodeCb({ v: 'battle', a: 'go' }), 'success')]));
  return { blocks };
}

export function renderSkillMenu(player: PlayerState): InputRichMessage {
  const battle = player.battle!;
  const learned = new Set(player.skills);
  const all = skillsForClass(player.classId, 999);
  const blocks: InputRichBlock[] = [
    heading('✨ Skills', 4),
    para(`💧 MP ${player.mp}/${statsOf(player).maxMp}`),
  ];
  // Pre-emptive skills (#80) fire in the opening phase — not castable, so
  // they never appear in the battle skill menu.
  const usable = all.filter((skill) => learned.has(skill.id) && !skill.preEmptive);
  for (const skill of usable) {
    const cd = battle.cooldowns[skill.id] ?? 0;
    const ready = cd === 0 && player.mp >= skill.mpCost; // invalid taps never cost a turn
    const label = `${skill.name} — ${skill.mpCost} MP${cd > 0 ? ` (CD ${cd})` : ''}`;
    // #120: the in-battle picker shows the GENERATED mechanical block —
    // exact rules only; flavor stays on the Skills screen.
    blocks.push(para(mechanicsText(skill.effects)));
    blocks.push(
      buttonsRow([
        ready
          ? cbBtn(label, encodeCb({ v: 'battle', a: 'use', arg: skill.id }))
          : disabledBtn(label),
      ], 'left'),
    );
  }
  // Pre-emptive skills (#80/#81) never render as cast buttons — labeled
  // info rows only, so the activation type is explicit.
  for (const skill of all) {
    if (!learned.has(skill.id) || !skill.preEmptive) continue;
    blocks.push(para([{
      type: 'italic',
      text: `⚡ ${skill.name} — automatic at battle open (once per battle; no MP or cooldown). ${
        mechanicsText(skill.effects)
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

export function renderItemMenu(player: PlayerState): InputRichMessage {
  const battle = player.battle!;
  // Auto-trigger items (Phoenix Cinder) are never manually usable.
  const manual = (id: string): boolean => {
    const effect = item(id)?.effect;
    if (!effect) return true;
    return Boolean(effect.healHp || effect.healMp || effect.cureStatus || effect.flee);
  };
  // Context checks (#35): a button that cannot do anything renders
  // disabled instead of promising an action the engine must refuse.
  const applicable = (id: string): boolean => {
    const effect = item(id)?.effect;
    if (!effect) return true;
    if (effect.flee) return !battle.enemy.isBoss; // Smoke Bomb never touches bosses
    // Real tagged cleanse (#78): usable when any removable harmful effect
    // is live (today: the sapped-strength family).
    if (effect.cureStatus && !effect.healHp && !effect.healMp) {
      return hasRemovableTagged(battle, 'player', ['harmful']);
    }
    return true;
  };
  const items = consumables(player).filter((entry) => manual(entry.id));
  const blocks: InputRichBlock[] = [heading('🎒 Battle items', 4)];
  if (!items.some((entry) => applicable(entry.id))) {
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
