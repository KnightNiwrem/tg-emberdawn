/**
 * Mechanical summary renderer tests (#120): the shared pure renderer in
 * engine/mechanics.ts must describe every shipped effect shape with the
 * canonical rules vocabulary (Shield, DEF/RES, rounds/actions, harmful/
 * beneficial effects). These tests cover the RENDERER across
 * representative shapes — they never scan names or flavor text for
 * vocabulary; creative wording is explicitly out of scope.
 */

import { assertEquals } from '@std/assert';
import type { EffectSpec } from '../src/content/types.ts';
import {
  consumableEffectLines,
  FOE_VOICE,
  mechanicsLines,
  mechanicsText,
} from '../src/engine/mechanics.ts';

const txt = (specs: EffectSpec[]): string => mechanicsText(specs);

Deno.test('mechanics: damage shape discloses power, target stat, execute and Shield bypass', () => {
  assertEquals(
    txt([{ kind: 'damage', attack: 'phys', power: 1.35 }]),
    'Deals 135% ATK damage.',
  );
  assertEquals(
    txt([{ kind: 'damage', attack: 'mag', power: 2.6, bypassShield: true }]),
    'Deals 260% MAG damage. Ignores Shield.',
  );
  assertEquals(
    txt([{
      kind: 'damage',
      attack: 'phys',
      power: 2.4,
      execute: { belowPct: 0.35, bonusPct: 0.5 },
    }]),
    'Deals 240% ATK damage (+50% against targets below 35% HP).',
  );
});

Deno.test('mechanics: restoration shapes disclose every leg', () => {
  assertEquals(
    txt([{ kind: 'restore', hpPower: 1.1, hpFlat: 20 }]),
    'Restores 220% of MAG + 20 HP.',
  );
  assertEquals(txt([{ kind: 'restore', hpPctOfMax: 0.3 }]), 'Restores 30% of max HP.');
  assertEquals(txt([{ kind: 'restore', hpFull: true }]), 'Fully restores HP.');
  assertEquals(txt([{ kind: 'restore', mpPctOfMax: 0.08 }]), 'Restores 8% of max MP.');
});

Deno.test('mechanics: lifesteal is derived from the dealt damage', () => {
  assertEquals(
    txt([{ kind: 'lifesteal', pct: 0.5 }]),
    'Restores 50% of the damage dealt as HP.',
  );
});

Deno.test('mechanics: stat modifiers cover every stat key and target side', () => {
  assertEquals(
    txt([{ kind: 'statmod', stat: 'atk', pct: 0.35, duration: 3, timing: 'defer' }]),
    'Raises your ATK by 35% for 3 rounds.',
  );
  assertEquals(
    txt([{
      kind: 'statmod',
      target: 'opponent',
      stat: 'res',
      pct: -0.25,
      duration: 2,
      timing: 'immediate',
    }]),
    "Lowers the target's RES by 25% for 2 rounds.",
  );
  assertEquals(
    txt([{
      kind: 'statmod',
      target: 'opponent',
      stat: 'incoming',
      pct: 0.25,
      duration: 3,
      timing: 'immediate',
    }]),
    'Increases the damage the target takes by 25% for 3 rounds.',
  );
  assertEquals(
    txt([{
      kind: 'statmod',
      target: 'opponent',
      stat: 'outgoing',
      pct: -0.3,
      duration: 2,
      timing: 'immediate',
    }]),
    'Reduces the damage the target deals by 30% for 2 rounds.',
  );
  assertEquals(
    txt([{ kind: 'statmod', stat: 'mitigation', pct: 0.4, duration: 2, timing: 'immediate' }]),
    'Raises your damage mitigation by 40% for 2 rounds.',
  );
  assertEquals(
    txt([{ kind: 'statmod', stat: 'spd', pct: 0.45, duration: 3, timing: 'defer' }]),
    'Raises your SPD by 45% for 3 rounds.',
  );
  // Battle-lifetime statmods never claim an ordinary numeric duration.
  assertEquals(
    txt([{
      kind: 'statmod',
      stat: 'atk',
      pct: 0.1,
      duration: 1,
      timing: 'immediate',
      lifetime: 'battle',
    }]),
    'Raises your ATK by 10% for the rest of the battle.',
  );
});

Deno.test('mechanics: control discloses chance and consumed actions', () => {
  assertEquals(
    txt([{ kind: 'control', control: 'stun', actions: 1 }]),
    'Stuns the target: it loses its next action.',
  );
  assertEquals(
    txt([{
      kind: 'control',
      control: 'stun',
      actions: 2,
      chance: 0.35,
      requireSurvivor: true,
    }]),
    '35% chance to stun the target: it loses its next 2 actions. Only if the target survives the strike.',
  );
});

Deno.test('mechanics: periodics disclose name, amount, tick phase, duration and Shield policy', () => {
  assertEquals(
    txt([{
      kind: 'periodic',
      perRound: -12,
      duration: 3,
      tickPhase: 'roundEnd',
      name: 'Burn',
      tags: ['burn'],
    }]),
    'Inflicts Burn: 12 damage at the end of each round for 3 rounds.',
  );
  assertEquals(
    txt([{
      kind: 'periodic',
      perRound: -16,
      duration: 3,
      tickPhase: 'roundEnd',
      name: 'Venom',
      tags: ['poison', 'harmful'],
      bypassShield: true,
    }]),
    'Inflicts Venom: 16 damage at the end of each round for 3 rounds. Venom ignores Shield.',
  );
  assertEquals(
    txt([{
      kind: 'periodic',
      perRound: 14,
      duration: 3,
      tickPhase: 'roundEnd',
      name: 'Renew',
    }]),
    'Restores 14 HP at the end of each round for 3 rounds.',
  );
  assertEquals(
    txt([{
      kind: 'periodic',
      pctOfMaxPerRound: -0.02,
      duration: 5,
      tickPhase: 'roundEnd',
      name: 'Decay',
      tags: ['harmful'],
    }]),
    'Inflicts Decay: 2% of max HP damage at the end of each round for 5 rounds.',
  );
  assertEquals(
    txt([{
      kind: 'periodic',
      perRound: -8,
      duration: 2,
      tickPhase: 'playerTurnStart',
      name: 'Rot',
      tags: ['harmful'],
    }]),
    'Inflicts Rot: 8 damage at the start of its turn for 2 rounds.',
  );
});

Deno.test('mechanics: cleanse and dispel use the canonical effect categories', () => {
  assertEquals(
    txt([{ kind: 'cleanse', tags: ['harmful'] }]),
    'Removes all removable harmful effects.',
  );
  // Singular agreement (#134): a cap of 1 takes the singular noun.
  assertEquals(
    txt([{ kind: 'cleanse', tags: ['harmful'], max: 1 }]),
    'Removes up to 1 harmful effect.',
  );
  assertEquals(
    txt([{ kind: 'cleanse', tags: ['harmful'], max: 3 }]),
    'Removes up to 3 harmful effects.',
  );
  assertEquals(
    txt([{ kind: 'dispel', target: 'opponent', tags: ['beneficial'], max: 1 }]),
    'Removes up to 1 beneficial effect from the target.',
  );
  assertEquals(
    mechanicsText([{ kind: 'dispel', target: 'opponent', tags: ['beneficial'] }], {
      opponent: FOE_VOICE,
    }),
    'Removes all removable beneficial effects from the foe.',
  );
});

Deno.test('mechanics: resource and shield shapes', () => {
  assertEquals(
    txt([{ kind: 'resource', mpPctOfMax: 0.1 }]),
    'Restores 10% of max MP.',
  );
  assertEquals(
    txt([{ kind: 'shield', amount: 25, duration: 3, timing: 'immediate' }]),
    'Grants Shield equal to 25 for 3 rounds.',
  );
  assertEquals(
    txt([{
      kind: 'shield',
      magPower: 1.2,
      amount: 20,
      duration: 3,
      timing: 'immediate',
    }]),
    'Grants Shield equal to 240% MAG + 20 for 3 rounds.',
  );
  assertEquals(
    txt([{
      kind: 'shield',
      defPower: 0.9,
      amount: 10,
      duration: 3,
      timing: 'immediate',
    }]),
    'Grants Shield equal to 180% DEF + 10 for 3 rounds.',
  );
  assertEquals(
    txt([{
      kind: 'shield',
      defPower: 1.1,
      amount: 30,
      duration: 1,
      timing: 'immediate',
      lifetime: 'battle',
      name: 'Unbroken',
    }]),
    'Grants Shield equal to 220% DEF + 30 for the rest of the battle.',
  );
});

Deno.test('mechanics: chance, stacking and rider conditions are disclosed', () => {
  assertEquals(
    txt([{
      kind: 'statmod',
      target: 'opponent',
      stat: 'incoming',
      pct: 0.25,
      duration: 3,
      timing: 'immediate',
      chance: 0.6,
    }]),
    '60% chance: Increases the damage the target takes by 25% for 3 rounds.',
  );
  assertEquals(
    txt([
      { kind: 'restore', hpPctOfMax: 0.3 },
      { kind: 'statmod', stat: 'atk', pct: 0.2, duration: 2, timing: 'defer', stacking: 'stack' },
    ]),
    'Restores 30% of max HP. Raises your ATK by 20% for 2 rounds. Applications stack.',
  );
  assertEquals(
    txt([{
      kind: 'damage',
      attack: 'phys',
      power: 3.1,
    }, {
      kind: 'statmod',
      target: 'opponent',
      stat: 'def',
      pct: -0.25,
      duration: 2,
      timing: 'immediate',
      requireSurvivor: true,
    }]),
    "Deals 310% ATK damage. Lowers the target's DEF by 25% for 2 rounds. Only if the target survives the strike.",
  );
});

Deno.test('mechanics: multi-effect skills render in deterministic authored order', () => {
  const lines = mechanicsLines([
    { kind: 'damage', attack: 'phys', power: 1.25 },
    {
      kind: 'periodic',
      perRound: -16,
      duration: 3,
      tickPhase: 'roundEnd',
      name: 'Venom',
      tags: ['poison', 'harmful'],
      bypassShield: true,
    },
  ]);
  assertEquals(lines, [
    'Deals 125% ATK damage.',
    'Inflicts Venom: 16 damage at the end of each round for 3 rounds.',
    'Venom ignores Shield.',
  ]);
});

Deno.test('mechanics: trigger effects phrase the target as the foe', () => {
  assertEquals(
    mechanicsText([{
      kind: 'statmod',
      target: 'opponent',
      stat: 'spd',
      pct: -0.25,
      duration: 2,
      timing: 'immediate',
    }], { opponent: FOE_VOICE }),
    "Lowers the foe's SPD by 25% for 2 rounds.",
  );
});

Deno.test('mechanics: consumable bag effects generate their exact disclosure', () => {
  assertEquals(consumableEffectLines({ healHp: 60 }), ['Restores 60 HP.']);
  assertEquals(consumableEffectLines({ healMp: 120 }), ['Restores 120 MP.']);
  assertEquals(consumableEffectLines({ cureStatus: true }), [
    'Removes all removable harmful effects.',
  ]);
  assertEquals(consumableEffectLines({ flee: true }), ['Guaranteed escape from normal fights.']);
  assertEquals(consumableEffectLines({ revivePct: 50 }), [
    'Auto-revives you at 50% HP when felled.',
  ]);
});
