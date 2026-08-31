/** Quest-log pagination (#21): every live side quest must be reachable. */

import { assert, assertEquals } from '@std/assert';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { withRev } from '../src/codec.ts';
import { createPlayer } from '../src/engine/character.ts';
import { grantItem, syncAvailability } from '../src/engine/quests.ts';
import { renderQuestDetail, renderQuests } from '../src/render/views.ts';
import { fakeCtx } from './helpers.ts';

Deno.test('quest log pages side quests — the 9th live quest is reachable (#21)', async () => {
  const store = new MemoryStore();
  const p = createPlayer(940, 'T', 'warrior');
  p.level = 45;
  // Unlock every zone flag so all 16 side quests go live.
  for (
    const z of ['whisperwood', 'hollowmere', 'sunspire', 'frostpeak', 'cinder', 'umbra', 'abyss']
  ) {
    p.flags[`zone_${z}`] = true;
  }
  p.quests['m3_roots'] = { status: 'done', counts: [] }; // sq_stag's prereq
  syncAvailability(p);
  p.messageId = 700;
  await store.set(940, p);

  // 16 live side quests → two pages. Page 0 ends at sq_scarabs; the 9th
  // (sq_lynx) used to render no button anywhere.
  const page0 = JSON.stringify(renderQuests(p, 0));
  const page1 = JSON.stringify(renderQuests(p, 1));
  assert(page0.includes('q:q:sq_scarabs'), 'page 0 holds quests 1–8');
  assert(!page0.includes('q:q:sq_lynx'), 'the 9th quest is not on page 0');
  assert(page1.includes('q:q:sq_lynx'), 'the 9th quest lives on page 1');
  assert(page0.includes('q:pg:1'), 'page 0 offers Next');
  assert(page1.includes('q:pg:0'), 'page 1 offers Prev');
  assert(!page1.includes('q:pg:2'), 'page 1 has no Next');

  // Drive the real UI: Next → open the 9th quest's detail → the log CANNOT
  // accept it (#65): no lifecycle button renders, the old wire form is dead,
  // and the journal names the physical contact instead.
  await handleCallback(fakeCtx(940, 700, withRev(0, 'q:pg:1')), store);
  let cur = (await store.get(940))!;
  assertEquals(cur.scene.arg2, '1', 'page stored in scene.arg2');
  await handleCallback(fakeCtx(940, 700, withRev(cur.uiRev ?? 0, 'q:q:sq_lynx')), store);
  cur = (await store.get(940))!;
  assertEquals(cur.scene.arg, 'sq_lynx');
  assertEquals(cur.scene.arg2, '1', 'opening a detail preserves the page');
  const detail = JSON.stringify(renderQuestDetail(cur, 'sq_lynx'));
  assert(!detail.includes('q:a:sq_lynx'), 'the log renders no accept button (#65)');
  assert(!detail.includes('q:t:'), 'the log renders no turn-in button');
  assert(detail.includes('Start with Curator Ombra'), 'the journal names the starter');
  await handleCallback(fakeCtx(940, 700, withRev(cur.uiRev ?? 0, 'q:a:sq_lynx')), store);
  cur = (await store.get(940))!;
  assertEquals(
    cur.quests['sq_lynx']?.status,
    'available',
    'the dead wire form mutates nothing (#64/#65)',
  );

  // Back from the detail returns to the SAME page, quest unchanged.
  await handleCallback(fakeCtx(940, 700, withRev(cur.uiRev ?? 0, 'q:bk')), store);
  cur = (await store.get(940))!;
  assertEquals(cur.scene.arg, undefined);
  assertEquals(cur.scene.arg2, '1', 'Back returns to the same page');
  const again = JSON.stringify(renderQuests(cur, Number(cur.scene.arg2 ?? 0)));
  assert(again.includes('q:q:sq_lynx'), 'page 1 still lists the quest');
});

Deno.test('the Quest Log renders no lifecycle mutation callbacks in ANY state (#65)', () => {
  // Drive every list+detail state a quest can be in; none may offer accept
  // or turn-in — the journal informs, the NPC interaction acts (#64).
  const p = createPlayer(944, 'T', 'warrior');
  p.level = 45;
  p.quests['m2_letter'] = { status: 'done', counts: [] };
  syncAvailability(p);
  for (const id of ['m1_embers', 'm3_roots', 'sq_rats', 'sq_lynx']) {
    for (const st of ['available', 'active', 'turnIn', 'done'] as const) {
      p.quests[id] = { status: st, counts: [] };
      const list = JSON.stringify(renderQuests(p));
      const detail = JSON.stringify(renderQuestDetail(p, id));
      assert(!list.includes('q:a:'), `list leaks accept for ${id}@${st}`);
      assert(!list.includes('q:t:'), `list leaks turn-in for ${id}@${st}`);
      assert(!detail.includes('q:a:'), `detail leaks accept for ${id}@${st}`);
      assert(!detail.includes('q:t:'), `detail leaks turn-in for ${id}@${st}`);
    }
  }
});

Deno.test('the journal names the physical contact at every lifecycle stage (#65)', () => {
  const p = createPlayer(946, 'T', 'warrior');
  p.level = 5;
  p.quests['m1_embers'] = { status: 'done', counts: [] };
  syncAvailability(p);

  // Available: names the STARTER and their zone.
  const avail = JSON.stringify(renderQuestDetail(p, 'm2_letter'));
  assert(avail.includes('Start with Elder Maren — Emberdawn Village.'));

  // Active: objectives stay visible, and the finisher is named for the trip.
  p.quests['m2_letter'] = { status: 'active', counts: [1, 0] };
  grantItem(p, 'q_sealed_letter', 1);
  const active = JSON.stringify(renderQuestDetail(p, 'm2_letter'));
  assert(active.includes('Finish with Blacksmith Bram — Emberdawn Village.'));

  // Ready: names the FINISHER and their zone; the list label stays neutral.
  p.quests['m2_letter'] = { status: 'turnIn', counts: [1, 1] };
  const ready = JSON.stringify(renderQuestDetail(p, 'm2_letter'));
  assert(ready.includes('Return to Blacksmith Bram — Emberdawn Village.'));
  const list = JSON.stringify(renderQuests(p));
  assert(list.includes('Ready — view details'), 'neutral ready label');
  // The status line may describe STATE ("Ready to turn in" — at the NPC);
  // what must never return is a button promising the log does it.
  assert(!list.includes('view & turn in'), 'no label implies remote completion');
  assert(!list.includes('q:a:'), 'no lifecycle callback in the list');
});
