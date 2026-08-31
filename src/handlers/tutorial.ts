/**
 * Guided prologue (#69): a short directed flow after class selection —
 * Elder Maren's brief, then ONE controlled first battle against a
 * tutorial-flagged enemy (the balance harness proves no class can lose
 * it), taught one concept at a time inside the live battle, ending in a
 * deterministic reward that leaves every hero at level 2 before the real
 * hub opens. State is a plain TutorialStep on the save: /start resumes the
 * current step, and the uiRev guard makes every step transition
 * replay-safe, so no reward can ever double.
 */

import type { PlayerState } from '../engine/types.ts';
import type { Cb } from '../codec.ts';
import type { PlayerAction } from '../engine/combat.ts';
import { startBattle } from '../engine/combat.ts';
import { grantXp, statsOf } from '../engine/character.ts';
import { xpForNextLevel } from '../engine/classes.ts';
import { CLASSES } from '../engine/classes.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { skill as skillDef } from '../content/skills.ts';
import type { MutationResult } from './session.ts';

/** The prologue's controlled enemy — authored as a level-1 tutorial
 * fixture (no status, no drops, no elite classification). */
export const TUTORIAL_ENEMY = 'e_cinder_mite';

/** Maren's brief: the ember, the threat outside, the send-off. */
export function tutorialIntro(p: PlayerState): string[] {
  const e = enemyDef(TUTORIAL_ENEMY);
  const cls = CLASSES[p.classId];
  return [
    `🔥 The ember in your pocket flares. Just past the hearth-light, a ${e?.name} skitters out of the ash.`,
    `📏 Enemy level matters: it reads Lv ${
      e?.level ?? 1
    } — the higher it sits above yours, the harder it bites.`,
    `${cls.basicAction.icon} ${cls.basicAction.name} is free and always ready — press it to strike.`,
  ];
}

/** One concept at a time, inside the live battle: after the free action
 * comes the starting skill and MP; then Guard; then Items once the hurt
 * is real. Replaces the notices each consumed round — progressive
 * disclosure, not a wall of text. */
export function coachTutorial(p: PlayerState, action: PlayerAction): void {
  const b = p.battle;
  if (!b || b.phase !== 'active') return;
  if (action.kind === 'skill') p.flags['tut_skill'] = 1;
  if (action.kind === 'guard') p.flags['tut_guard'] = 1;
  if (action.kind === 'item') p.flags['tut_items'] = 1;
  const s = statsOf(p);
  const lines: string[] = [];
  if (!p.flags['tut_skill']) {
    const sk = skillDef(p.skills[0] ?? '');
    lines.push(
      `✨ MP (💧) fuels skills. Open ✨ Skills and try ${
        sk?.name ?? 'your skill'
      } — it hits far harder than the free action, for a little MP.`,
    );
    const heal = p.skills.map((id) => skillDef(id)).find((s) => s?.type === 'heal');
    if (heal) {
      lines.push(
        `❤️ ${heal.name} is yours from the start — healing is your craft; use it before the hurt wins.`,
      );
    }
  } else if (!p.flags['tut_guard']) {
    lines.push("🛡️ Guard halves the enemy's next blow and recovers MP. Brace for one round.");
  } else if (!p.flags['tut_items'] && p.hp < s.maxHp * 0.7) {
    lines.push(
      '🎒 When the hurt is real, open 🎒 Items — a potion mid-fight beats a heroic death.',
    );
  }
  p.notices = lines;
}

/** Deterministic prologue reward: whatever the mite's xp roll was, every
 * hero exits the fight at least level 2. Idempotent via the flag — the
 * grant runs exactly once per save. */
export function grantTutorialReward(p: PlayerState): string[] {
  if (p.flags['tut_reward']) return [];
  p.flags['tut_reward'] = 1;
  const lines: string[] = ["🔥 The ember warms you — Maren's gift carries its own spark."];
  if (p.level < 2) lines.push(...grantXp(p, xpForNextLevel(1) + 5 - p.xp));
  return lines;
}

/** Release into the real hub: the next contact, the next destination, and
 * the two survival lessons the controlled fight couldn't teach — reading
 * enemy levels, and fleeing ordinary exploration. */
export function tutorialRelease(): string[] {
  return [
    '🌅 Your first fight is yours. Maren will want to hear of it.',
    "📜 Elder Maren's board has work — talk to her when you're ready.",
    '🧭 The Emberdawn Outskirts are safe enough for a fresh blade (Lv 1–3); the Whisperwood beyond runs deeper (Lv 3–9). Weigh enemy levels before you engage — and 🏃 Flee is always an option, though it can fail.',
    '🔥 Return to a safe haven to heal for free — travel costs nothing.',
  ];
}

/** Prologue controls. Every case revalidates the CURRENT step before it
 * mutates, so a stale or replayed button can never advance (or re-advance)
 * the flow — the uiRev guard already rejected same-render replays. */
export function tutorialAction(p: PlayerState, cb: Cb & { v: 'tut' }): MutationResult {
  switch (cb.a) {
    case 'maren': {
      if (p.tutorial !== 'maren' || p.battle) return { toast: 'The tale has moved on.' };
      p.scene = { view: 'tutorial', arg: 'brief' };
      return {};
    }
    case 'out': {
      // The brief must be the live sub-view — a replayed 'out' after the
      // step moved on is refused here even before staleness guards.
      if (p.tutorial !== 'maren' || p.scene.arg !== 'brief') {
        return { toast: 'The tale has moved on.' };
      }
      p.tutorial = 'outskirts';
      p.scene = { view: 'zone' };
      return {};
    }
    case 'face': {
      if (p.tutorial !== 'outskirts' && p.tutorial !== 'fight') {
        return { toast: 'The tale has moved on.' };
      }
      if (p.battle) {
        p.scene = { view: 'battle' };
        return { toast: 'Finish this fight first!' };
      }
      const b = startBattle(TUTORIAL_ENEMY, { kind: 'explore', zoneId: p.currentZone });
      if (!b) return { toast: 'Nothing stirs.' };
      p.battle = b;
      p.tutorial = 'fight';
      p.scene = { view: 'battle' };
      p.notices = tutorialIntro(p);
      return {};
    }
  }
}
