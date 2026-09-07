/**
 * Narrative state (#125): the declarative condition language, the decision
 * ledger with provenance, permanent quest outcomes (lockout never
 * resurrects), and the atomic, idempotent story-effect vocabulary.
 */

import { assert, assertEquals } from '@std/assert';
import { namedOutcome } from './helpers.ts';
import type { Condition } from '../src/content/types.ts';
import { evalCondition } from '../src/engine/conditions.ts';
import {
  applyStoryEffects,
  type StoryContext,
  storyNoticeLines,
  validateStoryBundle,
} from '../src/engine/story.ts';
import { createPlayer } from '../src/engine/character.ts';
import { addItem } from '../src/engine/inventory.ts';
import {
  acceptQuest,
  levelLockedMain,
  questExcluded,
  syncAvailability,
} from '../src/engine/quests.ts';
import { quest } from '../src/content/quests.ts';
import { npcTopics } from '../src/engine/npc.ts';
import { findUnresolvedPersistedIds } from '../src/engine/validate.ts';
import type { PlayerState } from '../src/engine/types.ts';

const ctx: StoryContext = {
  dialogueId: 'dlg_test',
  nodeId: 'n1',
  npcId: 'npc_maren',
  now: 1700000000000,
};

function hero(id: number): PlayerState {
  return createPlayer(id, 'T', 'warrior');
}

// ── condition language ───────────────────────────────────────────────────

Deno.test('conditions: all/any/not compose arbitrarily and evaluate pure', () => {
  const player = hero(1300);
  player.level = 5;
  player.flags['ember_lit'] = true;
  player.flags['bells'] = 3;
  addItem(player, 'm_ember_shard', 2);
  player.quests['m1_embers'] = { status: 'done', counts: [4] };
  player.currentZone = 'whisperwood';

  const condition: Condition = {
    all: [
      { levelAtLeast: 5 },
      { flag: { id: 'ember_lit' } },
      { flag: { id: 'bells', equals: 3 } },
      { ownsItem: { itemId: 'm_ember_shard', count: 2 } },
      { inZone: 'whisperwood' },
      {
        any: [
          { questStatus: { questId: 'm1_embers', is: 'done' } },
          { decision: { id: 'never_made' } },
        ],
      },
      { not: { questStatus: { questId: 'm2_letter', is: ['active', 'turnIn'] } } },
    ],
  };
  assert(evalCondition(player, condition));
  const before = JSON.stringify(player);
  assert(evalCondition(player, condition));
  assertEquals(JSON.stringify(player), before, 'evaluation never mutates');
  // Complement checks.
  assert(!evalCondition(player, { levelAtLeast: 6 }));
  assert(!evalCondition(player, { flag: { id: 'bells', equals: 4 } }));
  assert(!evalCondition(player, { ownsItem: { itemId: 'm_ember_shard', count: 3 } }));
  assert(!evalCondition(player, { inZone: 'abyss' }));
  assert(!evalCondition(player, { questStatus: { questId: 'm1_embers', is: 'active' } }));
  assert(evalCondition(player, { questStatus: { questId: 'm1_embers', is: ['done', 'turnIn'] } }));
  assert(!evalCondition(player, { decision: { id: 'never_made' } }));
  assert(evalCondition(player, { not: { flag: { id: 'missing' } } }));
});

// ── decision ledger ──────────────────────────────────────────────────────

Deno.test('decisions: recorded with provenance, idempotent, conflicting choice refused', () => {
  const player = hero(1301);
  const result = applyStoryEffects(player, [
    { kind: 'recordDecision', id: 'shrine_allegiance', choiceId: 'ferryman' },
    { kind: 'recordDecision', id: 'shrine_allegiance', choiceId: 'ferryman' }, // replay
  ], ctx);
  assertEquals(result.decisions, ['shrine_allegiance'], 'replay records nothing new');
  assertEquals(player.decisions['shrine_allegiance'], {
    choiceId: 'ferryman',
    dialogueId: 'dlg_test',
    nodeId: 'n1',
    chosenAt: ctx.now,
  });
  // A different choice for the same decision id is a contradiction — under
  // a FRESH application identity (this one is receipted now, and a
  // receipted identity validates as a replay no-op, #137).
  assert(
    validateStoryBundle(player, [
      { kind: 'recordDecision', id: 'shrine_allegiance', choiceId: 'curator' },
    ], { ...ctx, nodeId: 'n2' }) !== undefined,
    'overwriting a decision is refused',
  );
  assert(evalCondition(player, { decision: { id: 'shrine_allegiance', choiceId: 'ferryman' } }));
  assert(!evalCondition(player, { decision: { id: 'shrine_allegiance', choiceId: 'curator' } }));
});

// ── outcomes and permanent exclusion ─────────────────────────────────────

Deno.test('outcomes: a locked quest never resurrects through availability sync', () => {
  const player = hero(1302);
  player.level = 45;
  // m25_silence becomes available at 45 with m24 done; lock it mid-flow.
  player.quests['m24_below'] = { status: 'done', counts: [1] };
  player.quests['m25_silence'] = { status: 'active', counts: [0] };
  applyStoryEffects(player, [
    { kind: 'lockQuest', questId: 'm25_silence', reason: 'seam_closed' },
  ], ctx);
  assertEquals(player.questOutcomes['m25_silence']?.kind, 'locked');
  assertEquals(player.quests['m25_silence']?.status, 'unavailable');
  // Ordinary prerequisites still hold — but the lockout wins.
  syncAvailability(player);
  assertEquals(player.quests['m25_silence']?.status, 'unavailable', 'no resurrection');
  assert(questExcluded(player, 'm25_silence'));
  // Re-locking is idempotent (no double record churn).
  const before = JSON.stringify(player.questOutcomes['m25_silence']);
  applyStoryEffects(player, [{ kind: 'lockQuest', questId: 'm25_silence' }], ctx);
  assertEquals(JSON.stringify(player.questOutcomes['m25_silence']), before);
});

Deno.test('outcomes: named resolutions require their quest to declare them (#146)', () => {
  // No declaration: sq_rats declares no outcomes, so EVERY named
  // resolution is refused — there is no default-accept path.
  const none = hero(1303);
  none.quests['sq_rats'] = { status: 'active', counts: [6] };
  assert(
    validateStoryBundle(
      none,
      [{ kind: 'resolveQuest', questId: 'sq_rats', outcome: 'culled' }],
      ctx,
    ) !== undefined,
    'a quest with no outcomes declaration refuses every named resolution',
  );
  assertEquals(none.quests['sq_rats']?.status, 'active', 'the refusal mutates nothing');

  // Unknown value on a DECLARED quest: sq_shrine_pact declares only "kept".
  const declared = hero(1304);
  declared.quests['sq_shrine_pact'] = { status: 'active', counts: [1, 0] };
  assert(
    validateStoryBundle(
      declared,
      [{ kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'traded' }],
      ctx,
    ) !== undefined,
    'a value outside the declaration refuses',
  );
  // A cross-quest declared value: "kept" is sq_shrine_pact's alone —
  // sq_ledger_debt does not declare it.
  const other = hero(1314);
  other.quests['sq_ledger_debt'] = { status: 'active', counts: [1, 0] };
  assert(
    validateStoryBundle(
      other,
      [{ kind: 'resolveQuest', questId: 'sq_ledger_debt', outcome: 'kept' }],
      ctx,
    ) !== undefined,
    'an outcome declared by a DIFFERENT quest refuses',
  );

  // The declared pair resolves, replays idempotently (a distinct
  // application identity still sees the recorded outcome as matching), and
  // leaves the quest done. A real dialogue id keeps the receipts
  // themselves resolvable identities.
  const real = { ...ctx, dialogueId: 'dlg_maren_flame' };
  applyStoryEffects(
    declared,
    [{ kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'kept' }],
    { ...real, nodeId: 'n1' },
  );
  assertEquals(declared.quests['sq_shrine_pact']?.status, 'done');
  assertEquals(namedOutcome(declared.questOutcomes['sq_shrine_pact']), 'kept');
  applyStoryEffects(
    declared,
    [{ kind: 'resolveQuest', questId: 'sq_shrine_pact', outcome: 'kept' }],
    { ...real, nodeId: 'n2' },
  );
  assertEquals(namedOutcome(declared.questOutcomes['sq_shrine_pact']), 'kept');

  // The valid declared outcome survives a JSON/save round-trip, keeps
  // satisfying questOutcome conditions, and passes the persisted-identity
  // gate untouched (#146).
  const reloaded = JSON.parse(JSON.stringify(declared)) as PlayerState;
  assert(
    evalCondition(reloaded, {
      questOutcome: { questId: 'sq_shrine_pact', kind: 'resolved', outcome: 'kept' },
    }),
  );
  assertEquals(findUnresolvedPersistedIds(reloaded), []);
  // …while an undeclared resolved value would fail that same gate without
  // mutation.
  const corrupt = JSON.parse(JSON.stringify(declared)) as PlayerState;
  corrupt.questOutcomes['sq_shrine_pact'] = { kind: 'resolved', outcome: 'typo', at: 1 };
  assert(
    findUnresolvedPersistedIds(corrupt).some((pr) =>
      pr.family === 'questOutcomes' && pr.id === 'typo'
    ),
    'an undeclared resolved outcome is refused by the identity gate',
  );
});

Deno.test('outcomes: a failed quest is likewise permanent', () => {
  const player = hero(1305);
  player.quests['sq_ore'] = { status: 'active', counts: [1] };
  applyStoryEffects(player, [{ kind: 'failQuest', questId: 'sq_ore', reason: 'forge_cold' }], ctx);
  assertEquals(player.questOutcomes['sq_ore']?.kind, 'failed');
  syncAvailability(player);
  assertEquals(
    player.quests['sq_ore']?.status,
    'unavailable',
    'failure is not retried into existence',
  );
});

// ── story effects ────────────────────────────────────────────────────────

Deno.test('story: bundles are atomic — a failing precondition mutates nothing', () => {
  const player = hero(1306);
  const before = JSON.stringify(player);
  const bundle = [
    { kind: 'setFlag', id: 'will_apply' },
    { kind: 'removeItem', itemId: 'm_iron_chunk', qty: 1 }, // hero has none
    { kind: 'setFlag', id: 'never_reached' },
  ] as const;
  assert(validateStoryBundle(player, [...bundle], ctx) !== undefined);
  assertThrowsWrapper(() => applyStoryEffects(player, [...bundle], ctx));
  assertEquals(JSON.stringify(player), before, 'all-or-nothing');
});

function assertThrowsWrapper(fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, 'expected the bundle to refuse');
}

Deno.test('story: startQuest honors on-site starter authority (#63/#64)', () => {
  const player = hero(1307);
  player.level = 2;
  player.quests['m1_embers'] = { status: 'done', counts: [4] };
  syncAvailability(player); // m2 available, started by Maren
  assertEquals(player.quests['m2_letter']?.status, 'available');
  // Bram's dialogue cannot puppet Maren's quest even on-site.
  const bramCtx: StoryContext = { ...ctx, npcId: 'npc_bram' };
  assert(
    validateStoryBundle(player, [{ kind: 'startQuest', questId: 'm2_letter' }], bramCtx) !==
      undefined,
    'wrong starter refused',
  );
  // Maren on-site starts it.
  const result = applyStoryEffects(player, [{ kind: 'startQuest', questId: 'm2_letter' }], ctx);
  assertEquals(result.startedQuests, ['m2_letter']);
  assertEquals(player.quests['m2_letter']?.status, 'active');
  // Off-site Maren cannot.
  const p2 = hero(1308);
  p2.level = 2;
  p2.quests['m1_embers'] = { status: 'done', counts: [4] };
  syncAvailability(p2);
  p2.currentZone = 'whisperwood';
  assert(
    validateStoryBundle(p2, [{ kind: 'startQuest', questId: 'm2_letter' }], ctx) !== undefined,
    'off-site starter refused',
  );
});

Deno.test('story: grants, removals, unlocks and events apply in authored order', () => {
  const player = hero(1309);
  const base = player.inventory.find((entry) => entry.id === 'c_minor_potion')?.qty ?? 0;
  const result = applyStoryEffects(player, [
    { kind: 'storyEvent', event: 'shrine_allegiance_chosen' },
    { kind: 'grantItem', itemId: 'c_minor_potion', qty: 2 },
    { kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 },
    { kind: 'removeItem', itemId: 'c_minor_potion', qty: 1 },
    { kind: 'unlockZone', zoneId: 'hollowmere' },
    { kind: 'setFlag', id: 'swarm_blessed', value: 'yes' },
  ], ctx);
  assertEquals(result.events, ['shrine_allegiance_chosen']);
  assertEquals(player.inventory.find((entry) => entry.id === 'c_minor_potion')?.qty, base + 2);
  assert(player.unlockedZones.includes('hollowmere'));
  assertEquals(player.flags['swarm_blessed'], 'yes');
  assertEquals(player.storyEvents, ['shrine_allegiance_chosen']);
  // Duplicate events dedupe.
  applyStoryEffects(player, [{ kind: 'storyEvent', event: 'shrine_allegiance_chosen' }], ctx);
  assertEquals(player.storyEvents, ['shrine_allegiance_chosen']);
});

Deno.test('story: granted items tick collect quests through the shared authority (#119)', () => {
  const player = hero(1310);
  player.level = 12;
  player.quests['m5_fen'] = { status: 'done', counts: [1] };
  player.unlockedZones.push('hollowmere');
  player.currentZone = 'hollowmere';
  syncAvailability(player);
  assert(acceptQuest(player, 'm6_toxin', 'npc_ferryman').ok);
  const result = applyStoryEffects(player, [
    { kind: 'grantItem', itemId: 'q_toxin_sample', qty: 4 },
  ], { ...ctx, npcId: 'npc_ferryman' });
  assert(result.readyQuests.includes('m6_toxin'), 'readiness announced once');
  assertEquals(player.quests['m6_toxin']?.status, 'turnIn');
  const lines = storyNoticeLines(result);
  assertEquals(lines.filter((line) => line.includes('ready to turn in')).length, 1);
});

Deno.test('story: mutually exclusive quests — one choice locks the other route', () => {
  // A fixture pair from real content: starting m2 for Maren and locking
  // sq_ore (also Bram's) simulates exclusive routes without new content.
  const player = hero(1311);
  player.level = 2;
  player.flags['zone_whisperwood'] = true;
  player.quests['m1_embers'] = { status: 'done', counts: [4] };
  syncAvailability(player);
  applyStoryEffects(player, [
    { kind: 'startQuest', questId: 'm2_letter' },
    { kind: 'recordDecision', id: 'm2_route', choiceId: 'deliver' },
    { kind: 'lockQuest', questId: 'sq_ore', reason: 'm2_route' },
  ], ctx);
  assertEquals(player.quests['m2_letter']?.status, 'active');
  assertEquals(player.quests['sq_ore']?.status, 'unavailable');
  syncAvailability(player);
  assertEquals(player.quests['sq_ore']?.status, 'unavailable', 'locked route stays shut');
  // A later dialogue can identify the actual choice.
  assert(evalCondition(player, { decision: { id: 'm2_route', choiceId: 'deliver' } }));
});

Deno.test('topics: authored availability conditions gate lore topics (#125)', () => {
  const player = hero(1312);
  player.level = 1;
  // No content topic carries a `when` yet — the resolver just filters.
  const topics = npcTopics(player, 'npc_maren');
  assert(topics.every((topic) => topic.kind === 'lore' || topic.kind.startsWith('quest')));
});

Deno.test('quests: declarative prereq conditions gate availability (#125)', () => {
  const player = hero(1313);
  player.level = 45;
  syncAvailability(player);
  assertEquals(player.quests['m25_silence'], undefined);
  player.quests['m24_below'] = { status: 'done', counts: [1] };
  syncAvailability(player);
  assertEquals(player.quests['m25_silence']?.status, 'available');
});

Deno.test('quests: level guidance shares nested story conditions and exclusions (#174)', () => {
  const questDef = quest('m2_letter')!;
  const original = questDef.prereq;
  questDef.prereq = {
    all: [
      original!,
      { any: [{ flag: { id: 'offer_open' } }, { flag: { id: 'alternate_offer' } }] },
      { not: { flag: { id: 'offer_blocked' } } },
    ],
  };
  try {
    const player = hero(1740);
    player.quests['m1_embers'] = { status: 'done', counts: [4] };
    syncAvailability(player);
    assertEquals(player.quests[questDef.id], undefined);
    assertEquals(levelLockedMain(player), undefined, 'unmet story conditions hide the level hint');

    player.flags['offer_open'] = false; // existence, not truthiness
    syncAvailability(player);
    assertEquals(player.quests[questDef.id], undefined, 'level still gates acceptance');
    assertEquals(levelLockedMain(player)?.id, questDef.id);
    delete player.flags['offer_open'];
    player.flags['alternate_offer'] = 0;
    assertEquals(levelLockedMain(player)?.id, questDef.id, 'either defined flag satisfies any');

    player.flags['offer_blocked'] = true;
    assertEquals(levelLockedMain(player), undefined, 'negated conditions also hide the hint');
    delete player.flags['offer_blocked'];
    player.level = questDef.level;
    syncAvailability(player);
    assertEquals(player.quests[questDef.id]?.status, 'available');
    assertEquals(levelLockedMain(player), undefined, 'no hint once the level is sufficient');

    for (const kind of ['locked', 'failed'] as const) {
      const excluded = hero(1741);
      excluded.quests['m1_embers'] = { status: 'done', counts: [4] };
      excluded.flags['offer_open'] = true;
      excluded.questOutcomes[questDef.id] = { kind, at: 0 };
      assertEquals(levelLockedMain(excluded), undefined, `${kind} quests never get a level hint`);
      excluded.level = questDef.level;
      syncAvailability(excluded);
      assertEquals(excluded.quests[questDef.id], undefined, `${kind} quests stay unavailable`);
    }
  } finally {
    questDef.prereq = original;
  }
});

Deno.test('quests: authored flag prerequisites preserve existence semantics (#174)', () => {
  for (const value of [undefined, false, 0, 'visited'] as const) {
    const player = hero(1742);
    player.level = 2;
    if (value !== undefined) player.flags['zone_whisperwood'] = value;
    syncAvailability(player);
    assertEquals(player.quests['sq_ore']?.status, value === undefined ? undefined : 'available');
  }
});
