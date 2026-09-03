/**
 * Multi-node dialogue conversations (#124): authored linear dialogue with
 * explicit speakers, Continue advancing exactly one node in the live
 * message, persisted scene state that rerenders faithfully, and hostile
 * callbacks that never mutate. Also the dialogue content-integrity gate.
 */

import { assert, assertEquals } from '@std/assert';
import { dialogue, dialogueNode, DIALOGUES } from '../src/content/dialogues.ts';
import { npc } from '../src/content/quests.ts';
import { ZONES } from '../src/content/zones.ts';
import { decodeCb, encodeCb, withRev } from '../src/codec.ts';
import { createPlayer } from '../src/engine/character.ts';
import { syncAvailability } from '../src/engine/quests.ts';
import { npcTopics } from '../src/engine/npc.ts';
import { dialogueAction, npcAction } from '../src/handlers/hub.ts';
import { renderDialogue } from '../src/render/views.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { fakeCtx } from './helpers.ts';
import type { PlayerState } from '../src/engine/types.ts';

// ── content integrity ────────────────────────────────────────────────────

Deno.test('dialogue integrity: ids, references, reachability, terminals (#124)', () => {
  const ids = new Set(DIALOGUES.map((d) => d.id));
  assertEquals(ids.size, DIALOGUES.length, 'dialogue ids are unique');
  const placedNpcs = new Set(ZONES.flatMap((z) => z.npcs.map((n) => n.id)));
  for (const d of DIALOGUES) {
    assert(placedNpcs.has(d.npcId), `${d.id}: npc ${d.npcId} is not placed in any zone`);
    assert(d.nodes.length > 0, `${d.id}: no nodes`);
    const nodeIds = new Set(d.nodes.map((n) => n.id));
    assertEquals(nodeIds.size, d.nodes.length, `${d.id}: node ids must be unique`);
    assert(nodeIds.has(d.start), `${d.id}: start node missing`);
    for (const n of d.nodes) {
      if (n.kind === 'line') {
        assert(n.text.length > 0, `${d.id}:${n.id}: empty line node`);
        if (n.next !== undefined) {
          assert(nodeIds.has(n.next), `${d.id}:${n.id}: missing next target ${n.next}`);
        }
      } else {
        assertEquals(
          (n as { next?: string }).next,
          undefined,
          `${d.id}:${n.id}: end nodes carry no next`,
        );
      }
      // Callback budget: dlg:nx:<rev4>:<nodeId> must stay under 64 bytes.
      if (n.kind === 'line' && n.next) {
        const wire = withRev(9999, encodeCb({ v: 'dlg', a: 'nx', arg: n.next }));
        assert(wire.length <= 64, `${d.id}:${n.id} wire form too long (${wire.length})`);
      }
    }
    // Reachability: every node is visited from start via next links.
    const seen = new Set<string>();
    let cursor: string | undefined = d.start;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const n = dialogueNode(d, cursor);
      cursor = n && n.kind === 'line' ? n.next : undefined;
    }
    for (const n of d.nodes) {
      assert(seen.has(n.id), `${d.id}:${n.id}: unreachable node`);
    }
    // Terminals: the walk terminates — on an explicit end node or on a
    // final line that omits `next` (the implicit end state).
    const last = d.nodes[d.nodes.length - 1]!;
    const terminates = last.kind === 'end' || (last.kind === 'line' && !last.next);
    assert(terminates, `${d.id}: the walk must terminate`);
    // The owning NPC offers the dialogue through one of their topics.
    const offered = ZONES.flatMap((z) => z.npcs).some((n) =>
      n.id === d.npcId && (n.topics ?? []).some((t) => t.dialogue === d.id)
    );
    assert(offered, `${d.id}: no NPC topic opens this dialogue`);
  }
});

Deno.test('dialogue integrity: topic shapes are complete (#124)', () => {
  for (const z of ZONES) {
    for (const n of z.npcs) {
      for (const t of n.topics ?? []) {
        if (t.dialogue !== undefined) {
          assert(dialogue(t.dialogue), `${n.id}:${t.id}: unknown dialogue ${t.dialogue}`);
          assertEquals(
            dialogue(t.dialogue)!.npcId,
            n.id,
            `${n.id}:${t.id}: dialogue belongs to another NPC`,
          );
        } else {
          assert(t.text, `${n.id}:${t.id}: static topic needs text`);
        }
      }
    }
  }
});

// ── scene flow ───────────────────────────────────────────────────────────

function hero(id: number): PlayerState {
  const p = createPlayer(id, 'T', 'warrior');
  syncAvailability(p);
  return p;
}

Deno.test('dialogue: selecting a dialogue topic opens the scene at the start node (#124)', () => {
  const p = hero(1200);
  p.scene = { view: 'npc', arg: 'npc_maren' };
  npcAction(p, { v: 'npc', a: 'lore', arg: 'maren_flame' });
  assertEquals(p.scene.view, 'dialogue');
  assertEquals(p.scene.arg, 'dlg_maren_flame');
  assertEquals(p.scene.arg2, 'n1');
});

Deno.test('dialogue: Continue advances exactly one node; End returns to topics (#124)', () => {
  const p = hero(1201);
  p.scene = { view: 'npc', arg: 'npc_maren' };
  npcAction(p, { v: 'npc', a: 'lore', arg: 'maren_flame' });
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n2' });
  assertEquals(p.scene.arg2, 'n2');
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n3' });
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n4' });
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n5' });
  assertEquals(p.scene.arg2, 'n5');
  // n5 is the final line (no next): there is nothing to continue to.
  const last = dialogueNode(dialogue('dlg_maren_flame')!, 'n5')!;
  assertEquals(last.kind === 'line' ? last.next : undefined, undefined);
  // End/back returns to the owning NPC's topic menu.
  dialogueAction(p, { v: 'dlg', a: 'bk' });
  assertEquals(p.scene.view, 'npc');
  assertEquals(p.scene.arg, 'npc_maren');
});

Deno.test('dialogue: hostile callbacks are non-mutating (#124)', () => {
  const p = hero(1202);
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n1' };
  // Wrong next target (forged): refused.
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n5' });
  assertEquals(p.scene.arg2, 'n1', 'a forged skip is refused');
  // Wrong node: the callback targets a node that is not current.next.
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n1' });
  assertEquals(p.scene.arg2, 'n1', 'self-advance refused');
  // Wrong dialogue: the scene names a different conversation.
  p.scene = { view: 'dialogue', arg: 'dlg_bram_forge', arg2: 'n1' };
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n2' }); // valid for THIS scene
  assertEquals(p.scene.arg, 'dlg_bram_forge');
  assertEquals(p.scene.arg2, 'n2');
  // No live scene: refusal.
  p.scene = { view: 'zone' };
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n2' });
  assertEquals(p.scene.view, 'zone', 'nothing opened');
  // Wrong zone: Maren is not in the Whisperwood.
  p.currentZone = 'whisperwood';
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n1' };
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n2' });
  assertEquals(p.scene.arg2, 'n1', 'off-site dialogue cannot advance');
});

Deno.test('dialogue: rerender reproduces the current node (#124)', () => {
  const p = hero(1203);
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n3' };
  const a = JSON.stringify(renderDialogue(p));
  const b = JSON.stringify(renderDialogue(p));
  assertEquals(a, b, 'rendering is pure and position-stable');
  assert(a.includes('Elder Maren'), 'the same beat renders');
});

Deno.test('dialogue: the representative conversation distinguishes all speakers (#124)', () => {
  const p = hero(1204);
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n2' }; // narrator
  const narrator = JSON.stringify(renderDialogue(p));
  assert(!narrator.includes('“'), 'narration is not quoted as speech');
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n1' }; // npc
  const npcSpeech = JSON.stringify(renderDialogue(p));
  assert(npcSpeech.includes('“'), 'NPC speech renders quoted');
  assert(npcSpeech.includes('Elder Maren'), 'the speaker is named');
  assert(npcSpeech.includes('dlg:nx:n2'), 'Continue carries the next node');
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n4' }; // player
  const player = JSON.stringify(renderDialogue(p));
  assert(player.includes('You — “'), 'authored player speech is attributed');
  // The final beat offers End, not Continue.
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n5' };
  const final = JSON.stringify(renderDialogue(p));
  assert(final.includes('End conversation'), 'the last beat offers the exit');
  assert(!final.includes('dlg:nx'), 'no Continue past the final line');
});

Deno.test('dialogue: full router — one message, deterministic advance, replay-safe (#124)', async () => {
  const store = new MemoryStore();
  const p = hero(1205);
  p.messageId = 200;
  p.scene = { view: 'npc', arg: 'npc_maren' };
  await store.set(1205, p);
  let cur = (await store.get(1205))!;
  // Topic → dialogue scene.
  await handleCallback(fakeCtx(1205, 200, withRev(cur.uiRev ?? 0, 'npc:lore:maren_flame')), store);
  cur = (await store.get(1205))!;
  assertEquals(cur.scene.view, 'dialogue');
  assertEquals(cur.scene.arg2, 'n1');
  const rev = cur.uiRev ?? 0;
  // Continue n1 → n2.
  await handleCallback(fakeCtx(1205, 200, withRev(rev, 'dlg:nx:n2')), store);
  cur = (await store.get(1205))!;
  assertEquals(cur.scene.arg2, 'n2');
  // Replay of the SAME callback (same revision): rejected by the rev guard.
  await handleCallback(fakeCtx(1205, 200, withRev(rev, 'dlg:nx:n2')), store);
  cur = (await store.get(1205))!;
  assertEquals(cur.scene.arg2, 'n2', 'replay is a no-op');
  // Decoded wire sanity.
  assert(decodeCb('dlg:1234:nx:n2'), 'dlg wire form decodes');
});

Deno.test('dialogue: topics still resolve for every NPC (#123 parity)', () => {
  for (const z of ZONES) {
    for (const n of z.npcs) {
      assert(npc(n.id), `${n.id} resolves`);
      void npcTopics({ quests: {} } as PlayerState, n.id);
    }
  }
});
