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
import { acceptQuest, questExcluded, syncAvailability } from '../src/engine/quests.ts';
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
  const p = hero(1300);
  p.level = 5;
  p.flags['ember_lit'] = true;
  p.flags['bells'] = 3;
  addItem(p, 'm_ember_shard', 2);
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  p.currentZone = 'whisperwood';

  const c: Condition = {
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
  assert(evalCondition(p, c));
  const before = JSON.stringify(p);
  assert(evalCondition(p, c));
  assertEquals(JSON.stringify(p), before, 'evaluation never mutates');
  // Complement checks.
  assert(!evalCondition(p, { levelAtLeast: 6 }));
  assert(!evalCondition(p, { flag: { id: 'bells', equals: 4 } }));
  assert(!evalCondition(p, { ownsItem: { itemId: 'm_ember_shard', count: 3 } }));
  assert(!evalCondition(p, { inZone: 'abyss' }));
  assert(!evalCondition(p, { questStatus: { questId: 'm1_embers', is: 'active' } }));
  assert(evalCondition(p, { questStatus: { questId: 'm1_embers', is: ['done', 'turnIn'] } }));
  assert(!evalCondition(p, { decision: { id: 'never_made' } }));
  assert(evalCondition(p, { not: { flag: { id: 'missing' } } }));
});

// ── decision ledger ──────────────────────────────────────────────────────

Deno.test('decisions: recorded with provenance, idempotent, conflicting choice refused', () => {
  const p = hero(1301);
  const result = applyStoryEffects(p, [
    { kind: 'recordDecision', id: 'shrine_allegiance', choiceId: 'ferryman' },
    { kind: 'recordDecision', id: 'shrine_allegiance', choiceId: 'ferryman' }, // replay
  ], ctx);
  assertEquals(result.decisions, ['shrine_allegiance'], 'replay records nothing new');
  assertEquals(p.decisions['shrine_allegiance'], {
    choiceId: 'ferryman',
    dialogueId: 'dlg_test',
    nodeId: 'n1',
    chosenAt: ctx.now,
  });
  // A different choice for the same decision id is a contradiction — under
  // a FRESH application identity (this one is receipted now, and a
  // receipted identity validates as a replay no-op, #137).
  assert(
    validateStoryBundle(p, [
      { kind: 'recordDecision', id: 'shrine_allegiance', choiceId: 'curator' },
    ], { ...ctx, nodeId: 'n2' }) !== undefined,
    'overwriting a decision is refused',
  );
  assert(evalCondition(p, { decision: { id: 'shrine_allegiance', choiceId: 'ferryman' } }));
  assert(!evalCondition(p, { decision: { id: 'shrine_allegiance', choiceId: 'curator' } }));
});

// ── outcomes and permanent exclusion ─────────────────────────────────────

Deno.test('outcomes: a locked quest never resurrects through availability sync', () => {
  const p = hero(1302);
  p.level = 45;
  // m25_silence becomes available at 45 with m24 done; lock it mid-flow.
  p.quests['m24_below'] = { status: 'done', counts: [1] };
  p.quests['m25_silence'] = { status: 'active', counts: [0] };
  applyStoryEffects(p, [
    { kind: 'lockQuest', questId: 'm25_silence', reason: 'seam_closed' },
  ], ctx);
  assertEquals(p.questOutcomes['m25_silence']?.kind, 'locked');
  assertEquals(p.quests['m25_silence']?.status, 'unavailable');
  // Ordinary prerequisites still hold — but the lockout wins.
  syncAvailability(p);
  assertEquals(p.quests['m25_silence']?.status, 'unavailable', 'no resurrection');
  assert(questExcluded(p, 'm25_silence'));
  // Re-locking is idempotent (no double record churn).
  const before = JSON.stringify(p.questOutcomes['m25_silence']);
  applyStoryEffects(p, [{ kind: 'lockQuest', questId: 'm25_silence' }], ctx);
  assertEquals(JSON.stringify(p.questOutcomes['m25_silence']), before);
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
  const p = hero(1305);
  p.quests['sq_ore'] = { status: 'active', counts: [1] };
  applyStoryEffects(p, [{ kind: 'failQuest', questId: 'sq_ore', reason: 'forge_cold' }], ctx);
  assertEquals(p.questOutcomes['sq_ore']?.kind, 'failed');
  syncAvailability(p);
  assertEquals(p.quests['sq_ore']?.status, 'unavailable', 'failure is not retried into existence');
});

// ── story effects ────────────────────────────────────────────────────────

Deno.test('story: bundles are atomic — a failing precondition mutates nothing', () => {
  const p = hero(1306);
  const before = JSON.stringify(p);
  const bundle = [
    { kind: 'setFlag', id: 'will_apply' },
    { kind: 'removeItem', itemId: 'm_iron_chunk', qty: 1 }, // hero has none
    { kind: 'setFlag', id: 'never_reached' },
  ] as const;
  assert(validateStoryBundle(p, [...bundle], ctx) !== undefined);
  assertThrowsWrapper(() => applyStoryEffects(p, [...bundle], ctx));
  assertEquals(JSON.stringify(p), before, 'all-or-nothing');
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
  const p = hero(1307);
  p.level = 2;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  syncAvailability(p); // m2 available, started by Maren
  assertEquals(p.quests['m2_letter']?.status, 'available');
  // Bram's dialogue cannot puppet Maren's quest even on-site.
  const bramCtx: StoryContext = { ...ctx, npcId: 'npc_bram' };
  assert(
    validateStoryBundle(p, [{ kind: 'startQuest', questId: 'm2_letter' }], bramCtx) !== undefined,
    'wrong starter refused',
  );
  // Maren on-site starts it.
  const r = applyStoryEffects(p, [{ kind: 'startQuest', questId: 'm2_letter' }], ctx);
  assertEquals(r.startedQuests, ['m2_letter']);
  assertEquals(p.quests['m2_letter']?.status, 'active');
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
  const p = hero(1309);
  const base = p.inventory.find((e) => e.id === 'c_minor_potion')?.qty ?? 0;
  const r = applyStoryEffects(p, [
    { kind: 'storyEvent', event: 'shrine_allegiance_chosen' },
    { kind: 'grantItem', itemId: 'c_minor_potion', qty: 2 },
    { kind: 'grantItem', itemId: 'c_minor_potion', qty: 1 },
    { kind: 'removeItem', itemId: 'c_minor_potion', qty: 1 },
    { kind: 'unlockZone', zoneId: 'hollowmere' },
    { kind: 'setFlag', id: 'swarm_blessed', value: 'yes' },
  ], ctx);
  assertEquals(r.events, ['shrine_allegiance_chosen']);
  assertEquals(p.inventory.find((e) => e.id === 'c_minor_potion')?.qty, base + 2);
  assert(p.unlockedZones.includes('hollowmere'));
  assertEquals(p.flags['swarm_blessed'], 'yes');
  assertEquals(p.storyEvents, ['shrine_allegiance_chosen']);
  // Duplicate events dedupe.
  applyStoryEffects(p, [{ kind: 'storyEvent', event: 'shrine_allegiance_chosen' }], ctx);
  assertEquals(p.storyEvents, ['shrine_allegiance_chosen']);
});

Deno.test('story: granted items tick collect quests through the shared authority (#119)', () => {
  const p = hero(1310);
  p.level = 12;
  p.quests['m5_fen'] = { status: 'done', counts: [1] };
  p.unlockedZones.push('hollowmere');
  p.currentZone = 'hollowmere';
  syncAvailability(p);
  assert(acceptQuest(p, 'm6_toxin', 'npc_ferryman').ok);
  const r = applyStoryEffects(p, [
    { kind: 'grantItem', itemId: 'q_toxin_sample', qty: 4 },
  ], { ...ctx, npcId: 'npc_ferryman' });
  assert(r.readyQuests.includes('m6_toxin'), 'readiness announced once');
  assertEquals(p.quests['m6_toxin']?.status, 'turnIn');
  const lines = storyNoticeLines(r);
  assertEquals(lines.filter((l) => l.includes('ready to turn in')).length, 1);
});

Deno.test('story: mutually exclusive quests — one choice locks the other route', () => {
  // A fixture pair from real content: starting m2 for Maren and locking
  // sq_ore (also Bram's) simulates exclusive routes without new content.
  const p = hero(1311);
  p.level = 2;
  p.flags['zone_whisperwood'] = true;
  p.quests['m1_embers'] = { status: 'done', counts: [4] };
  syncAvailability(p);
  applyStoryEffects(p, [
    { kind: 'startQuest', questId: 'm2_letter' },
    { kind: 'recordDecision', id: 'm2_route', choiceId: 'deliver' },
    { kind: 'lockQuest', questId: 'sq_ore', reason: 'm2_route' },
  ], ctx);
  assertEquals(p.quests['m2_letter']?.status, 'active');
  assertEquals(p.quests['sq_ore']?.status, 'unavailable');
  syncAvailability(p);
  assertEquals(p.quests['sq_ore']?.status, 'unavailable', 'locked route stays shut');
  // A later dialogue can identify the actual choice.
  assert(evalCondition(p, { decision: { id: 'm2_route', choiceId: 'deliver' } }));
});

Deno.test('topics: authored availability conditions gate lore topics (#125)', () => {
  const p = hero(1312);
  p.level = 1;
  // No content topic carries a `when` yet — the resolver just filters.
  const topics = npcTopics(p, 'npc_maren');
  assert(topics.every((t) => t.kind === 'lore' || t.kind.startsWith('quest')));
});

Deno.test('quests: declarative prereq conditions gate availability (#125)', () => {
  const p = hero(1313);
  p.level = 45;
  p.quests['m24_below'] = { status: 'done', counts: [1] };
  // m25_silence has no `prereq` authored; legacy fields still gate it.
  syncAvailability(p);
  assertEquals(p.quests['m25_silence']?.status, 'available');
});
