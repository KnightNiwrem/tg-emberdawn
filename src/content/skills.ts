/** Skill catalog — 8 skills per class, learned at fixed levels. Authored in
 * ascending learn-level order per class (ties keep authored order); the
 * helper enforces this too (#77), so menus can never leak insertion order.
 *
 * Mechanics live entirely in ordered `effects` specs (#78) — the shared
 * combat vocabulary executed by the generic resolver. `type` is display
 * classification only. Every desc is validated against its effects. */

import type { EffectSpec, SkillDef } from './types.ts';
import type { ClassId } from '../engine/types.ts';

const S = (s: SkillDef): SkillDef => s;

/** Damage — the overwhelmingly common shape. */
const dmg = (attack: 'phys' | 'mag', power: number): EffectSpec => ({
  kind: 'damage',
  attack,
  power,
});
/** Self-buff statmod: offensive stats defer their first decay (#27/#38),
 * defensive stats count the cast round (#77). */
const buff = (
  stat: 'atk' | 'mag' | 'def' | 'res' | 'spd',
  pct: number,
  dur: number,
): EffectSpec => ({
  kind: 'statmod',
  stat,
  pct,
  duration: dur,
  timing: stat === 'atk' || stat === 'mag' ? 'defer' : 'immediate',
  tags: ['beneficial'],
});
/** Stun rider: only rolls when the target survived the strike (old rng
 * parity), consumed on the target's next action. */
const stun = (chance: number): EffectSpec => ({
  kind: 'control',
  control: 'stun',
  actions: 1,
  chance,
  requireSurvivor: true,
});
/** MAG-scaled heal: effectiveMag * power * 2 + flat (#77: the flat 20 is
 * part of the contract and appears in the desc). */
const mend = (power: number): EffectSpec => ({
  kind: 'restore',
  hpPower: power,
  hpFlat: 20,
});
/** Player-applied offense sap on the enemy (Venom Cut): strongest-wins,
 * survivor-gated. */
const sapEnemy = (pct: number, dur: number): EffectSpec => ({
  kind: 'statmod',
  target: 'opponent',
  stat: 'outgoing',
  pct: -pct,
  duration: dur,
  timing: 'immediate',
  stacking: 'strongest',
  requireSurvivor: true,
});

export const SKILLS: readonly SkillDef[] = [
  // ── Warrior ─────────────────────────────────────────────────────────
  S({
    id: 'sk_cleave',
    name: 'Cleave',
    classId: 'warrior',
    learnLevel: 1,
    mpCost: 4,
    cooldown: 0,
    type: 'phys',
    effects: [dmg('phys', 1.35)],
    desc: 'A heavy diagonal cut. 135% ATK.',
  }),
  S({
    id: 'sk_shield_bash',
    name: 'Shield Bash',
    classId: 'warrior',
    learnLevel: 4,
    mpCost: 8,
    cooldown: 3,
    type: 'phys',
    effects: [dmg('phys', 1.0), stun(0.35)],
    desc: '100% ATK, 35% chance to stun the enemy for a turn.',
  }),
  S({
    id: 'sk_war_cry',
    name: 'War Cry',
    classId: 'warrior',
    learnLevel: 8,
    mpCost: 10,
    cooldown: 4,
    type: 'buff',
    effects: [buff('atk', 0.35, 3)],
    desc: '+35% ATK for 3 turns.',
  }),
  S({
    id: 'sk_whirlwind',
    name: 'Whirlwind',
    classId: 'warrior',
    learnLevel: 13,
    mpCost: 14,
    cooldown: 2,
    type: 'phys',
    effects: [dmg('phys', 1.75)],
    desc: 'Spinning strike. 175% ATK.',
  }),
  S({
    id: 'sk_iron_wall',
    name: 'Iron Wall',
    classId: 'warrior',
    learnLevel: 16,
    mpCost: 10,
    cooldown: 4,
    type: 'buff',
    effects: [buff('def', 0.6, 3)],
    desc: '+60% DEF for 3 turns.',
  }),
  S({
    id: 'sk_executioner',
    name: 'Executioner',
    classId: 'warrior',
    learnLevel: 22,
    mpCost: 20,
    cooldown: 3,
    type: 'phys',
    effects: [dmg('phys', 2.4)],
    desc: 'A killing stroke. 240% ATK.',
  }),
  S({
    id: 'sk_adrenaline',
    name: 'Adrenaline Surge',
    classId: 'warrior',
    learnLevel: 28,
    mpCost: 18,
    cooldown: 5,
    type: 'heal',
    // #78: the heal and the ATK leg are separate ordered effects — the ATK
    // contribution STACKS as its own instance instead of fusing into a
    // shared slot (War Cry + Adrenaline now keep independent magnitudes).
    effects: [
      {
        kind: 'restore',
        hpPctOfMax: 0.3,
        line: '🩹 You recover {n} HP and feel the rush (+20% ATK).',
      },
      { ...buff('atk', 0.2, 2), stacking: 'stack', quiet: true },
    ],
    desc: 'Heal 30% of max HP and gain +20% ATK for 2 turns.',
  }),
  S({
    id: 'sk_titans_fall',
    name: "Titan's Fall",
    classId: 'warrior',
    learnLevel: 36,
    mpCost: 30,
    cooldown: 4,
    type: 'phys',
    effects: [dmg('phys', 3.1)],
    desc: 'Bring the sky down. 310% ATK.',
  }),

  // ── Mage ────────────────────────────────────────────────────────────
  S({
    id: 'sk_firebolt',
    name: 'Firebolt',
    classId: 'mage',
    learnLevel: 1,
    mpCost: 5,
    cooldown: 0,
    type: 'mag',
    effects: [dmg('mag', 1.4)],
    desc: 'A dart of flame. 140% MAG.',
  }),
  S({
    id: 'sk_frost_lance',
    name: 'Frost Lance',
    classId: 'mage',
    learnLevel: 5,
    mpCost: 10,
    cooldown: 2,
    type: 'mag',
    effects: [dmg('mag', 1.55), stun(0.2)],
    desc: '155% MAG, 20% chance to freeze the enemy.',
  }),
  S({
    id: 'sk_barrier',
    name: 'Barrier',
    classId: 'mage',
    learnLevel: 9,
    mpCost: 12,
    cooldown: 4,
    type: 'buff',
    effects: [buff('def', 0.5, 3), buff('res', 0.5, 3)],
    desc: '+50% DEF/RES for 3 turns.',
  }),
  S({
    id: 'sk_arcane_surge',
    name: 'Arcane Surge',
    classId: 'mage',
    learnLevel: 13,
    mpCost: 16,
    cooldown: 2,
    type: 'mag',
    effects: [dmg('mag', 2.1)],
    desc: '210% MAG.',
  }),
  S({
    id: 'sk_drain_life',
    name: 'Drain Life',
    classId: 'mage',
    learnLevel: 17,
    mpCost: 18,
    cooldown: 3,
    type: 'mag',
    // #78: ordered damage → lifesteal derived from the dealt damage, no
    // id-specific branch.
    effects: [dmg('mag', 1.5), { kind: 'lifesteal', pct: 0.5 }],
    desc: '150% MAG and heal half the damage dealt.',
  }),
  S({
    id: 'sk_meteor',
    name: 'Meteor',
    classId: 'mage',
    learnLevel: 24,
    mpCost: 26,
    cooldown: 3,
    type: 'mag',
    effects: [dmg('mag', 3.0)],
    desc: '300% MAG. The classic.',
  }),
  S({
    id: 'sk_time_warp',
    name: 'Time Warp',
    classId: 'mage',
    learnLevel: 30,
    mpCost: 22,
    cooldown: 5,
    type: 'buff',
    // #77 semantics, now data-driven: MAG defers (the cast round cannot use
    // it), SPD counts the cast round it defends.
    effects: [buff('mag', 0.4, 3), buff('spd', 0.4, 3)],
    desc: '+40% MAG/SPD for 3 turns.',
  }),
  S({
    id: 'sk_cataclysm',
    name: 'Cataclysm',
    classId: 'mage',
    learnLevel: 40,
    mpCost: 40,
    cooldown: 4,
    type: 'mag',
    effects: [dmg('mag', 4.2)],
    desc: '420% MAG. For endings.',
  }),

  // ── Rogue ───────────────────────────────────────────────────────────
  S({
    id: 'sk_quick_slash',
    name: 'Quick Slash',
    classId: 'rogue',
    learnLevel: 1,
    mpCost: 3,
    cooldown: 0,
    type: 'phys',
    effects: [dmg('phys', 1.25)],
    desc: 'Fast cut. 125% ATK.',
  }),
  S({
    id: 'sk_backstab',
    name: 'Backstab',
    classId: 'rogue',
    learnLevel: 5,
    mpCost: 9,
    cooldown: 2,
    type: 'phys',
    effects: [dmg('phys', 1.8)],
    desc: "Where the light doesn't reach. 180% ATK.",
  }),
  S({
    id: 'sk_smoke_step',
    name: 'Smoke Step',
    classId: 'rogue',
    learnLevel: 9,
    mpCost: 8,
    cooldown: 4,
    type: 'buff',
    effects: [buff('spd', 0.45, 3)],
    desc: '+45% SPD for 3 turns — outpace the foe and slip its blows.',
  }),
  S({
    id: 'sk_expose_weakness',
    name: 'Expose Weakness',
    classId: 'rogue',
    learnLevel: 12,
    mpCost: 6,
    cooldown: 0,
    type: 'debuff',
    preEmptive: true,
    effects: [{
      kind: 'statmod',
      target: 'opponent',
      stat: 'incoming',
      pct: 0.25,
      duration: 3,
      timing: 'immediate',
      chance: 0.6,
      name: 'Exposed',
      line: "🔎 You read the foe's stance — Exposed! It takes 25% more damage for 3 turns.",
      tags: ['vulnerable'],
    }],
    desc: 'Battle open: 60% chance to Expose the foe — +25% damage taken for 3 turns.',
  }),
  S({
    id: 'sk_twin_strike',
    name: 'Twin Strike',
    classId: 'rogue',
    learnLevel: 13,
    mpCost: 13,
    cooldown: 2,
    type: 'phys',
    effects: [dmg('phys', 2.0)],
    desc: 'Two blades, one breath. 200% ATK.',
  }),
  S({
    id: 'sk_venom_cut',
    name: 'Venom Cut',
    classId: 'rogue',
    learnLevel: 17,
    mpCost: 12,
    cooldown: 3,
    type: 'debuff',
    effects: [dmg('phys', 1.3), sapEnemy(0.25, 3)],
    desc: '130% ATK and weaken the enemy by 25% for 3 turns.',
  }),
  S({
    id: 'sk_shadow_dance',
    name: 'Shadow Dance',
    classId: 'rogue',
    learnLevel: 22,
    mpCost: 18,
    cooldown: 3,
    type: 'phys',
    effects: [dmg('phys', 2.6)],
    desc: '260% ATK, delivered from three directions.',
  }),
  S({
    id: 'sk_assassinate',
    name: 'Assassinate',
    classId: 'rogue',
    learnLevel: 30,
    mpCost: 24,
    cooldown: 4,
    type: 'phys',
    effects: [dmg('phys', 3.2)],
    desc: 'One target. One ending. 320% ATK.',
  }),
  S({
    id: 'sk_death_mark',
    name: 'Death Mark',
    classId: 'rogue',
    learnLevel: 40,
    mpCost: 34,
    cooldown: 4,
    type: 'phys',
    effects: [dmg('phys', 4.0)],
    desc: '400% ATK. The last thing they see.',
  }),

  // ── Cleric ──────────────────────────────────────────────────────────
  S({
    id: 'sk_smite',
    name: 'Smite',
    classId: 'cleric',
    learnLevel: 1,
    mpCost: 5,
    cooldown: 0,
    type: 'mag',
    effects: [dmg('mag', 1.3)],
    desc: 'Holy light as a weapon. 130% MAG.',
  }),
  S({
    id: 'sk_mend',
    name: 'Mend Wounds',
    classId: 'cleric',
    learnLevel: 1,
    mpCost: 8,
    cooldown: 0,
    type: 'heal',
    effects: [mend(1.1)],
    desc: 'Heal 220% of MAG + 20 HP.',
  }),
  S({
    id: 'sk_blessing',
    name: 'Blessing',
    classId: 'cleric',
    learnLevel: 8,
    mpCost: 12,
    cooldown: 4,
    type: 'buff',
    // #77: MAG/DEF — every Cleric damage action is MAG vs RES.
    effects: [buff('mag', 0.3, 3), buff('def', 0.3, 3)],
    desc: '+30% MAG/DEF for 3 turns.',
  }),
  S({
    id: 'sk_radiant_burst',
    name: 'Radiant Burst',
    classId: 'cleric',
    learnLevel: 11,
    mpCost: 16,
    cooldown: 2,
    type: 'mag',
    effects: [dmg('mag', 1.85)],
    desc: '185% MAG.',
  }),
  S({
    id: 'sk_aegis',
    name: 'Aegis of Dawn',
    classId: 'cleric',
    learnLevel: 14,
    mpCost: 14,
    cooldown: 3,
    type: 'buff',
    // #79: a real ward — capacity scales like a heal (MAG * power * 2).
    effects: [{ kind: 'shield', magPower: 1.2, amount: 20, duration: 3, timing: 'immediate' }],
    desc: 'A dawn ward absorbs 240% of MAG + 20 damage for 3 rounds.',
  }),
  S({
    id: 'sk_holy_ward',
    name: 'Holy Ward',
    classId: 'cleric',
    learnLevel: 16,
    mpCost: 12,
    cooldown: 4,
    type: 'buff',
    effects: [buff('res', 0.55, 3)],
    desc: '+55% RES for 3 turns.',
  }),
  S({
    id: 'sk_divine_mending',
    name: 'Divine Mending',
    classId: 'cleric',
    learnLevel: 20,
    mpCost: 20,
    cooldown: 2,
    type: 'heal',
    effects: [mend(1.9)],
    desc: 'Heal 380% of MAG + 20 HP.',
  }),
  S({
    id: 'sk_judgment',
    name: 'Judgment',
    classId: 'cleric',
    learnLevel: 26,
    mpCost: 24,
    cooldown: 3,
    type: 'mag',
    effects: [dmg('mag', 2.9), stun(0.15)],
    desc: '290% MAG, 15% chance to stun.',
  }),
  S({
    id: 'sk_miracle',
    name: 'Miracle',
    classId: 'cleric',
    learnLevel: 36,
    mpCost: 32,
    cooldown: 5,
    type: 'heal',
    // #78: the cleanse is REAL now — a tagged removal of every removable
    // harmful instance (#77 scoped the copy until this framework landed).
    effects: [
      {
        kind: 'restore',
        hpFull: true,
        line: '✨ Miracle! HP fully restored, harmful effects cleansed.',
      },
      { kind: 'cleanse', tags: ['harmful'], quiet: true },
    ],
    desc: 'Fully restore HP and cleanse harmful effects.',
  }),
];

const SKILL_INDEX = new Map(SKILLS.map((s) => [s.id, s]));

export function skill(id: string): SkillDef | undefined {
  return SKILL_INDEX.get(id);
}

export function skillsForClass(classId: ClassId, upToLevel: number): SkillDef[] {
  // Stable ascending learnLevel (#77): menus must reflect PROGRESSION, not
  // catalog insertion order. Sort is stable (ES2019+), so equal-level skills
  // keep their authored order — Smite before Mend Wounds at level 1.
  return SKILLS
    .filter((s) => s.classId === classId && s.learnLevel <= upToLevel)
    .sort((a, b) => a.learnLevel - b.learnLevel);
}

/** Skills that become newly available exactly at `level`. */
export function skillsLearnedAt(classId: ClassId, level: number): SkillDef[] {
  return SKILLS.filter((s) => s.classId === classId && s.learnLevel === level);
}

// ── Effect-shape helpers (#78) ── shared by the balance harness, the
// tutorial flow and the catalog validation tests. Mechanics never branch
// on ids; policies read these public shapes instead.

/** True when the skill's ordered effects deal damage. */
export function isDamageSkill(sk: SkillDef): boolean {
  return sk.effects.some((e) => e.kind === 'damage');
}

/** Highest damage multiplier in the skill's effects (0 when none). */
export function skillMaxDamagePower(sk: SkillDef): number {
  let max = 0;
  for (const e of sk.effects) {
    if (e.kind === 'damage') max = Math.max(max, e.power);
  }
  return max;
}

/** True when the skill's ordered effects restore HP/MP. */
export function isHealSkill(sk: SkillDef): boolean {
  return sk.effects.some((e) => e.kind === 'restore');
}

/** MAG-scaled heal multiplier for heal sorting/expected-value (0 when the
 * skill heals by another shape). */
export function skillHealPower(sk: SkillDef): number {
  for (const e of sk.effects) {
    if (e.kind === 'restore' && e.hpPower !== undefined) return e.hpPower;
  }
  return 0;
}
