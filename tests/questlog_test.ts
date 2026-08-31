/** Quest-log pagination (#21): every live side quest must be reachable. */

import { assert, assertEquals } from '@std/assert';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { withRev } from '../src/codec.ts';
import { createPlayer } from '../src/engine/character.ts';
import { syncAvailability } from '../src/engine/quests.ts';
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
  // accept it (#64) — viewing works, lifecycle authority lives at the NPC.
  await handleCallback(fakeCtx(940, 700, withRev(0, 'q:pg:1')), store);
  let cur = (await store.get(940))!;
  assertEquals(cur.scene.arg2, '1', 'page stored in scene.arg2');
  await handleCallback(fakeCtx(940, 700, withRev(cur.uiRev ?? 0, 'q:q:sq_lynx')), store);
  cur = (await store.get(940))!;
  assertEquals(cur.scene.arg, 'sq_lynx');
  assertEquals(cur.scene.arg2, '1', 'opening a detail preserves the page');
  const detail = JSON.stringify(renderQuestDetail(cur, 'sq_lynx'));
  assert(detail.includes('q:a:sq_lynx'), 'accept button still renders in the log (removed in #65)');
  await handleCallback(fakeCtx(940, 700, withRev(cur.uiRev ?? 0, 'q:a:sq_lynx')), store);
  cur = (await store.get(940))!;
  assertEquals(
    cur.quests['sq_lynx']?.status,
    'available',
    'the 9th quest stays available — the log cannot accept it (#64)',
  );

  // Back from the detail returns to the SAME page, quest unchanged.
  await handleCallback(fakeCtx(940, 700, withRev(cur.uiRev ?? 0, 'q:bk')), store);
  cur = (await store.get(940))!;
  assertEquals(cur.scene.arg, undefined);
  assertEquals(cur.scene.arg2, '1', 'Back returns to the same page');
  const again = JSON.stringify(renderQuests(cur, Number(cur.scene.arg2 ?? 0)));
  assert(again.includes('q:q:sq_lynx'), 'page 1 still lists the quest');
});
