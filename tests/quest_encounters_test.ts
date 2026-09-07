import { assert, assertEquals } from '@std/assert';
import { quest, QUESTS } from '../src/content/quests.ts';
import type { ExploreEvent, QuestEncounterBoost } from '../src/content/types.ts';
import { zone, ZONES } from '../src/content/zones.ts';
import { createPlayer } from '../src/engine/character.ts';
import { addItem } from '../src/engine/inventory.ts';
import {
  acceptQuest,
  grantItem,
  questObjectivePending,
  syncAvailability,
} from '../src/engine/quests.ts';
import { weightedIndex } from '../src/engine/rng.ts';
import type { QuestOutcome, QuestProgress } from '../src/engine/types.ts';
import { explore, questEncounterWeights, resolveVictory } from '../src/engine/world.ts';

const stagBoost: QuestEncounterBoost = {
  questId: 'sq_stag',
  objective: { kind: 'kill', target: 'e_stag' },
  weight: 18,
};
const ironBoost: QuestEncounterBoost = {
  questId: 'm5_arms',
  objective: { kind: 'collect', target: 'm_iron_chunk' },
  weight: 5,
};
const oreBoost: QuestEncounterBoost = { ...ironBoost, questId: 'sq_ore', weight: 9 };
const quiet: ExploreEvent = { kind: 'flavor', text: 'Quiet.', weight: 2 };

function hunter() {
  const player = createPlayer(226, 'Hunter', 'warrior');
  player.level = 7;
  player.currentZone = 'whisperwood';
  player.quests['m3_roots'] = { status: 'done', counts: [] };
  syncAvailability(player);
  return player;
}

function ironEvent(boosts: readonly QuestEncounterBoost[], weight = 1): ExploreEvent {
  return {
    kind: 'treasure',
    item: 'm_iron_chunk',
    text: 'Iron.',
    weight,
    questBoosts: boosts,
  };
}

Deno.test('quest encounters: authored references and boost weights are valid', () => {
  for (const zoneDef of ZONES) {
    for (const event of zoneDef.explore) {
      for (const boost of event.questBoosts ?? []) {
        const questDef = quest(boost.questId);
        assert(questDef, `${zoneDef.id}: unknown boost quest ${boost.questId}`);
        assert(
          questDef.objectives.some((objective) =>
            objective.kind === boost.objective.kind && objective.target === boost.objective.target
          ),
          `${zoneDef.id}: boost must identify an objective of ${questDef.id}`,
        );
        assert(Number.isFinite(event.weight) && event.weight > 0);
        assert(
          boost.weight === 'guaranteed' ||
            (Number.isFinite(boost.weight) && boost.weight > event.weight),
          `${zoneDef.id}: numeric boost must be finite and greater than base weight`,
        );
      }
    }
  }
});

Deno.test('quest encounters: only active unfinished objectives qualify, without mutation', () => {
  const player = hunter();
  const statuses: QuestProgress['status'][] = [
    'unavailable',
    'available',
    'active',
    'turnIn',
    'done',
  ];
  for (const status of statuses) {
    player.quests['sq_stag'] = { status, counts: [0] };
    const before = structuredClone(player);
    assertEquals(
      questObjectivePending(player, 'sq_stag', stagBoost.objective),
      status === 'active',
    );
    assertEquals(player, before);
  }
  player.quests['sq_stag'] = { status: 'active', counts: [1] };
  assertEquals(questObjectivePending(player, 'sq_stag', stagBoost.objective), false);
  player.quests['sq_stag'].counts = [0];
  const outcomes: QuestOutcome[] = [
    { kind: 'locked', at: 0 },
    { kind: 'failed', at: 0 },
    { kind: 'resolved', outcome: 'test', at: 0 },
  ];
  for (const outcome of outcomes) {
    player.questOutcomes['sq_stag'] = outcome;
    assertEquals(questObjectivePending(player, 'sq_stag', stagBoost.objective), false);
  }
  assertEquals(questObjectivePending(player, 'missing', stagBoost.objective), false);
  assertEquals(questObjectivePending(player, 'm3_roots', stagBoost.objective), false);
});

Deno.test('quest encounters: completed collection objective stops while another objective is pending', () => {
  const player = hunter();
  player.quests['m2_letter'] = { status: 'active', counts: [0, 0] };
  const objective = { kind: 'collect' as const, target: 'q_sealed_letter' };
  assert(questObjectivePending(player, 'm2_letter', objective));
  grantItem(player, 'q_sealed_letter');
  assertEquals(player.quests['m2_letter'].status, 'active');
  assertEquals(questObjectivePending(player, 'm2_letter', objective), false);
  assert(
    questObjectivePending(player, 'm2_letter', {
      kind: 'storyEvent',
      target: 'heard_bram_reading',
    }),
  );
});

Deno.test('quest encounters: shared target uses strongest rule, independent of order and duplicates', () => {
  const player = hunter();
  player.quests['m5_arms'] = { status: 'active', counts: [0] };
  player.quests['sq_ore'] = { status: 'active', counts: [0] };
  for (const boosts of [[ironBoost, oreBoost], [oreBoost, ironBoost, oreBoost]]) {
    const pool = [ironEvent(boosts), quiet];
    const before = structuredClone(pool);
    assertEquals(questEncounterWeights(player, pool), [9, 2]);
    assertEquals(pool, before);
  }
  // Two chunks finish the main quest, but the side quest needs three.
  grantItem(player, 'm_iron_chunk', 2);
  assertEquals(player.quests['m5_arms'].status, 'turnIn');
  assertEquals(questEncounterWeights(player, [ironEvent([ironBoost, oreBoost]), quiet]), [9, 2]);
  grantItem(player, 'm_iron_chunk');
  assertEquals(questEncounterWeights(player, [ironEvent([ironBoost, oreBoost]), quiet]), [1, 2]);
});

Deno.test('quest encounters: finishing or excluding strongest shared rule preserves weaker assistance', () => {
  const player = hunter();
  player.quests['m5_arms'] = { status: 'active', counts: [0] };
  player.quests['sq_ore'] = { status: 'turnIn', counts: [0] };
  const pool = [ironEvent([oreBoost, ironBoost]), quiet];
  assertEquals(questEncounterWeights(player, pool), [5, 2]);
  player.quests['sq_ore'].status = 'active';
  player.questOutcomes['sq_ore'] = { kind: 'locked', at: 0 };
  assertEquals(questEncounterWeights(player, pool), [5, 2]);
});

Deno.test('quest encounters: distinct numeric targets coexist without quest-order priority', () => {
  const player = hunter();
  player.quests['sq_stag'] = { status: 'active', counts: [0] };
  player.quests['m5_arms'] = { status: 'active', counts: [0] };
  const stag: ExploreEvent = {
    kind: 'battle',
    enemy: 'e_stag',
    weight: 1,
    questBoosts: [stagBoost],
  };
  assertEquals(questEncounterWeights(player, [stag, ironEvent([ironBoost]), quiet]), [18, 5, 2]);
  assertEquals(questEncounterWeights(player, [quiet, ironEvent([ironBoost]), stag]), [2, 5, 18]);
});

Deno.test('quest encounters: guarantees share base weights and release other boosts on completion', () => {
  const player = hunter();
  player.quests['m5_arms'] = { status: 'active', counts: [0] };
  player.quests['sq_ore'] = { status: 'active', counts: [0] };
  player.quests['sq_stag'] = { status: 'active', counts: [0] };
  const pool: ExploreEvent[] = [
    ironEvent([{ ...ironBoost, weight: 'guaranteed' }, oreBoost]),
    ironEvent([{ ...oreBoost, weight: 'guaranteed' }], 3),
    { kind: 'battle', enemy: 'e_stag', weight: 1, questBoosts: [stagBoost] },
    quiet,
  ];
  assertEquals(questEncounterWeights(player, pool), [1, 3, 0, 0]);
  assertEquals(questEncounterWeights(player, [...pool].reverse()), [0, 0, 3, 1]);
  assertEquals(weightedIndex(() => 0, questEncounterWeights(player, pool)), 0);
  assertEquals(weightedIndex(() => 0.25, questEncounterWeights(player, pool)), 1);
  assertEquals(weightedIndex(() => 0.999999, questEncounterWeights(player, pool)), 1);
  grantItem(player, 'm_iron_chunk', 2);
  assertEquals(questEncounterWeights(player, pool), [0, 3, 0, 0]);
  grantItem(player, 'm_iron_chunk');
  assertEquals(questEncounterWeights(player, pool), [1, 3, 18, 2]);
});

Deno.test('quest encounters: no applicable rule preserves baseline weights and selection', () => {
  const player = hunter();
  for (const zoneDef of ZONES) {
    const weights = questEncounterWeights(player, zoneDef.explore);
    assertEquals(weights, zoneDef.explore.map((event) => event.weight));
    for (const roll of [0, 0.2, 0.5, 0.999999]) {
      assertEquals(
        weightedIndex(() => roll, weights),
        weightedIndex(() => roll, zoneDef.explore.map((event) => event.weight)),
      );
    }
  }
});

Deno.test('quest encounters: accepted stag hunt is 50%, victory restores 1/19 and announces readiness', () => {
  const player = hunter();
  assert(acceptQuest(player, 'sq_stag', 'npc_warden_tom').ok);
  const pool = zone('whisperwood')!.explore;
  const weights = questEncounterWeights(player, pool);
  assertEquals(weights.reduce((total, weight) => total + weight, 0), 36);
  const stagIndex = pool.findIndex((event) => event.kind === 'elite' && event.enemy === 'e_stag');
  assertEquals(weights[stagIndex], 18);
  // Evenly spaced deterministic rolls cover the actual Explore selection.
  let sightings = 0;
  for (let rollIndex = 0; rollIndex < 360; rollIndex++) {
    const outcome = explore(structuredClone(player), () => (rollIndex + 0.5) / 360);
    if (outcome.kind === 'battle' && outcome.battle.enemy.id === 'e_stag') sightings++;
  }
  assertEquals(sightings, 180);
  const outcome = explore(player, () => 0.4);
  assert(outcome.kind === 'battle');
  assertEquals(outcome.battle.enemy.id, 'e_stag');
  assertEquals(outcome.battle.origin, { kind: 'elite', zoneId: 'whisperwood' });
  assertEquals(outcome.battle.enemy.isBoss, false);
  outcome.battle.enemy.hp = 0;
  const lines = resolveVictory(player, outcome.battle, () => 0.9);
  assertEquals(player.quests['sq_stag'].status, 'turnIn');
  assertEquals(lines.filter((line) => line.includes('ready to turn in')).length, 1);
  const ordinary = questEncounterWeights(player, pool);
  assertEquals(ordinary[stagIndex], 1);
  assertEquals(ordinary.reduce((total, weight) => total + weight, 0), 19);
  const next = explore(player, () => 0.4);
  assert(next.kind !== 'battle' || next.battle.enemy.id !== 'e_stag');
});

Deno.test('quest encounters: guaranteed enemies still respect minimum and maximum levels and haven safety', () => {
  const player = hunter();
  player.quests['sq_stag'] = { status: 'active', counts: [0] };
  const zoneDef = zone('whisperwood')!;
  const original = zoneDef.explore;
  zoneDef.explore = [
    {
      kind: 'battle',
      enemy: 'e_stag',
      weight: 1,
      minPlayerLevel: 5,
      maxPlayerLevel: 9,
      questBoosts: [{ ...stagBoost, weight: 'guaranteed' }],
    },
    quiet,
  ];
  try {
    for (const level of [4, 10]) {
      player.level = level;
      assertEquals(explore(player, () => 0), { kind: 'result', lines: ['Quiet.'] });
    }
    player.level = 5;
    assertEquals(explore(player, () => 0.999999).kind, 'battle');
    const haven = zone('emberdawn')!;
    const havenOriginal = haven.explore;
    haven.explore = zoneDef.explore;
    try {
      player.currentZone = haven.id;
      assertEquals(explore(player, () => 0), { kind: 'result', lines: ['Quiet.'] });
    } finally {
      haven.explore = havenOriginal;
    }
  } finally {
    zoneDef.explore = original;
  }
});

Deno.test('quest encounters: guaranteed treasure uses live bag progress and respects exhausted forage', () => {
  const player = hunter();
  player.currentZone = 'emberdawn';
  player.quests['m5_arms'] = { status: 'active', counts: [0] };
  const zoneDef = zone(player.currentZone)!;
  const original = zoneDef.explore;
  zoneDef.explore = [ironEvent([{ ...ironBoost, weight: 'guaranteed' }]), quiet];
  try {
    addItem(player, 'm_iron_chunk');
    const outcome = explore(player, () => 0.999999, 0);
    assert(outcome.kind === 'result');
    assert(outcome.lines.some((line) => line.includes('ready to turn in')));
    assertEquals(player.quests['m5_arms'].status, 'turnIn');
    assertEquals(explore(player, () => 0.999999, 0), { kind: 'result', lines: ['Quiet.'] });
    player.quests['sq_ore'] = { status: 'active', counts: [0] };
    zoneDef.explore = [ironEvent([{ ...oreBoost, weight: 'guaranteed' }]), quiet];
    player.flags['forage_emberdawn'] = 3;
    player.flags['forageReset_emberdawn'] = 1000;
    assertEquals(explore(player, () => 0, 0), { kind: 'result', lines: ['Quiet.'] });
    assertEquals(player.quests['sq_ore'].status, 'active');
  } finally {
    zoneDef.explore = original;
  }
});

Deno.test('quest encounters: objective selectors cannot borrow an objective from another quest', () => {
  const player = hunter();
  for (const questDef of QUESTS) {
    player.quests[questDef.id] = { status: 'active', counts: [] };
  }
  assertEquals(questObjectivePending(player, 'sq_ore', stagBoost.objective), false);
  assertEquals(questObjectivePending(player, 'sq_stag', ironBoost.objective), false);
});
