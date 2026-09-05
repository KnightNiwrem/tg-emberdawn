/** Enemy catalog. Base stats scale from level via the mk() helper so the
 * difficulty curve stays coherent; bosses and specials are hand-tuned.
 *
 * Moves are ordered effect specs from the shared vocabulary (#78): damage
 * specs multiply the enemy's atk/mag vs the player's DEF/RES; moves without
 * a damage spec never roll dodge and never deal implicit chip damage (#25).
 */

import type { EffectSpec, EnemyDef, EnemyMove } from './types.ts';

/** Damaging move, with optional riders (saps) after the strike. */
const hit = (
  name: string,
  power: number,
  attack: 'phys' | 'mag',
  weight: number,
  ...riders: EffectSpec[]
): EnemyMove => ({ name, weight, effects: [{ kind: 'damage', attack, power }, ...riders] });

/** Pure status/heal/guard move — announces with the 🌀 intro unless one of
 * its effects carries its own headline line (heals, guard stances do). */
const move = (name: string, weight: number, ...effects: EffectSpec[]): EnemyMove => ({
  name,
  weight,
  effects,
});

/** Offense sap rider (#25): saps the PLAYER's outgoing damage for 2 rounds.
 * All saps share the generic `sap` slot with strongest-wins semantics (#78)
 * — the old per-move overwrite was accidental. */
const SAP = (pct: number): EffectSpec => ({
  kind: 'statmod',
  target: 'opponent',
  stat: 'outgoing',
  pct: -pct,
  duration: 2,
  timing: 'immediate',
  stacking: 'strongest',
});

/** Guard stance (#25): mitigation for the next `turns` rounds of player
 * attacks — the cast round is not consumed (#25), so the first tick defers. */
const GUARD = (pct: number, turns = 2): EffectSpec => ({
  kind: 'statmod',
  stat: 'mitigation',
  pct,
  duration: turns,
  timing: 'defer',
  tags: ['beneficial'],
});

/** Self-heal: pct of the enemy's max HP (pure heal — #77/#78: no implicit
 * damage coefficient). */
const HEAL = (pct: number): EffectSpec => ({ kind: 'restore', hpPctOfMax: pct });

/** #83 shared-status policy for enemies (same vocabulary as skills and
 * equipment — no id branches anywhere):
 * - **Poison** is the ONLY DoT that bypasses shields — it bites HP
 *   directly. Flat per-round caps are inherently boss-safe.
 * - **Burn** routes through the target's ward like ordinary damage.
 * - **Slow** (and its Chill/Petrify/Ageing flavor copies) cuts SPD, which
 *   also cuts dodge and flee odds. Freeze/paralysis beyond Slow is
 *   deliberately NOT shipped; heavy "freeze" moments are Slow with a
 *   bigger magnitude under one coherent policy.
 * - **Ward Break** cuts RES; Weaken (SAP) cuts all outgoing damage.
 * - **statusResist** (bosses/elites): harmful statuses applied BY THE
 *   PLAYER to this enemy fail outright that fraction of the time, with
 *   visible "resists" feedback — authored resistance, never blanket
 *   immunity, and the roll draws the injected RNG exactly once. */
const POISON = (perRound: number, turns = 3): EffectSpec => ({
  kind: 'periodic',
  target: 'opponent',
  perRound: -perRound,
  duration: turns,
  tickPhase: 'roundEnd',
  name: 'Poison',
  tags: ['poison', 'harmful'],
  bypassShield: true,
  // Pure battle narration (#134): the mechanical facts (damage, timing,
  // Shield bypass) live in the effect spec and the generated battle rows.
  line: '☠️ The venom bites in — Poison!',
});

const SLOW = (pct = 0.25, turns = 2, name = 'Slowed', flavor?: string): EffectSpec => ({
  kind: 'statmod',
  target: 'opponent',
  stat: 'spd',
  pct: -pct,
  duration: turns,
  timing: 'immediate',
  name,
  tags: ['slow', 'harmful'],
  line: flavor ?? `🐌 ${name}!`,
});

const BURN = (perRound: number, turns = 3): EffectSpec => ({
  kind: 'periodic',
  target: 'opponent',
  perRound: -perRound,
  duration: turns,
  tickPhase: 'roundEnd',
  name: 'Burn',
  tags: ['burn', 'harmful'],
  line: '🔥 The flesh blisters — Burning!',
});

const WARD_BREAK = (pct = 0.25, turns = 2): EffectSpec => ({
  kind: 'statmod',
  target: 'opponent',
  stat: 'res',
  pct: -pct,
  duration: turns,
  timing: 'immediate',
  name: 'Ward Break',
  tags: ['ward-break', 'harmful'],
  line: '💔 The ward cracks — Ward Break!',
});

const BITE = (n = 'Bite'): EnemyMove => hit(n, 1.0, 'phys', 3);
const CLAW = (n = 'Claw'): EnemyMove => hit(n, 1.15, 'phys', 2);

interface EnemySpec {
  id: string;
  name: string;
  emoji: string;
  level: number;
  /** Tutorial fixture (#69): enforced unlosable by the balance harness. */
  tutorial?: true;
  /** stat multipliers over the level curve (defaults 1). */
  mul?: {
    hp?: number;
    atk?: number;
    def?: number;
    mag?: number;
    res?: number;
    spd?: number;
    xp?: number;
    gold?: number;
  };
  boss?: boolean;
  /** #83 status resistance (0..1): share of player-applied harmful
   * statuses this enemy resists outright, with visible feedback. */
  statusResist?: number;
  openingShield?: EnemyDef['openingShield'];
  opening?: EnemyDef['opening'];
  special?: EnemyDef['special'];
  moves: EnemyMove[];
  drops?: Record<string, number>;
  desc?: string;
}

function mk(s: EnemySpec): EnemyDef {
  const L = s.level;
  const m = s.mul ?? {};
  const mul = (k: keyof NonNullable<EnemySpec['mul']>, base: number): number =>
    Math.round(base * (m[k] ?? 1));
  return {
    id: s.id,
    name: s.name,
    emoji: s.emoji,
    level: L,
    tutorial: s.tutorial,
    hp: mul('hp', Math.round(30 + 2.4 * Math.pow(L, 1.9))),
    atk: mul('atk', Math.round(6 + 2.0 * Math.pow(L, 1.22))),
    def: mul('def', Math.round(2 + 0.9 * Math.pow(L, 1.15))),
    mag: mul('mag', Math.round(5 + 1.8 * Math.pow(L, 1.2))),
    res: mul('res', Math.round(2 + 0.8 * Math.pow(L, 1.12))),
    spd: mul('spd', 5 + Math.round(L * 0.8)),
    xp: mul('xp', Math.round(16 * Math.pow(L, 1.75))),
    gold: mul('gold', Math.round(4 * Math.pow(L, 1.55))),
    boss: s.boss,
    statusResist: s.statusResist,
    openingShield: s.openingShield,
    opening: s.opening,
    special: s.special,
    moves: s.moves,
    drops: s.drops,
    desc: s.desc,
  };
}

export const ENEMIES: readonly EnemyDef[] = [
  // ── Emberdawn Village / Whisperwood (ch1) ───────────────────────────────────
  mk({
    // Guided-prologue fixture (#69): level 1, tiny offense, no status, no
    // drops — the first fight is a lesson, not a loot roll. Flagged
    // `tutorial` so tests/balance_test.ts proves NO class can lose it.
    id: 'e_cinder_mite',
    name: 'Cinder Mite',
    emoji: '🕯️',
    level: 1,
    // Sturdy enough to survive ANY level-1 crit opener (warrior ~26, rogue
    // ~31, mage ~38) — the guided fight must last long enough for the
    // coach to teach its beats (#69), whatever the rng draws (#72).
    mul: { hp: 1.3, atk: 0.75, xp: 2.5, gold: 1.5 },
    tutorial: true,
    moves: [BITE('Nibble'), hit('Ash Puff', 0.8, 'mag', 1)],
    desc: 'A last spark of the old hearth-fire, going about its small business.',
  }),
  mk({
    id: 'e_ember_rat',
    name: 'Ember Rat',
    emoji: '🐀',
    level: 1,
    moves: [BITE('Gnaw')],
    drops: { m_ember_shard: 0.25 },
    desc: 'Small, ember-flecked, and always hungry.',
  }),
  mk({
    id: 'e_rootling',
    name: 'Root Nibbler',
    emoji: '🌱',
    level: 2,
    mul: { hp: 1.2, atk: 0.8 },
    moves: [BITE('Root Chew'), move('Fibrous Hide', 1, GUARD(0.3, 2))],
    drops: { m_ember_shard: 0.2 },
    desc: 'Sturdier than it looks — it would rather outlast you than bite you.',
  }),
  mk({
    id: 'e_rat',
    name: 'Giant Rat',
    emoji: '🐀',
    level: 2,
    moves: [BITE()],
    drops: { m_ember_shard: 0.25 },
    desc: 'Big, bold, and everywhere.',
  }),
  mk({
    id: 'e_boar',
    name: 'Tusked Boar',
    emoji: '🐗',
    level: 3,
    moves: [BITE('Gore'), CLAW('Trample')],
    drops: { m_ember_shard: 0.3 },
  }),
  mk({
    id: 'e_bandit',
    name: 'Roadside Bandit',
    emoji: '🗡️',
    level: 4,
    moves: [hit('Shiv', 1.1, 'phys', 3), hit('Low Blow', 1.3, 'phys', 1)],
    drops: { c_minor_potion: 0.2 },
  }),
  mk({
    id: 'e_wolf',
    name: 'Grey Wolf',
    emoji: '🐺',
    level: 4,
    moves: [BITE(), move('Howl', 1, SAP(0.15))],
    drops: { m_ember_shard: 0.35 },
  }),
  mk({
    id: 'e_spider',
    name: 'Woodfang Spider',
    emoji: '🕷️',
    level: 5,
    moves: [
      hit('Venom Bite', 1.0, 'phys', 3, POISON(4)),
      hit(
        'Web Snare',
        0.6,
        'phys',
        1,
        SLOW(0.25, 2, 'Webbed', '🕸️ The webbing binds your legs — Webbed!'),
      ),
    ],
    drops: { m_ember_shard: 0.4, q_pells_locket: 0.25 },
  }),
  mk({
    id: 'e_sprite',
    name: 'Thistle Sprite',
    emoji: '🧚',
    level: 5,
    mul: { hp: 0.7 },
    moves: [hit('Prick', 0.8, 'mag', 2), hit('Hex', 1.1, 'mag', 2)],
    drops: { m_ember_shard: 0.45, c_minor_ether: 0.15 },
  }),
  mk({
    id: 'e_mycelid',
    name: 'Mycelid Drone',
    emoji: '🍄',
    level: 6,
    moves: [hit('Spore Cloud', 0.9, 'mag', 2), BITE('Gnaw')],
    drops: { m_iron_chunk: 0.3 },
  }),
  mk({
    id: 'e_thornling',
    name: 'Thornling',
    emoji: '🌿',
    level: 7,
    moves: [
      hit('Thorn Lash', 1.1, 'phys', 3),
      hit(
        'Root Snare',
        0.7,
        'phys',
        1,
        SLOW(0.25, 2, 'Rooted', '🌿 Roots coil around your ankles — Rooted!'),
      ),
    ],
  }),
  mk({
    id: 'e_stag',
    name: 'Corrupted Stag',
    emoji: '🦌',
    level: 7,
    mul: { hp: 1.3, xp: 1.5, gold: 1.5 },
    moves: [hit('Antler Charge', 1.3, 'phys', 3), hit('Feral Kick', 1.1, 'phys', 2)],
    desc: "The Whisperwood's guardian, gone wrong.",
  }),
  mk({
    id: 'e_aranya',
    name: 'Matriarch Aranya',
    emoji: '🕸️',
    level: 9,
    boss: true,
    mul: { hp: 2.6, xp: 3, gold: 3.2, def: 1.25 },
    statusResist: 0.2,
    moves: [
      hit('Skittering Bite', 1.1, 'phys', 3),
      hit(
        'Silk Prison',
        0.8,
        'phys',
        2,
        SLOW(
          0.3,
          2,
          'Silked',
          '🕸️ Silk binds you into a living cocoon — Silked!',
        ),
      ),
    ],
    // #77 authored this as a PURE heal (its old damage coefficient was
    // silently ignored); #78 expresses it as an ordered heal spec with no
    // power at all.
    special: { every: 4, move: move('Brood Surge', 1, HEAL(0.08)) },
    drops: { m_iron_chunk: 1.0, t_1: 0.5 },
    desc: 'She wove the Hollow. Now the Hollow weaves for her.',
  }),

  // ── Hollowmere (ch2) ────────────────────────────────────────────────
  mk({
    id: 'e_boglin',
    name: 'Boglin',
    emoji: '🫧',
    level: 10,
    moves: [BITE('Nibble'), hit('Mudball', 0.9, 'mag', 2)],
    drops: { m_iron_chunk: 0.35 },
  }),
  mk({
    id: 'e_leech',
    name: 'Marsh Leech',
    emoji: '🪱',
    level: 11,
    // #77 authored Drain as a PURE heal; #83 finally re-authors it as the
    // ordered [damage, lifesteal] pair the shared resolver has supported
    // since #78 — the name finally means drain.
    moves: [
      BITE('Leech'),
      move('Drain', 2, { kind: 'damage', attack: 'phys', power: 1.0 }, {
        kind: 'lifesteal',
        pct: 0.6,
      }),
    ],
    drops: { m_mystic_dust: 0.5, q_toxin_sample: 0.55 },
  }),
  mk({
    id: 'e_fenhag',
    name: 'Fen Hag',
    emoji: '🧙‍♀️',
    level: 12,
    moves: [
      hit('Cackle Bolt', 1.2, 'mag', 3),
      hit('Swamp Curse', 0.9, 'mag', 2, WARD_BREAK(0.25)),
    ],
    drops: { c_ether: 0.15 },
  }),
  mk({
    id: 'e_sludge',
    name: 'Oozing Sludge',
    emoji: '🫠',
    level: 12,
    mul: { hp: 1.4, spd: 0.6 },
    moves: [hit('Engulf', 1.2, 'phys', 3), hit('Acid Spray', 1.0, 'mag', 2)],
  }),
  mk({
    id: 'e_wisp',
    name: 'Marsh Wisp',
    emoji: '🌀',
    level: 13,
    mul: { hp: 0.75 },
    moves: [
      hit('Drowning Light', 1.2, 'mag', 3),
      hit('Fey Touch', 1.0, 'mag', 1, SAP(0.15)),
    ],
  }),
  mk({
    id: 'e_mireclaw',
    name: 'Dread Mireclaw',
    emoji: '🐊',
    level: 13,
    moves: [hit('Death Roll', 1.35, 'phys', 3), BITE('Crush')],
    drops: { m_iron_chunk: 0.4 },
  }),
  mk({
    id: 'e_drowned',
    name: 'Drowned Acolyte',
    emoji: '🌊',
    level: 14,
    moves: [hit('Tidal Slam', 1.15, 'phys', 3), hit('Drowned Prayer', 1.1, 'mag', 2)],
    drops: { q_toxin_sample: 0.4 },
  }),
  mk({
    id: 'e_serpent',
    name: 'Shrine Serpent',
    emoji: '🐍',
    level: 15,
    moves: [
      hit('Coil Strike', 1.25, 'phys', 3),
      hit('Venom Spit', 1.1, 'mag', 2, POISON(7)),
    ],
  }),
  mk({
    id: 'e_vosk',
    name: 'Bog Tyrant Vosk',
    emoji: '🐸',
    level: 16,
    boss: true,
    mul: { hp: 2.7, xp: 3, gold: 3.2, def: 1.3 },
    statusResist: 0.25,
    moves: [hit("Tyrant's Tongue", 1.3, 'phys', 3), hit('Miasma', 1.0, 'mag', 2, SAP(0.3))],
    special: { every: 3, move: hit('Swallow Whole', 1.9, 'phys', 1) },
    drops: { m_mystic_dust: 1.0, t_2: 0.5 },
    desc: 'The swamp has a king. It is hungry.',
  }),

  // ── Sunspire (ch3) ──────────────────────────────────────────────────
  mk({
    id: 'e_scarab',
    name: 'Gilded Scarab',
    emoji: '🪲',
    level: 16,
    moves: [hit('Mandible', 1.0, 'phys', 3), hit('Sun Flash', 0.9, 'mag', 1, SAP(0.15))],
    drops: { m_mystic_dust: 0.4 },
  }),
  mk({
    id: 'e_sentinel',
    name: 'Ruin Sentinel',
    emoji: '🗿',
    level: 17,
    mul: { hp: 1.35, spd: 0.6, def: 1.3 },
    moves: [
      hit('Stone Fist', 1.25, 'phys', 3),
      move('Guard Stance', 1, GUARD(0.4, 2)),
      // #79: an ordinary enemy casts a real ward through the same
      // mechanic player skills use.
      move('Runic Bulwark', 1, { kind: 'shield', amount: 45, duration: 2, timing: 'immediate' }),
    ],
  }),
  mk({
    id: 'e_vulture',
    name: 'Ash Vulture',
    emoji: '🦅',
    level: 17,
    mul: { hp: 0.85, spd: 1.3 },
    moves: [hit('Talon Dive', 1.2, 'phys', 3), BITE('Peck')],
    drops: { m_mystic_dust: 0.3 },
  }),
  mk({
    id: 'e_cultist',
    name: 'Sun Cultist',
    emoji: '☀️',
    level: 18,
    moves: [hit('Solar Dart', 1.2, 'mag', 3), hit('Fanatic Strike', 1.1, 'phys', 2)],
    drops: { c_ether: 0.2 },
  }),
  mk({
    id: 'e_spirelynx',
    name: 'Spire Lynx',
    emoji: '🐆',
    level: 18,
    mul: { spd: 1.4 },
    moves: [hit('Pounce', 1.3, 'phys', 3), CLAW('Rake')],
  }),
  mk({
    id: 'e_chronowisp',
    name: 'Chrono Wisp',
    emoji: '⏳',
    level: 19,
    mul: { hp: 0.8 },
    // Enemy-global opening (#80): fires in EVERY provenance, unlike the
    // boss-only Sovereign Ward. Slows the hero before round 1 begins.
    opening: {
      name: 'Chrono Anchor',
      effects: [{
        kind: 'statmod',
        target: 'opponent',
        stat: 'spd',
        pct: -0.2,
        duration: 2,
        timing: 'immediate',
        name: 'Chrono Anchor',
        line: '⏳ The wisp anchors you outside time.',
        tags: ['slow'],
      }],
    },
    moves: [hit('Time Scar', 1.25, 'mag', 3), hit('Stutter', 0.8, 'mag', 2, SAP(0.25))],
  }),
  mk({
    id: 'e_automaton',
    name: 'Brass Automaton',
    emoji: '⚙️',
    level: 20,
    mul: { def: 1.35, spd: 0.7 },
    moves: [hit('Piston Punch', 1.3, 'phys', 3), hit('Steam Vent', 1.1, 'mag', 2)],
    drops: { m_mystic_dust: 0.55 },
  }),
  mk({
    id: 'e_chronolich',
    name: 'The Chronolich',
    emoji: '💀',
    level: 22,
    boss: true,
    mul: { hp: 2.8, xp: 3, gold: 3.4, mag: 1.2, def: 1.3 },
    statusResist: 0.3,
    moves: [
      hit('Sandstream', 1.3, 'mag', 3),
      hit(
        'Ageing Touch',
        1.1,
        'mag',
        2,
        SLOW(0.3, 2, 'Withered', '⏳ Years wash over you — Withered!'),
      ),
    ],
    special: { every: 4, move: hit('Temporal Collapse', 2.1, 'mag', 1) },
    drops: { m_frost_core: 0.6, t_3: 0.5 },
    desc: 'It has counted every hour since the flame was lit. It wants the last one.',
  }),

  // ── Frostpeak (ch4) ─────────────────────────────────────────────────
  mk({
    id: 'e_icebat',
    name: 'Frost Bat',
    emoji: '🦇',
    level: 23,
    mul: { hp: 0.8, spd: 1.3 },
    moves: [
      hit(
        'Chill Bite',
        1.0,
        'phys',
        3,
        SLOW(0.2, 2, 'Chilled', '❄️ Your joints stiffen — Chilled!'),
      ),
      hit('Screech', 0.8, 'mag', 1, SAP(0.15)),
    ],
    drops: { m_frost_core: 0.3 },
  }),
  mk({
    id: 'e_bristlehorn',
    name: 'Bristlehorn',
    emoji: '🐐',
    level: 23,
    moves: [hit('Gore Charge', 1.3, 'phys', 3), CLAW('Hoof Stomp')],
  }),
  mk({
    id: 'e_marauder',
    name: 'Frost Marauder',
    emoji: '⚔️',
    level: 24,
    moves: [hit('Ice Axe', 1.25, 'phys', 3), hit('Shield Charge', 1.0, 'phys', 2)],
    drops: { c_greater_potion: 0.15 },
  }),
  mk({
    id: 'e_frostwraith',
    name: 'Frost Wraith',
    emoji: '❄️',
    level: 25,
    moves: [
      hit('Frozen Grasp', 1.25, 'mag', 3),
      hit(
        'Chill Whisper',
        1.0,
        'mag',
        2,
        SLOW(
          0.25,
          2,
          'Chilled',
          '❄️ The whisper freezes your marrow — Chilled!',
        ),
      ),
    ],
    drops: { m_frost_core: 0.5, q_frost_emblem: 0.4 },
  }),
  mk({
    id: 'e_iceling',
    name: 'Iceling',
    emoji: '🧊',
    level: 26,
    mul: { def: 1.3 },
    moves: [
      hit('Icicle Volley', 1.2, 'mag', 3),
      // #83: a SHELL is a real ward under #79 semantics — capacity that
      // absorbs before HP, expires, and is visible as such — not a private
      // mitigation stance. Guard Stance stays the mitigation move.
      move('Frost Shell', 1, {
        kind: 'shield',
        amount: 65,
        duration: 2,
        timing: 'immediate',
        name: 'Frost Shell',
      }),
    ],
  }),
  mk({
    id: 'e_yeti',
    name: 'Glacier Yeti',
    emoji: '🦣',
    level: 27,
    mul: { hp: 1.4, atk: 1.15 },
    moves: [hit('Avalanche Blow', 1.4, 'phys', 3), hit('Bellow', 0.8, 'phys', 1, SAP(0.2))],
    drops: { m_frost_core: 0.6 },
  }),
  mk({
    id: 'e_jormunis',
    name: 'Jormunis, the Glacier Wyrm',
    emoji: '🐉',
    level: 30,
    boss: true,
    mul: { hp: 3.0, xp: 3, gold: 3.6, def: 1.35, res: 1.3 },
    statusResist: 0.3,
    moves: [hit('Frost Breath', 1.45, 'mag', 3), hit('Tail Sweep', 1.2, 'phys', 2)],
    special: {
      every: 3,
      // #83: one coherent freeze policy — Absolute Zero is a devastating
      // strike plus a heavy Slow, not a separate unshipped status.
      move: hit(
        'Absolute Zero',
        2.0,
        'mag',
        1,
        SLOW(
          0.35,
          2,
          'Frozen Solid',
          '🧊 Absolute Zero locks your limbs — Frozen Solid!',
        ),
      ),
    },
    drops: { m_frost_core: 1.0, t_4: 0.6 },
    desc: "The mountain's heartbeat, coiled around the flame's twin.",
  }),

  // ── Cinder Wastes (ch5) ─────────────────────────────────────────────
  mk({
    id: 'e_magmaslime',
    name: 'Magma Slime',
    emoji: '🌋',
    level: 31,
    mul: { hp: 1.3, spd: 0.6 },
    moves: [
      hit('Lava Engulf', 1.3, 'mag', 3),
      // #83: a crust is a real ward under #79 semantics.
      move('Cooled Crust', 1, {
        kind: 'shield',
        amount: 75,
        duration: 2,
        timing: 'immediate',
        name: 'Cooled Crust',
      }),
    ],
    drops: { m_cinder_heart: 0.3 },
  }),
  mk({
    id: 'e_emberimp',
    name: 'Ember Imp',
    emoji: '👹',
    level: 31,
    mul: { hp: 0.8, spd: 1.3 },
    moves: [hit('Cinder Fling', 1.2, 'mag', 3), hit('Mischief', 0.9, 'mag', 2, SAP(0.2))],
    drops: { m_cinder_heart: 0.35 },
  }),
  mk({
    id: 'e_cinderhound',
    name: 'Cinder Hound',
    emoji: '🔥',
    level: 32,
    moves: [hit('Blazing Bite', 1.3, 'phys', 3, BURN(8)), hit('Ember Howl', 1.0, 'mag', 2)],
  }),
  mk({
    id: 'e_revenant',
    name: 'Ashen Revenant',
    emoji: '👻',
    level: 33,
    moves: [
      hit('Withering Touch', 1.3, 'mag', 3),
      hit('Sorrow Wail', 1.0, 'mag', 2, SAP(0.25)),
    ],
    drops: { m_cinder_heart: 0.45, q_cinder_sigil: 0.35 },
  }),
  mk({
    id: 'e_salamander',
    name: 'Fire Salamander',
    emoji: '🦎',
    level: 34,
    moves: [hit('Flame Whip', 1.35, 'mag', 3), hit('Molten Tail', 1.2, 'phys', 2)],
  }),
  mk({
    id: 'e_forge_warden',
    name: 'Forge Warden',
    emoji: '⚒️',
    level: 35,
    mul: { def: 1.35, hp: 1.2 },
    moves: [
      hit('Hammer Fall', 1.4, 'phys', 3),
      move('Molten Guard', 1, GUARD(0.5, 2)),
    ],
    drops: { m_cinder_heart: 0.5 },
  }),
  mk({
    id: 'e_ignivar',
    name: 'Ignivar, the Last Flame',
    emoji: '🔥',
    level: 38,
    boss: true,
    // #88: the campaign sim exposed this fight as unwinnable — a 3.2× pool
    // with a 12%-per-4-rounds rekindle (~58 HP/round on the scaled pool)
    // out-paced every hero's sustained damage at the authored band (all
    // classes, both policies: 0/16; cleric fights stalled at the cap).
    // Tuned to the ch2–ch4 boss envelope; probed winnable at 37–38.
    mul: { hp: 2.4, xp: 3, gold: 3.8, mag: 1.3, def: 1.35 },
    statusResist: 0.3,
    moves: [hit('Solar Flare', 1.3, 'mag', 3), hit('Cinder Storm', 1.1, 'mag', 2)],
    special: { every: 4, move: move('Rekindling', 1, HEAL(0.05)) },
    drops: { m_cinder_heart: 1.0, t_5: 0.6 },
    desc: 'The oldest fire still burning. Tired. Cornered. Dangerous.',
  }),

  // ── Umbral Spire (ch6) ──────────────────────────────────────────────
  mk({
    id: 'e_shade',
    name: 'Umbral Shade',
    emoji: '🌑',
    level: 39,
    // #92: plain damage — "null" promised nullification the spec never had.
    moves: [hit('Void Grasp', 1.3, 'mag', 3), hit('Fade', 1.0, 'mag', 2, SAP(0.25))],
    drops: { m_void_fragment: 0.3 },
  }),
  mk({
    id: 'e_watcher',
    name: 'Watcher Eye',
    emoji: '👁️',
    level: 39,
    // #92: the gaze lands the documented Petrify flavor of Slow — a real
    // SPD rider under the shared vocabulary (resist/cleanse/UI), not a
    // name overpromising plain damage.
    moves: [
      hit(
        'Petrify Gaze',
        1.25,
        'mag',
        3,
        SLOW(0.25, 2, 'Petrified', '👁️ The gaze sets in — Petrified!'),
      ),
      hit('Blink Strike', 1.2, 'phys', 2),
    ],
  }),
  mk({
    id: 'e_shattered',
    name: 'Shattered Knight',
    emoji: '🛡️',
    level: 40,
    mul: { def: 1.4, hp: 1.25 },
    moves: [hit('Broken Blade', 1.35, 'phys', 3), hit("Oath's Remnant", 1.1, 'mag', 2)],
  }),
  mk({
    id: 'e_horror',
    name: 'Umbral Horror',
    emoji: '🦑',
    level: 41,
    moves: [
      hit('Crushing Tendril', 1.4, 'phys', 3),
      hit('Mind Static', 1.2, 'mag', 2, SAP(0.3)),
    ],
    drops: { m_void_fragment: 0.4 },
  }),
  mk({
    id: 'e_nightgaunt',
    name: 'Nightgaunt',
    emoji: '👤',
    level: 41,
    mul: { spd: 1.4 },
    moves: [hit('Silent Talon', 1.35, 'phys', 3), hit('Cold Embrace', 1.15, 'mag', 2)],
  }),
  mk({
    id: 'e_crownsworn',
    name: 'Crownsworn Blade',
    emoji: '⚔️',
    level: 42,
    moves: [hit('Loyal Edge', 1.4, 'phys', 3), hit("King's Command", 1.2, 'mag', 2)],
    drops: { m_void_fragment: 0.45 },
  }),
  mk({
    id: 'e_regalia',
    name: 'Regalia Guardian',
    emoji: '👑',
    level: 43,
    mul: { def: 1.45, hp: 1.3 },
    moves: [
      hit('Sovereign Strike', 1.45, 'phys', 3),
      hit('Royal Decree', 1.25, 'mag', 2, SAP(0.25)),
    ],
  }),
  mk({
    id: 'e_aldric',
    name: 'King Aldric the Sundered',
    emoji: '👑',
    level: 45,
    boss: true,
    // #88: the campaign sim exposed the same wall Ignivar had — a 3.4×
    // pool behind 1.4× defenses and a 2.2×-MAG special every 3 rounds
    // one-shot squishies at the authored band (every class 0/16 with the
    // plain rotation; mage fights ended in ~4 rounds). Tuned to stay the
    // hardest fight in the game while remaining winnable with tactics.
    mul: { hp: 2.6, xp: 4, gold: 4, atk: 1.2, mag: 1.25, def: 1.3, res: 1.25 },
    statusResist: 0.3,
    // #79: the Sundered King opens boss-provenance fights behind a large
    // one-time ward (long expiry, no regeneration, not dispellable).
    openingShield: { amount: 250, duration: 4, name: 'Sovereign Ward' },
    moves: [
      hit('Sundering Blow', 1.1, 'phys', 3),
      // #79: the king's will cuts through wards untouched — shield-
      // bypassing damage, endgame texture plus a resolver regression path.
      move('Wardrender', 1, { kind: 'damage', attack: 'phys', power: 0.95, bypassShield: true }),
      // #79: the sap only lands on flesh — a fully-shielded Crown never
      // weakens (requireHpDamage rider gating).
      hit('Crown of Night', 1.05, 'mag', 2, { ...SAP(0.3), requireHpDamage: true }),
    ],
    special: { every: 3, move: hit('Divide the Flame', 1.15, 'mag', 1) },
    drops: { m_void_fragment: 1.0, t_6: 0.7 },
    desc: 'He split the flame to rule both halves. He lost himself in the seam.',
  }),

  // ── The Abyss (postgame) ────────────────────────────────────────────
  mk({
    id: 'e_voidspawn',
    name: 'Voidspawn',
    emoji: '🕳️',
    level: 45,
    moves: [hit('Unmaking', 1.5, 'mag', 3), hit('Hunger', 1.3, 'phys', 2)],
    drops: { m_void_fragment: 0.5 },
  }),
  mk({
    id: 'e_nullhound',
    name: 'Null Hound',
    emoji: '🐕',
    level: 45,
    mul: { spd: 1.4 },
    moves: [hit('Phantom Bite', 1.45, 'phys', 3), hit('Chase', 1.25, 'phys', 2)],
  }),
  mk({
    id: 'e_echo',
    name: 'Echo of a Hero',
    emoji: '🗡️',
    level: 45,
    mul: { hp: 1.2 },
    moves: [hit('Remembered Strike', 1.5, 'phys', 3), hit('Forgotten Skill', 1.35, 'mag', 2)],
    desc: 'Everyone who sought the crown left an echo here.',
  }),
  mk({
    id: 'e_warden',
    name: 'Warden of the Void',
    emoji: '🌌',
    level: 45,
    boss: true,
    // #88: the campaign sim exposed the same wall pattern (3.6× pool,
    // 1.45/1.4 shells, a 2.3×-MAG special every 3 rounds) — unwinnable at
    // the authored band by any class. Tuned to stay the void's last word
    // while remaining winnable with real play (#88 probes).
    mul: { hp: 2.6, xp: 4, gold: 4.5, atk: 1.25, mag: 1.3, def: 1.3, res: 1.25 },
    statusResist: 0.3,
    moves: [
      hit('Void Lance', 1.2, 'mag', 3),
      hit('Entropy Field', 1.1, 'mag', 2, SAP(0.3)),
    ],
    special: {
      every: 3,
      // #83: "Final Silence" silences your VOICE — it strips one active
      // blessing (dispel) on top of the strike. The Silence ACTION-status
      // is deliberately NOT shipped (#83: explicit action-category policy
      // and AI fallback required first).
      move: move(
        'Final Silence',
        1,
        { kind: 'damage', attack: 'mag', power: 1.2 },
        { kind: 'dispel', target: 'opponent', tags: ['beneficial'], max: 1 },
      ),
    },
    drops: { m_void_fragment: 1.0, t_7: 0.5 },
    desc: 'It guards nothing now. It simply ends those who arrive.',
  }),
];

const ENEMY_INDEX = new Map(ENEMIES.map((e) => [e.id, e]));

export function enemy(id: string): EnemyDef | undefined {
  return ENEMY_INDEX.get(id);
}

export function enemyName(id: string): string {
  return ENEMY_INDEX.get(id)?.name ?? id;
}
