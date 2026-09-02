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
import { startBattle } from '../engine/combat.ts';
import { defaultRng } from '../engine/rng.ts';
import { statsOf } from '../engine/character.ts';
import { CLASSES } from '../engine/classes.ts';
import { applyTutorialOutcome } from '../engine/tutorial.ts';
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

/** One concept at a time, inside the live battle (#69 rework): the engine
 * owns the lesson beats on the battle (basic → skill → guard → item →
 * cleared) and the coach narrates the CURRENT one. The phase-gated fight
 * guarantees every beat is reachable — a killing blow merely staggers the
 * mite, and the scripted hit after Guard lands the hero below the item
 * threshold — so every lesson is shown through real play. Replaces the
 * notices each consumed round: progressive disclosure, not a wall of text. */
export function coachTutorial(p: PlayerState): void {
  const b = p.battle;
  if (!b || b.phase !== 'active' || !b.tutorial) return;
  const s = statsOf(p);
  const lines: string[] = [];
  const basic = CLASSES[p.classId].basicAction;
  if (b.tutorialStep === 'basic') {
    lines.push(`${basic.icon} ${basic.name} is free — lead with it, then we'll talk skills.`);
  } else if (b.tutorialStep === 'skill') {
    const sk = skillDef(p.skills[0] ?? '');
    lines.push(
      `✨ MP (💧) fuels skills. Open ✨ Skills and try ${
        sk?.name ?? 'your skill'
      } — it hits far harder than the free action, for a little MP.`,
    );
    const heal = p.skills.map((id) => skillDef(id)).find((h) => h?.type === 'heal');
    if (heal) {
      lines.push(
        `❤️ ${heal.name} is yours from the start — healing is your craft; use it before the hurt wins.`,
      );
    }
  } else if (b.tutorialStep === 'guard') {
    lines.push("🛡️ Guard halves the enemy's next blow and recovers MP. Brace for one round.");
  } else if (b.tutorialStep === 'item' && p.hp < s.maxHp * 0.7) {
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
  // The canonical outcome lives in the ENGINE (#74) so the balance harness
  // starts simulations from the same post-tutorial state as real heroes.
  return [
    "🔥 The ember warms you — Maren's gift carries its own spark.",
    ...applyTutorialOutcome(p),
  ];
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
      const b = startBattle(TUTORIAL_ENEMY, { kind: 'explore', zoneId: p.currentZone }, {
        player: p,
        rng: defaultRng,
        tutorial: true,
      });
      if (!b) return { toast: 'Nothing stirs.' };
      // #69 rework: the guided fight is phase-gated — the engine advances
      // the lesson beats and refuses victory until every beat is performed.
      // Tutorial provenance is supplied AT construction (#80): openings are
      // suppressed and the beat gate set before the battle ever exists.
      p.battle = b;
      p.tutorial = 'fight';
      p.scene = { view: 'battle' };
      p.notices = tutorialIntro(p);
      return {};
    }
  }
}
